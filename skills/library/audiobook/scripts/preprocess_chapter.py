#!/usr/bin/env python3
"""Phase 1 Step A: Regex pre-processing — split mixed narration/dialogue lines.

Usage: python3 scripts/preprocess_chapter.py <chapter_number>

Reads source/book.txt, splits lines that contain both narration and dialogue
into separate lines, and writes analysis/chapter_{N}/preprocessed.txt.

Do NOT modify this script — it is the canonical pre-processing step.
"""
import sys, os
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())
CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

# --- Quote splitter ---
OPEN_QUOTES = {'\u201c': '\u201d', '\u300c': '\u300d', '"': '"'}  # "" 「」 ""

def split_quotes(line):
    """Split a line into alternating narration / dialogue segments by quote boundaries."""
    results = []
    buf = []
    in_quote = False
    expect_close = None

    for ch in line:
        if not in_quote and ch in OPEN_QUOTES:
            text = ''.join(buf).strip()
            if text:
                results.append(text)
            buf = [ch]
            in_quote = True
            expect_close = OPEN_QUOTES[ch]
        elif in_quote and ch == expect_close:
            buf.append(ch)
            results.append(''.join(buf))
            buf = []
            in_quote = False
        else:
            buf.append(ch)

    text = ''.join(buf).strip()
    if text:
        results.append(text)

    return results if results else [line]

# --- Read source chapter text ---
chapters_dir = BOOK_DIR / "analysis" / f"chapter_{CHAPTER_N}"
chapters_dir.mkdir(parents=True, exist_ok=True)

source_path = BOOK_DIR / "source" / "book.txt"
raw_text = source_path.read_text(encoding="utf-8")

# TODO: If multi-chapter, slice raw_text to current chapter range based on chapters.md

# --- Process each line ---
output_lines = []
for line in raw_text.splitlines():
    stripped = line.strip()
    if not stripped:
        output_lines.append("")  # preserve paragraph breaks
        continue

    has_quote = any(ch in stripped for ch in OPEN_QUOTES)
    if has_quote:
        parts = split_quotes(stripped)
        output_lines.extend(parts)
    else:
        output_lines.append(stripped)

out_path = chapters_dir / "preprocessed.txt"
out_path.write_text("\n".join(output_lines), encoding="utf-8")

# Stats
total = len([l for l in output_lines if l.strip()])
dialogue = len([l for l in output_lines if l.strip() and l.strip()[0] in OPEN_QUOTES])
narration = total - dialogue
print(f"Preprocessed: {total} lines ({dialogue} dialogue, {narration} narration)")
print(f"Output: {out_path}")
