#!/usr/bin/env python3
"""Prepare a managed Houdini bridge without editing scenes or installing with pip.

Run from a Design skill context: python ensure_houdini.py --json
The MCP handshake and scene control are separate; verify get_scene_info afterward.
"""

from __future__ import annotations

import argparse
import concurrent.futures
import ctypes
import json
import os
import re
import shutil
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any

BRIDGE_PORTS = range(8100, 8116)
HOST_NAMES = {"houdini.exe", "houdinifx.exe", "houdinicore.exe", "houdini", "houdinifx", "houdinicore"}
VERSION_PATTERN = re.compile(r"^(?:houdini\s*)?(\d+\.\d+)(?:\.\d+)?$", re.I)
WORKSPACE_HEADERS = {
    "HILO_WORKSPACE_CLAIM": "x-hilo-workspace",
    "HILO_WORKSPACE_INSTANCE_ID": "x-hilo-workspace-instance",
    "HILO_WORKSPACE_GENERATION": "x-hilo-workspace-generation",
}


@dataclass(frozen=True)
class Registration:
    config_root: Path
    package_dir: Path
    version: str


@dataclass(frozen=True)
class Installation:
    executable: Path
    version: str


def major_minor(value: str) -> str | None:
    match = VERSION_PATTERN.fullmatch(value)
    return match.group(1) if match else None


def loopback_base(value: str) -> str:
    parsed = urllib.parse.urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "localhost", "::1"}
        or parsed.username is not None
        or parsed.password is not None
        or parsed.query
        or parsed.fragment
        or parsed.path not in {"", "/"}
    ):
        raise ValueError("gateway URL must be a local HTTP origin without credentials")
    # Accessing port validates malformed or out-of-range values.
    _ = parsed.port
    return urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", ""))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GatewayScopeError(Exception):
    def __init__(self, code: str, http_status: int | None = None):
        super().__init__(code)
        self.code = code
        self.http_status = http_status


def request_json(url: str, body: bytes, content_type: str, timeout: float, headers: dict[str, str] | None = None) -> Any:
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    request = urllib.request.Request(
        url, data=body, headers={"Content-Type": content_type, **(headers or {})}, method="POST"
    )
    with opener.open(request, timeout=max(0.05, timeout)) as response:
        if not 200 <= response.status < 300:
            raise ValueError("unexpected local HTTP response")
        data = response.read(256 * 1024 + 1)
        if len(data) > 256 * 1024:
            raise ValueError("local response exceeds size limit")
        return json.loads(data.decode("utf-8-sig"))


def valid_health(payload: Any, port: int, expected_version: str | None = None) -> dict[str, Any] | None:
    if not isinstance(payload, dict) or payload.get("status") != "ok":
        return None
    pid, version = payload.get("pid"), payload.get("houdini_version")
    if (
        type(pid) is not int
        or pid <= 0
        or not isinstance(version, str)
        or not re.fullmatch(r"\d+\.\d+(?:\.\d+)?", version)
        or (expected_version is not None and major_minor(version) != expected_version)
    ):
        return None
    return {"port": port, "pid": pid, "version": version}


def probe_bridges(timeout: float = 0.75, expected_version: str | None = None) -> list[dict[str, Any]]:
    body = urllib.parse.urlencode({"json": json.dumps(["mcp.health", [], {}])}).encode("utf-8")

    def probe(port: int) -> dict[str, Any] | None:
        try:
            response = request_json(
                f"http://127.0.0.1:{port}/api", body, "application/x-www-form-urlencoded", timeout
            )
            return valid_health(response, port, expected_version)
        except (OSError, ValueError, urllib.error.URLError):
            return None

    with concurrent.futures.ThreadPoolExecutor(max_workers=16) as pool:
        return [result for result in pool.map(probe, BRIDGE_PORTS) if result is not None]


def package_valid(package_dir: Path) -> bool:
    module = package_dir / "fxhoudinimcp"
    host = module / "houdini"
    required = [module / "server.py", module / "__main__.py", host / "scripts" / "python" / "fxhoudinimcp_server" / "startup.py"]
    try:
        return all(item.is_file() for item in required) and any(
            file.is_file() for file in host.glob("python3.*libs/uiready.py")
        )
    except OSError:
        return False


