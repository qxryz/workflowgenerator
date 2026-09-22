# Phase 2: Text Rewriting (Adding Pause Markers)

## Script Setup (Run Once Per Session)

```bash
export AUDIOBOOK_SCRIPTS=$(python3 -c "
import json, os
from pathlib import Path

audiobook_root = Path(os.getcwd()) / '.audiobook'
hits = list(audiobook_root.glob('*/.audiobook-state.json')) if audiobook_root.exists() else []
if not hits:
    print('ERROR: state file not found — run Phase 0 first'); exit(1)
data = json.loads(hits[0].read_text())
val = data.get('skillScriptsPath', '').strip()
if not val:
    print('ERROR: skillScriptsPath missing from state — re-run Phase 0'); exit(1)
if not Path(val).is_dir():
    print(f'ERROR: skillScriptsPath does not exist: {val}'); exit(1)
print(val)
")
echo "AUDIOBOOK_SCRIPTS=$AUDIOBOOK_SCRIPTS"
```

A clean path (no ERROR) means scripts are ready. If you see `skillScriptsPath missing from state`, derive the path from the `<location>` entry for the audiobook skill in your `available_skills` list (strip `file://` and `/SKILL.md`, append `/scripts`) and patch the state file — same procedure as Phase 3/4.

---

## Input / Output

- **Input:** `analysis/chapter_{N}/segments.json` from Phase 1 (each segment is already unambiguously narration or dialogue).
- **Output:** `scripts/chapter_{N}.md` — the same segments with `<#X#>` pause markers inserted. See `references/chapter-script-example.md` for the complete format.

## Pause Marker Syntax

Use the TTS engine's native `<#X#>` pause syntax, where X is pause duration in seconds (supports decimals).

**CRITICAL: The format is `<#0.5#>`, NOT `<#0.5s#>`. Never add `s` after the number. The `s` suffix causes TTS to read the marker as literal text instead of pausing, resulting in audio 3x longer than expected.**

- Correct: `<#0.5#>`, `<#1.2#>`, `<#0.25#>`
- WRONG: `<#0.5s#>`, `<#1.2s#>`, `<#0.25s#>`
- WRONG: `<#0.3-0.5#>`, `<#0.5~0.8#>` — **never use ranges, pick one value**

## Pause Rules

**Narration** (includes attribution phrases like "she said," — these are narration segments per Phase 1):

| Scenario | Marker Example | Description |
|----------|---------------|-------------|
| Normal period/full stop | `<#0.6#>` | Natural inter-sentence pause |
| Paragraph end | `<#1.5#>` | Paragraph transition |
| Scene change | `<#2#>` | Environment/time transition |
| Ellipsis | `<#1.2#>` | Dramatic pause effect |
| Exclamation/question mark | `<#0.4#>` | Slightly shorter than period, maintains emotional continuity |
| Comma | `<#0.25#>` | Light breath (only add in long sentences) |
| After attribution phrase | `<#0.3#>` | Pause at end of "he said," before the next segment begins |

**Dialogue:**

| Scenario | Marker Example | Description |
|----------|---------------|-------------|
| End of dialogue line | `<#0.4#>` | Brief pause after line |
| Dialogue to narration transition | `<#0.8#>` | From dialogue back to narration |
| Between dialogue lines (same scene) | `<#0.6#>` | Two characters alternating |
| Hesitation within dialogue | `<#0.8#>` | Character's inner hesitation |

## Output Format

Phase 2 has two sub-steps:
1. **LLM adds pause markers** to segment text (update `segments.json` in-place with `<#X#>` markers)
2. **Python script generates `chapter_N.md`** from the updated `segments.json` — this guarantees `voice:` headers come directly from data, not LLM generation

### Sub-step 1: LLM adds pause markers

Read `segments.json`, add `<#X#>` pause markers to each segment's `text` field according to the Pause Rules above, and write the updated segments back to the same file.

**Do NOT generate `chapter_N.md` directly.** Only update the `text` field in `segments.json`.

### Sub-step 1.5: Validate pause markers (MANDATORY script)

After adding pause markers, run validation to catch and auto-fix malformed markers:

```bash
python3 $AUDIOBOOK_SCRIPTS/validate_pause_markers.py <chapter_number>
```

The script auto-fixes common LLM mistakes:
- `<#0.6>` → `<#0.6#>` (missing closing `#`)
- `<#0.6s#>` → `<#0.6#>` (spurious `s` suffix)
- `<# 0.6 #>` → `<#0.6#>` (whitespace around number)
- `<#0.3-0.5#>` → `<#0.4#>` (range → average)

If unfixable markers remain, the script exits with error — fix manually before proceeding.

### Sub-step 2: Generate chapter script

After pause markers are validated, run the bundled script to generate `chapter_N.md`:

```bash
python3 $AUDIOBOOK_SCRIPTS/generate_chapter_script.py <chapter_number>
```

The script reads `segments.json` and writes `chapter_N.md` with `voice:` headers directly from the `voice` field — no LLM generation involved.

**This script is MANDATORY — do NOT skip it or write `chapter_N.md` by hand.**
