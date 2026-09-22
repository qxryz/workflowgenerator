---
name: half-narrated-3d-short-drama
description: |
  把故事、剧本或参考素材整理成引导式 3D 漫剧半解说短剧，规划旁白和对白，生成有锚点的镜头，交付对白视频与独立旁白音频。
trigger-words: [3D漫剧半解说短剧, 3D半解说短剧, 3D漫剧短剧, 国漫3D短剧, 3D渲染短剧, 灵笼风短剧, 眷思量风短剧, 3D manhua drama, 3D half-narrated short drama, 3D animated short drama, manhua-style 3D]
---

# 3D 漫剧半解说短剧（引导式全流程版）

当用户想把一句故事、粗略剧本、参考图或已有素材推进成一集可成片的 **3D 漫剧半解说短剧** 时使用这个 Skill。旁白负责背景、时间跳转、内心想法和不能直说的信息；对白负责冲突、揭示、反转和情绪爆点。

**画面风格已锁**：3D 渲染 + 漫剧 webtoon 分镜语言。本 Skill 只支持这一种视觉轨道。**不是 2D 描边、不是 Pixar/Disney 硬 3D、不是写实 CG、不是真人实拍**。

**旁白音色 Top-2**：从「抖音解说男声」和「抖音解说女生」两个抖音解说风格音色中按 Q2 题材自动推荐一个，整集保持一致。

**全流程引导式**：每个不可逆的决策点都用 `question` 选项卡问用户，并给出合理默认值，用户只需确认或挑选，不需要从零写 brief。

**默认视频生成**：使用 **MiniMax-H3**；默认按约 10 秒镜头规划，仅在剧情需要快切时使用更短镜头。用户明确选择其他模型时先检查能力，兼容后遵循选择；生成失败先按原因修复并重试一次，仍失败就切换其他兼容模型，不反复死磕同一模型。

**资产轻量化**：每主要角色 **1 张主卡 + 1 张三视图（正/侧/背）**（3D 角色要旋转运镜，所以多角度不可省），每主要场景 **1 张主卡 + 1 张辅卡**（主卡定调，辅卡支撑运镜），至多 1 张道具卡。

**用户语言跟随**：所有面向用户的说明、`question` 选项、进度提示、总结和最终回复都要跟随用户当前语言；用户原文保持逐字不改。

**三大交付硬关卡**（任何一项不通过都不交付）：
1. **剧情不删减** [HARD GATE]：原剧本每个剧情点都要保留，不许压缩/改写以适应时长
2. **画布门禁** [HARD GATE]：最终规格 + 核心资产 + 视频生成前产物都必须在画布上
3. **用户语言跟随 (ULF)** [HARD GATE]：所有面向用户的输出跟随用户当前语言；用户原文（角色名/场景名/旁白/对白）逐字保留

> **ULF 完整规范见 `references/user-language-rules.md`（v2.0.3 新增）**——12 个 user-facing 场景 + 5 个不翻译边界 + 8 项 QC 硬关卡。本文件每个 STEP 末尾都会用 `[ULF]` 标记提醒执行。

不要把它用于真人实拍、纯剪辑、纯 2D 描边，或长篇系列统筹。

---

## STEP 0：交互式起手——选项卡开局

**目标**：在第一轮里把 5 个"返工成本最高"的决定一次性锁死，让后面的流水线不再反复回头问用户。

⚠️ **必问口播**：这一步必须调一次 `question`（多步版本），**5 个问题全部要问**，每个都给 ★ 默认值。**绝对不能跳过问题 5（旁白音色）**——它和视觉风格一样是整集级别的硬锁。

调一次多问题 `question`（in-app 工具支持一次多步），按顺序问下面 5 个问题。所有问题、选项和说明都要跟随用户当前语言来写。每个问题都给出推荐默认。用户始终可以选 "Other" 或在备注里写自定义方向。

### 问题 1（必问）— 起始路径
- **从零开始（推荐）**：我只有一句故事想法
- 半成品素材：我有剧本片段、人物小传或参考图
- 完整素材：我有成型的角色设定、场景图和完整剧本

### 问题 2（必问）— 题材轨道

| Option | label | 适合平台 | 推荐旁白（自动推到 Q5） |
|---|---|---|---|
| ★ 1 | 都市悬疑 | 抖音 / 红果 | 抖音解说男声 |
| 2 | 古风玄幻 | 红果 / 番茄 | 抖音解说男声（可切女声） |
| 3 | 都市情感 | 抖音 / 红果 | **抖音解说女生** |
| 4 | 校园青春 | 抖音 | **抖音解说女生** |
| 5 | 逆袭成长 | 抖音 / 红果 | 抖音解说男声 |
| 6 | 末世求生 | 红果 | 抖音解说男声 |
| 7 | 异世界冒险 | 番茄 / ReelShort | 抖音解说男声 |
| 8 | 自定义——1–2 句话写清 | — | 抖音解说男声（默认） |

> 经验法则：**男频题材**（悬疑/权谋/战斗/惊悚/末世）→ 男声；**女频题材**（情感/校园/治愈）→ 女声；古风/通用 → 默认男声，用户可切女声。

### 问题 3（必问）— 格式锁定
- **画幅**：9:16 竖屏（默认，适配抖音/红果/ReelShort）/ 16:9 横屏 / 1:1
- **时长**：30s 钩子版 / 60s 短版 / 90s 标准版（3D 漫剧单镜更长，镜数比 2D 少）/ 3min 完整版
- **字幕方式**：硬烧字幕 / 软字幕 / 不带字幕
- **发布目标**：抖音 / 红果 / ReelShort / YouTube Shorts / TikTok / 其他

### 问题 4（必问）— 视觉风格确认（**不是自由选择**——风格已锁）

视觉风格锁死为"3D 渲染 + 漫剧 webtoon 分镜语言"，这里只是让用户在同一个 3D 漫剧家族里挑子模式：

- **国漫 3D 渲染流（默认）**：3D 角色 + 3D 场景 + 漫剧分镜感 + 干净描边（在 3D 渲出来后再叠一层轻描边）+ 强对比光影。最贴近《灵笼》《眷思量》《伍六七之玄武国篇》这类 3D 国漫短剧。
- **皮克斯 Disney 流**：Q 版比例（头身比偏大）+ 圆润质感 + 大眼 + 偏柔光影 + 漫剧分镜感。
- **半厚涂 3D 写实流**：3D 渲染但带手绘厚涂感（PBR 材质但保留笔触感）+ 中等对比光影 + 偏写实人设 + 漫剧分镜感。

> 上述三种之外的视觉（纯 2D 赛璐珞、纯 Pixar 卡通无漫剧感、纯写实 CG、纯真人实拍、油画、水墨、纯黑白线稿）请用户换其他 skill。

### 问题 5（必问，⚠️ 不能跳过）— 旁白音色（Top-2 抖音解说风格）

**前两个选项永远是「抖音解说男声」和「抖音解说女生」**，★ 默认项按 Q2 题材自动推荐。

