# Shot Anchor Strategy — How to Reference Previous Assets When Generating Shots (3D Manhua · v2.0)

This file is the **single source of truth** for first_frame / last_frame asset referencing during STEP 6 shot generation. It exists because pure text-prompt generation on H3 drifts too much on faces, wardrobe, materials, and scene layout — the 3D manhua short drama output is not stable enough to ship.

**Rule of thumb**: every shot video MUST be generated in image-to-video mode (`opening_frame_image` set) with a real image as the anchor. Text-only video generation is forbidden in this Skill.

## v2.0 pipeline numbering update

> The narration-first step was renamed: it is now **STEP 5.6** (was STEP 5.5 in v1.1). STEP 5.5 is the new **script reconciliation check** that runs **before** narration-first. Update all references accordingly.
>
> Pipeline order: STEP 0 → 1 → 2 → 3 → 4 → 5 → **5.5 (script reconciliation)** → **5.6 (narration-first)** → 6 → 6.5 (dialogue micro-adjust) → 7 → 8

## Why this matters more in 3D manhua than 2D

In 3D manhua short drama, the audience watches 3D-rendered characters and scenes for 60–180 seconds straight. If the protagonist's jaw, hair, material, or wardrobe changes between two adjacent shots, the 3D illusion breaks. Text-only generation drifts because:

- the model has no canonical 3D reference, so it samples a fresh face / material / lighting per shot
- "wardrobe continuity" keywords like "same dark robe as before" are interpreted loosely
- 3D materials (skin, fabric, metal) drift the most when the anchor is text-only
- **3D camera moves (orbit / tracking / pan) re-imagine the geometry entirely** unless anchored to a real multi-angle reference

Fixing this with longer / more emphatic prompts does not work. The fix is **image-based anchoring** with **angle-matched** references: every shot starts from a specific, previously-generated or user-provided image, AND the camera angle of the anchor matches the camera angle of the shot.

## Anchor vocabulary

| Term | Definition | Where it lives |
|---|---|---|
| **character main card** | Clean, identity-defining image of a character (face + outfit + key features), **front 3/4 view** | `provided_assets/characters/<name>_main.png` (user) OR `assets/characters/<name>_main.png` (generated in STEP 6 batch 1) |
| **character three-view sheet** | Clean 3-view of a character (**front + side + back** views side-by-side) | `provided_assets/characters/<name>_3view.png` (user) OR `assets/characters/<name>_3view.png` (generated in STEP 6 batch 1) |
| **scene main card** | Clean, layout-defining image of a scene (architecture, palette, lighting) — **main camera angle** | `provided_assets/scenes/<name>_main.png` (user) OR `assets/scenes/<name>_main.png` (generated in STEP 6 batch 2) |
| **scene auxiliary card** | Clean image of the SAME scene at a **different camera angle** (wide / close-up / over-shoulder) | `provided_assets/scenes/<name>_aux.png` (user) OR `assets/scenes/<name>_aux.png` (generated in STEP 6 batch 2) |
| **prop card** | Clean image of a key prop (sword, locket, document) — RARE; only generated when a single prop is the visual focus of multiple close-up shots | `provided_assets/props/<name>.png` (user) OR `assets/props/<name>_card.png` (generated in STEP 6 Step A, at most 1) |
| **last_frame** | The final frame of a previously-rendered shot video | `clips/shot_NN_last.png` (auto-archived after each shot) |

## Per-shot first_frame decision table (3D manhua — angle match is the key)

Every shot in the storyboard must declare its first_frame source. **The chosen anchor's view must match the shot's camera angle** — this is the new requirement vs 2D.

