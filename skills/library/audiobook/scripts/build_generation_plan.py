#!/usr/bin/env python3
"""Phase 4 Step 1: Parse chapter script and build generation_plan.json.

Usage: python3 scripts/build_generation_plan.py <chapter_number>

Auto-detects chapter title from analysis/chapters.md,
and first/last chapter from .audiobook-state.json.
"""
import json, re, sys, os
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

# Load state for auto-detection
state = json.loads((BOOK_DIR / ".audiobook-state.json").read_text(encoding="utf-8"))
BOOK_NAME = state.get("bookName", "")
total_chapters = state.get("totalChapters", 0)

IS_FIRST_CHAPTER = (CHAPTER_N == 1)
IS_LAST_CHAPTER = (CHAPTER_N == total_chapters) if total_chapters > 0 else False

# Auto-detect chapter title from chapters.md
CHAPTER_TITLE = ""
chapters_path = BOOK_DIR / "analysis" / "chapters.md"
if chapters_path.exists():
    for line in chapters_path.read_text(encoding="utf-8").splitlines():
        # Match patterns like "## Chapter 1: Title" or "## 第一章 标题"
        m = re.match(rf'^##\s+.*?{CHAPTER_N}[.:：\s]+(.*)', line)
        if m:
            CHAPTER_TITLE = m.group(0).lstrip("#").strip()
            break
        # Also match "## N. Title"
        m = re.match(rf'^##\s+{CHAPTER_N}\.\s+(.*)', line)
        if m:
            CHAPTER_TITLE = m.group(0).lstrip("#").strip()
            break

print(f"Chapter {CHAPTER_N}: title='{CHAPTER_TITLE}', first={IS_FIRST_CHAPTER}, last={IS_LAST_CHAPTER}")


def parse_speed(raw_speed, base=1.0):
    """Parse speed setting from preview feedback: faster=+0.03, slower=-0.03"""
    if raw_speed == "faster":
        return min(base + 0.03, 1.2)
    elif raw_speed == "slower":
        return max(base - 0.03, 0.5)
    return base


# --- 1. Load voice mapping from voice_settings.json ---
vs = json.loads((BOOK_DIR / "voice_samples" / "voice_settings.json").read_text())
voice_map = {}  # voice label (lowercase) -> { voice_id, speed }

# Narrator mapping
voice_map["narrator"] = {
    "voice_id": vs["narrator"]["voiceId"],
    "speed": parse_speed(vs["narrator"].get("speed", "ok"), base=0.9),
}

# Character mapping: index by BOTH label and name (Chinese name fallback)
for ch in vs.get("characters", []):
    label = ch.get("label", ch["name"]).lower()
    entry = {
        "voice_id": ch["voiceId"],
        "speed": parse_speed(ch.get("speed", "ok")),
    }
    voice_map[label] = entry
    # Also map by original name so "voice: 程野" matches even if label is "chengye"
    name_key = ch["name"].lower()
    if name_key != label:
        voice_map[name_key] = entry

# --- 2. Parse chapter script — supports BOTH delimiter formats ---
script_path = BOOK_DIR / "scripts" / f"chapter_{CHAPTER_N}.md"
raw = script_path.read_text(encoding="utf-8")

# Auto-detect format: ---segment--- (canonical) or ## Segment N (variant)
if re.search(r'^---segment---\s*$', raw, re.MULTILINE):
    parts = re.split(r'^---segment---\s*$', raw, flags=re.MULTILINE)
    parts = parts[1:]  # drop everything before the first ---segment---
elif re.search(r'^## Segment\s+\d+', raw, re.MULTILINE):
    parts = re.split(r'^## Segment\s+\d+[^\n]*$', raw, flags=re.MULTILINE)
    parts = parts[1:]  # drop everything before the first ## Segment
else:
    raise ValueError(
        f"Cannot detect segment format in {script_path}. "
        f"Expected '---segment---' or '## Segment N' delimiters."
    )

