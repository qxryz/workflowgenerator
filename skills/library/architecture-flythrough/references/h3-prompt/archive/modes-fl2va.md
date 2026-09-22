> 维护备份，不可执行：此文件不进入本 Skill 的提示词读取链。

> 仅作原专家知识备份：本建筑流程禁止按本文件切换模式或输出其对齐指令。

> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# FL2VA: First-And-Last-Frame Video/Audio

Use when one image is the start frame and another image is the end frame.

## Required First Line

Put this alignment instruction as the first line of the final prompt, then one blank line:

```text
How the reference pictures align with the target video — Picture 1 (from Shot 1) aligns with the 0.00-second mark of the target video; Picture 2 (from Shot N) aligns with the S.SS-second mark of the target video.
```

`Shot N` is the final actual shot. `S.SS` is the effective duration with two decimals, such as `15.00-second`.

## Official Body

```text
integrated_multimodal_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## Description Logic

Use: start-frame state → observable intermediate changes → gradually reduce differences → final-frame state.

- Picture 1 is the opening frame; Picture 2 is the ending frame.
- Usually prefer one continuous shot so the model can interpolate naturally.
- Use multiple shots only if the user explicitly asks or the concept truly needs cuts.
- The final shot must arrive at Picture 2 at the video end.
- Focus on how subjects move, poses change, objects are operated, composition changes, lighting transitions, and the final frame is reached.
