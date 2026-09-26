"""Optional, short-lived public video URLs for Seedance reference inputs.

Run behind an HTTPS reverse proxy. Custom uploads use a bearer token. The
official public endpoint has bounded per-IP usage. Random download URLs act as
capability URLs because the video provider cannot send auth.
"""

from __future__ import annotations

import hmac
import ipaddress
import json
import os
import re
import secrets
import socket
import sqlite3
import shutil
import threading
import time
from contextlib import closing
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

MAX_VIDEO_BYTES = 200 * 1024 * 1024
MAX_STORED_BYTES = 4 * 1024 * 1024 * 1024
MAX_PUBLIC_BYTES_PER_IP_DAY = 1024 * 1024 * 1024
MAX_PUBLIC_BYTES_GLOBAL_DAY = 2 * 1024 * 1024 * 1024
MAX_PUBLIC_ATTEMPTS_PER_IP_HOUR = 12
MIN_FREE_BYTES = 512 * 1024 * 1024
TTL_SECONDS = 48 * 60 * 60
CHUNK_BYTES = 1024 * 1024
VIDEO_PATH = re.compile(r"^/v1/media/([A-Za-z0-9_-]{43})\.(mp4|mov)$")
LOCAL_ORIGIN = re.compile(r"^https?://(?:127\.0\.0\.1|localhost|tauri\.localhost)(?::\d+)?$")


class RelayServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, data_dir: Path, token: str, public_base: str, public_uploads_enabled: bool = False, trust_proxy_ip: bool = False):
        super().__init__(address, RelayHandler)
        self.data_dir = data_dir
        self.token = token
        self.public_base = public_base.rstrip("/")
        self.public_uploads_enabled = public_uploads_enabled
        self.trust_proxy_ip = trust_proxy_ip
        self.upload_lock = threading.Lock()
        self.upload_slots = threading.BoundedSemaphore(2)
        self.reserved_bytes = 0
        data_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.quota_db = data_dir / ".public-upload-quota.sqlite3"
        with closing(sqlite3.connect(self.quota_db)) as db, db:
            db.execute("CREATE TABLE IF NOT EXISTS uploads (at REAL NOT NULL, ip TEXT NOT NULL, bytes INTEGER NOT NULL)")
            db.execute("CREATE INDEX IF NOT EXISTS uploads_at ON uploads(at)")

    def cleanup(self) -> None:
        cutoff = time.time() - TTL_SECONDS
        for path in self.data_dir.iterdir():
            if path.is_file() and (path.name.startswith(".upload-") or VIDEO_PATH.fullmatch(f"/v1/media/{path.name}")):
                try:
                    if path.stat().st_mtime < cutoff:
                        path.unlink()
                except FileNotFoundError:
                    pass
        with closing(sqlite3.connect(self.quota_db)) as db, db:
            db.execute("DELETE FROM uploads WHERE at <= ?", (time.time() - 86400,))

    def stored_bytes(self) -> int:
        return sum(path.stat().st_size for path in self.data_dir.iterdir() if path.is_file() and VIDEO_PATH.fullmatch(f"/v1/media/{path.name}"))

    def reserve_public_quota(self, ip: str, length: int) -> bool:
        now = time.time()
        with closing(sqlite3.connect(self.quota_db)) as db, db:
            db.execute("DELETE FROM uploads WHERE at <= ?", (now - 86400,))
            hourly = db.execute("SELECT COUNT(*) FROM uploads WHERE ip = ? AND at > ?", (ip, now - 3600)).fetchone()[0]
            daily = db.execute("SELECT COALESCE(SUM(bytes), 0) FROM uploads WHERE ip = ?", (ip,)).fetchone()[0]
            global_daily = db.execute("SELECT COALESCE(SUM(bytes), 0) FROM uploads").fetchone()[0]
            if hourly >= MAX_PUBLIC_ATTEMPTS_PER_IP_HOUR or daily + length > MAX_PUBLIC_BYTES_PER_IP_DAY or global_daily + length > MAX_PUBLIC_BYTES_GLOBAL_DAY:
                return False
            db.execute("INSERT INTO uploads (at, ip, bytes) VALUES (?, ?, ?)", (now, ip, length))
        return True