| shot_role / shot_camera_angle | first_frame | frame_role | 为什么 |
|---|---|---|---|
| **角色首次出场 / 正面 3/4 角度** | 该角色的 **character main card** | `"first_frame"` | 用最权威的脸起手 |
| **侧面 / 平行运镜** | 该角色 **three-view sheet 中的侧面** | `"first_frame"` | 锁住侧脸 / 侧面姿态 |
| **背面 / 追踪运镜** | 该角色 **three-view sheet 中的背面** | `"first_frame"` | 锁住背影 / 背面姿态 |
| **同角色后续镜头（常规）** | 上一镜同角色的 **last_frame** | `"first_frame"` | 锁姿态 / 光线 / 材质 |
| **重置锚（reset anchor）** | 该角色的 **character main card** | `"first_frame"` | 每 4 镜（主角）/ 6 镜（配角）回到主卡重置一次 |
| **场景建立镜 / 主视角** | 该场景的 **scene main card** | `"first_frame"` | 锁布局 / 色调 |
| **同场景运镜差异大的镜** | 该场景的 **scene auxiliary card** | `"first_frame"` | 保持场景在另一视角下的连续 |
| **同场景后续镜头** | 同场景上一镜的 **last_frame** | `"first_frame"` | 保持场景连续 |
| **纯环境 / 空镜**（无角色） | **scene main card** / **scene auxiliary card** / 上一镜 **last_frame** | `"first_frame"` | 锁色温 / 构图 |
| **反转镜头**（切到对话对方） | 被切到那个角色的 **character main card** | `"first_frame"` | 切到对方时用对方主卡重置 |
| **时间跳转 / 切场景 / 切段落** | 新场景的 **scene main card** / **scene auxiliary card** / 新角色的 **character main card** | `"first_frame"` | 天然重置 |
| **轨道 / 环绕运镜**（orbit） | 按方向用 **three-view sheet 对应角度**（front → side → back 循环） | `"first_frame"` | 3D 漫剧招牌运镜 |
| **道具特写** | **prop card**（仅当存在时） | `"first_frame"` | 锁住道具细节 |

## Reset-anchor cadence (重置锚周期) — 3D manhua vs 2D

漂移是累积的，所以需要定期"回到主卡/辅卡"重置一次。3D 漫剧的周期比 2D 长（3D 几何一致性更强）：

| 资产类型 | 2D 周期 | **3D 漫剧周期** | 原因 |
|---|---|---|---|
| 主角 | 3 镜 | **4 镜** | 3D 几何 + PBR 材质比 2D 描边稳 |
| 配角 | 5 镜 | **6 镜** | 同上 |
| 场景 | 4 镜 | **5 镜** | 同上 |

如果某镜本身就是"切镜头 / 切场景 / 时间跳转 / 反转 / 重新进入场景"，下一镜天然就是重置锚，周期自动重置。

### 例子：5 镜一镜的 主角 镜头（3D 漫剧，每 4 镜重置一次）

| shot | 主角在场 | 镜头角度 | 锚点策略 | first_frame |
|---|---|---|---|---|
| 01 | ✅ 出场 | front 3/4 | 角色主卡 | `林夏_main.png` |
| 02 | ✅ 继续 | last_frame 接力 | 上一镜 last_frame | `shot_01_last.png` |
| 03 | ✅ 继续 | 侧面 track | **三视图（侧面）** | `林夏_3view.png` (侧面) |
| 04 | ✅ 继续 | 任意 | **重置**到角色主卡 | `林夏_main.png` |
| 05 | ✅ 继续 | last_frame 接力 | 上一镜 last_frame | `shot_04_last.png` |

### 例子：6 镜一镜的 配角 镜头（3D 漫剧，每 6 镜重置一次）

| shot | 配角在场 | 锚点策略 | first_frame |
|---|---|---|---|
| 01 | ✅ 出场 | 角色主卡 | `楼上人_main.png` |
| 02 | ✅ 继续 | 上一镜 last_frame | `shot_01_last.png` |
| 03 | ✅ 继续 | 上一镜 last_frame | `shot_02_last.png` |
| 04 | ✅ 继续 | 上一镜 last_frame | `shot_03_last.png` |
| 05 | ✅ 继续 | 上一镜 last_frame | `shot_04_last.png` |
| 06 | ✅ 继续 | **重置**到角色主卡 | `楼上人_main.png` |

## Orbit / 360° rotation shot — 3D manhua signature move

