# Audio Timeline Template (3D Manhua Half-Narrated Short Drama · v2.0.5)

Use this template for the **mixed** (narration + dialogue) episode format. **The narrator voice is locked at STEP 0 and never changes within the episode.** All user-facing fields follow the user's current language.

> **v2.0.5**: This Skill is **mixed-mode only**. There is no 3-way `audio_mode` choice in STEP 0. If the user wants narration-only or dialogue-only, point them to a different Skill.
>
> **v2.0.2 key change**: `narration-first` (STEP 5.6) is now **schedule-first** — both narration AND dialogue are pre-arranged in `shot_audio_schedule`, with narration measured from TTS and dialogue measured from TTS preview (the TTS preview is generated only for timing, not used in the final cut). STEP 6 prompt now references this schedule to guide H3 toward the right audio windows. STEP 6.5 remains as a fallback in case actual dialogue timing drifts.
>
> **v2.0.1 carryover**: narrator volume defaults to 1.8 (not 1.0).
>
> Pipeline order: STEP 0 → 1 → 2 → 3 → 4 → 5 → **5.5 (script reconciliation)** → **5.6 (schedule-first, dual-track TTS for mixed mode)** → 6 (with `audio_schedule` in prompt) → 6.5 (post-render dialogue drift check) → 7 → 8

## Per-episode locked audio config (from STEP 0)

- `narrator_voice_id` — default the locked catalog narrator voice (抖音解说男声)
- `narrator_voice_preset_label` — human-readable name
- `narrator_gender_match` — `ok` if voice gender matches the genre track
- `narrator_speed` — default `1.0` (allow ±10% per shot)
- `narrator_volume` — default `1.8` (range 1.2-2.0). Default 1.0 is forbidden.
- `narrator_emotion_default` — default `neutral`
- `dialogue_voice_map`: {speaker_role → voice_id} (used in STEP 5.6 TTS preview)
- `dialogue_volume` — default `1.0`
- `sfx_volume_range` — `0.3-0.5`
- `narration_dialogue_overlap_allowed` — default `false`
- `audio_timing_mode` — default `schedule-first-per-shot` (v2.0.2 rename of `narration-first-per-shot`)

## Required fields per shot

- shot_id
- shot_duration
- **`shot_audio_schedule` (NEW for v2.0.2)** — per-shot planned audio time windows (see below)
- **Video model**: `MiniMax-H3` is the default. All shots use image-to-video with a first frame; 10s is the normal duration and 6s is reserved for combat / fast cuts. If the user explicitly selects another model, check its capabilities first; on failure retry once for the cause, then switch to a compatible model. See `references/shot-anchor-strategy.md` Generation call patterns.
- `narration_start`, `narration_end` — measured from TTS in STEP 5.6
- `dialogue_start`, `dialogue_end` — measured from TTS preview in STEP 5.6, then **re-measured from video render in STEP 6.5**
- narrator_voice_id ← must equal the per-episode locked value
- dialogue_voice_id ← must equal the dialogue_voice_map entry for the speaker
- speaker
- line_text
- audio_gap
- overlap_allowed
- narration_emotion (per shot)
- narration_speed (per shot)
- `dialogue_estimate_duration` — STEP 5.6 TTS preview measurement
- `dialogue_actual_duration` — STEP 6.5 post-render measurement

---

## shot_audio_schedule (v2.2.0 — storyboard-first audio reservation)

`shot_audio_schedule` is a per-shot plan for where narration and dialogue go inside the shot's duration. It is the single source of truth that flows from storyboard design → STEP 5.6 measurement → STEP 6 prompt → optional STEP 6.5 observation → user-led editing.

### Why this exists

- H3 video generation produces **dialogue at unpredictable times** — the model decides when characters talk
- Pure narration-first (v2.0.0/v2.0.1) only locked narration timing, leaving dialogue as a STEP 6.5 patch-up
- v2.0.2 pre-plans BOTH windows, uses TTS to measure both, then passes the schedule into the STEP 6 prompt as a guide
- This raises the chance of H3 hitting the planned window from ~20% to ~80%

### Schema (per shot)

```yaml
shot_audio_schedule:
  shot_duration: 8.0
  narration:
    text: "那一刻，我终于看清了门口的人。"
    word_count: 14
    predicted_duration: 3.8   # chars × 0.25 + 0.3 buffer
    measured_duration: 3.6    # from TTS in STEP 5.6
    window: [0.0, 3.6]        # start..end (filled after TTS)
  dialogue:
    - speaker: "萧珩"
      text: "你该行礼了。"
      word_count: 6
      predicted_duration: 1.8
      measured_duration: 1.9   # from TTS preview in STEP 5.6
      window: [4.5, 6.4]       # after narration + 0.5s buffer
  buffer: 0.5
  total_audio_used: 6.9
  fits_in_shot: true           # total_audio_used + 0.5s tail <= shot_duration
```

