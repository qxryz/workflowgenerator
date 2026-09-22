> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Patterns: Loop Blocks, Pipeline Templates, Cross-Subnet Bus

## Loop block patterns (Houdini for-loop block_begin/block_end)

The 3 `method` modes correspond to 3 different algorithmic paradigms. Choosing the wrong one causes silent bugs.

### `feedback` mode = fixed-point iteration

```
state_{n+1} = T(state_n)         # T = single-step transformation
until state_{n+1} == state_n     # i@stop = 1
```

**When to use**: geometry mutates each iteration; next iteration must see the previous output.

**Examples in Lake House**:
- `merge_roof_shapes/repeat_begin1` — merges one pair of adjacent roofs per iteration until none left
- `stacked_boxes/repeat_begin1` — DLA accretion (each iteration adds one box)
- `roof_attribs/height_assign_loop` — relaxation until heights stable
- `closed_balc/repeat_begin1` — process one closed balcony per iteration

**Convergence requirement**: T must be **monotone** w.r.t. some well-founded order, otherwise infinite loop. Concrete: each iteration must either reduce a counter (e.g., "pairs left to merge") or set `i@stop=1`.

**Anti-pattern**: trying to do "all matches at once" inside one wrangle. Race conditions / inconsistent state.

### `piece` mode = data-parallel map

```
output = map(f, [piece_1, piece_2, ..., piece_N])
```

**When to use**: each piece is independently processed; no piece depends on another's output in this loop.

**Examples in Lake House**:
- `roof_attribs/in_out_attribs` — each prim computes its own incoming/outcoming
- `roof_attribs/width_attrib` — each prim computes its own width
- `roof_attribs/get_middle_line` — each prim finds its own midline
- `roof_extrusion/roof_merge_and_sides` — each prim independently extruded

**Note**: pieces are processed **sequentially in Houdini** (not truly parallel), but the algorithm doesn't depend on order. The sequential implementation just simplifies the merge step.

**`chi("primnum")` / `chi("iteration")`** inside a piece-mode wrangle = the current piece index.

### `count` mode = truncated iteration

```
for i in 1..N:
    state = T(state)       # no convergence check
return state
```

**When to use**: convergence not well-defined OR user wants explicit count control.

**Example in Lake House**:
- DLA outer loop "give me 30 boxes" — there's no natural saturation point that's both correct and predictable, so user picks N.

**Tradeoff vs feedback**: count fixes step count, output quality varies; feedback fixes output quality, step count varies.

### Decision matrix

| Question | Answer |
|----------|--------|
| Does each iteration depend on previous? | yes → feedback ; no → piece |
| Is there a natural "done" condition? | yes → feedback (with i@stop) ; no → count |
| Need to process N independent things? | piece |
| Need to converge to a fixed point? | feedback |

## The 5-stage procedural asset template

Any non-trivial procedural asset (building, ship, terrain, dungeon, plant) follows this 5-stage pipeline. Recognizing it lets you map any new project to a familiar shape immediately.

```
┌──────────────────────────────────────────────────────┐
│ Stage 1: Volume / shape generation                   │
│   Decide WHERE things can exist                      │
│   Methods: scatter+grid+filter / VDB / L-system /    │
│            cellular automata / Voronoi / handcrafted │
├──────────────────────────────────────────────────────┤
│ Stage 2: Volume merging → outer hull                 │
│   Produce a watertight envelope                      │
│   Methods: VDB boolean / convex hull / metaball      │
├──────────────────────────────────────────────────────┤
│ Stage 3: Semantic init                               │
│   Assign s@type to each face/point                   │
│   Method: classify by normal+pos+area+neighbours     │
│   ⭐ THIS IS THE KEY DESIGN DECISION FOR THE PROJECT │
├──────────────────────────────────────────────────────┤
│ Stage 4: Refinement + module dispatch                │
│   wall → wall/window/door  ;  s@name → .obj path     │
│   Methods: rand+probability+condition_bonus +        │
│            intersect/pcopen veto + copytopoints      │
├──────────────────────────────────────────────────────┤
│ Stage 5: Pattern + deformation                       │
│   Procedural surface details + global "naturalize"   │
│   Methods: divide+random offset + uv_prim +          │
│            lattice+mountain                          │
└──────────────────────────────────────────────────────┘
```

**Key insight**: stages 1 and 3 are where projects diverge. Stages 2, 4, 5 are mostly reusable across projects (the same VEX patterns work).

**The `s@type` dictionary in stage 3 is the asset's soul**:
- House: `{wall, roof, floor, support_full, support_partial}`
- Castle: `{wall, tower, gate, battlement, courtyard, keep}`
- Spaceship: `{hull, deck, engine_mount, antenna_mount, panel, vent}`
- Dungeon: `{floor, wall, door, treasure_zone, monster_zone, secret_wall}`

When applying this template to a new asset, **design the dictionary first**.

## Cross-subnet bus / service node pattern

In any non-trivial procedural project, some sub-networks become "services" — their output is consumed by 2+ other sub-networks via `object_merge`.

### How to identify service nodes

In `00_topology.txt`, grep for `object_merge` and read each `objpath1`:

```
grep -n object_merge 00_topology.txt   # find all object_merge calls
# look up each one's objpath1 in 02_all_node_key_params.txt
```

For each unique `objpath1` consumed by 2+ subnets → that's a service node.

Lake House has 5 service nodes:
- `tower/tower_check` — consumed by body_attribs and roof_modules/setdressing
- `stairs/stairs_pt` — consumed by 3 subnets
- `support/full_support` — consumed by 3 subnets
- `body_attribs` — consumed by stairs/walkway and support/fence
- `Create_body_base/closed_balc/building_footprint` — consumed by 5 subnets

### White-box vs black-box dependency

**White-box** (anti-pattern): `object_merge` points at an internal implementation node:
```
arch/object_merge1 → support/full_support/column/keep_touching_walls
                                                   ^^^^^^^^^^^^^^^^^
                                                   internal node — fragile
```

**Black-box** (correct): `object_merge` points at a public interface node (named `PUB_xxx` or in a `services/` namespace):
```
arch/object_merge1 → support/full_support/column/PUB_column_pts
                                                   ^^^^^^^^^^^^^
                                                   stable interface
```

### Refactoring: from white-box to black-box

For each white-box edge:

1. Inside the producer subnet, add a `null` node named `PUB_<purpose>` connected to the current internal node.
2. Update the consumer's `object_merge.objpath1` to point at the new `PUB_*` node.
3. Now the producer can refactor internals freely as long as `PUB_*` keeps producing the same shape.

**Metric**: count edges where `objpath1` ends in something other than `IN`, `OUT`, or `PUB_*`. Lake House: ~18 / 18 (all white-box). Refactor target: 0.

## Numerical robustness trinity

Three patterns that show up everywhere:

### Pattern 1: rint + fuse(0.001, distancesnap)

Every Lake House `make_grid` (which does `rint(@P/g)*g`) is followed by `fuse(tol3d=0.001, snaptype=distancesnap)`. Without fuse, downstream `pcopen / pointprims / neighbours` get duplicates / float-drift errors.

**Rule**: any wrangle modifying `@P` MUST be followed by `fuse(0.001, distancesnap)`.

### Pattern 2: rint(x*N)/N for stable hash keys

```c
float pos_y_quantized = rint(pos.y * 100) / 100;
float random_offset = fit(rand(seed + pos_y_quantized), 0, 1, -0.04, 0.04);
```

Without quantization, two "logically same" positions get different rand values due to 1e-15 float drift. Three flavors:
- `rint(x*10)/10` — for relbbox boundary tests (0.1 precision)
- `rint(x*100)/100` — for position-as-seed-key (0.01 precision)
- `abs(rint(v))` — for "is this axis-aligned?" tests on direction vectors

### Pattern 3: variable-length integer-segment tiling

```c
int n = (int)rint(dist / module_size);
float scale = (dist / n) / module_size;
// place n modules with scale_z = scale
```

Used everywhere modules are placed along a polyline (railings, roof tiles, stair steps). Avoids gaps and overlaps without modifying .obj files.

## Cross-wrangle attribute protocol

Distinguish two kinds of attributes living on the same prim/point:

- **Geometric**: `@P, @N, @Cd, @uv` — describe the geometry itself
- **Protocol**: `i@stop, i@keep, i@convert, i@raypoint, s@type` — inter-wrangle "event flags"

**Anti-pattern**: leaving protocol attributes alive past their consumer. Lake House never cleans them up → final geometry carries 30+ attributes, ~2/3 of which are dead protocol flags.

**Refactor**: at each subnet's output, insert `attribcleanup` to delete `_p_*` prefixed attributes (assuming you adopted the prefix convention).

## "Service-consumer" architectural mantra

Every procedural project has the shape:
```
Foundation layer (nobody depends on the consumers)
   ↓
Service layer (the building-blocks: footprint, semantic types, occupancy)
   ↓
Consumer layer (multiple subsystems consuming services)
   ↓
Output / final merge
```

When debugging "why does changing X break Y?", the answer is almost always: **X is silently a service of Y**, but its service status was never declared. Make it explicit.

## HDA-style multi-OUT subnet (named-port API surface)

When a subnet generates multiple downstream-consumed outputs (geometry + constraints + handrails + ropes + low-poly proxies …), expose each via a separately-named `null` node prefixed `OUT_`:

```
Rope_Bridge (subnet)
  ├── OUT_BRIDGE      — final assembled bridge
  ├── OUT_GEO         — pre-fracture geometry (for backup re-sim)
  ├── OUT_CON         — constraint network
  ├── OUT_HANDRAIL_CURVE
  ├── OUT_ROPE_HIGH
  ├── OUT_BBOX        — bbox-only proxy for placement
  └── OUT_BBOX_not_XForm
```

Rules:
1. **Every external consumer reads only `OUT_*` nulls** via object_merge — never internal nodes. The OUT_ nulls are the public API; internals are implementation.
2. **Naming carries semantics**: `OUT_BRIDGE` = the headline product; `OUT_BBOX` = lightweight proxy; `OUT_GEO` = pre-finalize state for re-use. A reader can scan the null names and immediately know what the subnet provides.
3. **`IN_*` mirrors on the input side**: `IN_BODY`, `IN_POINTS` for parameters supplied from outside (see 落于ivi 2401_30 spring rebound).
4. **The subnet is now refactor-safe**: as long as the OUT_ nulls produce the same shape, internals can be rewritten freely.

Anti-pattern: a single output port carrying merged geometry where downstream nodes have to `blast` to extract pieces — that throws away semantic info and forces every consumer to re-discover what's what.

This pattern is the Houdini-native equivalent of "exporting a public interface from a module." For any subnet that becomes 50+ nodes, it's mandatory.

## Solver-accumulation patterns (3 trapdoors)

Inside a `sopsolver` / `dopnet`, three patterns repeatedly bite people. Each has a stable fix.

### Trapdoor 1: `@Time%1` vs `@TimeInc`

```c
// WRONG inside an accumulating solver — modulo wraps at 1.0s, snaps state
angle = $PI/2 * @Time%1;

// RIGHT — TimeInc = 1/24s per frame, accumulates monotonically
angle = $PI/2 * @TimeInc;
```

