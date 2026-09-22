# Storyboard Design Template (3D Manhua Half-Narrated Short Drama · v2.0)

Use this template to turn a short-drama episode into a shot-by-shot plan. **Every shot must include a style block** so the visual style stays locked, and **every shot must include a first_frame anchor with angle match** so character/scene consistency is preserved. All user-facing fields follow the user's current language.

## Required fields per shot

- Shot ID
- Beat role
- Estimated duration
- Scene
- Characters
- **Style block** ← mandatory; copy from `references/style-presets.md` based on the locked sub-mode
- **Continuity block** ← continuity anchors (wardrobe, hair, 3D material, lighting, palette)
- **First-frame anchor** ← mandatory; see `references/shot-anchor-strategy.md`
  - `first_frame_source`: file path
  - `first_frame_frame_role`: `"first_frame"` (default) or `"last_frame"`
  - `first_frame_anchor_role`: `"character_main_card"` / `"character_3view_side"` / `"character_3view_back"` / `"scene_main_card"` / `"scene_aux_card"` / `"prop_card"` (rare) / `"last_frame_of_shot_NN"` / `"reset_anchor"`
  - **`first_frame_angle_match`** (3D manhua): declare the camera angle of this shot and confirm the chosen anchor matches
    - `shot_camera_angle`: `"front"` / `"side"` / `"back"` / `"overhead"` / `"wide"` / `"close_up"` / `"three_quarter"`
    - `anchor_view`: `"front_3/4"` / `"side"` / `"back"` / `"main_card"` / `"aux_card"` / `"last_frame"`
    - `angle_match_confirmed`: `true` (mandatory before generation)
  - `reset_anchor`: `true` if this shot resets the cadence (every 4th protagonist shot, every 6th supporting shot, every 5th scene shot, or any natural scene cut / reverse angle / time jump)
- **`narration_lines`** ← uniform format: `[{text, start, end}]` (one entry per narration line; `end` filled in by STEP 5.6 from real TTS duration; `start` and `end` in seconds from shot start)
- **`dialogue_lines`** ← uniform format: `[{speaker, line, tone, start, end}]` (one entry per spoken line; `end` initially from STEP 5.6 TTS preview, **then re-measured by STEP 6.5 from video render**)
- **`narration_word_count`** ← per-shot Chinese character count, mandatory for STEP 5 pre-check
- **`narration_predicted_duration`** ← per-shot predicted TTS duration, mandatory for STEP 5 pre-check
- **`shot_audio_schedule`** (NEW for v2.0.2) ← mandatory — the central artifact that flows from STEP 5.5 → STEP 5.6 → STEP 6 (in prompt) → STEP 6.5 (drift check) → STEP 7 (assembly). See `references/audio-timeline.md` for full schema.
- Visual state start
- Visual state change
- Visual state end
- Blocking / position
- Camera move (3D Manhua can use orbit / tracking / push-pull / pan)
- Emotional turn
- Continuity lock
- Next-shot handoff

## Shot rules

1. One shot = one major story job.
2. Adjacent shots must change state or camera grammar.
3. Keep the handoff explicit.
4. Record what the next shot must inherit.
5. Do not repeat the same action or first frame in the next shot.
6. **Every shot's prompt must include the locked style block from `references/style-presets.md` — verbatim or near-verbatim.** Re-state the block per shot.
7. **Every shot MUST be generated in image-to-video mode** with a real anchor image in `first_frame_source`. Pure text-prompt video generation is forbidden.
8. **Every shot must have a `reset_anchor: true` flag at the correct cadence** (主角每 4 镜、配角每 6 镜、场景每 5 镜重置一次，或天然切镜/切场景时标 true).
9. **3D Manhua specific**: every shot must declare `shot_camera_angle` and `first_frame_angle_match` — the chosen anchor must match the camera angle of the shot. A side-tracking shot MUST use the side three-view card; a back-view shot MUST use the back three-view card. Mismatched angles cause 3D models to re-imagine the character.
10. If the locked sub-mode is `guoman-3d-render` (default), do not paste the `pixar-disney` block in any shot.
11. **Story preservation [HARD GATE]**: every `narration_lines.text` and `dialogue_lines.line` MUST appear in the STEP 5.5 `script_reconciliation_table` as `covered`. No plot point may be silently dropped at storyboard time.
12. **Narration word count [HARD GATE]**: every `narration_text` must satisfy the per-shot cap (28 chars normal / 32 chars key emotion / 36 chars long inner). If over, the shot must be split or the storyboard returned to STEP 2 for re-balancing.

## 3D Manhua camera move vocabulary

3D manhua camera moves are richer than 2D's. Use them intentionally, not decoratively:

| Move | What it does | Anchor guidance |
|---|---|---|
| **Static** | Camera doesn't move, character moves in frame | Any anchor (usually last_frame) |
| **Push-in** | Camera slowly moves toward subject | Use `last_frame` for continuity, or `character_main_card` for reset |
| **Pull-out** | Camera slowly moves away | Use `last_frame` |
| **Pan** | Camera rotates on a fixed axis | Use `last_frame` |
| **Tracking** | Camera follows subject moving sideways | **MUST use `character_3view_side`** |
| **Orbit** | Camera circles around subject | **Cycle through front → side → back three-view** |
| **Crane / overhead** | Camera moves vertically | Use `scene_main_card` or `scene_aux_card` |
| **Whip pan** | Fast pan with motion blur | Use `last_frame` of the source side |

## Per-shot template (with all 3D fields + v2.0 format)

