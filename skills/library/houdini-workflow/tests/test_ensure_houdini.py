"""Offline standard-library regressions. No Houdini or Design process is started."""

import json
import io
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import os
from pathlib import Path
import tempfile
import threading
import unittest
from unittest import mock
import urllib.error
import urllib.parse

import sys
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import ensure_houdini as helper


HEALTH = {"port": 8103, "pid": 1234, "version": "21.0.440"}
WORKSPACE_ENV = {
    "HILO_WORKSPACE_CLAIM": "fixture-workspace-claim",
    "HILO_WORKSPACE_INSTANCE_ID": "fixture-workspace-instance",
    "HILO_WORKSPACE_GENERATION": "3",
}


def write_package(directory):
    module = directory / "fxhoudinimcp"
    for relative in [
        "server.py", "__main__.py", "houdini/python3.11libs/uiready.py",
        "houdini/scripts/python/fxhoudinimcp_server/startup.py",
    ]:
        target = module / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_text("# fixture\n", encoding="utf-8")


class FakeRuntime(helper.Runtime):
    def __init__(self, registration, installation):
        super().__init__({})
        self.registration = registration
        self.host = installation
        self.clock = 0.0
        self.bridges = []
        self.prepare_calls = []
        self.process_calls = 0
        self.process_snapshots = [[]]
        self.launches = []
        self.installed = True
        self.gateway_error = False
        self.install_error = False
        self.on_install = None
        self.on_launch = None

    def now(self): return self.clock
    def sleep(self, delay): self.clock += delay
    def probe(self, timeout=0.75, expected_version=None):
        return self.bridges.pop(0) if self.bridges else []
    def registrations(self): return [self.registration] if self.registration else []
    def processes(self):
        self.process_calls += 1
        return self.process_snapshots.pop(0) if len(self.process_snapshots) > 1 else self.process_snapshots[0]
    def installation(self, version): return self.host if self.host and self.host.version == version else None
    def prepare(self, url, action, timeout):
        self.prepare_calls.append(action)
        if self.gateway_error: raise urllib.error.URLError("fixture unavailable")
        if action == "install":
            if self.install_error:
                return {"ok": False, "connectorId": "houdini", "state": "failed", "code": "connector_runtime_failed"}
            if self.on_install: self.on_install()
            self.installed = True
        result = {"ok": True, "connectorId": "houdini", "state": "installed" if self.installed else "not_installed"}
        if self.registration: result["packageDir"] = str(self.registration.package_dir)
        return result
    def launch(self, installation, registration):
        self.launches.append((installation, registration))
        if self.on_launch: self.on_launch()
        return 1234


class EnsureTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.package = self.root / "managed-package"
        write_package(self.package)
        self.preferences = self.root / "houdini21.0"
        (self.preferences / "packages").mkdir(parents=True)
        (self.preferences / "packages" / "fxhoudinimcp.json").write_text(json.dumps({
            "env": [{"FXHOUDINIMCP": str(self.package / "fxhoudinimcp" / "houdini")}],
            "path": "$FXHOUDINIMCP",
        }), encoding="utf-8")
        self.registration = helper.read_registration(self.preferences)
        self.assertIsNotNone(self.registration)
        self.executable = self.root / "Houdini 21.0.440" / "bin" / "houdini.exe"
        self.executable.parent.mkdir(parents=True)
        self.executable.write_bytes(b"fixture")
        self.host = helper.Installation(self.executable, "21.0")
        self.runtime = FakeRuntime(self.registration, self.host)

    def ensure(self, **kwargs):
        return helper.ensure_houdini("http://127.0.0.1:8123", runtime=self.runtime, **kwargs)

    def test_existing_bridge_returns_without_install_or_process_checks(self):
        self.runtime.bridges = [[HEALTH]]
        result = self.ensure()
        self.assertEqual(result["state"], "bridge_ready")
        self.assertEqual((result["port"], result["pid"]), (8103, 1234))
        self.assertTrue(result["reused"])
        self.assertFalse(result["launched"])
        self.assertFalse(result["host_control_verified"])
        self.assertEqual(self.runtime.prepare_calls, [])
        self.assertEqual(self.runtime.process_calls, 0)
        self.assertEqual(self.runtime.launches, [])

    def test_multiple_bridges_require_session_selection_before_any_mutation(self):
        other = {"port": 8104, "pid": 5678, "version": "21.0.440"}
        self.runtime.bridges = [[HEALTH, other]]
        result = self.ensure()
        self.assertEqual(result["state"], "session_selection_required")
        self.assertEqual(result["sessions"], [HEALTH, other])
        self.assertFalse(self.runtime.prepare_calls)
        self.assertFalse(self.runtime.launches)

    def test_pid_selects_the_requested_existing_bridge(self):
        other = {"port": 8104, "pid": 5678, "version": "21.0.440"}
        self.runtime.bridges = [[HEALTH, other]]
        result = self.ensure(pid=5678)
        self.assertTrue(result["ok"])
        self.assertEqual(result["pid"], 5678)
        self.assertEqual(result["port"], 8104)
        self.assertFalse(self.runtime.launches)

    def test_missing_pid_never_opens_a_replacement_session(self):
        self.runtime.bridges = [[HEALTH]]
        result = self.ensure(pid=5678)
        self.assertEqual(result["state"], "session_not_found")
        self.assertFalse(self.runtime.prepare_calls)
        self.assertFalse(self.runtime.launches)

    def test_version_filters_existing_bridges_before_session_selection(self):
        other = {"port": 8104, "pid": 5678, "version": "20.5.100"}
        self.runtime.bridges = [[HEALTH, other]]
        result = self.ensure(version="20.5")
        self.assertTrue(result["ok"])
        self.assertEqual(result["pid"], 5678)
        self.assertEqual(result["version"], "20.5.100")
        self.assertFalse(self.runtime.prepare_calls)
        self.assertFalse(self.runtime.launches)

    def test_pid_version_mismatch_does_not_reuse_another_session(self):
        other = {"port": 8104, "pid": 5678, "version": "20.5.100"}
        self.runtime.bridges = [[HEALTH, other]]
        result = self.ensure(pid=1234, version="20.5")
        self.assertEqual(result["state"], "session_version_mismatch")
        self.assertEqual(result["requested_pid"], 1234)
        self.assertEqual(result["requested_version"], "20.5")
        self.assertFalse(self.runtime.prepare_calls)
        self.assertFalse(self.runtime.launches)

    def test_pending_pid_cannot_become_ready_with_the_wrong_version(self):
        self.runtime.bridges = [[], [HEALTH]]
        self.runtime.process_snapshots = [[1234]]
        result = self.ensure(pid=1234, version="20.5")
        self.assertEqual(result["state"], "session_version_mismatch")
        self.assertFalse(self.runtime.launches)

    def test_missing_version_never_falls_back_to_a_healthy_or_registered_version(self):
        self.runtime.bridges = [[HEALTH]]
        self.runtime.gateway_error = True
        result = self.ensure(version="20.5")
        self.assertEqual(result["state"], "version_not_found")
        self.assertEqual(result["requested_version"], "20.5")
        self.assertEqual(result["available_versions"], ["21.0"])
        self.assertFalse(self.runtime.launches)

    def test_install_repair_cannot_bypass_the_requested_version(self):
        result = self.ensure(version="20.5")
        self.assertEqual(result["state"], "version_not_found")
        self.assertEqual(self.runtime.prepare_calls, ["status", "install"])
        self.assertFalse(self.runtime.launches)

    def test_invalid_version_is_rejected_before_probing_or_preparation(self):
        for value in ["21", "21.0.440", "houdini21.0"]:
            result = self.ensure(version=value)
            self.assertEqual(result["state"], "invalid_version")
        self.assertFalse(self.runtime.prepare_calls)
        self.assertFalse(self.runtime.launches)
        self.assertEqual(self.runtime.process_calls, 0)

    def test_cold_start_reuses_managed_package_and_waits_for_http_health(self):
        self.runtime.on_launch = lambda: self.runtime.bridges.extend([[], [HEALTH]])
        result = self.ensure()
        self.assertEqual(result["state"], "bridge_ready")
        self.assertTrue(result["launched"])
        self.assertFalse(result["reused"])
        self.assertEqual(result["launched_pid"], 1234)
        self.assertEqual(self.runtime.prepare_calls, ["status"])
        self.assertEqual(len(self.runtime.launches), 1)

    def test_missing_managed_install_uses_existing_install_endpoint(self):
        self.runtime.installed = False
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        result = self.ensure()
        self.assertTrue(result["ok"])
        self.assertEqual(self.runtime.prepare_calls, ["status", "install"])

    def test_missing_startup_script_repairs_before_launch(self):
        startup = self.package / "fxhoudinimcp/houdini/python3.11libs/uiready.py"
        startup.unlink()
        self.runtime.on_install = lambda: write_package(self.package)
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        result = self.ensure()
        self.assertTrue(result["ok"])
        self.assertEqual(self.runtime.prepare_calls, ["status", "install"])
        self.assertTrue(startup.is_file())

    def test_installer_failure_does_not_launch_host(self):
        self.runtime.installed = False
        self.runtime.install_error = True
        result = self.ensure()
        self.assertEqual(result["state"], "connector_install_failed")
        self.assertEqual(result["code"], "connector_runtime_failed")
        self.assertFalse(self.runtime.launches)

    def test_gateway_offline_uses_valid_local_registration(self):
        self.runtime.gateway_error = True
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        self.assertTrue(self.ensure()["ok"])
        self.assertEqual(self.runtime.prepare_calls, ["status"])
        self.assertEqual(len(self.runtime.launches), 1)

    def test_default_gateway_prefers_workspace_and_only_uses_app_when_absent(self):
        self.assertEqual(helper.default_gateway_url({"GATEWAY_URL": " http://127.0.0.1:8123 ", "HILO_GATEWAY_URL": "http://127.0.0.1:8001"}), "http://127.0.0.1:8123")
        self.assertEqual(helper.default_gateway_url({"HILO_GATEWAY_URL": "http://127.0.0.1:8001"}), "http://127.0.0.1:8001")

    def test_workspace_scope_rejection_does_not_fall_back_to_local_launch(self):
        for code in [401, 403, 409, 428]:
            self.runtime.prepare = mock.Mock(side_effect=helper.GatewayScopeError("gateway_scope_rejected", code))
            result = self.ensure()
            self.assertEqual(result["state"], "gateway_scope_rejected")
            self.assertEqual(result["http_status"], code)
            self.runtime.prepare.assert_called_once()
            self.assertFalse(self.runtime.launches)

    def test_scope_rejection_during_install_does_not_start_host(self):
        self.runtime.prepare = mock.Mock(side_effect=[{"ok": True, "state": "not_installed"}, helper.GatewayScopeError("gateway_scope_rejected", 409)])
        result = self.ensure()
        self.assertEqual(result["state"], "gateway_scope_rejected")
        self.assertFalse(self.runtime.launches)

    def test_scoped_context_without_any_gateway_never_falls_back_to_local_launch(self):
        self.runtime.env.update(WORKSPACE_ENV)
        result = helper.ensure_houdini(runtime=self.runtime)
        self.assertEqual(result["state"], "gateway_scope_rejected")
        self.assertEqual(result["code"], "workspace_gateway_missing")
        self.assertFalse(self.runtime.launches)

    def test_gateway_offline_without_registration_reports_setup_required(self):
        self.runtime.gateway_error = True
        self.runtime.registration = None
        result = self.ensure()
        self.assertEqual(result["state"], "connector_setup_required")
        self.assertFalse(self.runtime.launches)

    def test_existing_host_without_bridge_requires_restart_and_preserves_scene(self):
        self.runtime.process_snapshots = [[456]]
        result = self.ensure(timeout=30)
        self.assertEqual(result["state"], "restart_required")
        self.assertEqual(self.runtime.clock, 15)
        self.assertFalse(self.runtime.launches)

    def test_existing_host_finishing_startup_is_reused(self):
        self.runtime.process_snapshots = [[456]]
        self.runtime.bridges = [[], [], [HEALTH]]
        result = self.ensure()
        self.assertTrue(result["ok"])
        self.assertTrue(result["reused"])
        self.assertFalse(self.runtime.launches)

    def test_user_launch_during_discovery_does_not_start_a_second_instance(self):
        self.runtime.process_snapshots = [[], [456]]
        result = self.ensure(timeout=2)
        self.assertEqual(result["state"], "restart_required")
        self.assertFalse(self.runtime.launches)

    def test_timeout_leaves_spawned_host_running(self):
        result = self.ensure(timeout=2)
        self.assertEqual(result["state"], "host_start_timeout")
        self.assertEqual(result["launched_pid"], 1234)
        self.assertTrue(result["launched"])
        self.assertLessEqual(self.runtime.clock, 2)
        self.assertEqual(len(self.runtime.launches), 1)

    def test_new_launch_does_not_accept_a_concurrent_users_bridge(self):
        other = {"port": 8100, "pid": 5678, "version": "21.0.440"}
        self.runtime.on_launch = lambda: self.runtime.bridges.extend([[other]] * 10)
        result = self.ensure(timeout=2)
        self.assertEqual(result["state"], "host_start_timeout")
        self.assertFalse(result["ok"])
        self.assertEqual(result["launched_pid"], 1234)

    def test_launched_pid_with_wrong_version_is_not_ready(self):
        wrong = {"port": 8103, "pid": 1234, "version": "20.5.100"}
        self.runtime.on_launch = lambda: self.runtime.bridges.append([wrong])
        result = self.ensure(version="21.0")
        self.assertEqual(result["state"], "session_version_mismatch")
        self.assertFalse(result["ok"])
        self.assertTrue(result["launched"])
        self.assertEqual(result["launched_pid"], 1234)

    def test_status_is_read_only_even_if_package_missing(self):
        self.runtime.installed = False
        result = self.ensure(status_only=True)
        self.assertEqual(result["state"], "bridge_unavailable")
        self.assertEqual(self.runtime.prepare_calls, ["status"])
        self.assertFalse(self.runtime.launches)
        self.assertEqual(self.runtime.process_calls, 0)

    def test_status_reports_availability_for_requested_version_only(self):
        self.runtime.bridges = [[HEALTH]]
        result = self.ensure(status_only=True, version="20.5")
        self.assertEqual(result["state"], "bridge_unavailable")
        self.assertFalse(result["package_available"])
        self.assertEqual(result["requested_version"], "20.5")
        self.assertEqual(self.runtime.prepare_calls, ["status"])
        self.assertFalse(self.runtime.launches)

    def test_non_loopback_gateway_is_rejected(self):
        for url in ["https://127.0.0.1", "http://example.com", "http://user:secret@localhost", "http://localhost/path"]:
            result = helper.ensure_houdini(url, runtime=self.runtime)
            self.assertEqual(result["state"], "invalid_gateway_url")
        self.assertFalse(self.runtime.prepare_calls)

    def test_native_host_environment_does_not_inherit_external_python(self):
        source = {"PYTHONHOME": "broken", "PythonPath": "wrong-3.12", "PYTHONUSERBASE": "foreign", "PATH": "native-path", "FXHOUDINIMCP_AUTOSTART": "0"}
        original = dict(source)
        env = helper.host_environment(source, self.host, self.registration)
        self.assertFalse(any(key.upper().startswith("PYTHON") for key in env))
        self.assertEqual(env["PATH"], "native-path")
        self.assertEqual(env["FXHOUDINIMCP_AUTOSTART"], "1")
        self.assertEqual(Path(env["HOUDINI_USER_PREF_DIR"]).resolve(), self.preferences.resolve())
        self.assertEqual(Path(env["FXHOUDINIMCP"]).resolve(), (self.package / "fxhoudinimcp/houdini").resolve())
        self.assertEqual(source, original)

    def test_registry_version_selection_uses_matching_major_minor(self):
        later = self.root / "Houdini 22.0.100" / "bin" / "houdini.exe"
        later.parent.mkdir(parents=True)
        later.write_bytes(b"fixture")
        with mock.patch.object(helper, "windows_installations", return_value=[(later.parent.parent, "Houdini 22.0.100"), (self.executable.parent.parent, "Houdini 21.0.440")]), mock.patch.object(helper.shutil, "which", return_value=None):
            chosen = helper.find_installation("21.0", {"ProgramFiles": str(self.root / "missing")}, "win32")
            self.assertEqual(chosen.executable, self.executable.resolve())
            self.assertIsNone(helper.find_installation("20.5", {"ProgramFiles": str(self.root / "missing")}, "win32"))

    def test_lower_registered_version_is_used_when_highest_has_no_executable(self):
        higher = helper.Registration(self.root / "houdini22.0", self.package, "22.0")
        self.runtime.registrations = lambda: [higher, self.registration]
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        self.assertTrue(self.ensure()["ok"])
        self.assertEqual(self.runtime.launches[0][1], self.registration)

    def test_requested_version_selects_its_registration_and_executable(self):
        higher = helper.Registration(self.root / "houdini22.0", self.package, "22.0")
        higher_host = helper.Installation(self.root / "Houdini 22.0.100/bin/houdini.exe", "22.0")
        self.runtime.registrations = lambda: [higher, self.registration]
        self.runtime.installation = lambda version: {"21.0": self.host, "22.0": higher_host}.get(version)
        self.runtime.env["HOUDINI_EXECUTABLE"] = str(higher_host.executable)
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        self.assertTrue(self.ensure(version="21.0")["ok"])
        self.assertEqual(self.runtime.launches[0], (self.host, self.registration))

    def test_missing_executable_for_requested_version_does_not_use_another_version(self):
        higher = helper.Registration(self.root / "houdini22.0", self.package, "22.0")
        self.runtime.registrations = lambda: [higher, self.registration]
        result = self.ensure(version="22.0")
        self.assertEqual(result["state"], "host_not_found")
        self.assertEqual(result["versions"], ["22.0"])
        self.assertFalse(self.runtime.launches)

    def test_explicit_executable_selects_its_registration_over_the_highest_version(self):
        higher = helper.Registration(self.root / "houdini22.0", self.package, "22.0")
        higher_host = helper.Installation(self.root / "Houdini 22.0.100/bin/houdini.exe", "22.0")
        self.runtime.registrations = lambda: [higher, self.registration]
        self.runtime.installation = lambda version: {"21.0": self.host, "22.0": higher_host}.get(version)
        self.runtime.env["HOUDINI_EXECUTABLE"] = str(self.executable)
        self.runtime.on_launch = lambda: self.runtime.bridges.append([HEALTH])
        self.assertTrue(self.ensure()["ok"])
        self.assertEqual(self.runtime.launches[0][0], self.host)
        self.assertEqual(self.runtime.launches[0][1], self.registration)

    def test_default_cli_emits_json_and_uses_a_90_second_deadline(self):
        with mock.patch.object(helper, "ensure_houdini", return_value=helper._ready([HEALTH])) as ensure, mock.patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(helper.main([]), 0)
        self.assertEqual(json.loads(output.getvalue())["state"], "bridge_ready")
        self.assertEqual(ensure.call_args.kwargs["timeout"], 90)

    def test_cli_passes_version_and_pid_to_preparation(self):
        with mock.patch.object(helper, "ensure_houdini", return_value=helper._ready([HEALTH])) as ensure, mock.patch("sys.stdout", new_callable=io.StringIO):
            self.assertEqual(helper.main(["--version", "21.0", "--pid", "1234"]), 0)
        self.assertEqual(ensure.call_args.kwargs["version"], "21.0")
        self.assertEqual(ensure.call_args.kwargs["pid"], 1234)

    def test_corrupt_registration_is_not_an_offline_fallback(self):
        (self.preferences / "packages/fxhoudinimcp.json").write_text('{"env": "bad"}', encoding="utf-8")
        self.assertIsNone(helper.read_registration(self.preferences))

    def test_runtime_launch_is_detached_without_wait_or_termination(self):
        fake_process = mock.Mock(pid=1234)
        with mock.patch.object(helper.subprocess, "Popen", return_value=fake_process) as popen:
            pid = helper.Runtime({"PYTHONHOME": "broken"}).launch(self.host, self.registration)
        self.assertEqual(pid, 1234)
        fake_process.wait.assert_not_called()
        fake_process.terminate.assert_not_called()
        fake_process.kill.assert_not_called()
        args, kwargs = popen.call_args
        self.assertEqual(args[0], [str(self.executable)])
        self.assertNotIn("PYTHONHOME", kwargs["env"])
        self.assertEqual(kwargs["stdout"], helper.subprocess.DEVNULL)


