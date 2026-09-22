# Phase 1: Text Analysis

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

## 1.1 Chapter Splitting

Automatically identify chapter boundaries:
- Common chapter markers: `Chapter X`, `CHAPTER X`, `Part X`, numbered headings, etc.
- For Chinese text: `第X章`, `第X节`, etc.
- If automatic identification fails, ask the user to specify the delimiter
- Generate `analysis/chapters.md` recording each chapter's title and position range

## 1.2 Character & Dialogue Identification

Three sequential steps: **regex pre-processing** (deterministic) → **character pre-identification** (LLM) → **LLM segmentation** (speaker attribution).

---

### Step A: Regex Pre-processing (MANDATORY script)

**Executor:** Bundled script — no LLM needed. **Run it directly, do NOT rewrite it.**
**Input:** `source/book.txt`
**Output:** `analysis/chapter_{N}/preprocessed.txt` — each line contains either pure narration or pure dialogue, never both.

```bash
python3 $AUDIOBOOK_SCRIPTS/preprocess_chapter.py <chapter_number>
```

**This script is MANDATORY — do NOT skip it or write your own regex.**

---

### Step A2: Character Pre-identification (LLM)

**Before segmenting**, scan the **full chapter text** to build a character list. This gives the LLM global context for speaker attribution.

**Executor:** LLM via `text_generation` MCP tool.
**Input:** `preprocessed.txt` from Step A.
**Output:** `analysis/characters.md` — format see `references/characters-example.md`.

**Prompt template for character identification:**

```
Read the following chapter text and identify ALL speaking characters.

For each character, provide:
1. Name (as it appears in the text)
2. Gender (if determinable)
3. Brief description (role, relationship to other characters)
4. Example dialogue line (one quote from the text)

Rules:
- Only list characters who SPEAK (have quoted dialogue)
- The narrator is NOT a character
- If a character is referred to by multiple names/titles, note all variants
- Pay attention to attribution phrases like "X said", "X replied", "X asked"

Text:
{preprocessed_text}
```

Write `analysis/characters.md` with the results. This character list will be used in Step B for speaker attribution.

---

### Step B: LLM Segmentation

**Executor:** LLM via `text_generation` MCP tool.
**Input:** `preprocessed.txt` from Step A + `characters.md` from Step A2.
**Output:** `analysis/chapter_{N}/segments.json` — format see `references/segments-example.json`.

The LLM's task is to:
1. Mark each line as `narration` or `dialogue` (Step A already split them, but the LLM decides the **type** — e.g., a quoted letter may be narration)
2. For dialogue lines, identify who is speaking using the character list from Step A2

**Prompt template for segmentation:**

```
You are segmenting a chapter for audiobook production.

Known characters in this chapter:
{characters_list}

For each line of the preprocessed text, output a JSON segment:
- Narration (anything outside quotes, or quoted non-speech like letters/signs):
  {"type": "narration", "voice": "narrator", "text": "..."}
- Dialogue (a character speaking):
  {"type": "dialogue", "voice": "<character name>", "character": "<character name>", "text": "..."}

Speaker identification rules:
- Use surrounding attribution ("张叔说", "she replied") to determine the speaker
- In alternating two-person conversations, track the turn-taking pattern
- If the previous line is narration containing a character name + speech verb, the next dialogue belongs to that character
- Mark unattributable dialogue as voice: "unknown", character: "unknown"
- Use the EXACT character name from the characters list above

Text to segment:
{preprocessed_text}
```

**Attribution Validation (CRITICAL):**
After segmentation, verify all speaker attributions:
1. Check against story context — who is speaking to whom?
2. For 2-speaker conversations, verify the alternating pattern is consistent
3. Correct any wrong attributions before proceeding

**Output files:**
- `analysis/chapter_{N}/segments.json` — **IMPORTANT: write with Python `json.dump()`, not Bash echo/heredoc** (Chinese curly quotes `""` break hand-built JSON)

**segments.json must include a `voice` field on EVERY segment:**
- Narration segments: `"voice": "narrator"`
- Dialogue segments: `"voice": "<character name>"` (same value as the `character` field)
- This `voice` field is the **single source of truth** for voice assignment in all downstream phases. See `references/segments-example.json` for the exact format.

**Before writing**, ensure directories exist:
```python
from pathlib import Path
(BOOK_DIR / "analysis" / f"chapter_{N}").mkdir(parents=True, exist_ok=True)
```

---

### Step C: Attribution Validation Script (MANDATORY)

After writing `segments.json`, run the bundled validation script to detect common attribution errors:

```bash
python3 $AUDIOBOOK_SCRIPTS/validate_segments.py <chapter_number>
```

The script checks: unknown speakers, missing `voice`/`character` fields, and flags runs of 3+ consecutive same-speaker dialogue for review.

**This script is MANDATORY — run it after every `segments.json` is written.** If ERRORs appear, fix the segments before proceeding to Phase 2.