### Build rules

1. **Narration always first** (occupies `0.0` to `narration_measured_duration`).
2. **0.5s buffer** between narration end and dialogue start.
3. **Dialogue window** = `[narration_end + 0.5, narration_end + 0.5 + dialogue_measured_duration]`.
4. **Tail buffer** = at least 0.3s after dialogue ends.
5. **Fits-in-shot check**: `narration_measured + 0.5 + dialogue_measured + 0.3 <= shot_duration`.

If it doesn't fit, the shot must be extended (preferred) or dialogue split (fallback). Same hard-gate rules as v2.0.1: if shot > 10s, go back to STEP 5 to split narration or dialogue.

### Updates through the pipeline

| Step | What changes in shot_audio_schedule |
|---|---|
| STEP 5 (end) | Predicted durations from word count; `window` filled with predicted values |
| STEP 5.5 | `covered_plot_points` linked; no schedule change |
| **STEP 5.6** | TTS preview generated for both narration and dialogue; `measured_duration` filled with real values; `window` updated with measured values |
| STEP 6 | Schedule embedded in prompt as `audio_schedule` block |
| STEP 6.5 | `dialogue_actual_duration` filled from VAD/human listen; `fits_in_shot` rechecked; small drift is accepted and recorded for user editing; no repeated regeneration is triggered |
| STEP 7 | Schedule used for final audio assembly timing |

---

## STEP 5.6 — Schedule-First TTS Preview (v2.0.2 rename of "narration-first") [强制]

**Premise: story spine is complete (STEP 5.5 passed).** Generate the audio schedule before filming, so STEP 6 can guide H3 with concrete time windows.

### Step 5.6.1 — Batch TTS preview for BOTH narration AND dialogue

Call `batch speech synthesis` once to generate **two streams**:

