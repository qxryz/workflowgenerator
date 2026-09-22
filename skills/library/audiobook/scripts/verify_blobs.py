#!/usr/bin/env python3
"""Phase 4 Step 3.5: Verify matched blobs have correct voice_id and text content.

Usage: python3 scripts/verify_blobs.py <chapter_number>

Compares each matched blob's metadata (voice_id, text) against the generation plan.
Clears blob_path for any mismatched entries so they can be retried.
"""
import json, re, os, sys, html
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

plan_path = BOOK_DIR / f"audio/chapter_{CHAPTER_N}/generation_plan.json"
assets_path = PROJECT_DIR / ".hilo/assets.json"

plan = json.loads(plan_path.read_text())
assets = json.loads(assets_path.read_text())


def clean_text(text):
    # Unescape HTML entities (plan stores &lt;#N#&gt; from HTML-escaped source scripts)
    text = html.unescape(text)
    # Strip pause markers
    text = re.sub(r'<#[\d.]+#>', '', text).strip()
    # Normalize smart/curly quotes to ASCII (TTS metadata normalizes these on storage)
    text = text.replace('\u201c', '"').replace('\u201d', '"')
    text = text.replace('\u2018', "'").replace('\u2019', "'")
    return text


blob_meta = {}
for a in assets:
    if a.get("type") == "audio" and a.get("blobRef"):
        blob_meta[a["blobRef"]] = {
            "voice_id": a.get("metadata", {}).get("voice_id", ""),
            "text": clean_text(a.get("metadata", {}).get("prompt", "")),
        }

errors = []
for entry in plan:
    if not entry.get("blob_path"):
        continue
    blob_ref = Path(entry["blob_path"]).name
    meta = blob_meta.get(blob_ref)
    if not meta:
        errors.append(f"  [{entry['index']}] blob {blob_ref} not found in assets.json")
        continue
    expected_text = clean_text(entry["text"])
    if meta["voice_id"] != entry["voice_id"]:
        errors.append(f"  [{entry['index']}] voice_id mismatch: plan={entry['voice_id']}, blob={meta['voice_id']}")
    if meta["text"] != expected_text:
        errors.append(f"  [{entry['index']}] text mismatch:\n    plan: {expected_text[:80]}\n    blob: {meta['text'][:80]}")

if errors:
    print(f"VERIFICATION FAILED: {len(errors)} mismatches found")
    for e in errors:
        print(e)
    for entry in plan:
        blob_ref = Path(entry.get("blob_path", "")).name if entry.get("blob_path") else ""
        meta = blob_meta.get(blob_ref)
        if meta and (meta["voice_id"] != entry["voice_id"] or meta["text"] != clean_text(entry["text"])):
            entry["blob_path"] = None
    with open(plan_path, 'w', encoding='utf-8') as f:
        json.dump(plan, f, ensure_ascii=False, indent=2)
    print("Mismatched entries cleared -- run Failure & Retry")
else:
    print(f"Verification passed: all {len([e for e in plan if e.get('blob_path')])} blobs correct. Proceed to Step 4.")
