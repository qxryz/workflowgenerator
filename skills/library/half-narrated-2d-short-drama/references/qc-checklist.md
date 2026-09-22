# QC Checklist v2.0

标记 [HARD GATE] 的项目失败即不得交付。

## 故事与画面

- [ ] 前 3 秒钩子清楚，5 节拍链完整
- [ ] [HARD GATE] 剧本事件顺序、人物关系和结局与原稿一致，未经批准没有擅改
- [ ] [HARD GATE] 资产缺口表已清零，补齐资产已审阅并进入镜头计划
- [ ] [HARD GATE] 上传图片的直接使用 / 参考重生成 / 混合方式与用户确认一致
- [ ] 旁白不复述对白，默认比例约 60% / 40%
- [ ] 角色、服装、道具、场景布局和首帧锚点连续
- [ ] 每镜 4–10s，超过 6s 有动作 / 节拍理由
- [ ] [HARD GATE] 全部镜头为 2D-cel-webtoon，无 3D / 写实漂移
- [ ] [HARD GATE] 视频镜头使用 the platform’s currently available video capability 全能参考模式（platform-supported reference mode）
- [ ] 每镜如使用首帧 / 末帧参考，路径与资产记录一致；末帧归档按连续性需要执行
- [ ] [HARD GATE] 生成前已询问并锁定清晰度（768P 或 2K），所有镜头参数一致
- [ ] [HARD GATE] 每镜角色 / 场景 / 道具等实际使用资产均有 `asset_manifest` ID、路径和 SHA-256 绑定
- [ ] [HARD GATE] 生成请求中的资产绑定、H3 模型、全能参考模式和清晰度与分镜记录一致
- [ ] [HARD GATE] 每个可见角色（包括次要角色、群演）均绑定唯一角色卡资产；不存在“只写名字、不传角色卡”的角色
- [ ] [HARD GATE] 每镜记录左 / 中 / 右位置、前 / 中 / 后景层、朝向、视线目标、进出画方向和 180 度轴线
- [ ] [HARD GATE] 分镜阶段已为每镜预留旁白窗口，并记录旁白 / 对白文本、语音顺序、预计时长、0.20s 间隔和旁白期间的无口型动作窗口
- [ ] [HARD GATE] 视频生成前每镜通过 `pre_generation_window_check`；不存在对白过满、旁白无处放置的 Shot
- [ ] [HARD GATE] 相邻镜头空间关系与视觉状态台账一致；轴线翻转、角色换边或视线跳变必须有明确的切镜 / 重置理由
- [ ] [HARD GATE] 生成后逐镜核对次要角色脸型、发型、服装和体态与角色卡一致；不一致则重绑角色卡并重生成该镜及受影响的连续镜头

## 音频硬门槛

- [ ] [HARD GATE] dialogue_source_mode 为 input_video_original 或 rendered_video_original
- [ ] [HARD GATE] 每句对白可追溯到 dialogue_source_file，并记录 SHA-256
- [ ] [HARD GATE] 成片对白轨与原声内容一致，未被对白 TTS 或新录音覆盖
- [ ] [HARD GATE] H3 每条镜头原声不含旁白、voice-over 或无法追溯的额外语音
- [ ] [HARD GATE] H3 完整返回音轨已归档并完成 ASR / 说话人分段，确认不存在未授权的额外旁白、评论或描述性语音
- [ ] [HARD GATE] `unsolicited_speech_check=pass`；若使用 H3 独立对白 stem，stem 与完整音轨均可追溯
- [ ] [HARD GATE] 额外旁白混入唯一音轨时已拒绝该镜；未通过叠加旁白、任意静音、声源分离或对白 TTS 掩盖
- [ ] [HARD GATE] 直出模式若启用，提交给 H3 的预锁定音频床与返回音频哈希一致，且 H3 未新增或改写任何语音
- [ ] [HARD GATE] 旁白交接模式逐字 ASR、时间码和 0.20s 间隔均通过；失败时已记录原因并回到对应音频步骤
- [ ] [HARD GATE] narration_dialogue_overlap_allowed=false
- [ ] [HARD GATE] 全局时间轴任意旁白 / 对白区间间隔 ≥ 0.20s
- [ ] [HARD GATE] 同镜和跨镜头均通过 validate_voice_windows
- [ ] [HARD GATE] 旁白窗口在视频生成前已按锁定音色与语速完成时长估算；实际旁白不得依赖生成后临时挤入
- [ ] [HARD GATE] 成片导出后再次测量并通过校验
- [ ] [HARD GATE] 旁白来自同一整集母轨或同一 TTS 批次
- [ ] [HARD GATE] 所有镜头旁白切片与最终旁白轨的音色、voice_id、voice profile、语速、语言、音高、基础情绪、停顿、音量、采样率、编码和响度整集完全一致
- [ ] [HARD GATE] 抖音短剧旁白保持统一的快速、清晰、钩子前置节奏；不存在逐镜随机变速或松散拖沓的停顿
- [ ] [HARD GATE] 旁白 voice profile / 参考音频哈希、TTS batch/session、语速、音高、情绪基线、停顿策略、音量、采样率、编码和响度目标整集一致
- [ ] [HARD GATE] 旁白来自整集母轨切片，或来自同一 TTS batch/session；不得逐镜头独立新建会话
- [ ] [HARD GATE] 旁白切片为无损边界切割，未对单镜重新采样、变速或改情绪
- [ ] [HARD GATE] 旁白音频通过强制对齐 / ASR，逐字匹配已批准脚本 `source_text`；无漏读、增词、错词、错序
- [ ] [HARD GATE] 每条旁白和对白均有 `script_line_id` 与源文本哈希，音频、字幕、时间线引用一致
- [ ] [HARD GATE] 每个镜头 prompt 通过 `script-prompt-contract`，与脚本行、资产绑定和空间布局逐字段一致
- [ ] [HARD GATE] H3 请求 payload 与已确认 prompt 记录的哈希一致，未发生提交前后改写
- [ ] [HARD GATE] 不用加速、截断、交叉淡化或静音伪装解决冲突
- [ ] BGM / 环境声 / 音效在语音区间自动 duck，未盖住对白
- [ ] 字幕来源正确：对白来自原声转写，旁白来自旁白稿，时间码一致

## 交付

- [ ] [HARD GATE] 成片、shot_audio_timeline.yaml、对白原声轨、旁白轨和字幕文件齐全
- [ ] 角色卡、场景卡、分镜提示词和连续性修复记录齐全
- [ ] 规格中记录旁白音色、对白原声来源、后端、画幅和时长
