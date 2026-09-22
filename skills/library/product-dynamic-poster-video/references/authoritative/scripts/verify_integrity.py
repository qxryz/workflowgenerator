#!/usr/bin/env python3
"""Verify every authoritative source asset against its recorded SHA-256."""

from __future__ import annotations
import hashlib
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]

def main() -> int:
    manifest = json.loads((ROOT / "source-manifest.json").read_text(encoding="utf-8"))
    failures = []
    for relative, expected in manifest["files"].items():
        path = ROOT / relative
        if not path.is_file():
            failures.append(f"missing: {relative}")
            continue
        data = path.read_bytes()
        if hashlib.sha256(data).hexdigest() != expected["sha256"]:
            failures.append(f"hash mismatch: {relative}")
        if len(data) != expected["bytes"]:
            failures.append(f"byte-count mismatch: {relative}")
    if failures:
        print("Integrity check FAILED")
        for failure in failures:
            print(f"- {failure}")
        return 1
    print(f"Integrity check passed: {len(manifest['files'])} authoritative files")
    return 0

if __name__ == "__main__":
    sys.exit(main())
