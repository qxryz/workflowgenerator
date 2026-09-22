#!/usr/bin/env python3
"""Phase 2 Sub-step 1.5: Validate and auto-fix pause markers in segments.json.

Usage: python3 scripts/validate_pause_markers.py <chapter_number>

Auto-fixes common LLM mistakes:
  <#0.6>   -> <#0.6#>   (missing closing #)
  <#0.6s#> -> <#0.6#>   (spurious s suffix)
  <# 0.6 #> -> <#0.6#>  (whitespace around number)
  <#0.3-0.5#> -> <#0.4#> (range -> average)

If unfixable markers remain, exits with error.
"""
import json, os, re, sys
from pathlib import Path

PROJECT_DIR = Path(os.getcwd())
AUDIOBOOK_ROOT = PROJECT_DIR / ".audiobook"
BOOK_DIR = next(d for d in sorted(AUDIOBOOK_ROOT.iterdir()) if d.is_dir() and (d / ".audiobook-state.json").exists())

CHAPTER_N = int(sys.argv[1]) if len(sys.argv) > 1 else 1

segments_path = BOOK_DIR / "analysis" / f"chapter_{CHAPTER_N}" / "segments.json"
segments = json.loads(segments_path.read_text(encoding="utf-8"))

# --- Fix patterns (order matters) ---

# 1. Range pattern: <#0.3-0.5#> or <#0.5~0.8#> -> average
RANGE_PATTERN = re.compile(r'<#\s*(\d+(?:\.\d+)?)\s*[-~]\s*(\d+(?:\.\d+)?)\s*#?>')

def fix_range(m):
    lo, hi = float(m.group(1)), float(m.group(2))
    avg = round((lo + hi) / 2, 2)
    return f"<#{int(avg) if avg == int(avg) else avg}#>"

# 2. Spurious 's' suffix: <#0.6s#> -> <#0.6#>
S_SUFFIX_PATTERN = re.compile(r'<#\s*(\d+(?:\.\d+)?)\s*s\s*#>')

def fix_s_suffix(m):
    return f"<#{m.group(1)}#>"

# 3. Missing closing #: <#0.6> -> <#0.6#>
MISSING_HASH_PATTERN = re.compile(r'<#\s*(\d+(?:\.\d+)?)\s*>')

def fix_missing_hash(m):
    return f"<#{m.group(1)}#>"

# 4. Whitespace around number: <# 0.6 #> -> <#0.6#>
WHITESPACE_PATTERN = re.compile(r'<#\s+(\d+(?:\.\d+)?)\s+#>')

def fix_whitespace(m):
    return f"<#{m.group(1)}#>"


total_fixes = 0
fix_details = []

for i, seg in enumerate(segments):
    text = seg["text"]
    original = text

    # Apply fixes in order
    text, n = RANGE_PATTERN.subn(fix_range, text)
    if n:
        fix_details.append(f"  segment {i}: {n} range(s) averaged")
    total_fixes += n

    text, n = S_SUFFIX_PATTERN.subn(fix_s_suffix, text)
    if n:
        fix_details.append(f"  segment {i}: {n} 's' suffix(es) removed")
    total_fixes += n

    text, n = MISSING_HASH_PATTERN.subn(fix_missing_hash, text)
    if n:
        fix_details.append(f"  segment {i}: {n} missing closing '#' fixed")
    total_fixes += n

    text, n = WHITESPACE_PATTERN.subn(fix_whitespace, text)
    if n:
        fix_details.append(f"  segment {i}: {n} whitespace(s) cleaned")
    total_fixes += n

    seg["text"] = text

# Check for any remaining malformed markers
VALID_MARKER = re.compile(r'<#\d+(?:\.\d+)?#>')
MAYBE_MARKER = re.compile(r'<#[^>]*>')
unfixable = []

for i, seg in enumerate(segments):
    for m in MAYBE_MARKER.finditer(seg["text"]):
        if not VALID_MARKER.match(m.group()):
            unfixable.append(f"  segment {i}: {m.group()} at pos {m.start()}")

# Write back if fixes were made
if total_fixes > 0:
    segments_path.write_text(json.dumps(segments, ensure_ascii=False, indent=2), encoding="utf-8")

# Report
print(f"Chapter {CHAPTER_N}: {len(segments)} segments scanned")
if total_fixes > 0:
    print(f"Auto-fixed {total_fixes} marker(s):")
    for d in fix_details:
        print(d)
    print(f"Updated: {segments_path}")
else:
    print("No fixes needed.")

if unfixable:
    print(f"\nERROR: {len(unfixable)} unfixable marker(s) found:")
    for u in unfixable:
        print(u)
    print("Fix these manually before proceeding.")
    sys.exit(1)
else:
    print("\nAll markers valid.")
