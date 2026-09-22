# Phase 3: Voice Preview & Feedback

## Script Setup (Run Once Per Session)

Read `skillScriptsPath` from the state file — written by Phase 0 with the skill's real install path:

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

A clean path (no ERROR) means scripts are ready.

**If you see `skillScriptsPath missing from state`:** Do NOT re-run Phase 0 just for this. Instead, derive the path directly from the `available_skills` list visible in your system context — find the `<location>` entry for the audiobook skill (e.g. `file://<skills-dir>/audiobook/SKILL.md`), strip `file://` and `/SKILL.md`, append `/scripts`. Then patch the state file:

```python
import json
from pathlib import Path
audiobook_root = Path(os.getcwd()) / ".audiobook"
state_path = next(audiobook_root.glob("*/.audiobook-state.json"))
state = json.loads(state_path.read_text())
state["skillScriptsPath"] = "/derived/path/to/audiobook/scripts"  # replace with actual
state_path.write_text(json.dumps(state, ensure_ascii=False, indent=2))
```

Then re-run the Script Setup block above.

---

## Speed Rules (Reference)

Speed is assigned **by role**, not by the voice's natural characteristics:

| Role | Default Speed |
|------|--------------|
| Narrator | **0.9** |
| All characters (actors) | **1.0** |

User may override via the preview page feedback buttons.

---

## Workflow

Execute these steps **in this exact order**:

```
Step 1: Get voice candidates  →  Step 2: Extract preview text
→  Step 3: Generate preview samples  →  Step 4: Build preview data JSON
→  Step 5: Launch preview page (BLOCKING)  →  Step 6: Handle feedback
```

---

## Step 1: Get Voice Candidates

Read character list from `analysis/characters.md`. Call `get_voice_id` **once per role** — one for narrator, one per character.

### Voice Selection Priority (filter layer by layer)

1. **Language match** (hard): Chinese books → Chinese voices only. English books → English voices only.
2. **Gender match** (hard): Male characters → male voices. Female characters → female voices.
3. **Age match** (hard): Elderly → aged/gravelly. Young → bright/energetic. Middle-aged → steady/mature.
4. **Personality match** (soft): Best style match (cheerful / calm / authoritative, etc.)

### Narrator Voice Rules

- Use **storyteller/narrator-type voices** suitable for sustained narration
- Must be easy to listen to without fatigue (this is the "baseline" voice)
- **Narrator and character voices must not overlap**

### Calling Pattern

```
# ✅ CORRECT — one call per role, returns a list of all matching voices
#    then YOU pick 3 candidates from the returned list
get_voice_id(user_requirement="English male narrator storytelling calm warm")
get_voice_id(user_requirement="English female young warm gentle emotional")

# ❌ WRONG — calling 3 times per role to "get 3 candidates"
#    get_voice_id already returns multiple results; one call is enough
get_voice_id(user_requirement="English male narrator warm")
get_voice_id(user_requirement="English male narrator calm")
get_voice_id(user_requirement="English male narrator cinematic")

# ❌ WRONG — combining all roles into one call
get_voice_id(user_requirement="English audiobook: (1) narrator; (2) female young; (3) male middle-aged")
```

**Concurrency:** `get_voice_id` is mostly a local cache lookup, but max **4 parallel calls** to be safe.

**Fallback:** If no results, consult `references/voices-backup-overseas.md`.

> **Note:** `female-chengshu` (mature female voice) has known audio artifact issues — **do not use**.

### Output

Select **exactly 3 candidates** (1 primary + 2 alternates) per role. Candidates should differ in style to give the user real choice. Each needs: `voice_id`, `name`, `description`.

---

## Step 2: Extract Preview Text

Preview samples should be **~10 seconds** of speech (roughly 25–40 words for English narration, 15–25 words for dialogue). Do NOT use long paragraphs.

Good examples:
```
# Narrator (~10s): 1 atmospheric sentence
"The museum closed at six.<#0.5#> By six fifteen, the last guard had finished his rounds<#0.3#> and the motion sensors armed themselves with a faint electronic chirp.<#0.6#>"

# Character dialogue (~8s): 1-2 punchy lines
"What are you doing in the building, Margaret?<#0.3#> Your department doesn't have after-hours access this week.<#0.5#>"
```

---

## Step 3: Generate Preview Samples

Generate one preview audio per **candidate voice** per role. Use the **same text** for all candidates of the same role (for fair A/B comparison).

### Step 3.1: Build Preview Generation Plan

**Before any `audios_generation` call**, write `voice_samples/preview_plan.json`.

**Do NOT add `filename` fields** — the `print_preview_calls.py` script auto-assigns normalized filenames (pattern: `preview_{role}_{index}`).

```json
[
  {
    "role": "narrator",
    "sample_text": "<#0.2#>The museum closed at six...<#0.2#>",
    "speed": 0.9,
    "candidates": [
      { "voice_id": "English_CaptivatingStoryteller", "voice_name": "Captivating Storyteller" },
      { "voice_id": "English_WarmNarrator", "voice_name": "Warm Narrator" },
      { "voice_id": "English_DeepVoice", "voice_name": "Deep Voice" }
    ]
  },
  {
    "role": "alice",
    "sample_text": "What a beautiful day.",
    "speed": 1.0,
    "candidates": [
      { "voice_id": "English_Kind-heartedGirl", "voice_name": "Kind Girl" },
      { "voice_id": "English_GentleWoman", "voice_name": "Gentle Woman" },
      { "voice_id": "English_WarmFemale", "voice_name": "Warm Female" }
    ]
  }
]
```