| # | 用户看到的标签 | voice_id | 风格 |
|---|---|---|---|
| ★ 1 | **抖音解说男声** | the locked catalog narrator voice | 沉稳、清晰、解说感强；最像抖音热门剧情号男旁白 |
| ★ 2 | **抖音解说女生** | the selected catalog narrator voice | 偏新闻播报的女声，最贴"女解说"——清晰、稳重 |
| 3 | 温润男声 | a selected catalog voice | 偏温和，克制；适合古风/虐恋 |
| 4 | 沉稳高管 | a selected catalog voice | 偏成熟、权威；适合权谋/商战/悬疑 |
| 5 | 抖音青年解说 | a selected catalog voice | 真诚青年，更口语化 |
| 6 | 青年大学生 | a selected catalog voice | 偏年轻，校园感 |
| 7 | 自定义 / 试听 | 留空 / 备注 | 让用户从完整音色表里试听后选 |

**按 Q2 题材自动推荐 ★ 默认**：

| Q2 题材 | 问题 5 ★ 默认 | voice_id |
|---|---|---|
| 都市悬疑 | 抖音解说男声 | the locked catalog narrator voice |
| 古风玄幻 | 抖音解说男声 | the locked catalog narrator voice |
| 都市情感 | **抖音解说女生** | the selected catalog narrator voice |
| 校园青春 | **抖音解说女生** | the selected catalog narrator voice |
| 逆袭成长 | 抖音解说男声 | the locked catalog narrator voice |
| 末世求生 | 抖音解说男声 | the locked catalog narrator voice |
| 异世界冒险 | 抖音解说男声 | the locked catalog narrator voice |
| 自定义 | 抖音解说男声 | the locked catalog narrator voice |

> ⚠️ **反模式**（gender mismatch）：不要给女频/女强主角的剧强行配男声（比如"女频逆袭"+"男声"会很突兀）。STEP 0 Q5 的★ 默认就是为了避免这个错误。完整推荐逻辑见 `references/voice-presets.md`。

### STEP 0 产物

一张固定的 **Project Lock Card**，包含：
- **user_language** [NEW for v2.0.3]：从用户第一条消息检测，锁到 session 结束；驱动所有 ULF 规则
- **output_language** [NEW for v2.0.3]：默认 = user_language；如果用户要发到其他语言平台可覆盖
- start_path
- track
- aspect_ratio, duration, subtitle_mode, delivery_target
- visual_style_lock: `3D-manhua-cel` + sub_mode（默认 国漫 3D 渲染流）
- **narrator_voice_id（默认 the locked catalog narrator voice）** + narrator_voice_preset_label（用平台本地化名称，如 `抖音解说男声`）
- **`narrator_volume`（默认 `1.8`，范围 1.2-2.0）** [NEW for v2.0.1] — 旁白必须比默认 1.0 显著大，否则嘈杂环境听不清，半解说功能废
- video_generation：平台选择的图生视频能力；默认按约 10 秒镜头规划

> **v2.2.0**：分镜阶段必须先预留旁白和对白时间窗。STEP 5.6 只负责实测并锁定时间表，STEP 6 按时间窗生成视频；旁白单独交付给用户自行剪辑，不自动合成最终视频。

在 Project Lock Card 填好并回给用户前，**不要进入 STEP 1**。

### 旁白音色反问规则

如果用户在中途（比如 STEP 3 / STEP 5）问"换个音色"或"试试 X 音色"，允许重新走问题 5 的清单，但必须明确：
- 换音色后**整集重生成所有旁白音频**（旧的全废）
- 旁白音色锁从这一刻重新生效，下一集沿用

如果用户从第一集跑到第二集，**默认沿用上一集的 voice_id**，不再问问题 5。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 1：分析素材并读懂故事

如果用户是从零开始：用一次 `question` 问 2–3 个轻量问题，提取故事前提（用"Other"做自由文本兜底，再配几个结构化选项做子风格分流）。如果用户已经给了剧本或参考图，直接进入分析。

分析素材，提取：
- 故事前提与开场钩子
- 冲突脊柱与转折点
- 旁白与对白分工
- **视觉 DNA**：3D 角色比例、材质逻辑（皮肤/布料/金属）、色彩、光照方向、漫剧分镜语言（**必须落在 3D 漫剧家族内**）
- **运动逻辑**：3D 角色动作的可动性、镜头运镜自由度（轨道/跟拍/推拉）、环境运动
- 连续性风险：身份漂移、材质漂移、光照漂移、节奏死点或画面过静

### 旁白/对白分类硬规则 [HARD GATE]

> **为什么必须有这条护栏**：narration-first 的前提是剧情完整且台词归属清晰。原剧本里每句话必须明确归到旁白还是对白，否则 STEP 5.5 剧本对账和 STEP 5.6 narration-first 都无法对齐。

**判断一句话是旁白还是对白的硬规则**（STEP 1 输出必须按这个分类）：

| 句式特征 | 类别 | 例子 |
|---|---|---|
| 第一人称（"我"/"我们"）+ 心理活动/内心独白 | **旁白** | "我心里想：她一定在骗我。" |
| 第一人称 + 时间跳转/背景交代 | **旁白** | "那一年，我十八岁。" |
| 第三人称叙述/环境描写 | **旁白** | "三天后，京城下起了大雪。" |
| 带引号 + 明确说话人 + 动作/情绪描写 | **对白** | 他冷笑一声："你该行礼了。" |
| 同镜多角色对话（不论是否带引号） | **对白** | 萧珩："是你？" / 沈清晚点头。 |
| 模糊情况（无引号、无说话人） | **待定** | 标 `needs_user_confirm: true`，让用户确认 |

**输出格式**（STEP 1 末尾产出的 `narrative_split.md`）：

```yaml
narration_lines:
  - text: "我心里想：她一定在骗我。"
    needs_user_confirm: false
  - text: "三天后，京城下起了大雪。"
    needs_user_confirm: false
dialogue_lines:
  - speaker: "萧珩"
    line: "你该行礼了。"
    tone: "冷淡"
    needs_user_confirm: false
pending:
  - text: "他转身离去。"
    reason: "无引号无说话人，无法判定"
```

`needs_user_confirm: true` 的行必须用一次 `question` 问用户"这句是旁白还是对白？"，不能默认。

**硬约束**（剧情不删减 [HARD GATE]）：原剧本里的每一句话都必须归入上面三类之一，**不许漏**。如果一句话既像旁白又像对白（比如第一人称内心独白 + 嘴在动），按"拆镜或分窗"处理（见 STEP 2 冲突解决），不要在分类阶段就合并。

针对每个主要节拍，写一条简短的内部导演判断：
- 戏剧功能、转变、视角、权力变化
- 隐藏目标、阻碍 / 策略
- 潜台词或矛盾
- 可见的压抑动作
- 不可移植细节
- 拒绝的俗套方案

这些判断只用于内部规划。

**STEP 1 末尾**：把导演读解压缩成 5 个 bullet + `narrative_split.md` 给用户看，并 question："是否进入下一节拍链？（进入 / 调整钩子 / 调整题材 / 旁白对白分类有未决项要解决）"

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 2：搭建故事主线和单集节拍链

从 STEP 0 锁定的轨道出发，把这一集定义成 5 个节拍：
1. **设定**（Setup）
2. **压力**（Pressure）
3. **应对**（Response）
4. **转折**（Turn）
5. **悬念 / 收束**（Cliffhanger or Payoff）

旁白通道的职责：
- 交代背景、时间跳转、内心想法和角色不能直接说的话
- 不能替角色对白完成冲突、揭示、反转或情绪爆发
- 旁白只能支撑故事，不能把戏剧性说平

对白通道的职责：
- 承担关键对撞、揭示、拒绝、反击和情绪转折
- 台词要短、利落、口语化
- 主要角色最好有稳定的说话口癖或固定句式

