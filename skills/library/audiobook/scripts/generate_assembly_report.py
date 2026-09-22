#!/usr/bin/env python3
"""Phase 4.6: Generate assembly report markdown with timestamps and segment details.

Usage: python3 scripts/generate_assembly_report.py <chapter_number>

Requires ffprobe to be available for duration extraction.
"""
import json, subprocess, re, os, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

state = json.loads((BOOK_DIR / ".audiobook-state.json").read_text())
book_name = state.get("bookName", BOOK_DIR.name)

assets = json.loads((PROJECT_DIR / ".hilo/assets.json").read_text())
plan = json.loads((BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json").read_text())
ordered = sorted(plan, key=lambda x: x["index"])

blob_to_local = {e["blobRef"]: e["name"] for e in assets if e.get("type") == "audio" and e.get("blobRef") and e.get("name")}


def clean_text(t):
    t = re.sub(r'<#[\d.]+#>', '', t)
    return re.sub(r'  +', ' ', t).strip()


def fmt(s):
    h = int(s // 3600)
    m = int((s % 3600) // 60)
    return f"{h:02d}:{m:02d}:{s % 60:05.2f}"


rows, cursor = [], 0.0
for entry in ordered:
    blob_ref = Path(entry["blob_path"]).name
    dur = float(subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration",
         "-of", "default=noprint_wrappers=1:nokey=1", entry["blob_path"]],
        capture_output=True, text=True).stdout.strip())
    start, end = cursor, cursor + dur
    cursor = end
    rows.append({
        "index":      entry["index"],
        "start":      fmt(start),
        "end":        fmt(end),
        "voice_id":   entry["voice_id"],
        "local_file": blob_to_local.get(blob_ref, blob_ref),
        "text":       clean_text(entry["text"])
    })

# Detect language
lang = state.get("lang", "")
if not lang:
    _all_text = " ".join(r["text"] for r in rows)
    lang = "zh" if re.search(r'[\u4e00-\u9fff]', _all_text) else "en"

if lang == "zh":
    tip1 = "> 如需修改某段，请在对话框中注明 **# 编号** 和修改意见。"
    tip2 = "> Local File 列即项目根目录下的实际文件名，与画布展示一致。"
else:
    tip1 = "> To request a fix, mention the segment **# number** and your change in the chat."
    tip2 = "> The **Local File** column shows the actual filename in the project root, matching canvas."

lines = [
    f"# {book_name} -- Chapter {CHAPTER_N} Audio Assembly", "",
    f"**Total duration:** {rows[-1]['end']}  ",
    f"**Segments:** {len(rows)}  ", "",
    tip1, tip2, "",
    "| # | Start | End | Voice ID | Local File | Text |",
    "|--:|-------|-----|----------|------------|------|",
]
for r in rows:
    text = r["text"].replace("|", "\\|").replace("\n", " ")
    lines.append(f"| {r['index']} | `{r['start']}` | `{r['end']}` | `{r['voice_id']}` | `{r['local_file']}` | {text} |")

report_name = f"{book_name}_chapter_{CHAPTER_N}_assembly.md"
Path(PROJECT_DIR / report_name).write_text("\n".join(lines), encoding="utf-8")
print(f"Assembly report written: {PROJECT_DIR / report_name}")
