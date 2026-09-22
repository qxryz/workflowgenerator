# Final Video Spec Template (3D Manhua Half-Narrated Short Drama · v2.0)

Use this template before key element generation and assembly. **Confirm with the user via `question` (CHECKPOINT 3) before any expensive generation.** All user-facing fields follow the user's current language.

## Spec fields

- Drama title
- Episode number
- Aspect ratio
- Target duration
- Output language
- **user_language** [NEW for v2.0.3] — detected from the user's first message; locked for the session; drives all ULF rules. Default to `zh-CN` if undetectable.
- **output_language** [NEW for v2.0.3] — the language the user wants the final product's user-facing text (subtitles, delivery message) in. Default = `user_language`. Can be overridden (e.g. a Chinese user publishing to English-speaking platforms can set `output_language: en-US` while keeping `user_language: zh-CN`).
- **Visual style lock** (this Skill's only supported visual family)

> [v2.0.5] This Skill is mixed mode (narration + dialogue) only. Narration-only or dialogue-only stories should use a different Skill.
  - `visual_style_lock`: `3D-manhua-cel` (locked)
  - `visual_sub_mode`: `guoman-3d-render` (default) / `pixar-disney` / `semi-painterly-3d` — from STEP 0
  - `style_prompt_block`: paste the matching block from `references/style-presets.md` into every image/video prompt
- Narrative / dialogue balance (default 60% / 40%)
- Protagonist narrator profile
- World / era / conflict system
- Subtitle mode
- Delivery platform
- Shot count target
- Continuity rules
- **Story preservation rules** [HARD GATE, NEW for v2.0]
  - `no_plot_point_deletion`: `true` (no plot point may be deleted, compressed, or rewritten to fit timing)
  - `narration_dialogue_overlap_resolution`: `split-or-extend` (overlap must be resolved by splitting the shot or extending its duration, never by hard-stacking or deleting content)
  - `script_reconciliation_required`: `true` (STEP 5.5 must produce a `script_reconciliation_table` before STEP 5.6)
  - `narration_locked_after_step_5`: `true` (narration text is a hard fact from STEP 5.6 onward — no deleting to fit timing)
- **3D Manhua Asset Plan** (the core difference from 2D)
  - `character_assets`: list of main characters, each requires:
    - `main_card`: 1 (front 3/4 view, clean face + wardrobe + signature props)
    - `three_view_sheet`: 1 (front + side + back views side-by-side)
  - `scene_assets`: list of main scenes, each requires:
    - `main_card`: 1 (main camera angle, architecture + furniture + lighting)
    - `auxiliary_card`: 1 (different camera angle for variety)
  - `prop_assets`: at most 1 prop card
- **Shot Duration Plan** (3D Manhua vs 2D)
  - `normal_shot_duration`: 8.0s default (range 6–10s, H3 10s mode)
  - `combat_fast_cut_duration`: 5.0s default (range 4–6s, H3 6s mode)
  - `max_shot_duration`: 10.0s (HARD ceiling)
- **Reset-anchor cadence** (3D Manhua vs 2D)
  - `protagonist_reset_every`: 4 shots (2D is 3)
  - `supporting_reset_every`: 6 shots (2D is 5)
  - `scene_reset_every`: 5 shots (2D is 4)
- **First-frame angle match rule** (3D manhua)
  - `first_frame_angle_match_required`: `true`
  - `angle_match_table`:
    - side-tracking / parallel move → use `character_three_view_side`
    - back-view / chase → use `character_three_view_back`
    - front-facing / establishing → use `character_main_card`
- **Audio rules**
  - `narrator_voice_id` (default the locked catalog narrator voice) — locked for the full episode
  - `narrator_voice_preset_label` (e.g. `抖音解说男声`) — human-readable name
  - `narrator_gender_match` (NEW for v2.0): the voice gender must match the genre track per `references/voice-presets.md`'s auto-recommend table
  - `narrator_speed` (default `1.0`, allow ±10% per shot)
  - **`narrator_volume` (NEW for v2.0.1)**: default `1.8` (range 1.2-2.0). Default 1.0 is forbidden — it makes narration inaudible in noisy viewing environments and breaks the half-narrated short drama's core function.
  - `narrator_emotion_default` (default `neutral`)
  - `dialogue_volume`: `1.0` (default; video render's original audio)
  - `sfx_volume_range`: `0.3-0.5` (SFX and ambience must stay below narration + dialogue)
  - `dialogue_voice_map`: {speaker_role → voice_id}
  - `narration_dialogue_overlap_allowed`: `false` (unless explicitly approved)
  - `audio_timing_mode`: `schedule-first-per-shot` (v2.0.2 rename of `narration-first-per-shot`; STEP 5.6 generates TTS for both narration AND dialogue preview)
  - **`shot_audio_schedule` (NEW for v2.0.2)**: per-shot audio time window plan. See `references/audio-timeline.md` for schema. The schedule is the central artifact of v2.0.2 and is the single source of truth for STEP 6 prompt (`audio_schedule` block) and STEP 6.5 drift check.
- **Video model policy**: MiniMax-H3 is the default; explicit user-selected alternatives require a capability check
  - `backend`: `平台当前可用的视频能力` (default)
  - **`video_model`**: `MiniMax-H3` — **默认模型**。所有镜头必须用 image-to-video 模式，first_frame 必传，10s 时长为主，6s 模式仅用于战斗/快切镜。用户明确选择其他模型时先检查能力，兼容后遵循选择；不允许退化到 text-to-video。
  - **`video_model_params`**:
    - `frame_role`: `"first_frame"` (always)
    - `opening_frame_image`: 必传（first_frame 锚点，由 first_frame 决策表选）
    - `duration`: `10` (default) / `6` (combat / fast-cut only)
    - `resolution`: `1080P` (default)
    - `multimodal_refs`: 角色主卡 + 三视图（正/侧/背）+ 场景主辅卡 + 道具卡
  - `allowed_text_to_video_fallback`: `false` (unless explicit user approval)
- Global exclusions
  - `no_text_overlay_in_shot_render`: `true`
  - `no_watermark_in_shot_render`: `true`
  - `no_baked_in_bgm_in_shot_render`: `true`
- **Canvas gate** [HARD GATE, NEW for v2.0]
  - `place_final_spec_on_canvas`: `true`
  - `place_core_assets_on_canvas`: `true` (immediately after generation, BEFORE video generation starts)
  - `user_confirms_canvas_assets_before_video`: `true` (Step B of STEP 6 cannot start until user confirms)
- **User-language following** [HARD GATE, NEW for v2.0]
  - `user_language`: detected from the user's first message; written in ISO format (e.g. `zh-CN`, `en-US`)
  - `all_user_facing_text_in_user_language`: `true`
  - `preserve_user_provided_text_verbatim`: `true` (character names, scene names, user-written dialogue)

## Lock rules

1. Confirm the spec before expensive generation (CHECKPOINT 3).
2. Keep the visual base clearly 3D manhua. **Never** drift to 2D cel, Pixar/Disney cartoon, photoreal CG, or live-action.
3. Do not change the locked format later unless the user approves it.
4. Preserve the intended ending turn or cliffhanger through assembly.
5. **Lock the narrator voice in STEP 0** and never swap `voice_id` mid-episode. See `references/voice-presets.md` for the curated preset list and the auto-recommend table.
6. If narration and dialogue are both used, add a per-shot audio timeline and keep the windows non-overlapping unless explicitly approved (see `references/audio-timeline.md`).
7. Place the final spec and core asset cards on canvas for review before final generation.
8. **3D Manhua specific**: per main character, BOTH `main_card` AND `three_view_sheet` must be generated before any shot; per main scene, BOTH `main_card` AND `auxiliary_card` must be generated. Skipping either is a HARD FAIL.
9. **Story preservation [HARD GATE]**: no plot point may be deleted, compressed, or rewritten to fit timing. STEP 5.5 reconciliation must be passed before STEP 5.6.
10. **Canvas gate [HARD GATE]**: core assets must be on canvas before STEP 6 Step B starts.
11. **User-language following [HARD GATE]**: all user-facing output in the user's current language; user-provided text preserved verbatim.

## Example Spec (default, urban suspense, 90s, 3D manhua)

```yaml
drama_title: "她在凌晨三点按下了门铃"
episode_number: 1
aspect_ratio: "9:16"
target_duration: "90s"
output_language: "zh-CN"  # final product's user-facing text language
user_language: "zh-CN"  # [v2.0.3] detected from user's first message, drives all ULF rules
visual_style_lock: "3D-manhua-cel"
visual_sub_mode: "guoman-3d-render"
style_prompt_block: |
  3D rendered, Chinese-animation manhua-cel look, clean dark outlines on top of 3D shading, soft PBR materials with non-photoreal finish, dynamic manhua panel composition, dramatic cinematic light, webtoon-friendly vertical framing, no live-action, no Pixar-style CG, no 2D flat illustration, no watermark, no baked-in text
narrative_dialogue_balance: "60% / 40%"
protagonist_narrator_profile:
  voice: "first-person female, 28 岁, 都市白领, 失眠, 偏冷静"
narrator_voice_id: "Chinese (Mandarin)_Male_Announcer"
narrator_voice_preset_label: "抖音解说男声"
narrator_gender_match: "ok"  # [NEW for v2.0] 都市悬疑 → 男声 ✅
narrator_speed: 1.0
narrator_volume: 1.8  # [NEW for v2.0.1] 旁白音量比默认大 80%
dialogue_volume: 1.0
sfx_volume_range: 0.3-0.5
narrator_emotion_default: "neutral"
dialogue_voice_map:
  protagonist: "female-chengshu"
  antagonist: "female-yujie"
  supporting: "male-qn-jingying"
narration_dialogue_overlap_allowed: false
audio_timing_mode: "schedule-first-per-shot"  # [v2.0.2] STEP 5.6 双轨 TTS（旁白 + 对白预演）
shot_audio_schedule:  # [NEW for v2.0.2] STEP 5.6 锁定的总表（每镜）
  - shot_id: 01
    narration_window: [0.0, 3.6]
    dialogue_window: null
    fits_in_shot: true
  - shot_id: 03
    narration_window: [0.0, 2.8]
    dialogue_window: [3.3, 5.1]
    fits_in_shot: true
story_preservation_rules:  # [NEW for v2.0]
  no_plot_point_deletion: true
  narration_dialogue_overlap_resolution: "split-or-extend"
  script_reconciliation_required: true
  narration_locked_after_step_5: true
world: "现代都市, 2026 年, 北京某小区"
conflict_system: "独居女性 vs 楼上神秘邻居"
subtitle_mode: "hard-burn"
delivery_platform: "douyin"
shot_count_target: 14
continuity_rules:
  - "主角每镜必穿同一件灰色家居服"
  - "门铃声每次都从画面右上方出现"
character_assets:
  - name: "林夏"
    role: "protagonist"
    main_card: "assets/characters/林夏_main.png"
    three_view_sheet: "assets/characters/林夏_3view.png"
  - name: "楼上神秘人"
    role: "antagonist"
    main_card: "assets/characters/楼上人_main.png"
    three_view_sheet: "assets/characters/楼上人_3view.png"
scene_assets:
  - name: "林夏_家_客厅"
    main_card: "assets/scenes/林夏家_客厅_main.png"
    auxiliary_card: "assets/scenes/林夏家_客厅_aux.png"
  - name: "楼道"
    main_card: "assets/scenes/楼道_main.png"
    auxiliary_card: "assets/scenes/楼道_aux.png"
prop_assets: []
normal_shot_duration: 8.0
combat_fast_cut_duration: 5.0
max_shot_duration: 10.0
protagonist_reset_every: 4
supporting_reset_every: 6
scene_reset_every: 5
first_frame_angle_match_required: true
backend: "平台当前可用的视频能力 (10s mode)"
video_model: "MiniMax-H3"  # 默认模型；其他模型需用户明确选择并通过能力检查
video_model_params:
  frame_role: "first_frame"  # 必传 first_frame
  opening_frame_image: "<必填，由 first_frame 决策表选>"
  duration: 10  # 默认 10s（6s 仅战斗/快切）
  resolution: "1080P"
  multimodal_refs:  # 多模态参考（角色主卡/三视图/场景主辅卡/道具卡）
    - character_main_card
    - character_three_view_sheet
    - scene_main_card
    - scene_auxiliary_card
    - prop_card
allowed_text_to_video_fallback: false  # 不允许退到 text-to-video（除非用户显式批准）
no_text_overlay_in_shot_render: true
no_watermark_in_shot_render: true
no_baked_in_bgm_in_shot_render: true
place_final_spec_on_canvas: true  # [NEW for v2.0]
place_core_assets_on_canvas: true  # [NEW for v2.0]
user_confirms_canvas_assets_before_video: true  # [NEW for v2.0]
all_user_facing_text_in_user_language: true  # [NEW for v2.0]
preserve_user_provided_text_verbatim: true  # [NEW for v2.0]
```
