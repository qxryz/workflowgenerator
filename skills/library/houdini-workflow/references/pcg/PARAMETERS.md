> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# User-Facing Parameter Design

The art of exposing 5-10 meaningful knobs that give artists creative range without overwhelming them.

## Core principle: parameter density

| Total params on HDA | Outcome |
|---------------------|---------|
| 0-2 | Asset is a black box; artists complain "no control" |
| 3-7 | Sweet spot — enough range, easy to learn |
| 8-12 | Manageable if categorized well |
| 13-25 | Overwhelming; artists hit "default" and don't iterate |
| 25+ | Unusable; nobody touches anything |

**Rule**: aim for 5-10 visible parameters. Hide everything else inside the HDA.

## Parameter taxonomy

### Tier 1: Structural (define the asset class)

These change the **fundamental shape**. Always exposed.

- `seed` (int) — random seed for full re-roll
- `size_x`, `size_y`, `size_z` (float) — overall extents
- `complexity` (float 0-1) — single knob driving multiple internal complexities (number of stories, density of features)
- `style_variant` (enum) — discrete major variations ("victorian" / "rustic" / "modern")

### Tier 2: Stylistic (affect distribution / density)

These tune how features are placed. Usually 3-5 of these.

- `window_density` (float 0-1) — probability of windows per wall
- `decoration_density` (float 0-1) — chimneys, dormers, weather vanes
- `weathering_amount` (float 0-1) — wear/damage degree
- `gravity_bias` (float 0-1) — how much mass concentrates at the bottom
- `roof_slope` (float, degrees) — steeper / flatter roofs

### Tier 3: Cosmetic (color / material flavor)

Often hidden initially, exposed if needed.

- `wood_color_seed` (int)
- `roof_material` (enum) — "shingles" / "thatch" / "metal"
- `ground_palette` (color ramp)

### Tier 4: Hidden / advanced (technical, kept inside HDA)

NEVER expose unless absolutely needed.

- Internal grid sizes (would break the asset to change)
- VDB voxel sizes (perf-related)
- Internal probabilities for sub-features (the artist drives these via Tier 2 single-knob)

## Single-knob abstraction (the magic of "complexity")

When you find yourself wanting to expose 5 internal probabilities, instead expose **1 single "complexity" knob** that internally drives all 5:

```c
// inside SOP wrangle, at top-level subnet
float c = ch("../complexity");

float window_prob = fit(c, 0, 1, 0.2, 0.6);
float chimney_prob = fit(c, 0, 1, 0.05, 0.3);
float decoration_density = fit(c, 0, 1, 0.1, 0.7);
float weathering = fit(c, 0, 1, 0.0, 0.5);

setdetailattrib(0, "window_prob", window_prob);
setdetailattrib(0, "chimney_prob", chimney_prob);
// etc.
```

Artist sees one slider; you tuned the relationships behind it. Much friendlier.

If artist later says "I want more windows but fewer chimneys" — that's the cue to split into two knobs.

## Parameter ranges and defaults

For every parameter:

- **Range**: be opinionated. `window_density` from 0 to 1, not 0 to 100.
- **Default**: should produce a "presentable" asset. Artist may explore but the default looks good.
- **Tooltip**: one sentence describing the visible effect.

Example:
```
parm name: "window_density"
label:     "Window Density"
type:      float
range:     0.0 - 1.0
default:   0.4
tooltip:   "Higher = more windows on each wall face. Try 0.2-0.6 for natural look."
```

## Random seed strategy

Always have ONE master `seed` parameter. Use it as the base for all rand() calls:

```c
// inside any wrangle
float seed = ch("../seed");                    // master seed
float local_seed = seed + ch("local_offset");  // optional local offset
rand(local_seed + @primnum);                    // per-prim deterministic
```

Why one master seed: artists can quickly cycle through versions by incrementing one number. Multiple seeds = combinatorial explosion.

## Parameter UI organization

For 8+ parameters, group them into folders:

```
HDA Parameters
├── 📁 Shape
│   ├── seed
│   ├── size_x / size_y / size_z
│   └── complexity
├── 📁 Distribution
│   ├── window_density
│   ├── decoration_density
│   └── gravity_bias
├── 📁 Style
│   ├── style_variant
│   └── weathering_amount
└── 📁 Advanced (collapsed by default)
    └── debug_visualize
```

