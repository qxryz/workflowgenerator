# Shot Anchor Strategy — How to Reference Previous Assets When Generating Shots

> v1.8 note: this file governs visual continuity only. Audio timing and the video-original dialogue policy are defined by references/audio-timeline.md and take precedence over older examples.

This file is the **single source of truth** for first_frame / last_frame asset referencing during STEP 6 shot generation. It exists because pure text-prompt generation on H3 drifts too much on faces, wardrobe, props, and scene layout — the 2D short drama output is not stable enough to ship.

**Backend and mode lock**: every shot defaults to the platform’s currently available video capability `platform-supported reference mode`. First-frame / last-frame images are optional continuity references; the mandatory input is the per-shot asset binding recorded in `asset_manifest`.

**Rule of thumb**: first-frame / last-frame image-to-video references are optional. Regardless of whether an image reference is used, every shot must bind its actual characters, scenes, props, wardrobe, and other required assets through `asset_manifest`.

## Why this matters

In 2D short drama, the audience watches characters and scenes for 60–180 seconds straight. If the protagonist's jaw, hair, or wardrobe changes shape between two adjacent shots, the drama breaks. Unbound generation drifts because:

- the model has no canonical reference, so it samples a fresh face each shot
- "wardrobe continuity" keywords like "same dark robe as before" are interpreted loosely
- lighting, palette, and scene layout are re-imagined per shot

Fixing this with longer / more emphatic prompts does not work. The required control is **asset binding plus an explicit spatial layout ledger**; image anchoring can be added when continuity benefits from it.

## Anchor vocabulary

| Term | Definition | Where it lives |
|---|---|---|
| **character card** | Clean, identity-defining image of a character (face + outfit + key features) | `provided_assets/characters/<name>.png` (user) OR `assets/characters/<name>_card.png` (generated in STEP 6 batch 1) |
| **scene card** | Clean, layout-defining image of a scene (architecture, palette, lighting) | `provided_assets/scenes/<name>.png` (user) OR `assets/scenes/<name>_card.png` (generated in STEP 6 batch 2) |
| **prop card** | Clean image of a key prop (sword, locket, document) — RARE; only generated when a single prop is the visual focus of multiple close-up shots. Otherwise embed props into the character/scene card. | `provided_assets/props/<name>.png` (user) OR `assets/props/<name>_card.png` (generated in STEP 6 Step A, at most 1) |
| **last_frame** | The final frame of a previously-rendered shot video | `clips/shot_NN_last.png` (auto-archived after each shot) |

## Asset binding gate

Before a generation call, resolve every shot reference to an `asset_manifest` record:

| Field | Required value |
|---|---|
| `referenced_asset_ids` | Character / scene / prop IDs visible or required in the shot |
| `asset_bindings` | Mapping of each character, scene, and key prop to its asset ID |

If any binding is missing, stale, or inconsistent with the storyboard, stop and repair the asset manifest before generating the shot. A first-frame image is not required.

## Optional per-shot first_frame decision table

When a shot uses an image continuity reference, declare its first_frame source and pick exactly one:

| shot_role | first_frame | reference_type | 为什么 |
|---|---|---|---|
| **角色首次出场**（主角/配角第一镜） | 该角色的 **character card** | `"first_frame"` | 用最权威的脸起手 |
| **同一角色后续镜头** | 上一镜同角色的 **last_frame** | `"first_frame"` | 锁姿态/光线 |
| **重置锚**（reset anchor） | 该角色的 **character card** | `"first_frame"` | 每 3–5 镜重置一次，防漂移积累 |
| **场景建立镜** | 该场景的 **scene card** | `"first_frame"` | 锁布局/色调 |
| **同场景后续镜头** | 同场景上一镜的 **last_frame** | `"first_frame"` | 保持场景连续 |
| **纯环境/空镜**（无角色） | **scene card** 或上一镜 **last_frame** | `"first_frame"` | 锁色温/构图 |
| **反转镜头**（切到对话对方） | 被切到那个角色的 **character card** | `"first_frame"` | 切到对方时重置 |
| **时间跳转 / 切场景 / 切段落** | 新场景的 **scene card** 或新角色的 **character card** | `"first_frame"` | 天然重置 |

