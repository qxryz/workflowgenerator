> 维护备份，不可执行：此文件不进入本 Skill 的提示词读取链。

> 仅作原专家知识备份：本建筑流程禁止按本文件切换模式或输出其对齐指令。

> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# T2VA: Text-To-Video/Audio

Use when the user provides no image/video/audio assets.

## Official Format

T2VA has no image alignment instruction. Start directly with the three body fields:

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## Writing Rules

- Build the full audiovisual timeline from text.
- `[Shot 1]` starts with the overall style and initial framing; do not add a timestamp to Shot 1.
- Subsequent shots use increasing cut times inside the total duration, e.g. `[Shot 2] At 00:03.500, the camera cuts to...`.
- Every detail should be visible or audible: style, framing, subject appearance/location, props, action, camera movement, dialogue/singing, text, scene sounds.
- If the user asks for one-take, avoid shot lists and describe continuous phases.

## 本包输出约束

最终提交只使用已选模式的字段格式，不使用替代中文章节格式。