Orbit shots are the signature of 3D manhua. To do them right, **cycle through the three-view sheet views** as the camera rotates around the character:

```yaml
# shot 12: 360° orbit around 林夏
- shot_id: 12
  shot_camera_angle: "side"  # starting angle
  first_frame_source: "assets/characters/林夏_3view.png"  # three-view sheet
  first_frame_anchor_role: "character_3view_side"
  first_frame_angle_match:
    shot_camera_angle: "side"
    anchor_view: "side"
    angle_match_confirmed: true
  camera_move: "360° orbit around 林夏, slow"
  reset_anchor: true
  prompt: |
    林夏 站在月光下, 360° 缓慢环绕运镜
    黑色长发随风飘动, 灰家居服, 表情凝重
    3D rendered, Chinese-animation manhua-cel look,
    clean dark outlines on top of 3D shading, soft PBR materials
    with non-photoreal finish, dramatic cinematic light,
    no live-action, no Pixar-style CG, no 2D flat illustration,
    no watermark, no baked-in text
  narration_lines: [{text: "月光下, 我终于看清她的侧脸。", start: 0.0, end: null}]
  plot_point_refs: ["P015"]  # [NEW for v2.0] 关联 STEP 5.5
```

For 8s+ orbit shots, the 3D model is more stable than 2D.

## audio_schedule block in STEP 6 prompts (NEW for v2.0.2)

Every shot's prompt **must** embed the locked `shot_audio_schedule` from STEP 5.6 as an `audio_schedule` block. This is the single most important change in v2.0.2 — it raises H3's dialogue alignment from ~20% to ~80%.

```
audio_schedule:
  shot_duration: 8.0
  narration_window: [0.0, 3.6]      # no character speaks during this window
  dialogue_window: [3.6, 5.5]      # character <X> should speak during this window
  buffer_between: 0.5
  total_audio: 5.5
  constraint: "no speech during 0-3.6s; character <X> speaks during 3.6-5.5s"
```

**Why this works**: H3 is sensitive to scene-level constraints in the prompt. Adding `narration_window` / `dialogue_window` with explicit start-end timestamps guides the model to allocate speaking time to the planned window. The schedule is a strong hint, not a hard guarantee — STEP 6.5 still measures and re-aligns, but the post-render drift drops from ~80% to ~20%.

**Anti-patterns for the audio_schedule block**:
- ❌ Omitting the `audio_schedule` block from the prompt — reverts to v2.0.1's risk profile
- ❌ Putting `audio_schedule` in the style block — it should be a separate, clearly-marked block
- ❌ Using soft language like "around 3.6-5.5s" — use exact timestamps from `shot_audio_schedule`
- ❌ Reversing the constraint (asking the character to speak during narration_window) — always verify the dialogue_window matches the speaker

## Last-frame archive step (末帧归档) — 必做

每个镜头视频生成完成后，**从视频里截最后一帧**，存成 `clips/shot_NN_last.png`。

```bash
platform last-frame extraction for the generated shot
```

批量执行：

```bash
    platform last-frame extraction for each generated shot
```

## Storyboard integration

每个镜头的 storyboard 必须新增 3 个字段（vs 2D 多了 `first_frame_angle_match`）：

- `first_frame_source`: 见决策表里 first_frame 列出的具体路径
- `first_frame_frame_role`: `"first_frame"` 或 `"last_frame"`
- `first_frame_angle_match` (3D):
  - `shot_camera_angle`: 镜头的实际拍摄角度
  - `anchor_view`: 锚图的视角（必须匹配）
  - `angle_match_confirmed`: `true`（不匹配不允许生成）

v2.0 还新增：
- `narration_lines`: `[{text, start, end}]` 统一格式
- `narration_word_count`: 旁白字数
- `narration_predicted_duration`: 旁白预估时长
- `plot_point_refs`: 关联 STEP 5.5 剧本对账表

示例：