def _env_value(env: dict[str, str], key: str) -> str | None:
    return next((value for name, value in env.items() if name.upper() == key.upper()), None)


def default_gateway_url(env: dict[str, str]) -> str | None:
    return next((value.strip() for key in ["GATEWAY_URL", "HILO_GATEWAY_URL"] if (value := _env_value(env, key)) and value.strip()), None)


def gateway_headers(env: dict[str, str], url: str) -> dict[str, str]:
    values = {header: (_env_value(env, key) or "").strip() for key, header in WORKSPACE_HEADERS.items()}
    if not any(values.values()):
        return {}
    if not all(values.values()) or any(not value.isascii() or "\r" in value or "\n" in value for value in values.values()) or not re.fullmatch(r"[1-9]\d*", values["x-hilo-workspace-generation"]):
        raise GatewayScopeError("workspace_identity_incomplete")
    workspace_url = (_env_value(env, "GATEWAY_URL") or "").strip()
    try:
        matches_workspace = bool(workspace_url) and loopback_base(workspace_url) == url
    except ValueError:
        matches_workspace = False
    if not matches_workspace:
        # A scoped caller must never fall back to the unscoped app gateway.
        raise GatewayScopeError("workspace_gateway_mismatch")
    return values


def _windows_documents() -> Path | None:
    try:
        import winreg
        with winreg.OpenKey(winreg.HKEY_CURRENT_USER, r"Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders") as key:
            personal = winreg.QueryValueEx(key, "Personal")[0]
        return Path(os.path.expandvars(personal)) if isinstance(personal, str) else None
    except OSError:
        return None


def preference_roots(env: dict[str, str], platform: str | None = None) -> list[Path]:
    platform = platform or sys.platform
    home = Path.home()
    parents = [home / "Documents"] if platform == "win32" else [home]
    if platform == "win32":
        documents = _windows_documents()
        if documents:
            parents.insert(0, documents)
    elif platform == "darwin":
        parents.insert(0, home / "Library" / "Preferences" / "houdini")
    roots: list[Path] = []
    override = _env_value(env, "HOUDINI_USER_PREF_DIR")
    if override and Path(override).is_dir() and major_minor(Path(override).name):
        roots.append(Path(override))
    for parent in dict.fromkeys(parents):
        try:
            for entry in parent.iterdir():
                if major_minor(entry.name) and entry.is_dir():
                    roots.append(entry)
        except OSError:
            continue
    return sorted(dict.fromkeys(roots), key=lambda item: _version_key(item.name), reverse=True)[:64]


def read_registration(root: Path) -> Registration | None:
    try:
        version = major_minor(root.name)
        data = json.loads((root / "packages" / "fxhoudinimcp.json").read_text(encoding="utf-8-sig"))
        if not version or not isinstance(data, dict) or not isinstance(data.get("env"), list):
            return None
        for entry in data["env"]:
            target = entry.get("FXHOUDINIMCP") if isinstance(entry, dict) else None
            if isinstance(target, dict):
                target = target.get("value")
            if not isinstance(target, str):
                continue
            host = Path(target).expanduser().resolve(strict=True)
            if host.name != "houdini" or host.parent.name != "fxhoudinimcp":
                continue
            package_dir = host.parent.parent
            if package_valid(package_dir):
                return Registration(root.resolve(), package_dir, version)
    except (OSError, ValueError):
        pass
    return None


def local_registrations(env: dict[str, str]) -> list[Registration]:
    return [registration for root in preference_roots(env) if (registration := read_registration(root))]


def _version_key(value: str) -> tuple[int, ...]:
    return tuple(int(part) for part in re.findall(r"\d+", value))


