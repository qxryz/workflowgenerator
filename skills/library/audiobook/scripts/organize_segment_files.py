#!/usr/bin/env python3
"""Phase 4 Step 3.4: Move segment audio files from project root to audio/chapter_N/segments/.

Usage: python3 scripts/organize_segment_files.py <chapter_number>

Reads generation_plan.json for filenames, moves .mp3 and _subtitle.json from project root
to audio/chapter_N/segments/, and updates assets.json path field.
Idempotent: skips files already moved or not found at root.
"""
import json, os, shutil, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

plan_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json"
assets_path = PROJECT_DIR / ".hilo" / "assets.json"
target_dir = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/segments"
target_dir.mkdir(parents=True, exist_ok=True)

plan = json.loads(plan_path.read_text(encoding="utf-8"))
assets = json.loads(assets_path.read_text(encoding="utf-8"))

# Collect filenames from plan
filenames = [e["filename"] for e in plan]

# Build assets lookup: filename (without ext) -> list index
name_to_idx = {}
for i, a in enumerate(assets):
    if a.get("type") == "audio" and a.get("name"):
        name_key = a["name"].rsplit(".", 1)[0]
        name_to_idx[name_key] = i

moved = 0
skipped = 0
for fn in filenames:
    # Move .mp3
    src_mp3 = PROJECT_DIR / f"{fn}.mp3"
    dst_mp3 = target_dir / f"{fn}.mp3"
    if src_mp3.exists() and not dst_mp3.exists():
        shutil.move(str(src_mp3), str(dst_mp3))
        moved += 1
        print(f"  moved {fn}.mp3")
    elif dst_mp3.exists():
        skipped += 1
    else:
        print(f"  skip  {fn}.mp3 (not found at root)")

    # Move subtitle json if present
    src_sub = PROJECT_DIR / f"{fn}_subtitle.json"
    dst_sub = target_dir / f"{fn}_subtitle.json"
    if src_sub.exists() and not dst_sub.exists():
        shutil.move(str(src_sub), str(dst_sub))
        print(f"  moved {fn}_subtitle.json")

    # Update assets.json path field
    if fn in name_to_idx:
        idx = name_to_idx[fn]
        rel_path = str(dst_mp3.relative_to(PROJECT_DIR))
        if assets[idx]["path"] != rel_path:
            assets[idx]["path"] = rel_path
            meta = assets[idx].get("metadata", {})
            if meta.get("subtitle_path"):
                meta["subtitle_path"] = str(dst_sub.relative_to(PROJECT_DIR))

with open(assets_path, "w", encoding="utf-8") as f:
    json.dump(assets, f, ensure_ascii=False, indent=2)

print(f"\nDone: {moved} moved, {skipped} already in place, assets.json updated.")
