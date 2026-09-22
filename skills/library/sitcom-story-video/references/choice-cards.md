# Progressive Choice Cards

Use these cards to guide a user from a vague idea to a locked sitcom production brief. They are conversational cards rendered as compact Markdown, not a separate application UI. Ask one card at a time unless the user requests a one-shot setup.

## Card protocol

- Render each card as an interactive selectable option card whenever the interface supports it; the user should be able to continue by clicking an option instead of typing.
- Keep each card to 3-5 options plus `自定义`.
- Put the recommended option first and label it `推荐`.
- State the practical consequence in one short line, not a feature tutorial.
- Keep typed replies such as `A`, `B`, `默认`, or custom text as a fallback for interfaces without clickable cards.
- Accept `默认` to choose all recommended options on the current card.
- Accept combined answers such as `A2, B1` only when multiple cards are shown together.
- After each answer, confirm the selection in a single line and move forward.
- Do not ask for information that will not change the story, cut map, prompt syntax, or delivery format.
- Preserve a visible state block: `模式 / 时长 / 画幅 / 喜剧引擎 / 视觉预设 / 切镜策略 / 音频`.

## Card 1: production mode

```text
【1｜制作模式】
A. 概念开发（推荐）— 从一句话想法建立人物、场景和喜剧引擎
B. 分镜设计 — 已有故事，输出镜头表与画面提示词
C. H3 Prompt Pack — 已有分镜，直接写 H3 多镜头时间线提示词
D. 修改诊断 — 修复切镜、质感、连续性或节奏问题
E. 自定义：____
回复 A-E 或“默认”
```

## Card 2: format and delivery

```text
【2｜规格】
A. 45-60 秒，16:9，横屏平台（推荐）
B. 20-30 秒，9:16，短视频平台
C. 75-90 秒，16:9，完整小剧场
D. 自定义：时长 / 画幅 / 平台 / 帧率
```

If the user already names H3, add `模型：MiniMax H3｜参考模式：全能参考` to the state instead of asking a redundant model card.

## Card 3: sitcom world and comic engine

```text
【3｜喜剧世界】
A. 合租客厅：生活规则被误解（推荐）
B. 办公室：职位与能力错位
C. 家庭厨房：小事升级成灾难
D. 近未来服务空间：机器严格按字面执行
E. 自定义地点与关系：____
```

Then, if the user has not supplied one, show a second compact card:

```text
【3B｜喜剧引擎】
A. 过度自信的计划不断升级（推荐）
B. 一本正经的字面误解
C. 所有人都看见、只有主角不知道的秘密
D. 关键道具故障并改变社交地位
E. 自定义：____
```

## Image resolution choice

Before the first image-generation operation, always show this interactive card unless the user already specified the image resolution. The selected resolution is locked for all character, scene, prop, and storyboard images in the current production.

```text
【图片清晰度】
A. 1K（推荐）— 适合快速验证角色、场景和故事板，生成成本较低
B. 2K — 适合更清晰的角色细节和最终参考图，生成成本与资源消耗更高
```

Do not generate any image before the user selects A or B.

## Default visual preset

The visual preset is automatically locked to the original late-1990s/early-2000s warm indoor television sitcom look. Do not show a visual-texture choice card. If the user explicitly requests another visual style, record that request and use it as the override.

## Card 4: cut and camera strategy

```text
【4｜切镜策略】
A. 经典覆盖：主镜建立 + 两人镜 + 反应近景，动作切为主（推荐）
B. 快节奏喜剧：1.0-2.0 秒短镜，反应切与视线切密集
C. 表演长镜：较少切镜，推拉/横移跟随表演，关键处插入反应镜
D. 混合：A 建立、B 交互、C 反应，按笑点密度调整
E. 自定义：镜头数量 / 节奏 / 转场____
```

The selected strategy must become a real cut map. Every generated prompt still needs exact timecodes, shot IDs, framing, lens, camera movement, action peak, cut type, and continuity handoff. Never output only a style description.

## Card 5: audio and dialogue

```text
【5｜声音】
A. 有对白：短句、可见说话者、对白下压环境音（推荐）
B. 少对白：以动作和反应为主，保留关键一句
C. 无对白：只用同步拟音、环境声和停顿
D. 自定义：语言 / 口型要求 / 音乐许可____
```

When the user chooses no dialogue, do not add silent talking or generated subtitles. When dialogue is selected, bind each line to a visible speaker and reserve enough screen time for the line and reaction.

## Card 6: H3 generation strategy

Show this card only when H3 is selected or the user asks for H3-specific prompts:

```text
【6｜H3 生成方式】
A. 多镜头时间线：一条 prompt 写完整时间码、切点与运镜（推荐）
B. 关键镜头优先：主镜/反应镜/道具镜分别写，后期按 cut map 组装
C. 混合：可稳定的镜头写在同一时间线，复杂镜头拆分生成
D. 自定义：____
```

Do not treat option B as a mandatory restriction. The selected mode changes packaging only; the cut map, exact camera direction, and continuity anchors remain mandatory in all modes.

## Completion card

Before expensive prompt writing, show:

```text
【已锁定】
模式：...
规格：...
喜剧世界 / 引擎：...
视觉预设：暖色复古室内情景喜剧（默认锁定）
切镜策略：...
声音：...
H3 生成方式：...

A. 确认并生成
B. 返回修改某一项
```

After `A`, produce the required deliverables. After `B`, show only the relevant card again and keep all other selections unchanged.

## Post-final BGM offer

After a final video is successfully assembled and passes basic QA, always show this interactive card before any BGM work:

```text
【成片声音选择】
A. 添加器乐 BGM（推荐）— 先分析成片节奏，再确认配乐方案
B. 仅保留原始声音 — 直接交付当前成片，不添加新音乐
```

Do not generate BGM until the user selects A. If the user selects B, deliver the original-audio final video and close the sound branch.