Master VEX 162 (Rubik's cube) has the inline comment explaining this exact mistake. Rule: anywhere state must accumulate frame-to-frame (rotation, integration, growth), use `@TimeInc`, not `@Time%1`.

### Trapdoor 2: float drift accumulation → tolerance reset

After many iterations, rotated/translated positions drift away from "should be on the integer grid." Inject a tolerance-snap each cycle:

```c
// Inside a sopsolver, every cycle
if (abs(sum(@P*axis) - slice) <= 0.001) {
    @P = round_to_grid(@P);  // re-snap to integer position
}
```

This is the "rubber-band correction" pattern — accumulate freely, but pin to the nominal grid each cycle. Without it, 1000-step solvers drift visibly.

### Trapdoor 3: `Prev_Frame` vs `Current_Frame` in CA

Cellular automata read neighbours from the previous frame, write to current. Don't read from input 0 (current state being written) and write to it — race condition.

```
sopsolver inputs:
  [0] = current state (write target)
  [1] = Prev_Frame (read source)        ← always read neighbours from here
```

Master VEX 121 wires Prev_Frame explicitly through `dop_geometry`. If you ever see `point(0, "alive", neighbour)` inside a CA, it's wrong — should be `point(1, ...)`.

## When VEX, when VOP, when CHOP

Three different evaluation contexts, three different sweet spots. Naming the right one for each task is half the architect's job.

| Need | Best tool | Why |
|------|----------|-----|
| Sequence of attribute math, conditional logic, addpoint/addprim | **VEX wrangle** | Concise, type-safe, readable; ifs and loops are first-class |
| Compose multiple noises, displace along normal, complex VOP recipes (curlnoise, displacenml, anti-aliased noise) | **VOP** (attribvop / volumevop) | Pre-built nodes for noise handling; visual debugging via render flags; easier to fiddle iteratively |
| Smooth/damp/spring an animation channel over time without DOP | **CHOPnet** with `spring` / `lag` / `filter` | Cheaper than DOP; integrates with parameter channels directly |
| Per-frame rigid-body / cloth / particles | **DOPnet** | Only context with proper time integration |

Concrete examples from 落于ivi 合集:
- 2401_15 (stained glass): VOP — recolor + displace via VOP graph; no per-element conditionals needed
- 2401_16 (curve→noise→particles): VOP for the velocity field (`cross(curlnoise, tangent)`); VEX would be 5 lines but VOP makes the noise tweaks visual
- 2401_30 (spring rebound): CHOP `spring1` damps the body's animated channels; VEX/DOP would be overkill for "make it bounce on stop"
- 2401_22 (rope bridge): VEX everywhere — addpoint/addprim primitive construction needs imperative loops

**Architect rule**: when a VEX wrangle has more than 3 noise functions composited, switch to VOP. When VOP has more than 5 if-branches, switch to VEX. They are dual; pick the one with the lower friction for the job.

## Auxiliary-geometry-as-parameters

`create_tensors` in 落于ivi 2401_22 reads four bbox corner points from input 2 to seed four anchor lines. The bbox geometry is **the parameter source** for the wrangle — cleaner than 12 hard-coded `chf` sliders for x,y,z of each corner.

```c
// Detail wrangle — input 2 is a 4-point bbox proxy
vector pos = point(1, 'P', 0);      // anchor target 0
vector posbbx = point(2, 'P', 0);   // bbox corner 0

int pt1 = addpoint(0, pos);
int pt2 = addpoint(0, set(posbbx.x, posbbx.y, posbbx.z - chf('dist')));
addprim(0, 'polyline', pt2, pt1);
// ... repeat for corners 1,2,3
```

Generalization: when a wrangle needs N positional parameters, ask "could these be points on a small auxiliary geometry instead?" Benefits:
- The auxiliary geo is interactively transformable in viewport (vs. tweaking sliders blind)
- N corner points = 1 input wire, vs. 3N sliders
- The auxiliary geo can itself be procedural (driven by yet another node) → composable

This is how procedural assets *should* expose layout: gizmo-like control geometry, not parameter spam.

## Color-as-group token in solver (verified 4 projects)

Vellum / Bullet / FLIP solvers can't directly modify constraint groups mid-sim — the solver assumes constant group membership. Solution: **use color attribute as a group token**, then convert color → group inside the solver per-frame.

```
Inside sopsolver / multisolver / inside vellumsolver forces:
  dop_geometry → color (current color)
                    ↓
  external object_merge → groupcopy → recolor → output
                    ↓
  Solver reads → group recomputed every frame from color
```

Verified in:
- 0017 cloth pin release (vellum dynamic pin)
- 0540 RBD lesson template (constraint coloring per piece type)
- 0322 vellum biscuit tear (`group basegroup="@Cd.r>0.5"` for pingroup)
- 0497 ground explosion (color carries force region info)

**Why color**: it's a built-in attribute every solver respects without special config. `attribtransfer` of color is fast. Threshold expressions on `@Cd.r>0.5` work in groupcreate.

**Architectural implication**: when you need "dynamic group inside sim", reach for color + groupcreate expression first, before considering custom attribute / sopsolver hack.

## Per-frame active group accumulation via sopsolver (verified 4 projects)

Pattern for "things gradually transition state" — release / activate / dissolve / infect / spread:

```
sopsolver (outer or inner):
  Read Prev_Frame state (which points/prims are already "active")
  Per frame:
    Find new candidates (nearpoints, intersect, threshold, etc)
    Mark them with @active = 1 OR add to "active_grp"
    Output: union of (old active + new active)
```

Verified in:
- 0454 anim→dynamic (BFS via nearpoints + setpointgroup)
- 0488 drying crack (per-island staggered timing)
- 0628 RBD→FLIP (接触侦测 via solver1)
- 0017 cloth pin release (color accumulation)

**Critical property**: monotonic state — once active, never reverts (single-direction transition). For bidirectional you need full FSM.

**Cost**: O(K^t) until saturate (K = neighbors found per iteration). Typically 5-10 frames to cover N=10K mesh.

## Per-element staggered timing formula family (verified 4 projects)

A family of formulas for "ID-driven temporal sequencing" — each element starts/completes animation at different time based on its ID.

Three variants seen:

```c
// Variant A: wavefront blending (0509 AB morph)
float myPt = float(@ptnum + 1) / @numpt;
float shift = fit(@Frame, start_frame, end_frame, 0, 1);
@blend = myPt - 1 + 2 * shift;          // mid value [0,1] = blending zone

// Variant B: staggered grow with offset (0526)
float t = clamp(@Time * speed - offset * @ptnum, 0, 1);
float morph = chramp("ramp", t);

// Variant C: per-island independent window (0488)
float start = rand(@island) * duration_min;
float end   = rand(@island) * duration_max + duration_max * 0.4;
float duration = fit(@Frame, start + frame_offset, end + frame_offset, 0, 1);

// Variant D: linear release by ID (0497, similar)
if (@id < @Frame * release_rate) i@active = 1;
```

All four implement "elements start/complete at different times, ordered by ID/index/spatial position". Mathematically equivalent but different control surfaces.

---

# Synthesis 135 Reflections — Paradigm Families (added 2026-05)

After 135 deep-read reflections from 落于ivi corpus (135/634 = 21.3%), the following paradigm families have been verified across multiple projects. Each entry: family name, paradigm count, representative project IDs, core insight.

## 14 Paradigm Families

### `intersect()` VEX 5 paradigm
- 0118 COP baker (xyzdist + primuv → texture)
- 0181 normal unify (self-ray check 朝向)
- 0207 camera silhouette (toNDC + intersect 双向)
- 0419 LIDAR (ray + plane projection)
- 0584 VOP collision (push out via xyzdist + primuv + intersect)
- **Insight**: `intersect()` 是 corpus 算法工程灵魂之一 — production-grade ray cast 通用工具

### `pcfind / pcfilter / pcopen` 邻域分析
- 0150 hyphae (pcfilter('P') → isolation vector)
- 0151 cone tracking (pcfilter('Cd') → 颜色 gradient)
- 0612 proximity graph (pcfind + addprim)
- 0494 enablesolver (pcopen + pcfilter drive RBD enable)
- 0613 VOP color spread (pcfind + foreach + setattrib)
- **Insight**: pcfilter on arbitrary attribute = 任意 attribute 的局部 gradient 估计

### Gradient flow `P ± normalize(grad) * step`
- 0011 ascent (+) — density (mean shift)
- 0252 descent (-) — heightfield (河床)
- 0146 SDF push-out (+) — collision avoidance
- 0530 curlnoise + dihedral — surface flow
- 0341 SDF + chramp + P.y bulge
- **Insight**: 任意 scalar/vector field 上的 flow 通用模板

### Per-point staggered timing 6 paradigm
- 0488 per-island bbox start/end
- 0526 ptnum-offset staggered grow
- 0424 random startFrame + duration
- 0509 wavefront formula `id - 1 + 2*shift`
- 0527 ring rotate bias
- 0397 rand + P.y position-aware activate frame
- **API**: `fit(driver, start, end, 0, 1)` 通用

### Vellum 6 paradigm (production rig)
- 0019 Plateau (`f@restlength *= 0.1` shrink → minimal surface)
- 0124 spiderweb (`@mass = 0` pin)
- 0322 biscuit tear (glue_over_gap)
- 0518 pressure (`@restlength *= @falloff` in sopsolver, with nmin/nmax≈1 防爆炸)
- 0186 strut + noise gravity (inflated soft body)
- 0048 hair magnetic (vellumhair + connectadjacentpieces)
- **Insight**: vellum 是通用 spring system, restlength manipulation 是核心

### Lightning 5 paradigm
- 0169 solver-based ray-tree growth (动态)
- 0310 stochastic prune (distance-weighted culling, 远密近疏)
- 0421 chramp probability A→B (parametric)
- 0424 per-point time window + stochastic forking (production-grade 7 wrangle)
- 0164 curve + scatter + ray to plane

### Growth 5 paradigm
- 0510 sopsolver feedback (geometric)
- 0117 sopsolver scatter+addpoint (离散点 spawn)
- 0418 popreplicate (粒子自我分裂)
- 0150 pcfilter-driven (avoid crowding)
- 0339 differential growth (relax + resample + noise)

### RBD production rig 7 paradigm
- 0411 constraint type swap (`s@constraint_name + s@next_constraint_name`)
- 0454 Bullet attribute trinity (`@active + @deforming + @density`)
- 0533 rbdbulletsolver SOP wrapper showcase (11 incremental)
- 0496 rbdmaterialfracture chain (production fracture)
- 0140 Bullet Soft animation (bulletsoftconrel)
- 0027 hardconrel (hard constraint, deformable but 不碎)
- 0540 compile_blocks in sopsolver + 渐进 remove constraints

### Bullet constraint 4 type
- Glue (default)
- Soft (bulletsoftconrel) — 0140
- Hard (hardconrel) — 0027
- Constraint type swap — 0411

### Fracture 5 paradigm
- voronoifracture (random seed)
- clusterpoints + voronoifracture (规整 cluster, 0319)
- rbdmaterialfracture (智能 material-based, 0496)
- connectivity + foreach piece (可控 crack, 0488)
- glue_over_gap (vellum 拉丝, 0322)

### Distance-driven mesh modification 6 paradigm
- 0098 distancealonggeometry + softpeak
- 0146 SDF push-out
- 0252 gradient descent on heightfield
- 0264 distancefromgeometry + polybevel (9 节点 0 wrangle 极简)
- 0341 SDF + chramp + P.y bulge
- 0479 distance mask + bend

### Pyro coupling 6 paradigm
- 0127 火把 (popadvectbyvolumes 火星)
- 0405 水墨 (Pyro density → POP)
- 0489 自定义 vdb v field → POP
- 0383 Pyro custom microsolver (gasdisturb + gasfieldvop + gasopencl)
- 0494 焦糖 (combined RBD + POP + Pyro)
- 0492 expand+contract (attribadjustvector v 反转)

### Trail / particle visualization 6 paradigm
- 0345 sopsolver trail with shrink (`pscale *= 0.93` 指数衰减)
- 0527 trail SOP + chramp(curveu) width
- 0626 curlnoise + trail + sweep
- 0634 portal (chramp(@age) width)
- 0086 multilayer particle (lerp + chramp(@nage))
- 0153 CHOP jiggle on dynamic

### Attribute driver 6 paradigm
- @curveu (line position): 0421/0162/0485/0625
- @age (POP particle age): 0634/0345/0489
- @id (particle ID): 0506/0148
- @primnum (alternating): 0527/0258
- @ptnum (offset stagger): 0526
- @P.y (height-aware): 0397

## 10 真算法工程 (corpus 灵魂集合, ~1.6%)

These are projects where a single VEX/VOP encodes a real mathematical algorithm. They're the highest-value learning targets.

| # | ID | Algorithm | Core idiom |
|---|---|---|---|
| 1 | 0011 | Density gradient ascent (mean shift) | `volumesamplev → if length2>eps normalize else fix → P += grad * α` |
| 2 | 0007 | Strain field via area before/after | `measure(area) → bend → measure(area2) → combine` |
| 3 | 0019 | Plateau / minimal surface via vellum | `f@restlength *= 0.1` (one line = soap film) |
| 4 | 0003 | Eikonal on graph + edgetransport | path search + edge propagation |
| 5 | 0510 | Reaction-diffusion fixed-point | sopsolver feedback to convergence |
| 6 | 0150 | DLA-variant hyphae growth | `pcfilter('P') → isolation vector + dual-condition probability gate` |
| 7 | 0181 | Self-ray-intersection normal unify | `intersect(0, P + N*1e-3, N*1e5, ...)` 双 method (ray vs measure volume signed) |
| 8 | 0207 | Camera projection silhouette | `toNDC + fromNDC + intersect 双向 ray cast` |
| 9 | 0252 | Gradient descent on heightfield | `volumegradient + P -= grad * step` (河床) |
| 10 | 0070 | Distributed conflict resolution / Tabu | two-phase commit: 双方各表 target → 检查相互同意才行动 |

## 11 Production HDA 标志 (across all production rigs)

1. semantic naming (e.g. `flatten_back_wall`, `move_row`, `path_and_name`, `ignore_top_bottom`)
2. `detail(1, "iteration", 0)` from foreach meta — per-row/per-brick seed
3. `Cd = relbbox(@P).y` carrier (debug + drive scalar via Cd channel)
4. `setpointgroup(0, 'ignore', boundary_pt, 1)` — 显式标记 ignore 边界 (避免下游崩)
5. VDB smoothing layer at end (vdbfrompolygons → vdbsmooth → convertvdb)
6. Multi-LOD output (low_poly + high_poly via switch)
7. `s@name + s@path` for FBX export
8. `switchif` expression-driven input switching (HDA standard)
9. `Controller null + parm expression [param, default]` (pre-HDA controller pattern)
10. `$OS` group naming (HScript variable auto = node name)
11. `partition + name + foreach piece` 三件套 (per-element 独立处理)

## Batch 34 additions (sim attribute modification + paradigms)

### Sim 内 attribute 修改 4 paradigm (consolidated)
- **sopsolver inside DOP** (0497, 0511, 0613, 0494, 0533, 0540) — 15+ 项目主流
- **geometrywrangle in DOP** (0143) — DOP-level wrangle 直接修改 sim attribute (vs SOP attribwrangle)
- **enablesolver (DOP)** (0494, 0143) — 条件激活 RBD piece
- **attribvop in sopsolver** (0034, 0533, 0540) — VOP 节点式

→ 选哪个: 简单 wrangle → geometrywrangle, 复杂逻辑 → sopsolver inside DOP, 可视化 → attribvop, 条件激活 → enablesolver

### sopsolver inside POP (rare)
- 0511 abstract spline: popnet 内 sopsolver1 跑 ray + resample + smooth → particle 强制贴 Base mesh 表面
- 跟 0530 (curlnoise + dihedral surface flow) 同 paradigm 不同实现:
  - 0530: noise 转 tangent space (smooth)
  - 0511: ray reproject (强制 snap, 简单精确)

### Pyro burst paradigm (corpus < 5)
- `pyroburstsource` (0420) = Pyro burst (vs `pyrosource` persistent), 短促一帧 emit
- 适合 explosion / blast / impact

### 复用 sim transform paradigm (production performance)
- `extracttransform` (0594) — 从 packed prim 提取 transform matrix
- 应用: 只 sim 一份 mesh, 复用 transform 给其他 mesh (e.g. concrete 碎块 → 钢筋跟随)
- 跟 `pointdeform` (0140) / `attribinterpolate` (0258) 同 paradigm — sim → SOP transfer 复用

## Batch 35 additions (more paradigms)

### v field generation paradigms
- **`volumevop + aaflownoise`** (0334) = procedural v field 标准 (corpus 极简 7 节点)
- **`vdbfromparticles + popadvectbyvolumes`** (0489) = particle-based v field
- **`pyroburstsource → volumevop pcfilter`** (0420) = explosion-driven v field
- **`curlnoise + dihedral`** (0530) = surface tangent v field
- → **4 paradigms** for custom v field generation

### v field debug
- `volumetrail` SOP — sample v field, output trail polylines (corpus < 5: 0334/0420)
- 跟 visualize 节点配合 = production v field debug 标准

### Cloth tear paradigm 4 类
- vellum + edgefracture + drawcurve (0042) — interactive user-drawn tear line
- glue_over_gap (0322) — vellum biscuit
- vellumconstraints break threshold — force-driven tear
- vellum + popforce — explicit force tear

### Vellum sim cleanup chain
- `vellumio + vellumpostprocess` (× 多, 0042/0387) = vellum sim 标准收尾
- production: vellumio 转 SOP → vellumpostprocess 平滑 / 最终化

### Single-nearest-point pattern
- `nearpoint(input, P)` = 单一最近点 (vs `nearpoints(input, P, radius, max)` 数组)
- 用法: `int nearpt = nearpoint(1, @P); vector pos = point(1, 'P', nearpt);`
- 适合 distance-based culling (跟 0310 同 paradigm)

### Edge-based fracture (vs cell-based)
- `edgefracture` (0042) = 沿用户绘 curve fracture mesh edges (vs voronoifracture 沿 seed cells)
- `edgegroup_to_curve` (labs) = edge group → polyline curve (corpus < 5)

### Matrix ↔ quaternion VOP
- `vectomatx` (3 vector → matrix3) → `matxtoquat` → quaternion
- 4 paradigm 创建 quaternion (consolidated): matrix / axis-angle / euler / vectomatx+matxtoquat

## Batch 36 additions

### Multi-layer sim paradigm (production VFX 标准)
- **双层 sim + pointdeform sync**: 主 sim 大尺度 + 二级 sim 细节, pointdeform 把主 sim 变形 transfer 给二级 sim 输入
- 工程: 0131 (鱼游动 + 摆尾), 0044 (chain proxy), 0594 (concrete → 钢筋), 0140 (Bullet Soft animation pointdeform)
- corpus 中 ~5-10 项目 — 复杂动画必备
- → 4 paradigm 累计 multi-layer / proxy sim

### Stochastic Cd boost = wave-like spread (vs explicit neighbours)
- `if (@Cd > 0.1 * rand(@ptnum + @Frame)) @Cd = 1` (0395)
- 在 sopsolver 内每帧跑 → Cd 渐进 wave-like 扩展
- vs explicit `pcfind/neighbours + spread` (0613/0150) 更简洁
- `@Alpha = @Cd.r * factor` = Cd → Alpha 标准

### Attribute spread paradigm (5 累计)
- 0017 color-as-group token in solver (color 当 mask carrier)
- 0292 FLIP 混色 attribtransfer self → self
- 0613 VOP color spread pcfind + setattrib
- 0395 stochastic Cd boost (这次新增)
- 0614 带衰减 attribute 扩散

### Radial vector idiom (4+ projects)
- `vector pos = point(1, 'P', 0); v@N = normalize(@P - pos);` — point P 到 reference center 的归一化方向
- 工程: 0633 (碎块自身偏移), 0086 (multilayer particle), 0297 (草堆), 0086 (multilayer)

### KineFX 用于非角色 procedural modeling (创新用法 corpus < 5)
- `kinefx::rigdoctor` + `kinefx::rigattribwrangle` 不只用于角色绑定
- 也能用于 grass / hair / 任意层级 deformation
- 工程: 0297 (草堆)

### 沿曲线流动 paradigm (5+ accumulated)
- `up * sin + out * cos` (0162 helix wrangle)
- `spiral` SOP + `popcurveforce` (0298 节点式)
- `chramp(@curveu) + curve attribute drive` (0485)
- `编织 alternating` (0625)
- `popcurveforce` 单独 (0309)

## Batch 37 additions

### Multi-layer noise stacking (5+ paradigms)
- 0007 (褶皱 4 mountain stack)
- 0091 (volume sculpting 3 noise modes)
- 0139 (4+ noise layer in 1 VOP — corpus 极致)
- 0310 (plasma ball mountain1+mountain2)
- 0494 (caramel pointvop6 turbnoise)

### `unifiednoise_static` (production noise standard)
- VOP 节点, 多 type 选 (perlin/simplex/sparse-convolution/worley)
- `_static` 版不依赖时间 (vs `unifiednoise` 含 time)
- corpus ~10-15 项目 — 比 turbnoise 更 production-friendly

### Vellum 流体 paradigm
- `vellumconstraints_grain` = vellum 流体/沙 constraint (~10 项目)
- `vellumpack + vellumunpack` = vellum cache 友好封装
- vellum 流体 vs FLIP 选: quick prototype + 流体感 → vellum, 真水/精确 → FLIP

### 复合 v 计算 paradigm (production v field)
- `v = (direction + outwards) * random * distance_falloff` (0392 推力)
- `subtract(P, ref) → mix(noise) → multiply` (0633 自身偏移)
- `N = P - reference + curlnoise` (0086 multilayer)
- `N = P - center` 径向 (0297 草堆)

→ 4+ paradigm 复合 v — production VFX 必备

### `fluidsource` SOP (vs pyrosource)
- `fluidsource` = 通用 fluid (Pyro/FLIP) source
- `pyrosource` = only Pyro
- production: complex Pyro/FLIP coupling 选 fluidsource

### 3-input mix VOP (3-way mesh blend)
- `importpoint × 3 + mix VOP` (0398) = 3-way blend
- vs 2-way mix (0157 粒子 morph)
- 适合 user 在多 mesh 间渐变选

### `@opinput<N>_<attr>` shorthand
- `@opinput1_P` = `point(1, 'P', @ptnum)` 简写
- 内置 attr 自动 typed; user attr 默认 float
- 跟 memory rule 30 同源

## Batch 38 additions

### UV ↔ 3D bidirectional bridge (corpus < 5)
- **3D → UV**: `@P = @uv` 或 `@P = set(uv.x, 0, uv.y)` (0118/0119/0419)
- **UV → 3D**: `uvsample(input, attr, uv_attr, uv_coord)` → 在 mesh UV 处取 attribute (0119)
- 相对的 trick: `xyzdist + primuv` (3D → UV → attribute)
- `uvsample` 反向用法 corpus 罕见但 surface flow / texture mapping 关键

### `frac()` 循环动画 trick
- `frac(u - Time * speed)` = 沿时间循环 (corpus < 5)
- u 减时间 → frac 取 [0, 1] → 周期性 wave
- 0119 用 (UV-driven flow), 跟 chramp 时间 driver 不同 paradigm (chramp 一次性, frac 永久循环)

### Production HDA 特征 (8+ corpus 灵魂工程累计)
- 0021 Bridge A (250+ rope bridge)
- 0287 Bottle HDA (240)
- 0494 Caramel (230+ multi-stage)
- 0540 RBD pipeline 09 (200+ compile_blocks)
- 0203 (Lamp HDA Blender export, 250+)
- 0383 smoke grenade (370+)
- 0466 audio splash (复杂)
- 0282 rope wrap (270+)

→ **production HDA 识别**: 100+ 节点 + multi-output + multi-LOD + semantic naming + FBX/USD export ready

### FBX/USD export production naming
- `@fbx_translation` removal (0203) — FBX import auto-attribute, 导出时减去
- `s@name + s@path` (0189 brick wall) — game-ready FBX export
- 跟 multi-LOD switch 同 production game pipeline

### Distance/proximity activation paradigm (7+ accumulated)
- 0454 BFS via nearpoints (animated_to_dynamic)
- 0034 RBD VOP active (position + velocity)
- 0312 popwrangle proximity release
- 0497 sopsolver attribtransfer 速度激活
- 0628 RBD active gate (`P.y < threshold`)
- 0258 attribinterpolate stable scatter
- 0044 proxy + scatter + attribinterpolate

→ Master 应熟悉 7 paradigm 选合适场景

## Batch 39 additions

### Color → Group automation
- `sprintf("rgb_%f_%f_%f", v@Cd.x, v@Cd.y, v@Cd.z)` = vector → unique string identifier
- `groupsfromname` SOP = 按 string attribute 自动多 group (跟 partition+name+foreach piece 同 paradigm)
- corpus 5+ paradigm group 自动化: 0017 / 0319 / 0263 / 0050 / 0021

### `ramps::2.0` (production ramp library)
- VOP 节点: built-in 多 ramp type (linear / smooth / step / hermite / etc)
- vs `rampparm` 单 chramp
- corpus ~10 项目 — production ramp standard

### 极简 4-15 node teaching projects
- 0146 SDF push-out (16 node)
- 0264 distance polybevel (9 node)
- 0339 differential growth (9 node)
- 0291 VOP turbnoise (4 node)
- 0379 shockwave (4 node)
- 0334 aaflownoise volumetrail (7 node)

→ Master 应能 4-15 node 完成 procedural concept proof

### 极坐标 / 参数化几何 5+ paradigm
- 0254 gear (`atan + sin(u * sides)`)
- 0162 helix (`up * sin(curveu*freq) + out * cos(curveu*freq)`)
- 0354 (p, q)-torus knot (`(R + r*cos(q*t)) * cos(p*t)`)
- 0625 编织 alternating
- 0625 polar swizzle

### Shockwave wave equation pattern
```c
vector center = ch_center;
vector dir = normalize(@P - center);
float dist = distance(@P, center);
float wave = abs(parm / dist - 1);  // 距离-时间 wave
float falloff = pow(fit(1/wave), exp);
@P += dir * falloff * turbnoise(@P);
```
- corpus 4+ shockwave projects: 0379 / 0473 / 0497 / 0086

### `labs::superformula_shapes`
- Superformula procedural (Gielis 2003)
- 一通用 formula 描述自然界形状 (花瓣 / 海星 / 雪花)
- m / n1 / n2 / n3 / a / b 参数
- corpus < 5

### User HDA prefix (`agz::torusknot`)
- Custom HDA naming with author prefix (vs labs::, sidefx::)
- 跟 0354 agz::torusknot, 0287 Bottle HDA pattern 同源 — production HDA naming convention

## Batch 40 additions

### Mesh blending paradigm (6+ accumulated)
- 0157 粒子 morph (`mix(P, target, fit(distance))`)
- 0398 3-way mix VOP (`importpoint × 3 + mix`)
- 0086 multilayer particle (`lerp + chramp(@nage)`)
- 0288 (`lerp(P, target_P, mask * blend)` mask-driven)
- 0001 reference blend with mask
- 0494 caramel pointvop3 morph blend

→ corpus mesh blending **万能模板** = `lerp/mix(P, target, factor)`
→ factor 来自: distance / age / mask / time / curveu

### Mask 平滑标准链
- attribtransfer + attribcopy + attribblur (跟 0091 group→wrangle→attribblur 同源)
- production: discrete mask → continuous mask (distance/group/Cd → smooth gradient)

### Sim 内 dynamic constraint 修改 (3 paradigm 累计)
- **vellumconstraintproperty in DOP** (0331) — 动态调 vellum constraint sim 内
- **`@restlength *= @falloff` in sopsolver** (0518) — SOP-side 修改
- **pointdeform sync** (0140) — sim → SOP transfer

### Dual-LOD voronoifracture (production performance)
- Low for sim (快), High for render (细节)
- attribtransfer between them (跟 0021 / 0189 multi-LOD 同源)
- 0388 加 dual-LOD edge displacement variant

### `labs::rbd_edge_strip` (corpus < 5)
- RBD pieces → edge stripe geometry (碎块接缝快速 stripe)
- vs 0042 cloth tear edgegroup_to_curve (cloth-based)
- production-friendly RBD edge processing

### `switch_FAST` toggle pattern
- Switch with "fast" / "slow" 输入 — production user 选 quality/speed
- 跟 0270 contour fast/slow / 0287 Bottle HDA switchif 同源

**Sort SOP determines order direction**: sort by Y → wavefront from low-Y to high-Y. Sort by distance from center → radial expansion.

**When to use each**：
- A (wavefront): smooth two-state morph
- B (staggered grow): single-direction grow with curve
- C (per-island): heterogeneous timing per discrete piece
- D (linear ID release): simple sequential release for RBD activation

## Reference-blend pattern with mask (verified 5 projects)

The most common attribute-driven deformation idiom in 落于ivi corpus:

```c
// Generic form
@P = lerp(@P, point(1, "P", @ptnum), mask);
```

Or with VOP:
```
mix(geometryvopglobal_P, importpoint_P, mask)
```

Variants:
- mask from distance: `fit(length(@P), inner, outer, 0, 1)` (0001)
- mask from chramp on age: `chramp("blend", @nage)` (0180)
- mask from group + condition: `inpointgroup(...) ? 1 : 0` (0454)
- mask via attribute named `@blend`, `@mask_noise`, `@bias`, etc.

**Critical assumption**: input 0 and input 1 must have **matching point order** (`@ptnum` must align). Use `attribtransfer` or `pointdeform` if inputs have different topology.

**Use cases**:
- Visual blend (0001 polar wave)
- Animation morph (0467 vellumrestblend writes to vellum rest pose)
- POP source correction (0180 attribvop fixes gap)
- Anim→sim handoff (0454 deformation reflects to active group)
- Geometry→FLIP source bridge (0628)

This is **the** mask-driven deformation template across the corpus.

## Timeshift to lock reference frame (verified 3 projects)

**Pattern**: `geometry → timeshift (frame=1) → projection/scatter/reference`. Locks downstream operations to a specific reference frame.

Use cases verified:
- **0001 polar wave**: `blast4 → timeshift1 → uvproject1` — UV projected on rest pose so texture doesn't swim during deformation
- **0322 vellum biscuit**: `timeshift_frame1_lock` for `pointdeform` reference — sim reflects to original mesh topology
- **0628 RBD→FLIP**: `timeshift1` on dopimport for stable rest pose reference

**Why frame 1 specifically**: that's the rest pose / pre-deformation state. Some projects use `$F-1` for previous frame ref.

This is **production wisdom** — animated assets without timeshift'd UV / reference shows visible texture swimming or topology drift. Demo authors typically miss this.

## Expression-based group membership (verified 3 projects)

Instead of hand-painting groups, use `groupcreate` with `basegroup = "<expression>"`:

```
groupcreate:
  basegroup = "@Cd.r>0.5"        # color threshold
  basegroup = "@P.y>2.0"          # position threshold
  basegroup = "@class==2"         # class match
  basegroup = "@mask>0"           # mask non-zero
  boundtype = usebsphere          # combined with bbox
```

Verified in 0540, 0322, 0628. Plus 0497 uses `boundtype = usebsphere` (3D sphere bounds for spatial group).

**Why expression**: declarative + auto-updates when upstream attribute changes. Manual paint groups need re-paint when source changes.

## Sopsolver attribtransfer from external null (verified 2 projects)

Cross-subnet bus pattern for sim:

```
Inside sopsolver in dopnet:
  dop_geometry  ← current sim state
  object_merge  ← /obj/.../external_null  (carries new attributes)
  attribtransfer (dop_geometry, object_merge) → output
```

Verified in 0497 ground explosion (transfers @v from "force" null), 0628 RBD→FLIP (transfers attributes for state).

**Why**: lets external SOP processing inject attributes into sim each frame without rebuilding sim. The external null is a "mailbox" the sim polls.

**Architectural significance**: sim is no longer black box — its inputs are continuously updatable from outside. Production patterns where users tweak parameters that need to influence already-running sim use this.

## Fit non-[0,1] mapping to prevent zero-jump (verified 2 projects)

Subtle but important fit pattern:

```c
// ❌ Risky: starts at exactly 0
fit(@age, 0, max_age, 0, 1)

// ✅ Safer: starts at 0.3 (non-zero base)
fit(@age, 0, max_age, 0.3, 1)
```

When the fit output drives `chramp` or `lerp`, starting at exactly 0 causes "zero-state moment" (ramp returns chramp[0] which often is 0 or default → discontinuity).

Starting at 0.3 means even at t=0, output is at 30% of ramp → smooth start.

Verified in 0519 viscosity (`fit(@age, 0, 2, 0.3, 1)`), 0467 vellumrestblend.

Combine with `+ chf("offset")` floor (e.g. `chramp(...) + 0.1`) for additional safety.

## Nested foreach piece (verified 2 projects)

Two-level foreach:
```
foreach_begin1 (piece, by outer connectivity)
  foreach_begin2 (piece, by inner connectivity)
    Per-inner-piece processing
  foreach_end2 (merge, pieces)
foreach_end1 (merge, pieces)
```

Verified in 0488 drying crack (大块→小块), 0322 vellum biscuit (cluster→sub-piece).

**Multiplicative cost**: N_outer × N_inner × body_cost. Innocuous body becomes expensive when both N's grow.

**No cross-piece communication**: inner pieces are processed independently per outer piece. If you need cross-talk, precompute detail attribs before outer foreach.

**Use cases**: hierarchical processing — large fragments containing small fragments, clusters with sub-clusters, regions with sub-regions.

## Incremental refinement showcase layout (corpus signature, NOT production)

**This is落于ivi 's signature pedagogical pattern, not a production architecture.**

Multiple parallel `solver / popnet / subnet` instances in one project, each testing a different parameter / variant:

Verified in 8+ projects: 0017 (7 vellumsolver), 0049 (6 popnet), 0188 (multi findshortestpath), 0277 (4 book subnet), 0510 (multi solver), 0540 (7 rbdbulletsolver), 0519 (4 dopnet), 0013 (3 popnet), 0180 (8 popnet).

**Mental model when reading**: "1 solver + N alternative versions" — only one is the final output, others are educational refinement steps the author kept for clarity.

**Production audit**: replace N parallel solvers with 1 solver + switch SOP, delete alternatives. Or wrap as HDA with version parameter.

**Why falling-on-ivi keeps them**: pedagogical — viewer can see "if I use this version vs that, here's the visual difference". Production rigs don't do this.

When you see N parallel solvers in any 落于ivi project, **don't assume complexity** — assume incremental refinement. Read just one to understand intent.

## Spatial-control-gizmo pattern (transformable boxes as art handles)

Generalization of "auxiliary geometry as parameters" — when artists need to control **where** an effect happens (not just amount), expose **physically draggable proxy geometry** in the viewport, then read its position via `distancefromgeometry` or `xyzdist`.

落于ivi 2401_01 polar water wave is the canonical example:
- `box1` + `transform1/2/3` = 3 separate control gizmos (artist drags in viewport)
- `enumerate → distancefromgeometry1 (input1=transform1) → distancefromgeometry2 (input1=transform2) → distancefromgeometry3 (input1=transform3)` = chained distance field accumulation
- Combined distance signal drives downstream blending mask
- Result: artist drags box → wave appears around that location, real-time

Architectural significance:
1. **Spatial control without UI design** — artist uses Houdini's existing transform handles in 3D viewport, no custom panel needed
2. **Multiple control points are trivially additive** — chain another `distancefromgeometry`, done. No code changes.
3. **The number of controls is a parameter** — replace `transform1/2/3` with a `copytopoints` of N templates, you have N gizmos
4. **Reads as data flow** — distance field IS the control signal, not a hidden ch()

When to use: any effect where "where" is more important than "how much" — wave sources, magnetic poles, attention attractors, gravity wells, brush strokes.

When NOT to use: when the control needs to be a curve (use a `curve` SOP instead), an area (use volume), or a parameter sweep (use channel).

## Connectivity-driven map-reduce (foreach piece pattern)

When you have multiple disconnected geometry components and want to process each independently, the canonical structure is:

```
upstream_geom
  → connectivity                    ← classifies pieces with @class
  → foreach_begin (method=piece)
      ↓
      [body — per-piece processing]
      ↓
  → foreach_end (method=merge, itermethod=pieces)
```

Critical recursive properties of this pattern:

1. **Loop count = number of connected components** — auto-adapts to input topology. Add a piece in upstream → loop runs one more time. **The piece count is NOT a parameter; it's emergent from the input.**

2. **`@ptnum` inside the loop is piece-local** — first point of each piece is `@ptnum=0`. Useful for "mark first point" tricks (like `blend_center_point` in 2401_01). Surprising for new readers — every new piece restarts ptnum at 0.

3. **No cross-piece communication inside the loop** — each piece is processed in isolation. If piece B needs to know about piece A, you must (a) precompute a `detail` attribute before the loop, or (b) collect data after the loop and feed it back.

4. **Cost multiplier is N_pieces × body_cost** — innocuous-looking body operations (revolve with 240 segments, fuse with tight tolerance) get multiplied by piece count. Profile per-piece cost first.

5. **Output topology is union of bodies' outputs** — `method=merge` with `itermethod=pieces` does the union. If body produces N_body points, output has N_pieces × N_body points (assuming no de-dup).

Use cases:
- **Surface of revolution**: per-piece curve → revolve each independently → multi-shell output
- **Per-cluster smoothing**: per-piece mesh → smooth each → preserve cluster boundaries
- **Per-shape voronoi**: per-piece bound → voronoi inside each → independent shatter patterns
- **Per-arm tree generation**: per-piece skeleton → grow leaves → don't cross-pollute arms

This is the Houdini-native equivalent of GPU `kernel<<<N_pieces, ...>>>` — embarrassingly parallel structure.

## Reference-frame UV locking (timeshift + uvproject)

Problem: animated geometry needs static-looking UV. If you `uvproject` per frame, UV slides as the geometry deforms — texture appears to swim across the surface (artifact).

Solution: lock UV to a single reference frame.

```
deformed_geom_per_frame
  → timeshift (frame=1 or static)   ← capture rest pose
  → uvproject                       ← project UV in rest pose
  → wrangle: v@uv = vertex(1, 'uv', @vtxnum)
                                    ← read UV from rest pose, paste onto current frame
```

Architectural significance:
- **Decouples UV from geometry deformation** — texture stays anchored to material, not to current vertex positions
- **Required for any animated character / cloth / wave with textures** — universally applicable production pattern
- **Subtle production trick** — only people who shipped animated assets know to do this; demo authors typically miss it

落于ivi 2401_01 uses this pattern (`blast4 → timeshift1 → uvproject1`). It's the kind of pattern that signals the author has production experience even when the rest of the project is demo-grade.

## Batch 41 additions

### 真算法工程 — 11 个 (新增 0257 1D 波动方程)

Corpus 灵魂集合现 11 个真算法工程 (自己手写 PDE/物理仿真, 不是 noise/SDF/projection):
- 0011 FLIP particles → fluid surface
- 0007 nature procedural growth
- 0019 vellum cloth tear
- 0003 Bullet RBD shatter
- 0510 grain solver
- 0150 pyro pressure solver
- 0181 pop wind / fluid integration
- 0207 erosion microsolver
- 0252 erode heightfield
- 0070 SDF morph/reaction-diffusion
- **0257 1D wave equation discrete** ← 新增

0257 是**最简 PDE 离散化范例**: solver 内手写 `∂²u/∂t² = v²·∂²u/∂x²`, 中央差分 + Verlet 2 步积分 + fixed endpoints. 学这个就能拓展到 2D/3D 波动 / 热方程 / reaction-diffusion. 跟 0252 (heightfield erode microsolver) 同 paradigm — 都是 finite difference solver inside solver SOP.

### Discrete PDE in Houdini solver SOP (universal idiom)

```
solver SOP
  → wrangle1 (compute time derivatives via finite differences)
      Accel = stencil(neighbors) * coefficient
      Speed += Accel * dt
  → wrangle2 (integrate position)
      P += Speed * dt
  → boundary handler
      if (boundary point) skip / clamp
```

这个 idiom 是 Houdini 物理仿真的**通用骨架** — 任何 PDE 都可以塞进去:
- 波动方程: `Accel = c² * ∇²u`
- 热方程: `Speed = α * ∇²u` (一阶时间)
- 反应扩散: `Speed_A = D_A * ∇²A + f(A,B); Speed_B = D_B * ∇²B + g(A,B)`
- Burgers/Navier-Stokes 简化: `Speed += -u·∇u·dt + ν·∇²u·dt`

Stencil 选择 (1D 中央差分 / 2D 5-point Laplacian / 3D 7-point) 是核心. Houdini 没有内置 PDE 节点, 所以这种**手写 finite-difference solver** 是 Master 级 procedural 必备.

### Ray-based projection (5+ paradigm 累计)

`ray` 节点 + `copytopoints` 是 production 投射 instance 的标准链:
- 0276 testgeometry → ray to grid → copytopoints tube (表面突起)
- 0388 RBD edges displaced → ray 回 sphere (transfer normal back)
- 0119 UV surface flow (uvsample 是同概念 — UV 域投射)
- 0203 lamp HDA scaffold projection
- 0407 rocky terrain ray to high mesh

Ray 是 Houdini SOP 投射的工具节点 (vs intersect VEX 函数 — 后者更灵活但需手写). Production 用 ray 节点的频率是手写 intersect 的 2-3 倍.

### 1D strand sim — 3 paradigm (新增 popgrains+sopsolver)

1D rope/strand/noodle 仿真在 Houdini 有 3 个 paradigm:
1. **vellum hair** (vellumhair constraint) — 0507/0017/many — 高精度, 性能中等
2. **vellum strut/wire** — 0099/0511 — 网状 1D 结构
3. **popgrains + sopsolver line constraint** ← **新增 0512** — 性能好, 精度低

popgrains 第二输入吃 sopsolver 输出的 line connectivity, grains 沿 line 互相约束. **DOP-internal sopsolver 是 production trick** — 在 DOP 里跑 SOP 节点 (object_merge feedback impacts → add+resample+convertline → output 给 popgrains). 这是 DOP+SOP 双向耦合的高阶用法, corpus < 10 个.

### Vellum pin to moving target (universal anim pattern)

```
animated_target → transform / animation
  ↓
vellumconstraints (anchor_geom = target)
  ↓
vellumsolver
```

任何 vellum sim 跟随动画的 idiom (cloth/hair/strut 都适用):
- 0017 cloth pin (color-as-group dynamic pin release)
- 0507 hair follow sphere
- 0331 橡皮筋缠绕 (vellumconstraintproperty 动态调)
- + many

`vellumconstraintproperty` (DOP 内部) = **runtime 调 vellum constraint**, 比 SOP 端 `pressure` (0518) 更细致.

## Batch 42 additions

### SOP→DOP force injection via sopsolver attribtransfer (universal 万能模板)

```
SOP side:
  build velocity / force / mass field as point attribute on SOP geo
  → null (entry point)

DOP side:
  rigidbodysolver / vellumsolver / popsolver
    → sopsolver1 (内嵌 SOP 子图)
        ├ dop_geometry (dopimport: 当前帧 DOP 几何)
        ├ object_merge1 (拉 SOP "force" 节点 — 注意每帧 cook)
        └ attribtransfer (force.v → DOP pieces.v, distance / nearest 模式)
        → OUT
```

**关键架构含义**:
- **任意 SOP-computed field 可注入 DOP** — 比 popforce / popwind 更灵活, 任何 noise/SDF/曲线/外部数据皆可
- **每帧重新拉 + transfer**: object_merge 在 sopsolver 内每个 substep cook, 所以 SOP-side field 可以是 time-dependent
- **跟 vellumconstraintproperty 不同**: 那个改 constraint property; attribtransfer 改 piece 的 v/N/Cd/任意属性
- 0497 用这个模板把 aaflownoise + length(P) 速度场注入 RBD pieces, 实现"逐渐激活"的炸裂效果
- 跟 0454 (BFS group propagation in sopsolver) / 0540 (sopsolver constraint mod) 同 sopsolver paradigm 但用途正交

### Compile blocks 4 In/Out 通道 (Houdini 18+ OpenCL 优化, production RBD 标志)

```
sopsolver inside DOP solver:
  attached_relationship_geometry (dopimport)
  → Constraints_In (compile_begin)  ← 拉 constraint geometry
  → [body: sort/delete/wrangle on constraints]
  → Constraints_Out (compile_end)

  dop_geometry (dopimport)
  → Geometry_In (compile_begin)  ← 拉 piece geometry
  → [body]
  → Geometry_Out (compile_end)

  feedbacks (dopimportrecords)
  → Feedbacks_In (compile_begin)  ← 拉 feedback records

  impacts (dopimportrecords)
  → Impacts_In (compile_begin)    ← 拉 impact records
```

**4 通道含义**:
- Constraints / Geometry — geometry-level
- Feedbacks / Impacts — record-level (event tracking)
- compile_begin/end 让子图 OpenCL 编译一次反复跑, sim 性能大幅提升

**production 标志**: 0540 用 11+ rbdbulletsolver 并列, 有的有 compile_blocks 有的没有 — author 在示范 "什么时候该 compile". Master 看这个就知道 author 是 production 出身, demo 不写。

### Array random selection without replacement (production VEX idiom)

```c
int keep = chi('Keep');
int items[] = expandpointgroup(0, 'source_group');  // 或 expandprimgroup, 或 array attrib

for (int i = 0; i < keep; i++) {
    int idx = int(fit01(rand(@ptnum, i), 0, len(items) - 1));
    setpointgroup(0, 'kept', items[idx], 1, 'set');  // 入组
    pop(items, idx);                                 // 移除避免重选
}
```

**关键技巧**:
- `pop(array, index)` 是不放回抽样的核心 — 比 `removeindex` 更短
- `setpointgroup` runtime 入组, 后续节点可以读 'kept' group
- `rand(@ptnum, i)` 双 seed 保证不同迭代独立随机
- 0144 用这个模板从端点中抽 K 个起点 → findshortestpath
- 这是 procedural selection 的通用 idiom — 跟 `expandprimgroup` (Master 0117) / `setpointgroup` (0263) 同源, corpus 多次出现

### VDB-based silhouette inside detection (universal 形态生成)

```
source_geometry (复杂模型, sphere 群, 文本, mesh)
  → vdbfrompolygons → vdbreshapesdf → vdbsmooth → convertvdb
                                                        ↓ (smooth volume)
plane / grid / target_surface
  → boolean (intersect or A-B)
                                                        ↓ (silhouette polygon)
  → triangulate2d → scatter (在 silhouette 内 emit)
```

**用途**:
- 模型轮廓投影 (0166 sphere 群 → silhouette)
- 体积切片 (任意 vdb 跟平面交)
- 复杂形态简化 (vdbsmooth 模糊掉细节, 只留主体形态)
- 跟 0244 image→mesh / 0204 image→wall / 0488 干裂起皮 vdb-smooth 同源

**vs labs::thicken**: thicken 是 line→tube, 这个是 vdb→polygon 投影. 配合用更强 (0166 用了两个).

### popvop pcfilter velocity field (flocking-like behavior)

```
popvop:
  geometryvopglobal (P)
  → pcopen (find neighbors radius=R, max_count=N)
  → pcfilter (avg neighbor velocity → smooth velocity field)
  → output v
```

**关键**:
- `pcopen + pcfilter` = 经典 PointCloud 邻居 query 链 (跟 0157 / 0511 / 0530 pcfilter 同源)
- 输出是邻居加权平均, 让粒子运动平滑跟随邻居 → flocking-like
- 跟 `aaflownoise` (0334/0497) 不同 — pcfilter 是 emergent 邻居行为, aaflownoise 是 procedural noise field

### Distancealonggeometry vs xyzdist (geodesic vs straight-line)

- **xyzdist(P, geo)**: 直线距离, 不管表面拓扑
- **distancealonggeometry**: 沿 mesh 表面计算 geodesic distance (Dijkstra-like)

production 应用:
- 0540 RBD lesson: distancealonggeometry → attribpromote → attribtransfer → blast 沿表面切片
- 0252 river gradient descent: 也是 geodesic 流向
- mesh 上 "从中心到边缘" 的 falloff 必须用 distancealonggeometry, 不是 xyzdist

### sopsolver 在 DOP 的 3 种用途 (正交)

1. **Force injection** — 拉 SOP field, attribtransfer 给 DOP pieces (0497)
2. **Constraint mod** — 拉 attached_relationship_geometry, sort/delete/wrangle 改 constraint (0540, 0533)
3. **Group propagation** — 拉 dop_geometry, BFS via nearpoints + setpointgroup (0454)

三种用途共用一个节点 (sopsolver), 但内部子图职责不同 — production 应用三种都见到, demo 只用 1 种.

## Batch 43 additions

### sopsolver 在 DOP 的 4 种正交用途 (新增第 4 种 — sim geometry mod)

1. **Force injection** — attribtransfer SOP field → DOP pieces.v/N/Cd/任意属性 (0497)
2. **Constraint mod** — sort/delete/wrangle 改 attached_relationship_geometry (0540, 0533)
3. **Group propagation** — BFS nearpoints + setpointgroup on dop_geometry (0454)
4. **Sim geometry mod** ← 新增 — 直接改 DOP solver 内部几何节点位置 (不是 force / 不是 constraint, 是 geometry 自身) (0013)

第 4 种 (sim geometry mod) 在 0013 filament solver 用: sopsolver 内 attribvop curlnoise → 把 P 加 noise → 直接改 filament 节点位置, 让涡丝从规则圆环 → 自然扭曲变形. 跟 force injection 区别: force injection 改 `v` 让 sim 算下一帧位置; geometry mod 直接改 `P` 跳过 sim 步.

四种用途分类轴: **what is mutated**:
- v (force injection)
- constraint (constraint mod)
- group membership (group propagation)
- P (geometry mod)

production master 看 sopsolver 内部第一眼 → 看输出口接的什么属性, 立刻分类.

### Filament solver (corpus 极少 < 5) — vortex physics 轻量替代

```
DOP:
  popobject + popsource (emit particles from sphere surface)
  → popsolver
      → sourcefilaments (从 source 抽 filament initial seed)
      → filamentsolver (Biot-Savart 涡丝 induces velocity field)
      → popadvectbyfilaments (粒子被涡丝 advect)
```

**物理本质**: Biot-Savart law — 无限细的涡丝 induces velocity field. 不解算压力/密度, 比 FLIP/pyro 轻量数百倍.

**适合**:
- 涡环 (smoke ring, vortex ring)
- 烟圈
- 龙卷风
- 大尺度旋转流 (无需小尺度 turbulence)

**不适合**:
- 跟刚体精细交互 (没 collision)
- 高密度区域 (filament 不模拟 confinement)
- 飞溅细节 (FLIP 更好)

**production tip**: 跟 popwind 配 (0013 popnet2 用了), 让 filament 涡场 + 全局 wind 同时驱动粒子.

### Trail-retime-scatter (修复 fast-motion gap 万能模板)

```
fast-moving geom (animated mesh)
  → trail (record N 帧 history → multi-frame geometry)
  → timeblend / retime (在 history 帧间插值)
  → scatter (在每个插值帧 scatter)
  → connectivity (按 sub-frame piece 分类)
  → 多 popnet emit
```

**问题**: 直接 scatter on fast-moving geom → 每帧 emit 在远距离位置, 帧间出现空隙 (motion gap).

**解决**: SOP 端预处理把 N 帧间隔的运动**采样成连续 sub-frame 几何**, 在每个 sub-frame 上 scatter → 帧间无缝.

**vs DOP substep**:
- DOP substep 增加 sim 计算频率 — 准确但慢, 难调
- SOP trail-retime-scatter — 几何端预处理, 快, 可视, 可调

**0180 用 8 popnet 并列对比 progressive paradigm**: 暴露问题 → 加 force/drag → 加 jitter → 加 rest+ray → final advanced.

### Rest + ray 锚定 (粒子记得自己源自哪个表面位置)

```
fast geom
  → pointjitter (随机散开 sub-frame jitter)
  → scatter
  → popnet (advect)
  → rest1 (记录 rest pose 坐标 — 不随 sim 飘)
  → ray (投回原 mesh 表面)
```

**rest 节点**: 给点配 `v@rest = @P` 在第一帧, 后续 sim 飘走时 rest 仍然记得原始位置. 配 ray 投回表面 → 粒子既被 sim 推动又锚定到表面.

**production 价值**: 解决 "粒子飘走后跟动画 mesh 脱节" 的问题. 0180 production trick.

### Curve attract velocity field 三件套 (popvop 万能模板)

```
popvop:
  geometryvopglobal (P, current particle position)
  → minpos(P, curve_geom) → 曲线上最近点位置
  → xyzdist(P, curve_geom) → 距离 + uv
  → primuv(curve_geom, attrib, prim, uv) → 沿曲线 uv 位置的属性 (tangent / orient / Cd)
  → mix(P, minpos, bias) → 把粒子拉向曲线
  → output v (or P)
```

**三件套** = `minpos` + `xyzdist` + `primuv`:
- `minpos` 给坐标 (vs xyzdist 只距离)
- `xyzdist` 给 uv (用于查 attribute)
- `primuv` 用 uv 拿曲线属性 (tangent → 沿曲线方向)

**复合 velocity field idiom** (0054 volumevop1):
```
curlnoise(P) * coef + primuv(curve, P, tangent)
= 既流动 (curl noise) 又跟随曲线方向 (tangent from curve)
```

→ production 粒子流向曲线万能模板, 6 setup 并列 progressive teaching (基础 → +primuv → +mulconst → +bias → +volume).

## Batch 44 additions

### SDF gradient push-out (极简软体碰撞, 7 节点 vs Vellum 100+)

```
attribvop:
  volumesamplefile (P, sdf) → SDF value (负=内部)
  if_begin (sdf < 0):
      volumegradientfile (P, sdf) → gradient vector (指向外部)
      multiply (gradient * (-sdf)) → 推出向量
      add (P + multiply) → push P out
  end_if
```

等价 wrangle:
```c
float sdf = volumesample(1, "surface", @P);
if (sdf < 0) {
    vector grad = volumegradient(1, "surface", @P);
    @P += -normalize(grad) * abs(sdf);
}
```

**架构含义**:
- **SDF gradient** 是体积内任意点到表面的最短方向, 推出量 = SDF 绝对值 = 离表面距离
- 7 节点实现软体碰撞, 比 Vellum/Bullet 数百倍便宜
- 适合: kinematic source 跟 deformable mesh 接触, 不需要质量/弹性
- 不适合: 真实双向力 (push 单向), 多体接触, 物理弹性

**production 用法**: 配 attribblur 平滑边缘, 配 lerp 控制推出强度, 配 SDF blend (multiple targets) 等.

### 离散微分几何 in production (curvature, dihedral)

discrete curvature 公式:
```
κ ≈ |t[i+1] - t[i-1]| / (s[i+1] - s[i-1])
其中 t[i] = (P[i+1] - P[i-1]) / |P[i+1] - P[i-1]| 单位切线
     s = arc length
```

VOP 实现 (0608):
- `neighbourfile + importpoint` → 拉 i±1, i±2, ... 邻居 P
- `qdistance` (vec→hvec→quaternion 距离) — 数值稳定, 比 dot/acos 稳定
- 多 stencil 邻居 → 多阶平滑近似
- `polyframe + sweep + curvature-driven pscale` = production 沿曲线粗细变化标准链

**production 价值**:
- 弯曲处粗 (高 κ), 直处细 (低 κ) — sweep tube 粗细驱动
- 跟 0007 弯曲权重为挤压区域加褶皱同 family
- 这是离散微分几何在 production 的代表 — 非物理但需要数学

### Geometry solver vs SOP solver (轻量 vs 通用)

**geometry solver**: 简化版, 适合纯几何/属性递增更新
- 接口: Prev_Frame, Input_1..4, OUT
- 适合: cellular automaton, 属性扩散, iterative geometry mod
- 不适合: 需要 DOP 物理 (collision, rigid body)
- 0614 用于属性扩散

**SOP solver**: 通用, 内部可放任何 SOP 节点
- 适合所有 iterative 场景
- vs geometry solver: 接口更复杂, 但灵活

production 选择: 单纯属性 mutate → geometry solver; 复杂多步 mutate → SOP solver.

### Discrete heat equation / cellular automaton on mesh

```
∂u/∂t = α · ∇²u  (热方程)

discretize on mesh (geometry solver):
  for each point i:
      neighbours nbs = neighbours(geo, i)
      foreach n in nbs:
          if (u[i] > 0):
              u[n] = max(u[n], u[i] * decay)  // forward propagate with decay
```

→ 类似 BFS spread + decay, 不是真正 ∇² Laplacian
→ 简化版本足以用 — production 不需要真物理热方程
→ 跟 0613 (color spread) / 0143 (geometry wrangle DOP) / 0454 (BFS group) 同 family

### attribpaint (production interactive 绘制 source)

```
mesh → attribpaint (用户在 viewport 用画笔涂抹 attrib float/color)
   → solver (扩散 / 衰减)
```

**production 价值**:
- 不靠程序生成 source — user-driven, 反复涂抹试错
- 适合: source 位置不规律, 需要艺术控制 (如局部裂痕, 病毒发源点, 火焰起始)
- 跟 drawcurve (0508/0042) 同源 — interactive drawing 是 production 标准 input

### VOP 内 build geometry (addpoint + addprim + addvertex)

```
attribvop:
  addpoint (geo, P) → ptnum
  addprim (geo, "polyline" / "polygon") → primnum
  addvertex (geo, primnum, ptnum) → 把 ptnum 加到 prim
```

**vs SOP add 节点**:
- VOP 端可以放 nested for-loop 内 — 每次 iteration 建一个点/prim
- 跟 wrangle `addpoint() / addprim() / addvertex()` 同概念但 VOP 节点

**适用**: procedural generator (spiral, lattice, fractal) 需要算法递增建几何.
**不适用**: 简单 SOP add/copy/sweep 能做的, 不必绕 VOP.

corpus < 5 工程用这个 (0618), 是 high-level VOP 用法.

### 6 nested for-loop in VOP = 多 D parameter space generator

```
attribvop:
  for_begin1 (length=N1):
    for_begin2 (length=N2):
      for_begin3 (length=N3):
        ...
        for_begin6 (length=N6):
          [body: matrix multiply + addpoint + addprim + addvertex]
        end_for6
        ...
      end_for3
    end_for2
  end_for1
```

**架构含义**:
- 6 嵌套 = 6D parameter space (N1 × N2 × N3 × ... × N6 个点/prim)
- 每层 length 独立 — 可以是 (10, 5, 3, 8, 4, 2) 任意组合
- matrix multiply chain in body = transformation composition (rotate * translate * scale)
- 跟 SOP 端 nested foreach 同概念但 VOP 端可以纯算法生成

production 应用: spiral / lattice / fractal / procedural building (建筑层 → 楼 → 房间 → 家具 → 装饰).

## Batch 45 additions

### Geodesic distance + ceiling/floor/frac → ring/stripe discretization

```
attribvop:
  surfacedist (geom, group, P) → 沿表面 geodesic distance
  ceiling (dist / ring_width) → ring index (0,1,2,3,...)
  → output mask
```

**3 个 geodesic 节点**:
- `surfacedist` (VOP 节点) — 0617 用
- `distancealonggeometry` (SOP 节点) — 0540 用
- 都是 Dijkstra-like 沿 mesh 表面计算

**离散化函数** (把连续 distance → 离散环):
- `ceiling(d / w)` — 0617 用, 向上取整, 开右端
- `floor(d / w)` — 跟 ceiling 互为闭/开端
- `frac(d / w)` — 0386 stripe 用, 0..1 周期, 适合 stripe 而非 ring index
- 配 `subtract(d1, d2)` → 等差环 / bounded ring

**production 应用**: 涟漪扩散 / 表面环纹 / 距离-mask / 等高线 / 增长波前.

vs 直线 `xyzdist + ceiling`: 在 mesh 上不准 (会跨过表面 inside, 不是真正沿表面).

### Worleynoise cellular pattern (vs turbnoise smooth gradient)

```
attribvop:
  worleynoise (P) → cellular noise (Voronoi-like)
  → group threshold → polyextrude
```

**worleynoise vs turbnoise** 选择:
- worley → 自然形成 cell 边界, sharp boundary, 适合岩石/cell pattern/科幻面板/裂痕
- turb / perlin → 平滑 gradient, 适合形态变化 / 烟雾 / displacement

worley 第二输入 = 二次 worley (基于 worley1 输出再 worley) → 多层细节.

**多层 noise + extrude recursive 标准链**:
```
geo → noise → group threshold → polyextrude (一级)
   → subdivide (给二级足够分辨率)
   → noise (再来一次) → group → polyextrude (二级)
```

每层 noise 频率不同 → 多 LOD detail (低频大形, 高频裂痕).

### Contact-driven dynamic attribute (state machine: 增加 → 限制 → 衰减)

```
solver attribvop:
  intersect (P → external_geom) → hit?
  compare (hit > 0)
  inttofloat → 0/1 indicator
  add (current_attr + hit_indicator)  ← 接触瞬间增加
  clamp (0..1)                         ← 限制上限
  multiply (decay_parm < 1)            ← 每帧衰减
  → output
```

**state machine 三步**:
1. **增加** (event-driven): 接触/触发时 attr += 1
2. **限制** (clamp): attr ≤ max
3. **衰减** (decay): attr *= 0.95 每帧

**production 应用**: 湿/干 (refresh-on-touch), 健康/血量 (受伤减少, 治疗增加), 充能 (蓄力到上限然后释放), 火焰温度 (持续燃烧到上限然后熄灭).

vs PDE solver (0257 wave): 这是 event-driven 离散更新, 不是连续 PDE.

### 4-layer solver progressive paradigm (production teaching trick)

author 把同一效果分 4 层 solver 实现, 每层加一层逻辑:

| Layer | Logic | 效果 |
|-------|-------|------|
| solver1 | base (attribcopy + attribtransfer) | 状态继承 |
| solver2 | + 检测 (intersect / nearpoints) | 加 event detection |
| solver3 | + 状态修改 (add + clamp) | 加 mutation |
| solver4 | + decay/refresh (multiply) | 加完整 lifecycle |

**author 标志**: 0622 / 0540 / 0054 / 0049 都用这个 paradigm. user 看 4 个 solver 并列 → 理解每一步加了什么.

→ 跟 incremental refinement layout (落于ivi 标志) 同源, production teaching 标志.

### popreplicate fission system (corpus < 10 少见)

```
popnet:
  poplocation (起点 emit, 世界坐标位置)
  → popgroup (active particles 选择, e.g., age<N)
  → popreplicate (active particles → N children, 继承 parent attr)
  → popwind (扩散方向)
```

**popreplicate**: 把每个 active particle 复制成 N 个新 particle (parent + N children). 触发条件: 时间 / event / group.

**production 应用**: 病毒蔓延, 植物分支, 生物分裂, 闪电分支 (跟 0500-0504 lightning 不同 — lightning 是 ray-tree growth, popreplicate 是 emergent particle fission).

**完整 fission system 4 件套**: location + group + replicate + wind.

### Trail-polywire 粒子轨迹 → 分支几何 (vs trail-retime-scatter)

```
popnet output (current particles)
  → trail (record N 帧 history → multi-frame geometry, 保留 ID/pid)
  → timeshift (shift to specific frame)
  → resample (sub-divide trail edges)
  → wire / polywire (1D 点轨迹 → 圆柱 mesh)
  → vdb → smooth → convertvdb → mesh-ify
  → attribtransfer color + attribblur (color 平滑扩散)
```

**vs trail-retime-scatter (0180)**:
- 0627 把 trail 作 geometry 输出 (轨迹 → 几何)
- 0180 把 trail 作 sub-frame emit (gap fix)

**关键**: trail 保留 pid → 同一粒子的轨迹连成 line → polywire 出 tube. production 病毒/根系/分支生长标准链.

## Batch 46 additions

### Winding number (拓扑学) vs SDF (几何学) — implicit surface 二选一

**SDF (Signed Distance Field)**:
- 定义: 每点到表面的最短距离 (有符号, 内负外正)
- 要求: closed manifold mesh
- 优势: 数值稳定, 操作多 (grad / smooth / blend)
- 节点: vdbfrompolygons, volumesample, volumegradient
- 标准链: `vdbfrompolygons → vdbreshapesdf → vdbsmoothsdf → convertvdb`

**Winding number (拓扑学)**:
- 定义: 多少 mesh "包围" 这个点 (整数 N if 嵌套 N 层, 0 if 外部)
- **不要求** mesh 是 manifold/closed (open mesh OK)
- 多 mesh 重叠时 winding 累加 → metaball-like 自然融合
- 节点: `windingnumber` (输入1: 采样点, 输入2: source mesh)
- 标准链: `pointsfromvolume → windingnumber → volumerasterizeattributes → vdbsmooth → convertvdb`

**何时选**:
- closed manifold + 单 mesh → SDF (更高效)
- open mesh / 多 mesh blend / 不规则数据 → winding number
- metaball-like 融合 → winding number 比 boolean union 更圆滑

corpus 现 1 个 winding number 工程 (0009), vs 几十个 SDF 工程. winding number 是 **稀有但强大** 的 implicit surface 工具.

### connectadjacentpieces (lattice / wireframe SOP 节点版)

```
scatter on isooffset surface (or any point cloud)
  → connectadjacentpieces (按距离/邻居数自动连接 → line segments)
  → polywire / sweep (1D line → 圆柱 mesh)
  → merge prefab spheres on each point
  → vdbfrompolygons → vdbsmoothsdf → convertvdb (mesh-ify wireframe + spheres → solid)
  → remesh (uniform topology)
```

**节点 vs VEX**:
- `connectadjacentpieces` 是 SOP 节点版本 — 自动按距离/邻居数连
- VEX 等价: `pcfind(P, radius, max) → for each → addprim('polyline') → addvertex`
- 节点更便捷, VEX 更可控

**架构**: 用 piece attribute 而非 point — 比 nearpoints 高一级抽象, 适合 piece-level connectivity (vs point-level).

**production 应用**: lattice / wireframe / 网格化建模 / connection graph 可视化.

### Mesh blending 万能模板 — weight 6 种来源 (现 8 paradigm 累计)

**通用模板**:
```c
vector P_target = point(input2, "P", @ptnum);
float weight = ???;  // 来源决定 paradigm
@P = lerp(@P, P_target, weight);
// 或: @P = mix(@P, P_target, weight);
```

**weight 6 种来源**:
1. **distance**: `weight = fit(distance(@P, ref), inner, outer, 1, 0)` — 0157, 0001
2. **noise**: `weight = fit(turbnoise(@P*freq), srcmin, srcmax, 0, 1)` — 0093 (这次) ← 新增
3. **mask**: `weight = mask * blend` (mask 来自 attribblur / paint / scatter) — 0288, 0494
4. **age**: `weight = chramp('s_ramp', @nage)` — 0086, 0345, 0489
5. **ramp formula**: `weight = chramp('s', @curveu/@P.y)` — 0421, 0397
6. **A↔B wavefront formula**: `weight = clamp(myPt - 1 + 2*shift, 0, 1)` — 0509

**8 paradigm 累计**:
- 0157, 0398, 0086, 0288, 0001, 0494, 0509, **0093** (新)

**架构含义**:
- 同一 idiom 6 种 weight 来源 = production 万能模板
- 选 weight 来源 = 选效果性质 (distance → 同心球, noise → 不规则, mask → 用户控制, age → 时间, ramp → 形状, formula → 波前)

→ 跟 `chramp + various drivers 6 paradigm` (0421/0162/0485/0625/0634/0345/0489/0506/0148/0527/0258/0526/0397) 同源 — Houdini production "1 idiom + 6 driver" 是反复出现的 pattern.

### N as force / direction (基础 idiom)

```c
// wrangle: just bind N (let downstream nodes use)
@N;  // 等价 v@N = v@N (declare)
```

**为什么 mesh 表面 N 是天然 vector field**:
- normal 节点免费给所有 point 配 N (跟 mesh 拓扑一致)
- N 方向天然有意义 (表面外推方向)
- 适合: 颗粒沿 N 方向放射 / 沿 N 散开 / 朝 N 旋转

**production 应用** (4+ paradigm):
- 0029 vellum grain N magnetic
- 0633 self-offset velocity (N 作 force)
- 0297 grass radial kinefx (N 作朝向)
- 0166 popvop pcfilter (用 N 作初始 v)

**vs 其他 vector source**:
- N: mesh 表面方向, 静态
- v: sim velocity, 动态
- curlnoise: 体积流场, 动态
- minpos-P: 朝最近点, 动态

N 是最简但最有用的 vector — 成本低 (免费), 效果好 (production teaching default).

## Batch 47 additions

### Particle force 3 种正交 (在 popsolver / flipsolver 内)

1. **popforce** — 任意 force vector (e.g., gravity, custom direction)
2. **popadvectbyvolumes** — 用体积速度场 advect 粒子 (体积场驱动)
3. **popcurveforce** — 沿 curve 方向 + 朝 curve attract (曲线驱动)

外加:
- **popwind** — 全局 wind direction
- **popaxisforce** — 轴向旋转力 (0359 tornado)

**production 选**:
- 全局力/重力 → popforce
- 跟随复杂场 (noise/sim) → popadvectbyvolumes
- 跟随用户曲线 → popcurveforce
- 全局风 → popwind
- 旋转 → popaxisforce

5 种力跟 vop 内 minpos+xyzdist+primuv 三件套 (0054) 是两条平行路径 — 节点 vs VOP. corpus 各占一半.

### vdbactivate (体积激活 — 性能必备)

```
vdb (empty volume, no voxels allocated)
  → vdbactivate (input2 = mesh) → 只激活 mesh 附近的 voxels
```

**为什么必备**:
- 默认 vdb 是 empty (no voxels), volumevop 跑会出错 / 全空间扫描
- vdbactivate 把 voxels 限制在 mesh 附近 (sparse 优化)
- volumevop 只在 active voxels 算 → 性能提升 10-100x

**vs vdbreshapesdf**:
- vdbactivate 改 voxel 分布 (allocate or not)
- vdbreshapesdf 改 SDF 形状 (voxel 已 allocate)

**production 必用**: 任何 vdb-based volume sim / volumevop 都该先 vdbactivate.

### Mesh blending 万能模板 → 9 paradigm (新 weight 来源 = staggered ramp)

**第 7 种 weight 来源** (staggered ramp):
```c
float offset = fit01(@curveu, 1, 100);
float animate = chramp("animate", fit(f@Frame, $FSTART + offset, 200, 0, 1));
@P = lerp(@P, @opinput1_P, animate);
```

**精髓**: per-point offset 让每点 start frame 不同, 实现"沿 mesh 一段一段激活"效果, 解决 sim 启动 popping.

**9 paradigm 累计**:
- 0157 distance, 0398 importpoint+mix, 0086 chramp(@nage), 0288 mask×blend, 0001 reference, 0494 caramel, 0509 wavefront formula, 0093 noise, **0299 staggered ramp** ← 新增

**weight 7 种来源**: distance / noise / mask / age / ramp / wavefront formula / staggered ramp.

### `@opinputN_X` VEX 简化语法 (vs point() / importpoint)

```c
// 等价三种:
@P = lerp(@P, @opinput1_P, weight);                     // 简化语法 (最短)
@P = lerp(@P, point(1, "P", @ptnum), weight);           // point() 函数
@P = lerp(@P, vector(point(1, "P", @ptnum)), weight);   // 显式 cast
```

**`@opinputN_X`** = N 是 input 序号 (0/1/2/3), X 是 attribute 名 (P, N, Cd, ...). 自动按当前 ptnum 拉值, 跟 importpoint VOP 同概念.

**production 用**: 最短最 idiomatic, 看代码立刻知道是引用第 N 输入.

### Sim ↔ non-sim blend (lerp 解决 popping)

```
input 0: non-sim (procedural 几何)
input 1: sim (vellumsolver / FLIP / Bullet 结果)
↓
wrangle: @P = lerp(@P, @opinput1_P, ramp)
↓
output: 平滑过渡到 sim
```

**架构含义**:
- sim 启动瞬间 popping (突变) 是普遍问题
- 任何 sim 都可以加这个 blend 层 — vellum / FLIP / Bullet / pyro 都适用
- ramp 来源决定过渡形态 (uniform / staggered / mask-driven / age-driven)
- 这是 production "let sim feel natural" 的标准手段

跟 trail-retime-scatter (0180 fast motion gap fix) 不同 — 那是修复 motion gap, 这是修复 sim popping.

### Contour / level set 4 paradigm 总结

corpus 现 4 种实现 contour / iso curve / level set 的 paradigm:

| Paradigm | 节点 | 适合 |
|----------|------|------|
| **boolean ∩ plane** | boolean (geometry intersection) | mesh + 平面交线, 几何精确 |
| **SDF iso** | volumesample + threshold (or convertvdb iso) | 体积 SDF 等值面 |
| **color → group** | setpointgroup based on @Cd value | 用户绘制等高线 |
| **geodesic ring** | surfacedist + ceiling/floor | 沿 mesh 表面环 |

**何时选**:
- 静态 mesh 等高线 → boolean ∩ plane (0300)
- 动态 sim 体积 → SDF iso
- 用户画 → color group (0263)
- 沿 mesh 表面 → geodesic ring (0617)

production master 看到 contour 任务 → 立刻分类选 paradigm, 不再纠结实现.

### drawcurve / attribpaint = production interactive input 2 件套

| 工具 | 输入类型 | 适合 |
|------|---------|------|
| **drawcurve** | curve geometry (line) | force field / 路径 / contour |
| **attribpaint** | float/color attribute on mesh | mask / wet/dry / source location |

**production 价值**:
- 不靠程序生成 source — user-driven, 反复调整试错
- 跟 procedural 配合 — 用户给"种子", 程序生成结果
- 0042/0508/0290 用 drawcurve, 0614 用 attribpaint

跟 procedural input (noise / curve generators / scatter) 互补 — 真实 production 项目两者都用.

## Batch 48 additions

### Solver + ray = permanent deformation (footprint / impression / 沙地痕迹万能 idiom)

```
solver SOP:
  Prev_Frame (上一帧 deformed mesh)
  → ray (Prev_Frame → Input_2 collider, mode = direction or projection)
  → ray 直接改 P 到 hit point (vs SDF push-out 弹性返回)
  → OUT (本帧, 也成为下帧 Prev_Frame)
```

**核心**: ray 节点不只 detection, 它**直接改 P 到交点位置**. Prev_Frame 让 P 在帧间保持 → 永久变形累积.

**vs SDF push-out (0603)**:
- SDF push-out: 单帧 detection + 弹性推出, 无 history
- Solver+ray: 累积永久变形, 有 history

**production 应用**: 踩雪 / 沙地脚印 / 软地表压痕 / 雪地拖痕 / 黏土被按压. 0361 极简 0 wrangle 7 节点实现.

### Gas* microsolvers (DOP 内 fluid/temperature 工具)

DOP 内 微解算器 family — 只改 sim 的一个方面, 组合用:
- **gastemperatureupdate** — 温度场更新 (热传导 / 黑体辐射衰减)
- **gasfieldvop** — VOP-based 任意 field 修改 (corpus 万能修改器)
- **gasdiffuse** — 扩散 (temperature / smoke / density)
- **gasdisturb** — 加扰动
- **gasopencl** — OpenCL 加速版 microsolver
- **gasprojectnondivergent** — 投影使速度场无散
- **gasvelocityupdate** — 速度场更新
- **gasresizeflip** — FLIP 体积自适应 resize

**production 用**: 把这些组合塞 flipsolver 内部 → 自定义 fluid 行为.

跟 simple force (gravity / popforce) 不同 — gas* 是 sim solver 的内部工具, 直接改 field 而非 force.

### Temperature → viscosity (production lava/wax/melt 万能模板)

```
SOP: start_temperature wrangle (`@temperature = 2`)  ← 初始温度
  → flipsource (把 attr 转给 FLIP particles)

DOP:
  flipsolver
    → gastemperatureupdate (每帧温度衰减)
    → flipsolver 用 temperature 影响 viscosity (高温→低粘度, 低温→高粘度)

SOP output:
  particlefluidsurface mesh-ify
  → color_by_temperature (热红冷蓝 attr-driven color)
```

**vs 手动 viscosity blend (0517/0519)**:
- 手动: 固定 viscosity 值 / 手动 blend 多 viscosity 区域
- 自动: temperature → viscosity 自然衰减 (随时间冷却)

适合: lava 凝固 / wax cooling / 冰冻 / 焦油凝固 / 巧克力固化.

### Heightfield as collider (2.5D 地形专用)

```
heightfield (生成空 heightfield)
  → heightfield_project (input2 = heightfield, input3 = sphere/mesh) → 投影 mesh 到 hf 表面
  → staticobject (DOP 内作 collider)
```

**vs vdb collider**:
- heightfield: 2.5D, 适合地形 (高度场), 节省内存, 渲染快
- vdb: 3D, 适合任意 shape (洞穴/球/复杂几何)

heightfield 特殊节点: heightfield_paint / heightfield_terrain / heightfield_erode / heightfield_distort 等专用工具.

production 选: 地表 / 地形 / 山丘 → heightfield; 复杂 3D shape → vdb.

### 10 cutting paradigm cookbook (0372 master cookbook)

| Paradigm | 节点 | 适合 |
|----------|------|------|
| 1. voronoifracture + scatter | voronoi + scatter | 通用 cell 碎裂 |
| 2. booleanfracture + plane | boolean + grid | 平面切割 |
| 3. booleanfracture + noise | boolean + mountain | 不规则切 |
| 4. voronoi + foreach piece | foreach + voronoi | 嵌套二级碎 |
| 5. boolean + interior cleanup | boolean + rbddisconnectedfaces | 玻璃预切 |
| 6. rbdinteriordetail | rbdinteriordetail | 内部面 detail |
| 7. attribrandomize → seed | attribrandomize → scatter → voronoi | 随机种子控制 |
| 8. dist + group_selection | xyzdist + group_selection → split | 距离切片 |
| 9. rand + group_selection | rand + group_selection → split | 随机选片 |
| 10. stretch + rest + voronoi | rest + stretch attribvop + voronoi | 形变后切 |

**架构含义**:
- voronoi vs boolean = "用点切" vs "用形状切" 两条主路径
- 后续 cleanup (rbddisconnectedfaces / rbdinteriordetail) 通用
- 选 paradigm 看 cutter 类型: 点 → voronoi, mesh → boolean

### RBD 三件套 (rbd*detail/connected/disconnected) — production 切割 cleanup

- **rbdinteriordetail**: 给碎块内部面加 detail noise (interior 显示更逼真)
- **rbdconnectedfaces**: 提取相邻碎块共面 (作 constraint geometry)
- **rbddisconnectedfaces**: 提取碎块独立面 (清除 sim-internal 但视觉无意义的 face)

跟 production RBD pipeline 整套 (10+ 节点):
- rbdmaterialfracture (切碎 + 输出 3 流: High/Low Quality + Constraints)
- rbdconfigure (sim 配置)
- rbdconvertconstraints (constraint 转换)
- rbdconstraintproperties (constraint 属性)
- rbdexplodedview (debug 显示)
- rbdbulletsolver (sim)
- rbdio (sim cache)
- rbdxform (变换)

**production 标志**: 看到 8+ rbd* 节点 → 知道是完整 production RBD pipeline (vs demo 只用 voronoifracture + 简单 sim).

### High/Low Quality multi-LOD output (sim/render 分离)

rbdmaterialfracture 输出 3 流:
- **High_Quality_Geo** — render 用 (细节多)
- **Low_Quality_Geo** — sim 用 (面少, 快)
- **Constraints** — constraint geometry (sim 用)

**架构含义**: sim 跟 render 分离 — sim 用 low (省时间), render 用 high (细节多). 跟 0388 dual voronoi / 0021 Bridge A / 0540 RBD lesson 同源.

production 标志: 看到 dual-LOD output (or High/Low naming) → 知道是 production sim pipeline.

## Batch 49 additions

### Houdini matrix transformation 三件套 (corpus matrix master class)

**A. primintrinsic 'transform' (碎块姿态 read/write)**

```c
matrix3 xform = primintrinsic(0, 'transform', @primnum);  // 读
setprimintrinsic(0, 'transform', @primnum, xform);         // 写
```

`assemble` / `voronoifracture` 后, 每个 prim 有 'transform' intrinsic, 存碎块姿态 (rotation + scale). 改 intrinsic = 改碎块 transform 而不改 P.

**B. lookat + slerp + qconvert (朝向 target 平滑旋转)**

```c
matrix3 look = lookat(@P, target_pos);  // 朝 target 看
xform = qconvert(slerp(quaternion(xform), quaternion(look), mask));
```

**关键步骤**:
1. `quaternion(matrix3)` — matrix → quaternion
2. `slerp(q1, q2, t)` — 球面线性插值 (uniform 角速度, 比 lerp 更自然)
3. `qconvert(quaternion)` — quaternion → matrix3

**为什么必须用 quaternion**:
- 直接 lerp 矩阵 → 矩阵元素线性插值 → 不再是 valid rotation matrix → 几何变形
- slerp quaternion → 路径在球面 → 始终 valid rotation, 角速度均匀

**production 应用**: lookat blend, 朝向 target 平滑过渡, 任何旋转 blend.

**C. prerotate vs rotate (LHS local vs RHS world)**

```c
prerotate(xform, mask * PI, normalize(cross(target_dir, {0,1,0})));
//        矩阵   弧度        旋转轴
```

- **prerotate(M, angle, axis)** = `R(axis, angle) * M` — LHS, 在 M 之前应用旋转, 影响 local frame
- **rotate(M, angle, axis)** = `M * R(axis, angle)` — RHS, 在 M 之后, 影响 world frame

production 用 `prerotate` 当想"沿物体自己的轴旋转"; `rotate` 当想"沿世界轴旋转".

**翻滚轴 idiom**: `cross(direction, up)` = perpendicular to fall direction → 让 carbon 沿"翻滚方向"旋转 (而非沿 up).

### Distance falloff 公式分类 (1/pow(d, N) idiom)

| N | 名称 | 物理意义 | 应用 |
|---|------|----------|------|
| 1 | 反比 (1/d) | 线波 | 声音强度 |
| **2** | **平方反比 (1/d²)** | **重力 / 库仑** | **物理引力** |
| 3 | 立方反比 (1/d³) | 偶极子 | 偶极辐射 |
| **7** | **七次方反比 (1/d⁷)** | **van der Waals** | **超急衰减, 局部 attractor** |

**通用模板**:
```c
float mask = 1 / pow(length(target_dir), N) * scale;
// 或 chramp 替代:
float mask = chramp("falloff", clamp(length(target_dir) * scale, 0, 1));
```

**production 选**:
- 真物理 → N=2 (重力, 引力)
- 急衰减 / 局部 attractor → N=7 (0448 用)
- user-tunable → chramp (替代 pow, 更可控)

### Hair production 6 件套 (corpus < 5 罕见 pipeline)

```
skin (mesh)
  → groupexpression / paint mask (source group)
  → hairgen1 (生成 guide hairs)
  → guideadvect (毛发被 force/curve/velocity field advect)
  → guideprocess (毛发 cleanup)
  → guideskinattriblookup (毛发 ↔ 皮肤 attr 互通)
  → hairgen2 (clump 后 final hair)
  → hairclump (毛发聚团)
```

**6 件套**:
1. hairgen — guide hair 生成
2. guideadvect — 引导线/force/velocity 驱动
3. guideprocess — cleanup
4. guideskinattriblookup — skin attr 互通
5. hairclump — 聚团
6. (optional) guidegroom / guidemask — grooming

**vs vellum hair (0507)**:
- hairgen + guideadvect: 渲染/grooming, 静态最终形态
- vellum hair: sim, 动态运动

corpus < 5 hair 项目 — 相对冷门但完整.

### `volumevelocityfromsurface` (surface-aligned velocity field)

```
mesh → vdbfrompolygons + volumevelocityfromsurface → vdb velocity field
```

**作用**: 把 mesh surface normal/curvature 转 vdb 速度场, 让 advect 节点 (guideadvect / popadvectbyvolumes) 有"沿表面流动"的方向.

**production 应用**:
- Hair production (0447) — guideadvect 让毛发跟随 surface direction
- Particle on surface — popadvectbyvolumes 让粒子沿表面流
- 跟 aaflownoise 互补 (后者是 procedural noise, 这个是 mesh-derived)

### Production HDA standards 综合 (10+ 标志)

production HDA (vs demo 平铺) 多种标志, 累计:

1. **switchif HDA expression-driven switch** (0017, 0270)
2. **multi OUT API** (0021 Bridge A 8 OUT, 0494 焦糖 5 OUT)
3. **switch_to_selection_guide debug toggle** (0440 新加)
4. **Controller null + parm expression** (0017, 0488)
5. **multi LOD switch** (0021, 0189, 0388)
6. **multi material switch** (0440)
7. **5+ mesh input switch** (0440 5 input, 0049 6 popnet)
8. **$OS group naming** (0287)
9. **partition + name + foreach piece** (Master 117, 0287)
10. **FBX export naming convention** (0287)
11. **incremental refinement layout (10+ variant nodes)** (0488, 0093)
12. **High/Low Quality multi-LOD output** (0394 rbdmaterialfracture)
13. **rbdio sim cache** (0394)
14. **CTRL null + dopio cache** (0366)
15. **agz:: / labs:: 自定义 HDA prefix** (0354)
16. **compile_blocks (Houdini 18+ OpenCL)** (0540)
17. **4 In/Out 通道 sopsolver** (0540)
18. **4-layer solver progressive paradigm** (0622, 0540, 0054)

**累计 18+ standards** — corpus author production-grade 标志体系.

### Mesh morphing 2 大 paradigm (master class 总结)

| Paradigm | 实现 | 优 | 劣 |
|----------|------|---|---|
| **point-order mix** | scatter + sort + `mix(P_A, P_B, bias)` 万能模板 | 快, 简单, 1 wrangle | 必须拓扑对齐 |
| **vdbmorphsdf** | vdbfrompolygons + solver + `vdbmorphsdf` iter | 不要拓扑对齐, SDF 自然过渡 | 慢, 需要 solver iter |

**production 选**:
- 同形态 mesh (e.g., 不同表情, 同 character 不同 pose) → point-order mix
- 异形态 mesh (e.g., 不同 character, rubbertoy → squab) → vdbmorphsdf

**一句话**: 拓扑可对齐 → point-order; 拓扑不可对齐 → vdb. 0452 master 教学并列对比.

跟 mesh blending 万能模板 9 paradigm 同源 — point-order 是基础, 9 paradigm 是 weight 来源不同的 variant.

## Batch 50 additions

### Vellum dynamic constraint mod 4 paradigm 综合

| Paradigm | 实现位置 | 特点 |
|----------|---------|------|
| 1. SOP-side pressure parm animation | SOP 端动画 vellumpressure 节点 parm | 简单, 全局, time-driven |
| 2. DOP-side vellumconstraintproperty | vellumsolver 内部 forces subnet | runtime 改, per-substep |
| 3. sopsolver attribtransfer SOP→DOP | sopsolver 内部 attribtransfer | 任意 SOP field 注入 |
| 4. sopsolver constraint sort/delete | sopsolver 内部 sort/delete on attached_relationship_geometry | 改 constraint 拓扑 |

**production 选**: 全局简单 → SOP parm; 局部 runtime → DOP vellumconstraintproperty (0331/0461); 复杂 SOP-driven → sopsolver attribtransfer (0540); 改 constraint 拓扑 → sopsolver sort/delete (0540).

### oceanevaluate + oceanspectrum (production 海面 vs 真 FLIP)

```
oceanspectrum (parameters: wind/wave/chop/direction)
  → oceanevaluate (input1=grid, input2=spectrum)
  → 输出 grid displacement + velocity
```

**vs 真 FLIP**: oceanevaluate 数百倍快, 远景完美; FLIP 真实物理, 近景 splash 必备.

**取巧 paradigm**: `oceanevaluate + pointvelocity → RBD` (0463) — sample 海面 velocity 给 RBD points → 跟随海面起伏, 不真模拟浮力.

### Houdini Crowd System 5 件套 (corpus < 5 罕见)

```
agent → agentclip → crowdsource
  → dopnet:
      crowdobject + crowdsolver + crowdstate (walking/idle)
      → popsource (emit) → popsteerobstacle (避障 vs popforce)
```

vs KineFX: Crowd 是高层 (群体行为), KineFX 是低层 (rig + skin).

### Production interactive input 3 件套 (新增 edit)

| 工具 | 输入类型 | 适合 |
|------|---------|------|
| drawcurve | curve geometry | force field / 路径 / contour |
| attribpaint | float/color attr | mask / wet/dry / source |
| **edit** ← 新加 | 直接拖动 P | mesh deformation / 手动 fine-tune |

edit 特殊: 直接改 P (vs 绘 attr / 创 curve), 适合 pre-fracture 后调位置, fine-tune sim 形态.

### Carrier geometry control FLIP (production 取巧 paradigm)

```
carrier mesh (e.g., voronoifracture pieces)
  → controlled_N (getattrib + subtract → 朝 target 方向)
  → manual edit (用户拖动 fine-tune)
  → flipsource (emit velocity = controlled_N)
  → flipsolver
```

**3 种 control sim 方式**:
1. Carrier geometry + controlled emit (0481)
2. Force field (popcurveforce / popaxisforce, 0290/0498)
3. Sample external field via pointvelocity (0463)

**production 哲学**: 不让 sim 完全自主, 用现成工具 + manual control 引导.

### `getattrib + subtract` (controlled vector via reference point)

```c
vector ref_pos = getattrib(input1, "P", 0);  // 第 0 点 = centroid/target
vector controlled_dir = ref_pos - @P;        // 朝 ref 方向
v@N = controlled_dir;
```

production "single reference target" 标准 idiom (跟 `point(1, "P", 0)` 同源).

### v_predict pcfilter velocity prediction

```
attribvop:
  pcopen (radius, max) → 邻居
  → pcfilter (avg neighbor velocity)
  → divconst (avg/N)
  → add (P + avg) → predicted next position
  → ramp (control timing)
  → output v
```

让 emit 粒子 velocity 平滑跟随邻居, 跟 0166 popvop pcfilter 同源 (flocking-like).

### Vellum container collider 标准链

```
tube → polyfill (封口) → matchsize → smooth → transform
  → reverse (反转法向, 内壁朝内)  ← 关键
  → REF_collsion null
```

`reverse` 反转 prim 法向 — 容器内壁朝内, vellum 才能正确 collide. 不 reverse → 法向朝外, vellum 穿过容器.

## Batch 51 additions

### drawcurve 4 paradigm 综合 (production interactive curve 用法)

| Paradigm | 节点链 | 用途 |
|----------|-------|------|
| 1. **Force field** | drawcurve → resample → popcurveforce | 粒子/流体 跟随 curve (0290) |
| 2. **Path / route** | drawcurve → resample → 任意后处理 | cloth tear path (0042) |
| 3. **Contour / spike** | drawcurve → resample → guide hair / sweep | 冰柱 / hair (0508) |
| 4. **Cutting tool** ← 新加 | drawcurve → polyextrude → boolean | 切割 mesh (0137) |

drawcurve 是 user-driven curve, 一个简单节点 4 paradigm 用途.

### Auto-close detection idiom (production interactive trick)

```c
// detail wrangle (after drawcurve)
vector pt1 = point(0, 'P', 0);
vector pt2 = point(0, 'P', npoints(0)-1);
float dist = length(pt1 - pt2);
if (dist <= chf('auto_close_dist')) {
    setdetailattrib(0, 'close', 1, 'set');
}
```

user 不需要精确拖回起点, 程序智能判定. 跟 polypath 节点配合.

### labs:: HDA prefix 累计 (8+ production 扩展)

1. **labs::quickmaterial** — PBR 材质快速 setup
2. **labs::pbrshader** — PBR 着色器
3. **labs::quickshade** — 快速着色
4. **labs::thicken** — line → tube
5. **labs::edgegroup_to_curve** — edge group → curve
6. **labs::superformula_shapes** — Superformula 几何
7. **labs::straight_skeleton_3d** — medial axis (0138 新加)
8. **labs::rbd_edge_strip** — RBD edge stripe (0271)

labs:: = SideFX Labs 官方扩展库, production 必备. 看到 labs:: 节点 → author 用 production-grade 扩展.

### 1D strand / wire sim 4 paradigm 综合

| Paradigm | 节点 | 适合 |
|----------|------|------|
| 1. vellumhair | vellumconstraints (mode=hair) + vellumsolver | 头发, 跟 cloth 联动 |
| 2. vellumstrut/wire | vellumconstraints (mode=stretch) + vellumsolver | 绳网/弹簧网 |
| 3. popgrains + sopsolver line | popgrains + sopsolver internal line | noodle/spaghetti |
| 4. **wiresolver** ← 新加 | wireobject + wiresolver | 大规模 wire (千~万根) |

production 选: 大规模简单 → wiresolver; 跟 cloth 联动 → vellumhair/strut; noodle → popgrains; 头发静态 grooming → hairgen + guideadvect (0447, 不是 sim).

**`i@pintoanimation = 1`** = wire/vellum 内置 group, 跟随 input animation. 跟 vellum `@group_pin = 1` 同 family — production 内置 group 约定.

### Medial axis / centerline / skeleton 工程综合

corpus 4+ skeleton paradigm:
- **labs::straight_skeleton_3d** (0138) — 直线骨架算法, medial axis 标准
- **findshortestpath_roots** (0234) — graph-based skeleton
- **KineFX rig** (0220/0224/0227) — character rig skeleton
- **vdb medial axis** (custom) — 体积 thinning

production 选: 看输入数据 + 输出需求.

### `xyzdist + primuv` "find target on curve" 通用 idiom

```c
float dist;
int prim;
vector uv;
dist = xyzdist(1, @P, prim, uv);
vector target_pos = primuv(1, "P", prim, uv);
vector target_tangent = primuv(1, "tangent", prim, uv);
```

**用法**: target seek / voronoi seed shift / curve attract / mesh blending / attribute pickup.

**vs minpos**: minpos 直接给坐标 (省 primuv 一步), xyzdist 给 uv 让你自己拉 attr (更灵活). production 标准 "find reference + 拉属性" idiom.

### `frac()` loop wrap (循环动画函数)

```c
float loop_pos = frac(time + offset);  // 0..1 wrap
```

**vs 其他离散化函数**:
- `frac(d/w)` — 0..1 wrap (循环动画)
- `floor(d/w)` — 离散 (向下取整)
- `ceil(d/w)` — 离散 (向上取整)
- `round(d/w)` — 最近整数

**应用**: frac → 循环动画 wrap (0147/0386); floor/ceil → ring/stripe discretization (0617). 跟 chramp 同 family — 1D parameter mapping.

## Batch 52 additions

### `@id` vs `@ptnum` 跨帧稳定性 (production 持续发射 idiom)

```c
// 跨帧不稳定 (粒子被加/删 → ptnum 变)
@pscale = rand(@ptnum);  // 危险, 同 particle pscale 跨帧跳

// 跨帧稳定 (id 是 particle 唯一标识)
@pscale = rand(@id);     // 安全, 同 particle pscale 始终一致
```

**production 应用**:
- 持续发射 RBD/particle: rand(id) 给每 particle 稳定属性
- 0152/0506/0148/0345 都用
- popsource 自动给每个新 particle 配独立 @id

**何时用 @ptnum**:
- 静态 mesh (无加/删点)
- 一次性 process (不跨帧)

**何时用 @id**:
- pop / FLIP / 持续发射任何 sim
- 任何 particle 跨帧需要稳定属性

### gasparticleseparate (多源 FLIP 不混合)

```
flipsolver:
  forces subnet:
    gasparticleseparate (粒子间互斥 force)
```

**vs gasdiffuse**: gasdiffuse 是混合扩散, gasparticleseparate 是互斥反混合.

**production 应用**:
- 2-source FLIP 不混合 (red/blue 流体, 0158)
- 多种粒子保持分离
- 配 Cd attribute 保留颜色

corpus < 5 工程, 是 production "多源不混合" 的关键节点.

### 2-source FLIP + Cd 保留 multi-color fluid

```
left_box → flipsource1 → color RED → Cd attribute
right_box → flipsource2 → color BLUE → Cd attribute
  → merge → flipsolver
  → flipsolver advect (Cd 被 advect)
  → gasparticleseparate (避免空间混合)
```

**关键**: Cd 跟 FLIP particle 一起 advect, 自动保留颜色. gasparticleseparate 保证空间不混. 跟 0292 (FLIP color mixing) 反例 — 后者特意混色, 0158 是不混色.

### `staticsolver + Collision` (FLIP collider 标准)

```
DOP:
  Collision (staticobject — collider mesh, e.g., 字母 / 容器)
  → staticsolver1 (跟 collision 互通, 不动 sim)
  → flipsolver merge1 (collide 跟 FLIP)
```

**vs RBD object** (动态 collider): staticobject + staticsolver = 静态 collider (容器 / 字母 / 地形)

production 标准 FLIP collider setup.

### Texture-driven height idiom (image → mesh 标准)

```c
// 用 color 通道作 height
v@P.y = v@Cd.r - 0.5;  // R 通道 → height (-0.5 .. 0.5)

// 或:
v@P += v@N * v@Cd.r * height_scale;  // 沿 N 推
```

**production 流程** (image → 3D mesh):
1. attribfrommap → 拉 texture color (UV 采样)
2. attribblur → 平滑 Cd (减锯齿)
3. wrangle: `P.y = Cd.r - 0.5` → 高度位移
4. clip / split → 按高度切层
5. polyextrude → 3D 形态

**vs 其他 image-to-mesh paradigm**:
- 0163 (这个) — texture → height field → polyextrude
- 0036 image → cube (类似)
- 0204 image → wall (类似)
- 0244 image → mesh (类似)

corpus 4+ paradigm, 都是 attribfrommap + Cd→P 推的变体.

### `P2 = P` / `P = P2` backup-restore idiom (vs rest 节点)

```c
// wrangle 1: backup
v@P2 = @P;

// ...一系列改 P 的操作 (scatter / clip / split)...

// wrangle 2: restore
@P = @P2;
```

**vs rest 节点**: rest 节点是节点版, 这是 wrangle 版. 都是临时变 P 后还原.

**用途**:
- 临时变 P 做某 operation (e.g., 用 P.y = noise 然后切层)
- 还原 P 让后续节点拿原始 mesh

production 临时操作 P 标准 (跟 rest 节点 corpus 累计 5+).

### `planepointdistance` VEX (closed-form 平面距离)

```c
vector p;  // closest point on plane (output container)
vector pos_pt = point(1, 'P', 0);
vector nml = prim_normal(1, 0, vector(0.0));

float d = planepointdistance(pos_pt, nml, v@P, p);
//                          ^^^^^^^  ^^^  ^^^^  ^^
//                          plane    法线  query 输出最近点

// 用法: snap to plane
@P = p;

// 或: distance falloff
float bias = smooth(-out, in, d);
@P = lerp(@P, p, bias);
```

**vs SDF**: SDF 是体积 (vdb), planepointdistance 是 closed-form (无 vdb, 极快).

**production 应用**: plane displacement / plane attract / plane snap / plane mask.

### `smooth(min, max, value)` Hermite smoothstep

```c
float bias = smooth(-X, X, value);  // smooth pulse, centered at 0, width 2X
float ramp = smooth(start, end, value);  // smooth ramp 0..1
```

**vs fit + clamp**:
- fit + clamp: 线性, 端点突变
- smooth: Hermite (3rd-order polynomial), 端点平滑 (derivative=0)

**production 应用**: mask 生成 / 衰减 / soft falloff. 跟 chramp 同 family — production smooth ramp 工具.

### `sign(dot(direction, normal))` 二分类 idiom

```c
vector dir = normalize(target - @P);
float angle = dot(dir, nml);
float side = sign(angle);  // +1 上侧, -1 下侧, 0 在 plane 上
float sdist = side * abs_dist;  // signed distance
```

**production 应用**: 二分类 (上/下 plane / curve / 任何 reference). 跟 0263 color → group / 0617 ceiling 同 family — 离散分类.

### Mesh blending 万能模板 → 第 10 paradigm

新加 weight 来源 (第 8 种):
- **plane attract via planepointdistance + smooth** (0173)

**10 paradigm 累计**:
- 0157 distance, 0398 importpoint+mix, 0086 chramp(@nage), 0288 mask×blend, 0001 reference, 0494 caramel, 0509 wavefront formula, 0093 noise, 0299 staggered ramp, **0173 plane closed-form** ← 新增

**weight 8 种来源**: distance / noise / mask / age / ramp formula / wavefront formula / staggered ramp / plane closed-form.

### Master class progressive teaching paradigm 综合

corpus master 教学工程 (5+ wrangle 渐进同主题):
- **0173** flatten / flatten1-4 (5 wrangle plane displacement)
- **0448** matrix attractor (8+ wrangle progressive)
- **0622** wet/dry refresh (4-layer solver)
- **0540** RBD lesson 09 (11+ rbdbulletsolver)
- **0049** snow grains (6 popnet)
- **0054** popvop curve attract (6 popnet)

**author 标志**: 同主题渐进多 wrangle/solver/popnet 让 user 看每步加什么. 跟 incremental refinement layout 同源.

## Batch 53 additions

### copytocurves vs copytopoints+orientalongcurve (沿路径分布二选一)

| 节点 | 优势 | 适合 |
|------|------|------|
| **copytocurves** | 自动 align 朝向 curve tangent | 沿路径排列 prefab (列车/骨牌/电缆/链子) |
| **copytopoints + orientalongcurve** | point-level 控制 (P / N / up / pscale) | 需要细粒度控制 |
| **copytopoints (无 align)** | 最快 | prefab 不需要朝向 (球/方块) |

production 选: 沿曲线大量 instance → copytocurves (最简, 0403); 需要 per-point 控制 → copytopoints + orientalongcurve (0054, 0258).

### Trigger sim 3 paradigm (一次性 vs 持续 force injection)

| 方法 | 持续性 | 适合 |
|------|--------|------|
| **pointvelocity** | 一次性 (initial v) | 推骨牌 / kicking ball / 抛物体 (0403) |
| **sopsolver attribtransfer** | 持续每帧 | 持续 force field injection (0497) |
| **popforce / vellum forces** | 持续每帧 | 内置 DOP force, 简单 force vector |

跟 0454 deforming activation 不同 (那是 group-based activation, 不是 force).

### split + add 双轨道 idiom (point-level parallel offset)

```
原 curve
  → copytopoints (group1 line)
  → split → add1 (offset +) + add2 (offset -)
  → merge → polywire → 双轨道
```

vs transform 平移 (整体 rigid translation, 失去局部对齐). split + add = point-level offset, 跟 normal/tangent 局部对齐. 0406 双轨铁路, 双股电缆 production 应用.

### Sim 后 UV/color preservation 2 paradigm (production rare)

```
方法 A: pre-sim — mesh + UV/color → flipsource (粒子化, attr 跟着粒子) → flipsolver → output
方法 B: post-sim — mesh-ify sim → attribtransfer (UV/color from rest geo via xyzdist) → output
```

何时选: 简单 → A; 准确 (反 sim mesh 拉对应 UV) → B. 0412 教学经典, 跟 0299 sim ↔ non-sim lerp 同 family (修复 sim "缺失").

### Agent system 4 件套 (Houdini character animation 标准)

```
agent (角色 packed agent — 动画 + skeleton)
  → agentclip (加载动画片段)
  → agentcliptransitiongraph (状态转换图)
  → testsim_crowdtransition (单 agent crowd sim)
  → agentunpack (转 mesh)
  → effect 链 (boolean / vellum / FLIP)
```

vs KineFX (rigattribwrangle / characterblendshapes 修改 rig low-level): Agent system 播放预制动画 (high-level). 已有动画 → agent; procedural rig 操作 → KineFX. Effect on character → 两者都用 (0415 毒液吞噬).

### popattract in vellumsolver / popsolver

```
vellumsolver:
  forces:
    popgroup (target group)
    popattract (input2 = popgroup)  → 吸引粒子朝指定 group / 位置
```

vs popcurveforce (沿 curve attract) / popvop minpos+xyzdist+primuv 三件套 (VOP 自定义). production 选: 简单朝 group → popattract (0415, 最简); 复杂 → popcurveforce / popvop 三件套.

## Batch 54 additions

### Production interactive 3 件套 (用户输入 input)

| 工具 | 输入类型 | 适合 |
|------|---------|------|
| **drawcurve** | curve geometry (line) | force field / 路径 / contour (0042/0508/0290/0406) |
| **attribpaint** | float/color attribute on mesh | mask / wet/dry / source location (0614/0117) |
| **comb** | direction vector field on mesh | hair grooming / propagation direction / spread direction (0117) |

production 价值: 不靠程序生成 input — user-driven, 反复调整试错. 跟 procedural input (noise / curve generators / scatter) 互补 — 真实 production 项目同时用.

**vs 程序生成**:
- procedural: 一次配好, 千篇一律
- interactive: 艺术控制, 不规律但精准
- 跟 ramp / chramp 同 family — author 用人手画出 random 不能给的细节

### Solver + append to array attribute (animation recording 万能 idiom)

```
solver:
  Prev_Frame (上一帧 array attribute)
  Input_1 (当前帧 P or any value)

  attribvop:
    bind1 = Prev_Frame array
    importpoint1 = Input_1 (current value)
    append (Prev_Frame_array, current_value) → 累加到数组
    bind output → 写回 array attribute
```

**vs trail (multi-frame geometry recording)**:
- trail = N 帧几何拼成 multi-frame geom (每点 = 同一 ID 不同帧 P)
- array attribute = 单 attribute 数组 (`f[]@history`)
- array 更轻量 (只存数据), trail 更通用 (整 geom)

**production 应用**:
- record P over time → playback 不同速度
- record sim values → cache 给后续 SOP 用
- record event → 回放分析

**playback**: `getelement(array, fit_index)` — 按 index (可以是 piece offset / time offset / random) 取对应 frame value.

跟 staggered timing (0488/0526/0148/0299) 同 family — 时间 offset 是 production 通用 idiom.

### pyrosourcespread (directional propagation 罕见高级节点)

```
mesh + attribpaint source (initial spread region)
  → comb direction (用户绘制方向场)
  → pyrosourcespread (内部 sopgeo solver, CUSTOM_RULES 输出)
      → 每帧从 source 向邻居扩散, 沿 direction
  → output spread attribute
  → 后续 polyextrude 等多层生长
```

**实际应用** (虽然名为 pyro 但 cross-domain):
- 火 / 燃烧蔓延 (本意, pyro)
- 冰刺 / 霜 蔓延 (0117)
- 病毒 / 苔藓 / 锈迹 蔓延
- 任何"沿方向扩散" 的 attribute

**vs 其他 spread 工程**:
- pyrosourcespread = 节点内置, directional, GPU
- 0613 VOP color spread = geometry solver 手写, 等向
- 0614 attribute diffusion decay = neighbours + decay
- 0454 BFS group propagation = group-based propagation

production 选: 需 direction + 节点 → pyrosourcespread (高效); 需自定义 → geometry solver.

### Weave (编织) idiom: `@primnum%2` alternating z+/z-

```c
// 编织 z 方向交错核心 idiom
if (@primnum%2 == 0) {
    v@P.z += sin(@curveu*freq_z) * amp_z;  // 偶数 prim 上
} else {
    v@P.z -= sin(@curveu*freq_z) * amp_z;  // 奇数 prim 下
}
```

**架构**: 让相邻 prim 在 z 方向反向 → 自然交叉 → weave/编织效果.

**generalization**:
- `@primnum%N` for N-fold alternating
- `@id%2` for instance alternating
- `(@ptnum / N) % 2` for chunk alternating
- `if (rand(@primnum) > 0.5)` for random alternating

**production 应用**:
- 编织 (草编/竹编/绳编 — 0125)
- 鱼鳞排列
- 屋顶瓦片 alternating
- 任何"相邻反向"的视觉

### Mesh blending 万能模板 → 10 paradigm (final breakdown)

10 paradigm 累计完整列表:

| # | 工程 | weight 来源 |
|---|------|-------------|
| 1 | 0157 | distance (`fit(distance(P, ref), inner, outer, 1, 0)`) |
| 2 | 0398 | importpoint × 3 + mix |
| 3 | 0086 | age (`chramp(@nage)`) |
| 4 | 0288 | mask × blend |
| 5 | 0001 | reference blend with mask |
| 6 | 0494 | caramel pointvop3 morph |
| 7 | 0509 | wavefront formula (`clamp(myPt - 1 + 2*shift)`) |
| 8 | 0093 | noise-driven (`fit(turbnoise(P*freq), srcmin, srcmax, 0, 1)`) |
| 9 | 0299 | staggered ramp (`fit01(@curveu, 1, 100)` per-point start) |
| 10 | 0125 | 2-target staggered (`lerp(P, opinput1, ramp(0..0.5)) + lerp(P, opinput2, ramp(0.5..1))`) |

**production 万能模板已饱和** — `@P = lerp(@P, target_P, weight)` 配 7 种 weight 来源 (distance/noise/mask/age/ramp formula/wavefront/staggered) + 2-target double blend → 几乎所有 mesh blending 都覆盖.

**Master 应熟悉**: 任何"两 mesh 平滑过渡" 任务 → 立刻找对应 paradigm (按 weight 来源选).

### `v@N = v@v` velocity → normal 转换 (1 行 production idiom)

```c
v@N = v@v;
```

**为什么必备**:
- pointvelocity / popsolver 给点配 v (velocity)
- copytopoints / polywire / sweep 期望 N (normal) 来 align 朝向
- 需要 1 行 wrangle 转换

**vs 其他 vector source**:
- `v@N = v@v` — 跟运动方向 align (动态)
- `v@N = normalize(P - center)` — 径向 (静态, 0297/0633)
- `v@N = curlnoise(P)` — noise 方向 (动态)
- `@N` (declare only) — 让上游 normal 节点的 N 流过 (passive bind)

production teaching default: pointvelocity → `v@N = v@v` → copytopoints → align.

### Curve bend ramp(curveu) idiom (草/hair/strand 弯曲)

```c
// VOP 等价
ramp_value = chramp('Bend', @curveu)  // root=0, tip=1 → tip 弯多
P_offset = N * ramp_value * bend_amount
P = P + P_offset
```

或 wrangle:
```c
float bend_factor = chramp('Bend', @curveu);
@P += @N * bend_factor * chf('amount');
```

**production 应用** (4+ paradigm):
- 草吹动 (0115 — root 直, tip 弯)
- hair 飘动
- 触手摆动
- 任何 root 固定 / tip 自由的 strand

`chramp('Size', 1-@curveu)` 反向 = root 粗 tip 细 (草叶尖端形态, 跟 0115/0297 同源).

## Batch 55 additions

### labs:: prefix (SideFX Labs HDA family) — game-dev / production extension

| labs HDA | 用途 |
|----------|------|
| `labs::flowmap` 6 件套 | game-shader flowmap pipeline (0155) |
| `labs::sine_wave` | sin displacement 节点版 (vs wrangle 手写, 0170) |
| `labs::quickmaterial` | 快速 PBR material |
| `labs::thicken` | line → tube 厚度 (0271/0388) |
| `labs::superformula_shapes` | superformula 几何 (0354) |
| `labs::torusknot` | (p,q)-torus knot |
| `labs::sticky_uvs` | UV preservation through sim |

corpus 用 labs:: 比手写多 — production trick: 已有节点不重复造. Master 看 labs:: 知是官方扩展, 优先用.

### Ray-tree growth (闪电/根系/血管 标准 idiom, 4 件套)

```
solver:
  hit_pts wrangle (intersect + addpoint):
      if (intersect(target, P, N*range, hit, u, v) != -1) {
          int newPt = addpoint(0, hit);
          setpointattrib(0, "id", newPt, @id);          // propagate id
          setpointattrib(0, "lifetime", newPt, life);   // per-point lifecycle
          setpointattrib(0, "N", newPt, -@N);           // reverse direction
          removepoint(0, @ptnum);                       // consume source
      }

  delete_existing wrangle (dedup):
      if (findattribval(prev, "point", "id", @id, 0) != -1) removepoint(0, @ptnum);

  lifetime wrangle (lifecycle):
      if (@lifetime == 0) removepoint(0, @ptnum);
      @lifetime--;

  max_arcs wrangle (prim limit):
      if (@primnum > maxBolts-1) removeprim(0, @primnum, 1);
```

**4 件套**: intersect+addpoint / id+findattribval dedup / lifetime accumulator / max_arcs prim limit.

vs graph-based (findshortestpath, 0234): ray-tree = dynamic emergent (动态生长); graph = static (一次算好). corpus 7+ 工程 (0167/0168/0169/0500-0504) — 闪电/电流/血管 production 标准.

### vellum 5 约束 mode (cloth/hair/strut/grain/pressure)

| Mode | 节点 | 适合 |
|------|------|------|
| **cloth** | vellumconstraints (default) | 布料 / 旗帜 |
| **hair** | vellumconstraints (hair mode) | 头发 / 草 |
| **strut** | vellumconstraints (strut mode) | 桁架 / 网状 1D |
| **grain** | vellumconstraints_grain | 颗粒 (跟 cloth 双向耦合) |
| **pressure** | vellumconstraints (pressure mode) | 内部气压 (气球, 0170/0518) |

**vellumconstraintproperty (DOP runtime mod)**: 比 SOP 端更细致, 在 sim 中调约束. 0170/0331/0518 案例.

### Per-curve random truncation (拖尾长度多样化)

```c
int Seed = chi('Seed');
float Min = chf('Min');
float Max = chf('Max');

if (@curveu > fit01(rand(@id + Seed), Min, Max)) {
    removepoint(0, @ptnum);
}
```

**架构**: per-id random → per-curve length 阈值 → curveu 超过删点. 让多 curve 长度自然多样化.

vs max_arcs (限制总数) / chramp(curveu) (改 pscale 不删点) — 三种 truncation 完整覆盖.

**`@curveu` vs `@curveu1`**: 后者是 trail 后 sub-curve u (popnet trail 出来的层级), 前者是原 curve u. production 链 chain 后的层级不同要看清楚.

### subnet 复用 pipeline (HDA 雏形)

把整个 pipeline 封 subnet, 复用给多个 popnet/分支. vs 复制 (单一 vs 独立). production 标志 — 准备 HDA 化的过渡阶段, 跟 0021/0287/0625 production HDA 同 paradigm. 0174 案例.

## Batch 56 additions

### 2D perpendicular normal `n = set(-dir.z, 0, dir.x)` (90° XZ 旋转)

```c
vector p = point(0, "P", @ptnum + 1);
vector dir = normalize(@P - p);
vector n = set(-dir.z, 0, dir.x);  // 90° rotation in XZ plane
@N = n;
```

**3 种 perpendicular normal 计算 paradigm**: `(-dir.z, 0, dir.x)` (0190, XZ 平面 90°, 最快) / `cross(dir, {0,1,0})` (通用 3D) / polyframe (节点, 完整 tangent frame). 平面 curve → 第一种; 3D 任意方向 → cross; 需要 up vector → polyframe.

### Production tool 单节点 multi-mode 万能模板

```
attribvop subgraph: parm1..parmN (N modes) + parm_bind + switch (1..N) → 选择 mode → output
```

单节点 + N parm + switch → user 不必在多节点切换. 跟 progressive paradigm (4-layer solver) 不同 — 后者教学, 这是 user-facing tool. production HDA 雏形 (0192/0617/0089 等案例).

### `chramp(@gradient)` 沿 line 形态控制万能 idiom

```c
f@gradient = (float)@ptnum / (float)(@numpt - 1);
@P.y += chramp('shape', @gradient);  // chramp 改 P.y → 塔形 / lathe profile
@Cd = @gradient;                       // visualize gradient
```

production 应用 5+ paradigm: 0197 塔形 / 0286 旋转楼梯轮廓 / 0254 齿轮齿廓 / 0125 编织粗细 / 0115 草尖 chramp(1-curveu).

chramp 6 种 driver 完整: @curveu / @gradient / @nage / @id / @primnum / @P.y. corpus 50+ 次, 最常用 idiom.

### 嵌套 foreach 多尺度 piece-wise 处理

```
foreach1 (per piece) → foreach2 (per sub-piece) → foreach3 (per detail) → ... (4-6 层)
```

跟 0488/0540 同 paradigm — production 复杂 generator 必备. 等价 GPU 多 kernel 嵌套 (CUDA grid + block + thread). corpus 复杂 generator (塔/桥/树/建筑) 都用.

### `intersect_all` 数命中 (vs `intersect` 单击中)

```c
vector cp[]; vector uvw[]; int prims[];
int hits = intersect_all(0, P, dir, cp, prims, uvw, 0.01, -1);
i@hit_count = hits;

for (int i = 0; i < hits; i++) {
    if (prims[i] != @primnum) i@group_inside = 1;  // 内部 face 检测
}
```

vs intersect (只第一 hit): intersect_all 适合"穿透检测/数命中", intersect 适合"找最近". production 应用: 内部 face 检测 (0206) / 多层光学折射 / 厚壁体内外判断.

### 内部 face 检测 (production fracture/extrude 必备 cleanup)

`if (prims[i] != @primnum) i@group_inside = 1` — 排除自己 + 命中其他 → 内部. 跟 0394 玻璃预切割 cleanup 同 paradigm.

vs SDF inside/outside: intersect_all 几何 ray-based 精确但慢, SDF (volumesample < 0) 体积 distance-based 模糊但快. production 选: 几何精确 → intersect_all; 体积/sim → SDF.

`i@a = hits` debug attribute = 把中间值挂 attribute 是 production debugging 标准 trick.

### labs::autouv + uvlayout (production UV 标准链)

```
geo → labs::autouv (自动 unwrap) → uvlayout (pack UV islands)
```

vs 手动 uvproject + uvunwrap. game asset 必备 — 否则贴图重叠 / 空间浪费. 0197/0214/0625 等 production asset 都用.

## Batch 57 additions

### measure 节点 (mesh 几何分析瑞士军刀)

输出多种 attribute: area / curvature / gradient (slope) / local axes (X/Y/Z). vs 手写 wrangle (neighbours+math), measure 节点 = 多 attribute 一次输出 production 便捷. 0608/0252/0230/0235 案例.

### maskbyfeature (attribute → mask 节点)

```
mesh + attribute → maskbyfeature (chramp UI 配 attribute → 0..1 mask)
```

vs 手写 `fit(attribute, srcmin, srcmax, 0, 1)`: maskbyfeature 节点版 + chramp UI user 直观调; fit 程序固定. 0235 案例.

### intersectionanalysis (find closest pair / intersection)

corpus 罕见 SOP 节点 (< 5 工程), 跟 intersect/intersect_all VEX 同概念但 SOP 节点版. 0221 求两 curve 最近距离, 配 ray + foreach + calc_dist + font display.

### font 节点 (display 数值 in viewport)

把 attribute 数值用 3D 文字 visualize. production debugging — 跟 `i@a = hits` (0206) 同 family 但直接看到数值 (vs spreadsheet).

### Neighbours-based pscale (自适应 size 万能 idiom)

```c
int nbs[] = neighbours(0, @ptnum);
float dist_min = 1e3;
foreach (int nb; nbs) {
    float d = distance(@P, point(0, "P", nb));
    if (d < dist_min) dist_min = d;
}
f@pscale = dist_min;
```

mesh 上密的地方 dist_min 小 → pscale 小; 稀的地方大. vs pcfind/pcopen: neighbours = mesh 拓扑邻居; pcfind = 空间 radius 搜索. mesh 上 → neighbours; 散点 → pcfind. 0230 案例.

### primuv reproject (mesh-mesh 投影 paradigm)

```c
v@P = primuv(1, 'P', 0, pos);  // 把 pos 当 UV, 拉 input1 上对应 P
```

vs ray + copytopoints (几何 ray-based): primuv = UV-based. 几何对应 → ray; UV 对应 → primuv. 0230/0054 案例.

### `@copynum` (copyxform 内置 copy index)

```c
float t = fit(@copynum, 0, 1, -1, 1);  // -1..1 双向
@P += @P * t * sin(@uv.x * freq) * {1, 0, 1};
```

`@copynum` vs `@ptnum`: copynum = copyxform copy index; ptnum = point index. production 编织/instance 区分 (0237 sin twist 编织 用 copynum 区分正反).

`{1, 0, 1}` mask vector = 选维度操作 (XZ 偏移 Y 不动). 跟 `abs(cross(N, {0,1,0}))` 同源 — vector mask 选轴.

### Distance / closest 5 paradigm 完整覆盖

| Paradigm | 节点/函数 | 适合 |
|----------|----------|------|
| **xyzdist** | VEX | 直线 point-mesh |
| **distancealonggeometry** | SOP | 沿 mesh 表面 geodesic (Dijkstra) |
| **surfacedist** | VOP | VOP 端 geodesic |
| **intersectionanalysis** | SOP | 多 geometry 间 closest pair (0221) |
| **neighbours + foreach** | VEX | mesh 邻居 distance (0230) |
| **pcfind / pcopen** | VEX | 空间散点 distance |

production 选: 直线 → xyzdist; 沿表面 → distancealonggeometry/surfacedist; 多 geometry → intersectionanalysis; mesh 邻居 → neighbours; 散点 → pcfind.

---

## Update 2026-05-14 — Official docs deep-read additions

来自 12 轮 Houdini 21 官方文档精读(VEX/model/assets/network 章节,28 子页,76 反常识)。完整笔记:`houdini_vex_session_2026_05_14.md` + `houdini_synthesis_2026_05_14.md`(在 master pack zip 内)。

### Loop block 数学模型 — 官方原文佐证

之前归纳的"feedback=fixed-point / piece=parallel-map / count=truncated"现在有官方背书:

- **Block Begin + Block End 必须配对**;Begin 定义"切片方法"(Points / Primitives / Piece Attribute),End 管"循环数 + 合并"
- **Per-Piece 三种切片**:Points / Primitives / **Piece Attribute(按 name/connectivity 等同值分组)** — 后者最常用,符合"每个语义单元独立处理"
- **Single Pass 参数** = 调试模式,只看某一次迭代的中间结果(不跑完整个 loop)— 已分析项目里若有 SP=on 的设置,大概率是调试残留
- 文档原话:"For-Each Subnet" 已被 Block Begin/End 取代,旧项目里看到 For-Each Subnet 是遗留,识别为"应迁移至 block 形式"

### Compile block 的 3 大约束 — 识别"为什么 compile 失败"

分析项目时若看到 compile block 里包含以下任一,就是 **compile 必失败的元凶**:

| 禁的东西 | 官方推荐改用 |
|---|---|
| `stamp()` 表达式 | 直接传 piece attribute / spare input |
| 按名字引用其他几何(`op:/...`) | **Spare Inputs**(节点上预接的额外输入) |
| 节点参数表达式 `point(0,...)` `prim()` | Attribute Wrangle 里读 |
| Python 节点 | 改 VEX |

**真正杠杆 = "Multithread when Compiled"**(在 Block End 上勾选)— 不勾 = compile 但单线程,白做。识别项目时这是必检项。

### Attribute 4 级覆盖优先级 — 解释"为什么 prim Cd 不显示"

**vertex > point > primitive > detail**,同名时低层级胜。识别架构债时若看到"高层级 attrib 被赋值但下游不生效",查同名是否在低层级被覆盖。

### Packed primitive 4 形态 + render-time 引用本质

| 形态 | 标识 | 架构含义 |
|---|---|---|
| In-Memory | 网络内 packed | 程序化复用,实例化收益开始 |
| Packed Disk | `.bgeo` / Alembic 引用 | 大资产装配,IFD 缩减 |
| Packed Disk Sequence(PDS) | 序列 + 帧插值 | 动画 geometry 实例化 |
| Packed Fragment | `name` attrib 自动切片 | RBD 模拟,每片独立 transform |

**反常识识别**:
- xyzdist / 非均匀缩放 sphere 距离对 packed **不准** — 因为它看 bbox 不看内部 geometry
- 删 packed fragment **不省内存**,原 model 还在
- 改 packed transform → 改 `intrinsic:packedfulltransform`(不 unpack 唯一便宜路径)
- 项目里看到大量 unpack + 处理 + repack 模式 = 实例化收益已被解除

### HDA 命名空间 + Resolution 5 层(分析交付物层)

完整名:`[namespace::]name[::version]`(例:`acme::city_facade::2.3`)

**Resolution 优先级 5 层(歧义引用时)**:
1. 高 version > 低 version > 无 version
2. Scope 受限 > 全局
3. **无 namespace > 有 namespace(反直觉!)**
4. `HOUDINI_OPNAMESPACE_HIERARCHY` 环境变量左→右
5. 该变量支持通配 + 完全限定名做覆盖

**架构识别**:
- 项目里 HDA 没 namespace = 跟内置/第三方碰撞风险高,架构债
- 看到 HOUDINI_OPNAMESPACE_HIERARCHY 设置 = 团队/项目级覆盖策略,健康
- Subnet Scope 限制 Tab 菜单可见性 = 内部辅助 asset 的工程化标志

### 双版本系统 — Houdini 提供两套(很多人只知 namespace)

| 系统 | 哲学 |
|---|---|
| Namespace-based(`mynode::2.0`) | 假设破坏性变更:多版本共存,旧实例保持旧行为 |
| Version field + SyncNodeVersion 脚本 | 假设兼容增量变更:单版本,旧实例自动升级 |

**架构识别**:
- 看到 SyncNodeVersion 钩子 = 工作室级 CI 资产管理,生产成熟度高
- 看到大量 `xxx::1.0` `xxx::2.0` 共存 = namespace 系统,小团队/快速迭代
- 两者并存 = 主推 version field;破坏性变更走 namespace

### Install scope 3 层架构(部署识别)

```
HOUDINIPATH 上扫的 otls/ hda/ 目录:
1. 用户级(HOUDINIPREFS/otls)        — 个人调试 / hotfix(覆盖中央)
2. 项目级($JOB/hda)                  — 项目专属
3. 工作室级(中央网盘,HOUDINI_PATH)  — 全员共享标准库
```

分析项目部署时这是工程化健康度指标:
- 只有用户级 → 单干,无团队基础设施
- 项目级 + 工作室级 = 团队成熟,有资产管理
- 项目级独立 .hda 库(同库装多 asset)= 嵌套依赖管理到位

### 4 模式 wrangle 借用语义(老问题,新原文佐证)

| 模式 | `@ptnum` | `@primnum` |
|---|---|---|
| Points | 当前点 | 含此点的任意一个 prim(或 -1) |
| Primitives | 当前 prim 的**第 0 号 vertex 连接的点** | 当前 prim |
| Vertices | 当前 vertex 连接的点 | 拥有此 vertex 的 prim |
| Detail | 没意义(全局只跑一次) | 同上 |

**反常识识别**:Primitive wrangle 里 `@ptnum` ≠ "该 prim 所有点",只是它第 0 号 vertex 的点。看到 prim wrangle 用 `@ptnum` 做"全 prim 顶点遍历" = 必定 bug,正确用 `primpoints()`。

## Batch 58 additions

### Quaternion twist along curve (精确 curve 旋转 idiom)

```c
// 沿 curve 用 quaternion 实现精确扭曲
vector axis = @N * @curveu * ch('twist');     // tip 扭多 root 不扭
axis += rand(@primnum) * ch('offset');        // per-prim 随机偏移

vector twist = v@up * noise(@curveu * 20) * 3 * chramp('width', @curveu);
                                              // up 方向 twist offset, noise 调制, chramp 控宽

vector4 q = quaternion(axis);                 // axis-angle → quaternion
@P += qrotate(q, twist) * ch('radius');       // 旋转 twist vector by q, 加到 P
```

**vs sin twist (0125/0237)**:
- sin twist: `@P.z += sin(@curveu * freq) * amp` — 简单, 一维方向
- quaternion twist: 完整 3D 旋转, 沿 N axis, 任意 twist 方向 — 精确控制

production 选: 简单二维波纹 → sin; 真实 3D 旋转 → quaternion.

**配合 orientalongcurve / polyframe** 是必备前置 — 没 N + up frame 就没法算 quaternion twist.

### Distance-driven curveu offset + chramp (扩散/燃烧 idiom)

```c
// 距离驱动 curveu 偏移 + chramp 配色
vector source_pos = point(1, 'P', 0);       // 火源 / 扩散源位置
float d = distance(v@Pavg, source_pos);
d = fit(d, ch('inmin'), ch('inmax'), ch('outmin'), ch('outmax'));

float u = -ch('minoffset') + @curveu + d;    // 距离偏移 curveu
u = clamp(u, 0, 1);
@Cd = vector(chramp('col', u));
```

**架构**: distance + fit + curveu offset + chramp = "距离驱动燃烧" production 标准. 距离近的先燃烧, 远的后. 0241 钢丝球案例.

跟 chramp + various drivers 6 paradigm (age/curveu/id/primnum/ptnum/P.y) 之外的 **第 7 种 driver: distance**.

### Animated curve sections (跑马灯 production 标准 idiom)

```c
// per-prim wrap-around uv 范围动画
float min = ch('min');
float max = ch('max');
float speed = @Time * 0.3 * rand(@primnum) + 0.5;
speed *= rand(@primnum) > 0.5 ? 1 : -1;       // 随机方向

min += rand(@primnum);                        // per-prim 起始 offset
max -= rand(@primnum, 123);

min = (min + speed) % 1;                      // wrap 0..1
max = (max + speed) % 1;

if (@uv.x < min || @uv.x > max) {
    removepoint(0, @ptnum);                   // 删除范围外
}
```

**架构**: per-prim uv 范围 + speed + `% 1` wrap-around + remove out-of-range = 跑马灯/流动光带.

**vs traveling pscale (0125 `chramp(@curveu - @Time*0.1)`)**:
- traveling pscale = 整 curve 都看到, 粗细变化
- animated_curve_sections = 只看到 segment, segment 移动

跟 chramp + curveu - Time 同 family 但 segment 更可控. 0245 案例.

### labs::extract_silhouette + trace + cop2net (2D contour 提取)

| 节点 | 输入 | 输出 |
|------|------|------|
| labs::extract_silhouette | 3D mesh + camera/view | 2D silhouette curve |
| trace | 2D image | contour curve |
| cop2net + geometry | sop → cop image | 用 sop 的 cop 处理 |

corpus < 5 用. production game-asset / illustration 流程.

### Production batch export (foreach + rop_fbx + python)

```
mesh group → connectivity (per piece @class)
  → foreach_begin (per piece)
      → attribwrangle (s@path = sprintf('%s', @class))
      → null
      → rop_fbx (export 当前 piece, 用 s@path 命名)
      → python1 (后处理 — 调外部 cmd / 设 metadata)
  → foreach_end
```

**production pipeline 标准**:
- rop_fbx in foreach = per-piece export
- python 节点 = SOP 内调用 python 后处理 (跟 wrangle VEX 互补)
- `s@path` attribute = production naming convention

跟 Lake_House `s@name + s@variation` 命名约定同 family — 命名 = production 基础设施.

**corpus 极少 (< 10)** — 教学工程多, production pipeline 工程少.

### `@Pavg` (attribpromote-derived prim center)

```
mesh point P
  → attribpromote (point P → prim Pavg, mode = average)
  → primitive wrangle: v@Pavg = ... (now available on prim)
```

**vs `primcentroid()` 函数**:
- attribpromote = 提前算好, 多次用
- primcentroid = wrangle 内现算

production 选: 反复用 → attribpromote (避免重复算); 一次用 → primcentroid.

### add 节点 (散点 → wireframe)

```
散点 → add (mode: by group / by attribute / by all / by primitive)
     → 自动连 lines
```

vs connectadjacentpieces (0024): add 是简单 line 连接, connectadjacentpieces 是按距离/邻居数 piece-level. 0241 钢丝球用 add 连成网状.

### attribremap 节点 (节点版 chramp remap)

```
mesh + attribute → attribremap (chramp UI 配 attribute → 新值)
```

vs 手写 wrangle `chramp(name, attr)`: attribremap 节点版 + UI 直观调. 0243 案例 (attribremap_roll).

跟 maskbyfeature (0235) 同 family — attribute → 新 attribute 的节点版 paradigm.

### chramp + driver 7 paradigm 完整覆盖

corpus 现 7 种 chramp driver:

| Driver | 案例 | 适合 |
|--------|------|------|
| @curveu | 0125/0115 | 沿曲线方向 |
| @gradient (`ptnum/numpt-1`) | 0197 | line 形态 |
| @nage / @age | 0086/0345 | POP age lifecycle |
| @id | 0506/0148 | particle ID |
| @primnum | 0527/0258 | alternating |
| @ptnum | 0526 | offset |
| @P.y | 0397 | height |
| **distance** | **0241** ← 新增 | 距离驱动 (扩散/燃烧) |

8 种 driver, production "1 idiom + N driver" 反复出现 pattern.

## Batch 59 additions

### KineFX 4 件套 (production rig animation 标准链)

```
lsystem (or curve)
  → kinefx::rigdoctor (修复 rig: 加 captpath / capt_attr — 没它后续 rigpose 报错)
  → kinefx::rigpose (应用 pose 动画 — bend/twist/scale)
  → orientalongcurve (生成 N/up tangent frame, vellum 必备)
  → attribdelete (清理 KineFX-specific attrs, 给后续 vellum 干净 mesh)
```

**vs Agent system (0415)**:
- KineFX = procedural rig 操作 (low-level), 适合 procedural rig
- Agent = 播放预制动画 (high-level), 适合预制角色动画

**KineFX + vellum cloth 二级动画** (0320):
- rig 动画 → split pin region → copytopoints 叶片 → vellumcloth → vellumsolver
- production 角色配饰 / 叶片 / 衣物标准

corpus 5+ KineFX 工程: 0220/0224/0227/0297/0320.

### `nearpoint + distance + threshold removepoint` (去重标准 idiom)

```c
vector P2 = point(1, 'P', nearpoint(1, v@P));
float d = distance(v@P, P2);
if (d < 0.00001) removepoint(0, @ptnum);
```

**架构**:
- nearpoint(input, P) = input 上最近点的 ptnum
- 0.00001 浮点 threshold = 跟 fuse tol3d=0.001 同 family

**vs 其他去重 paradigm**:
- nearpoint + threshold (0323) = 删除重复点 (精确控制)
- fuse + distancesnap = 合并接近的点 (跟 Lake_House 标准 fuse 0.001 同源)
- pop(array, idx) 不放回 = array random selection

production 选: 删除 → nearpoint+removepoint; 合并 → fuse; 不放回随机 → pop.

### 2 paradigm image → mask (heightfield)

| Paradigm | 来源 | 适合 |
|----------|------|------|
| **mask volumewrangle (height-based)** | 内部 height attr | 高度自驱动 mask |
| **mask_from_cops volumewrangle** | 外部 cop image | 用户指定图案 |

production 选: 程序化 → height-based; 艺术控制 → cop-based.

**heightfield 微节点 family** (production 地形 paradigm):
- heightfield_blur (平滑)
- heightfield_layerclear (清除某 layer, export 准备)
- heightfield_project (投影 mesh → heightfield)
- heightfield_erode (侵蚀模拟, 0252/0142)
- heightfield_paint (用户绘制 mask)
- heightfield_terrace
- heightfield_distort

**vs mesh paradigm**: heightfield 是 2.5D regular grid (高效, GPU-friendly), mesh 是任意 3D (灵活但慢). production 选: 地形 → heightfield; 任意 3D → mesh.

### NDC view-frustum culling (production performance trick)

```c
i@insideCamera = @Frame;  // 默认假设在内, 标记 frame

vector offset = {-0.5, -0.5, 0};  // NDC center 0.5,0.5 → 0,0
vector xformuv = @uv * maketransform(0, 0, offset, {0,0,0}, {1,1,1}, {0,0,0});

// 左右画角外
if (xformuv.x < ch("camera_X")*-0.5 || xformuv.x > ch("camera_X")*0.5) i@insideCamera = 0;
// 上下画角外
if (xformuv.y < ch("camera_Y")*-0.5 || xformuv.y > ch("camera_Y")*0.5) i@insideCamera = 0;
// 远近 clip
if (@uv.z >= ch("far") || @uv.z <= ch("near")) i@insideCamera = 0;
```

**架构**:
- uv (来自 uvtexture NDC mode) = 0..1 屏幕坐标 + depth
- maketransform offset → 中心化
- 检查 x/y 范围 + depth near/far

**vs toNDC / fromNDC VEX 函数**:
- toNDC(camera, P) = world P → NDC (built-in)
- 0328 用 uvtexture NDC mode (节点版, 等价)

production 应用: 大场景 cull viewport 外的点 → 性能大幅提升 (10-100x). corpus 罕见但 production game-asset / large-scene 必备.

### Solver history-aware accumulator (production "永久保留" trick)

```c
// solver attribwrangle1 (point class)
if (@insideCamera == 0 && @opinput1_insideCamera != 0) {
    @insideCamera = @opinput1_insideCamera;  // 保留上一帧值
}
```

**架构**:
- 当前 frame outside (insideCamera == 0) AND 上一帧 inside (opinput1_insideCamera != 0)
- → 用上一帧值覆盖当前 0
- → "曾经 inside" 永远 inside

**production 价值**:
- 防止相机移动后某点突然消失
- 跟随物体的粒子, 出视野后不被永久删除
- 类似 0454 BFS group propagation in sopsolver, 但 0328 是 history merge

**通用模板**:
```c
// 保留上一帧某 attribute
if (curr_value == default && prev_value != default) {
    curr_value = prev_value;
}
```

适合任何"一旦满足, 永久保留" 任务: 曾经在视野内, 曾经被 sim 影响, 曾经被涂色, 等.

### `i@insideCamera = @Frame` (用 frame number 作 boolean)

```c
i@insideCamera = @Frame;  // 当前 frame 数, 不为 0 即 true
```

**为什么用 @Frame 而不是 1**:
- 后续 solver 可以检查 "上一帧的值" → 知道是哪一帧 inside
- @Frame 自带 timestamp, 比 boolean 1 信息量更多

production trick: 用 timestamp 作 multi-purpose flag (boolean + 时间戳 二合一).

## Batch 60 additions

### detangle 节点 (反穿插, corpus 罕见)

```
multi-curve (可能穿插)
  → rest (锁定 rest pose)
  → detangle (一次)
  → repeat_begin (block_begin, iterative)
  → detangle (每次循环)
  → repeat_end
```

**vs 其他 line 物理 paradigm**:
- vellum hair (0507) = sim-based, 慢但精确
- wire solver (0145) = sim-based, strand 专门
- detangle = 几何处理, 快但仅"避免穿插"

production 选: 长 sim → vellum hair / wire; 静态去穿插 → detangle. 0330 案例.

### Production sim cache 三件套 (rbdio / vellumio / flipio)

| 节点 | sim 类型 | 用途 |
|------|---------|------|
| rbdio | RBD | 0394 玻璃 sim cache |
| vellumio | Vellum | 0333 球体蠕动 sim cache |
| flipio | FLIP | (类似, 跟 0290 案例同 family) |

**production 必备**: 长 sim 必须 cache. vs filecache (通用): rbdio/vellumio/flipio 是 sim-aware (知道 packed pieces / vellum geometry / FLIP particles 内部结构).

### vellumrestblend (DOP 内 rest pose blend)

```
vellumsolver:
  forces:
    vellumrestblend (跟 SOP 端 lerp(P, rest_P) 同概念但 DOP 内每帧 sim 内做)
```

**vs SOP 端 lerp(@P, opinput1_P)** (0299):
- SOP 端: sim 完后再 blend 一次
- DOP 内 vellumrestblend: 每帧 sim 中 blend, 实时影响 sim

production 选: 简单后处理 → SOP lerp; sim 中保持形状 → vellumrestblend. 0333 案例.

### Lambertian toon shading (chramp 第 9 种 driver — Lambertian)

```c
@Cd = dot(@N, chv('light'));    // Lambertian
@Cd = clamp(@Cd, 0, 1);
@Cd = chramp('ramp', @Cd);      // toon shading 离散化
```

**production toon idiom** — chramp 离散化是 production "把连续值变阶梯" (toon/contour/step) 万能.

**chramp + driver 9 paradigm 完整覆盖**:
- @curveu / @gradient / @nage / @id / @primnum / @ptnum / @P.y / **distance (0241)** / **Lambertian (0335)**

production "1 idiom + 9 driver" — chramp 是 corpus 50+ 次最常用 idiom.

### popwind + popattract + staticobject 3 件套 (流动衰减)

```
popsource → popsolver
              → popwind (全局推)
              → popattract (input2 = sphere, 吸)
              → staticobject (sphere as collider, 阻挡)
```

**架构**: 推 + 吸 + 阻挡 → 平衡 → 流动衰减.

**popforce 6 paradigm 复合应用** — 单 force 简单, 复合丰富. 跟 0415 popattract+vellum / 0290 popcurveforce+FLIP 同 family.

### DOP collider 3 paradigm

| 节点 | 适合 |
|------|------|
| **staticobject** | 任意 mesh as static collider (0337/0049/0512) |
| **rbdpackedobject** | 动态 RBD (碰撞 + 自身物理) |
| **groundplane** | 无限平面 collider |

production 选: 任意 mesh static → staticobject; 动态 RBD → rbdpackedobject; 大 ground → groundplane.

### `@Cd = relbbox(@P)` (1 行配色 production 极简)

```c
@Cd = relbbox(@P);  // 0..1 vec, 直接当 RGB
```

**用途**:
- 不写 chramp / 不算光照 / 不读 texture
- 1 行得到 bbox 渐变色 (类似 vis preview)
- production 简化 — 跟 0009 / 0024 节点级简单工程同 family

### `pointprims[0]` per-curve noise seed

```c
int ps[] = pointprims(0, @ptnum);
int p = ps[0];                                  // 该 point 所属第一个 prim
vector offset = xnoise(v@P + set(p,p,p) - {.5,.5,.5});
v@P += offset;
```

**架构**:
- pointprims = point 所属 prim 数组
- ps[0] 作 noise seed → per-curve noise
- → 不同 curve 不同 noise pattern (但同 curve 内 smooth)

跟 `rand(@primnum)` per-prim seed 同 family (0237 sin twist `rand(@primnum)`), 但用 prim index 而不是 random.

### chramp 离散化总结 (production 万能 idiom)

任何"连续值 → 阶梯" 任务都可以用 chramp:
- toon shading (0335 — Lambertian → 离散色阶)
- 等高线 (0263 — color → group, 等高色)
- contour (0617 — surfacedist + ceiling, 等价 chramp 离散)
- 燃烧色阶 (0241 — distance → chramp)
- 形态控制 (0197 — gradient → chramp shape)

→ chramp = production 离散化 / step effect / shape control 万能 idiom, corpus 50+ 次.

## Batch 61 additions

### sopsolver 在 DOP 的 5 种正交用途 (新增 ray adherence)

corpus 分析现 sopsolver 5 paradigm:

1. **Force injection** — attribtransfer SOP field → DOP pieces (0497)
2. **Constraint mod** — sort/delete/wrangle 改 attached_relationship_geometry (0540, 0533)
3. **Group propagation** — BFS nearpoints + setpointgroup on dop_geometry (0454)
4. **Sim geometry mod** — attribvop curlnoise 直接改 P (0013 filament)
5. **Ray adherence** ← **新 (0348)** — sopsolver 内 `ray (input2 = target_mesh)` 把 sim 粒子投回 mesh 表面 → "粒子贴 mesh"

**5 种正交分类轴 (what is mutated / how)**:
- v (force injection)
- constraint (constraint mod)
- group membership (group propagation)
- P 直接修改 (geometry mod)
- P via ray projection (ray adherence)

production master 看 sopsolver 内部第一眼 → 输出口接的什么属性 + 内部用的什么节点 (attribtransfer / sort / nearpoints / attribvop / ray) → 立刻分类.

### Distance-driven scatter density (中心密边缘稀)

```c
// pre-scatter wrangle (on grid/mesh)
float scatter = fit(length(v@P), max_d, 0, 0, 1);  // 中心 1, 边缘 0
scatter = chramp('curve', scatter);                  // chramp 控曲线
v@Cd = scatter;
```

```
mesh → wrangle (Cd = density)
     → scatter ("Density Attribute" mode, attr = Cd)
     → 中心密边缘稀
     → voronoifracture
```

**Cd 双重用** (production trick):
- Cd 当 visualize color
- Cd 当 scatter density attribute
- 两用一个 attribute, 节省

→ production "中心碎得细, 边缘碎得粗" RBD 标准 (0342). 配 i@active 可做 staggered activation.

### `i@active` (Bullet RBD activation 内置约定)

```c
// per-piece wrangle (group='active')
i@active = 1;  // 标记激活
```

**Bullet RBD 内置约定**:
- `i@active = 1` → 参与 sim (落下)
- `i@active = 0` → 静止 (stuck in place)
- 配 group + animated activation = staggered RBD

跟其他 Bullet RBD 内置 attributes:
- `@deforming` — 是否 deformable
- `@mass / @density` — 物理属性
- `@v / @w` — 初始速度 / 角速度

production 必懂 — 跟 0454 deforming activation 同 family.

### Color channel encoding (RGB 各存一个 attribute)

```c
// scalar → red
v@Cd = set(f@infection, 0, 0);  // 0..1 infection → red

// red → scalar
f@infection = v@Cd.r;
```

**用途**:
- 用 attribpaint 涂 color (用户 input)
- color 在 SOP 间传 (visual + data 二合一)
- 多 attribute 用 RGB 各存一个 (节省, 无需多 detail attr)

**production trick** — 把 visualize 跟 data 二合一, 减少 attribute 数量. 0343 案例.

### Modular asset assembly (production 节点级)

```
prefab1 → transform → copy → mirror
prefab2 → transform → copy → mirror
prefab3 → transform → copy
merge → final
```

**特点**:
- 0 wrangle 30+ 节点
- 全用现成 SOP 节点
- copy + mirror = 1 prefab → 多对称 instance
- 跟 Lake_House 项目 (procedural 建筑 — modular 组合) 同 paradigm

**命名节点 production trick**:
- polyextrude 命名为 `thickness` / `width` (vs 默认 polyextrude1/2)
- 让其他工程师/未来自己看节点名就知道用途
- 跟 production HDA naming (0021/0287) 同 family

### only_source_from_X (production source emit zone 限定)

```
mesh → delete (条件: 留 X 区域, e.g., bottom Y < threshold)
     → null (production naming: only_source_from_bottom)
     → popsource emit
```

**vs boolean inside region** (0166): delete 简单删除 (不规则 mesh), boolean 几何 intersection (规则 box/sphere).

production 选: 简单条件 → delete; 几何 intersection → boolean.

### 5 paradigm sopsolver 在 DOP 总结表

| Paradigm | 核心节点 | 适合 |
|----------|---------|------|
| 1. Force injection | attribtransfer (SOP→DOP attr) | velocity/force inject (0497) |
| 2. Constraint mod | sort/delete/wrangle 改 constraint | 改 RBD constraint (0540) |
| 3. Group propagation | nearpoints + setpointgroup | BFS 激活 (0454) |
| 4. Sim geometry mod | attribvop 改 P | 改 sim geom (0013) |
| 5. Ray adherence | ray (input = target mesh) | 粒子贴 mesh 表面 (0348) |

**Master**: 看 sopsolver 内部主要节点 → 立刻分类用途.

## Batch 62 additions

### enablesolver in PRESOLVE (Bullet RBD sim 启停控制, corpus 罕见)

```
rbdbulletsolver:
  forces:
    PRESOLVE (subnetoutput) ← enablesolver1 ← sopsolver (输入条件)
```

**架构**:
- enablesolver 输入 condition (从 sopsolver / parm / time)
- 输出到 PRESOLVE → 决定 sim 这一帧是否启用
- 当 condition 满足 → enable; 否则 → disable (sim 暂停)

**vs 其他 timing paradigm**:
- enablesolver = DOP 内全局 sim 启停 (精确, 0422)
- timeshift = SOP 端 freeze sim (简单, 但全局)
- group + i@active = per-piece activation (0342/0454, 细粒度)

production "时间触发 sim" 标准 — 配 sopsolver pointvelocity 实现 "时间到瞬间激活 + 注入 v".

### Production character animation 3 paradigm (完整覆盖)

| Paradigm | 输入 | 用途 | 案例 |
|----------|------|------|------|
| **KineFX** (rigdoctor + rigpose + orientalongcurve) | procedural curve | 程序化 rig 操作 (low-level) | 0220/0224/0227/0297/0320 |
| **Agent system** (agent + agentclip + agentcliptransitiongraph) | 预制 agent + 动画 clip | 角色动画播放 (high-level) | 0415 venom |
| **Mixamo + capture** (file → capture → captureoverride → bonedeform) | FBX rig + skin mesh | 导入 FBX 角色 + Houdini 内 deform | 0427 |

**production 选**:
- 程序化 (curve → rig) → KineFX
- 预制角色 + 标准动画 → Agent system
- 导入 FBX (Mixamo) + Houdini 内变形 → capture + bonedeform

3 paradigm 完整覆盖 production character animation.

### Mixamo standard rig 60+ bones 结构

```
mixamorig_Hips (root null)
  → mixamorig_Spine → Spine1 → Spine2
                              → mixamorig_Neck → Head
                              → mixamorig_LeftShoulder → LeftArm → LeftForeArm → LeftHand
                                                                                → 5 fingers × 4 joints
                              → mixamorig_RightShoulder → ... (mirror)
  → mixamorig_LeftUpLeg → LeftLeg → LeftFoot → LeftToeBase → LeftToe_End
  → mixamorig_RightUpLeg → ... (mirror)

每个 bone:
  - null (rig 端 control point)
    - control (visualize)
    - cregion (capture region)
    - point (add point)
  - bone (实际 bone 节点)
    - bonelink (parent link)
```

**Houdini bone 6 件套**: null + control + cregion + point + bone + bonelink. production 必懂 — 看 Mixamo FBX 导入立刻识别这 6 件套.

### capture + captureoverride + bonedeform (Houdini bone deform 标准链)

```
mesh (file) → capture (auto-skin, 按 cregion 给 capture weight)
            → captureoverride (手动调 capture weights)
            → bonedeform (apply bone transforms 变形)
            → output deformed mesh
```

vs KineFX (0320 rigdoctor + rigpose): KineFX 是 procedural, capture+bonedeform 是 traditional bone-skin paradigm. corpus 罕见 (< 5 完整 character) 但 production game industry 标准.

### Production sim cache 三件套对比 (vs filecache)

| 节点 | 类型 | 适合 |
|------|------|------|
| **filecache** | 通用 | 任何 SOP 数据, 不针对特定 sim |
| **rbdio** | RBD-aware | RBD packed pieces, sim-specific metadata (0394) |
| **vellumio** | Vellum-aware | Vellum cloth/grain/strut/hair (0333) |
| **flipio** | FLIP-aware | FLIP particles + surface (类似) |

production 选: 通用数据 → filecache; sim-specific → 三件套 (sim-aware 知道内部结构).

### labs::spiral / 多 production geometry HDA family 完整列表

| labs HDA | 用途 | 案例 |
|----------|------|------|
| `labs::sine_wave` | sin displacement | 0170 |
| `labs::spiral` | spiral curve / mesh | 0428 |
| `labs::torusknot` | (p,q)-torus knot | 0354 |
| `labs::superformula_shapes` | superformula 几何 | 0354 |
| `labs::flowmap` 6 件套 | game-shader pipeline | 0155 |
| `labs::quickmaterial` | PBR material | 大量 |
| `labs::thicken` | line → tube | 0271/0388 |
| `labs::sticky_uvs` | UV preservation through sim | 类似 |
| `labs::quickrigid` | 快速 RBD setup | 类似 |
| `labs::extract_silhouette` | mesh → 2D silhouette | 0245 |
| `labs::autouv` | 自动 UV unwrap | 0197 |

**production master 必懂**: labs:: 是 SideFX Labs 官方扩展 family, 大幅简化 game-dev / production tasks. 看到 labs:: 知道是官方扩展, 优先用.

### Production game asset pipeline (完整链)

```
几何 (procedural) → UV (uvproject + uvtransform / autouv + uvlayout)
                  → texture / material (labs::quickmaterial)
                  → rop_fbx (export to FBX)
                  → Unity / Unreal import
```

**vs Houdini 内 sim cache**: production game asset → FBX export 给游戏引擎; sim cache → Houdini 内继续用.

corpus 5+ production game asset 工程: 0247/0246/0203/0345/0349/0428 — 真正"导出给游戏" 完整链.

## Batch 63 additions

### Production character animation 4 paradigm (新增 fbxcharacterimport)

| Paradigm | 节点 / HDA | 用途 | 案例 |
|----------|-----------|------|------|
| **KineFX** (procedural) | rigdoctor + rigpose + orientalongcurve | procedural rig 操作 | 0220/0224/0227/0297/0320 |
| **Mixamo manual** | file → capture + captureoverride + bonedeform (60+ bones) | 完全手动 (production-grade 控制) | 0427 |
| **fbxcharacterimport HDA** | `kinefx::fbxcharacterimport` (一节点) | 快速 prototyping (vs 手动 60+ 节点) | 0450 ← 新 |
| **Agent system** | agent + agentclip + agentcliptransitiongraph + crowdtransition | 预制角色动画播放 | 0415 |

**production 选**:
- 程序化 (curve → rig) → KineFX
- 完全手动 production-grade → Mixamo manual
- 快速原型 → fbxcharacterimport HDA
- 预制角色 + 动画 → Agent system

4 paradigm 完整覆盖 production character animation.

### `collisionsource` (mesh → VDB collision 标准节点)

```
mesh → collisionsource → VDB collision representation → staticobject (DOP)
```

**vs 手动 vdbfromparticles / vdbfrompolygons**:
- collisionsource = production 一节点搞定 (内部多步)
- 手动 vdb 链 = 控制更细但繁琐

跟 staticobject (DOP collider) / rbdpackedobject / groundplane 同 family — DOP collider 准备 标准.

### Production "准备阶段" 工程 paradigm

工程不是 self-contained, 是 multi-stage pipeline 一环:

```
Stage 1: 导入 / 准备 (0450 fbxcharacterimport + collisionsource, 准备 character + collider)
Stage 2: 数据传给下游 (geo_, vdb_collition, source 多 null outputs)
Stage 3: 下游 sim 工程引用这些 outputs (e.g., pyro emit at source)
```

**production 标志**:
- 工程 没 final viewport effect (只是中间数据)
- 多 null outputs (named for downstream)
- 跟 0247 batch FBX export / 0428 Unity export 准备 同 family

**Master 看 production "准备阶段" 工程** 知道:
- 不是 demo, 是 production pipeline 一环
- output 命名 / 节点结构 follow downstream 接口
- 跟 multi-stage 工作流配合

### Mesh blending 万能模板 → 11 paradigm (新增 distance-mask + sort-aligned)

11 paradigm 累计:

| # | 工程 | weight 来源 |
|---|------|-------------|
| 1 | 0157 | distance |
| 2 | 0398 | importpoint × 3 + mix |
| 3 | 0086 | age (chramp(@nage)) |
| 4 | 0288 | mask × blend |
| 5 | 0001 | reference blend |
| 6 | 0494 | caramel pointvop3 morph |
| 7 | 0509 | wavefront formula |
| 8 | 0093 | noise-driven |
| 9 | 0299 | staggered ramp |
| 10 | 0125 | 2-target staggered |
| 11 | **0455** | **distance-mask + sort-aligned** ← 新 |

第 11 paradigm 区别: 用 sort + scatter 拓扑对齐 + distancefromgeometry × 2 复合 mask.

### `distancefromgeometry` × N (复合 distance mask)

```
mesh → distancefromgeometry1 (target = mesh1) → mask1
     → distancefromgeometry2 (target = mesh2) → mask2
     → attribadjustvector blend_positions (用 mask1 + mask2 复合 blend P)
```

**vs 单 distance mask** (0241 distance + chramp): 双 mask = 复合控制 (例如 "distance from A AND distance from B" 组合).

production 应用: 多 source 影响 / 复合 mask / 距离场组合.

### `maskfromgeometry` (distancefromgeometry alias HDA-like rename)

`maskfromgeometry` = `distancefromgeometry` 重命名版本. production HDA-like rename — 让节点名直接说"输出 mask".

跟 production 命名约定 (`thickness`/`width`/`only_source_from_bottom`/`Magic_Projectile_01`) 同 family — 命名 = production 基础设施.

### CHOPnet (Channel OPerator) — Houdini 4 大 OP 之一

```
CHOPnet:
  geometry1 (拉 SOP 数据进 CHOP)
  spring (给 channel 加 spring 物理 — wave + decay)
  OUT_channel (输出回 SOP)

回 SOP: channel 节点 (拉 chop OUT_channel 数据)
```

**Houdini 4 大 OP**:
- **SOP** (Surface OP) — geometry processing
- **DOP** (Dynamics OP) — sim
- **COP** (Composite OP) — image processing
- **CHOP** (Channel OP) — 1D 时间序列 / 音频 / 动画曲线

**CHOP 用途**:
- spring CHOP = production "弹性 overshoot" 物理 (vs lerp 直接) 0030/0153/0398/0458
- noise CHOP = procedural 时间 noise
- audio CHOP = 音频驱动动画 0076/0077

**corpus 罕见 (< 10 CHOP 工程)** — CHOP 是 master 必懂的"被忽视的"OP.

### Boolean-driven emit (production 标准组合)

```
mesh + 动态 displaced sphere → boolean (intersect / A-B) → 接缝 mesh
                                                         → popsource emit at 接缝
                                                         → popnet
```

**架构**:
- mesh + 动态形状 boolean → 接缝随时间变化
- popsource emit at 接缝 → 持续 emit (动画)
- 接缝 mesh "崩解" 效果

**vs SDF-based emit** (0166 silhouette inside scatter):
- boolean = 几何精确接缝
- SDF inside = 体积模糊区域
- production 选: 接缝精确 → boolean; 体积区域 → SDF

跟 0042 cloth tear / 0166 silhouette / 0394 玻璃预切割 / 0300 boolean contour 同 family — boolean 是 production "用几何控制 effect 区域" 通用工具.

## Batch 64 additions

### Production sim 4 件套 (4 大 sim 类型完整对比)

| Sim | 4 件套 | 案例 |
|-----|--------|------|
| **Pyro** | smokeobject + pyrosolver + volumesource + gasresizefluiddynamic | 0483 干冰雾气 |
| **FLIP** | flipsource + flipobject + flipsolver + force (popcurveforce 等) | 0290 跟随曲线 |
| **Vellum** | vellumconstraints (5 mode) + vellumsolver + (forces) + (vellumio cache) | 0480 vellum lab |
| **RBD (Bullet)** | rbdmaterialfracture + rbdconfigure + rbdbulletsolver + rbdio cache | 0540 RBD lesson |

production master 看 sim 类型立刻识别 4 件套. 缺一件 → sim 不会跑 / 跑错.

### `gasresizefluiddynamic` (production pyro 必备)

```
pyrosolver:
  smokeobject (容器)
  → gasresizefluiddynamic (动态调容器尺寸 — 跟 pyro 流动)
  → staticobject (collider)
  → volumesource (SOP source)
```

**架构**:
- 默认 smokeobject 容器固定尺寸
- 流体超出 → 切断
- 容器太大 → 浪费内存 (空 voxel)
- gasresizefluiddynamic 解决两个问题: 自动跟流体扩展 + 收缩到必要范围

**vs vdbactivate (0280)**: 都是稀疏优化, 但 vdbactivate 用 mesh 边界, gasresizefluiddynamic 用 sim 内容. corpus 5+ pyro 工程必有 gasresizefluiddynamic.

### Multi-OUT vellum lab (production HDA 雏形)

0480 6+ OUT 让 downstream 选组件:
- OUT_VELLUM_FLUIDS_MESH
- OUT_VELLUM_GRAINS
- OUT_AIRBUBBLES
- OUT_GEL
- OUT_BALLS
- OUT_VELLUM_BALOONS / BALOONS1

**vs single OUT**: multi-OUT 让用户选需要的, 不强制全部输出 (节省 cache / cook time).

跟 0021 Bridge A 8 OUT / 0494 焦糖 5 OUT / 0287 bottle HDA 同 family — production HDA multi-OUT 标志.

### vellum 多 mode 同时 (production-grade complex sim)

```
vellumsolver1: vellumcloth + vellumpressure (球体充气) — cloth + pressure
vellumsolver2: vellumconstraints_grain (颗粒)
vellumsolver3: vellumconstraints_grain (颗粒 × 2)
```

production-grade vellum 工程标志 — 多 solver 同时跑不同 mode (vs 单 solver 单 mode 的 demo).

### KineFX 5 paradigm 完整覆盖 (新增 jointdeform pair)

| Paradigm | 节点 / HDA | 用途 | 案例 |
|----------|-----------|------|------|
| 1. **KineFX procedural** | rigdoctor + rigpose + orientalongcurve | procedural rig | 0320 |
| 2. **Mixamo manual** | file → capture + captureoverride + bonedeform | 完全手动 production-grade | 0427 |
| 3. **fbxcharacterimport HDA** | kinefx::fbxcharacterimport (一节点) | 快速 import | 0450 |
| 4. **fbxcharacterimport + jointdeform pair** ← 新 | fbxcharacterimport + kinefx::jointdeform | 完整 character HDA pipeline | 0486 |
| 5. **Agent system** | agent + agentclip + agentcliptransitiongraph + crowdtransition | 预制角色动画 | 0415 |

**production 选**:
- 程序化 → procedural
- 完全控制 → Mixamo manual
- 快速原型 → fbxcharacterimport HDA
- **标准 character pipeline → fbxcharacterimport + jointdeform pair**
- 预制角色 → Agent system

### Production "复杂 mesh 拆分" 标准链 (准备阶段 工程)

```
file (FBX/OBJ import)
  → clean (remove duplicates / fix topology)
  → matchsize (规整 bbox)
  → split × N (按 group / material / part 多层级拆)
  → subdivide / normal / 各种处理 per part
  → material × N (assign material)
  → collisionsource (生成 collider)
  → 多 null outputs (给 downstream sim)
```

**production 准备阶段** = multi-stage pipeline 一环, 不是 self-contained.

跟 0450/0428/0247/0487 production 准备阶段 同 family. corpus 5+ 准备阶段工程.

### `pointdeform` (mesh-deform-mesh 标准节点)

```
target mesh + capture geometry + deform geometry → pointdeform → deformed target
```

**vs KineFX bonedeform** (0427/0486): bonedeform 用 bones 驱动 mesh, pointdeform 用 mesh 驱动 mesh (无 bones). 更通用, 适合任意 mesh-mesh deform (非 character).

### `material` 节点 (production material assignment)

```
mesh + material 路径 → material 节点 → per-prim material
```

vs labs::quickmaterial (PBR HDA): material 是 assign existing material, labs::quickmaterial 是创建 PBR material. production game asset 都用.

### Production 准备阶段 工程 (multi-stage pipeline 标志)

corpus 5+ 准备阶段工程:
- 0247 batch FBX export (准备)
- 0428 Unity 飞弹 (准备)
- 0450 character collider (准备)
- 0487 tire mesh + collider (准备)
- 0480 vellum lab (cache + outputs)

**production 标志**:
- 工程 没 final viewport effect (只是中间数据)
- 多 null outputs (named for downstream)
- 跟 sim / final render 工程不同 paradigm

→ Master 看 production "准备阶段" 工程立刻识别 — 不是 demo, 是 production pipeline 一环.

## Batch 65 additions

### Production game-ready 5 件套 (game asset 完整 pipeline)

| 阶段 | 节点 / HDA |
|------|-----------|
| 1. **几何** | grid + boolean × N + mountain × N |
| 2. **Cleanup** | labs::delete_small_parts × N (清除碎屑) |
| 3. **UV** | foreach + labs::autouv (per piece) + uvlayout (pack) |
| 4. **Material** | labs::quickmaterial (PBR) |
| 5. **Sim** | rbdmaterialfracture + rbdbulletsolver + rbdio cache |

production "game-ready asset" 完整工程标志. 跟 0499 / 0428 / 0345 / 0349 / 0197 / 0214 / 0625 同 family.

### `labs::delete_small_parts` (production fracture cleanup 必备)

```
fractured mesh → labs::delete_small_parts (size threshold) → 删除小碎屑
```

production fracture 后总有"碎屑"piece (太小, 浪费 sim/render 资源), labs::delete_small_parts 清除. corpus < 5 用 — production game-asset 必备.

### labs:: HDA family 12+ HDA 完整覆盖

| labs HDA | 用途 |
|----------|------|
| sine_wave | sin displacement (0170) |
| spiral | spiral curve / mesh (0428) |
| torusknot | (p,q)-torus knot (0354) |
| superformula_shapes | superformula 几何 (0354) |
| flowmap (6 件套) | game-shader pipeline (0155) |
| quickmaterial | PBR material (大量) |
| thicken | line → tube (0271/0388) |
| sticky_uvs | UV preservation through sim |
| quickrigid | 快速 RBD setup |
| extract_silhouette | mesh → 2D silhouette (0245) |
| autouv | 自动 UV unwrap (0197) |
| **delete_small_parts** ← 新 | fracture cleanup (0499) |

production master 看到 labs:: 立刻识别官方扩展.

### VOP matrix construction (corpus 罕见高级 idiom)

```
attribvop:
  geometryvopglobal (P)
  → normalize (P → axis 1)
  → cross(axis1, const) → axis 2
  → cross(axis1, axis2) → axis 3
  → vectomatx(a1, a2, a3) → 3x3 rotation matrix
  → m3tom4 → 4x4
  → translate(P) + multiply → final 4x4 transform
  → bind output
```

**VOP linear algebra family**:
- `vectomatx` = (vec1, vec2, vec3) → 3x3 (columns)
- `m3tom4` = 3x3 → 4x4 (加 translate)
- `m4tom3` = 4x4 → 3x3
- `invert` = 矩阵求逆
- `determinant` = 行列式 (检查可逆)
- `multiply` = matrix multiplication

**vs 其他 transform 表示**:
- VOP matrix = 完整 4x4 transform (rotation + translate + scale)
- quaternion (0243) = rotation 表示更紧凑
- dihedral (0258) = 2 vector 间 rotation
- maketransform = wrangle 函数版

production 选: 完整 4x4 → VOP matrix; 单 rotation → quaternion; SOP 端 → maketransform.

### Apply transform via importpoint + invert + multiply (rig follows idiom)

```c
// VOP equivalent
attribvop:
  geometryvopglobal (P, current geometry)
  → importpoint(input1 = upstream_transform_geom, "transform", ptnum)
  → invert (取逆)
  → multiply (P * inverse_transform)
  → output P
```

**用途**:
- 上游 mesh 有 transform attribute (从 VOP matrix construction)
- 下游 mesh 通过 importpoint 拉 + invert + multiply 应用
- → 多 mesh 共享同一 transform (rig follows / leader-follower)

production "一个 transform 驱动多 mesh" 通用 idiom.

### `displacenml` VOP node (production normal-based displacement)

```
attribvop:
  geometryvopglobal (P, N)
  → bind noise → displacenml(P, N, scale, noise) → output P
```

vs 手写 wrangle `@P += @N * noise * scale`: VOP 节点版, production 标准 (vs wrangle 灵活但繁琐).

### `object_merge` (production 跨工程数据传递)

```
工程 A (sim/准备) → OUT null
工程 B → object_merge (op:/path/工程A/OUT) → 引用 A 的 output
```

production multi-stage pipeline 必备 — 上游准备工程 + 下游引用工程.

简化工程 (0490 只剩 object_merge) = production 引用端 paradigm.

### Production multi-stage pipeline 完整 paradigm

```
Stage 1: 数据准备 (file + clean + matchsize, character setup, mesh prep) ← 0450/0428/0487 准备阶段
Stage 2: Sim 工程 (vellum/pyro/RBD/FLIP) ← sim 工程
Stage 3: 引用 + 后处理 (object_merge + render/export) ← 0490/0247
Stage 4: Export (rop_fbx + python) ← 0247/0428
```

corpus production master 必懂 — 单工程是 self-contained, multi-stage pipeline 才是 production-grade.

## Batch 66 additions

### `volumevelocityfromcurves` (drawcurve → velocity field 标准节点)

```
drawcurve / line geom + bound vdb
  → volumevelocityfromcurves
  → velocity field (vdb)
  → volumevelocity (vdb → velocity attribute)
  → dopnet flipsolver / popsolver
```

corpus 罕见 — production "user curve → velocity field" 标准节点. vs popcurveforce (0290 用 curve 作 force): volumevelocityfromcurves 是 volume-based.

### Image-driven sim (image → multi-attribute → sim)

```
mesh + texture
  → uvproject → attribfrommap → @Cd (color from image)
  → wrangle (Cd 拆分):
        @density = clamp((white_length - Cd_length) * scale, min, max)
        @viscosity = Cd.x * max_viscosity
        @mass = some_attribute
  → flipsolver (用这些 attribute 决定流体行为)
```

production "image RGB 通道分别用作不同 attribute" idiom. 跟 0166 popvop pcfilter velocity / 0204 image-to-wall / 0244 image-to-mesh 同 family — image-driven paradigm.

### Image-driven extrude (Cd.r → @zscale → polyextrude)

```c
// per-prim wrangle
f@scale = @Cd.r / 15 - 0.025;
float random = fit01(float(@primnum) / float(@numprim), 0, 1);
@zscale = @Cd.r * (pow((@scale * random * 3), 3) + 0.02);
```

```
mesh + image color → 上述 wrangle → polyextrude (用 @zscale 作 distance)
```

production "image color → geometry height" 通用 idiom. 跟 0204/0244/0327 同 family.

**Cd 单 attribute 串多 wrangle** = production data 流 trick (data 经多步处理累积).

### `helix` attribvop (sin/cos along ptnum)

```c
// 等价 wrangle
float t = float(@ptnum) / float(@numpt);
float angle = t * chf('parm1');
vector helix = set(sin(angle), 0, cos(angle));
@P += helix * chf('parm2');
```

或 VOP:
```
geometryvopglobal (P, ptnum)
  → inttofloat × 2 → divide (ptnum/numpt) → t
  → multiply (t * angle_parm) → angle
  → sine + cosine
  → floattovec (sin, 0, cos) → helix vec
  → multiply scale → add P → output
```

**production helix 万能 idiom**. 跟 0162 vex helix / 0286 spiral staircase / 0354 (p,q)-torus knot / 0428 magic projectile (labs::spiral) / 0618 nested spiral 同 family — corpus 5+ helix paradigm.

### Multi-noise variants (production fBm-like fractal noise)

```
mainCurve
  → noise (主 curve noise — 大尺度)
  → mid_noise (中尺度)
  → small_noise / small_noise1/2/3 (小尺度细节)
  → noise2 / noise3 (per-branch noise)
```

**production "多 octave noise"** = 大 + 中 + 小 + per-branch 多层 noise. vs 单 noise (不够细节). 跟 fBm 同概念但 production 显式拆分多 noise 节点.

corpus production-grade 噪波处理标志. 0556 静帧闪电 / 0093 多层 noise + extrude / 0620 worleynoise stack 同 family.

### AOV (Arbitrary Output Variables) preparation

```
mesh + multi-channel data
  → AOVs attribvop × N (生成多通道 attribute: depth, normal, velocity, custom)
  → render (用 AOV 作 compositing 通道)
```

corpus 罕见 (< 5), production render-grade 标志. 跟 0427 / 0428 / 0247 production export 端 同 family.

### Connectivity + per-class color (production multi-curve coloring)

```c
// per-class random color
float rand = rand(@class + 1256);
@Cd = chramp("color_ramp", rand);
```

```
mesh → connectivity (per piece @class) → wrangle (rand by class → chramp) → per-class color
```

production "per-piece random color" 标准 idiom. 跟 0263 color → group / 0192 random color tool 同 family.

### VEX 教学系列 (production reference)

落于ivi VEX 教学系列 corpus 10+ 工程:

| # | 工程 | 主题 |
|---|------|------|
| 0196 | 常用 VEX 01 | 基础 |
| 0199 | 常用 VEX 02 | (...) |
| 0202 | 常用 VEX 03 | |
| 0205 | 常用 VEX 04 | |
| 0209 | 常用 VEX 05 | |
| 0226 | 常用 VEX 06 | |
| 0557 | 条件语句 | if/else/switch/ternary |
| 0558 | 函数基础 | 函数定义 / 调用 |
| 0559 | 通道函数 | ch/chf/chv/chramp |
| 0084 | VEX 整理 | 大杂烩 |

production master 速查手册 — corpus 这种工程 不是 effect, 是 reference.

### VEX 条件 5 种形式

```c
// 1. if (单条件)
if (@P.y > 0) @Cd = {1, 0, 0};

// 2. if-else
if (cond) {} else {}

// 3. if-else-if-else
if (cond1) {} else if (cond2) {} else {}

// 4. switch
switch (mode) { case 0: ... break; default: ... break; }

// 5. ternary
@Cd = (cond) ? a : b;

// 复合条件
&& (and) || (or) ! (not)
```

production C-like 标准 — VEX 跟 C 同语法.

## Batch 67 additions

### Production VOP `E_*/I_*` 命名约定 (HDA-grade)

```
attribvop:
  I_P__00, I_P__03, I_P__04, I_P__05    ← Input P (多 alias for clarity, switch 用)
  I_OpInput2__00/01/02                    ← Input from second input
  I_ptnum__00..04                         ← Input ptnum (多 alias)
  I_numpt__00..07                         ← Input numpt

  [body — VOP nodes + switch (multi-mode)]

  E_P__00, E_P__03, E_P__04               ← Export P (output bound)
  E_Cd__00..05                            ← Export Cd
  E_pscale__00..05                        ← Export pscale
  E_orient__00..07                        ← Export orient (quaternion)
```

**架构**:
- **`I_*` (Input)**: input attribute alias, VOP 内部可读
- **`E_*` (Export)**: output bound alias, user 知道导出什么
- **多 alias (`__00, __01, ...`)**: switch 多 mode 用
- **大写 (`E_`)** vs 小写 (`e_*/i_*`): 0568 大写, 0578 小写, 都是 production VOP 命名约定

**production 标志**: 看到 E_/I_ 大写或 e_/i_ 小写命名 = HDA-grade VOP. corpus < 5 严格 — production tool VOP 标志.

### Quaternion 6 节点 family (corpus 罕见高级)

| 节点 | 用途 |
|------|------|
| **`eulertoquat`** | euler angle (vec3) → quaternion (vec4) |
| **`qrotate`** | quat * vector → rotated vector |
| **`qdistance`** | 2 quat 间距离 (cos(angle/2)) |
| **`qinvert`** | quaternion 求逆 |
| **`slerp`** | 2 quat 球面线性插值 |
| **`quaternion`** (constructor) | (axis, angle) → quaternion |

**`slerp` vs `lerp` for quaternion**:
- lerp(q1, q2, t) = 直线插值 (非单位四元数, 旋转加速度怪)
- slerp(q1, q2, t) = 球面插值 (正确旋转, 单位 quat 保持)

production "quaternion blend 必备 slerp, 不能 lerp".

### Transform 表示 4 paradigm (rotation 完整覆盖)

| Paradigm | 节点 / 函数 | 适合 |
|----------|------------|------|
| **euler angle** | (rx, ry, rz) | 简单 axis-aligned |
| **quaternion** | eulertoquat / qrotate / slerp (0571/0243) | 平滑 rotation blend |
| **matrix** | vectomatx + m3tom4 (0495) / maketransform | 完整 4x4 transform |
| **dihedral** | dihedral() VEX (0258) | 2 vector 间 rotation |

production 选: 简单 → euler; blend → quaternion (slerp); 完整 transform → matrix; 2 vector 间 → dihedral.

### Centroid-based rotation (production "围 centroid 转")

```c
// VOP equivalent in attribvop3
// importpoint(input2 = extractcentroid output, P, ptnum) → centroid
vector centroid = ...;
vector relative = @P - centroid;
vector4 quat = eulertoquat(rotation_euler);
vector rotated = qrotate(quat, relative);
@P = centroid + rotated;
```

**production "rotate around point" 标准** — 跟 maketransform(pivot=centroid, rotation, ...) 同概念.

### connectivity + extractcentroid + per-piece quat rotate (multi-piece rotation)

```
mesh → connectivity (per piece @class)
     → extractcentroid (per class centroid)
     → attribvop (per piece quat rotate around per-class centroid)
```

production "per-piece independent rotation" = 跟 0192/0568 multi-mode VOP tool 同 family.

### `primuv` VOP 节点 (corpus 中等常见)

```
primuv (input geom, attrib_name, primnum, uv) → attribute on prim at uv
```

**production 用途**:
- popvop curve attract (0054 三件套: minpos+xyzdist+primuv)
- mesh growth (0578)
- delta motion follow (0586 xyzdist + primuv × 2)
- mesh-to-mesh sample (0230 primuv reproject)

corpus 5+ primuv 使用场景 — production "uv-based attribute lookup" 万能函数.

### Delta motion idiom (动态 mesh 驱动 follow)

```c
// VOP equivalent - 拉 dynamic mesh 的 motion delta
attribvop:
  geometryvopglobal (P, current particle)
  → xyzdist (input2 = current torus, P) → 找最近 uv on torus
  → primuv (input3 = timeshift torus, attr=P, primnum, uv) → 历史位置 P_hist
  → primuv (input2 = current torus, attr=P, primnum, uv) → 当前位置 P_curr
  → subtract (P_curr - P_hist) → motion delta
  → add (P + delta) → 粒子被 motion delta 驱动
```

**架构**:
- xyzdist 找 particle 对应 mesh uv
- primuv (current) - primuv (timeshift) = motion delta
- 把 delta 加到 particle P → follow

**vs 手动 `(curr_P - prev_P)`**: uv-based 跟 mesh 拓扑无关 (只需对应 prim/uv). production "动态 mesh 驱动静态 mesh follow" 标准.

跟 0495 (VOP matrix transform 驱动) / 0455 (distance mask morph) 同 family — "动态驱动" 多 paradigm.

### alembic + unpack + timeshift (动态 mesh 历史采样)

```
alembic (动画文件) → unpack → mesh
                  → timeshift (frame offset, e.g., -1) → 历史 mesh
```

**production "动画 mesh 文件" 标准**:
- alembic = 任意几何动画 (vs FBX 角色 + bone)
- unpack = 把 packed alembic prim 转 normal mesh
- timeshift = 给 frame offset → 历史 mesh

跟 KineFX (角色 rig) / Mixamo (FBX) / Agent system 不同 — alembic 适合任意 mesh 动画 (无骨架).

## Batch 68 additions

### VOP 端等价 wrangle 操作 (production VOP node family)

| Operation | Wrangle | VOP Node |
|-----------|---------|----------|
| set attribute | `setpointattrib(0, "name", ptnum, value)` | `setattrib` (0593) |
| remove point | `removepoint(0, ptnum)` | `removepoint` (0591) |
| find attribute value | `findattribval(input, class, "attr", value)` | `findattribval` (0591) |
| if/else | `if (cond) { ... }` | `if_begin / end_if` block (0591) |
| add point | `addpoint(0, P)` | `addpoint` (0618) |
| add prim | `addprim(0, "polyline")` | `addprim` (0618) |
| add vertex | `addvertex(0, prim, ptnum)` | `addvertex` (0618) |

corpus < 5 工程用纯 VOP 节点完成 wrangle 等价操作 — production VOP HDA 标志 (vs wrangle 灵活但繁琐).

production 选: 复杂逻辑 → wrangle (简洁); HDA 封装 → VOP node (visual + UI parm).

### `quattomatx` (quaternion → 3x3 matrix)

```
quaternion (axis, angle) → quattomatx → 3x3 matrix → rotate (matrix * vector)
                                                  → m3tom4 (3x3 → 4x4)
```

跟 m3tom4 / m4tom3 / vectomatx 同 family — production "transform 表示间转换" 节点. 0593 案例.

**Transform 表示完整转换 family**:
- eulertoquat (euler → quat)
- quattomatx (quat → 3x3)
- m3tom4 (3x3 → 4x4)
- m4tom3 (4x4 → 3x3)
- vectomatx (3 vec → 3x3)

production 4 paradigm 间互转 (euler ↔ quaternion ↔ matrix). 跟 0571 quaternion family / 0495 VOP matrix 同 family.

### Bullet 内置 attribute set via VOP (production "VOP 控制 sim state")

```
attribvop:
  setattrib (geom, "active", ptnum, 1) → set i@active
  setattrib (geom, "deforming", ptnum, 1) → set @deforming
  setattrib (geom, "orient", ptnum, quat) → set Bullet orient
  setattrib (geom, "pivot", ptnum, P) → set pivot
  setattrib (geom, "pscale", ptnum, scale) → set pscale
```

**Bullet RBD 内置 attribute 完整列表**:
- `i@active` (1 = 参与 sim, 0 = 静止)
- `@deforming` (deformable 标志)
- `@mass` / `@density` (物理属性)
- `@v` / `@w` (初始 velocity / 角速度)
- `orient` (quaternion rotation)
- `pivot` (旋转中心)
- `pscale` (size)

production "VOP 端控制 sim state" 标准 — 比 wrangle 更可视 (HDA 端). 0593 案例.

### pcopen + pcfilter (spatial spread, vs neighbours 拓扑 spread)

```
attribvop in solver:
  pcopen (P, attr, radius, max_count) → handle 给邻居 (空间搜索)
  pcfilter (handle, attr) → 邻居 attribute 加权平均 (按距离自动)
  add (current_attr + pcfilter_result * coef) → 累加 spread
```

**vs `neighbours()` (0343 拓扑邻居)**:
- neighbours = mesh 拓扑邻居 (跟 mesh 几何无关, 跟连接关系)
- pcopen + pcfilter = 空间搜索 (radius-based, 跟 mesh 拓扑无关)
- pcfilter 自动按距离加权平均 (vs neighbours + foreach 手写 sum/count)

**production 选**:
- mesh 上沿拓扑扩散 → neighbours (sharp, 跟 mesh 形态)
- 散点 / 跨 mesh 空间扩散 → pcopen + pcfilter (smooth, 跟 mesh 拓扑无关)

跟 0166/0151/0150 popvop pcfilter / cone pcfilter / hyphae pcfilter 同 family — pcopen+pcfilter 是 production 邻居 query 万能.

### Noise-modulated pcopen radius (production 高级 spread idiom)

```
attribvop:
  turbnoise (P) → vecsetcompon (modify radius / max_count) → pcopen
  → pcfilter
```

production "spread 区域不均匀" — noise 大 radius 大, noise 小 radius 小. corpus 罕见 (< 5).

跟 0598 multi pcopen 不同 radius 同 paradigm — production user-control spread 高级 idiom.

### `nearpoint` VOP (Voronoi-like 区域划分)

```
attribvop:
  geometryvopglobal (P)
  → nearpoint(input1 = scatter, P) → 最近 scatter point ptnum
  → importpoint(input1, attr, ptnum) → 拉 scatter 点的 attribute
```

**vs voronoifracture (geometry-level Voronoi)**:
- nearpoint = attribute-level Voronoi (mesh 上每点属于最近的 scatter)
- voronoifracture = geometry-level Voronoi (碎裂 mesh)

production 选: 区域 attribute 划分 → nearpoint; 几何碎裂 → voronoifracture. 0599 案例.

### Per-region xform (production "区域独立变换")

```
attribvop:
  nearpoint → ptnum
  random(ptnum) → per-region random factor
  turbnoise(ptnum) → per-region noise
  xform(P, scatter_centroid, rotation, scale, ...) → 应用 transform
```

production "per-region independent transform" = nearpoint + xform VOP 标准.

**vs connectivity + extractcentroid + per-piece quat rotate (0571)**:
- connectivity = 拓扑邻接 → per-piece (mesh 形态)
- nearpoint = spatial Voronoi → per-region (跟 mesh 拓扑无关)

production 选: 拓扑分块 → connectivity; 空间 Voronoi → nearpoint.

### `xform` VOP node (production transform 节点)

```
xform (P, center, rotation, scale, ...) → transformed P
```

跟 wrangle 端 maketransform / matrix multiply 同概念但 VOP 节点版. 0599 案例.

corpus 中等常见 — production VOP transform 标准 (vs wrangle).

## Batch 69 additions

### `trig` VOP node (production "周期函数" 节点)

```
trig (value, frequency, amplitude) → sin/cos 多周期波形
```

vs wrangle `sin(value * freq) * amp`: 同概念但 VOP 节点版. corpus 中等常见 — production VOP "周期函数" 标准.

### Multi nearpoint + distance + trig 干涉 (多源 sin 干涉)

```
attribvop:
  for i in 1..N:
    nearpoint(input_i, P) → ptnum
    importpoint(input_i, "P", ptnum) → nearest P_i
    distance(P, P_i) → 距离
    trig(distance * freq_i) → sin wave_i

  multiply (sum of waves) → displacenml (沿 N displace) → output
```

production "多源 sin 干涉" — N 个 nearpoint 各自算 sin 波, 叠加形成干涉图样. 跟 0379 shockwave (单源 `abs(parm/dist - 1)`) 同 family 但多源.

### SDF gradient: push-out vs pull-back (双向用法)

```c
// 0603 push-out (粒子 inside → push out, collision avoidance)
if (sdf < 0) {
    P += -normalize(grad) * abs(sdf);
}

// 0605 pull-back (粒子 outside → pull back to source, attract)
vector push_back = grad * sdf;
P = mix(P, P - push_back, distance_factor);
```

**production "SDF-based force" 完整 paradigm**:
- push-out (0603): 避免穿插 (anti-collision)
- pull-back (0605): 拉回 source (attract)
- 都用 volumegradient + volumesamplefile

production 选: collision avoidance → push-out; particle binding → pull-back.

### Multi mesh anti-collision via shared SDF + nested if

```
multi mesh → merge → vdbfrompolygons (合一 vdb SDF)
attribvop:
  for i in 1..N:
    if_begin (volumesamplefile_i < 0):
      multiply (...) → push-out_i
    end_if → subtract_i

  output → blur_mask + blur_P (smooth)
```

**production "多 mesh 互不穿插"**:
- 跟 0603 (单 mesh push-out) 同 paradigm 但多 mesh + nested if
- 3 nested if_begin/end_if VOP block = corpus 罕见高级 conditional logic
- blur 后处理 = push-out smoothing 必备

### `grandom` VOP node (gaussian random, corpus 罕见)

```
grandom (seed, sigma) → gaussian random (mean=0, sigma 控散布)
```

**vs `random`** (uniform 0..1): grandom 是正态分布 (gaussian distribution). 适合 per-particle 偏移 — 正态分布更自然 (vs uniform 边界 sharp).

**`bias + grandom` pattern** (production gaussian sampling):
```
bias (parameter) + grandom (sigma) → mix factor (gaussian-distributed around bias)
```

production "centered random" 标准 — 大部分粒子靠近 bias, 少部分外散.

corpus 罕见 (< 5 grandom 工程) — production "正态分布 sampling" 高级 idiom.

### popvop curve attract 三件套进阶 (production-grade)

```
基础三件套 (0054):
  minpos + xyzdist + primuv → mix(P, minpos, bias) attract

进阶 (0606):
  4 xyzdist (4 不同 input curve)
  4 primuv (4 attribute lookup)
  3 minpos (3 nearest-point query)
  multi mix + multi multiply (复合 blend)
  bias + grandom (per-particle gaussian random)
  switch (multi-mode)
```

production "multi-curve attract + statistical sampling" — 比基础三件套复杂 5-10x, 但更细致 control.

### Distance / closest 7 paradigm (新增 grandom-driven sampling)

| Paradigm | 节点/函数 | 适合 |
|----------|----------|------|
| xyzdist | VEX | 直线 point-mesh |
| distancealonggeometry | SOP | 沿 mesh 表面 geodesic |
| surfacedist | VOP | VOP 端 geodesic |
| intersectionanalysis | SOP | 多 geometry closest pair |
| neighbours + foreach | VEX | mesh 邻居 |
| pcfind / pcopen | VEX | 空间散点 |
| nearpoint | VOP | spatial Voronoi 划分 |

**新增 statistical (gaussian) sampling 不属 distance family** — grandom + bias 是另一维度 (random 而非 distance).

## Batch 70 additions

### Connection paradigm 4 种 (production multi-mesh connectivity)

| Paradigm | 节点 / VOP | 适合 | 案例 |
|----------|-----------|------|------|
| **全连接 (笛卡尔积)** | nested for-loop + npoints + addpoint chain | mesh × N × M 全连 | 0611 |
| **限距离 (minpos with maxdist)** | minpos(input, P, maxdist) + addpoint | 局部连接 (邻近图) | 0610 |
| **邻近 (pcfind)** | pcfind/pcopen + addprim 'polyline' | radius-based | 0612 vop_proximity_graph |
| **拓扑邻接 (connectadjacentpieces)** | connectadjacentpieces SOP node | piece-level connectivity | 0024 |

production 选: 全连接 → 笛卡尔积 (慢但完整); 限距离 → minpos with maxdist; 散点邻近 → pcfind; mesh piece → connectadjacentpieces.

### `minpos` with `maxdist` parameter (距离限制最近点)

```
minpos(input, P, maxdist) → 最近点 P_nearest (限制 maxdist 内, 超过返回 null)
```

**vs minpos 无 maxdist** (0054 三件套): 限制版用于 sparse connection / 邻近图 / partial linking. 0610 案例.

### `npoints` VOP node (corpus 罕见)

```
npoints(input) → 总点数 (integer)
```

跟 wrangle `npoints(input)` 同概念. corpus 罕见 — production VOP 端 "查 input 点数" 节点.

production 用途: nested for-loop 边界控制 (0611 笛卡尔积), per-piece 处理.

### `findattribvalcount` + `findattribvalindex` (production VOP group query)

```
findattribvalcount(input, class, attr_name, value) → 满足 attr=value 的点数
findattribvalindex(input, class, attr_name, value, index) → 第 N 个满足条件的 ptnum
```

**production "按 attribute 值找点群"** 标准 idiom. 跟 0591 (`findattribval` 找单个, single ptnum) 同 family 但 count + index 多个.

corpus 罕见 (< 5) — production "VOP 内 per-class iteration" 高级.

### Per-piece aggregation in pure VOP (vs SOP foreach piece)

```
attribvop:
  findattribvalcount(input, "class", current_class) → count_in_piece

  for_begin (i=0..count_in_piece):
    findattribvalindex(input, "class", current_class, i) → ptnum_i
    getattrib(input, "Cd", ptnum_i) → color_i
    max(...) → 累积 max color
  end_for

  output max_color
```

**vs SOP connectivity + foreach piece** (0488 嵌套 foreach): 等价但纯 VOP 实现 — production "VOP 内 per-class aggregation". corpus 罕见 (0619).

production 选: SOP 端 → connectivity + foreach (清晰); VOP 端 → findattribvalcount+findattribvalindex+for_loop (HDA封装).

### Nested for-loop in VOP iteration count (3-6 层)

corpus VOP nested for-loop 多层级:
- 3 层 (0615 — curlnoise lines)
- 5 层 (0611 — cross product connect)
- 6 层 (0618 — spiral nested)
- 多 attribvop alias 给 nested 用 (0568 `I_*/E_*` naming)

production "VOP 内多层 iteration" = procedural geometry generator standard. 跟 SOP 端 nested foreach piece 等价但 VOP-grade.

### Procedural noise lines (nested for-loop + curlnoise displacement)

```
attribvop:
  for_begin1 (length=N1):
    curlnoise(P_step1) → noise vec
    add(P + noise) → P_step1
    addpoint(P_step1)

    for_begin2 (length=N2):
      curlnoise(P_step2) → noise
      add(P_step1 + noise) → P_step2
      addpoint + addprim + addvertex → 建 line

      for_begin3 ...
```

production "多层 curlnoise displacement" = 自然 strand / hair / noise 线条. 0615 案例.

跟 0008 双线条缠绕 / 0117 ice spike 同 family 但 pure VOP 实现.

## Batch 71 additions

### chramp(u) → primuv re-position 万能 idiom

```c
float u = float(@ptnum) / (@numpt - 1);
float new_u = chramp('func', u);          // 必须 non-decreasing
@P = primuv(0, 'P', 0, new_u);
```

**关键约束**: chramp 必须 non-decreasing. **应用**: curve 上 instance 密度控制 / 沿 curve timing 控制. 跟 chramp + various drivers 7+ paradigm 同源.

### Production VEX cookbook 8 idioms (0196 master)

```c
// 1. 概率删点 (三元运算符 + rand)
removepoint(0, rand(@ptnum + ch("seed")) < ch("probability") ? @ptnum : -1);

// 2. Power-curved random scale
@pscale = fit01(pow(rand(@ptnum + ch('seed')), ch('power')), ch('min'), ch('max'));

// 3. Quaternion rotation attribute
@rot = quaternion(angle, chv('axis'));  // copytopoints 标准

// 4. chramp + rand color
v@Cd = vector(chramp('color', rand(@ptnum + ch('seed'))));

// 5. {1,0,1} mask vector (限制方向)
@P += curlnoise(@P) * {1,0,1} * fit01(rand);

// 6. Foreach 元数据访问
int copynum = prim(0, 'copynum', @primnum);
int ite = detail(1, 'iteration', 0) * 2;

// 7. Reference + up
@N = normalize(point(1, 'P', 0) - @P);
@up = {0, 1, 0};

// 8. High-dim hash
float u = rand(set(@elemnum % 666, @elemnum / 666, seed));
```

VEX cookbook 6 集 series (0196/0199/0202/0205/0209/0084).

### Heightfield system 完整节点 inventory (0210 master)

```
Container: heightfield, heightfield_project, heightfield_remap
Noise (22+): heightfield_noise (perlin/worley/billowy/sparse/...)
Pattern: heightfield_pattern (条纹/棋盘/螺旋)
Modifiers: heightfield_blur, heightfield_distort, heightfield_erode, heightfield_terrace
Painting: heightfield_paint, heightfield_mask_by_*
```

**数据结构**: height + mask + biome + debris layer.

**heightfield vs vdb**: 2.5D 地形 (heightfield) vs 3D 复杂 shape (vdb).

### Production "归 0 → 制作 → 归位" workflow (0212)

```
input animated mesh
  → tran (xform 归 0 — P 平移到 origin, rotate 0, scale 1)
  → [subnet 复杂 procedural 在 rest pose]
  → tran1 (反 xform 还原)
  → matchsize → output
```

**为什么需要**: 复杂 procedural (boolean/sweep/UV) 在 rotated/scaled mesh 上结果不稳定 → rest pose 制作稳定 + 反向还原 → 跟原动画对齐. vs rest 节点 — rest 只 backup P, 这是真归 0.

### Reference 4 件套 (production HDA 中心化参数)

production HDA 内 4 个 reference null:
- **Ref_bbox** — bbox 参考
- **Ref_direction** — 朝向参考
- **Ref_size** — 尺寸参考
- **Re_pos** — 位置参考

让 subnet 内多节点共享 reference. 跟 Controller null + parm expression 同源.

### `addpoint + removeprim` prim → point only idiom

```c
// primitive wrangle
addpoint(0, @P);
removeprim(0, @primnum, 1);  // 1 = 同时删 unused points
```

每个 prim 转成单个点 (在 prim P 位置). 跟 unique points + assemble 同概念但 wrangle 简洁.

## Batch 72 additions

### Production rock generator (worley + turb noise stack)

```
attribvop:
  worleynoise (cell pattern)
  turbnoise (modulation)
  worleynoise (modified by turbnoise) → 二次 worley
  subtract worley × 2 → ridge effect (锐利山脊)
  displacenml (沿 N displace)
  multi switch (N mode 选 displacement 风格)
```

**`subtract worley × 2` ridge effect** = 锐利岩石边缘技巧 (vs 直接 worley 圆 cell).

### "几何属性当 v" 4 paradigm (production "v initialization")

| Paradigm | 公式 | 适合 |
|----------|------|------|
| **P 当 v** | `v@v = v@P` | 从原点向外发射 (0623) |
| **N 当 v** | `v@v = v@N` | mesh 表面方向 (0633/0297) |
| **径向 v** | `v@v = normalize(P - center)` | 围中心点 (0337) |
| **noise field v** | `v@v = curlnoise(P)` | smooth velocity field |

### chramp + driver 10 paradigm (新增 speed)

| # | Driver | 案例 |
|---|--------|------|
| 1 | @curveu | 0125/0115 |
| 2 | @gradient | 0197 |
| 3 | @nage / @age | 0086/0345 |
| 4 | @id | 0506/0148 |
| 5 | @primnum | 0527/0258 |
| 6 | @ptnum | 0526 |
| 7 | @P.y | 0397 |
| 8 | distance | 0241 |
| 9 | Lambertian dot(N, light) | 0335 |
| 10 | **speed** `length(v)` | 0623/0290 |

### POP fluid 4 件套

```
popnet:
  popsource → popproperty → popfluid (粒子级流体) → popdrag → popforce → popsolver
```

vs FLIP (4 件套): popfluid 粒子级 (lighter), FLIP volume-based (heavier accurate). 0623 案例.

### Mesh blending 万能模板 → 12 paradigm (新增 noise + anim + relbbox 复合)

```c
float aanoise_val = aanoise(@P);
vector relbbox_val = relbbox(0, @P);
float anim = chf('anim');
float fit_val = fit(aanoise_val + anim + relbbox_val.y, ...);
float ramp_weight = chramp('ramp', fit_val);
@P = mix(@P, target_P, ramp_weight);
```

12 paradigm 累计 (weight 来源越来越复合). 0624 案例.

### `length(@v) < threshold` removepoint (production conditional dissolve)

```c
if (length(@v) < ch('threshold')) removepoint(0, @ptnum);
```

production "速度 threshold dissolve". 跟 0144/0167/0591 conditional removepoint 同 idiom.

### mesh → pyro source 完整链

```
mesh dissolve (P 渐变 / removepoint)
  → trail (record P 历史)
  → pyrosource (生成 pyro source attribute)
  → volumerasterizeattributes
  → pyrosolver (sim 烟雾) → filecache
```

production "mesh → pyro source → sim". 跟 0483/0353/0383 同 family. 0624 案例.

### Reverse-time trick (production "汇集" effect)

```
Stage 1: forward sim (image → 散落, easy to sim) → cache
Stage 2: retime (Frame 倒放) → visually 等价 reverse sim (chaos → image)
```

production "汇集 / 形成" effect 经典. corpus 罕见 (< 5). 0629/0631 案例.

### Image-driven workflow 4 paradigm

```
1. image → mesh attribute (0554/0555 Cd from texture)
2. image → heightfield mask (0327)
3. image → polyextrude height (0555 Cd.r → @zscale)
4. image color → grain target (0629 reverse-time)
```

production "image-driven" 完整.

## Batch 73 additions

### `multisolver` (production 多 solver 协作)

```
multisolver:
  flipsolver1 (FLIP sim)
  sopsolver1 (post-process per frame):
       dop_geometry → attribtransfer (color from initial Cd)
       OUT
```

**production "多 solver 协作"** = flipsolver + sopsolver 顺序执行. corpus < 5 用 multisolver — production 高级 sim 协作.

跟 0497 (sopsolver attribtransfer SOP→DOP force injection) 同 family 但更完整 — multisolver 是 wrapper.

### Color preservation through sim 3 paradigm 完整 (新增 sim-内每帧)

| Paradigm | 案例 | 时机 |
|----------|------|------|
| **Pre-sim attr on flipsource** | 0412 | sim 前 attribute 跟着粒子 |
| **Post-sim attribtransfer back** | 0412 | sim 完后从 rest geo 拉 |
| **multisolver + sopsolver attribtransfer in DOP** ← 新 | 0630 | sim 中每帧 transfer |

production 选: 简单 sim 内 → A; 准确 render → B; sim-内每帧 → C (multisolver). 0630 案例.

### Multi attribvop "N manipulation" 3 步 chain

```
add_N (attribvop):
  add(P + P) + add(input3 parm) → 把 N 放大
Change_normals (attribvop):
  cross(P, axis) → cross 旋转 N 90°
  multiply (cross, input2) → scale
Noise_N (attribvop):
  turbnoise (multi parm) → noise vec
  add(N + noise) → output displaced N
```

production "N manipulation" 3 步标准: 加自己 → cross 旋转 → noise 扰动. 跟 0029/0633/0297/0566 N 处理同 family. 0632 案例.

### `staticsolver` (production groundplane physics wrapper)

```
popnet:
  staticsolver (input = groundplane) → ground 物理 collider sim
  + gravity + popwind + popdrag + popwrangle
```

DOP 节点 wrapper for groundplane sim. 跟 staticobject (0337) 同 family 但带 sim wrapper. 0632 案例.

### Production audio CHOP 9 节点 pipeline

| 节点 | 用途 |
|------|------|
| **file** | 加载 audio (.wav/.mp3) |
| **delete** | 删除 unused channels |
| **trim** | trim audio 时间 |
| **pass** | filter pass channels |
| **envelope** | 提取 amplitude envelope |
| **limit** | clamp value range |
| **trigger** | threshold discrete events |
| **spring** | spring physics (overshoot + decay) |
| **shift** | 时间 offset |
| **rename** | rename channels |
| **export** | export to SOP attributes |

production "audio → animation" 完整 pipeline. 0076 案例.

### `envelope + limit + trigger + spring` 4 件套 (audio → animation)

```
audio file
  → envelope (low-pass amplitude)
  → limit (clamp range)
  → trigger (threshold discrete events)
  → spring (overshoot + decay → 弹性 attribute reaction)
```

**production "audio reactive animation" 万能模板** — 配 SOP 端 mesh 形变 = audio-reactive viz.

### CHOP 4 大用途 (Houdini 4 大 OP 之一)

| 用途 | 案例 |
|------|------|
| **Audio processing** | 0076/0077 |
| **Spring physics** | 0030/0153/0398/0458 |
| **Animation curves** | procedural keyframes |
| **Time series** | 1D 数据流 |

CHOP 是 Houdini 4 大 OP 之一 (SOP/DOP/COP/CHOP). corpus 5+ chop 工程 — 跟 SOP/DOP/COP 同等重要.

### Noise function 4 大类 (VEX cookbook)

```c
snoise(P, ...)            // simplex noise — production 默认 (vs perlin 快 + 各向同性)
anoise(P, ...)            // alligator noise — sharp / cell-like
onoise(P, ...)            // original perlin noise — 经典
snoise(P, periodX, ...)    // periodic snoise — 带 period 循环
```

**Parm chain 通用**: freq / offset / amp / turb / rough / atten.

跟 0556 multi-noise variants / 0093 noise mesh blend / 0620 worley extrude / 0621 worley + turb stack 同 family — corpus production "noise displacement" reference. 0084 案例.

### VEX 教学 series 11+ 工程 (production reference)

```
0084 — VEX 整理 (大杂烩, 13 noise variants)
0196/0199/0202/0205/0209/0226 — 常用 VEX 整理 01-06
0557 — 条件语句
0558 — 函数基础
0559 — 通道函数
0560 — 循环
0561 — 正弦余弦基础
0562 — 正弦余弦交错线条
0563 — 循环点 + 几何体
```

production master 速查手册 (corpus 不是 effect, 是 reference).