默认配比：
- 旁白约 60%，对白约 40%
- 连续 2 段旁白后必须接动作或对白节拍
- 旁白和对白若同处一个镜头，必须分到不同时间窗且不重叠
- **如果同一剧情点既需要旁白又需要对白，优先通过拆镜、延长镜头或前后错位解决，不许硬叠成同一时间段**
- **绝不删减原剧本中的剧情点；只能移动到相邻镜头、拆分到下一镜或保留完整台词**
- 旁白音频按镜头先生成，再单独交付给用户自行剪辑
- 对白默认来自视频原声

### 旁白完整性自检（STEP 2 末尾，narration-first 护栏 1/3）**[硬关卡]**

> **为什么必须有这条护栏**：narration-first 的前提是剧情完整。如果旁白写得稀薄、靠 STEP 5.6"为对齐时长去改写"来补，那 5 节拍链跑完后剧情已经被磨平了。所以旁白完整性必须在 STEP 2 就硬性自检，不留到 STEP 5.6 补救。

**5 个完整性自检项**（每项必须能 ✅，否则改 STEP 2 而不是留到后面）：

1. ✅ **每段旁白能否独立承载一个剧情支点**（背景 / 时间跳转 / 内心想法 / 不可直说）？空话、纯过渡、口水话不能作为一段旁白存在。
2. ✅ **每节拍是否都有足够的"信息密度"**？如果某一节拍只有一句话旁白、剩下的全靠动作/对白承担，节拍要重新分配旁白字数。
3. ✅ **"红线圈内"内容有没有漏**？红线圈内 = 不通过画面动作能直接读出的关键信息（角色关系、隐藏动机、时间限制、伏笔）。这些信息必须由旁白或对白承担，不能省略。
4. ✅ **"重复讲述"有没有？** 旁白不要把画面已经讲清的事再说一遍。
5. ✅ **结尾节拍是否真的留了悬念 / 给了收束**？

**自检不通过的处置**：
- 不通过 → 改 STEP 2（节拍链 / 旁白通道职责 / 配比），不通过 STEP 5 改旁白文本，不通过 STEP 5.6 删旁白字。

**STEP 2 末尾**：把 5 个节拍用一张紧凑表格 + 旁白完整性自检表给用户看，并 question："节拍链是否通过？（通过 / 调整某节拍 / 改结尾方向 / 旁白自检不过要重做）"

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 3：写最终视频规格书

规格必须包含（详见 `references/final-video-spec.md`）：
- 剧名
- 画幅、单集时长、输出语言
- **visual_style_lock: `3D-manhua-cel`** + sub_mode（继承自 STEP 0）
- 主角旁白设定
- 旁白 / 对白比例
- 世界观、时代、阵营或冲突系统
- 字幕方式
- 发布目标
- 连续性规则
- 镜头数量目标
- 全局约束：不要额外文字覆盖，不要水印，镜头渲染里不要直接内嵌背景音乐
- **视频能力锁定**：使用平台当前可用的图生视频能力；保持已确认画幅与各镜头时长
- **音频锁定**：`narrator_voice_id`（继承自 STEP 0，默认 the locked catalog narrator voice），全片用一个音色；对白声音映射每个说话角色；除非用户明确批准，旁白和对白不重叠
- **画布规则 [HARD GATE]**：把最终规格和所有核心资产卡默认放到画布上；凡是视频生成前产出的核心资产，也必须先放到画布上，方便用户检查和修改后再继续。
- **剧情不删减规则 [HARD GATE]**：原剧本每个剧情点都要保留，不许压缩/改写以适应时长
- **3D 漫剧资产计划**：每主要角色 = 1 主卡 + 1 三视图（正/侧/背）；每主要场景 = 1 主卡 + 1 辅卡

**强制**：在任何高成本资产生成之前，先用一次 `question` 让用户确认规格。问题选项：通过 / 调整画幅时长 / 调整题材轨道 / 调整视觉子模式 / 调整旁白音色。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 4：规划关键资产与视觉状态账本

把资产分成三层：
1. **核心资产**：主角、主要复用场景、第一件关键道具
2. **条件资产**：重要配角、明显影响走位或剧情理解的场景变体与道具
3. **跳过资产**：一次性背景细节、无名路人、没有连续性价值的物件

规划并记录：
- 主要角色（每个主要角色需要：1 张主卡 + 1 张三视图（正/侧/背））
- 复用场景（每个主要场景需要：1 张主卡 + 1 张辅卡（远景/近景））
- 核心道具（至多 1 张道具卡）
- 音频关键项：旁白音色、对白音色、音效、BGM 情绪
- **锁定的旁白 voice_id**（继承自 STEP 0）——每一个旁白片段都用这个音色
- 每个说话角色的对白声音映射表

每个镜头都要写视觉状态账本（见 `references/visual-state-ledger.md`）。

**风格护栏提醒**：每一条视觉状态描述都必须落在 3D 漫剧家族内。不要出现"纯 2D 描边""纯 Pixar 卡通""纯写实 CG""真人实拍"。

**3D 多角度资产约束**（核心差异）：
- 每个主要角色必须出**三视图**（正面 / 侧面 / 背面），用于旋转/轨道运镜
- 每个主要场景必须出**辅卡**（主卡定调，辅卡支撑不同运镜视角）

在生成关键设定图之前，用 `question` 让用户选先出哪几件核心资产。**画布门禁 [HARD GATE]**：这些资产一旦生成，**必须立即放到画布上**，供用户检查和修改后再进入后续视频生成。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 5：编写分镜与提示词包

把分镜写到用户不需要重新解释的程度。每个镜头都应包含（见 `references/storyboard-design.md`）：
- 镜头标题与节拍角色
- 预计时长（**6-10s**，3D 漫剧 H3 10s 模式为主）
- 场景与角色
- 走位与空间锚点
- 带时间窗的旁白（**统一格式 `[{text, start, end}]`，end 由 STEP 5.6 填入真实 TTS 时长**）
- 带说话人和语气的对白（**统一格式 `[{speaker, line, tone, start, end}]`，end 由 STEP 6/7 填入实测时长**）
- 表演说明
- 起始状态
- 动作推进
- 供下一镜继承的结束状态
- 发声镜头的音频时间轴：旁白/对白预留时长、起止时间、安全间隔和镜尾余量
- **3D 漫剧风格块**：3D 渲染 / 漫剧分镜 / 多角度锚点 / 材质关键词
- first_frame source（含 first_frame_angle_match 3D 特有字段）

分镜规则：
- 每个镜头都必须改变故事状态或镜头语法
- 相邻镜头不能重复同一动作、同一首帧或同一种镜头逻辑
- 一个镜头只承担一个主要情绪或信息任务
- 镜头之间的承接要写清楚
- 旁白和对白若同处一个镜头，必须在分镜阶段先排好不重叠的时间窗，并留出安全间隔
- 旁白音频按镜头先生成，然后在装配阶段叠回视频
- **3D 漫剧运镜**（区别于 2D）：可以使用轨道跟拍、推拉、平移、旋转；运镜时间长（6-10s），节奏比 2D 更慢

### 分镜阶段音频空间预留【硬关卡】

