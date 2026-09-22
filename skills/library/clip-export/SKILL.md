---
name: clip-export
display-name-zh: 剪映导出
summary-cn: 视频工程一键推送到剪映或CapCut草稿
summary-en: Push videos to JianYing or CapCut
description: |
  视频工程推送工具。通过 Python 脚本程序化创建剪辑项目，一键推送到剪映或 CapCut。
  直连模式直接在本机剪映/CapCut 草稿目录生成工程文件，打开软件即可编辑。
  基于 pyJianYingDraft (PyPI) 封装。
  触发词包括：剪映、CapCut、推送、推送到剪映、capcut、导出到剪映。
version: 3.0.4
tags: [Video, Export, JianYing, CapCut]
tags-cn: [视频, 导出, 剪映, CapCut]
---

# Clip Export - 视频工程推送工具

你是视频编辑 AI 助手。通过 Python 脚本程序化创建视频项目草稿，支持一键推送到剪映或 CapCut：

- **直连模式** (`direct=True`)：直接在剪映/CapCut 草稿目录创建工程文件，打开软件即可预览编辑

## 支持的目标

| 目标 | 说明 |
|------|------|
| 中文版剪映 | `app_source: "lv"`, `app_id: 3704` |
| 国际版 CapCut | `app_source: "cc"`, `app_id: 359289` |

## 前置依赖

- Python 3.8+
- `pip3 install pyJianYingDraft`（已安装 v0.2.6）
- **需要本机安装剪映或 CapCut**

## 输出模式

### 直连模式（推荐用于剪映/CapCut）

**CRITICAL — 区分中文版剪映和 CapCut 国际版：**

| 用户说 | 软件版本 | 草稿目录 |
|---|---|---|
| **"推送到剪映"** | 中文版剪映 | `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/` |
| **"CapCut" / "capcut"** | 国际版 CapCut | `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/` |

规则：
- 用户说 **"推送到剪映"** → 使用中文版剪映路径（`JianyingPro`）
- 用户说 **"CapCut" / "capcut"** → 使用国际版路径（`CapCut`）
- **如果没特别说明 → 必须询问用户**：想推送到中文版剪映还是国际版 CapCut？

当用户要在本机剪映/CapCut 中打开时，使用 `direct=True`。草稿直接创建到剪映草稿目录，无需手动导入。

```python
project = JyProject("我的视频", direct=True, overwrite=True)
# ... 添加素材 ...
project.save()  # 直接出现在 CapCut 草稿列表中
```

- 自动探测剪映/CapCut 草稿目录（macOS / Windows）
- 自动适配剪映或 CapCut 的格式和 platform 字段

## 核心 API

所有操作通过 `JyProject` 类完成。脚本路径：`.claude/skills/clip-export/scripts/jy_wrapper.py`

### 创建项目

```python
import sys, os
sys.path.insert(0, os.path.join(os.getcwd(), ".claude/skills/clip-export/scripts"))
from jy_wrapper import JyProject

# 直连模式：草稿直接出现在 CapCut 中（推荐）
project = JyProject("我的视频", direct=True, overwrite=True)

# 竖屏 1080x1920 + 直连
project = JyProject("竖屏视频", width=1080, height=1920, direct=True, overwrite=True)

# 打包模式：输出 zip（用于分发或其他软件）
project = JyProject("分发视频", overwrite=True)
```

### 添加视频

```python
# 基本导入
project.add_video("/absolute/path/video.mp4", start_time=0, duration="5s")

# 指定源起始位置（截取视频的第 10 秒开始的 5 秒）
project.add_video("/path/video.mp4", start_time="5s", duration="5s", source_start="10s")

# PiP 画中画（独立轨道 + 缩放）
from jy_wrapper import ClipSettings
pip_seg = project.add_video(
    "/path/video.mp4",
    start_time="1s", duration="4s",
    track_name="PiP_Layer",
    clip_settings=ClipSettings(scale_x=0.3, scale_y=0.3),
)
```

### 添加音频

```python
# BGM
project.add_audio("/path/bgm.mp3", start_time=0, volume=0.6, track_name="BGM")

# 配音
project.add_audio("/path/voice.wav", start_time="2s", duration="10s", track_name="Narration")
```

### 添加文字

```python
# 标题文字
project.add_text(
    "大标题",
    start_time="1s", duration="3s",
    font_size=15.0,
    color_rgb=(1.0, 0.8, 0.0),  # 金色
    transform_y=0.4,             # 偏上
    bold=True,
)

# 字幕（预设底部位置 transform_y=-0.8）
project.add_subtitle("这是字幕", start_time="0s", duration="3s")

# 导入 SRT 字幕文件
project.import_srt("/path/to/subtitles.srt", track_name="字幕轨")
```

### 滤镜

```python
# 按名称添加（支持中英文 + 模糊匹配）
project.add_filter("VHS_III", start_time=0, duration="10s")
project.add_filter("复古电影感", start_time=0, duration="10s", intensity=80.0)
```

### 场景特效

