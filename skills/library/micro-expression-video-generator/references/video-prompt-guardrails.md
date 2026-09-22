# Video Prompt Guardrails — micro-expression performance to video

Use this file whenever a confirmed performance prompt pack is converted into a video-generation prompt. These guardrails prevent common drift: unwanted cuts, accidental smiles, overacting, identity drift, and emotion polarity changes.

## 1. Shot-continuity lock

For subtle micro-expression videos from a still image, default to a single continuous shot. However, shot changes are allowed when the user explicitly requests camera changes, multiple shots, a scene transition, a reaction cut, or when the creative task clearly requires camera movement or shot variation to express the performance.

Default single-shot wording:

- 默认全程单镜头，一镜到底。
- 默认不切镜，不换景别，不转场，不插入反打，不改变机位。
- 默认保持原图特写构图，只允许面部、眼神、呼吸、头颈和必要的轻微身体微动。

Override rule:

- 如果用户明确要求镜头变化、运镜、切镜、反打、转场、多镜头，或任务本身明显需要镜头变化来完成表演表达，可以设计镜头变化。
- 发生镜头变化时，必须说明每个镜头的新信息：新的情绪阶段、新的视线关系、新的身体反应、新的空间关系或新的叙事反馈。
- 不要为了凑时长而切镜；镜头变化必须服务表演。

When using one shot, do not write `镜头1 / 镜头2 / 镜头3`; write time beats inside the same shot: 起始状态 → 微泄露 → 压回 → 收束. When using multiple shots, clearly state why each shot change is needed for the performance.

## 2. Emotion polarity lock

Before generating video, identify the target emotional polarity and protect it.

Examples:

- 失恋却冷静 = grief + composure + numb clarity. It is not relief, not forgiveness, not gentle happiness, not a bittersweet smile.
- 爱而不得 = longing + restraint. It is not flirtation or shy sweetness unless requested.
- 强装镇定 = anxiety or sadness behind control. It is not confidence.
- 笑着崩溃 = smile as failing mask. The smile must break or become unstable; it is not warm joy.

If the target contains grief, breakup, loss, betrayal, regret, numbness, or restraint, never let the ending drift into warmth, relief, or smiling unless the user explicitly asks.

## 3. Mouth-corner safety rules

Mouth wording is high-risk because video models often convert ambiguous mouth-corner language into smiling.

Avoid these phrases for grief/restraint unless the user wants a smile:

- 嘴角撑住
- 温和
- 体面微笑
- 苦笑
- 淡淡笑
- 礼貌笑
- 释然
- 嘴角微微上扬
- smile, slight smile, gentle smile, soft smile, bittersweet smile

Safer replacements:

- 唇线维持平直
- 嘴角不上扬
- 嘴角不笑也不明显下垂
- 口周肌肉轻微收紧后恢复中性
- 下颌一侧轻轻绷住
- 双唇保持闭合，只有极轻的压力变化

For loss/grief prompts, explicitly state: `嘴角全程不上扬，不出现微笑、苦笑、释然笑或礼貌笑。`

## 4. Micro-expression timing structure

For subtle acting, use four beats inside one shot:

1. **Baseline** — preserve source image expression and framing.
2. **Leakage** — one very brief visible cue: delayed blink, eyelid heaviness, gaze defocus, swallow, breath catch, jaw tension.
3. **Recovery** — the character suppresses the cue: brow smooths, lips return to neutral, breath becomes shallow.
4. **After-state** — the face returns to neutral but feels changed: quieter, emptier, more distant, more guarded.

The after-state must be consistent with the emotion. For breakup/grief: quieter and more hollow, not warmer.

## 5. Negative guidance discipline

Use negative guidance only for real risks, but include it when converting to video because models tend to exaggerate acting.

For restrained breakup prompts, include:

- 不哭，不流泪，不皱眉，不张嘴，不微笑。
- 不切镜，不转场，不改变脸型、发型、服装、背景。
- 不出现明显戏剧化动作，不低头崩溃，不摇头。

## 6. Pre-generation self-check

Before calling a video model, check:

- Did I accidentally write multiple numbered shots when the user wants one continuous micro-expression?
- Did I include words that can be interpreted as smiling?
- Does the final beat preserve the intended emotion, or did it drift into relief/softness?
- Did I preserve source image identity, framing, posture, clothing, and background?
- Are the visible cues small enough for the chosen intensity level?
- Did I ask for duration and aspect ratio if missing?

If any answer is unsafe, rewrite the video prompt before generation.
