# Interactive Checkpoints v2.0

音频两条硬锁不能放宽：对白只能用视频原声，旁白与对白必须分离。

## CHECKPOINT 0 — Project lock and voice recommendation

一次确认起点、题材、格式、2D 子模式、目标平台和后端。根据题材 / 视角 / 情绪 / 平台，必须展示“推荐首选 + 备选男声 + 备选女声”，用户确认或试听后锁定旁白音色。默认视频模型为 the platform’s currently available video capability 全能参考模式。

## CHECKPOINT 1 — Uploaded asset usage

当用户上传剧本或图片资产时，必须询问：

- 直接使用上传图片资产；
- 仅作参考，按项目风格重新生成；
- 混合使用，逐项指定。

剧本默认原剧情锁定；如需调整，只能提交建议稿等待批准。

## CHECKPOINT 2 — Source and asset audit

展示原声来源和资产缺口表。选项：

- 通过，补齐缺失资产后继续；
- 调整资产使用方式；
- 补交 / 替换原声或图片；
- 暂停。

没有“用对白 TTS 代替”的选项。

## CHECKPOINT 3 — Beat chain

展示按原剧本保留的五节拍、带 `script_line_id` 的旁白 / 对白原文和预计语音窗口。选项：通过、调整节拍、提交改写建议。

## CHECKPOINT 4 — Timing preflight

展示全局 shot_audio_timeline 和每个语音区间。选项：通过进入生成、改写 / 拆句、移到下一空档、拆镜或延长镜头。不提供“接受重叠”。

## CHECKPOINT 5 — Anchor assets

展示角色卡、场景卡、补齐的缺失资产和图片使用来源。选项：通过、重做某张、调整线条 / 色彩。

## CHECKPOINT 6 — Shot batch

展示 H3 全能参考模式、用户确认的清晰度（768P / 2K）、每镜脚本行 ID 与原文、最终 prompt、空间站位、角色 / 场景 / 道具资产绑定、可选首帧来源、末帧归档计划、镜头时长和对白原声来源。选项：继续生成、先看当前产物、暂停调整。

## CHECKPOINT 7 — Audio verification

镜头生成前展示对白 stem、脚本行 ID 和时间码，并明确 H3 镜头禁止旁白；镜头生成后展示 H3 完整音轨、返回音频哈希、ASR / 说话人分段和额外旁白检测结果。对白通过后，再展示统一旁白母轨、切片和全局时间码。只有音频保留与 `unsolicited_speech_check=pass` 才能通过；否则回到对白取证步骤或补交干净原声，不提供“接受混入”的选项。

## CHECKPOINT 8 — Final QC

展示最终文件的全局语音校验、原剧情一致性和资产完整性结果。只有全部通过才可交付；失败时回到对应步骤修复。
