#!/usr/bin/env python3
"""Phase 4 Step 4: Write manifest.txt from generation_plan.json and verify all files exist.

Usage: python3 scripts/write_manifest.py <chapter_number>
"""
import json, os, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

plan_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json"
manifest_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/manifest.txt"

plan = json.loads(plan_path.read_text())
ordered = sorted(plan, key=lambda x: x["index"])

missing_blob = [e for e in ordered if not e.get("blob_path")]
if missing_blob:
    print(f"ERROR: {len(missing_blob)} segments have no blob_path. Cannot write manifest.")
    for e in missing_blob:
        print(f"  index={e['index']} voice={e['voice_id']}")
    sys.exit(1)

# Write manifest
with open(manifest_path, "w") as f:
    for e in ordered:
        f.write(e["blob_path"] + "\n")

# Verify all files exist
missing_files = []
for i, e in enumerate(ordered, 1):
    if Path(e["blob_path"]).exists():
        print(f"  {i}. ok {e['blob_path']}")
    else:
        missing_files.append((i, e["blob_path"]))
        print(f"  {i}. MISSING {e['blob_path']}")

if missing_files:
    print(f"\nERROR: {len(missing_files)} file(s) missing -- go back to Failure & Retry.")
    sys.exit(1)
else:
    print(f"\nmanifest.txt written: {len(ordered)} entries in playback order. Ready for concatenation.")