class HealthTests(unittest.TestCase):
    def test_local_connector_endpoint_accepts_nest_post_201_response(self):
        calls = []
        received_headers = []

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):
                body = json.loads(self.rfile.read(int(self.headers["Content-Length"])))
                calls.append((self.path, body))
                received_headers.append({header: self.headers.get(header) for header in helper.WORKSPACE_HEADERS.values()})
                response = json.dumps({"ok": True, "connectorId": "houdini", "state": "installed"}).encode()
                self.send_response(201)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(response)))
                self.end_headers()
                self.wfile.write(response)

            def log_message(self, *args):
                pass

        with ThreadingHTTPServer(("127.0.0.1", 0), Handler) as server:
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                url = f"http://127.0.0.1:{server.server_port}"
                runtime = helper.Runtime({"GATEWAY_URL": url, **WORKSPACE_ENV})
                for action in ["status", "install"]:
                    result = runtime.prepare(url, action, 2)
                    self.assertTrue(result["ok"])
                    self.assertEqual(result["state"], "installed")
            finally:
                server.shutdown()
                thread.join(timeout=2)
        self.assertEqual(calls, [("/api/connectors/prepare", {"connectorId": "houdini", "action": action}) for action in ["status", "install"]])
        self.assertEqual(received_headers, [{header: WORKSPACE_ENV[key] for key, header in helper.WORKSPACE_HEADERS.items()}] * 2)

    def test_scope_headers_cannot_be_rerouted_to_app_gateway(self):
        env = {"GATEWAY_URL": "http://127.0.0.1:8123", "HILO_GATEWAY_URL": "http://127.0.0.1:8001", **WORKSPACE_ENV}
        with mock.patch.object(helper, "request_json") as request:
            for changes in [{}, {"GATEWAY_URL": ""}, {"GATEWAY_URL": "http://remote.example"}]:
                with self.assertRaises(helper.GatewayScopeError):
                    helper.Runtime({**env, **changes}).prepare("http://127.0.0.1:8001", "install", 1)
        request.assert_not_called()

    def test_partial_workspace_identity_is_rejected_without_network_access(self):
        with mock.patch.object(helper, "request_json") as request:
            for key in WORKSPACE_ENV:
                env = {"GATEWAY_URL": "http://127.0.0.1:8123", **WORKSPACE_ENV}
                env.pop(key)
                with self.assertRaises(helper.GatewayScopeError):
                    helper.Runtime(env).prepare(env["GATEWAY_URL"], "status", 1)
        request.assert_not_called()

    def test_http_identity_failure_is_preserved_without_response_or_header_values(self):
        for code in [401, 403, 409, 428]:
            error = urllib.error.HTTPError("http://127.0.0.1:8123/api/connectors/prepare", code, "fixture detail must not be reported", {}, None)
            with mock.patch.object(helper, "request_json", side_effect=error):
                with self.assertRaises(helper.GatewayScopeError) as raised:
                    helper.Runtime({"GATEWAY_URL": "http://127.0.0.1:8123", **WORKSPACE_ENV}).prepare("http://127.0.0.1:8123", "status", 1)
            self.assertEqual(raised.exception.http_status, code)
            self.assertEqual(str(raised.exception), "gateway_scope_rejected")

    def test_fake_port_payloads_are_not_readiness(self):
        for payload in [None, {}, {"status": "ok"}, {"status": "ok", "pid": True, "houdini_version": "21.0.440"}, {"status": "ok", "pid": 1, "houdini_version": "unknown"}, {"status": "success", "data": {"status": "ok", "pid": 1, "houdini_version": "21.0.440"}}]:
            self.assertIsNone(helper.valid_health(payload, 8100))
        self.assertIsNone(helper.valid_health({"status": "ok", "pid": 1, "houdini_version": "22.0.1"}, 8100, "21.0"))

    def test_probe_sends_real_hwebserver_rpc_and_discovers_secondary_ports(self):
        calls = []
        def request(url, body, content_type, timeout):
            calls.append((url, body, content_type))
            if url == "http://127.0.0.1:8103/api":
                return {"status": "ok", "pid": 1234, "houdini_version": "21.0.440"}
            raise urllib.error.URLError("refused")
        with mock.patch.object(helper, "request_json", side_effect=request):
            found = helper.probe_bridges()
        self.assertEqual(found, [HEALTH])
        self.assertEqual(len(calls), 16)
        self.assertEqual(json.loads(urllib.parse.parse_qs(calls[0][1].decode())["json"][0]), ["mcp.health", [], {}])
        self.assertEqual(calls[0][2], "application/x-www-form-urlencoded")

    def test_prepare_only_uses_managed_connector_endpoint(self):
        with mock.patch.object(helper, "request_json", return_value={"ok": True, "connectorId": "houdini", "state": "installed"}) as request:
            helper.Runtime({}).prepare("http://localhost:8123", "install", 30)
        args = request.call_args.args
        self.assertEqual(args[0], "http://localhost:8123/api/connectors/prepare")
        self.assertEqual(json.loads(args[1]), {"connectorId": "houdini", "action": "install"})


if __name__ == "__main__":
    unittest.main()