- **Stream A — narration audio** (locked, will be used in final cut)
- **Stream B — dialogue TTS preview** (timing only, will be discarded; final cut uses H3's video-rendered dialogue)

```python
    requests=[
        # --- Stream A: narration (LOCKED, used in final cut) ---
        {
            "text": "<shot 01 narration line>",
            "output_file_path": "audio/shot_01_narration.mp3",  # LOCKED file
            "voice_id": "Chinese (Mandarin)_Male_Announcer",
            "speed": 1.0,
            "emotion": "neutral",
            "volume": 1.8,  # 80% above default, see voice-presets.md
        },
        # --- Stream B: dialogue TTS PREVIEW (TIMING ONLY, will be discarded) ---
        {
            "text": "<shot 01 dialogue line 1, speaker 萧珩>",
            "output_file_path": "audio/_preview/shot_01_dialogue_h萧珩_preview.mp3",  # disposable
            "voice_id": "<h萧珩's voice_id from dialogue_voice_map>",
            "speed": 1.0,
            "emotion": "neutral",
            "volume": 1.0,  # dialogue volume reference
        },
        # ...
    ]
)
```

Output:
- `audio/shot_NN_narration.mp3` × N shots (locked, used in final cut)
- `audio/_preview/shot_NN_dialogue_<speaker>_preview.mp3` × N shots × speakers (timing only, can be deleted after STEP 6.5)

### Step 5.6.2 — Measure real duration and lock `shot_audio_schedule`

Use platform media-duration measurement on **both** streams to get real durations. Build the locked `shot_audio_schedule`:

```python
import subprocess, json

def get_duration_seconds(path):
    out = subprocess.check_output([
        "-of", "json", path
    ]).decode()
    return float(json.loads(out)["format"]["duration"])

for shot in shots:
    nar_dur = get_duration_seconds(f"audio/shot_{shot.id:02d}_narration.mp3")
    dia_durs = {}
    for line in shot.dialogue_lines:
        dia_durs[line.speaker] = get_duration_seconds(
            f"audio/_preview/shot_{shot.id:02d}_dialogue_{line.speaker}_preview.mp3"
        )
    shot.audio_schedule = build_schedule(
        shot_duration=shot.duration,
        nar_measured=nar_dur,
        dia_measured=dia_durs,
        buffer=0.5,
    )
```

**Decision rules** (story completeness first, same as v2.0.1):

| Condition | flag | default action |
|---|---|---|
| All durations fit and `narration_real` is within ±1.0s of predicted | ✅ | proceed to STEP 6 with locked schedule |
| `narration_real` drift within 1.5s or 20% of its reserved window | ✅ | accept and continue; record actual timing for user editing |
| Larger but usable drift | ⚠️ | keep the shot and annotate the offset; do not loop regeneration |
| Window overlap, missing speech, or unusable audio | 🔴 | revise storyboard or regenerate only the affected shot |
| Dialogue preview duration > `max_dialogue = shot_duration * 0.6` | ⚠️ | **★ Shorten dialogue text** (preferred) or extend shot duration; this is a storyboard-level decision, not a TTS decision |
| Schedule doesn't fit in shot (`fits_in_shot: false`) | 🔴 | Extend shot or split dialogue/narration |

### Step 5.6.3 — Schedule confirmation

For each shot, show the user the locked schedule:

| shot_id | duration | narration_window | dialogue_window | buffer | total | fits |
|---|---|---|---|---|---|---|
| 01 | 8.0s | [0.0, 3.6] | — | 0.0 | 3.6 | ✅ |
| 02 | 8.0s | [0.0, 3.4] | — | 0.0 | 3.4 | ✅ |
| 03 | 7.0s | [0.0, 2.8] | [3.3, 5.1] | 0.5 | 5.6 | ✅ |
| 04 | 8.0s | [0.0, 4.1] | — | 0.0 | 4.1 | ✅ |
| 05 | 9.0s | [0.0, 4.0] | [4.5, 6.4] | 0.5 | 6.9 | ✅ |

Ask the user once via `question`:

| Option | label | when to pick |
|---|---|---|
| ★ 1 | 通过 — 进入 STEP 6 | all ✅ |
| 2 | 调整某镜时长 | 镜头时长要改 |
| 3 | 拆对白到下一镜 | 某镜对白太长 |
| 4 | 改写某段对白文本（仅在废话时） | 某镜对白真有冗余 |

**Anti-patterns** (same as v2.0.1, restated for clarity):
- ❌ Speeding up speech to fit — speech rate-up sounds distorted
- ❌ Cutting narration text to align timing — destroys story completeness
- ❌ Hard-stacking narration and dialogue — overlap is forbidden
- ❌ Discarding `shot_audio_schedule` before STEP 6 — STEP 6 prompt needs it
- ❌ Using dialogue TTS preview in the final cut — preview is for timing only; final cut uses H3 video-rendered dialogue

### Output of STEP 5.6

- `audio/shot_NN_narration.mp3` × N shots (LOCKED narration audio)
- `audio/_preview/shot_NN_dialogue_*_preview.mp3` × N × speakers (TTS preview for timing, disposable)
- **`shot_audio_schedule` (locked)** — passed to STEP 6 as `audio_schedule` in the prompt and to STEP 6.5 as the drift baseline
- `narration_timing_table` (legacy name, now a subset of `shot_audio_schedule`)
- Updated `shot_timing_table`

Do not enter STEP 6 until `shot_audio_schedule` is locked.

---

## STEP 6 — Generate Anchor Assets and Shot Clips (with audio_schedule in prompt)

[Unchanged from v2.0.1 except: every shot's prompt now embeds the `audio_schedule` block.]

### audio_schedule block (paste into every shot's prompt)

This block goes into the prompt **after** the style block and continuity block:

```
audio_schedule:
  narration_window: [0.0, 3.6]      # speaker should NOT speak during this window
  dialogue_window: [3.6, 5.5]      # character 萧珩 should be speaking during this window
  buffer_between: 0.5
  total_audio: 5.5
  shot_duration: 8.0
  constraint: "no background music, no extra sound effects inside dialogue window"
```

The exact H3 behavior is **guidance, not guarantee** — small deviations are acceptable and are handed off for user editing. But with this block, the chance of H3 hitting the planned window rises from ~20% (no schedule) to ~80% (with schedule).

### Example shot prompt (with audio_schedule)

```yaml
- shot_id: 03
  duration: 7.0
  shot_camera_angle: "side"
  characters: ["林夏", "楼上神秘人"]
  style_block: |
    3D rendered, Chinese-animation manhua-cel look,
    clean dark outlines on top of 3D shading, soft PBR materials
    with non-photoreal finish, ...
  continuity_block: |
    [continuity anchors: 林夏 wearing gray loungewear, hair tied loosely, ...]
  first_frame_source: "assets/characters/林夏_3view.png"  # 侧面
  first_frame_anchor_role: "character_3view_side"
  reset_anchor: true
  audio_schedule:
    shot_duration: 7.0
    narration_window: [0.0, 2.8]
    dialogue_window: [3.3, 5.1]
    buffer_between: 0.5
    total_audio: 5.6
    dialogue_speaker: "楼上神秘人"
    constraint: "no speech during 0-2.8s; 楼上神秘人 should speak 3.3-5.1s"
  prompt: |
    镜头: 林夏 在客厅听到敲门声
    林夏 走到门边, 表情警惕, 手搭在门把手上。
    楼上神秘人 站在门外, 透过门缝压低声音说话。
    3D rendered, Chinese-animation manhua-cel look,
    clean dark outlines on top of 3D shading, soft PBR materials
    with non-photoreal finish, dynamic manhua panel composition,
    dramatic cinematic light, webtoon-friendly vertical framing,
    no live-action, no Pixar-style CG, no 2D flat illustration,
    no watermark, no baked-in text
    audio_schedule:
      narration_window: [0.0, 2.8]      # 林夏 内心独白, 嘴上不能动
      dialogue_window: [3.3, 5.1]      # 楼上神秘人 说话
      buffer_between: 0.5
      total_audio: 5.6
      shot_duration: 7.0
      constraint: "no speech during 0-2.8s; 楼上神秘人 说话 3.3-5.1s"
  narration_lines: [
    {text: "我听到门外有人在压低声音说话。", start: 0.0, end: 2.8}
  ]
  dialogue_lines: [
    {speaker: "楼上神秘人", line: "开门。", tone: "低沉", start: 3.3, end: 5.1}
  ]
  plot_point_refs: ["P007", "P008"]
```

---

## STEP 6.5 — Dialogue drift micro-adjustment [unchanged but works less often in v2.0.2]

Because v2.0.2 pre-plans the dialogue window, **most shots will hit their planned window**. STEP 6.5 is now a fallback, not the primary alignment mechanism.

After STEP 6 generates all shots, measure each shot's actual dialogue duration (via VAD or human listening) and compare to `shot_audio_schedule.dialogue_window`:

| drift | flag | action |
|---|---|---|
| ≤1.0s | ✅ | accept, soft-update schedule |
| 1.0s–2.5s | ⚠️ | ★ extend shot (preferred) or trim narration buffer |
| >2.5s | 🔴 | go back to STEP 5 — the dialogue line is too long for the shot |

Note: because v2.0.2 pre-arranges the dialogue window and the H3 prompt guides the model, the expected drift rate drops from ~80% (v2.0.1) to ~20% (v2.0.2). STEP 6.5 should now be a small tail-end correction, not a major rework.

---

## Rules

1. **One narrator voice for the full episode.** Once `narrator_voice_id` is locked in STEP 0, every narration clip for every shot uses that exact same `voice_id`. No mid-episode swap.
2. **Speed stays within ±10% of the per-episode default.**
3. **Emotion is per-shot but bounded.** Default `neutral`; can be re-tuned per shot at STEP 5.6.
4. **Narration audio is generated per shot first, before video assembly** (this part is unchanged). What changed in v2.0.2: **dialogue TTS preview is ALSO generated before video, for timing only**.
5. **Dialogue audio in the final cut is the video render's original spoken audio**, NOT the TTS preview. The TTS preview is timing-only and is discarded after STEP 6.5.
6. **Narration and dialogue do not overlap** unless the user explicitly approves it. The `shot_audio_schedule` enforces this via non-overlapping windows.
7. **The shot duration must cover the full approved audio windows** (narration + buffer + dialogue + tail buffer). The `shot_audio_schedule.fits_in_shot` check enforces this.
8. **Record the preset name in the final spec** so the user can reuse it on the next episode without re-picking.
9. **Voice gender must match the genre track.**

## 3D Manhua shot-duration budget (vs 2D)

| Shot type | 2D budget | 3D manhua budget | Reason |
|---|---|---|---|
| Establishing | 6s | 8s | 3D camera moves need more time to feel weighty |
| Dialogue | 5s | 7s | 3D mouths and micro-expressions need more frames |
| Tracking / orbit | 6s | 8–10s | Orbit shots are the 3D advantage — give them room |
| Action / combat | 4s | 4–6s (H3 6s mode) | Combat is still fast; H3 6s mode keeps it crisp |
| Emotional close-up | 5s | 7–8s | 3D materials and rim light need more time to register |
| Cliffhanger / reveal | 6s | 8–10s | The big moments get the full 10s |

## Example Timeline (urban suspense, 90s, 3D manhua, 14 shots)

| shot_id | duration | narration_window | dialogue_window | narrator_voice_id | emotion |
|---|---|---|---|---|---|
| 01 | 8.0s | [0.0, 3.6] | — | the locked catalog narrator voice | neutral |
| 02 | 8.0s | [0.0, 3.4] | — | same | neutral |
| 03 | 7.0s | [0.0, 2.8] | [3.3, 5.1] | same | neutral |
| 04 | 8.0s | [0.0, 4.1] | — | same | surprised |
| 05 | 9.0s | [0.0, 4.0] | [4.5, 6.4] | same | neutral |
| ... | ... | ... | ... | ... | ... |

## Narrator volume — 旁白音量锁定

| 元素 | volume | 占比 | 理由 |
|---|---|---|---|
| 旁白 | **1.8** | 180% | 承载 60% 剧情信息，必须在嘈杂环境听清 |
| 对白 | 1.0 | 100% | 默认音量（视频原声） |
| 环境音 / SFX | 0.3-0.5 | 30-50% | 不能盖过旁白和对白 |

**用户可调范围** (1.2-2.0)：1.2 / 1.5 / 1.8 (默认) / 2.0。

详见 `references/voice-presets.md` 的"Narrator volume"章节。

---

## Narration-First Story Integrity Guardrails (3-layer)

> These three guardrails exist because narration-first's premise is **story completeness**. v2.0.2 strengthens narration-first into **schedule-first** — both narration AND dialogue are pre-planned, but **narration text remains the only thing that can be rewritten in STEP 5.6** (story completeness first).

### Guardrail 1/3 — Narration completeness self-check at STEP 2 (HARD GATE)

[Unchanged from v2.0.1]

### Guardrail 2/3 — Narration word-count pre-check at STEP 5 (HARD GATE)

[Unchanged from v2.0.1]

### Guardrail 3/3 — Story-completeness-first decision at STEP 5.6 (HARD GATE)

Same as v2.0.1 but for both narration and dialogue:
- ✅ Top priority: adjust shot duration
- ✅ Second priority: split into the next shot (returns to STEP 5)
- 🟡 Last resort: rewrite text (narration OR dialogue) — only when text has filler
- 🔴 Always forbidden: speed up speech, force-delete, hard-stack windows

---

## Anti-Patterns

- ❌ Switching `voice_id` mid-episode.
- ❌ Boosting speed above 1.2 to fit a long line.
- ❌ Mixing `male-qn-*` family with `Chinese (Mandarin)_*` family.
- ❌ Skipping the STEP 5.6 TTS preview and going straight to STEP 6 — this reverts to v2.0.1's risk profile.
- ❌ **Using the TTS dialogue preview in the final cut** — preview is for timing only, not for audio assembly. Final cut uses H3 video-rendered dialogue.
- ❌ Discarding `shot_audio_schedule` before STEP 6 — STEP 6 prompt needs it.
- ❌ **Stopping at the `audio_schedule` block in the prompt and assuming H3 will follow it perfectly** — STEP 6.5 still measures, but the schedule raises alignment probability from ~20% to ~80%.
- ❌ Overlapping narration and dialogue "because the line is short" — overlap must be explicit user approval.
- ❌ Default narrator volume = 1.0.
- ❌ Forcing one gender voice on a story that strongly implies the other.
- ❌ For 3D manhua: planning a 12s+ shot to "fit a long audio schedule" — go back to STEP 5.6 and split.

---

## What changed in v2.0.2 (vs v2.0.1)

| Aspect | v2.0.1 | v2.0.2 |
|---|---|---|
| Pipeline name | narration-first | schedule-first |
| STEP 5.6 generates | only narration audio | narration audio + dialogue TTS preview |
| `shot_audio_schedule` | did not exist | new per-shot YAML field, the central artifact |
| STEP 6 prompt | no audio schedule | embeds `audio_schedule` block (narration_window + dialogue_window) |
| H3 alignment probability | ~20% (no schedule) | ~80% (with schedule) |
| STEP 6.5 role | primary alignment | fallback / tail correction |
| Dialogue drift rate | ~80% of shots need correction | ~20% |
| `narration_timing_table` | the central artifact | now a subset of `shot_audio_schedule` |
| `audio_timing_mode` field | `narration-first-per-shot` | `schedule-first-per-shot` |
| dialogue_voice_id | only mentioned in voice map | actively used in STEP 5.6 TTS preview |