**Validation before proceeding:**
- Every role must have **exactly 3 candidates** with distinct `voice_id` values
- Narrator candidates must NOT overlap with any character's candidates
- `sample_text` must be identical for all candidates within the same role

### Step 3.2: Generate preview samples (MANDATORY script)

Run the bundled script to print all `audios_generation` calls grouped by wave:

```bash
python3 $AUDIOBOOK_SCRIPTS/print_preview_calls.py
```

The script auto-assigns `filename` fields (pattern: `preview_{role}_{index}`) if missing and writes them back to `preview_plan.json`.

Then fire the printed calls wave by wave:
- 1 text per call, max 3 calls per wave — **fire all calls in a wave simultaneously (in parallel), NOT one by one**
- Wait for ALL calls in a wave to complete before the next wave
- If any call fails, sleep 30 seconds then continue to the next wave. Do NOT retry inline.

**DO NOT** batch multiple candidates into one call or skip the `filenames` parameter.

### Step 3.3: Map blobs to candidates (MANDATORY script)

After all calls complete, run the bundled script to match generated blobs back to candidates via `filename`:

```bash
python3 $AUDIOBOOK_SCRIPTS/match_preview_blobs.py
```

The script reads `preview_plan.json` + `assets.json`, matches by filename (last-write-wins), and updates `preview_plan.json` with `blob_path` for each candidate.

### Step 3.4: Organize preview files (MANDATORY script)

Move preview audio files from the project root into `voice_samples/samples/` and update `assets.json` paths:

```bash
python3 $AUDIOBOOK_SCRIPTS/organize_preview_files.py
```

The script reads `preview_plan.json` for filenames, moves `.mp3` and `_subtitle.json` files, and updates `assets.json` path fields. Idempotent — safe to re-run.

---

## Step 4: Build Preview Data JSON (MANDATORY script)

Run the bundled script to generate `preview_data.json` from `preview_plan.json` (with `blob_path` from Step 3.3):

```bash
python3 $AUDIOBOOK_SCRIPTS/build_preview_data.py [--lang zh]
```

If `--lang` is omitted, auto-detects from `.audiobook-state.json` or book content. Set `--lang zh` when the user communicates in Chinese, `--lang en` otherwise.

The script reads `preview_plan.json`, transfers `blob_path` to `samplePath`, and validates all audio files exist.

**Do NOT construct preview_data.json by hand.** Always use this script.

---

## Step 5: Launch Preview Page

**⚠️ This is the most commonly skipped step. Do NOT skip it.**

This is a **blocking operation** — the script runs a local server and waits for the user to submit feedback on the page.

### Action sequence (all three are required):

**1. Send notification to the user:**

> All voice preview samples are ready! Opening the Voice Preview page now.
> On the page you can switch voices, mark speed/volume, add notes, and click Confirm & Continue when done.

(Use Chinese if the user communicates in Chinese. Adapt the message naturally — no need to copy a template verbatim.)

**2. Launch the preview server (BLOCKING call):**

```bash
python3 $AUDIOBOOK_SCRIPTS/render_preview.py /path/to/preview_data.json
```

The script prints `PREVIEW_URL=http://127.0.0.1:<port>`, opens the browser, and **blocks until the user clicks "Confirm & Continue"**. After submission, it writes `voice_settings.json` and `feedback.md` to the same directory as the input JSON, then exits.

**3. After the script exits**, read the generated `voice_settings.json` and proceed to Step 6.

> **Note on canvas**: `audios_generation` auto-registers every generated audio into `assets.json`, so preview samples appear on the canvas. This is expected and acceptable — they will be visually superseded by the final chapter audio.

---

## Step 6: Feedback Handling

### Speed/Volume Feedback

The preview page uses radio-style toggles:
- Speed: `"slower"` / `"ok"` / `"faster"`
- Volume: `"louder"` / `"ok"` / `"quieter"`

**Speed adjustment: ±0.03 per step** (e.g. "faster" → 0.9 → 0.93, "slower" → 0.9 → 0.87).

### Submit behavior

- **Empty feedback**: LGTM — save selections to `voice_settings.json`, proceed to Phase 4
- **With feedback text**:
  - Speed/volume tweak → apply new parameters, offer to regenerate
  - New voice request → re-query `get_voice_id`, regenerate, refresh preview
  - Other → handle based on content

### voice_settings.json Format

The `label` field must match the voice tag used in `scripts/chapter_N.md` (e.g., `voice: zhang_shu`).

```json
{
  "pauseDensity": "medium",
  "narrator": {
    "voiceId": "Chinese (Mandarin)_Lyrical_Voice",
    "speed": "ok",
    "volume": "ok"
  },
  "characters": [
    {
      "name": "张叔",
      "label": "zhang_shu",
      "voiceId": "Chinese (Mandarin)_Humorous_Elder",
      "speed": "ok",
      "volume": "ok"
    }
  ]
}
```

**Important:** Field name is `voiceId` (camelCase) — this matches what the HTML preview page saves.
