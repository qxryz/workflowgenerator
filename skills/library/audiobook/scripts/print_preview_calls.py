#!/usr/bin/env python3
"""Phase 3 Step 3.2: Print audios_generation calls for voice preview samples.

Usage: python3 scripts/print_preview_calls.py

Reads preview_plan.json, auto-assigns normalized filenames if missing,
writes them back, and prints grouped audios_generation calls (max 3 per wave).
"""
import json, os, re
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

plan_path = BOOK_DIR / "voice_samples" / "preview_plan.json"
plan = json.loads(plan_path.read_text(encoding="utf-8"))


def normalize_role(role_name: str) -> str:
    """Convert role name to ASCII-safe filename component."""
    ascii_only = re.sub(r'[^\x00-\x7F]', '', role_name)
    if not ascii_only.strip():
        return f"role{abs(hash(role_name)) % 10000:04d}"
    normalized = re.sub(r'[^a-zA-Z0-9]+', '_', ascii_only).strip('_').lower()
    return normalized or f"role{abs(hash(role_name)) % 10000:04d}"


# Auto-assign filenames if missing
used_filenames = set()
updated = False
global_idx = 0  # collision fallback counter

for role in plan:
    role_tag = normalize_role(role["role"])
    for ci, c in enumerate(role["candidates"]):
        if not c.get("filename"):
            fn = f"preview_{role_tag}_{ci}"
            # Handle collisions
            if fn in used_filenames:
                fn = f"preview_{global_idx}"
                global_idx += 1
            c["filename"] = fn
            updated = True
        used_filenames.add(c["filename"])

if updated:
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"Auto-assigned filenames written back to {plan_path.name}\n")


# Flatten all calls: 1 call per candidate
calls = []
for role in plan:
    for c in role["candidates"]:
        calls.append({
            "text": role["sample_text"],
            "voice_id": c["voice_id"],
            "speed": role["speed"],
            "filename": c["filename"],
        })

# Group into waves of 3
MAX_PER_WAVE = 3
waves = [calls[i:i+MAX_PER_WAVE] for i in range(0, len(calls), MAX_PER_WAVE)]

print(f"=== Preview Plan: {len(calls)} samples, {len(waves)} waves ===\n")
for w_i, wave in enumerate(waves):
    print(f"--- Wave {w_i+1} ({len(wave)} calls) ---")
    for c in wave:
        print(f"  audios_generation(")
        print(f"    texts=[{repr(c['text'])}],")
        print(f"    voice_id={repr(c['voice_id'])},")
        print(f"    speed={c['speed']},")
        print(f"    filenames=[{repr(c['filename'])}]")
        print(f"  )")
    print()
