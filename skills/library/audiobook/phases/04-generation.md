# Phase 4: Chapter Audio Generation

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

## 4.1 Core Principle: TTS Built-in Silence

**Never add silence or crossfade via ffmpeg in post-processing.** All silence must come from `<#X#>` pause markers in the TTS text. TTS-generated silence shares the same noise floor and audio characteristics as the speech, preventing waveform discontinuities at splice points.

## 4.2 TTS Text Silence Padding

Each segment's TTS text needs head/tail silence padding. **This is applied automatically by the Step 1 script — do NOT manually edit segment text.**

The chapter script from Phase 2 already contains inline `<#X#>` pause markers. Step 1 preserves ALL existing markers and adds head/tail padding on top.

**Padding rules (applied automatically in Step 1):**

| Position | Head Padding | Tail Padding |
|----------|-------------|-------------|
| First segment of book | `<#2#>` | `<#0.2#>` |
| Last segment of book | `<#0.2#>` | `<#3#>` |
| Chapter ending (not last) | `<#0.2#>` | `<#2#>` |
| Normal segment | `<#0.2#>` | `<#0.2#>` |

## 4.3 TTS Generation (Parallel with Pre-Indexed Plan)

**The ONLY rule that matters: 1 text per call, max 3 calls per wave. Run every script below — do NOT skip any.**

Generation uses **parallel `audios_generation` calls** with a **pre-indexed generation plan** to guarantee correct playback order regardless of completion timing.

Each segment from the chapter script becomes **one entry** in the generation plan — no merging or grouping.

### Step 1: Parse Chapter Script & Build Generation Plan (MANDATORY script)

This script does everything:
1. Reads the chapter script (preserving ALL `<#X#>` markers from Phase 2)
2. Parses segment delimiters and headers
3. Maps voice labels to voice_ids via `voice_settings.json`
4. Applies 4.2 head/tail padding
5. Outputs `generation_plan.json`
6. **Prints every wave's calls — use these directly for Step 2**

```bash
python3 $AUDIOBOOK_SCRIPTS/build_generation_plan.py <chapter_number>
```

The script auto-detects chapter title from `chapters.md` and first/last chapter from `.audiobook-state.json`. It also validates voice assignment and warns if dialogue segments fall back to narrator voice.

**This script is MANDATORY — run it first, then use its output for Step 2.**

### Step 2: Fire TTS calls wave by wave

Use the exact calls printed by Step 1. Each call has exactly **1 text** and **1 filename**.

**Rules:**
- Fire up to 3 calls per wave (copy the calls from Step 1 output) — **fire all 3 simultaneously (in parallel), NOT one by one**
- Wait for ALL calls in a wave to complete before starting the next wave
- No sleep needed between successful waves
- **If any call fails → sleep 30 seconds, then continue to the next wave.** Do NOT retry the failed call inline. All failures are handled after Step 3.5 by the Failure & Retry script, which reads parameters from `generation_plan.json` (guaranteed correct). Inline retry risks using wrong parameters from LLM context.

**Example (from Step 1 output):**
```
# Wave 1 (fire these 3 calls in parallel):
audios_generation(texts=["<#0.2#>She opened the door.<#0.5#>"], voice_id="narrator", speed=0.9, filenames=["ch1_idx_0"])
audios_generation(texts=["Hello!"], voice_id="alice", speed=1.0, filenames=["ch1_idx_1"])
audios_generation(texts=["<#0.2#>He waved back.<#0.2#>"], voice_id="narrator", speed=0.9, filenames=["ch1_idx_2"])

# Wait for wave 1 to complete. Then wave 2:
audios_generation(texts=["Good morning."], voice_id="bob", speed=1.0, filenames=["ch1_idx_3"])
...
```

**DO NOT:**
- Put multiple texts in one call: `texts=["a", "b", "c"]` is WRONG
- Invent your own filenames — use the `ch{N}_idx_{M}` from Step 1
- Skip Step 1 and construct calls yourself

### Step 3: Match blobs to plan (MANDATORY script)

After all TTS calls complete, run this to map generated audio files back to plan entries:

```bash
python3 $AUDIOBOOK_SCRIPTS/match_blobs.py <chapter_number>
```

The script reads `generation_plan.json` + `assets.json`, matches by filename (last-write-wins for retries), and updates `generation_plan.json` with `blob_path` for each entry.

### Step 3.5: Verify blob content (MANDATORY script)

Verify every matched blob's metadata matches the plan (catches wrong voice_id or text from misfired calls):

