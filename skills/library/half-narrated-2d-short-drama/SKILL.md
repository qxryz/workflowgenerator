---
name: half-narrated-2d-short-drama
description: |
  根据故事、剧本或参考资料制作 2D 国漫半解说短剧，锁定语音窗口、保留原声对白并交付旁白资料供用户剪辑。默认使用 MiniMax-H3；用户明确指定其他模型时先检查能力。
trigger-words: [2D动画半解说短剧, 2D半解说短剧, 手绘动画短剧, 动漫短剧, 国漫webtoon, 赛璐珞短剧, half-narrated 2D drama]
---

# 2D 半解说短剧 v1.0.0

本流程适用于单集 2D 赛璐珞 / 国漫 webtoon 半解说短剧。旁白负责背景、时间跳转和不可直说的内心信息；对白负责冲突、揭示、拒绝、反击和情绪爆点。前面项目锁定流程中用户确认的旁白音色会贯穿全片，默认推荐音色仅在用户未另选时使用。

### 首帧锚点是什么

首帧锚点是可选的连续性参考，不是生成每个镜头的强制输入。视频生成默认使用 H3 全能参考模式；真正的硬要求是每镜将角色、场景、道具等实际使用内容绑定到资产清单，并锁定空间站位与视线关系。

## 项目硬锁（不可在后期放宽）

1. `visual_style_lock=2D-cel-webtoon`，默认 `guoman-webtoon`；每条图像 / 视频提示词都带 2D 风格块。
2. backend=MiniMax-H3 且 generation_mode=platform-supported reference mode 为默认。用户明确指定其他模型时，先检查其能力，兼容后遵循选择；生成失败先针对原因重试一次，随后切换其他兼容模型。
3. `narrator_delivery_lock=fast_short_drama_commentary`：默认语速为 1.15，吐字清晰、起势快速、压缩非必要停顿，并强化钩子、冲突、反转和落点；voice_id、profile、语速、音高、基础情绪、停顿策略、音量、采样率、编码、响度和表达风格整集锁定。
4. `dialogue_source_policy=video_original_only`：对白来自输入视频原声或 H3 片段返回的原声轨；不生成、不替换、不重配对白 TTS。
5. `narration_dialogue_overlap_allowed=false`：旁白与对白绝对不能在同一混合音轨上重合发声；每个语音区间之间至少留 `0.20s` 保护间隔，实测发现重叠就拒绝混音。
6. `narration_generation_policy=single_batch_or_single_master`：整集所有旁白必须在同一次 TTS 批量任务 / 同一 session 中生成，统一使用前面项目锁定流程中由用户选择并确认的旁白音色 ID，语速和音量基准完全一致；禁止逐镜临时生成或重新选择音色。
7. `audio_track_separation_required`：旁白与视频原生对白在验证完成前必须保持独立音轨；禁止用 ducking、静音、截断、交叉淡化或压低音量掩盖重叠。
8. `dialogue_consistency_scope`：本 Skill 保证旁白统一；角色对白仍默认取各镜视频原声，不承诺不同镜头之间的角色音色完全一致。
9. 每镜必须绑定角色、场景、道具等所需资产，并记录资产 ID 与哈希；首帧 / 末帧可作为连续性参考但不是必需输入。
10. `narration_window_first_design=true`：旁白时长和位置必须在分镜设计阶段、视频生成前预留并锁定；没有可行旁白窗口的镜头不得生成。

## STEP 0：项目锁卡

一次询问起点、题材、画幅 / 时长 / 字幕 / 平台、清晰度（`768P` 或 `2K`）、2D 子模式、旁白音色与解说节奏。清晰度必须由用户选择并在整集锁定；默认视频模型为 MiniMax-H3，使用 platform-supported reference mode，旁白默认采用语速 1.15、清晰快速、钩子前置的短剧解说节奏。用户明确指定其他模型时，先检查其能力；生成失败先针对原因重试一次，随后切换其他兼容模型。

旁白音色步骤必须执行：先分析短剧类型、叙事视角、情绪和目标平台，再给出推荐首选、备选男声和备选女声，用户确认或试听后锁定。不能因为用户上传了素材而跳过这一问。

锁卡至少包含：

