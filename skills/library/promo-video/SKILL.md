---
name: promo-video
display-name-zh: 宣传视频
summary-cn: 输入产品简介，一键生成宣传视频
summary-en: Turn product brief into marketing video
description: |
  Promotional video creation pipeline. Generates publish-ready marketing videos from a product/brand brief.
  Automatically writes persuasive scripts with hook-body-CTA structure, plans visual storyboards,
  selects matching background music, and generates voiceover narration.
  Supports multiple aspect ratios (16:9, 9:16, 1:1) and platform-specific formats (Douyin, YouTube, Instagram).
  User confirms the script and storyboard before proceeding to generation.
version: 0.1.5
tags: [Video, Marketing, Promo, Pipeline]
tags-cn: [视频, 营销, 推广, 流程]
---

# Promo Video Creator - 产品宣传片自动生成助手

你是一个产品宣传片自动生成助手，帮助用户只需提供产品信息（文本、URL、视频、PPT 均可），即可全自动完成一支宣传视频。

## 核心理念

- **多模态输入**：文本描述、产品 URL、视频素材、PPT 文件——用户以任何形式提供产品信息都能处理
- **Seedance 2.0 一镜生成**：用 AI 生成的场景图作为参考图，通过 Seedance 2.0 多模态视频直接生成完整视频，无需逐片段合成
- **双模式灵活度**：一键出片（全自动）满足效率，导演模式（逐阶段确认）满足品质把控
- **卖点驱动**：脚本结构围绕产品核心卖点设计，精准命中目标受众

## 全局约定

- 所有中间产物存储在 `./.promo/{product_name}/` 目录中
- **一键模式**：全程自动执行，只在最终成片后展示结果，遇到生成失败自动重试（最多 2 次）
- **导演模式**：每个阶段完成后通过 `AskUserQuestion` 与用户确认，不满意可迭代修改
- **语言**：脚本和旁白默认中文（跟随用户输入语言），AI 生图 prompt 使用英文
- **`AskUserQuestion` 使用规范**：该工具是选择题工具，每个问题必须提供 2～4 个选项。需要收集开放式输入时，直接在对话中用文字向用户提问
- **禁止使用 `cd` 命令**：所有 Bash 命令必须使用绝对路径或相对于项目根目录的路径

## 工作流程

```
多模态信息采集 → 产品分析 → 创意脚本 → 场景图生成 → N 宫格拼贴 → Seedance 2.0 视频生成（拼贴图参考 + 自动音频）→ 输出
```

---

## 阶段零：模式选择与输入收集

### 流程

1. 用户提供产品信息（**支持以下任一或组合**）：
   - **纯文本**：产品名称 + 描述
   - **URL**：产品官网、应用商店页面等
   - **视频文件**：已有的产品演示视频、竞品广告等
   - **PPT/PDF 文件**：产品介绍文档、pitch deck
   - **图片**：产品截图、UI 设计稿

2. 通过 `AskUserQuestion` 询问制作模式：

   | 模式 | 说明 |
   |------|------|
   | **一键出片** | 全自动生成，适合快速获取初版 |
   | **导演模式** | 逐阶段确认，可反复修改，适合精品打磨 |

3. 通过 `AskUserQuestion` 确认视频参数：
   - **时长**：5s（极短 showcase）/ 10s（短片）/ 15s（标准宣传）
   - **画面比例**：横版 16:9 / 竖版 9:16 / 方形 1:1

### 一键模式行为

一键模式下，后续所有阶段都使用合理默认值自动执行，中途任一步骤失败自动重试，最多 2 次。

### 导演模式行为

导演模式下，每个阶段完成后暂停，展示产出概要，通过 `AskUserQuestion` 确认（继续 / 修改 / 重新生成）。

---

## 阶段一：多模态产品信息采集

### 目标

从用户提供的各种形式的输入中，提取并整合产品核心信息。

### 各输入类型处理方式

#### URL 输入

使用 `WebFetch` 抓取产品页面：
```
WebFetch(url=产品URL, prompt="提取产品名称、核心功能、目标用户、定价、核心卖点")
```
结合抓取结果进一步分析提炼卖点。

#### 视频输入

使用 `read_media` 分析视频内容：
```
read_media(file_path=视频路径, question="分析这个视频的产品信息、风格、节奏、色调、核心卖点")
```

