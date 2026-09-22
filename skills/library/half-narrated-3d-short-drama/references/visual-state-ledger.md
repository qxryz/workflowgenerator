# Visual State Ledger Template (3D Manhua Half-Narrated Short Drama · v2.0)

Use this ledger to keep continuity stable across a 3D manhua half-narrated short drama. Every entry must be **3D manhua** language — no 2D cel, no Pixar cartoon, no photoreal CG, no live-action drift. All user-facing fields follow the user's current language.

## Per-shot ledger fields

- Shot ID
- Character pose and position
- Character expression
- Prop state and orientation
- Scene layout
- **3D Material block** ← NEW for 3D (skin / fabric / metal / glass texture and behavior)
- Lighting direction
- Time of day
- Background motion
- Emotional state
- **Style check** (one-line confirmation that the shot stays within the locked sub-mode)
- **First-frame anchor** (cross-reference to storyboard, kept short here)
  - `first_frame_source`: file path
  - `first_frame_anchor_role`: `character_main_card` / `character_3view_side` / `character_3view_back` / `scene_main_card` / `scene_aux_card` / `last_frame_of_shot_NN` / `reset_anchor`
  - `first_frame_angle_match_confirmed`: `true` / `false` (3D manhua hard requirement)
  - `reset_anchor`: `true` / `false`
- **Plot point ref** ← NEW for v2.0 (links to STEP 5.5 reconciliation table; P001, P002, ...)
- **`shot_audio_schedule` ref** (NEW for v2.0.2) ← links to the locked `shot_audio_schedule` for this shot (narration_window, dialogue_window)
- What must remain unchanged
- What must change in the next shot

## Continuity rules

- Write concrete visual facts, not moods.
- Each entry must be usable as the next shot's opening state.
- Keep identity anchors separate from transient motion.
- Mark any reusable prop or scene state explicitly.
- **Style block consistency**: every shot's style check should pass the same way (e.g. "guoman-3d-render 流, 干净深色描边叠在 3D 渲染上, 软 PBR 材质, 强对比光"). If one shot's style check reads differently (e.g. "smooth shading, photoreal CG, Pixar cartoon"), that's drift — fix the prompt, not the ledger.
- **First-frame anchor consistency**: the ledger's `first_frame_source` must match the storyboard's `first_frame_source` for the same shot. If they disagree, the storyboard wins.
- **First-frame angle consistency (3D manhua)**: the ledger's `first_frame_anchor_role` and `first_frame_angle_match_confirmed` must match the storyboard. A side camera move paired with a front card is a hard inconsistency.
- **3D material consistency (3D manhua)**: the material block must stay stable across shots of the same character/scene.
- **Plot point coverage (v2.0)**: every shot's ledger entry must reference at least one plot point from `script_reconciliation_table` (via `plot_point_refs`). If a shot has no plot point ref, the user gets a flag.
- **Last-frame archive**: after the shot is generated, write down the path to `clips/shot_NN_last.png` so the next-shot ledger entry can reference it.

## 3D Material block — what to record

For each character and scene, list the **3D material vocabulary** that must stay consistent:

### Character materials
- **Skin**: PBR soft, non-photoreal, with subtle subsurface scattering (国漫 3D 流) / smooth stylized (皮克斯流) / painterly thick-coat (半厚涂流)
- **Hair**: matte cel-shading, individual strand detail, consistent color and length
- **Fabric (main wardrobe)**: cloth/silk/leather/metal, draping behavior, fold density, response to wind
- **Metal accessories**: earring / buckle / sword hilt — metallic reflection, color temperature
- **Eye color / iris detail**: stable across shots
- **Skin tone**: warm / cool / neutral, must match character card

### Scene materials
- **Architecture**: wood / stone / brick / glass / metal — all 3D, not 2D illustrated
- **Furniture**: material and color
- **Lighting equipment visible in scene**: lamp / window / candle / magic source
- **Atmospheric effects**: fog / dust / light rays / particles (3D-rendered, not painted)

## Example ledger entry (3D manhua, v2.0 format)

```yaml
- shot_id: 04
  character_pose: "林夏 半侧身, 右手搭在门把手, 左手自然垂落"
  character_expression: "眉头微皱, 眼睛聚焦在门外"
  prop_state: "门半开, 把手上反射走廊冷光"
  scene_layout: "林夏家_客厅_门厅区, 沙发背景, 茶几, 落地灯"
  material_block:
    character_skin: "soft PBR with subtle SSS, warm beige"
    character_hair: "matte cel-shaded, long black, slight wave"
    character_fabric: "gray cotton loungewear, soft folds, non-photoreal"
    scene_architecture: "wooden floor, white walls, modern minimalist"
    scene_furniture: "gray fabric sofa, walnut coffee table, brass floor lamp"
    lighting: "warm amber key light from window left, soft fill from ceiling"
  lighting_direction: "key from window (left), fill from overhead"
  time_of_day: "凌晨 3:00, 室内夜灯"
  background_motion: "窗帘微动, 远处楼道灯微闪"
  emotional_state: "紧张 → 惊恐"
  style_check: "guoman-3d-render 流, 干净描边, 软 PBR 材质, 强对比光 ✅"
  first_frame_source: "assets/characters/林夏_main.png"
  first_frame_anchor_role: "character_main_card"
  first_frame_angle_match_confirmed: true
  reset_anchor: true
  plot_point_refs: ["P007", "P008"]  # [NEW for v2.0] 关联 STEP 5.5 对账表
  shot_audio_schedule_ref:  # [NEW for v2.0.2] 引用 STEP 5.6 锁定的 schedule
    narration_window: [0.0, 3.6]
    dialogue_window: [4.1, 6.0]
    fits_in_shot: true
  unchanged:
    - "林夏 的灰家居服"
    - "客厅布局"
    - "落地灯位置和暖光色温"
  next_shot_changes:
    - "门外神秘人出现"
    - "镜头切到楼道"
```

## What changed in v2.0 (vs v1.1)

| Field | v1.1 | v2.0 |
|---|---|---|
| `plot_point_refs` | did not exist | mandatory, links to STEP 5.5 |
| 3D material block | already present | kept + clarified |
| `first_frame_angle_match_confirmed` (3D field) | already present | kept + clarified |
| Reference to STEP 5.5 | did not exist | added for plot point coverage flag |