```bash
python3 $AUDIOBOOK_SCRIPTS/verify_blobs.py <chapter_number>
```

The script compares voice_id and cleaned text from `assets.json` metadata against `generation_plan.json`. Mismatched entries have their `blob_path` cleared so the Retry script picks them up.

**How `clean_text()` works (important for debugging false positives):**

The script normalises both sides before comparing:
1. **`html.unescape()`** — the chapter script (Phase 2 output) may store pause markers as `&lt;#0.6#&gt;` (HTML-escaped) rather than `<#0.6#>`. The plan inherits this encoding. The TTS metadata always stores raw markers. Unescaping before stripping ensures both sides match.
2. **Smart-quote → ASCII normalisation** — the plan may contain Unicode curly quotes (`"` / `"` / `'` / `'`). The TTS engine normalises these to straight ASCII quotes (`"` / `'`) in stored metadata. Both sides are normalised before comparison.

If you see unexpected "text mismatch" failures on Step 3.5, check `generation_plan.json` for `&lt;` / `&gt;` or `\u201c` / `\u201d` — these indicate the source script was HTML-escaped or contained smart quotes. The script handles both automatically; no manual fix needed.

### Step 3.6: Organize segment files (MANDATORY script)

Move segment audio files from the project root into `audio/chapter_{N}/segments/` and update `assets.json` paths:

```bash
python3 $AUDIOBOOK_SCRIPTS/organize_segment_files.py <chapter_number>
```

The script reads `generation_plan.json` for filenames, moves `.mp3` and `_subtitle.json` files, and updates `assets.json` path fields. Idempotent — safe to re-run after retries.

### Step 4: Write manifest (MANDATORY script)

```bash
python3 $AUDIOBOOK_SCRIPTS/write_manifest.py <chapter_number>
```

The script reads `generation_plan.json`, writes `manifest.txt` in playback order, and verifies all blob files exist on disk.

### Failure & Retry (MANDATORY script)

If Step 3 reports unmatched segments, run this to get retry calls:

```bash
python3 $AUDIOBOOK_SCRIPTS/print_retry_calls.py <chapter_number>
```

The script cleans old workspace `.mp3` files (prevents gateway dedup suffix), then prints exact retry calls grouped by wave (max 3 per wave).

**Retry procedure:**
1. Run Step 3 (blob matching) + Step 3.5 (verification) to identify all failures
2. Run the Failure & Retry script above — it reads `generation_plan.json` and prints exact calls
3. Sleep 20 seconds (let system recover from transient issues)
4. Fire the printed calls (max 3 per wave) — do NOT modify the parameters
5. Re-run Step 3 + Step 3.5 → re-run this script → repeat until all matched

**CRITICAL:** Never construct retry calls yourself. Always use this script's output. The script reads parameters from `generation_plan.json`, ensuring text, voice_id, speed, and filename are all correct. Manual retry from memory is the #1 cause of wrong audio content.

Never skip a failed segment. The manifest requires every segment to have a blob_path.

### TTS text limits

- Each text should not exceed 2500 characters
- If a single segment is too long, split by sentence into sub-segments connected with `<#0.2#>`
- Sub-segments share the same voice_id and get consecutive indices in the plan

## 4.4 Concatenation & Export

### Step 1: Verify manifest

```bash
python3 $AUDIOBOOK_SCRIPTS/write_manifest.py <chapter_number>
```

This is the same script as Step 4 — it writes `manifest.txt` and verifies every file exists. Run it again here to confirm nothing changed between generation and concatenation.

### Step 2: Delegate to editing sub-agent

Pass the **exact ordered file list from manifest.txt** to the editing sub-agent. **Do NOT re-sort or re-order** — the manifest is the single source of truth.

```
请帮我拼接以下音频片段成一个完整的章节文件。
不需要 crossfade、fade 或 DC removal — 直接拼接即可。

片段列表（按顺序排列，不要重新排序）：
1. /abs/path/to/.hilo/.blobs/{uuid1}.mp3
2. /abs/path/to/.hilo/.blobs/{uuid2}.mp3
3. /abs/path/to/.hilo/.blobs/{uuid3}.mp3
...

格式要求：MP3, 44100Hz, 256kbps
输出文件名：chapter_{N}.mp3
完成后请返回输出文件路径和时长。
```

**Important:**
- Input file list MUST come from `manifest.txt`
- Number each file to make order unambiguous
- Do NOT specify an output path — let the editing agent decide
- The editing sub-agent automatically handles canvas registration (writes to both project root and `.hilo/.blobs/`, registers in `assets.json`)

