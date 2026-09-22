#!/usr/bin/env python3
"""Phase 4 Failure & Retry: Clean old files and print retry calls for unmatched segments.

Usage: python3 scripts/print_retry_calls.py <chapter_number>

Reads generation_plan.json, deletes old workspace files for failed segments
(to prevent gateway dedup suffix), and prints audios_generation retry calls.
"""
import json, os, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

plan_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))

failed = [e for e in plan if not e.get("blob_path")]
if not failed:
    print("All segments have blob_path. Nothing to retry.")
else:
    # Clean old workspace files to prevent gateway dedup suffix (_1, _2, ...)
    cleaned = 0
    for e in failed:
        old_file = PROJECT_DIR / f"{e['filename']}.mp3"
        if old_file.exists():
            old_file.unlink()
            cleaned += 1
            print(f"Removed old workspace file: {old_file.name}")
    if cleaned:
        print(f"Cleaned {cleaned} old file(s) to prevent filename collision.\n")

    print(f"{len(failed)} segments need retry.\n")
    print("1. Sleep 30 seconds first")
    print("2. Then fire these calls (max 3 per wave):\n")

    MAX_CALLS_PER_WAVE = 3
    waves = [failed[i:i+MAX_CALLS_PER_WAVE] for i in range(0, len(failed), MAX_CALLS_PER_WAVE)]
    for w_i, wave in enumerate(waves):
        print(f"--- Retry Wave {w_i+1} ---")
        for e in wave:
            print(f"  audios_generation(")
            print(f"    texts=[{repr(e['text'])}],")
            print(f"    voice_id={repr(e['voice_id'])},")
            print(f"    speed={e['speed']},")
            print(f"    filenames=[{repr(e['filename'])}]")
            print(f"  )")
        print()

    print("3. After all complete, re-run match_blobs.py + verify_blobs.py")
    print("4. Re-run this retry script -- repeat until all matched")