```python
project.add_effect("CCD闪光", start_time="2s", duration="3s")
project.add_effect("抖动", start_time="5s", duration="2s")
```

### 关键帧动画

```python
from jy_wrapper import KeyframeProperty

# 先获取视频片段引用
seg = project.add_video("/path/video.mp4", start_time=0, duration="4s")

# 缩放动画：1.0 → 1.5
JyProject.add_keyframe(seg, "uniform_scale", "0s", 1.0)
JyProject.add_keyframe(seg, "uniform_scale", "4s", 1.5)

# 位移动画：从左到右
JyProject.add_keyframe(seg, "position_x", "0s", -0.5)
JyProject.add_keyframe(seg, "position_x", "4s", 0.5)

# 旋转
JyProject.add_keyframe(seg, "rotation", "0s", 0.0)
JyProject.add_keyframe(seg, "rotation", "4s", 360.0)

# 透明度渐变
JyProject.add_keyframe(seg, "alpha", "0s", 0.0)
JyProject.add_keyframe(seg, "alpha", "1s", 1.0)
```

可用属性：`position_x`, `position_y`, `rotation`, `scale_x`, `scale_y`, `uniform_scale`, `alpha`, `saturation`, `contrast`, `brightness`, `volume`

### 保存 & 导出

```python
# 直连模式 (direct=True 创建的项目)
project.save()  # 自动创建到剪映/CapCut 草稿目录，打开软件即可看到
```

直连模式输出到草稿目录，刷新软件即可打开。

## 时间格式

所有时间参数支持多种格式：

| 格式 | 示例 | 说明 |
|------|------|------|
| 秒（float） | `2.5` | 2.5 秒 |
| 微秒（int） | `2500000` | 2.5 秒 |
| 带单位字符串 | `"3s"`, `"500ms"`, `"1m30s"` | 自动解析 |
| 冒号格式 | `"01:30"`, `"00:01:30"` | 分:秒 或 时:分:秒 |

## CLI 工具

### 资产搜索

```bash
# 搜索所有类别
python3 .claude/skills/clip-export/scripts/asset_search.py "复古"

# 限定分类搜索
python3 .claude/skills/clip-export/scripts/asset_search.py "淡化" -c transitions

# 列出资产概览
python3 .claude/skills/clip-export/scripts/asset_search.py --list
```

## 资产库

| 类别 | 数量 | 数据文件 |
|------|------|----------|
| 滤镜 (Filters) | 1052 | `data/filters.csv` |
| 转场 (Transitions) | 453 | `data/transitions.csv` |
| 场景特效 (Effects) | 1097 | `data/effects.csv` |
| 文字入场动画 (TextIntro) | 155 | `data/text_animations.csv` |
| 文字出场动画 (TextOutro) | 124 | `data/text_animations.csv` |
| 关键帧属性 | 11 | `data/keyframe_properties.csv` |

## 重要规则

1. **文件路径必须使用绝对路径**
2. **脚本结尾必须调用 `project.save()`**
3. **分辨率要匹配**：横屏 1920x1080（默认），竖屏需要显式指定 `width=1080, height=1920`
4. **不要猜测资产名称**：先用 `asset_search.py` 搜索确认
5. **关键帧时间是相对于片段起始的偏移量**，不是时间线绝对时间
6. **直连模式始终加 `overwrite=True`**：CapCut 打开草稿后会加密 JSON，重新生成必须覆盖
7. **用户要在剪映/CapCut 中打开 → 用直连模式**（`direct=True`），其他软件 → 打包模式。区分版本：说"推送到剪映"→ 中文版；说"CapCut"→ 国际版

## CapCut 测试验证记录

以下用例已在 CapCut 8.4（macOS）上实测通过：

| 测试 | 内容 | 结果 |
|------|------|------|
| 极简文字 | `add_text()` 仅文字，无媒体 | ✅ 正常打开 |
| 单视频 | `add_video()` 一个 15s mp4 | ✅ 正常显示，无媒体丢失 |
| 复杂混剪 | 7 段视频/图片 + BGM + 标题 + 字幕，33s | ✅ 正常打开，素材完整 |

**关键修复**（相比早期版本）：
- `_copy_media_into_draft()` 将所有外部素材复制到 `Resources/` 目录内，解决 CapCut 沙盒导致的"媒体丢失"
- `_patch_for_capcut78()` 自动探测 CapCut 路径并注入正确的 `platform.app_source="cc"` + `app_id=359289`
- `_create_capcut_scaffold()` 创建 CapCut 所需的全部辅助文件（draft_agency_config / draft_biz_config / timeline_layout 等）

## 踩坑经验

### 1. duration 不能超过素材实际时长

`add_video()` 的 `source_start + duration` 不能超过源文件时长，否则抛出 `ValueError: 截取的素材时间范围超出了素材时长`。

```python
# ✗ 错误：001.mp4 只有 1.5s，但 duration 设了 3s
p.add_video("001.mp4", duration="3s")

# ✓ 正确：先确认时长，不要超出
p.add_video("001.mp4", duration="1.5s")
```