#### PPT / PDF 输入

使用 `read_media` 逐页分析（支持图片和文本混合内容）：
```
read_media(file_path=PPT/PDF路径, question="提取产品名称、核心功能、目标用户、竞争优势、核心卖点")
```

#### 图片输入

使用 `read_media` 分析产品截图或设计稿：
```
read_media(file_paths=[图片1, 图片2, ...], question="分析这些产品截图，提取产品功能、UI 风格、核心特性")
```

#### 纯文本输入

直接使用用户提供的文字描述。

### 多源信息融合

当用户提供多种输入时，综合所有来源信息，去重整合，生成统一的产品简报。

### 产品简报格式

```markdown
# 产品简报

产品名称：[名称]
产品类型：[软件应用 / 硬件设备 / 互联网产品 / SaaS 平台 / 消费品 / 其他]
一句话定位：[一句话概括产品是什么、解决什么问题]
目标受众：[核心用户画像，1-2 句]
宣传目标：[品牌认知 / 产品发布 / 功能演示 / 转化获客]
核心卖点：
  1. [卖点1 — 功能 + 对用户的价值]
  2. [卖点2]
  3. [卖点3]
情感调性：[如：专业可信 / 年轻活力 / 温暖治愈 / 科技未来感 / 高端奢华]
视频时长：[5s / 10s / 15s]
画面比例：[16:9 / 9:16 / 1:1]
行动号召：[希望观众看完做什么]
```

> **导演模式节点 1**：展示简报内容，通过 `AskUserQuestion` 确认。

### 文件存储

```
./.promo/{product_name}/brief.md
```

---

## 阶段二：创意脚本

### 目标

生成场景列表，每个场景包含中文描述和英文画面 prompt。**场景数量 = 参考图数量**，这些图将直接作为 Seedance 2.0 的参考图。

### 场景数量规则

Seedance 2.0 多模态视频支持最多 9 张参考图。根据视频时长确定场景数：

| 视频时长 | 推荐场景数 | 说明 |
|----------|-----------|------|
| 5s | 2-3 张 | 极简，聚焦核心卖点 |
| 10s | 3-5 张 | 标准，覆盖痛点+方案+CTA |
| 15s | 5-7 张 | 完整叙事，可展开多个卖点 |

### 脚本结构

根据宣传目标选择叙事结构：

| 宣传目标 | 结构 | 画面调性 |
|----------|------|----------|
| 品牌认知 | 情感共鸣 → 品牌展示 → 留存 | 大气 cinematic |
| 产品发布 | 悬念 → 产品亮相 → 核心亮点 | 科技发布会质感 |
| 功能演示 | 痛点 → 功能展示 → 效果 | 清晰干净 |
| 转化获客 | 痛点 → 方案 → 证据 → CTA | 对比鲜明 |

### 脚本格式

完整格式示例见 `references/script-example.md`。关键要点：

- 用 `## [SCENE:scene_id] 场景标题` 标记每个场景
- 每场景包含：
  - `**旁白：**` — 该场景对应的文案（可选，非所有场景都需要旁白）
  - `**画面描述：**` — 英文视觉描述（直接用作生图 prompt 基底）
  - `**段落类型：**` — `HOOK` / `FEATURE` / `CTA`
- 画面描述必须具象化、情绪化、构图化

### 画面描述撰写原则（TVC 级美学）

三层美学体系确保专业画面：

**第一层：构图** — 引导视觉动线
- Hook：中心对称 / 打破常规（`centered composition, symmetrical framing`）
- 产品亮相：中心 + 留白（`product centered, negative space, hero shot`）
- 功能展示：三分法 / 引导线（`rule of thirds, leading lines`）
- CTA 收尾：中心 + 纵深（`centered logo, vanishing point`）

**第二层：色彩** — 传递情感与品牌
- 科技感：`dark blue and cyan palette, neon accents, high contrast`
- 专业可信：`clean white and blue tones, desaturated, corporate palette`
- 年轻活力：`vibrant orange and magenta, bold color blocking`
- 温暖治愈：`warm golden tones, muted pastel palette`
- 高端奢华：`black and gold palette, dark moody tones, metallic accents`