```yaml
- shot_id: 04
  beat_role: "转折"
  duration: 8.0
  scene: "凤仪宫_正殿"
  characters: ["萧珩"]
  shot_camera_angle: "three_quarter"
  first_frame_source: "assets/characters/萧珩_main.png"  # 重置锚
  first_frame_frame_role: "first_frame"
  first_frame_anchor_role: "character_main_card"
  first_frame_angle_match:
    shot_camera_angle: "three_quarter"
    anchor_view: "front_3/4"
    angle_match_confirmed: true
  reset_anchor: true
  narration_lines: [
    {text: "那一刻，我终于看清了龙椅后面的人。", start: 0.0, end: null}
  ]
  narration_word_count: 17
  narration_predicted_duration: 4.6
  plot_point_refs: ["P008", "P009"]
```

```yaml
# 跟踪运镜必须用三视图的侧面
- shot_id: 05
  shot_camera_angle: "side"
  first_frame_source: "assets/characters/萧珩_3view.png"  # 侧面
  first_frame_anchor_role: "character_3view_side"
  first_frame_angle_match:
    shot_camera_angle: "side"
    anchor_view: "side"
    angle_match_confirmed: true
  ...
```

```yaml
# 背面镜头必须用三视图的背面
- shot_id: 06
  shot_camera_angle: "back"
  first_frame_source: "assets/characters/萧珩_3view.png"  # 背面
  first_frame_anchor_role: "character_3view_back"
  first_frame_angle_match:
    shot_camera_angle: "back"
    anchor_view: "back"
    angle_match_confirmed: true
  ...
```

## Generation call patterns

### Model: MiniMax-H3 image-to-video capability (默认)

> **视频模型规则 [HARD GATE]**：所有镜头默认用 **MiniMax-H3** 的 image-to-video 能力生成。用户明确选择其他模型时先检查能力，兼容后遵循选择；退到 text-to-video 仅在用户显式批准时允许。生成失败先按原因重试一次，仍失败切换兼容模型。

**平台当前可用的图生视频能力参数**：

| 参数 | 默认值 | 说明 |
|---|---|---|
| `model` | `MiniMax-H3` | 默认视频模型；其他模型需用户明确选择并先做能力检查 |
| `frame_role` | `"first_frame"` | 必传 first_frame |
| `opening_frame_image` | 必传 | 角色主卡/三视图/场景主辅卡/道具卡/上一镜 last_frame |
| `duration` | `10` (默认) / `6` (战斗/快切) | 单镜时长硬上限 10s |
| `resolution` | `1080P` | 默认 1080P |
| 多模态参考 | 角色主卡 + 三视图 + 场景主辅卡 + 道具卡 | 全作为 `opening_frame_image` 候选 |

### 单镜头生成（平台当前可用的图生视频能力）

```python
gen_videos(
    model="MiniMax-H3",  # 默认模型；其他模型需用户明确选择并通过能力检查
    prompt="<shot content>, <style block>, <continuity block>, <audio_schedule block>",
    output_file_path="clips/shot_03.mp4",
    opening_frame_image="clips/shot_02_last.png",  # 必传 first_frame（H3 全能参考的硬要求）
    frame_role="first_frame",
    duration=10,  # [v2.0.6] 默认 10s，6s 仅战斗/快切
    resolution="1080P",
)
```

> **ULF note [v2.0.3]**: the `prompt` field is a H3-facing technical prompt — it stays in **English** regardless of `user_language`. H3's training data is English-dominant, and English style/schedule blocks produce the most stable output. The user's original character/scene/dialogue text is preserved verbatim inside the `<shot content>` slot regardless of language.

### 批量生成

```python
batch_image_to_video(
    image_file_path_list=[
        "assets/characters/萧珩_main.png",  # 重置锚
        "clips/shot_01_last.png",
        "clips/shot_02_last.png",
        "assets/characters/萧珩_3view.png",  # 侧面 track 镜
        "assets/characters/萧珩_main.png",  # 重置锚
    ],
    output_file_path_list=[
        "clips/shot_04.mp4",
        "clips/shot_05.mp4",
        "clips/shot_06.mp4",
        "clips/shot_07.mp4",
        "clips/shot_08.mp4",
    ],
    prompt_list=[...],
    frame_role_list=["first_frame"] * 5,
    duration_list=[8, 8, 8, 8, 8],
    resolution_list=["1080P"] * 5,
)
```

