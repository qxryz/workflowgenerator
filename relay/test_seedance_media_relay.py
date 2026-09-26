import http.client
import json
import sqlite3
import tempfile
import threading
import unittest
from contextlib import closing
from pathlib import Path
from urllib.parse import urlsplit

from seedance_media_relay import RelayServer, TTL_SECONDS, MAX_PUBLIC_ATTEMPTS_PER_IP_HOUR


class RelayTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.server = RelayServer(("127.0.0.1", 0), Path(self.directory.name), "secret" * 8, "https://example.com/seedance-media")
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.video = b"\x00\x00\x00\x18ftypisom" + b"video bytes" * 100

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.directory.cleanup()

    def request(self, method, path, body=None, headers=None):
        connection = http.client.HTTPConnection("127.0.0.1", self.server.server_port)
        connection.request(method, path, body=body, headers=headers or {})
        response = connection.getresponse()
        result = response.status, dict(response.getheaders()), response.read()
        connection.close()
        return result

    def upload(self, body=None, token="secret" * 8):
        return self.request("PUT", "/v1/upload", self.video if body is None else body, {
            "Authorization": f"Bearer {token}", "Content-Type": "video/mp4", "Origin": "http://127.0.0.1:3000"
        })

    def test_upload_requires_secret_and_returns_random_public_url(self):
        self.assertEqual(self.upload(token="wrong")[0], 401)
        self.assertEqual(list(Path(self.directory.name).glob("*.mp4")), [])
        status, headers, body = self.upload()
        self.assertEqual(status, 201)
        self.assertEqual(headers["Access-Control-Allow-Origin"], "http://127.0.0.1:3000")
        payload = json.loads(body)
        self.assertTrue(payload["url"].startswith("https://example.com/seedance-media/v1/media/"))
        self.assertIn("expiresAt", payload)
        path = urlsplit(payload["url"]).path.removeprefix("/seedance-media")
        self.assertEqual(self.request("HEAD", path)[0], 200)
        self.assertEqual(self.request("GET", path)[2], self.video)
        status, headers, body = self.request("GET", path, headers={"Range": "bytes=4-7"})
        self.assertEqual((status, body), (206, b"ftyp"))
        self.assertEqual(headers["Content-Range"], f"bytes 4-7/{len(self.video)}")

    def test_invalid_media_and_untrusted_preflight_are_rejected(self):
        self.assertEqual(self.upload(body=b"not a video file")[0], 415)
        self.assertEqual(self.request("OPTIONS", "/v1/upload", headers={"Origin": "https://untrusted.example"})[0], 403)
        self.assertEqual(self.request("OPTIONS", "/v1/upload", headers={"Origin": "http://localhost:3000"})[0], 204)

    def test_official_upload_needs_no_shared_secret_but_has_per_ip_limit(self):
        self.server.public_uploads_enabled = True
        self.server.trust_proxy_ip = True
        headers = {"Content-Type": "video/mp4", "Origin": "http://127.0.0.1:3000", "X-Real-IP": "198.51.100.7"}
        self.assertEqual(self.request("OPTIONS", "/v1/public-upload", headers=headers)[0], 204)
        for _ in range(MAX_PUBLIC_ATTEMPTS_PER_IP_HOUR):
            self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, headers)[0], 201)
        self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, headers)[0], 429)
        self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, {**headers, "X-Real-IP": "198.51.100.8"})[0], 201)

    def test_public_upload_is_disabled_by_default(self):
        headers = {"Content-Type": "video/mp4", "Origin": "http://127.0.0.1:3000"}
        self.assertEqual(self.request("OPTIONS", "/v1/public-upload", headers=headers)[0], 403)
        self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, headers)[0], 404)
        self.assertEqual(self.upload()[0], 201)

    def test_public_quota_survives_restart_and_ignores_untrusted_ip_header(self):
        self.server.public_uploads_enabled = True
        headers = {"Content-Type": "video/mp4", "X-Real-IP": "198.51.100.7"}
        for _ in range(MAX_PUBLIC_ATTEMPTS_PER_IP_HOUR):
            self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, headers)[0], 201)
        self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, {**headers, "X-Real-IP": "198.51.100.8"})[0], 429)
        self.server.shutdown()
        self.server.server_close()
        self.thread.join()
        self.server = RelayServer(("127.0.0.1", 0), Path(self.directory.name), "secret" * 8, "https://example.com/seedance-media", public_uploads_enabled=True)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.assertEqual(self.request("PUT", "/v1/public-upload", self.video, headers)[0], 429)

    def test_expired_files_are_removed(self):
        payload = json.loads(self.upload()[2])
        path = urlsplit(payload["url"]).path.removeprefix("/seedance-media")
        stored = next(Path(self.directory.name).glob("*.mp4"))
        import os
        import time
        old = time.time() - TTL_SECONDS - 1
        os.utime(stored, (old, old))
        self.assertEqual(self.request("GET", path)[0], 410)
        self.assertFalse(stored.exists())

    def test_cleanup_removes_expired_ip_quota_records(self):
        import time
        with closing(sqlite3.connect(self.server.quota_db)) as db, db:
            db.execute("INSERT INTO uploads (at, ip, bytes) VALUES (?, ?, ?)", (time.time() - 86401, "198.51.100.7", 100))
        self.server.cleanup()
        with closing(sqlite3.connect(self.server.quota_db)) as db, db:
            self.assertEqual(db.execute("SELECT COUNT(*) FROM uploads").fetchone()[0], 0)


if __name__ == "__main__":
    unittest.main()