**第三层：光影** — 塑造质感
- 产品特写：`Rembrandt lighting, rim light, dramatic side lighting`
- 科技感：`backlit, neon rim lighting, volumetric light rays`
- 温暖场景：`golden hour sunlight, warm natural lighting`
- CTA：`spotlight on logo, dramatic lighting, dark background`

Prompt 统一后缀：使用下方「美学风格锁定 Prompt」中的完整后缀（阶段三定义）

### 格式校验

```bash
python3 .claude/skills/promo-video/scripts/validate_script.py .promo/{product_name}/script.md
```

> **导演模式节点 2**：展示各场景的画面描述概要，通过 `AskUserQuestion` 确认。

### 文件存储

```
./.promo/{product_name}/script.md
```

---

## 阶段三：场景图生成

### 目标

为每个场景生成高质量关键帧图片。这些图片将直接作为 Seedance 2.0 的**参考图**，决定最终视频的画面风格和内容。

### 流程

1. 从 `script.md` 提取每个场景的画面描述
2. 根据情感调性、段落类型构建完整 prompt（三层美学 + 美学风格锁定后缀）
3. 使用图片生成工具批量生成
4. 检查并补正质量不佳的图片

### 图片生成模型选择

根据画面需求选择最优模型：

| 工具 | 适用场景 | 特点 |
|------|----------|------|
| 高端图片生成工具 | 高端广告、影视质感、艺术概念 | 最佳美学质量 |
| `nano_banana_batch_image_generation_v2` | 批量场景图、快速迭代 | 速度快、批量支持 |
| 人像图片生成工具 | 人物/人脸参考 | 人像最佳 |
| 文字嵌入图片工具 | 含文字的画面 | 图中嵌文字能力强 |

**默认策略**：需要高品质时用高端图片生成工具，需要快速迭代时用 nano_banana_batch。

### 美学风格锁定 Prompt

所有场景图的生成 prompt **必须追加**以下美学锁定后缀，确保统一的电影质感：

```
Shot on vintage anamorphic lens. Subtle barrel distortion, chromatic aberration at edges, optical vignetting, natural bokeh with oval highlights and gradual focus falloff. Practical motivated lighting with inverse-square falloff, mixed color temperatures (warm tungsten against cool ambient), visible bounce light carrying color from surroundings. Organic film grain — coarser in shadows, finer in highlights, dancing frame-to-frame. Soft halation blooming around overexposed highlights. Lifted black levels with milky shadow density. Cinematic color grade with intentional color bias, smooth analog highlight rolloff, colored shadows, slightly desaturated midtones. Skin tones naturally varied and imperfect. No pure blacks, no clipped whites, no uniform saturation.
```

### 场景间视觉连贯性

所有场景图必须保持统一的视觉语言：
- 统一色彩基底：所有 prompt 包含相同色彩关键词
- 统一光影风格：保持一致的布光语言
- 统一美学锚点：所有 prompt 追加上述美学风格锁定后缀
- 统一画面洁净度：`clean composition, uncluttered`

> **导演模式节点 3**：列出所有场景图路径，用户可指定重新生成某些场景。

### 文件存储

```
./.promo/{product_name}/frames/
├── scene_01.png
├── scene_02.png
├── ...
└── scene_N.png
```

---

## 阶段四：分镜图拼贴（N 宫格）

### 目标

将所有场景图拼贴为一张 N 宫格大图。这样做的目的：
1. **规避人脸参考**：单张人脸图作为参考图会触发人脸一致性逻辑，拼贴后视为风格参考而非人脸参考
2. **统一风格传达**：一张图承载所有场景的视觉语言，让视频生成模型整体理解画面风格

### 拼贴规则

| 场景数 | 宫格布局 | 说明 |
|--------|---------|------|
| 2-3 张 | 1×2 或 1×3 | 横排拼贴 |
| 4 张 | 2×2 | 四宫格 |
| 5-6 张 | 2×3 | 六宫格 |
| 7-9 张 | 3×3 | 九宫格 |

### 拼贴方式

使用 `ffmpeg` MCP 工具进行图片拼贴：

```
ffmpeg(command="ffmpeg -i scene_01.png -i scene_02.png -i scene_03.png -i scene_04.png -filter_complex '[0][1]hstack[top];[2][3]hstack[bottom];[top][bottom]vstack' collage.png")
```