Houdini supports folder parms natively (use `Tabs` or `Folder` in parameter interface editor).

## Wedge-friendly parameters

If the asset will be used in a render farm with parameter wedging (testing N variations), make sure each parameter is wedge-friendly:

- ✅ Numeric ranges (any value valid)
- ✅ Discrete enums (a few options)
- ❌ String paths (hard to wedge)
- ❌ Ramps (hard to wedge — bake to enum if needed)

## Validation in HDA

For each parameter, add validation logic:

```c
// at HDA top-level wrangle
if (ch("size_x") < 1.0) {
    addmessage(0, "size_x too small, minimum 1.0");
}
if (ch("seed") < 0) {
    setch("seed", 0);  // clamp to non-negative
}
```

Friendly error messages save hours of debugging "why is it broken".

## Parameter evolution

Track parameters as the asset evolves:

- v1: minimal — just `seed`, `complexity`
- v2: art comes back — add `window_density` (split out from complexity)
- v3: art wants directional control — add `entrance_face_normal`
- v4: deprecation — `style_variant` → `theme` (renamed for clarity)

When deprecating: keep the old parm hidden but functional for 1-2 versions, then remove.

## Anti-patterns

### Anti-pattern 1: Exposing internal variables

**Bad**: exposing `internal_grid_size`, `vdb_voxel_size`, `scatter_npts`
**Why**: artists don't know what these mean; changing them breaks the asset
**Fix**: hide them; if needed, drive them from `complexity`

### Anti-pattern 2: Boolean explosion

**Bad**: `enable_chimneys`, `enable_windows`, `enable_doors`, `enable_railings` (10 booleans)
**Why**: most artists want ALL of them; the booleans just clutter
**Fix**: replace with `feature_density` slider; at 0 most are off, at 1 all are on

### Anti-pattern 3: No tooltips

**Bad**: parameters with no description
**Why**: artist guesses, gets it wrong, blames the asset
**Fix**: every parameter has a one-sentence tooltip showing range guidance

### Anti-pattern 4: Misleading defaults

**Bad**: defaults that produce an empty / broken asset
**Why**: artist drops the HDA, sees nothing, assumes it's broken
**Fix**: defaults always produce a presentable asset

### Anti-pattern 5: Hidden state via cooked time

**Bad**: parameters that depend on what was previously cooked (e.g., "use the last seed")
**Why**: cook order non-deterministic, artist can't reproduce
**Fix**: every parameter has explicit value; no implicit history

## Asset class → typical parameter set

### Building (residential)
```
seed, complexity, size_x, size_z, num_floors, window_density,
chimney_probability, weathering_amount, style_variant
```

### City block
```
seed, plot_size, building_density, building_max_height, road_width,
park_probability, style_variant
```

### Vegetation (single tree)
```
seed, age, branch_complexity, leaf_density, wind_intensity, season
```

### Cave system
```
seed, cave_size, room_density, corridor_complexity, treasure_count, theme
```

### Spaceship
```
seed, hull_length, engine_count, weapon_density, panel_complexity, faction
```

Adapt as needed. The point is: a small focused parameter set per asset.

## Testing the parameter set

Before shipping:

1. Generate 5 variations with default seed values 0, 1, 2, 3, 4 — should all look distinct and presentable
2. Set complexity = 0 — should look clean / minimal
3. Set complexity = 1 — should look maximally detailed
4. Try extreme combinations (high density + low complexity) — should still produce sensible output
5. Random parameter values in an artist's hands — interview: "did you find what you wanted in 2 minutes?"

If artist takes 10+ minutes to find a "good" variation, the parameter set is too granular or wrong-axis.

---

## Update 2026-05-14 — Official docs deep-read additions

来自 12 轮 Houdini 21 官方文档精读。完整笔记:`houdini_vex_session_2026_05_14.md` + `houdini_synthesis_2026_05_14.md`。

### 参数形态 4 选 1(用错形态会让美术体验糟)