## Failure repair priority (3D manhua — angle check is the new entry)

1. **强化 first_frame** ——
   - 角色主卡太弱 / 太杂 → 重做角色主卡
   - 三视图的某个角度模糊 → 重做该角度
   - last_frame 模糊 / 角度差 → 用更早的同角色镜头的 last_frame 或退回角色主卡
2. **检查 first_frame 角度是否匹配镜头** ← **3D 漫剧特有的修复入口**
   - 比如镜头是侧面 track 但 first_frame 用了正面主卡 → 立刻换成三视图的侧面
3. **在 prompt 的连续性块加显式身份关键词**
4. **缩短镜头时长**
5. **减少镜头运动**
6. **检查 3D 风格块**

**不要**反复重跑同一段纯文字 prompt 指望变稳。

## 完整镜头例子（5 镜一段剧情，3D 漫剧 v2.0）

```yaml
shots:
  # shot 01: 萧珩首次出场 - 正面
  - shot_id: 01
    beat_role: "设定"
    duration: 8
    characters: ["萧珩"]
    scene: "凤仪宫_正殿"
    shot_camera_angle: "three_quarter"
    first_frame_source: "assets/characters/萧珩_main.png"
    first_frame_frame_role: "first_frame"
    first_frame_anchor_role: "character_main_card"
    first_frame_angle_match:
      shot_camera_angle: "three_quarter"
      anchor_view: "front_3/4"
      angle_match_confirmed: true
    prompt: |
      萧珩站在凤仪宫正殿中央，背对镜头缓缓转身，
      黑色朝服，金线滚边，眉心朱砂，
      表情冷峻，带一丝嘲讽。
      3D rendered, Chinese-animation manhua-cel look,
      clean dark outlines on top of 3D shading,
      soft PBR materials with non-photoreal finish,
      dramatic cinematic light, webtoon-friendly vertical framing,
      no live-action, no Pixar-style CG, no 2D flat illustration,
      no watermark, no baked-in text
    narration_lines: [{text: "那一日，新帝登基，百官跪伏，唯我立于殿外。", start: 0.0, end: null}]
    narration_word_count: 22
    narration_predicted_duration: 5.8
    plot_point_refs: ["P001"]

  # shot 02: 萧珩继续（接上一镜 last_frame）
  - shot_id: 02
    ...
    first_frame_source: "clips/shot_01_last.png"
    first_frame_anchor_role: "last_frame_of_shot_01"
    ...
    narration_lines: [{text: "他回眸看我时，全场寂静。", start: 0.0, end: null}]
    plot_point_refs: ["P002"]

  # shot 03: 萧珩继续 - 侧面 track
  - shot_id: 03
    shot_camera_angle: "side"
    first_frame_source: "assets/characters/萧珩_3view.png"  # 侧面
    first_frame_anchor_role: "character_3view_side"
    first_frame_angle_match:
      shot_camera_angle: "side"
      anchor_view: "side"
      angle_match_confirmed: true
    prompt: |
      萧珩从侧面走过玉阶，朝我走来，
      黑色朝服随步伐摆动，金线滚边反光，
      步子不快，但每一步都像踏在我心口。
      Same face as three-view side, no face change.
      3D rendered, Chinese-animation manhua-cel look, ...
    narration_lines: [{text: "我以为他会停在我面前。", start: 0.0, end: null}]
    plot_point_refs: ["P003"]
    camera_move: "side-tracking parallel to 萧珩"

  # shot 04: 萧珩 - 重置锚（每 4 镜一次）
  - shot_id: 04
    shot_camera_angle: "three_quarter"
    first_frame_source: "assets/characters/萧珩_main.png"  # 重置
    first_frame_anchor_role: "character_main_card"
    first_frame_angle_match:
      shot_camera_angle: "three_quarter"
      anchor_view: "front_3/4"
      angle_match_confirmed: true
    reset_anchor: true
    dialogue_lines: [{speaker: "萧珩", line: "你该行礼了。", tone: "冷淡", start: 0.0, end: null}]
    plot_point_refs: ["P004"]

  # shot 05: 反转镜头，切到沈清晚 - 用主卡（首次出场）
  - shot_id: 05
    shot_camera_angle: "three_quarter"
    first_frame_source: "assets/characters/沈清晚_main.png"
    first_frame_anchor_role: "character_main_card"
    first_frame_angle_match:
      shot_camera_angle: "three_quarter"
      anchor_view: "front_3/4"
      angle_match_confirmed: true
    reset_anchor: true  # 反转天然重置
    narration_lines: [{text: "而我——我立在原地，动弹不得。", start: 0.0, end: null}]
    plot_point_refs: ["P005"]
```