设计每个镜头时，必须先给旁白和对白安排位置，再写动作和口型。每个 shot 至少记录 `narration_window`、`dialogue_window`、`narration_reserve_sec`、`dialogue_reserve_sec`、`gap_sec` 和 `tail_buffer_sec`。旁白与对白不能重叠；默认旁白不超过镜头时长的 35%，对白不超过 55%，两段说话之间至少留 0.3 秒，镜尾至少留 0.3 秒。视频提示词必须携带这些时间窗，明确旁白窗口不安排角色说话。小幅实测偏差直接生成并记录，用户可自行剪辑，不因小偏差反复改分镜或重生成。只有窗口重叠、对白缺失或音频不可用时才返工。

### 旁白字数预估前置（STEP 5 末尾，narration-first 护栏 2/3）**[硬关卡]**

> **为什么必须有这条护栏**：STEP 5.6 改写旁白会磨掉剧情，所以旁白字数要在 STEP 5 就卡死，不让"超长旁白"流到 STEP 5.6 才发现。

**预估公式**（按 STEP 0 锁定的 voice_id 和 speed）：

```
预估旁白时长 = 旁白中文字数 × 0.25s + 0.3s 起手缓冲
（基于 male-qn-* / Chinese (Mandarin)_* 系列，speed=1.0 时的平均语速 ≈ 4 字/秒）
```

**分镜阶段旁白字数硬上限**（3D 漫剧 H3 10s 模式）：

| 镜头类型 | 最大旁白字数（中文） | 对应最长时长 |
|---|---|---|
| 普通镜头（6-10s） | 28 字 | ~7.3s + 0.3s 缓冲 = 7.6s（塞进 8s 镜头） |
| 关键情绪镜（8-10s） | 32 字 | ~8.3s + 0.3s 缓冲 = 8.6s（塞进 9s 镜头） |
| 大段内心 / 背景（10s） | 36 字 | ~9.3s + 0.3s 缓冲 = 9.6s（塞进 10s 镜头） |

**判定规则**：
- 字数 ≤ 上限 ✅ — 旁白文本能塞进镜头，STEP 5.6 大概率会 ✅
- 字数 > 上限 ⚠️ — **STEP 5 阶段就拆**：要么拆给下一镜（必须显式标注"接上镜旁白"），要么拆成两段对白/动作承载
- 字数 > 上限 × 1.3 🔴 — **回 STEP 2 改节拍链**：这段旁白承载了太多剧情支点，应该把剧情分到多节拍承载，而不是塞进一个镜头

**STEP 5 末尾动作**：每个镜头的 `narration_text` 旁标注 `narration_word_count` 和 `narration_predicted_duration`，作为 STEP 5.6 跑前的人类可读检查表。

如果用户只要分镜包，就在这里停下交付。否则把分镜给用户过一遍，question：通过 / 调整某镜 / 调整某段对白 / 调整节奏 / **某镜旁白字数超上限要拆**。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 5.5：剧本对账检查 **[强制，硬关卡]**

> **为什么必须有这一步**：避免 STEP 5 出分镜时漏了某个剧情点，等到 STEP 8 视频都生完了才发现"这段对白呢？" — 必须前置对账。

在 STEP 5.6 之前必须先过这一关。

### Step 5.5.1 — 列出原剧本所有剧情点

从 STEP 1 的 `narrative_split.md` 提取：
- `original_plot_points[]`：所有 `narration_lines` 的 `text` + 所有 `dialogue_lines` 的 `line`
- 标号：P001, P002, P003 ...

### Step 5.5.2 — 列出分镜覆盖的剧情点

从 STEP 5 产出的 storyboard 提取：
- `covered_plot_points[shot_id] = [P001, P003, ...]`
- 每镜的 narration_lines / dialogue_lines 反向映射到 plot point

### Step 5.5.3 — 对账表

输出 `script_reconciliation_table`：

| plot_point | text | covered_by_shot | status |
|---|---|---|---|
| P001 | "我心里想：她一定在骗我。" | shot_03 | ✅ |
| P002 | "他冷笑一声：你该行礼了。" | shot_05 | ✅ |
| P003 | "三天后，京城下起了大雪。" | — | ❌ 未覆盖 |
| P004 | "我冲出了王府。" | shot_08 | ✅ |
| ... | ... | ... | ... |

`status` 三种：
- ✅ `covered`：某镜的 narration_lines / dialogue_lines 包含这条
- ❌ `missing`：分镜里没有
- ⚠️ `partial`：被改了字（比如简化、合并）

### Step 5.5.4 — 处理 missing / partial

用一次 `question` 问每条 ❌/⚠️：

| Option | label | 何时选 |
|---|---|---|
| ★ 1 | 补一个分镜 | 漏的剧情点必须保留 |
| 2 | 合并到相邻分镜 | 内容能融进现有镜 |
| 3 | 用户明确删 | 用户自己说这段不要了 |
| 4 | 移到下一集 | 这一集讲不下，下一集接 |

**反模式**：
- ❌ 默认 ❌ → ✅（假装对账通过）
- ❌ 让用户看不到对账表
- ❌ 漏的剧情点超过 20% 还强行进 STEP 5.6

### Step 5.5 产物

- `script_reconciliation_table`（对账表）
- 用户的处理决策（每个 ❌/⚠️ 一条决策）
- **更新后的 storyboard**（如果有补/并/删/移）
- **`shot_audio_schedule`（v2.0.2 关键产物，每镜的旁白+对白时间窗预排表）** — 详见 `references/audio-timeline.md`

在 `script_reconciliation_table` 通过、storyboard 更新前，**不要进入 STEP 5.6**。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 5.6：校验分镜预留的旁白和对白时间表，再按时间表生成视频**[强制，v2.2.0]**

> **v2.0.2 改名**：`narration-first` 升级为 `schedule-first`。STEP 5.6 不光生成旁白音频，也**生成对白 TTS 预演**（仅用于量时长，不入成片），把旁白+对白的预留时间窗都排好，作为 `shot_audio_schedule` 锁死。STEP 6 prompt 引用这张表引导 H3 按时间窗生成视频。
>
> **v2.2.0**：分镜设计先分配音频空间，旁白和对白各有明确时间窗。小幅实测偏差直接接受并记录，用户可在剪辑阶段自行微调，不反复修改镜头。

**前提**：剧情骨架必须先完整（STEP 5.5 通过）。schedule-first 不是拿来补一段还没讲完的故事，而是把已经完成的单集剧情、节拍链、逐镜台词、剧本对账都锁定后，把音频时间表排出来。

**🚨 护栏 3/3（剧情完整优先）**：所有决策都把"剧情完整"放在"对齐时长"之前。规则：
- ✅ ✅ 优先：调整镜头时长（不伤剧情）
- ✅ 次优：在分镜阶段拆给下一镜或延长到允许范围
- 🟡 小幅时长偏差：直接接受，记录实际时间，交给用户自行剪辑
- 🔴 只有出现窗口重叠、对白缺失或音频不可用时，才返工对应镜头
- 🔴 永远不允许：加快语速、强行删字、强行把长文本塞进短镜头

> **STEP 5 锁定文本后，本节不允许删任何剧情字。** 文本修改只能由用户显式批准，只能优化口水话/过渡句。

### Step 5.6.1 — 批量 TTS 生成（mixed 模式：旁白实测 + 对白 TTS 预演）**[v2.0.5: 单一 mixed 模式]**

STEP 5.6 调用 `batch speech synthesis` 一次生成旁白实测音频与对白时长预演两股流：