```yaml
project_lock:
  aspect_ratio: "9:16"
  target_duration_s: 90
  subtitle_mode: hard-burn
  delivery_target: douyin
  visual_style_lock: 2D-cel-webtoon
  visual_sub_mode: guoman-webtoon
  narrator_voice_id: selected catalog narrator voice ID
  narrator_speed: 1.15
  narrator_pitch: 0
  narrator_emotion: "短剧快节奏解说"
  narrator_pause_policy: "压缩非必要标点停顿，保留转折与爆点停顿"
  narrator_volume: 1.0
  narrator_sample_rate: 48000
  narrator_codec: "wav_pcm_s16le"
  narrator_loudness_target_lufs: -16
  narrator_voice_profile_id: ""
  narrator_delivery_style: "清晰、快速、钩子前置"
  narrator_reference_audio_sha256: ""
  narrator_tts_batch_id: ""
  narration_render_mode: "single_batch_then_timed_slices"
  narration_batch_required: true
  narration_per_shot_generation_allowed: false
  narration_voice_lock_scope: "entire_episode_single_voice_id_profile_speed_volume"
  script_source_of_truth: "approved_script_manifest"
  prompt_generation_mode: "mechanical_from_shot_manifest"
  prompt_script_match_required: true
  h3_audio_policy: "仅对白，或原样保留提交的音频床；不得自动生成旁白"
  h3_audio_validation_required: true
  audio_render_mode: "分离旁白音轨后仅允许无重叠混音"
  narration_dialogue_same_track_overlap: forbidden
  narration_dialogue_mix_gate: "实测时间区间且间隔至少0.20秒"
  h3_must_preserve_submitted_audio: true
  backend: the platform’s currently available video capability
  generation_mode: platform-supported reference mode
  video_input_mode: "h3_reference_mode"
  resolution: "user_selected_768P_or_2K"
  asset_binding_required: true
audio_policy:
  dialogue_source_mode: rendered_video_original # 有输入视频时改为 input_video_original
  dialogue_replacement_allowed: false
  narration_dialogue_overlap_allowed: false
  minimum_speech_gap_s: 0.20
```

锁卡确认前不生成高成本资产。中途换旁白音色会使整集旁白重做，但不会改变对白原声轨。

## STEP 1：素材与对白原声审计

建立 `source_manifest`：输入文件、视频时长、音轨数量、对白是否存在、原声文件路径、采样率、声道和校验哈希。

- 有参考 / 成片视频：抽取原始语音轨，标记 `dialogue_source_mode=input_video_original`，禁止覆盖原文件。
- 需要用 H3 生成镜头：标记 `rendered_video_original`；每个片段生成后立即保存返回的原声轨和哈希。
- 原声缺失、只有音乐或对白不可辨认：暂停流程，请用户补视频原声或录音；不自动用 TTS 冒充“视频原声”。

如果用户上传了剧本或图片资产，必须先询问一次：

- 直接使用上传图片资产；
- 只把上传图片作为参考，重新生成符合项目风格的图片；
- 混合使用（指定哪些直接用、哪些重生成）。

用户未确认前不得重绘或替换上传资产。剧本分析只做结构标注、节拍和镜头化，不擅自改动原剧情、人物关系、事件顺序或结局；任何改写先列为“建议稿”，等待用户批准。

同时建立资产缺口表：角色、场景、道具、服装、关键动作和音频来源逐项标记“已有 / 缺失 / 需变体”。缺失资产先补齐并让用户确认，再进入后续分镜与生成。

输出故事前提、开场钩子、冲突脊柱、转折、结尾和 5 条连续性风险。确认后进入 STEP 2。

## STEP 2：故事、旁白稿、对白稿

按“设定 → 压力 → 应对 → 转折 → 悬念 / 收束”拆成 5 节拍。旁白与对白分开写：

- 旁白：背景、时间跳转、内心想法、不能直说的信息。
- 对白：冲突、揭示、拒绝、反击和情绪爆发；短句、口语化。
- 同一事实只保留一个通道，避免旁白复述对白。
- 默认叙事 / 对白占比约 60% / 40%，以可听性和节拍为准，不为比例牺牲冲突。
- 为原剧本每句建立不可变 `script_line_id` 和 `source_text`。旁白稿的 `narration_text` 必须逐字等于已批准脚本行；标点、数字、专名和语气词不得静默改写。需要压缩或拆句时，先提出“建议稿”，获用户批准后生成新版本 ID。
- 镜头 prompt 不手写第二份剧情。prompt 只能由 `shot_manifest` 的 `script_line_id`、`narration_text`、`dialogue_line_text`、动作、站位和资产字段机械拼接，并保存 `script_manifest_sha256` 与 `shot_manifest_sha256`。

## STEP 3：分镜阶段锁定旁白与对白窗口

