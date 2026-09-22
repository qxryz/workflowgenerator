#!/usr/bin/env python3
"""Phase 1 Step C: Validate segments.json for attribution errors.

Usage: python3 scripts/validate_segments.py <chapter_number>

Checks:
- No unknown speakers
- No missing voice/character fields
- Flags runs of 3+ consecutive same-speaker dialogue (for review)

Run after every segments.json is written. Fix any ERRORs before proceeding to Phase 2.
"""
import json, sys, os
from pathlib import Path
from collections import Counter

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())
CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

segments_path = BOOK_DIR / "analysis" / f"chapter_{CHAPTER_N}" / "segments.json"
segments = json.loads(segments_path.read_text(encoding="utf-8"))

# --- 1. Count speakers ---
voice_counts = Counter(s["voice"] for s in segments)
dialogue_count = sum(1 for s in segments if s["type"] == "dialogue")
unknown_count = sum(1 for s in segments if s.get("voice") == "unknown" or s.get("character") == "unknown")

print(f"Total segments: {len(segments)}")
print(f"Dialogue segments: {dialogue_count}")
print(f"Speaker distribution: {dict(voice_counts)}")

# --- 2. Check for unknown speakers ---
if unknown_count > 0:
    pct = unknown_count / max(dialogue_count, 1) * 100
    print(f"\nWARNING: {unknown_count} unknown speakers ({pct:.0f}% of dialogue)")
    for i, s in enumerate(segments):
        if s.get("voice") == "unknown":
            print(f"  segment {i}: {s['text'][:50]}...")

# --- 3. Check for suspicious consecutive same-speaker dialogue ---
consecutive_runs = []
prev_voice = None
run_start = 0
run_len = 0
for i, s in enumerate(segments):
    if s["type"] != "dialogue":
        if run_len >= 3:
            consecutive_runs.append((prev_voice, run_start, run_len))
        prev_voice = None
        run_len = 0
        continue
    if s["voice"] == prev_voice:
        run_len += 1
    else:
        if run_len >= 3:
            consecutive_runs.append((prev_voice, run_start, run_len))
        prev_voice = s["voice"]
        run_start = i
        run_len = 1

if run_len >= 3:
    consecutive_runs.append((prev_voice, run_start, run_len))

if consecutive_runs:
    print(f"\nNOTE: {len(consecutive_runs)} runs of 3+ consecutive dialogue lines from same speaker (may be correct, review if unexpected):")
    for voice, start, length in consecutive_runs:
        print(f"  '{voice}' speaks {length}x in a row starting at segment {start}")

# --- 4. Check voice field consistency ---
missing_voice = [i for i, s in enumerate(segments) if "voice" not in s]
if missing_voice:
    print(f"\nERROR: {len(missing_voice)} segments missing 'voice' field: {missing_voice}")

dialogue_without_char = [i for i, s in enumerate(segments) if s["type"] == "dialogue" and "character" not in s]
if dialogue_without_char:
    print(f"ERROR: {len(dialogue_without_char)} dialogue segments missing 'character' field: {dialogue_without_char}")

if not unknown_count and not missing_voice and not dialogue_without_char:
    print("\nAll checks passed.")