```python
    requests=[
        # --- Stream A: 旁白（LOCKED，最终视频用）---
        {
            "text": "<shot 01 旁白文本>",
            "output_file_path": "audio/shot_01_narration.mp3",  # 锁定文件
            "voice_id": "Chinese (Mandarin)_Male_Announcer",  # STEP 0 锁定
            "speed": 1.0,
            "emotion": "neutral",
            "volume": 1.8,  # [v2.0.1] 旁白音量比默认大 80%
        },
        # --- Stream B: 对白 TTS 预演（仅量时长，不入成片）---
        {
            "text": "<shot 01 对白 - 说话人 萧珩>",
            "output_file_path": "audio/_preview/shot_01_dialogue_萧珩_preview.mp3",  # 一次性
            "voice_id": "<萧珩的 voice_id from dialogue_voice_map>",
            "speed": 1.0,
            "emotion": "neutral",
            "volume": 1.0,  # 对白音量参考
        },
        # ...
    ]
)
```

输出：
- `audio/shot_NN_narration.mp3` × N（旁白，**锁定，最终视频用**）
- `audio/_preview/shot_NN_dialogue_<说话人>_preview.mp3` × N × 说话人（对白预演，**仅量时长，STEP 6.5 后可删**）

> ⚠️ 旁白音频与对白视频是分离交付：不自动合成旁白，不交付带旁白或混合母版。用户可以自行在剪辑软件中调整旁白位置和音量。

### Step 5.6.2 — 测量真实时长，锁定 shot_audio_schedule

用 platform media-duration measurement 测**所有** mp3 的真实时长，填入 `shot_audio_schedule`：

| shot_id | duration | narration_window | dialogue_window | buffer | total | fits |
|---|---|---|---|---|---|---|
| 01 | 8.0s | [0.0, 3.6] | — | 0.0 | 3.6 | ✅ |
| 02 | 8.0s | [0.0, 3.4] | — | 0.0 | 3.4 | ✅ |
| 03 | 7.0s | [0.0, 2.8] | [3.3, 5.1] | 0.5 | 5.6 | ✅ |
| 04 | 8.0s | [0.0, 4.1] | — | 0.0 | 4.1 | ✅ |
| 05 | 9.0s | [0.0, 4.0] | [4.5, 6.4] | 0.5 | 6.9 | ✅ |

`shot_audio_schedule` schema（每镜）：

```yaml
shot_audio_schedule:
  shot_duration: 8.0
  narration:
    text: "那一刻，我终于看清了门口的人。"
    word_count: 14
    predicted_duration: 3.8   # 字数 × 0.25 + 0.3 缓冲
    measured_duration: 3.6    # TTS 真实时长
    window: [0.0, 3.6]        # 旁白时间窗（已锁定）
  dialogue:
    - speaker: "萧珩"
      text: "你该行礼了。"
      word_count: 6
      predicted_duration: 1.8
      measured_duration: 1.9   # TTS 预演真实时长
      window: [4.1, 6.0]      # 对白时间窗
  buffer: 0.5
  total_audio_used: 6.5
  fits_in_shot: true           # total + 0.3 尾缓冲 <= shot_duration
```

### Step 5.6.3 — schedule 决策表

| 条件 | 标记 | 默认处置 |
|---|---|---|
| 所有时长在容差内且 fits_in_shot | ✅ | 锁定 schedule，进 STEP 6 |
| 偏差在 1.5 秒或预留窗口 20% 以内 | ✅ | 直接接受，记录实际时间供用户剪辑 |
| 更大但仍可用的偏差 | ⚠️ | 保留镜头并标记偏移，不反复重新生成 |
| 窗口重叠、对白缺失或音频不可用 | 🔴 | 只返工对应镜头或分镜 |
| 对白 TTS 时长 > `shot_duration × 0.6` | ⚠️ | **★ 拉长镜头或拆对白**（不允许改对白文本） |
| `fits_in_shot: false` | 🔴 | 仅在分镜阶段延长或拆镜，不能把对白填满后再塞旁白 |

**反模式**（写死）：
- ❌ 加快语速塞进原时长——speech 加速失真
- ❌ 删旁白/对白文本——破坏剧情完整
- ❌ 强行把 10s+ 内容塞进 8s 镜头——念到一半切掉
- ❌ 把对白 TTS 预演直接用到最终视频——预演仅量时长，对白用视频原声
- ❌ STEP 5.6 后丢弃 `shot_audio_schedule`——STEP 6 prompt 必须用它

### Step 5.6 产物

- `audio/shot_NN_narration.mp3` × N（旁白锁定）
- `audio/_preview/shot_NN_dialogue_*_preview.mp3` × N × 说话人（对白预演，STEP 6.5 后可删）
- **`shot_audio_schedule`（锁定）** — STEP 6 prompt 引用，STEP 6.5 漂移基线
- 更新后的 `shot_timing_table`

在 `shot_audio_schedule` 锁定前，**不要进入 STEP 6**。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 6：生成锚点资产和镜头片段

> **视频生成默认使用 MiniMax-H3**。所有镜头必须用 image-to-video 模式，**`opening_frame_image` 必传**（first_frame 锚点策略），时长 10s 为主，6s 模式仅用于战斗/快切镜。多模态参考（角色主卡/三视图/场景主辅卡/道具卡）全用上。用户明确选择其他模型时先做能力检查；不允许退化到 text-to-video，除非用户显式批准。

**MiniMax-H3 图生视频参数（默认）**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `model` | `MiniMax-H3` | 默认使用；用户明确选择其他模型时先检查能力，兼容后遵循选择 |
| `frame_role` | `"first_frame"` | 必传 first_frame，不允许纯 text-to-video |
| `opening_frame_image` | 必传（角色主卡 / 三视图 / 场景主辅卡 / 上一镜 last_frame） | 多模态参考，根据 first_frame 决策表选 |
| `duration` | `10`（默认）/ `6`（仅战斗/快切） | 单镜时长硬上限 10s，下限 6s（除非战斗/快切） |
| `resolution` | `1080P` | 默认 1080P |
| 多模态参考 | 角色主卡 + 三视图 + 场景主辅卡 | 全部作为 `opening_frame_image` 候选 |

> **反模式**：用 text-to-video 模式生成镜头（不带 first_frame）——3D 漫剧的漂移会失控，**绝对不允许**。
> **退路**：用户显式批准时，可以用 text-to-video 模式（极少见，比如完全无参考图的特殊场景），但需要 user 显式确认 + 标 ⚠️。

**STEP 6 只有两步，其他都是浪费。**

### Step A — 锚点资产（1 批，1 轮生成）**[画布门禁硬关卡]**

> **画布门禁 [HARD GATE]**：本批所有产出的资产**生成后必须立即放到画布上**，供用户检查和修改后再进入 Step B。不允许跳过这一步。

只生视频生成真正需要当 first_frame 锚点的：

- **角色主卡**——每个主要角色 1 张干净的（脸 + 服装 + 标志性随身道具，**正面 3/4 视角**）
- **角色三视图**——每个主要角色 1 张（**正视图 / 侧视图 / 背视图 三联**），用于旋转/轨道运镜
- **场景主卡**——每个主要场景 1 张干净的（建筑 + 关键陈设 + 光线/色调，**主运镜视角**）
- **场景辅卡**——每个主要场景 1 张**辅助视角**（远景/近景/俯仰），用于支撑同场景不同运镜
- **道具卡**——**最多 1 张**