```yaml
- shot_id: 04
  beat_role: "转折"
  duration: 8.0
  scene: "林夏_家_客厅"
  characters: ["林夏"]
  shot_camera_angle: "three_quarter"  # 3D manhua: 镜头实际角度
  style_block: |
    3D rendered, Chinese-animation manhua-cel look,
    clean dark outlines on top of 3D shading, soft PBR materials
    with non-photoreal finish, dynamic manhua panel composition,
    dramatic cinematic light, webtoon-friendly vertical framing,
    no live-action, no Pixar-style CG, no 2D flat illustration,
    no watermark, no baked-in text
  continuity_block: |
    [continuity anchors: 林夏 wearing gray loungewear, hair tied loosely, same face as character card; living room with warm key light from window left; soft amber palette]
  first_frame_source: "assets/characters/林夏_main.png"  # 主角登场 + 重置锚
  first_frame_frame_role: "first_frame"
  first_frame_anchor_role: "character_main_card"
  first_frame_angle_match:  # 3D manhua 必须
    shot_camera_angle: "three_quarter"
    anchor_view: "front_3/4"
    angle_match_confirmed: true
  reset_anchor: true  # 主角每 4 镜重置
  narration_lines: [
    {text: "那一刻，我终于看清了门口的人。", start: 0.0, end: null}  # end 由 STEP 5.6 填入
  ]
  dialogue_lines: []
  narration_word_count: 16  # [NEW for v2.0] STEP 5 pre-check 标注
  narration_predicted_duration: 4.3  # [NEW for v2.0] 字数 × 0.25s + 0.3s 缓冲
  visual_state_start: "林夏 手搭在门把手上，半侧身"
  visual_state_change: "门打开，门外是楼上神秘人"
  visual_state_end: "林夏 眼睛微微睁大"
  blocking_position: "门厅中央偏右"
  camera_move: "static with subtle push-in"
  emotional_turn: "从紧张到惊恐"
  continuity_lock: "灰家居服不变；客厅家具不变；光线方向不变"
  next_shot_handoff: "门外神秘人特写（用楼上人三视图正面）"
  plot_point_refs: ["P007", "P008"]  # [NEW for v2.0] 关联到 STEP 5.5 剧本对账表
  shot_audio_schedule:  # [NEW for v2.0.2] STEP 5.6 锁定的时间表
    shot_duration: 8.0
    narration:
      text: "那一刻，我终于看清了门口的人。"
      word_count: 14
      measured_duration: 3.6
      window: [0.0, 3.6]
    dialogue:
      - speaker: "萧珩"
        text: "你该行礼了。"
        word_count: 6
        measured_duration: 1.9
        window: [4.1, 6.0]
    buffer: 0.5
    total_audio_used: 6.5
    fits_in_shot: true
```

```yaml
# 跟踪运镜必须用侧视图
- shot_id: 05
  beat_role: "转折"
  duration: 8.0
  scene: "楼道"
  characters: ["林夏", "楼上神秘人"]
  shot_camera_angle: "side"
  ...
  first_frame_source: "assets/characters/林夏_3view.png"  # 三视图（用侧面）
  first_frame_frame_role: "first_frame"
  first_frame_anchor_role: "character_3view_side"
  first_frame_angle_match:
    shot_camera_angle: "side"
    anchor_view: "side"
    angle_match_confirmed: true
  camera_move: "tracking - follows 林夏 walking down the hallway"
  narration_lines: [
    {text: "他走近时，我听见自己的心跳。", start: 0.0, end: null}
  ]
  narration_word_count: 13
  narration_predicted_duration: 3.6
  plot_point_refs: ["P009"]
```

## What changed in v2.0.2 (vs v2.0.1)

| Field | v2.0.1 | v2.0.2 |
|---|---|---|
| `shot_audio_schedule` | did not exist | mandatory, central artifact |
| `dialogue_lines.end` source | only STEP 6.5 (post-render) | STEP 5.6 TTS preview first, then STEP 6.5 re-measure |
| STEP 5.6 produces | only narration audio | narration audio + dialogue TTS preview |
| STEP 6 prompt block | no audio schedule | `audio_schedule` block embedded |
| `audio_timing_mode` field | `narration-first-per-shot` | `schedule-first-per-shot` |

## What changed in v2.0 (vs v1.1)

| Field | v1.1 | v2.0 |
|---|---|---|
| `narration_lines` format | `narration_lines: []` (text only) | `[{text, start, end}]` (uniform, end filled by STEP 5.6) |
| `dialogue_lines` format | `dialogue_lines: []` (text only) | `[{speaker, line, tone, start, end}]` (end filled by STEP 6.5/7) |
| `narration_word_count` | did not exist | mandatory for STEP 5 pre-check |
| `narration_predicted_duration` | did not exist | mandatory for STEP 5 pre-check |
| `plot_point_refs` | did not exist | links to STEP 5.5 `script_reconciliation_table` |
| Reference to STEP 5.5 | did not exist | storyboard is the input to STEP 5.5 reconciliation |
| Reference to STEP 5.6 | called STEP 5.5 (old) | now correctly called STEP 5.6 (renamed) |
| `first_frame_angle_match` (3D field) | already present | kept + clarified |


## Storyboard-first audio reservation

Every shot must allocate narration and dialogue windows before video generation. The storyboard is incomplete unless each shot records `narration_window`, `dialogue_window`, `gap_sec`, `tail_buffer_sec`, and the reserved seconds for each speaking channel. Keep windows non-overlapping and leave dialogue below the full shot budget so narration never loses its slot. Small post-render timing deviations are acceptable; record actual timing for user-led editing instead of repeatedly rewriting the storyboard or regenerating usable shots.