## Edge cases

### 同一镜里有 2 个角色

- **用占主导的那个角色的主卡**做 first_frame
- 在 prompt 的连续性块里**显式列出第二个角色的描述**
- 第二角色在下个镜头再单独重置
- 如果两个角色都正脸出镜且同等重要，**生成一张"双角色卡"**（两人都在画面里）

### 远景 / 群像镜（角色都很小）

- 用**场景主卡**而不是角色卡
- 这种镜头的"漂移"主要在场景，**场景主卡是锚**

### 道具特写

- 用**道具卡**当 first_frame
- 6 镜以上的道具特写，要**每 3 镜回到道具卡重置**
- **如果没生道具卡**，把道具嵌进角色主卡里

### 战斗 / 动作场面

- 动作剧烈，**每 1 镜都重置**到角色主卡
- 缩短单镜时长到 **4-6s**（H3 6s 模式）

### 时间跳转 / 季节变化

- 用**新场景的 scene main card**或**新服装版本的 character main card**

### 镜头里同时切场景 + 角色

- **优先用角色主卡**
- 在 prompt 里显式标注新场景的布局
- 标 `reset_anchor: true`

## Anti-patterns (绝对不能做)

- ❌ **纯文字生成镜头**
- ❌ **5+ 镜不重置**到角色卡
- ❌ **跳过末帧归档**
- ❌ **末帧用错了场景/角色**
- ❌ **长镜头（>10s）当锚点链的主镜**
- ❌ **靠 prompt 文字描述"same face as before"代替锚图**
- ❌ **同一镜里塞 2 个角色卡当 first_frame**
- ❌ **3D 漫剧特有**：**侧面 track 镜用正面主卡当 first_frame**
- ❌ **3D 漫剧特有**：**背面 chase 镜用 last_frame 接力**
- ❌ **3D 漫剧特有**：**跳过三视图直接进镜头生成**
- ❌ **3D 漫剧特有**：**同场景所有镜头都用主卡**
- ❌ **[NEW for v2.0]** Failing to link shots back to `script_reconciliation_table` via `plot_point_refs` — makes the STEP 5.5 reconciliation toothless

## QC integration

`references/qc-checklist.md` 里有专门的 first_frame 硬关卡：

- **[HARD GATE]** 每个镜头都生成了 `clips/shot_NN_last.png`
- **[HARD GATE]** 每个镜头的 first_frame 来源和决策表一致
- **[HARD GATE, NEW for 3D]** 每个镜头的 first_frame 角度和镜头角度匹配
- **[HARD GATE, NEW for 3D]** 每主要角色有 1 张主卡 + 1 张三视图；每主要场景有 1 张主卡 + 1 张辅卡
- **[HARD GATE]** 主角每 4 镜、配角每 6 镜、场景每 5 镜有重置锚
- **[HARD GATE]** 没有纯文字生成的镜头
- **[HARD GATE, NEW for v2.0]** STEP 5.5 剧本对账在 STEP 5.6 之前跑完，所有剧情点都进 `script_reconciliation_table`
- **[HARD GATE, NEW for v2.0]** 核心资产和最终规格在画布上，用户已确认才能进 STEP 6 Step B
- **[HARD GATE, NEW for v2.0]** 所有面向用户的输出跟随用户当前语言

不通过不交付。
