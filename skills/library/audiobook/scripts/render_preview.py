#!/usr/bin/env python3
"""Launch audiobook voice preview server.

Usage:
  python3 render_preview.py <preview_data.json> [--port PORT]

Workflow:
  1. Read JSON data file (containing voice config and preview audio paths)
  2. Inject into HTML template, start a local HTTP server
  3. Open the preview page in the browser and attempt to focus it
  4. After user submits feedback, write feedback.md + settings.json, server exits automatically
"""

import argparse
import base64
import json
import mimetypes
import platform
import subprocess
import sys
import threading
import time
import webbrowser
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

SKILL_DIR = Path(__file__).resolve().parent.parent
TEMPLATE_DIR = SKILL_DIR / "html"


class PreviewHandler(BaseHTTPRequestHandler):
    html_content: str = ""
    feedback_path: Path = Path("feedback.md")
    settings_path: Path = Path("settings.json")
    server_ref: "HTTPServer | None" = None  # type: ignore[assignment]

    def do_GET(self):
        if self.path.startswith("/audio/"):
            self._serve_audio()
            return
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(self.html_content.encode("utf-8"))

    def _serve_audio(self):
        encoded = self.path[len("/audio/"):]
        try:
            audio_path = Path(base64.urlsafe_b64decode(encoded).decode("utf-8"))
        except Exception:
            self.send_error(400, "invalid audio path")
            return
        if not audio_path.exists():
            self.send_error(404, "audio not found")
            return
        mime = mimetypes.guess_type(str(audio_path))[0] or "audio/mpeg"
        data = audio_path.read_bytes()
        self.send_response(200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(len(data)))
        self.send_header("Cache-Control", "max-age=3600")
        self.end_headers()
        self.wfile.write(data)

    def do_POST(self):
        if self.path == "/feedback":
            self._handle_feedback()
        else:
            self.send_error(404)

    def _handle_feedback(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length).decode("utf-8")
        data = json.loads(body)
        feedback = data.get("feedback", "").strip()
        settings = data.get("settings", {})

        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.end_headers()

        if feedback:
            self.feedback_path.write_text(feedback, encoding="utf-8")
        if settings:
            self.settings_path.write_text(
                json.dumps(settings, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
        self.wfile.write(json.dumps({"ok": True}).encode())
        print(f"FEEDBACK_FILE={self.feedback_path}")
        if settings:
            print(f"SETTINGS_FILE={self.settings_path}")
        threading.Timer(0.5, self._shutdown).start()

    def _shutdown(self):
        if self.server_ref:
            self.server_ref.shutdown()

    def log_message(self, format, *args):
        pass


def to_audio_url(abs_path: str) -> str:
    """Convert an absolute path to a /audio/<base64> URL."""
    encoded = base64.urlsafe_b64encode(abs_path.encode()).decode()
    return f"/audio/{encoded}"


def prepare_data(raw_data: dict) -> dict:
    """Convert candidate voice samplePath fields to accessible /audio/ URLs."""
    if raw_data.get("narrator"):
        for cand in raw_data["narrator"].get("candidates", []):
            if cand.get("samplePath"):
                cand["sampleUrl"] = to_audio_url(cand["samplePath"])

    for char in raw_data.get("characters", []):
        for cand in char.get("candidates", []):
            if cand.get("samplePath"):
                cand["sampleUrl"] = to_audio_url(cand["samplePath"])

    return raw_data


def _focus_browser_cross_platform() -> None:
    """Attempt to bring the browser window to the foreground after opening a URL.

    Behaviour per platform
    ----------------------
    macOS  : AppleScript `tell application X to activate`.
             Requires NO Accessibility permission — `activate` is a standard
             inter-app IPC call.
             On macOS Ventura+ the OS may show a one-time "Automation" consent
             dialog (System Settings → Privacy & Security → Automation) the
             first time this script tries to control a specific browser.
             The user clicks Allow once; afterwards it is completely silent.

    Windows: Windows' Focus Stealing Prevention (introduced in XP) blocks any
             process from forcing SetForegroundWindow unless it already owns
             the foreground.  Instead we use FlashWindowEx to flash the taskbar
             button amber — this draws the user's attention without requiring
             any permissions and works reliably on all Windows versions.
             A true foreground-force would require injecting into the browser
             process, which is not worth the complexity.

    Linux  : Tries `wmctrl` first (works on X11 and XWayland), then falls
             back to `xdotool` (X11 only — does not work on pure Wayland).
             Both are standard distro packages; no special permissions needed.
             If neither tool is installed the function silently does nothing.
             Install hints: `sudo apt install wmctrl`  /  `sudo apt install xdotool`
    """
    time.sleep(1.2)  # give the browser time to finish opening the tab
    system = platform.system()

    # ------------------------------------------------------------------ macOS
    if system == "Darwin":
        script = (
            'set browserList to {"Google Chrome", "Safari", "Firefox",'
            ' "Arc", "Brave Browser", "Microsoft Edge", "Chromium"}\n'
            "repeat with b in browserList\n"
            "    if application b is running then\n"
            "        tell application b to activate\n"
            "        exit repeat\n"
            "    end if\n"
            "end repeat"
        )
        try:
            subprocess.run(["osascript", "-e", script], capture_output=True, timeout=4)
        except Exception:
            pass

    # --------------------------------------------------------------- Windows
    elif system == "Windows":
        try:
            import ctypes
            import ctypes.wintypes

            FLASHW_ALL       = 0x00000003  # flash both title bar and taskbar button
            FLASHW_TIMERNOFG = 0x0000000C  # keep flashing until window comes to foreground

            class FLASHWINFO(ctypes.Structure):
                _fields_ = [
                    ("cbSize",    ctypes.wintypes.UINT),
                    ("hwnd",      ctypes.wintypes.HWND),
                    ("dwFlags",   ctypes.wintypes.DWORD),
                    ("uCount",    ctypes.wintypes.UINT),
                    ("dwTimeout", ctypes.wintypes.DWORD),
                ]

            BROWSER_EXE = {
                "chrome.exe", "firefox.exe", "msedge.exe",
                "brave.exe", "opera.exe", "vivaldi.exe",
            }

            def _enum_cb(hwnd, _):
                if not ctypes.windll.user32.IsWindowVisible(hwnd):  # type: ignore[attr-defined]
                    return True
                pid = ctypes.wintypes.DWORD(0)
                ctypes.windll.user32.GetWindowThreadProcessId(  # type: ignore[attr-defined]
                    hwnd, ctypes.byref(pid)
                )
                try:
                    import subprocess as _sp
                    result = _sp.run(
                        ["powershell", "-NoProfile", "-Command",
                         f"(Get-Process -Id {pid.value}).Name"],
                        capture_output=True, text=True, timeout=2,
                    )
                    name = result.stdout.strip().lower() + ".exe"
                    if name in BROWSER_EXE:
                        fi = FLASHWINFO(
                            cbSize=ctypes.sizeof(FLASHWINFO),
                            hwnd=hwnd,
                            dwFlags=FLASHW_ALL | FLASHW_TIMERNOFG,
                            uCount=5,
                            dwTimeout=0,
                        )
                        ctypes.windll.user32.FlashWindowEx(ctypes.byref(fi))  # type: ignore[attr-defined]
                except Exception:
                    pass
                return True

            EnumWindowsProc = ctypes.WINFUNCTYPE(  # type: ignore[attr-defined]
                ctypes.c_bool, ctypes.wintypes.HWND, ctypes.wintypes.LPARAM
            )
            ctypes.windll.user32.EnumWindows(EnumWindowsProc(_enum_cb), 0)  # type: ignore[attr-defined]
        except Exception:
            pass  # silently ignore on any error

    # ----------------------------------------------------------------- Linux
    elif system == "Linux":
        browser_titles = ["Google Chrome", "Firefox", "Chromium", "Brave", "Microsoft Edge"]

        # Try wmctrl first (works on X11 and XWayland)
        wmctrl_ok = False
        for title in browser_titles:
            try:
                ret = subprocess.run(
                    ["wmctrl", "-a", title], capture_output=True, timeout=2
                )
                if ret.returncode == 0:
                    wmctrl_ok = True
                    break
            except FileNotFoundError:
                break  # wmctrl not installed — fall through to xdotool
            except Exception:
                pass

        if not wmctrl_ok:
            # Fall back to xdotool (X11 only)
            for title in browser_titles:
                try:
                    ret = subprocess.run(
                        ["xdotool", "search", "--name", title,
                         "windowactivate", "--sync"],
                        capture_output=True, timeout=2,
                    )
                    if ret.returncode == 0:
                        break
                except FileNotFoundError:
                    break  # xdotool not installed either — give up silently
                except Exception:
                    pass


def main():
    parser = argparse.ArgumentParser(description="Launch audiobook voice preview server")
    parser.add_argument("data_file", help="Path to JSON data file")
    parser.add_argument("--port", type=int, default=0, help="Port number, default auto-assign")
    parsed = parser.parse_args()

    data_path = Path(parsed.data_file).resolve()
    if not data_path.exists():
        print(f"ERROR: Data file not found: {data_path}")
        sys.exit(1)

    raw_data = json.loads(data_path.read_text(encoding="utf-8"))
    preview_data = prepare_data(raw_data)

    template_path = TEMPLATE_DIR / "preview-voice_setup.html"
    if not template_path.exists():
        print(f"ERROR: Template not found: {template_path}")
        sys.exit(1)

    template = template_path.read_text(encoding="utf-8")
    injected = template.replace(
        "const PREVIEW_TYPE = null;  /* __PREVIEW_TYPE__ */",
        'const PREVIEW_TYPE = "voice_setup";',
    ).replace(
        "const PREVIEW_DATA = null;  /* __PREVIEW_DATA__ */",
        f"const PREVIEW_DATA = {json.dumps(json.dumps(preview_data, ensure_ascii=False))};",
    )

    feedback_dir = data_path.parent
    server = HTTPServer(("127.0.0.1", parsed.port), PreviewHandler)
    port = server.server_address[1]

    PreviewHandler.html_content = injected
    PreviewHandler.feedback_path = feedback_dir / "feedback.md"
    PreviewHandler.settings_path = feedback_dir / "voice_settings.json"
    PreviewHandler.server_ref = server

    url = f"http://127.0.0.1:{port}"
    print(f"PREVIEW_URL={url}")
    print("Waiting for user submission...")

    webbrowser.open(url)
    # Attempt to bring the browser to foreground in a background thread
    # so the server starts immediately without waiting
    threading.Thread(target=_focus_browser_cross_platform, daemon=True).start()

    server.serve_forever()
    print("Server stopped")


if __name__ == "__main__":
    main()