def windows_installations() -> list[tuple[Path, str]]:
    import winreg
    found: list[tuple[Path, str]] = []
    for hive, root in [
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\Side Effects Software"),
        (winreg.HKEY_CURRENT_USER, r"SOFTWARE\Side Effects Software"),
        (winreg.HKEY_LOCAL_MACHINE, r"SOFTWARE\WOW6432Node\Side Effects Software"),
    ]:
        try:
            with winreg.OpenKey(hive, root) as parent:
                for index in range(winreg.QueryInfoKey(parent)[0]):
                    name = winreg.EnumKey(parent, index)
                    if not major_minor(name):
                        continue
                    try:
                        with winreg.OpenKey(parent, name) as key:
                            value = winreg.QueryValueEx(key, "InstallPath")[0]
                        if isinstance(value, str):
                            found.append((Path(value), name))
                    except OSError:
                        continue
        except OSError:
            continue
    return found


def find_installation(version: str, env: dict[str, str], platform: str | None = None) -> Installation | None:
    platform = platform or sys.platform
    candidates = windows_installations() if platform == "win32" else []
    standard = []
    if platform == "win32":
        standard = [Path(_env_value(env, "ProgramFiles") or r"C:\Program Files") / "Side Effects Software"]
    elif platform == "darwin":
        standard = [Path("/Applications/Houdini")]
    else:
        standard = [Path("/opt")]
    for parent in standard:
        try:
            candidates.extend((item, item.name) for item in parent.iterdir() if item.is_dir() and major_minor(item.name))
        except OSError:
            continue
    hfs = _env_value(env, "HFS")
    if hfs:
        candidates.append((Path(hfs), Path(hfs).name))
    explicit = _env_value(env, "HOUDINI_EXECUTABLE")
    from_path = shutil.which("houdini.exe" if platform == "win32" else "houdini", path=_env_value(env, "PATH"))
    for value in [explicit, from_path]:
        if not value:
            continue
        file = Path(value)
        root = file.parent.parent
        known = next((label for directory, label in candidates if directory.resolve() == root.resolve()), root.name)
        if file.is_absolute() and file.name.lower() in HOST_NAMES and file.is_file() and major_minor(known) == version:
            return Installation(file.resolve(), version)
    for root, label in sorted(candidates, key=lambda item: _version_key(item[1]), reverse=True):
        if major_minor(label) != version:
            continue
        executable = root / "bin" / ("houdini.exe" if platform == "win32" else "houdini")
        if executable.is_absolute() and executable.is_file():
            return Installation(executable.resolve(), version)
    return None


def running_houdini(platform: str | None = None) -> list[int]:
    platform = platform or sys.platform
    if platform != "win32":
        result = subprocess.run(["ps", "-axo", "pid=,comm="], capture_output=True, text=True, timeout=3, check=True)
        return [int(parts[0]) for line in result.stdout.splitlines() if len(parts := line.strip().split(None, 1)) == 2 and Path(parts[1]).name.lower() in HOST_NAMES]
    from ctypes import wintypes

    class ProcessEntry(ctypes.Structure):
        _fields_ = [
            ("dwSize", wintypes.DWORD), ("cntUsage", wintypes.DWORD), ("th32ProcessID", wintypes.DWORD),
            ("th32DefaultHeapID", ctypes.c_size_t), ("th32ModuleID", wintypes.DWORD), ("cntThreads", wintypes.DWORD),
            ("th32ParentProcessID", wintypes.DWORD), ("pcPriClassBase", wintypes.LONG), ("dwFlags", wintypes.DWORD),
            ("szExeFile", wintypes.WCHAR * 260),
        ]

    kernel = ctypes.WinDLL("kernel32", use_last_error=True)
    kernel.CreateToolhelp32Snapshot.argtypes = [wintypes.DWORD, wintypes.DWORD]
    kernel.CreateToolhelp32Snapshot.restype = wintypes.HANDLE
    kernel.Process32FirstW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.Process32NextW.argtypes = [wintypes.HANDLE, ctypes.POINTER(ProcessEntry)]
    kernel.CloseHandle.argtypes = [wintypes.HANDLE]
    snapshot = kernel.CreateToolhelp32Snapshot(2, 0)
    if snapshot == ctypes.c_void_p(-1).value:
        raise ctypes.WinError(ctypes.get_last_error())
    found = []
    try:
        entry = ProcessEntry()
        entry.dwSize = ctypes.sizeof(entry)
        success = kernel.Process32FirstW(snapshot, ctypes.byref(entry))
        if not success and ctypes.get_last_error() != 18:
            raise ctypes.WinError(ctypes.get_last_error())
        while success:
            if entry.szExeFile.lower() in HOST_NAMES:
                found.append(int(entry.th32ProcessID))
            success = kernel.Process32NextW(snapshot, ctypes.byref(entry))
        if ctypes.get_last_error() not in {0, 18}:
            raise ctypes.WinError(ctypes.get_last_error())
    finally:
        kernel.CloseHandle(snapshot)
    return found


