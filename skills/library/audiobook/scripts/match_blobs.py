#!/usr/bin/env python3
"""Phase 4 Step 3: Match generated audio blobs back to generation plan via filename.

Usage: python3 scripts/match_blobs.py <chapter_number>

Reads generation_plan.json + assets.json, matches blobs by filename (last-write-wins),
and updates generation_plan.json with blob_path.
"""
import json, os, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

assets_path = PROJECT_DIR / ".hilo/assets.json"
plan_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json"

assets = json.loads(assets_path.read_text())
plan = json.loads(plan_path.read_text())

# Build lookup: filename (without extension) -> asset entry
# Iterate forward so later entries (retries) overwrite earlier ones
name_to_asset = {}
for a in assets:
    if a.get("type") == "audio" and a.get("name"):
        name_key = a["name"].rsplit(".", 1)[0]  # strip .mp3
        name_to_asset[name_key] = a

matched = 0
for entry in plan:
    if entry.get("blob_path"):
        matched += 1
        continue
    asset = name_to_asset.get(entry["filename"])
    if asset and asset.get("blobRef"):
        entry["blob_path"] = str(PROJECT_DIR / ".hilo/.blobs" / asset["blobRef"])
        matched += 1

with open(plan_path, 'w', encoding='utf-8') as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

unmatched = [e for e in plan if not e.get("blob_path")]
print(f"Matched: {matched}/{len(plan)}")
if unmatched:
    print(f"WARNING: {len(unmatched)} segments not matched -- run Failure & Retry")
    for e in unmatched[:5]:
        print(f"  [{e['index']}] filename={e['filename']}, voice={e['voice_id']}")
else:
    print("All segments matched successfully! Proceed to Step 3.5.")
