> 维护备份，不可执行：此文件不进入本 Skill 的提示词读取链。

> 仅作原专家知识备份：本建筑流程禁止按本文件切换模式或输出其对齐指令。

> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# I2VA: First-Frame Image-To-Video/Audio

Use when one image is the actual first frame of the target video.

## Required First Line

Put this alignment instruction as the first line of the final prompt, then one blank line:

```text
For the target video, at 0.00 seconds into the target video, <Picture 1> (from [Shot 1]) is fully referenced.
```

## Official Body

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## Description Logic

Use: first-frame anchor → action start → continuous change → result/reaction.

- Treat `<Picture 1>` as the exact 0.00-second frame.
- Preserve identity, clothing, colors, key objects, composition, and spatial relationships from Picture 1.
- Start by describing the visible style, subject, composition, and scene anchors in the picture.
- Then describe what begins to move and how the camera or subject develops.
- Avoid contradictions that would require the first frame to be different from the reference image.