## Reset-anchor cadence (重置锚周期)

漂移是累积的，所以需要定期"回到角色卡/场景卡"重置一次。

- **主角**：连续出场每 **3 镜**回到主角卡重置一次
- **配角**：连续出场每 **5 镜**回到配角卡重置一次
- **场景**：同场景每 **4 镜**回到场景卡重置一次
- 如果某镜本身就是"切镜头 / 切场景 / 时间跳转 / 反转"，下一镜天然就是重置锚，周期自动重置

### 例子：5 镜一镜的 主角 镜头

| shot | 主角在场 | 锚点策略 | first_frame |
|---|---|---|---|
| 01 | ✅ 出场 | 角色卡 | `萧珩_card.png` |
| 02 | ✅ 继续 | 上一镜 last_frame | `shot_01_last.png` |
| 03 | ✅ 继续 | 上一镜 last_frame | `shot_02_last.png` |
| 04 | ✅ 继续 | **重置**到角色卡 | `萧珩_card.png` |
| 05 | ✅ 继续 | 上一镜 last_frame | `shot_04_last.png` |

## Last-frame archive step (末帧归档) — 必做

每个镜头视频生成完成后，**从视频里截最后一帧**，存成 `clips/shot_NN_last.png`。

这一步 skill 执行者必须自己做，不能跳过：

```python
# 伪代码（每镜视频就绪后调用）
def extract_last_frame(shot_video_path: str, output_path: str):
    # 视频总时长
    duration = get_duration(shot_video_path)
    # 取最后一帧（duration - 0.1s 防止取到黑帧）
    ffmpeg_extract_frame(
        video=shot_video_path,
        timestamp=duration - 0.1,
        output=output_path
    )
```

实际操作示例（用 ffmpeg）：

```bash
# 截取视频最后一帧
ffmpeg -sseof -0.1 -i clips/shot_01.mp4 -frames:v 1 -q:v 2 clips/shot_01_last.png
```

存到 `clips/shot_NN_last.png` 后，**自动成为下一镜的锚点候选**。

## Storyboard integration

需要连续性参考时，镜头 storyboard 可填写以下字段：

- `first_frame_source`: 见决策表里 first_frame 列出的具体路径
- `first_frame_reference_type`: `"first_frame"` 或 `"last_frame"`

示例：

```yaml
- shot_id: 04
  beat_role: "转折"
  duration: 6.0
  scene: "凤仪宫_正殿"
  characters: ["萧珩"]
  first_frame_source: "provided_assets/characters/萧珩_card.png"  # 重置锚
  first_frame_reference_type: "first_frame"
  narration_lines: ["那一刻，我终于看清了龙椅后面的人。"]
  dialogue_lines: []
  ...
```

```yaml
- shot_id: 05
  beat_role: "转折"
  duration: 6.0
  scene: "凤仪宫_正殿"
  characters: ["萧珩"]
  first_frame_source: "clips/shot_04_last.png"  # 接上一镜
  first_frame_reference_type: "first_frame"
  ...
```

## Generation call patterns

### 单镜头生成

```python
gen_videos(
    prompt="<shot content>, <style block>, <continuity block>",
    output_file_path="clips/shot_03.mp4",
    # input_image_path="clips/shot_02_last.png",  # 可选：上一镜末帧
    # reference_type="first_frame",
    backend="the platform’s currently available video capability",
    generation_mode="platform-supported reference mode",
    resolution="<user-selected-768P-or-2K>",
    duration=6,
)
```

### 批量生成（可选连续性参考）

