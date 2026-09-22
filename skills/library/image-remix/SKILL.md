---
name: image-remix
display-name-zh: 图片重混
description: |
  Invoke when a user shares a reference image and wants new images with the same "feel" — composition,
  color palette, lighting, style, or mood — but different content. Analyzes the image across 10 aesthetic
  dimensions, collapses into 3 axes (Form / Aesthetic / Mood), then generates using a model matched to
  the original's origin with adapted prompt style. Supports iterative refinement.
  Trigger on: "remix this image," "make something like this," "same vibe different content,"
  "I like this style make me…," "replicate this feel," "同风格不同内容," "照着这个感觉做,"
  "帮我做一张类似风格的图," "我喜欢这张图的感觉," "复刻这种效果," "风格迁移," "图片remix,"
  or any request where someone shares an image and wants new images inspired by its aesthetic.
  Key distinction: user wants images INSPIRED BY the reference, not a copy or edit of it.
  Do NOT trigger for: image editing, upscaling, format conversion, image-to-video generation.
summary-cn: 上传参考图，复刻它的感觉生成新图
summary-en: Generate new images with reference vibe
version: 0.7.3
tags: [Creative, Image, Style-Transfer, Remix, Design]
tags-cn: [创意, 图片, 风格迁移, 混搭, 设计]
---

# Image Remix — 图片灵感重混助手

用户发一张参考图，分析它"好在哪里"，生成保留核心感觉但内容全新的图片。

## 核心理念

- **溯源驱动生成**：先判断原图来自哪个模型/实拍/手绘，直接调用对应模型 + 匹配的 prompt 写法——MJ 用关键词堆叠，Flux 用自然语言长句。溯源、工具、写法三位一体
- **10维→3维坍缩**：内部 10 维分析，坍缩为用户可见的形/韵/意 3 维，精准定位"灵魂维度"
- **保留感觉，替换内容**：Remix = 换内容留灵魂
- **操作极轻**：发一张图 + 说一句话 → 就能出图，先出结果再迭代

## 约定

- 中间产物存储在 `./.image-remix/{session_name}/`（session_name 由图片文件名派生，小写去特殊字符）
- **禁止生成拼贴/宫格图**：每次生成调用只生成 1 张，严禁在 prompt 中写 "grid"、"collage"、"2x2" 等
- ⚠️ **MJ 四宫格说明**：MJ 固定输出 2×2 四宫格，由用户在画布中自行裁切处理
- ⚠️ **禁止传参考图进生图工具**（文生图路径）：参考图仅用于 Phase 1 分析，生成完全依赖文字 prompt，规避版权风险

---

## Pipeline

```
Phase 0: 输入  →  Phase 1: 拆图  →  Phase 2: 快选  →  Phase 3: 出图  →  Phase 4: 迭代  →  Phase 5: 输出
```

---

## Phase 0: 输入

支持：本地路径 / URL（用 `import_images` 下载）/ 搜索描述（用 `image_search`）。

多张图时：分别分析 → 提取各图灵魂维度 → 融合为组合 prompt（如"A图构图 + B图色彩"）→ 告知用户后生成。

文件结构：
```
.image-remix/{session_name}/
├── decompose.json       # Phase 1 分析结果
├── generation_log.md    # 生成记录
└── outputs/             # 生成图片 v1_01.png …
```

---

## Phase 1: 拆图 (Decompose)

### 1a. 溯源

用 `read_media` 分析原图来源，对照 `references/model-fingerprints.md` 中的视觉指纹：

```
read_media(
  file_path=参考图路径,
  question="判断这张图最可能来自哪个 AI 模型 / 实拍 / 手绘。
  参考 model-fingerprints.md 中的视觉指纹逐一比对。
  重点关注：皮肤渲染、高光反射、边缘融合质量、色彩倾向、整体AI气质。
  输出：model_guess、confidence(0-1)、clues(至少3条具体证据)、
        alt_guess、is_ai_generated、is_photo、is_illustration"
)
```

### 1b. 10 维分析

```
read_media(
  file_path=参考图路径,
  question="从以下 10 个维度深度分析这张图片，每个维度给出
  description（英文技术描述）、summary（中文概括）、score（0-1显著度）：
  1.构图 2.美术风格 3.色彩(含palette色值) 4.光影 5.氛围
  6.质感 7.主体 8.叙事 9.后期风格 10.媒介画派"
)
```

### 1c. 坍缩为形/韵/意

| 维度 | 对应底层 | 含义 |
|------|---------|------|
| **形** | 构图 + 主体 | 画的什么、怎么摆的 |
| **韵** | 美术风格 + 色彩 + 质感 + 后期 + 媒介 | 什么画风、什么调子 |
| **意** | 氛围 + 光影 + 叙事 | 什么感觉、什么情绪 |

取各子维度 score 加权平均，判断 1-2 个灵魂维度（最有辨识度的）。

### 1d. 写入 decompose.json

合并 origin + dimensions + collapsed + soul 字段写入文件。

---

## Phase 2: 快选

### 展示溯源结论（必须执行）

```
📍 溯源结论
  原图来源：[model_guess]（置信度 [confidence]）
  判断依据：[最关键 2-3 条 clues]
  灵魂维度：[soul_summary]

🎯 直接调用：[匹配工具] — [一句话说明为什么]
  Prompt 写法：[针对该模型的写法策略]
  降级方案：[工具不可用时改用什么]
```