class RelayHandler(BaseHTTPRequestHandler):
    server: RelayServer
    protocol_version = "HTTP/1.1"

    def log_message(self, format_string, *args):
        # The standard request log contains capability URLs. Do not print them.
        pass

    def _origin(self) -> str | None:
        origin = self.headers.get("Origin", "")
        return origin if LOCAL_ORIGIN.fullmatch(origin) else None

    def _send(self, status: int, body: bytes = b"", content_type: str = "application/json", extra: dict[str, str] | None = None) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        origin = self._origin()
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Vary", "Origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()
        if self.command != "HEAD" and body:
            self.wfile.write(body)

    def _error(self, status: int, message: str) -> None:
        self._send(status, json.dumps({"error": message}).encode())

    def _client_ip(self) -> str:
        # The listener is loopback-only; Nginx overwrites X-Real-IP with
        # $remote_addr. Never trust a forwarded chain supplied by a client.
        candidate = self.headers.get("X-Real-IP", "") if self.server.trust_proxy_ip else self.client_address[0]
        try:
            return str(ipaddress.ip_address(candidate))
        except ValueError:
            return self.client_address[0]

    def do_OPTIONS(self) -> None:
        if self.path not in ("/v1/upload", "/v1/public-upload") or (self.path == "/v1/public-upload" and not self.server.public_uploads_enabled) or not self._origin():
            self._error(403, "origin not allowed")
            return
        self._send(204, extra={"Access-Control-Allow-Methods": "PUT, OPTIONS", "Access-Control-Allow-Headers": "Authorization, Content-Type", "Access-Control-Max-Age": "600"})

    def do_PUT(self) -> None:
        public = self.path == "/v1/public-upload"
        if not public and self.path != "/v1/upload":
            self._error(404, "not found")
            return
        if public and not self.server.public_uploads_enabled:
            self._error(404, "not found")
            return
        authorization = self.headers.get("Authorization", "")
        if not public and not hmac.compare_digest(authorization, f"Bearer {self.server.token}"):
            self._error(401, "upload credentials required")
            return
        mime = self.headers.get("Content-Type", "").split(";", 1)[0].lower().strip()
        extension = {"video/mp4": "mp4", "video/quicktime": "mov"}.get(mime)
        if not extension:
            self._error(415, "mp4 or mov required")
            return
        try:
            length = int(self.headers.get("Content-Length", ""))
        except ValueError:
            self._error(411, "content length required")
            return
        if length < 12 or length > MAX_VIDEO_BYTES:
            self._error(413, "video exceeds 200 MB")
            return

        if not self.server.upload_slots.acquire(blocking=False):
            self._error(503, "upload server is busy")
            return
        reserved = False
        identifier = secrets.token_urlsafe(32)
        temporary = self.server.data_dir / f".upload-{identifier}"
        destination = self.server.data_dir / f"{identifier}.{extension}"
        try:
            with self.server.upload_lock:
                self.server.cleanup()
                if self.server.stored_bytes() + self.server.reserved_bytes + length > MAX_STORED_BYTES or shutil.disk_usage(self.server.data_dir).free - self.server.reserved_bytes - length < MIN_FREE_BYTES:
                    self._error(507, "temporary media storage is full")
                    return
                if public and not self.server.reserve_public_quota(self._client_ip(), length):
                    self._error(429, "daily upload limit reached")
                    return
                self.server.reserved_bytes += length
                reserved = True
            self.connection.settimeout(30)
            deadline = time.monotonic() + 10 * 60
            remaining = length
            with temporary.open("xb") as output:
                while remaining:
                    if time.monotonic() >= deadline:
                        raise TimeoutError("upload deadline reached")
                    chunk = self.rfile.read(min(CHUNK_BYTES, remaining))
                    if not chunk:
                        raise ConnectionError("incomplete upload")
                    output.write(chunk)
                    remaining -= len(chunk)
            with temporary.open("rb") as source:
                source.seek(4)
                if source.read(4) != b"ftyp":
                    self._error(415, "invalid mp4 or mov file")
                    return
            temporary.replace(destination)
            expires_at = datetime.fromtimestamp(time.time() + TTL_SECONDS, timezone.utc).isoformat()
            body = json.dumps({"url": f"{self.server.public_base}/v1/media/{destination.name}", "expiresAt": expires_at}).encode()
            self._send(201, body)
        except (OSError, ConnectionError, socket.timeout):
            self._error(400, "upload incomplete")
        finally:
            temporary.unlink(missing_ok=True)
            if reserved:
                with self.server.upload_lock:
                    self.server.reserved_bytes -= length
            self.server.upload_slots.release()

    def do_HEAD(self) -> None:
        self._serve_media(head_only=True)

    def do_GET(self) -> None:
        self._serve_media(head_only=False)

    def _serve_media(self, head_only: bool) -> None:
        match = VIDEO_PATH.fullmatch(urlsplit(self.path).path)
        if not match:
            self._error(404, "not found")
            return
        path = self.server.data_dir / f"{match.group(1)}.{match.group(2)}"
        try:
            stat = path.stat()
        except FileNotFoundError:
            self._error(404, "not found")
            return
        if stat.st_mtime + TTL_SECONDS < time.time():
            path.unlink(missing_ok=True)
            self._error(410, "expired")
            return
        start, end = 0, stat.st_size - 1
        requested = self.headers.get("Range")
        if requested:
            parsed = re.fullmatch(r"bytes=(\d+)-(\d*)", requested)
            if not parsed:
                self._error(416, "invalid range")
                return
            start = int(parsed.group(1))
            end = min(int(parsed.group(2)) if parsed.group(2) else end, end)
            if start > end:
                self._error(416, "invalid range")
                return
        length = end - start + 1
        self.send_response(206 if requested else 200)
        self.send_header("Content-Type", "video/quicktime" if match.group(2) == "mov" else "video/mp4")
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "private, no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        if requested:
            self.send_header("Content-Range", f"bytes {start}-{end}/{stat.st_size}")
        self.end_headers()
        if head_only:
            return
        try:
            with path.open("rb") as source:
                source.seek(start)
                remaining = length
                while remaining:
                    chunk = source.read(min(CHUNK_BYTES, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError):
            pass


def main() -> None:
    token = os.environ.get("WG_RELAY_UPLOAD_TOKEN", "")
    public_base = os.environ.get("WG_RELAY_PUBLIC_BASE", "")
    parsed_base = urlsplit(public_base)
    if len(token) < 32 or parsed_base.scheme != "https" or not parsed_base.hostname or parsed_base.username or parsed_base.password or parsed_base.query or parsed_base.fragment:
        raise SystemExit("WG_RELAY_UPLOAD_TOKEN (32+ chars) and HTTPS WG_RELAY_PUBLIC_BASE are required")
    data_dir = Path(os.environ.get("WG_RELAY_DATA_DIR", "/var/lib/workflowgenerator-seedance-relay"))
    server = RelayServer(("127.0.0.1", int(os.environ.get("WG_RELAY_PORT", "9014"))), data_dir, token, public_base,
                         public_uploads_enabled=os.environ.get("WG_RELAY_PUBLIC_UPLOADS") == "1",
                         trust_proxy_ip=os.environ.get("WG_RELAY_TRUST_PROXY_IP") == "1")
    def cleanup_periodically() -> None:
        while True:
            time.sleep(60 * 60)
            with server.upload_lock:
                server.cleanup()

    threading.Thread(target=cleanup_periodically, daemon=True).start()
    print(f"Seedance media relay listening on {server.server_address[0]}:{server.server_address[1]}", flush=True)
    server.serve_forever(poll_interval=0.5)


if __name__ == "__main__":
    main()