### Filename rules

- Individual segments: `ch{N}_idx_{M}` (generated by Step 1 script, do not change)
- Final chapter audio: `chapter_{N}.mp3`
- **Never use Chinese characters in any audio filename** — canvas registration silently fails

## 4.5 Audio Quality Check

After each chapter's final audio is exported, run the quality checker:

```bash
python3 $AUDIOBOOK_SCRIPTS/audio_check.py /path/to/exported_chapter.mp3
```

> **ffmpeg dependency:** `audio_check.py` and `generate_assembly_report.py` both shell out to `ffmpeg` / `ffprobe`. If `ffmpeg` is not on `$PATH`, prepend the binary location:
> ```bash
> PATH="/opt/homebrew/Cellar/ffmpeg/8.1/bin:$PATH" python3 $AUDIOBOOK_SCRIPTS/audio_check.py ...
> ```
> Find the binary with: `find /usr /opt /Users -name "ffmpeg" -type f 2>/dev/null | head -3`

If issues are found, delegate fixes to the **editing sub-agent**:
- **Pops/clicks**: Apply adeclick/adeclip filter
- **DC offset > 1%**: Apply dcshift correction
- **Clipping**: Reduce volume and regenerate the affected segments

**Energy spikes are normal:** The quality checker reports "energy spikes" at segment boundaries (silence → speech onset from hard-cut concatenation). These are expected and require no action — they are not audio artifacts.

## 4.6 Assembly Report

After the quality check passes, generate a markdown assembly report. This is the **single source of truth** for users to inspect, locate, and request re-edits of any segment.

### What it contains

A markdown table with one row per segment:

| Column | Content |
|--------|---------|
| `#` | Segment index (primary identifier for re-edit requests) |
| `Start` / `End` | Precise timestamps `hh:mm:ss.ss` via ffprobe |
| `Voice ID` | The actual `voice_id` used |
| `Local File` | Root-directory filename (matches canvas display) |
| `Text` | Clean spoken text with `<#X#>` markers stripped |

### Generation script

```bash
python3 $AUDIOBOOK_SCRIPTS/generate_assembly_report.py <chapter_number>
```

> **ffmpeg dependency:** This script uses `ffprobe` to compute timestamps. If `ffprobe` is not on `$PATH`, prepend the binary location (same as 4.5 above).

The script reads `generation_plan.json`, uses ffprobe to compute timestamps, maps blob refs to local filenames via `assets.json`, and writes `{book_name}_chapter_{N}_assembly.md` to the project root. Auto-detects language for tips text.

> **Canvas note:** The canvas does not render markdown tables — only header lines are previewed. Users can open the assembly report in any markdown viewer for the full table.

### Re-edit workflow

When the user requests changes (e.g. "segment #14 sounds too fast"):
1. Look up index 14 in `generation_plan.json` for `voice_id`, `speed`, `text`, `filename`
2. Regenerate: `audios_generation(texts=[new_text], voice_id=..., speed=..., filenames=[filename])`
3. Re-run Step 3 blob matching to pick up the new blob (latest entry with same filename wins)
4. Rewrite `manifest.txt` from updated plan
5. Re-concatenate via editing sub-agent
6. Re-run quality check and regenerate assembly report

## 4.7 Final User Message (REQUIRED)

After the assembly report is generated, send a completion message. Match the user's language.

Include:
- Final audio filename (UUID on canvas)
- Duration
- Cast list (narrator + characters)
- Assembly report filename
- How to request fixes (mention segment # number)
- Options: generate next chapter / re-edit a segment

## 4.8 Multi-Chapter Generation

> **Note:** True background/parallel chapter generation is not currently supported.
> Chapters are processed one at a time (sequentially) to ensure quality and allow user review between chapters.

**After the first chapter is confirmed by the user:**

1. Tell the user how many chapters remain and ask if they want to continue generating them
2. For each remaining chapter, follow the full 4.2–4.6 workflow in order:
   - Build generation plan → Fire TTS waves → Match blobs → Verify → Organize → Write manifest → Concatenate → Quality check → Assembly report
3. After each chapter completes, update `chaptersCompleted` in `.audiobook-state.json`
4. Notify the user that chapter N is done, show duration and assembly report filename, then ask whether to proceed to the next chapter or stop

## Error Handling

- TTS generation failure: Sleep 20s then retry. Never skip — keep retrying until success.
- File parsing failure: Prompt the user to check file format
- Audio concatenation failure: Check file paths and formats