| 形态 | 用户可做 | 用什么 |
|---|---|---|
| 固定数量参数 | 改值 | 普通 float / int / vec |
| 用户可加减条目 | 增 / 删 / 改 | **Multiparm**(参数模板,实例数动态) |
| 控制连续函数 / 曲线 | 改曲线形状 | **Ramp**(color ramp / float ramp) |
| 离散选项(静态) | 选 | **Menu** + token list |
| 离散选项(运行时算) | 选 | **Menu** + script(可读场景 group 名 / 文件列表等) |

**反常识识别**:
- 美术想"添加任意多噪声层" → multiparm,不是固定 5 个 float
- 美术想"调整高度衰减曲线" → float ramp,不是 5 个 lerp 控制点
- 美术想"从场景 group 列表选" → script menu 运行时生成,不是手填 token list

### Multiparm 4 种 Block 类型(UI 形态)

- **List**: 实例顺序展示
- **Scrolling**: 可滚动列表
- **Tabs**: 每实例一个 tab
- **Switcher**: 切换器形态

⚠️ Tab 模式 gotcha:"moving or adding instances into a middle tab changes the tab names of later instances" — 自定义 label 要单独设。

### HDA 命名三段式 + Resolution 5 层(反直觉!)

完整名:`[namespace::]name[::version]`,namespace 和 version 都可选。Version **只能数字和点**(`2a` `alpha` 都非法)。

**Resolution 优先级 5 层(歧义引用时)**:
1. 高 version > 低 / 无 version
2. Scope 受限 > 全局
3. **无 namespace > 有 namespace(反直觉!)**
4. `HOUDINI_OPNAMESPACE_HIERARCHY` 环境变量左→右
5. 该变量支持通配 + 完全限定名做覆盖

**实操**:
- 你做 `acme::copy` 想替换内置 `copy` → 别人写 `copy` 仍然用内置(优先级 3)
- 强制覆盖内置 → 必须设 HOUDINI_OPNAMESPACE_HIERARCHY 把 `acme::*` 排前
- 团队/项目级配 .env 或 launcher 脚本统一设这个

### 子网 → HDA 之前必须把绝对引用改相对

```
绝对(会断):  ch('/obj/geo1/copy1/scale')
相对(正确):  ch('../copy1/scale')
```

HDA 内任何"指向节点的字符串"必须假设"我不知道我会被装在哪",一律相对。

### Spare param vs HDA 决策(清晰二选一)

```
你想给节点加可调参数?
├─ 仅这一个节点用一次 → spare parameter
│   └─ wrangle 内?
│      写 chi/chf/chv/chs("name") + 点 "Create Parameters" 一键生成
│
├─ 想做"统一接口的新节点类型"(所有实例都有这接口) → HDA(改 type definition)
│
└─ 已有参数,只是想让另一个引用它 → ch() expression / Paste Relative Reference
    └─ vec3 等多分量?
       会生成 3 个独立 ch() 表达式,改一个不影响其他 — 想整体重新链 3 个分量都得重 paste
```

文档原话:"Spare parameters only exist on a single node. If you want to create a new type of node that lets you create multiple nodes with the same customized user interface, you want a digital asset."

### 嵌入策略决策(给用户多少替换权)

```
模块库 / texture / 配置文件要分发?
├─ 自给自足分发,绝不让用户替换    → 嵌入到 HDA(opdef:.?file)
├─ 想让用户替换 / 项目级覆盖       → 暴露 string file 参数,默认值填 opdef:.?
└─ 完全外部                        → string file 参数指相对路径
```

### Channel reference 反常识

- "expression" 和 "channel reference" 本质相同 — 后者就是 `ch()` 的 sugar
- Houdini **自动更新引用 when 源节点改名** — 不会断
- 但删除源节点无 graceful fallback
- ⚠️ **多分量参数(vec3 等)引用 = 3 个独立表达式**,不是单个多值链
- "Delete channels" 断引用 — 把表达式删掉,变回静态/keyframe

### 双版本系统 — 团队规模决定选哪套

| 系统 | 哲学 | 选择 |
|---|---|---|
| Namespace-based(`mynode::2.0`) | 多版本共存,旧实例保持旧行为 | 小团队 / 单用户 / 快速迭代 |
| Version field + SyncNodeVersion 脚本 | 单版本,旧实例自动升级 | 生产工作室 / CI / 中央传播 |

文档警告:**两套系统都需要工作室级分发系统配合** — 光改 .hda 不会自动同步到其他用户,要 git/网盘/打包系统辅助。