**3D 漫剧 vs 2D 的核心差异**（这部分不能省）：
- **角色三视图**是 3D 漫剧的硬约束——2D 可以靠 prompt 文字"想象"角色转身，3D 必须有真实的多角度锚图，否则 H3 旋转运镜必然脸/服装漂移
- **场景辅卡**也是 3D 漫剧的硬约束——2D 一个场景卡可以扛所有运镜（因为描边风格相对宽容），3D 场景有真实空间感，不同运镜视角下的透视、遮挡关系差异大，必须有辅卡支撑
- 这两份多角度卡只用一次（不需要出"所有角度"），正面 + 侧面 + 背面、主视角 + 辅视角 就够了

**嵌入原则**：
- 角色的标志性服装、配饰、随身道具 → **画进角色主卡**
- 场景的标志性家具、装饰、色彩调性 → **画进场景主卡**

**不要生**：
- ❌ 同一角色多张表情图（用 prompt 关键词控制）
- ❌ 同一角色多张姿态图（用 prompt 关键词控制）
- ❌ 同一场景多张光照变体（用 prompt 关键词控制）
- ❌ 服装变体图（一个角色一集一套衣服）
- ❌ 背景细节独立图（嵌进场景卡）
- ❌ **完整 360 度环视角色图**（正/侧/背三视图已足够，6+ 角度是浪费）
- ❌ **多张场景光照变体**（主+辅两张够用）

生成前用一次 `question`：
> 接下来生「<N> 张角色主卡 + <N> 张角色三视图 + <M> 张场景主卡 + <M> 张场景辅卡 [+ 1 张道具卡（如果需要）]>」，预计消耗较多积分。继续吗？
> ★ 继续生成 / 先看当前产物 / 暂停调整 / 调整清单

生成后用一次 `question`：
> 这一批设定图通过吗？（**生成物已放到画布**）
> ★ 通过 / 某张重做 / 整体调线 / 整体调色 / 三视图某角度重做

> ⚠️ **画布门禁**：Step B 镜头生成**必须等用户在画布上确认这批资产通过**之后才能开始。不允许在用户确认前硬启动 Step B。

### Step B.0 — 镜头时长锁定（基于 STEP 5.6 的 shot_audio_schedule）

**进入 Step B 之前，先确认每镜的最终时长。** 这个时长来自 STEP 5.6 锁定的 `shot_audio_schedule`（旁白实测 + 对白 TTS 预演 + 用户决策）。

镜头时长表样例：

| shot_id | 镜头最终时长 | 来源 | first_frame |
|---|---|---|---|
| 01 | 8.0s | shot_audio_schedule（旁白 3.6s + 缓冲 0.3s + 尾 4.1s） | character_main_card |
| 02 | 9.0s | shot_audio_schedule（旁白 3.4s + 尾 5.6s） | shot_01_last |
| 03 | **10.0s** | shot_audio_schedule（旁白 2.8s + 0.5 缓冲 + 对白 1.9s + 尾 4.8s） | character_three_view_side |
| 04 | 7.0s | shot_audio_schedule（旁白 4.1s + 尾 2.9s） | shot_03_last |
| ... | ... | ... | ... |

**镜头时长硬约束**（3D 漫剧 vs 2D 的差异）：
- 单镜时长 ≥ 6s（H3 10s 模式为主；6s 是物理下限）
- 单镜时长 ≤ 10s（再长人脸/材质漂移不可控）
- 战斗/快切镜可以拉到 4-6s（H3 6s 模式），但**单镜不要超过 10s**
- 缓冲（旁白说完到镜头切）≥ 0.2s，≤ 1.5s

如果某镜最终时长 > 10s，**必须回 STEP 5.6 拆对白或旁白**（不能强行拍 12s 镜头）。

### Step B — 镜头片段（1 批或几批，用 first_frame 锚点策略）

所有镜头用 **first_frame 锚点策略** 一次（或分 2-3 批）生成。

**每个镜头都必须用 image-to-video 模式**喂真实锚点图给 H3 的 `opening_frame_image`，禁止纯文字生成。

**锚点来源优先级**：
- **角色主卡**（正面 3/4 视角）— 角色首次出场 / 重置锚周期 / 镜头无明显旋转
- **角色三视图（侧面）** — 角色做侧面/平行运镜
- **角色三视图（背面）** — 角色背对镜头的镜头
- **场景主卡** — 场景首次出场 / 角色无显著走位的环境镜
- **场景辅卡** — 同场景的运镜差异较大的镜
- **上一镜的 last_frame**（`clips/shot_NN_last.png`） — 同角色/同场景接力

### 逐镜头的 first_frame 决策表

每个镜头都必须声明它的 first_frame 来源：

| shot_role | first_frame 用什么 | frame_role | 用途 |
|---|---|---|---|
| 角色首次出场（主角/配角第一镜） | **该角色的角色主卡**（正面 3/4） | `"first_frame"` | 用最权威的脸起手 |
| 角色侧面/平行运镜 | **该角色三视图（侧面）** | `"first_frame"` | 锁住侧脸/侧面姿态 |
| 角色背对镜头 | **该角色三视图（背面）** | `"first_frame"` | 锁住背影/背面姿态 |
| 同一角色后续镜头（常规） | **上一镜的 last_frame** | `"first_frame"` | 锁住上一镜的姿态/光线 |
| 重置锚（reset anchor） | **该角色的角色主卡** | `"first_frame"` | 每 4 镜（主角）/ 6 镜（配角）回到主卡重置一次防漂移 |
| 场景建立镜 | **场景主卡** | `"first_frame"` | 锁住场景的布局/色调 |
| 同场景运镜差异大的镜 | **场景辅卡** | `"first_frame"` | 保持场景在另一视角下的连续 |
| 同场景后续镜头 | **同场景上一镜的 last_frame** | `"first_frame"` | 保持场景连续 |
| 纯环境/空镜 | **场景主卡** 或 **场景辅卡** 或 **上一镜 last_frame** | `"first_frame"` | 锁住场景色温/构图 |
| 切到对方（反转镜头） | **被切到那个角色的主卡** | `"first_frame"` | 切到对方时用对方主卡重置 |
| 道具特写 | **道具卡**（仅当存在时） | `"first_frame"` | 锁住道具细节 |

### 末帧归档步骤 **[强制]**

每个镜头生成完之后，**从视频里截最后一帧**，存成 `clips/shot_NN_last.png`。这会成为下一个同角色/同场景镜头的 first_frame 来源。

```bash
# 批量截末帧
    platform last-frame extraction for each generated shot
```

### 重置锚周期（3D 漫剧 vs 2D 的关键差异）

- **主角**：连续出场每 **4 镜**回到主角主卡重置一次（2D 是 3 镜）
- **配角**：连续出场每 **6 镜**回到配角主卡重置一次（2D 是 5 镜）
- **场景**：同场景每 **5 镜**回到场景主卡重置一次（2D 是 4 镜）
- 如果某镜本身就是"切镜头 / 切场景 / 时间跳转 / 反转"，下一镜天然就是重置锚，周期自动重置

**为什么 3D 周期更长**：3D 渲染的几何一致性比 2D 描边更稳（人脸形状、材质反射、轮廓不会因为锚图稍弱就漂），所以可以撑更多镜再重置，省积分。

### STEP 6.5 — 实测对白时长微调 [v2.0.2: 从主修 → 兜底]