**溯源 → 工具 + Prompt 写法对照表**（溯源直接决定调用哪个工具和写法，两者不可分离）：

| 溯源来源 | 调用工具 | Prompt 写法 | 降级 |
|---------|---------|-----------|------|
| Seedream | Seedream 生图工具 | 写实长描述，精确五官/服装材质，光线氛围细化 | `all_in_one`，保持写法 |
| Kolors | Kolors 生图工具 | 写实描述，强调高光材质对比 | `all_in_one` |
| Hunyuan | Hunyuan 生图工具 | 写实 + 中式意境词，简洁留白 | `all_in_one` |
| Jimeng / 即梦 | 即梦生图工具 | 直接描述，风格词明确，饱和度显式写出 | `all_in_one` |
| Wanx / 通义万象 | Wanx 生图工具 | 简洁描述，避免过密细节堆叠 | `all_in_one` |
| Midjourney v5/v6 | MJ 生图工具 | 关键词堆叠 + 风格标签，简洁不啰嗦 | `all_in_one`，保持 keyword 写法 |
| Flux.1 | Flux 生图工具 | 自然语言长句，光线材质细描 | `all_in_one`，保持长描述 |
| Stable Diffusion | SD 生图工具 | 支持权重语法 `(词:1.3)`，负面 prompt 单独写 | `all_in_one`，去权重改自然语言 |
| DALL-E 3 | DALL-E 生图工具 | 自然语言，直白描述，避免过度风格化 | `all_in_one` |
| Ideogram | Ideogram 生图工具 | 明确文字内容和排版要求 | `all_in_one` |
| 实拍照片 | 高写实生图工具 | 摄影术语主导，镜头参数 + 胶片型号 | `all_in_one`，保持摄影术语 |
| 手绘 / 插画 | 插画生图工具 | 媒介 + 流派为锚 | `all_in_one`，保持媒介描述 |
| 通用 AI / 难判断 | `all_in_one_image_generation` | 关键词 + 自然语言混合 | 无需降级 |
| 完全不确定 | 多工具各出一张对比 | 每个工具用各自最优写法 | — |

**工具不可用时的降级规则**：降级到 `all_in_one_image_generation`，但**保持原工具的 prompt 写法风格不变**，最大限度保留风格基因。

### 生成路径选择（必须询问）

通过问答询问用户：

- **文生图（推荐）**：纯文字 prompt，零版权风险
- **图生图**：参考图作为 image_ref 传入，还原度更高，需用户确认版权风险

### 内容方向确认

直接问用户"你想画什么"，一句话即可进入出图。

若用户没有方向（只说"帮我 remix"），基于灵魂维度推荐 3 个替换方向供选择。

**快捷指令**：`换皮`（只换主体）/ `取风格`（保韵）/ `取构图`（保形）/ `取氛围`（保意）

---

## Phase 3: 出图

### 分支 A：文生图（Text-to-Image）

严禁将参考图传入生成工具。Prompt 完全基于 Phase 1 分析重建风格。

**Prompt 构建**：
```
[新内容主体]. [保留维度的英文 description]. single subject, one image only, no grid, no collage, no text, no watermark
```

**维度→Prompt 重点**：

| 保留维度 | Prompt 侧重 |
|---------|------------|
| 形 | 镜头角度、景别、主体位置、纵深层次 |
| 韵 | 艺术流派、色值/色彩关系、媒介描述、调色引用 |
| 意 | 情绪形容词、光源描述、文化/时代引用、隐喻语言 |

### 分支 B：图生图（Image-to-Image）

参考图作为 `image_ref` 传入，Prompt 侧重描述新内容方向，风格描述辅助引导。

### 生成参数

询问用户尺寸：**跟随原图**（默认，用 ffprobe 测量后映射）/ 1:1 / 16:9 / 9:16

「跟随原图」映射规则：ratio > 1.5 → 16:9；0.8~1.2 → 1:1；< 0.8 → 9:16。**必须先测量再写入 task_description，禁止猜测。**

默认生成 **4 张**变体，每张单独调用一次，prompt 做轻微变体保持差异。

输出保存到 `.image-remix/{session_name}/outputs/v{版本}_{序号}.png`，同步更新 `generation_log.md`。

---

## Phase 4: 迭代

展示结果后询问满意度：**满意结束** / **微调** / **换方向** / **换模型**。

微调直接在 prompt 层面调整，不回到 Phase 1 重新分析：

| 反馈 | 动作 |
|------|------|
| "色彩再冷一点" | 微调色彩 prompt 词 |
| "构图换成特写" | 调整镜头参数 |
| "风格差太多" | 增强风格描述或换模型 |
| "这张构图 + 那张色彩" | 组合两张维度重新生成 |

---

## Phase 5: 输出

交付清单：文件位置 / 生成总数 / 迭代轮数 / 灵魂维度 / 溯源来源 / Prompt 写法策略

可选：CDN 上传 / 风格入库（存入 `.image-remix/style-library/{风格名}.md`）/ 继续变体

**风格库格式**（`references/analysis-example.md` 有示例）：
```markdown
# {风格名}
## 溯源
- 原图来源 / 调用工具 / Prompt 写法策略
## 灵魂维度
- 灵魂：{形/韵/意} — {soul_summary}
## 成功 Prompt
{完整英文 prompt}
## 维度快照
- 形 / 韵 / 意
```
