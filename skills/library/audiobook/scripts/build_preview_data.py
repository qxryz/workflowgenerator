#!/usr/bin/env python3
"""Phase 3 Step 4: Build preview_data.json from preview_plan.json (with blob_path).

Usage: python3 scripts/build_preview_data.py [--lang zh|en]

If --lang is omitted, auto-detects from .audiobook-state.json or book content.
"""
import json, re, sys, os
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

# Parse --lang argument
LANG = None
for i, arg in enumerate(sys.argv[1:], 1):
    if arg == "--lang" and i < len(sys.argv) - 1:
        LANG = sys.argv[i + 1]

state = json.loads((BOOK_DIR / ".audiobook-state.json").read_text(encoding="utf-8"))
BOOK_NAME = state.get("bookName", BOOK_DIR.name)

# Auto-detect language if not specified
if not LANG:
    LANG = state.get("lang", "")
if not LANG:
    if re.search(r'[\u4e00-\u9fff]', BOOK_NAME):
        LANG = "zh"
    else:
        LANG = "en"

plan_path = BOOK_DIR / "voice_samples" / "preview_plan.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))

# Read characters.md for descriptions (best-effort)
chars_path = BOOK_DIR / "analysis" / "characters.md"
char_descriptions = {}
if chars_path.exists():
    current_name = None
    for line in chars_path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("### ") or line.startswith("## "):
            current_name = line.lstrip("#").strip()
        elif current_name and line and not line.startswith("-"):
            char_descriptions.setdefault(current_name, line)

# Build preview_data from plan
preview = {
    "bookName": BOOK_NAME,
    "lang": LANG,
    "pauseDensity": "medium",
    "narrator": None,
    "characters": [],
}

for role in plan:
    role_name = role["role"]
    candidates = []
    for c in role["candidates"]:
        cand = {
            "voiceId": c["voice_id"],
            "voiceName": c["voice_name"],
            "description": c.get("description", ""),
            "samplePath": c.get("blob_path") or "",
        }
        candidates.append(cand)

    if role_name == "narrator":
        preview["narrator"] = {
            "voiceId": candidates[0]["voiceId"] if candidates else "",
            "sampleText": role.get("sample_text", ""),
            "speed": role.get("speed", 0.9),
            "volume": 1.0,
            "candidates": candidates,
        }
    else:
        preview["characters"].append({
            "name": role_name,
            "label": role_name.lower().replace(" ", "_"),
            "description": char_descriptions.get(role_name, ""),
            "voiceId": candidates[0]["voiceId"] if candidates else "",
            "sampleText": role.get("sample_text", ""),
            "speed": role.get("speed", 1.0),
            "volume": 1.0,
            "candidates": candidates,
        })

out_path = BOOK_DIR / "voice_samples" / "preview_data.json"
with open(out_path, "w", encoding="utf-8") as f:
    json.dump(preview, f, ensure_ascii=False, indent=2)

# Validation
missing = []
for role in plan:
    for c in role["candidates"]:
        bp = c.get("blob_path")
        if not bp or not Path(bp).exists():
            missing.append(f"  {role['role']}/{c['voice_name']}: {bp or 'None'}")

if missing:
    print(f"WARNING: {len(missing)} candidates have missing audio:")
    for m in missing:
        print(m)
    print("Audio preview will be broken for these candidates. Re-run Step 3.2/3.3.")
else:
    print(f"preview_data.json written: {out_path}")
    print(f"  {len(plan)} roles, all audio files verified.")