> **v2.0.2 关键变化**：因为 STEP 5.6 已经预排 `shot_audio_schedule` 并把 audio_schedule 嵌进 STEP 6 prompt，H3 命中计划时间窗的概率从 ~20% 升到 ~80%。**STEP 6.5 现在是兜底**，不是主修。

**H3 生成的视频里，对白时长可能跟 STEP 5.6 预排的还有偏差**。STEP 6 全部镜头生成完后，必须实测每镜的对白时长（用 VAD 或人耳听一遍标记），跟 `shot_audio_schedule.dialogue_window` 对比：

- 偏差 ≤ 1s：✅ 接受，软更新 schedule
- 偏差 1-2.5s：⚠️ 调整音频时间表或重生成该镜；禁止裁剪镜头画面
- 偏差 > 2.5s：🔴 回 STEP 5 改分镜（拆对白/拉长镜头/拆镜）

**v2.0.1 vs v2.0.2 漂移率对比**：

| 版本 | 漂移概率 | STEP 6.5 介入率 | 性能 |
|---|---|---|---|
| v2.0.1 | ~80% 漂移 | 80% 镜头需要微调 | 大量重做 |
| v2.0.2 | ~20% 漂移 | 20% 镜头需要微调 | 兜底级别 |

### 半成品路径的特殊处理

如果用户在 STEP 0 选了"半成品素材"并提供了角色卡/场景卡：
- **角色主卡** = `user_uploaded/<角色名>.png`（用户提供的）
- **角色三视图** = `user_uploaded/<角色名>_3view.png`（用户提供的；如果没提供，只用主卡，旋转运镜会有漂移）
- **场景主卡** = `user_uploaded/<场景名>.png`（用户提供的）
- **场景辅卡** = `user_uploaded/<场景名>_aux.png`（用户提供的；如果没提供，主卡扛部分辅卡运镜）
- 直接当锚点用，**整个 Step A 跳过**，直接进 Step B
- **但画布门禁 [HARD GATE] 仍然生效**：用户提供的资产也要立即放到画布上

### 每条图像/视频 prompt 都要带的风格块

**国漫 3D 渲染流（默认）**——直接贴这一段进 prompt：
> `3D rendered, Chinese-animation manhua-cel look, clean dark outlines on top of 3D shading, soft PBR materials with non-photoreal finish, dynamic manhua panel composition, dramatic cinematic light, webtoon-friendly vertical framing, no live-action, no Pixar-style CG, no 2D flat illustration, no watermark, no baked-in text`

**v2.0.2 新增 audio_schedule 块**（从 STEP 5.6 锁定的时间表，嵌进 prompt 引导 H3）：

```
audio_schedule:
  shot_duration: 8.0
  narration_window: [0.0, 3.6]      # 这个时间窗里不能有人说话
  dialogue_window: [3.6, 5.5]      # 这个时间窗里 character <X> 应该说话
  buffer_between: 0.5
  total_audio: 5.5
  shot_duration: 8.0
  constraint: "no speech during narration_window; speaker should speak during dialogue_window"
```

**完整 prompt 模板**（v2.0.2）：

```
[shot content],

3D rendered, Chinese-animation manhua-cel look, clean dark outlines on top of 3D shading,
soft PBR materials with non-photoreal finish, dynamic manhua panel composition,
dramatic cinematic light, webtoon-friendly vertical framing,
no live-action, no Pixar-style CG, no 2D flat illustration, no watermark, no baked-in text

audio_schedule:
  narration_window: [0.0, 3.6]
  dialogue_window: [3.6, 5.5]
  buffer_between: 0.5
  total_audio: 5.5
  shot_duration: 8.0
  constraint: "no speech during 0-3.6s; character <X> speaks during 3.6-5.5s"
```

> **H3 不能 100% 遵守 audio_schedule**（它会按自己的理解生成对白），但**有 schedule 比没 schedule 的对齐概率高 4 倍**（~20% → ~80%）。STEP 6.5 仍然做事后微调兜底，但发生率大幅降低。

**皮克斯 Disney 流**——换成：
> `3D rendered Pixar/Disney-style, rounded soft shapes, large expressive eyes, soft cinematic lighting, stylized non-photoreal materials, manhua panel composition with dynamic angles, no live-action, no 2D flat illustration, no watermark, no baked-in text`

**半厚涂 3D 写实流**——换成：
> `3D rendered with painterly thick-coating, semi-realistic proportions, PBR materials with brushstroke texture, dramatic cinematic light, manhua panel composition, webtoon-friendly framing, no live-action, no 2D flat illustration, no Pixar/Disney cartoon, no watermark, no baked-in text`

完整 prompt 模板和按镜头的子块写法见 `references/style-presets.md`。

### 失败修复优先级

镜头失败（人脸漂、服装漂、场景漂、道具漂、材质漂、光照漂），按这个顺序修：

1. **强化 first_frame**——换更清晰/更近期的卡或 last_frame。绝大多数漂移都来自锚点图太弱。
2. **检查 first_frame 角度是否匹配镜头**——比如镜头是侧面运镜但 first_frame 用了正面卡，3D 模型必然"想象"出别的角度。**这一条是 3D 漫剧特有的修复入口**。
3. **在 prompt 的连续性块里加显式身份关键词**（比如"same face as previous shot, no face change, exact same dark robe with gold trim"）
4. **缩短镜头时长**——长镜头比短镜头更易漂
5. **减少镜头运动**——剧烈运镜（特别是旋转）会盖住身份，模型就重新想象脸
6. **检查 3D 风格块**——如果漂到了"写实 CG"或"Pixar 卡通"或"2D 描边"，立刻强化风格块

**不要**反复重跑同一段纯文字 prompt 指望变稳。

进入镜头批量生成前，用一次 `question`：继续生成 / 先看当前产物 / 暂停调整。

默认使用平台当前可用的图生视频能力，并保留已确认的镜头时长；除非用户明确要求更换能力。

完整的锚点策略（决策树、代码示例、反模式）见 `references/shot-anchor-strategy.md`。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 7：用户自行配旁白与无旁白视频交接

### 镜头完整片段直拼规则【硬关卡】

每个生成的镜头片段都是完整剧情单元。最终视频必须从每个片段的第一帧保留到最后一帧，并按确认顺序直接拼接。不得为了处理节奏、音频或总时长而裁剪、缩短、变速、裁画或替换任何镜头内容。若时序需要修正，应回到分镜或音频时间表调整，或重新生成对应镜头；绝不能通过剪掉剧情内容修复。最后一个镜头必须完整保留，片尾卡只能接在完整镜头之后。


视觉镜头完成后，只拼接无旁白对白视频，并把 STEP 5.6 生成的旁白单独交给用户：

- 旁白音频已经在 STEP 5.6 用 the locked catalog narrator voice（STEP 0 锁定）批量生成完毕，文件在 `audio/shot_NN_narration.mp3`（仅 `narration` / `mixed` 模式）
- 全片旁白保持同一个音色
- 对白默认直接用视频生成的原声（**所有三种模式**都遵循这条；`dialogue` 模式绝对不额外生成 TTS）
- 不要把旁白按 `shot_audio_schedule` 合入视频；只交付时间表供用户自行剪辑
- 加音效和环境声
- 按确认好的方式处理字幕
- 按顺序装配镜头
- 保证对白清晰可听
- **不得因为合成方便而删掉任何原剧情点** [剧情不删减 HARD GATE]
- **如果某镜同时承载旁白和对白，它们必须保持非重叠时间窗；无法非重叠时，回到 STEP 5.6 调整时长或拆镜** [剧情不删减 HARD GATE]
- 保留结尾悬念或收束，不要在合成时把它磨平