```python
batch_image_to_video(
    image_file_path_list=[
        "provided_assets/characters/萧珩_card.png",  # 重置锚
        "clips/shot_01_last.png",
        "clips/shot_02_last.png",
        "provided_assets/characters/萧珩_card.png",  # 重置锚
    ],
    output_file_path_list=[
        "clips/shot_04.mp4",
        "clips/shot_05.mp4",
        "clips/shot_06.mp4",
        "clips/shot_07.mp4",
    ],
    prompt_list=[
        "<shot 04 prompt>",
        "<shot 05 prompt>",
        "<shot 06 prompt>",
        "<shot 07 prompt>",
    ],
    reference_type_list=["first_frame"] * 4,
    duration_list=[6, 6, 6, 6],
    resolution_list=["<user-selected-768P-or-2K>"] * 4,
)
```

### 截取末帧（整批完成后批量执行）

```bash
# 批量截末帧
for i in 01 02 03 04 05 06 07; do
    ffmpeg -sseof -0.1 -i "clips/shot_${i}.mp4" -frames:v 1 -q:v 2 "clips/shot_${i}_last.png"
done
```

## Failure repair priority

镜头失败（人脸漂、服装漂、场景漂、道具漂），按这个顺序修：

1. **强化 first_frame** ——
   - 角色卡太弱/太杂 → 重做角色卡
   - last_frame 模糊/角度差 → 用更早的同角色镜头的 last_frame 或退回角色卡
   - 场景卡太广 → 用同场景更近的 last_frame
2. **在 prompt 的连续性块加显式身份关键词** ——
   - 例如："same face as previous shot, no face change, exact same dark robe with gold trim"
3. **缩短镜头时长** ——
   - 8s 比 6s 漂得多，10s 比 8s 漂得更多
   - 单镜尽量不超过 6s（最多 10s 极限）
4. **减少镜头运动** ——
   - 剧烈运镜/快切会盖住身份，模型重新想象脸
   - 静态镜头比摇镜/推镜稳得多

**不要**反复重跑同一段纯文字 prompt 指望变稳。

## 完整镜头例子（5 镜一段剧情）

假设：用户提供了 **萧珩_card.png** 和 **沈清晚_card.png** 和 **凤仪宫_正殿_card.png**。剧本是"萧珩在金殿上转身，沈清晚走入"。

```yaml
shots:
  # shot 01: 萧珩首次出场
  - shot_id: 01
    beat_role: "设定"
    duration: 6
    characters: ["萧珩"]
    scene: "凤仪宫_正殿"
    first_frame_source: "provided_assets/characters/萧珩_card.png"
    first_frame_reference_type: "first_frame"
    prompt: |
      萧珩站在凤仪宫正殿中央，背对镜头缓缓转身，
      黑色朝服，金线滚边，眉心朱砂，
      表情冷峻，带一丝嘲讽。
      2D cel-shaded animation, Chinese-animation webtoon style,
      clean bold black outlines, flat color fills with cel highlights,
      dramatic light/shadow contrast, vertical-scroll-friendly framing,
      no 3D, no photoreal, no live-action, no watermark, no baked-in text
    narration: "那一日，新帝登基，百官跪伏，唯我立于殿外。"

  # shot 02: 萧珩继续（接上一镜）
  - shot_id: 02
    beat_role: "设定"
    duration: 6
    characters: ["萧珩"]
    scene: "凤仪宫_正殿"
    first_frame_source: "clips/shot_01_last.png"
    first_frame_reference_type: "first_frame"
    prompt: |
      萧珩抬起下巴，目光扫过百官，嘴角微微一挑。
      Same face as previous shot, no face change.
      2D cel-shaded animation, Chinese-animation webtoon style, ...
    narration: "他回眸看我时，全场寂静。"

  # shot 03: 萧珩继续（接上一镜）
  - shot_id: 03
    beat_role: "压力"
    duration: 6
    characters: ["萧珩"]
    scene: "凤仪宫_正殿"
    first_frame_source: "clips/shot_02_last.png"
    first_frame_reference_type: "first_frame"
    prompt: |
      萧珩走下玉阶，朝我走来，
      步子不快，但每一步都像踏在我心口。
      Same face as previous shot, no face change.
      2D cel-shaded animation, Chinese-animation webtoon style, ...
    narration: "我以为他会停在我面前。"

  # shot 04: 萧珩 — 重置锚（每 3 镜一次）
  - shot_id: 04
    beat_role: "压力"
    duration: 6
    characters: ["萧珩"]
    scene: "凤仪宫_正殿"
    first_frame_source: "provided_assets/characters/萧珩_card.png"  # ← 重置
    first_frame_reference_type: "first_frame"
    prompt: |
      萧珩停在我面前一丈远处，
      垂眼看我，眼神复杂。
      Same face as character card, no face change.
      2D cel-shaded animation, Chinese-animation webtoon style, ...
    dialogue:
      speaker: "萧珩"
      line: "你该行礼了。"
      tone: "冷淡"
    ...

  # shot 05: 反转镜头，切到沈清晚
  - shot_id: 05
    beat_role: "转折"
    duration: 6
    characters: ["沈清晚"]
    scene: "凤仪宫_正殿"
    first_frame_source: "provided_assets/characters/沈清晚_card.png"  # ← 反转天然重置
    first_frame_reference_type: "first_frame"
    prompt: |
      沈清晚站在殿外台阶上，仰头望向殿内，
      雪白衣裙，长发被风吹起，眼眶泛红。
      Same face as character card, no face change.
      2D cel-shaded animation, Chinese-animation webtoon style, ...
    narration: "而我——我立在原地，动弹不得。"
```