视频生成前就必须同时规划两条语音通道。每镜先使用项目锁定的旁白音色、语速、语言、停顿策略和表达风格估算旁白时长，再安排对白窗口和至少 0.20 秒保护间隔。每个 Shot 必须直接写明旁白内容、对白内容、两者的相对位置、语音顺序，以及旁白期间可执行的无口型动作 / 反应镜头。不能等视频生成后才寻找旁白位置。

每镜生成前必须通过以下检查：

- `shot_duration_s` 已固定在 4–10 秒内；
- `narration_text`、`narration_start_s`、`narration_end_s` 和预计时长已填写，无旁白时明确填 null；
- `dialogue_line_text`、`dialogue_start_s`、`dialogue_end_s` 和说话人已填写，无对白时明确填 null；
- 旁白、对白和 0.20 秒保护间隔全部落在镜头范围内；
- 旁白窗口对应可读的动作、反应或空镜，角色口型只在对白窗口出现；
- 如果窗口放不下，必须在生成前拆句、移动旁白、拆镜或延长镜头至最多 10 秒；不得提交“对白太满”的镜头并期待 H3 自动腾出空间。

```text
如果旁白在前：narration_end + 0.20s <= dialogue_start
如果对白在前：dialogue_end + 0.20s <= narration_start
跨镜头：next_speech_start_global - current_speech_end_global >= 0.20s
镜头边界：shot_start <= 所有语音区间 <= shot_end
```

每镜至少填写：`shot_id`、`shot_duration_s`、`global_start_s`、`global_end_s`、`audio_order`、`narration_text`、`narration_start/end`、`narration_duration_estimate`、`dialogue_line_text`、`dialogue_start/end`、`silent_action_window`、`dialogue_source_file`、`narrator_voice_id`、`speaker`、`pre_generation_window_check`。跨镜头也要检查，不能只看镜内。

## STEP 4：分镜、视觉状态与锚点

每镜只承担一个主要信息 / 情绪任务，并记录场景、空间站位、走位、镜头轴线、视线方向、前后景层级、起始状态、动作推进、结束交接、首帧来源、引用资产 ID 列表、`reset_anchor` 和完整音频时间码。分镜同时是音频阻挡文档：必须直接规定旁白内容、对白内容、语音顺序、旁白区间、对白区间、预计时长、0.20 秒保护间隔，以及旁白期间的无口型动作 / 反应镜头。旁白不能作为后期才添加的愿望；时间预算不成立时，该镜不得提交生成。

视频生成默认使用 MiniMax-H3 的 `platform-supported reference mode` 模式；用户明确指定其他模型时先检查能力，兼容后遵循选择。生成前先询问清晰度：`768P` 或 `2K`，用户确认后整集锁定。每镜必须在 `asset_manifest` 中绑定所有实际出现或被提及的角色（包括次要角色 / 群演）、场景、道具、服装等资产，记录唯一 ID、路径和 SHA-256；映射缺失或不一致时不得发起生成。每个可见角色还必须有屏幕位置（左 / 中 / 右）、景别 / 深度层、朝向、视线目标、进出画方向和与其他角色的相对关系；相邻镜头不得无理由翻转 180 度轴线。`first_frame_source` / `last_frame` 仅作为可选连续性参考。

每镜提示词固定附加：`2D cel-shaded animation, Chinese-animation webtoon style, clean bold black outlines, flat color fills with cel highlights, dynamic panel composition, no 3D, no photoreal, no live-action, no watermark, no baked-in text`。

提交前执行 `script-prompt-contract`：展示每镜脚本行 ID、旁白 / 对白原文、资产绑定、空间布局、语音顺序、旁白区间、对白区间、无口型动作区、旁白预计时长和最终 prompt，用户确认后才提交 H3；提交的 prompt 必须带脚本行 ID 和清单版本哈希。提交后比对请求日志，缺行、增写、改写、错序、语音预算超满或把旁白写入角色对白均判定失败。

## STEP 5：生成 / 取证对白原声

### 5A 输入视频路径

用无损或高质量方式抽取视频原声，保留原始文件和时间码。对白转写只用于字幕与定位，不能替换原声。

### 5B H3 生成路径

默认采用分离音频路径：H3 镜头原声只允许包含视频原声对白和自然环境声 / 音效，禁止旁白、voice-over、评论或描述性语音。镜头提示中必须同时带出已规划的对白窗口、旁白静默窗口和旁白期间的视觉动作，但只写对白内容和说话人，不把旁白台词送入 H3 音轨。角色口型只在对白窗口内活动，旁白窗口使用动作、反应或空镜。不能默认 H3 返回音轨就是纯对白。片段生成后马上：

