#!/usr/bin/env python3
"""Phase 3 Step 3.3: Match generated preview blobs back to candidates via filename.

Usage: python3 scripts/match_preview_blobs.py

Reads preview_plan.json + assets.json, matches blobs by filename,
and updates preview_plan.json with blob_path for each candidate.
"""
import json, os
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

assets_path = PROJECT_DIR / ".hilo" / "assets.json"
plan_path = BOOK_DIR / "voice_samples" / "preview_plan.json"

assets = json.loads(assets_path.read_text(encoding="utf-8"))
plan = json.loads(plan_path.read_text(encoding="utf-8"))

# Build lookup: filename (without extension) -> asset entry
# Iterate forward so later entries (retries) overwrite earlier ones
name_to_asset = {}
for a in assets:
    if a.get("type") == "audio" and a.get("name"):
        name_key = a["name"].rsplit(".", 1)[0]  # strip .mp3
        name_to_asset[name_key] = a

# Match each candidate
results = []
for role in plan:
    for c in role["candidates"]:
        asset = name_to_asset.get(c["filename"])
        if asset and asset.get("blobRef"):
            blob_path = str(PROJECT_DIR / ".hilo" / ".blobs" / asset["blobRef"])
            c["blob_path"] = blob_path
            status = "ok"
        else:
            c["blob_path"] = None
            status = "MISSING"
        results.append((status, role["role"], c["voice_id"], c["filename"]))
        print(f'{"ok" if status == "ok" else "MISSING":>7s}  {role["role"]:20s}  {c["voice_id"]:35s}  {c["filename"]}')

# Save updated plan with blob_path
with open(plan_path, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

missing = [r for r in results if r[0] == "MISSING"]
if missing:
    print(f"\nWARNING: {len(missing)} samples not matched -- retry the failed calls")
else:
    print(f"\nAll {len(results)} samples matched. Proceed to Step 4.")