**最佳实践**：先用 ffprobe 确认素材时长，duration 留出微小余量（如 `int(dur * 1_000_000)` 微秒精度），或省略 duration 让 wrapper 自动检测。

### 2. ffprobe 时长精度陷阱

ffprobe 返回的时长（如 `35.875011s`）和 pyJianYingDraft 内部计算的素材时长（`35875000μs`）可能有微秒级差异。当 `source_start + duration` 刚好等于 ffprobe 时长时，可能因四舍五入导致溢出。

```python
# ✗ 危险：ffprobe=35.875011s → 35875011μs，但素材时长=35875000μs
p.add_audio("long.mp4", duration=35.875011)  # 超出 11μs → 报错

# ✓ 安全：显式指定稍短的时长
p.add_audio("long.mp4", duration="35.8s")
```

### 3. 图片可以当视频用

PNG/JPG 文件可以通过 `add_video()` 添加，duration 随意设（不受源文件时长限制）。非常适合做产品特写、静帧过渡。

```python
p.add_video("product.png", start_time="5s", duration="4s")
```

### 4. 视频文件当音频源

用视频文件做 BGM/音效时，wrapper 自动调用 ffmpeg 提取音频到 `.m4a`。直连模式下提取到草稿的 `audio/` 子目录，CapCut 能直接识别。

```python
# 自动提取音频轨，无需手动 ffmpeg
p.add_audio("video_with_music.mp4", volume=0.4, track_name="BGM")
```

### 5. CapCut 7.8 草稿加密

CapCut 打开草稿后会**加密** `draft_info.json`，导致：
- 无法再手动编辑草稿 JSON
- 重新生成同名草稿时必须 `overwrite=True` 覆盖

**迭代调试时**：每次修改后用新草稿名或 `overwrite=True`，避免在加密的 JSON 上操作。

### 6. 同一素材复用

同一个文件在时间线上出现多次时，只需多次调用 `add_video()` 用不同的 `source_start`，wrapper 自动复用 material：

```python
# 同一个 example.mp4，取不同片段
p.add_video("example.mp4", start_time="0s", duration="6s", source_start="0s")
p.add_video("example.mp4", start_time="11.5s", duration="7s", source_start="20s")
```

### 7. 混剪工程最佳模式

产品混剪 / 投放素材剪辑的推荐模板：

```python
p = JyProject("项目名", width=1080, height=1920, direct=True, overwrite=True)

# 1. 先铺视频轨（按时间线顺序）
p.add_video(...)  # 开场
p.add_video(...)  # 产品特写
p.add_video(...)  # 高光片段
p.add_video(...)  # 尾版

# 2. 加滤镜（全程覆盖）
p.add_filter("VHS_III", start_time=0, duration="总时长")

# 3. 加特效（转场处点缀）
p.add_effect("CCD闪光", start_time="转场时间点", duration="1.5s")

# 4. 加标题 + 字幕
p.add_text("标题", ...)
p.add_subtitle("字幕1", ...)

# 5. 加 BGM
p.add_audio("bgm.mp3", volume=0.4, track_name="BGM")

# 6. 保存
p.save()
```

## 典型工作流

1. 用户提供素材文件路径（视频/音频/图片）
2. 确认分辨率（横屏/竖屏）
3. **确认目标软件**：
   - 用户说 **"推送到剪映"** → 直连模式 + 中文版剪映路径（`JianyingPro`）
   - 用户说 **"CapCut" / "capcut"** → 直连模式 + 国际版路径（`CapCut`）
   - **未指定 → 必须询问用户**：想推送到中文版剪映还是国际版 CapCut？
4. 编写 Python 脚本创建草稿
5. 运行脚本
6. 用户在对应软件中查看
7. 根据反馈迭代修改

## 导入说明

### 剪映 / CapCut（直连模式）
直连模式自动探测路径。根据用户说的软件名称决定目标：
- **"推送到剪映"** → 中文版剪映路径（`JianyingPro`）
- **"CapCut"** → 国际版路径（`CapCut`）
- **未指定 → 必须询问用户**：想推送到中文版剪映还是国际版 CapCut？

**macOS 草稿目录：**
- 剪映: `~/Movies/JianyingPro/User Data/Projects/com.lveditor.draft/`
- CapCut: `~/Movies/CapCut/User Data/Projects/com.lveditor.draft/`

**Windows 草稿目录：**
- 剪映: `%LOCALAPPDATA%/JianyingPro/User Data/Projects/com.lveditor.draft/`
- CapCut: `%LOCALAPPDATA%/CapCut/User Data/Projects/com.lveditor.draft/`

## 完整示例

参见 `references/full_feature_showcase.py`

## 局限性

- 不能修改已有草稿（剪映/CapCut 打开后会加密 draft_info.json）
- 不能访问 GPU 特效（智能抠图、美颜等）
- 直连模式需要本机安装剪映或 CapCut（macOS / Windows）
- CapCut 打开草稿后会加密，重新生成需使用 `overwrite=True`