segments = []
for part in parts:
    lines = part.strip().splitlines()
    if not lines:
        continue
    headers = {}
    body_start = 0
    for j, line in enumerate(lines):
        m = re.match(r'^(type|voice):\s*(.+)$', line.strip())
        if m:
            headers[m.group(1)] = m.group(2).strip()
            body_start = j + 1
        elif line.strip() == "":
            continue
        else:
            body_start = j
            break
    body_lines = lines[body_start:]
    text = "\n".join(body_lines).strip()
    if not text:
        continue

    voice_label = headers.get("voice", "narrator").lower()
    mapping = voice_map.get(voice_label, voice_map.get("narrator"))
    segments.append({
        "type": headers.get("type", "narration"),
        "voice_label": voice_label,
        "voice_id": mapping["voice_id"],
        "speed": mapping["speed"],
        "text": text,
    })

# --- Voice assignment validation ---
narrator_vid = voice_map["narrator"]["voice_id"]
mismatched = [s for s in segments if s["type"] == "dialogue" and s["voice_id"] == narrator_vid]
if mismatched:
    print(f"WARNING: {len(mismatched)} dialogue segments using narrator voice (likely wrong speaker mapping):")
    for s in mismatched:
        print(f"  voice_label='{s['voice_label']}', text='{s['text'][:40]}...'")
    print(f"Available voice_map keys: {list(voice_map.keys())}")
    print("Check voice_settings.json character names/labels match segments.json voice values")

# --- 3. Prepend chapter title segment (read aloud by narrator) ---
HAS_TITLE = bool(BOOK_NAME and BOOK_NAME.strip() and CHAPTER_TITLE and CHAPTER_TITLE.strip())
if HAS_TITLE:
    title_text = f"<#2#>{BOOK_NAME}<#1.5#>{CHAPTER_TITLE}"
    segments.insert(0, {
        "type": "narration",
        "voice_label": "narrator",
        "voice_id": voice_map["narrator"]["voice_id"],
        "speed": voice_map["narrator"]["speed"],
        "text": title_text,
    })

# --- 4. Apply 4.2 head/tail padding & build generation plan ---
total = len(segments)
plan = []
for i, seg in enumerate(segments):
    raw_text = seg["text"]
    is_title = HAS_TITLE and (i == 0)

    # Head padding
    if is_title:
        head = ""
    elif i == 0 and not HAS_TITLE and IS_FIRST_CHAPTER:
        head = "<#2#>"
    else:
        head = "<#0.2#>"

    # Tail padding
    if i == total - 1 and IS_LAST_CHAPTER:
        tail = "<#3#>"
    elif i == total - 1:
        tail = "<#2#>"
    else:
        tail = "<#0.2#>"

    plan.append({
        "index": i,
        "filename": f"ch{CHAPTER_N}_idx_{i}",
        "voice_id": seg["voice_id"],
        "speed": seg["speed"],
        "text": f"{head}{raw_text}{tail}",
        "blob_path": None,
    })

plan_path = BOOK_DIR / "audio" / f"chapter_{CHAPTER_N}" / "generation_plan.json"
plan_path.parent.mkdir(parents=True, exist_ok=True)
with open(plan_path, "w", encoding="utf-8") as f:
    json.dump(plan, f, ensure_ascii=False, indent=2)

# --- 5. Print waves (copy-paste these calls into Step 2) ---
MAX_CALLS_PER_WAVE = 3
waves = [plan[i:i+MAX_CALLS_PER_WAVE] for i in range(0, len(plan), MAX_CALLS_PER_WAVE)]

print(f"\n=== Generation Plan: {len(plan)} segments, {len(waves)} waves ===\n")
for w_i, wave in enumerate(waves):
    print(f"--- Wave {w_i+1} ({len(wave)} calls) ---")
    for entry in wave:
        print(f"  audios_generation(")
        print(f"    texts=[{repr(entry['text'])}],")
        print(f"    voice_id={repr(entry['voice_id'])},")
        print(f"    speed={entry['speed']},")
        print(f"    filenames=[{repr(entry['filename'])}]")
        print(f"  )")
    print()