1. 同时归档完整 H3 音频和 `audio/shot_NN_dialogue_original.wav`；
2. 对完整音轨执行 ASR / 说话人分段，逐段与预期对白、说话人和脚本行比对，识别额外旁白；
3. 若 H3 提供独立原始对白 stem，只使用该 stem，并保留完整音轨作为证据；
4. 若额外旁白混入唯一音轨，判定该镜音频源不合格，重新生成并再次检查；重复失败则暂停并要求干净的 H3 片段或输入视频原声；
5. 禁止叠加旁白、任意静音、声源分离或对白 TTS 来掩盖污染；
6. 通过纯对白检查后，才标出真实 `dialogue_start/end`、更新时间线并进入旁白生成。

### 5C 音频分离硬门槛

默认且必须采用分离音频路径：H3 镜头原声只允许包含视频原声对白和自然环境声 / 音效，禁止旁白、voice-over、评论或描述性语音。不要把旁白母轨或旁白切片送进普通镜头生成。这样做是因为独立生成的 H3 镜头音频无法可靠保持同一旁白音色。

如果某镜混入额外旁白、额外说话人或无法追溯到批准对白的语音，直接判定该镜音频不合格；重新生成时删除旁白指令。禁止通过静音、声源分离、压低音量或覆盖音轨掩盖污染，并在 QC 中记录失败与修复。只有平台明确支持并能逐字节保留用户音频时，才允许把预锁定音频床作为明确例外；它不是默认路径，也不得让 H3 在镜头内生成旁白。

## STEP 6：独立旁白母轨与无重叠修复

分镜阶段已通过旁白窗口可行性检查、且对白真实时间码锁定后，必须把整集所有已批准的 `narration_text` 原文按剧本顺序一次性放入同一 TTS 批次 / session，统一使用前面项目锁定流程中由用户选择并确认的旁白音色 ID，语速和音量基准完全一致。禁止逐镜头新建会话、临时选音色或单独改变某镜的语速、音高、情绪和说话风格。随后可将该批次整理为旁白母轨并依据全局时间码切片到各镜头空档；母轨和切片必须继承同一个 `voice_profile_id` / 参考音频哈希，以及语速、音高、情绪基线、停顿策略、音量、采样率、编码和响度目标。每个切片记录 `script_line_id`、`source_text`、母轨起止和哈希，并用强制对齐 / ASR 核对是否逐字读出脚本原文；漏读、增词、错词或错序时，整批旁白作废并重生成。

每个切片只做无损边界切割，不重新合成、不单镜临时调整语速或情绪。测量母轨和每个切片的真实时长并回填时间线；任意一镜参数、音高、语速或响度不一致时，整批旁白重新生成，不只修单镜。

冲突修复顺序固定为：改写 / 拆句 → 移到下一空档 → 拆镜 → 延长镜头（单镜不超过 10s）→ 重新测量。禁止加速超过项目锁定值、截断语音、交叉淡化两种人声、压低其中一条、ducking、任意静音或用空白掩盖重叠。任何混音前都必须在最终时间线上实测旁白与对白区间；只要存在重叠，就拒绝生成单一混合音轨并返回时间修复。

## STEP 7：旁白交接与流程结束

整集旁白母轨，或同一 TTS 批次 / session 生成的全部旁白文件，已经依据批准旁白原文完成生成、真实时长测量和文字校验后，立即结束本 Skill 流程。不得自动进入最终视频装配、字幕烧录、BGM 混音、音效混音或导出文件 QC。

向用户交接旁白母轨或旁白切片、旁白时间元数据、保留的对白原声轨、镜头级音频时间线，以及可供剪辑使用的字幕时间码来源。用户自行决定剪辑点、转场、BGM、环境声、音效、字幕样式、ducking 和最终导出。

如果用户之后明确要求剪辑或装配，将其视为新请求，转入适用的剪辑工作流或插件；不得自动继续本 Skill。编辑时必须先保持旁白与对白分离，完成区间验证且每段至少间隔0.20秒后，才允许输出单一混合音轨。需要改旁白时回 STEP 6；需要改对白时回 STEP 5 并重新取证。

## STEP 8：交接包

交接包应包含：整集旁白母轨或固定批次旁白文件、每个文件对应的原文与时间元数据、保留的对白原声轨、`shot_audio_timeline.yaml`、对白转写 / 时间码来源、旁白字幕时间码来源、角色 / 场景卡、分镜与提示词、已生成音频的 QC 记录和未解决的音频观察项。不得声称已完成最终视频装配，也不得声称已完成最终导出文件 QC。

当旁白输出以及其文字 / 时间校验结果已在画布可用时，本 Skill 即完成；最终剪辑与装配由用户自行完成。
