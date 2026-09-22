> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# All-Purpose Multimodal Reference Mode

Use when the request includes multiple references: pictures, videos, audio, subjects, style references, source footage, voice, music, or mixed assets.

## Official Structure

```text
subject_definitions:
<Subject 1>: ...
<Picture 1>: ...
<Video 1>: ...
<Audio 1>: ...

summary: ...

retention_analysis: ...

detailed_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

## subject_definitions

Define each reference once and preserve only the dimensions the user needs:

- `<Subject N>`: stable character/object/product identity, including face/body/product geometry, clothing/material, role, and no-drift rules.
- `<Picture N>`: architectural identity, appearance, or composition at a labeled second-X visual state.
- `<Video N>`: action, camera movement, editing rhythm, style, source footage for editing, or audio-in-video reference.
- `<Audio N>`: voice timbre, dialogue, music rhythm, lyrics, mood, full/partial reuse.
- If one video supplies both image and sound, define its visual track and audio track separately.

## summary

Concise target-video summary: format, duration, aspect ratio, main subject, event, visual style, reference usage, and final result.

## retention_analysis

Explain what to retain before writing new motion:

- visible content: identity, geometry, layout, colors, spatial relations, camera style, environment, product/logo/text accuracy.
- audio: timbre, accent, rhythm, lyrics/dialogue, instrument texture, ambience, sync points.

## detailed_description

Use one `[Shot 1]` with continuous time phases unless the user explicitly requested cuts. Reference tags should appear in the shot where they matter: `<Subject 1>` speaks, `<Picture 2>` defines the product, `<Video 1>` defines camera path, `<Audio 1>` provides rhythm.

Do not leave references only in the preamble.


## Reference-Fit Assessment

Before writing `subject_definitions`, evaluate whether each provided reference satisfies the user's requested role.

- If it satisfies the role, define it and state what dimensions to retain.
- If it partially satisfies the role, define only the satisfied dimensions and ask whether to generate/provide a missing anchor when the missing dimension is important.
- If it does not satisfy the role, do not assign it that role. Tell the user it does not satisfy the need and ask whether to generate/provide another reference.

Examples: a scene reference that contains the requested UI layout can be used directly for UI/layout; a scene reference that only has mood but no UI should not be used as a UI reference.