def host_environment(env: dict[str, str], installation: Installation, registration: Registration) -> dict[str, str]:
    clean = {key: value for key, value in env.items() if not key.upper().startswith("PYTHON")}
    # Keep the GUI on its bundled Python, not the external MCP Python runtime.
    for key in list(clean):
        if key.upper() in {"HFS", "HOUDINI_USER_PREF_DIR", "FXHOUDINIMCP", "FXHOUDINIMCP_AUTOSTART"}:
            del clean[key]
    clean.update({
        "HFS": str(installation.executable.parent.parent),
        "HOUDINI_USER_PREF_DIR": str(registration.config_root),
        "FXHOUDINIMCP": str(registration.package_dir / "fxhoudinimcp" / "houdini"),
        "FXHOUDINIMCP_AUTOSTART": "1",
    })
    return clean


class Runtime:
    def __init__(self, env: dict[str, str] | None = None):
        self.env = dict(os.environ if env is None else env)

    now = staticmethod(time.monotonic)
    sleep = staticmethod(time.sleep)
    probe = staticmethod(probe_bridges)
    processes = staticmethod(running_houdini)

    def registrations(self) -> list[Registration]:
        return local_registrations(self.env)

    def installation(self, version: str) -> Installation | None:
        return find_installation(version, self.env)

    def prepare(self, url: str, action: str, timeout: float) -> dict[str, Any]:
        origin = loopback_base(url)
        headers = gateway_headers(self.env, origin)
        try:
            result = request_json(
                origin + "/api/connectors/prepare",
                json.dumps({"connectorId": "houdini", "action": action}).encode("utf-8"),
                "application/json", timeout, headers,
            )
        except urllib.error.HTTPError as error:
            if error.code in {401, 403, 409, 428}:
                raise GatewayScopeError("gateway_scope_rejected", error.code) from None
            raise
        if not isinstance(result, dict) or result.get("connectorId") != "houdini" or type(result.get("ok")) is not bool or result.get("state") not in {"not_installed", "installing", "installed", "failed"}:
            raise ValueError("invalid managed connector response")
        return result

    def launch(self, installation: Installation, registration: Registration) -> int:
        options: dict[str, Any] = {
            "cwd": str(installation.executable.parent),
            "env": host_environment(self.env, installation, registration),
            "stdin": subprocess.DEVNULL, "stdout": subprocess.DEVNULL, "stderr": subprocess.DEVNULL,
        }
        if sys.platform == "win32":
            options["creationflags"] = subprocess.DETACHED_PROCESS | subprocess.CREATE_NEW_PROCESS_GROUP
        else:
            options["start_new_session"] = True
        child = subprocess.Popen([str(installation.executable)], **options)
        # The host is user-owned after launch. No wait/terminate/kill on timeout.
        return child.pid


def _result(state: str, message: str, **details: Any) -> dict[str, Any]:
    return {"ok": state == "bridge_ready", "state": state, "message": message, "host_control_verified": False, "launched": False, "reused": False, **details}


def _ready(bridges: list[dict[str, Any]]) -> dict[str, Any]:
    return _result("bridge_ready", "Houdini bridge is ready; verify scene control through the MCP tools.", **bridges[0], sessions=bridges, reused=True)


def _select_bridge(bridges: list[dict[str, Any]], pid: int | None = None, version: str | None = None) -> dict[str, Any] | None:
    sessions = [entry for entry in bridges if pid is None or entry["pid"] == pid]
    selected = [entry for entry in sessions if version is None or major_minor(entry["version"]) == version]
    if not selected:
        if pid is not None and sessions and version is not None:
            return _result("session_version_mismatch", "The requested Houdini process runs a different version; no replacement session was opened.", requested_pid=pid, requested_version=version, sessions=sessions)
        return None
    if len({entry["pid"] for entry in selected}) > 1:
        return _result("session_selection_required", "Multiple Houdini bridges are ready. Select the intended session with --pid before using scene tools.", sessions=selected)
    return _ready(selected)