## Edge cases

### 同一镜里有 2 个角色

- **用占主导的那个角色的角色卡**做 first_frame
- 在 prompt 的连续性块里**显式列出第二个角色的描述**（"another female character in white dress, long black hair, red-rimmed eyes"）
- 第二角色在下个镜头再单独重置

### 远景 / 群像镜（角色都很小）

- 用**场景卡**而不是角色卡
- Prompt 里只描述"5-6 名朝臣站立"，不强调任何个体的脸
- 这种镜头的"漂移"主要在场景，**场景卡是锚**

### 道具特写（剑、玉佩、诏书）— 仅当生过道具卡时

- 用**道具卡**当 first_frame
- 特写镜的漂移主要在道具本身
- 6 镜以上的道具特写，要**每 3 镜回到道具卡重置**
- **如果没生道具卡**，把道具嵌进角色卡里（比如"萧珩手持的玉佩"画进萧珩的角色卡），特写镜用角色卡当 first_frame

### 战斗 / 动作场面

- 动作剧烈，**每 1 镜都重置**到角色卡（不用 last_frame，因为动作让 last_frame 偏离动作起点太远）
- 缩短单镜时长到 **4-6s**，别超 6s
- Prompt 里加重"keep character face consistent, no face change, fast action"

### 时间跳转 / 季节变化

- 用**新场景的 scene card**或**新服装版本的 character card**
- Prompt 里加重"new season / new time / new wardrobe"

## Anti-patterns (绝对不能做)

- 首帧 / 末帧参考可按连续性需要使用；不使用时必须依靠完整的空间状态和资产绑定。
- ❌ **末帧用错了场景/角色** —— 切镜前要仔细检查 last_frame 的角色是谁、场景是哪
- ❌ **长镜头（>10s）当锚点链的主镜** —— 长镜头本身就漂，链尾一定漂
- ❌ **靠 prompt 文字描述"same face as before"代替锚图** —— 文字描述的"same"对模型来说不严格
- ❌ **同一镜里塞 2 个角色卡当 first_frame** —— 只选主导角色那张

## QC integration

`references/qc-checklist.md` 里有专门的空间与资产硬关卡；首帧相关项目仅在使用参考图时检查：

- **[HARD GATE]** 每个可见角色（含次要角色 / 群演）均绑定角色卡资产
- **[HARD GATE]** 每镜空间站位、视线和 180 度轴线记录完整且连续
- 使用首帧 / 末帧时，其来源与资产记录一致

不通过不交付。
