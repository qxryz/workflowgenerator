#!/usr/bin/env python3
"""Phase 2: Generate chapter_N.md from segments.json (with pause markers already added).

Usage: python3 scripts/generate_chapter_script.py <chapter_number>

Reads segments.json (which LLM has already updated with <#X#> pause markers)
and writes chapter_N.md with voice headers directly from the voice field.
"""
import json, sys, os
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

segments_path = BOOK_DIR / "analysis" / f"chapter_{CHAPTER_N}" / "segments.json"
script_path = BOOK_DIR / "scripts" / f"chapter_{CHAPTER_N}.md"
script_path.parent.mkdir(parents=True, exist_ok=True)

segments = json.loads(segments_path.read_text(encoding="utf-8"))

lines = []
for seg in segments:
    lines.append("---segment---")
    lines.append(f"type: {seg['type']}")
    lines.append(f"voice: {seg['voice']}")  # Directly from segments.json
    lines.append("")
    lines.append(seg["text"])
    lines.append("")

script_path.write_text("\n".join(lines), encoding="utf-8")
print(f"Chapter script written: {script_path}")
print(f"  {len(segments)} segments, voices: {set(s['voice'] for s in segments)}")