def ensure_houdini(gateway_url: str | None = None, *, status_only: bool = False, timeout: float = 90, pid: int | None = None, version: str | None = None, runtime: Runtime | None = None) -> dict[str, Any]:
    if version is not None and not re.fullmatch(r"\d+\.\d+", version):
        return _result("invalid_version", "The requested version must use major.minor format, for example 21.0.", requested_version=version)
    runtime = runtime or Runtime()
    gateway_url = gateway_url if gateway_url is not None else default_gateway_url(runtime.env)
    deadline = runtime.now() + max(1.0, timeout)

    def remaining() -> float:
        return max(0.05, deadline - runtime.now())

    bridges = runtime.probe(min(0.75, remaining()))
    selected = _select_bridge(bridges, pid, version)
    if selected:
        return selected
    if pid is not None:
        if status_only:
            return _result("session_not_found", "The requested Houdini process has no ready bridge.", requested_pid=pid)
        try:
            if pid not in runtime.processes():
                return _result("session_not_found", "The requested Houdini process is not running; no new session was opened.", requested_pid=pid)
            until = min(deadline, runtime.now() + 15)
            while runtime.now() < until:
                selected = _select_bridge(runtime.probe(min(0.75, max(0.05, until - runtime.now()))), pid, version)
                if selected:
                    return selected
                if runtime.now() < until:
                    runtime.sleep(min(0.5, until - runtime.now()))
            return _result("restart_required", "The requested Houdini process has no bridge. Its current scene was preserved; restart is required to load the installed package.", requested_pid=pid)
        except (OSError, ValueError, subprocess.SubprocessError):
            return _result("host_start_failed", "The requested Houdini process could not be safely inspected; no new session was opened.", requested_pid=pid)
    if not gateway_url and any((_env_value(runtime.env, key) or "").strip() for key in WORKSPACE_HEADERS):
        return _result("gateway_scope_rejected", "The current workspace has no usable gateway URL. Refresh the Design workspace before retrying; no fallback installation or host startup was attempted.", code="workspace_gateway_missing")
    registrations = runtime.registrations()
    eligible = [entry for entry in registrations if version is None or entry.version == version]
    managed: dict[str, Any] | None = None
    gateway_available = False
    if gateway_url:
        try:
            gateway_url = loopback_base(gateway_url)
        except ValueError:
            return _result("invalid_gateway_url", "Only a loopback HTTP gateway URL is accepted.")
        try:
            managed = runtime.prepare(gateway_url, "status", min(5, remaining()))
            gateway_available = True
        except GatewayScopeError as error:
            return _result("gateway_scope_rejected", "The Design workspace gateway identity is missing, stale, or rejected. Refresh the current workspace before retrying; no fallback installation or host startup was attempted.", code=error.code, http_status=error.http_status)
        except (OSError, ValueError, urllib.error.URLError):
            pass
    if status_only:
        return _result("bridge_unavailable", "Houdini bridge is not ready; status mode made no changes.", package_available=bool(eligible), gateway_available=gateway_available, **({"requested_version": version} if version is not None else {}))

    if managed is not None:
        if managed.get("state") == "installing":
            return _result("connector_install_pending", "Connector installation is already running; check status before retrying.")
        package = Path(managed["packageDir"]) if isinstance(managed.get("packageDir"), str) else None
        matching = [entry for entry in eligible if package is not None and entry.package_dir.resolve() == package.resolve()]
        if managed.get("state") != "installed" or not package or not package_valid(package) or not matching:
            try:
                installed = runtime.prepare(gateway_url, "install", remaining())
            except GatewayScopeError as error:
                return _result("gateway_scope_rejected", "The Design workspace gateway rejected this request. Refresh the current workspace before retrying; no fallback request or host startup was attempted.", code=error.code, http_status=error.http_status)
            except (OSError, ValueError, urllib.error.URLError):
                return _result("connector_install_pending", "The installer response was interrupted; check connector status before retrying.")
            if installed.get("ok") is not True or installed.get("state") != "installed":
                return _result("connector_install_failed", "Managed connector repair did not complete.", code=installed.get("code", "unknown"))
            package = Path(installed["packageDir"]) if isinstance(installed.get("packageDir"), str) else None
            registrations = runtime.registrations()
            matching = [entry for entry in registrations if package is not None and entry.package_dir.resolve() == package.resolve() and (version is None or entry.version == version)]
        eligible = matching
    if not eligible:
        if version is not None:
            return _result("version_not_found", "No valid managed package registration for the requested Houdini version was found; no different version was opened.", requested_version=version, available_versions=sorted({entry.version for entry in registrations}, key=_version_key, reverse=True))
        return _result("connector_setup_required", "No valid managed Houdini package registration was found. Retry the Design connector installation.")
    if runtime.now() >= deadline:
        return _result("timeout", "Preparation deadline elapsed; existing applications were left running.")

    def wait_for_bridge(duration: float, failure: str, target_pid: int | None = None) -> dict[str, Any]:
        until = min(deadline, runtime.now() + duration)
        while runtime.now() < until:
            found = runtime.probe(min(0.75, max(0.05, until - runtime.now())))
            selected = _select_bridge(found, target_pid, version)
            if selected:
                return selected
            if runtime.now() < until:
                runtime.sleep(min(0.5, until - runtime.now()))
        message = "Houdini is already running without the bridge. Its current scene was preserved; a restart is required to load the installed startup package." if failure == "restart_required" else "Houdini did not expose its bridge before the deadline. The application remains running; check for a license or startup dialog."
        return _result(failure, message)

    try:
        if runtime.processes():
            return wait_for_bridge(15, "restart_required")
        choices = [(entry, host) for entry in eligible if (host := runtime.installation(entry.version)) is not None]
        explicit = _env_value(runtime.env, "HOUDINI_EXECUTABLE")
        if explicit:
            choices.sort(key=lambda pair: pair[1].executable.resolve() != Path(explicit).resolve())
        if not choices:
            return _result("host_not_found", "No verified Houdini executable matching an installed preferences version was found.", versions=[entry.version for entry in eligible])
        registration, installation = choices[0]
        # A launch by the user during discovery must not create a second scene.
        if runtime.processes():
            return wait_for_bridge(15, "restart_required")
        if runtime.now() >= deadline:
            return _result("timeout", "Preparation deadline elapsed before starting Houdini.")
        pid = runtime.launch(installation, registration)
        result = wait_for_bridge(remaining(), "host_start_timeout", pid)
        result["launched_pid"] = pid
        result["launched"] = True
        result["reused"] = False
        return result
    except (OSError, ValueError, subprocess.SubprocessError):
        return _result("host_start_failed", "Houdini could not be safely discovered or started; existing applications were left unchanged.")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gateway-url", help="Local Design gateway; defaults to workspace GATEWAY_URL, then app HILO_GATEWAY_URL")
    parser.add_argument("--status", action="store_true", help="Read-only probes; never install or start applications")
    parser.add_argument("--timeout", type=float, default=90, help="Total preparation deadline in seconds, 1–600; default 90")
    parser.add_argument("--pid", type=int, help="Select an existing Houdini process; never opens a replacement session")
    parser.add_argument("--version", help="Select a Houdini major.minor version, for example 21.0; never falls back to another version")
    parser.add_argument("--json", action="store_true", help="Compatibility flag; stdout always contains one JSON result")
    args = parser.parse_args(argv)
    if not 1 <= args.timeout <= 600:
        parser.error("--timeout must be between 1 and 600 seconds")
    if args.pid is not None and args.pid <= 0:
        parser.error("--pid must be positive")
    if args.version is not None and not re.fullmatch(r"\d+\.\d+", args.version):
        parser.error("--version must use major.minor format, for example 21.0")
    result = ensure_houdini(args.gateway_url, status_only=args.status, timeout=args.timeout, pid=args.pid, version=args.version)
    print(json.dumps(result, ensure_ascii=False))
    return 0 if result["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