**不要再生成旁白**（避免覆盖 STEP 5.6 的结果）。如果发现某镜旁白和镜头对不齐，回到 STEP 5.6 重新走时长对齐决策。

音频画面都要跟着节拍链走。如果本来应该留悬念，就不要在装配时把悬念减弱。

### 口型约束 [HARD GATE, v2.0.4]

> **单一说话者规则**：每个镜头的画面中，**最多只有一个角色张嘴说话**；其他可见角色必须闭嘴或做反应动作（点头、皱眉、眼神变化等）。旁白不触发任何角色的口型。

**强制约束**：
- 任何模式下，画面中**只允许一个角色做张嘴说话动作**；其他角色闭嘴
- 旁白文字绝不进入视频提示词的"口型"或"嘴部动作"字段
- 旁白触发的口型 = **错位**，必须重做
- 若某镜只有旁白无对白，画面中所有角色闭嘴；若发现角色嘴在动，标 ⚠️

### BGM 处理 [HARD GATE, v2.0.4]

> **BGM 是可选层，永远后置**：无旁白对白视频必须先完成并经用户审过；如需 BGM，BGM 作为独立音频资产交给用户，不自动与旁白合成。**无 BGM 版本是必交付的独立资产，BGM 版必须作为新独立资产输出，禁止覆盖原版**。

**强制约束**：
1. **先完成主成片（无 BGM）→ 用户审过 → 再追加 BGM**
2. BGM 与成片时长对齐方式：
   - BGM 过长 → 直接裁剪到成片时长，做自然收束
   - BGM 过短 → 按需循环，循环结果再裁剪到完整成片时长
   - **禁止强行拉伸 BGM 凑时长**
3. BGM 混音：清晰可听，但**在旁白出现时适当压低或闪避**；不能因为过度压低而听不见
4. **BGM 版是独立资产**，不能原位覆盖无 BGM 版
5. 任何配音模式下都遵循：BGM 闪避只用于环境音或 SFX 的下沉，**不能代替分离两种说话声音**（旁白和对白必须用时间窗分离，不靠闪避硬压）

### 闪避（Ducking）硬约束 [HARD GATE, v2.0.4]

> **闪避只用于环境音 / SFX 的下沉，**不能**代替分离两种说话声音**。

**强制约束**：
- ✅ 允许：环境音闪避旁白/BGM（街道噪音在旁白时压低）
- ✅ 允许：SFX 闪避旁白/BGM（特效音不让步）
- ❌ 禁止：用闪避让旁白和对白"同时说话但分清谁是谁"——必须用**时间窗分离**（旁白先，对白后，留 gap）
- ❌ 禁止：闪避导致旁白或对白听不清

**STEP 7 末尾**：把成片预览给用户，question：通过 / 调整某段旁白速度 / 替换某段对白 / 调换镜头顺序 / 调 BGM / 调音量闪避。

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## STEP 8：质检并交付

交付前检查（详见 `references/qc-checklist.md`），重点 4 大硬关卡：

### 硬关卡 1：剧情不删减
- 原剧本每个剧情点都要保留（STEP 5.5 剧本对账表全部 ✅ 或 user-approved-deleted/moved）
- 没有为了对齐时长悄悄删旁白
- 没有为了合成方便悄悄合并/删除对白

### 硬关卡 2：画布门禁
- 最终规格在画布上
- 核心资产（角色卡/三视图/场景主辅卡/道具卡）生成后立即放到画布
- 视频生成前用户已在画布上确认资产

### 硬关卡 3：用户语言跟随
- 所有 `question` 选项跟随用户当前语言
- 所有进度更新、总结、最终回复跟随用户当前语言
- 用户原文（角色名、场景名、用户写的对白）逐字不改

### 硬关卡 4：3D 漫剧风格与锚点
- `visual_style_lock == 3D-manhua-cel` 在每镜都生效
- 每镜 first_frame 角度和镜头角度匹配（侧对侧/背对背/正对正）
- 重置锚周期满足（主角 4 / 配角 6 / 场景 5）
- 每主要角色有 1 张主卡 + 1 张三视图；每主要场景有 1 张主卡 + 1 张辅卡

其它常规检查：
- 旁白 / 对白比例
- 角色、道具和场景布局的一致性
- 节奏和时长（单镜 6-10s，战斗/快切镜可 4-6s）
- 字幕可读性
- 从钩子到结尾的情绪弧线
- 每个镜头均从首帧保留到末帧，并按确认顺序直接拼接
- 是否真的按计划收束或留悬念
- 视频能力与已确认镜头时长是否保持
- 旁白音色是否在整集保持一致
- narration-first 3 层护栏全部通过

最终返回：
- 成片或装配建议
- 可复用的角色、场景、道具卡（含三视图、辅卡）
- 分镜或镜头提示词包
- 连续性警告与修复建议
- 用过的音色预设（方便下一集复用）

**最终用户消息模板**（**必须用用户当前语言**）：

> 🎬 第 X 集完成，共 N 镜，总时长 M 分钟
> - 视觉：3D 漫剧渲染（[子模式]）
> - 旁白音色：[voice_name] (voice_id)
 > - 视频生成：平台当前可用的图生视频能力
> - 锚点：主角每 4 镜/配角每 6 镜/场景每 5 镜重置一次；三视图（正/侧/背）+ 场景辅卡支撑运镜
> - 流水线：narration-first（旁白先生成，STEP 6 按真实时长拍镜头）
> - 剧情：原剧本 100% 保留（无删减/压缩/改写）
> - 旁白对白：全镜非重叠（默认）
> - 下一步建议：[一键出下一集 / 调 BGM / 出 3 平台投流剪辑 / 调整画幅出海]

[ULF] Output this STEP in `<user_language>`. Reference: `references/user-language-rules.md`.


---

## 速查

- `references/final-video-spec.md`：成片规格模板（含 `visual_style_lock` / `narrator_voice_id` / **剧情不删减** / **画布门禁** / **用户语言跟随** 字段）
- `references/storyboard-design.md`：逐镜分镜模板（narration_lines/dialogue_lines 统一 `[{text/speaker, start, end}]` 格式 + first_frame_angle_match 3D 字段）
- `references/visual-state-ledger.md`：逐镜连续性账本（同步 first_frame 锚点 + 3D 材质块）
- `references/audio-timeline.md`：逐镜音频时间轴（含 STEP 5.6 narration-first / Dialogue duration estimation / **3 层护栏**）
- `references/qc-checklist.md`：交付清单（含 3D 漫剧风格 / 音色一致性 / **首帧锚点角度** / **3D 多角度资产** / **剧情不删减** / **画布门禁** / **用户语言跟随** / **narration-first 时序** 八重硬关卡）
- `references/voice-presets.md`：Top-2 抖音解说风格旁白音色预设表 + 题材自动推荐 + **gender mismatch 反模式**
- `references/style-presets.md`：3D 漫剧风格的 prompt 块（按子模式）
- `references/shot-anchor-strategy.md`：**首帧锚点策略**（STEP 6 强制使用，含 3D 漫剧 first_frame 角度匹配规则 + STEP 5.5/5.6 引用）
- `references/interactive-checkpoints.md`：每个 step 的 `question` 标准问题模板（Top-2 音色 / 旁白对白分类 / 剧本对账 / delivery 模板）