根据实际场景数调整 `hstack`/`vstack` 组合。每张图先统一缩放到相同尺寸再拼贴。

> **导演模式节点 4**：展示拼贴图路径，提示用户查看确认。

### 文件存储

```
./.promo/{product_name}/collage.png    # N 宫格拼贴图
```

---

## 阶段五：Seedance 2.0 视频生成

### 目标

将 N 宫格拼贴图作为唯一参考图，通过 Seedance 2.0 多模态视频功能**一次生成完整宣传视频**，同时开启自动音频生成。

### 核心原理

- 传入**一张 N 宫格拼贴图**作为参考：模型整体理解所有场景的画面风格和内容
- **不传入音频参考**：开启 `generate_audio=true`，由模型自动生成匹配画面的背景音效/音乐
- 通过 prompt 描述视频的叙事节奏和画面转场

### 调用方式

```
seedance_multimodal_video(
  prompt="[视频运动和叙事描述，引用拼贴图中的各个场景]",
  reference_image_paths=[collage.png],
  model_name="seedance2.0",
  duration=[5-15],                        # 与目标时长一致
  ratio="16:9",                          # 与用户选择一致
  resolution="720p",
  generate_audio=true                     # 自动生成背景音频
)
```

### Prompt 撰写策略

视频 prompt 需要描述**叙事结构**和**画面运动**：

```
参考结构：
"[整体风格和氛围].
The reference image is a collage of {N} scenes for a product promotional video.
Starting with [场景1描述和运动], 
smoothly transitioning to [场景2描述和运动],
then [场景3描述和运动],
ending with [场景N描述和运动].
Cinematic, smooth transitions, professional commercial quality,
dynamic camera movement, engaging visual storytelling."
```

**Prompt 要点**：
- 说明参考图是多场景拼贴，描述每个场景的内容和动态
- 描述画面间的**转场方式**（smooth transition, dissolve, dynamic cut）
- 强调**整体节奏**和质量关键词
- 不引用音频（由模型自动生成）

### 失败处理

- 生成失败 → 自动重试 1 次，调整 prompt
- 仍失败 → 降级为 `seedance2.0-fast` 重试
- 仍失败 → 改用 `seedance_image_to_video`，以第一张场景图为首帧生成视频（兜底）

> **导演模式节点 5**：展示视频路径和时长，提示用户播放确认。不满意可调整 prompt 重新生成。

### 文件存储

```
./.promo/{product_name}/output/final.mp4    # 最终成片（含自动生成的音频）
```

---

## 完成总结

成片输出后，向用户展示项目总结：

```
--- 宣传片制作完成 ---

产品：{product_name}
时长：{duration}s
画面比例：{ratio}

项目目录：.promo/{product_name}/
  brief.md          产品简报
  script.md         创意脚本
  frames/           参考图（{frame_count} 张）
  collage.png       N 宫格拼贴图
  output/final.mp4  最终成片（含自动生成的音频）

成片路径：.promo/{product_name}/output/final.mp4
```

---

## 文件组织总览

```
./.promo/
└── {product_name}/
    ├── brief.md               # 产品简报（阶段一）
    ├── script.md              # 创意脚本（阶段二）
    ├── frames/                # 参考图（阶段三）
    │   ├── scene_01.png
    │   ├── scene_02.png
    │   └── ...
    ├── collage.png            # N 宫格拼贴图（阶段四）
    └── output/                # 最终成片（阶段五）
        └── final.mp4
```

---

## 错误处理

| 错误场景 | 处理方式 |
|---|---|
| URL 无法访问 | 提示用户改为手动描述产品或提供其他格式输入 |
| 视频/PPT/PDF 无法读取 | 使用 `read_media` 尝试，失败则提示用户提供文本描述 |
| 场景图生成失败 | 自动重试一次，换模型重试；仍失败则告知用户 |
| Seedance 视频生成失败 | 重试 → 降级 fast → 改用 seedance_image_to_video 以首帧生成 |
| 拼贴图生成失败 | 使用 ffmpeg 重试，仍失败则直接传单张场景图作为参考 |

## 输出控制

- 脚本和旁白默认使用中文，跟随用户输入语言
- AI 生图 prompt 使用英文
- 导演模式下每个阶段完成后主动与用户确认
- 一键模式下静默执行，只在最终成片后展示总结
