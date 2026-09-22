> 本包只在生成 H3 视频提示词时读取 expert 资料。必须使用全能参考模式、RGB 视频 + 第0秒/中间1–2个状态/结束时刻的3–4张风格参考；图片用实际秒数描述。先读 [建筑提示词入口](../h3-prompt.md)，其中模式与时刻规则优先。通用文件中的其他模式菜单不用于本流程。

# Audio, Dialogue, Lyrics, And Beat Sync

Use when voice, dialogue, lyrics, lip sync, music rhythm, audio reuse, or beat-sync editing is central.

## Required Rules

- Write exact dialogue, lyrics, or spoken words when fidelity matters.
- Identify who speaks or sings.
- Keep dialogue length compatible with shot duration.
- If one sentence spans multiple shots, explicitly say it continues from the previous shot.
- If a voice-over becomes an on-screen speaker after a cut, explain the transition.
- If using audio reference, state whether it controls timbre, rhythm, mood, lyrics, or full audio reuse.

## Sound Fields

- `overall_soundscape`: diegetic ambience, Foley, physical action sounds, UI sounds, non-verbal human sounds.
- `non_diegetic_music`: audience-only score/background music.
- If no BGM is desired, write `non_diegetic_music: N/A` or `非叙事性音乐：N/A，不要额外添加背景音乐。`

## Beat-Sync / MV Rules

Map visual events to rhythm drivers:

- hi-hat roll -> micro shake, jump-frame, small typography reassembly.
- snare -> hard cut, text punch-in, shoulder/head accent.
- 808 bass hit -> low-frequency screen compression, flash, text stretch.
- vocal keyword -> mouth shape, jaw, head nod, hand gesture, typography reveal.

Avoid random text motion. Text and cuts should follow audible events.
