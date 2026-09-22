# QC Checklist Template (3D Manhua Half-Narrated Short Drama · v2.0)

Use this checklist before delivery. Items marked **[HARD GATE]** must pass; if any fail, the episode is not ready to deliver. All checklist output is in the user's current language.

## Story

- [ ] Story hook is clear in the first 3 seconds
- [ ] Narration and dialogue are balanced (default 60% / 40%)
- [ ] The 5-beat chain is preserved (Setup → Pressure → Response → Turn → Cliffhanger/Payoff)
- [ ] Emotional arc from hook to ending is intentional, not accidental
- [ ] Episode actually resolves or teases as planned (no accidental softening of cliffhanger)

## Story preservation **[HARD GATE]** [NEW for v2.0]

- [ ] **[HARD GATE]** No original story beat from the script is deleted, compressed away, or rewritten to fit timing — the script fed in is the script delivered
- [ ] **[HARD GATE]** Every plot point, dialogue line, and reversal that exists in the input script still appears in the final storyboard and final cut
- [ ] **[HARD GATE]** If narration and dialogue would overlap in one shot, the shot is split, extended, or windows are offset — never hard-stacked and never resolved by deleting content
- [ ] **[HARD GATE]** STEP 5.6 (narration-first) was entered only after the story spine, beat chain, per-shot lines, and STEP 5.5 reconciliation were all complete (narration-first is a timing lock, not a story-patching tool)
- [ ] **[HARD GATE]** STEP 5.5 (script reconciliation) ran before STEP 5.6: every plot point from the original script is marked `covered` / `user-approved-deleted` / `moved-to-next-episode` in `script_reconciliation_table`; silently-dropped plot points are forbidden
- [ ] **[HARD GATE, NEW narration-first Guardrail 1/3]** STEP 2 narration completeness self-check was passed (5 self-check items all ✅)
- [ ] **[HARD GATE, NEW narration-first Guardrail 2/3]** STEP 5 narration word-count pre-check was passed (no shot's narration exceeds the per-shot cap: 28 chars normal / 32 chars key emotion / 36 chars long inner)
- [ ] **[HARD GATE, NEW narration-first Guardrail 3/3]** Story-completeness-first priority was honored at STEP 5.6: ⚠️ narrations preferred shot-duration adjustment; 🔴 narrations went back to STEP 5 (not narration text rewriting). Verify no narration words were deleted in STEP 5.6 to fix timing drift.

## Continuity

- [ ] Character identity stays stable (face / hair / wardrobe)
- [ ] Scene layout stays stable (architecture, room layout, location markers)
- [ ] Props do not drift (color, orientation, presence)
- [ ] Each shot's "next-shot handoff" was honored
- [ ] No accidental state changes between adjacent shots
- [ ] **3D Manhua specific [HARD GATE]**: 3D material block stays stable across same-character shots (skin, hair, fabric, accessories don't shift material type)

## First-frame anchors **[HARD GATE]**

- [ ] **[HARD GATE]** Every shot has a `first_frame_source` recorded in the storyboard (no nulls, no empty strings)
- [ ] **[HARD GATE]** Every shot video was generated in image-to-video mode with `opening_frame_image` set (no pure text-to-video shots)
- [ ] **[HARD GATE]** Every shot has a corresponding `clips/shot_NN_last.png` archived after generation
- [ ] **[HARD GATE]** Reset-anchor cadence (3D manhua, LONGER than 2D): protagonist every 4 shots, supporting character every 6 shots, scene every 5 shots, with `reset_anchor: true` flagged on the right shot
- [ ] **[HARD GATE]** Reverse-angle cuts and time jumps are flagged as `reset_anchor: true` (natural resets)
- [ ] **[HARD GATE]** The protagonist main card, every supporting character main card, every scene main card, AND every scene auxiliary card have a clean canonical file in `provided_assets/` or `assets/` and at least one shot actually used each as a first_frame
- [ ] **[HARD GATE, NEW for 3D]** Every main character has a `three_view_sheet` (front + side + back) generated in Step A, and at least one side-tracking / back-view / orbit shot actually used the matching 3-view card as `first_frame_source`
- [ ] **[HARD GATE, NEW for 3D]** Every shot's `shot_camera_angle` and `first_frame_anchor_role` are angle-matched: side-tracking shots use `character_3view_side`, back-view shots use `character_3view_back`, front-facing shots use `character_main_card`, scene variety shots use `scene_aux_card`. Mismatched angles are an instant hard fail.
- [ ] **[HARD GATE]** Asset count matches the simplified STEP 6 plan: per main character = 1 main card + 1 three-view sheet; per main scene = 1 main card + 1 auxiliary card; plus ≤1 prop card. No expression sheets, no pose sheets, no lighting variants, no costume-change sheets, no 360° turntables, no full lighting-variant scene sheets.
- [ ] Shot durations stay ≤ 10s for normal shots (combat / fast-cut 4–6s); longer shots are flagged with a justification in the storyboard

## Visual style **[HARD GATE]**

- [ ] **[HARD GATE]** `visual_style_lock == 3D-manhua-cel` is honored across every shot
- [ ] **[HARD GATE]** Every shot stays within the locked sub-mode (guoman-3d-render / pixar-disney / semi-painterly-3d)
- [ ] **[HARD GATE]** No 2D / flat-illustration drift in any shot (no clean 2D line art, no 2D webtoon, no flat color fills with no 3D shading)
- [ ] **[HARD GATE]** No Pixar / Disney cartoon drift in any shot (no rounded chibi shapes unless that is the locked sub-mode; no Pixar-style soft subsurface on all surfaces)
- [ ] **[HARD GATE]** No photoreal CG / live-action drift in any shot (no skin pores, no lens flares, no photoreal hair strands, no photographic texture)
- [ ] **[HARD GATE]** No accidental style mixing (no 2D-character-on-3D-background, no Pixar-shape-with-PBR-realistic-materials)
- [ ] **[HARD GATE]** No watermark, no baked-in platform text, no baked-in title overlays in any shot
- [ ] **[HARD GATE]** No accidental 2D / watercolor / ink-wash / oil-paint drift in any shot
- [ ] Camera changes support the beat chain (not random / not static). 3D manhua may use orbit / tracking / push-pull but each must serve the story.
- [ ] Style block was applied to every prompt (verify a sample of 5+ prompts)
- [ ] **[HARD GATE, NEW for 3D]** Material keywords appear in prompts: "PBR materials, non-photoreal finish, soft shading" (or matching sub-mode language). Pure-render or pure-painterly drift = fail.

## Audio **[HARD GATE]**

- [ ] **[HARD GATE]** STEP 5.6 (narration-first) was run before STEP 6: every shot's narration audio exists at `audio/shot_NN_narration.mp3` before any shot video is generated
- [ ] **[HARD GATE]** Every narration was generated in STEP 5.6 (not in STEP 7) — STEP 7 only assembles pre-generated audio
- [ ] **[HARD GATE]** `narration_timing_table` was produced and `shot_timing_table` was locked before STEP 6 started
- [ ] **[HARD GATE]** No shot in the final `shot_timing_table` exceeds 10s (combat / fast-cut 4–6s is allowed)
- [ ] **[HARD GATE]** `narrator_voice_id` is identical across every narration clip in the episode (no mid-episode swap)
- [ ] **[HARD GATE]** `narrator_speed` is within ±10% of the per-episode default
- [ ] **[HARD GATE]** No narration/dialogue overlap in any shot, unless the user explicitly approved it
- [ ] **[HARD GATE]** Dialogue audio defaults to the video render's original spoken audio
- [ ] **[HARD GATE, NEW for v2.0]** Dialogue duration estimate (max_dialogue = shot_duration × 0.6) was checked at STEP 5.6 and no shot exceeded the safety margin (narration_real + dialogue_estimate + 0.5s_buffer ≤ shot_duration). If exceeded, the shot was split or extended before STEP 6.
- [ ] **[HARD GATE, NEW for v2.0]** STEP 6.5 micro-adjustment was performed after STEP 6: each shot's actual dialogue duration was measured (VAD or human listening) and any drift > 1s from the STEP 5.6 estimate was resolved.
- [ ] **[HARD GATE, NEW for v2.0]** `narrator_gender_match` was honored: the voice gender matches the genre track's auto-recommend (no gender-mismatch, e.g. female-frequency romance with male voice)
- [ ] **[HARD GATE, NEW for v2.0.1]** `narrator_volume` was set to 1.8 (or 1.2-2.0 range per user) — NOT 1.0. Default 1.0 makes narration inaudible in noisy viewing environments and breaks the half-narrated function. Verify by spot-checking 3 random narration mp3 files: their peak amplitude should be noticeably louder than the dialogue peak amplitude in the same shots.
- [ ] **[HARD GATE, NEW for v2.0.2]** `shot_audio_schedule` was produced in STEP 5.6 with TTS preview for BOTH narration and dialogue (not narration alone). Every shot's prompt in STEP 6 includes the `audio_schedule` block with explicit `narration_window` and `dialogue_window` timestamps from the schedule. Spot-check 3 random shots: their `shot_audio_schedule.fits_in_shot` is `true`.
- [ ] **[HARD GATE, NEW for v2.0.2]** STEP 6.5 was run after STEP 6: each shot's actual dialogue duration (VAD or human listening) was compared to `shot_audio_schedule.dialogue_window`. Any drift > 1s was resolved (extend shot, trim buffer, or return to STEP 5 — not by deleting dialogue text). Final delivery shows ≤ 20% of shots needed STEP 6.5 micro-adjustment (the v2.0.2 target).
- [ ] Audio is intelligible (dialogue clear over background)
- [ ] Subtitles are readable (font size, contrast, position)
- [ ] Voice preset name is recorded in the final spec for next-episode reuse

## Format / backend

- [ ] **[HARD GATE]** Default backend is 平台当前可用的视频能力 (10s mode for normal shots, 6s mode for combat / fast-cut), unless the user explicitly asked for another
- [ ] Aspect ratio matches the locked spec
- [ ] Duration matches the locked target
- [ ] Subtitle mode matches the locked choice
- [ ] Final assembly matches the spec

## Canvas gate **[HARD GATE]** [NEW for v2.0]

- [ ] **[HARD GATE]** Final spec is on canvas for user review before any expensive generation
- [ ] **[HARD GATE]** Every core asset produced before video generation (character cards, three-view sheets, scene cards, scene auxiliary cards, prop card, storyboard) was placed on canvas **immediately after generation** for user inspection and adjustment
- [ ] **[HARD GATE]** Video generation (STEP 6 Step B) was not started until the user has confirmed the on-canvas assets

## Video model policy (MiniMax-H3 by default) **[HARD GATE]**

> 视频生成默认使用 **MiniMax-H3**。所有镜头必须用 image-to-video 模式，first_frame 必传，10s 时长为主，6s 模式仅用于战斗/快切镜。用户明确选择其他模型时先检查能力；生成失败按原因重试一次，仍失败切换兼容模型。

- [ ] **[HARD GATE]** 每个镜头默认使用 `model = "MiniMax-H3"`；如用户明确选择其他模型，已完成能力检查并记录结果。
- [ ] **[HARD GATE, NEW for v2.0.6]** **Every shot has a non-empty `opening_frame_image`** (first_frame reference). No pure text-to-video shots. Spot-check 3 random shots: their `opening_frame_image` points to a real anchor (character main card / character three-view side/back / scene main card / scene auxiliary card / last_frame / prop card).
- [ ] **[HARD GATE, NEW for v2.0.6]** **`frame_role = "first_frame"` for every shot** (not `"last_frame"` for first-frame shots; not text-only).
- [ ] **[HARD GATE, NEW for v2.0.6]** **Default `duration = 10` for normal shots, 6 for combat / fast-cut only**. No 12s+ shots.
- [ ] **[HARD GATE, NEW for v2.0.6]** **Multimodal refs all used**: at least one of (character main card, character three-view sheet, scene main card, scene auxiliary card, prop card) must be generated in Step A and at least one shot must have used each as a first_frame. Spot-check: list all generated anchor assets and verify each appears as some shot's `opening_frame_image`.
- [ ] **[HARD GATE, NEW for v2.0.6]** **No text-to-video fallback without explicit user approval**. If any shot was generated via text-to-video, the storyboard must contain a `text_to_video_approval: true` flag with the user's confirmation.

## Audio hard rules (mouth / BGM / ducking) **[HARD GATE]** [NEW for v2.0.4 / v2.0.5]

These three rules apply to **every** mixed-mode (narration + dialogue) episode, regardless of sub-mode. They are inherited from the wool-felt-story-short skill design.

### Mouth-state constraint [HARD GATE]

- [ ] **[HARD GATE, NEW for v2.0.4]** **Single-speaker rule per shot**: in every shot, at most ONE character is allowed to move their mouth to speak. Other visible characters must keep their mouth closed or perform reaction actions (nod, frown, eye movement).
- [ ] **[HARD GATE, NEW for v2.0.4]** **Narration does not trigger lip movement**: narration text MUST NOT appear in the video prompt's "mouth" or "lip" fields. If a character's mouth moves during narration playback, the shot is a hard fail — must redo.
- [ ] **[HARD GATE, NEW for v2.0.4]** **Pure-narration shots**: if a shot has narration but no dialogue, all on-screen characters keep their mouths closed. Any mouth movement is a ⚠️.

### BGM handling [HARD GATE]

- [ ] **[HARD GATE, NEW for v2.0.4]** **BGM is post-positioned**: the no-BGM cut must be completed and user-reviewed first; BGM is only added after user approval.
- [ ] **[HARD GATE, NEW for v2.0.4]** **BGM alignment without stretching**: BGM too long → trim to cut duration with natural decay; BGM too short → loop as needed and trim to cut duration. **Forced stretching of BGM is forbidden**.
- [ ] **[HARD GATE, NEW for v2.0.4]** **BGM ducks during narration but stays audible**: BGM mix must be audible, but ducks (auto-ducks or volume-down) when narration plays. Not so ducked as to be inaudible.
- [ ] **[HARD GATE, NEW for v2.0.4]** **BGM is an independent asset**: BGM version must be output as a NEW asset; never overwrite the no-BGM version. The no-BGM version is a required independent deliverable.

### Ducking (audio sidechain) constraint [HARD GATE]

- [ ] **[HARD GATE, NEW for v2.0.4]** **Ducking is for ambience / SFX only**: allowed use cases — street noise ducks when narration speaks, SFX ducks narration/BGM. Forbidden use case — using ducking to make narration and dialogue "both play but distinguishable" (must use time-window separation instead).
- [ ] **[HARD GATE, NEW for v2.0.4]** **No ducking-induced inaudibility**: if ducking makes narration or dialogue inaudible, it's a fail. Either reduce ducking depth or extend the time-window gap.

## User-language following **[HARD GATE]** [v2.0.3: 4 → 8 items, full systemization]

> **Complete ULF spec**: `references/user-language-rules.md`. The 8 hard gates below are the QC-checkable subset.

- [ ] **[HARD GATE]** Every `question` call (options, descriptions, defaults, placeholders) is written in `user_language`. Internal `id` keys stay machine-readable.
- [ ] **[HARD GATE]** Every progress update, step-completion message, decision summary, and error / warning is in `user_language`.
- [ ] **[HARD GATE]** Final delivery message (STEP 8) is entirely in `user_language` (the 🎬 template, with technical IDs appended as plain string but not translated).
- [ ] **[HARD GATE]** Exact user-provided text (character names, scene names, narration text, dialogue text, plot point text, style direction words) is preserved verbatim across all outputs. No translation, no paraphrase, no synonym substitution.
- [ ] **[HARD GATE]** Voice preset labels (`voice_preset_label`) use the platform's localized display name matching `user_language`. `voice_id` stays as the platform's machine-readable ID.
- [ ] **[HARD GATE]** Subtitle output language matches the user's `output_language` field in the spec (default = `user_language`).
- [ ] **[HARD GATE]** H3-facing style block stays English (H3's training data is English-dominant; English style blocks produce the most stable output). User-facing prompt explanations are in `user_language`.
- [ ] **[HARD GATE]** When the user speaks in a non-default language, the Skill defaults to following it (no fallback to Chinese). Only when language is undetectable does the Skill default to `zh-CN`.

## Output

- [ ] Final episode or assembly guidance produced
- [ ] Reusable character / scene / prop cards delivered (per character: main + 3-view; per scene: main + aux; ≤1 prop if used)
- [ ] Storyboard or shot prompt package delivered
- [ ] Continuity warnings and repair notes delivered
- [ ] Voice preset name recorded in delivery summary (so the user can reuse on the next episode)

## Final delivery message template (**must be in user's current language**)

> 🎬 第 X 集完成，共 N 镜，总时长 M 分钟
> - 视觉：3D 漫剧渲染（<sub_mode>）
> - 旁白音色：<voice_name> (<voice_id>)
> - 后端：平台当前可用的视频能力（10s 模式）
> - 锚点：主角每 4 镜/配角每 6 镜/场景每 5 镜重置一次；三视图（正/侧/背）+ 场景辅卡支撑运镜
> - 流水线：narration-first（旁白先生成，STEP 6 按真实时长拍镜头）
> - 剧情：原剧本 100% 保留（无删减/压缩/改写）
> - 旁白对白：全镜非重叠（默认）
> - 下一步建议：<一键出下一集 / 调 BGM / 出 3 平台投流剪辑 / 调整画幅出海>


## Complete-shot direct-join hard gate

- [ ] Every shot is preserved from its first frame through its last frame.
- [ ] All complete shot clips are directly joined in the confirmed order; no shot footage is trimmed, shortened, speed-ramped, cropped away, or replaced for pacing or audio convenience.
- [ ] Any end card is appended only after the complete final shot.
