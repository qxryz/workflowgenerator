> 维护备份，不可执行：此文件不进入本 Skill 的提示词读取链。

> 仅作原专家知识备份：本建筑流程禁止按本文件切换模式或输出其对齐指令。

> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# L2VA: Last-Frame Image-To-Video/Audio

Use when one image is the final frame of the target video.

## Required First Line

Put this alignment instruction as the first line of the final prompt, then one blank line:

```text
How the reference pictures align with the target video — <Picture 1> (from [Shot N]) aligns with the S.SS-second mark of the target video.
```

`Shot N` is the final actual shot. `S.SS` is the effective duration with two decimals, such as `15.00-second`.

## Official Body

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## Description Logic

Use: reasonable prior state → clear movement/change path → final shot converges → exact last-frame landing.

- `<Picture 1>` is not naturally Shot 1; it belongs to the last shot.
- Infer an earlier state that can plausibly evolve into the final image.
- Describe how character, object, camera, scene, light, and composition approach the reference.
- The last moment must land on the referenced final frame without contradiction.
