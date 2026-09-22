> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Performance Triage

Common performance pitfalls in PCG and how to fix them. When cooks get slow, check these in order.

## Performance budget targets

For interactive iteration:
- Cook time per seed change: < 5 sec
- Polygon count: < 100k for viewport, < 1M for final render
- Memory peak: < 1 GB
- VDB voxel grid total cells: < 10M

If you exceed by 2x, fix it. By 10x, it's broken.

## Diagnosis: where is the time going?

Houdini's **Performance Monitor** (Windows menu) tells you exactly. Order of operations:

1. Open Performance Monitor (Windows → Performance Monitor)
2. Hit "Begin Recording"
3. Trigger a cook (change a parameter)
4. Hit "End Recording"
5. Look at "Cook Statistics" — sorted by cook time

The top 1-3 nodes account for 80% of cook time. Fix those.

## Top 10 perf issues (in order of frequency)

### Issue 1: VDB voxel size too fine

**Symptom**: `vdbfrompolygons` or `convertvdb` takes 5+ seconds.

**Root cause**: voxel_size default is often 0.1, but for grid_step=2 you only need ~0.5 (4x coarser → 64x fewer voxels).

**Fix**: set `vdbfrompolygons` voxel_size to `grid_step / 4` or `grid_step / 8`. For Lake House: 0.5 instead of 0.1.

**Speedup**: typically 8-64x.

### Issue 2: Scatter density too high

**Symptom**: `scatter` SOP shows N > 1000, then most points get filtered.

**Root cause**: artist mindset "more is better". But Stage 1 only needs enough points to populate the candidate grid post-fuse.

**Fix**: For grid-based pipelines, calculate target = `volume / (grid_step^3)` and use 4-5x of that. Lake House: ~80 grid cells × 5 = 400 points (matches actual config).

**Speedup**: 2-10x.

### Issue 3: For-loop block over too many iterations

**Symptom**: `for-loop block_end` cook time scales linearly with iterations and is slow.

**Root cause**: Each iteration cooks all internal nodes from scratch. K iterations × N nodes = K×N cooks.

**Fix options**:
- Reduce iteration count if possible (`itermethod=count` with smaller N)
- Replace with a single-pass detail wrangle if algorithm allows
- Add `i@stop` early termination (`feedback` mode)

**Speedup**: depends on algorithm. Sometimes 10-100x.

### Issue 4: Object_merge causing redundant cooks

**Symptom**: Two object_merge nodes pulling from the same source — that source is cooked twice.

**Root cause**: Houdini caches per-node, but if multiple object_merge instances exist, each may trigger separate cooks.

**Fix**: Pull through a single null node, then split. Or use the `Source Group` parameter to limit cook scope.

**Speedup**: 2x for the duplicated source.

### Issue 5: Wrangle with O(N²) inner loop

**Symptom**: A wrangle is slow, code has nested loop over all points.

```c
// BAD
for (int i = 0; i < npoints(0); i++) {
    for (int j = 0; j < npoints(0); j++) {
        // distance check
    }
}
```

**Fix**: Use `pcopen` / `nearpoints` (KD-tree, O(log N)).

```c
// GOOD
int handle = pcopen(0, "P", @P, radius, max_pts);
while (pciterate(handle)) { ... }
```

**Speedup**: 100-1000x for N>1000.

### Issue 6: Heavy VEX inside `piece` mode for-loop

**Symptom**: `for-loop block_end (piece)` slow with many iterations.

**Root cause**: piece mode creates many tiny "geometry" inputs, each cooked separately.

**Fix**: Combine into a single detail wrangle if logic allows. Or batch pieces (process N at a time).

**Speedup**: 5-20x.

### Issue 7: Copytopoints with many large modules

**Symptom**: `copytopoints` is the top cook time.

**Root cause**: Each module being copied has high poly count. N points × M polys = N×M output polys.

**Fix options**:
- Reduce module poly count (artist task)
- Use `instance` instead of `copytopoints` for far-away / non-deformed cases
- Use `pack` SOP to convert modules to packed primitives (rendered without geometry expansion)

**Speedup**: 10-100x for memory; render speed depends on engine.

### Issue 8: Unnecessary `fuse` calls

**Symptom**: Many `fuse` SOPs, each adding 100-500ms.

**Root cause**: copy-pasted "fuse after every wrangle" mentality.

**Fix**: Only fuse when needed (after `rint`-based position changes, after VDB output, after merge). Most other places don't need it.

**Speedup**: minor per fuse (200ms × N), but adds up.

### Issue 9: Cooking the entire OBJ on every parameter change

**Symptom**: Even tiny parameter changes trigger 5-second cook.

**Root cause**: All nodes downstream of the parameter need re-cook. Some are expensive but rarely change (e.g., the module library).

**Fix**: Cache stable nodes with `cache` SOP set to "always cache":
- After Stage 1 volume generation (rarely changes if seed is stable)
- After loading module library (only changes if .obj swap)

Then small parameter tweaks only re-cook downstream of the cache.

**Speedup**: 5-20x for iterative work.

### Issue 10: Foreach `attributewrangle` with high-overhead body

**Symptom**: Detail wrangle iterating over all primitives is slow.

**Root cause**: Every iteration is O(N) — total O(N²).

**Fix**: Convert to primitive wrangle (parallel by default).

**Speedup**: 4-16x on multi-core CPU.

## Memory issues

### Issue 11: VDB volume too large

**Symptom**: Memory peaks at 5+ GB during cook.

**Root cause**: VDB grid covers entire bounding box, even sparse regions.

**Fix**:
- Crop input geometry tightly before vdbfrompolygons
- Use sparse VDB (default in modern Houdini, verify it's not converting to dense)
- Increase voxel_size

### Issue 12: Geometry attribute bloat

**Symptom**: Final geometry has 30+ attributes per prim/point.

**Root cause**: Protocol attributes never cleaned up (see DEBT_CHECKLIST.md item 3).

**Fix**: `attribdelete` at subnet boundaries with pattern `_p_*` or specific dead attribute names.

**Memory saving**: linear in N × |dead_attrs|. For 100k prims × 20 dead attribs × 16 bytes ≈ 32 MB.

### Issue 13: Modules loaded redundantly

**Symptom**: Same .obj file loaded by multiple `file` SOPs.

**Root cause**: Each module category subnet loads its own copy.

**Fix**: Use `object_merge` from a single global "modules library" subnet. One load, many references.

## Render-time issues (post-Houdini)

### Issue 14: Tessellation explosion in Unreal

**Symptom**: Asset cooks fine in Houdini but Unreal viewport drops to 5 fps.

**Root cause**: Each module is a unique mesh; engine can't instance.

**Fix**:
- Pack modules into a small library, use mesh instance components
- Bake to Unreal HLOD if it's a static asset

### Issue 15: Material count explosion

**Symptom**: Asset has 200+ materials in Unreal.

**Root cause**: Each module has unique material IDs.

**Fix**:
- Standardize materials: artist provides "wood material" / "metal material" / etc.
- Use vertex color or attribute to drive shader variations

## Performance-aware authoring habits

### Habit 1: Profile early, profile often

Don't wait until the end to optimize. Run Performance Monitor after each major addition.

### Habit 2: Strip non-essential subnets when iterating

If you're tweaking only the roof, temporarily disable the body / setdressing subnets via `null` switch. Iterate fast, re-enable when done.

### Habit 3: Use `null` separators

Add `null` SOPs at major stage boundaries. Lets you debug what each stage outputs without re-cooking the whole pipeline.

### Habit 4: Document slow paths

If a node is slow but unavoidable, note it in a sticky note: "VDB takes 3s — necessary for boolean union, can't reduce."

### Habit 5: Optimize what's measured

Don't guess. Performance Monitor before fixing. Often the "obviously slow" node isn't the bottleneck.

## When to give up optimizing

Some assets just take time to cook. If after fixing the top 3 issues you're at:
- 10 sec per cook for a 1M-poly building
- 30 sec per cook for a 10M-poly city

That's reasonable. Don't kill yourself over the last 20%. Focus on **interactive iteration speed** (which means caching), not absolute cook time.

## Performance checklist (run before shipping)

- [ ] Performance Monitor shows top node < 2 sec
- [ ] Total cook < 5 sec at default parameters
- [ ] Memory peak < 1 GB
- [ ] No O(N²) loops detected
- [ ] VDB voxel size sane (`grid_step / 4` or coarser)
- [ ] Stage boundaries have caches for fast iteration
- [ ] Protocol attributes cleaned at subnet exits
- [ ] Render-time costs verified in target engine (if applicable)

---

## Update 2026-05-14 — Official docs deep-read additions

来自 12 轮 Houdini 21 官方文档精读。完整笔记:`houdini_vex_session_2026_05_14.md` + `houdini_synthesis_2026_05_14.md`。

### Compile + Multithread 真正杠杆

**反常识**:Compile block 单独 compile 不快多少。**真正的杠杆是 Block End 上的 "Multithread when Compiled" 勾选** — 才把 N 个 piece 拆 N 核并行。不勾 = compile 但单线程,白做。

**Compile 三大收益**:
1. 多线程(必须勾 Multithread when Compiled)
2. GPU 数据驻留(多个 OpenCL 节点不来回拷)
3. In-place 处理(同 geometry 实例,免拷贝)

**约束 = "no external references"**(为保 piece 独立):
- 禁 `stamp()` → 改 piece attrib 传递
- 禁 `op:/...` 引用 → **Spare Inputs**(节点上预接的额外几何)
- 禁参数表达式 `point(0,...)` `prim()` → 改 wrangle 里读
- 禁 Python 节点 → 改 VEX

不是所有 SOP 可 compile:数百节点里仍大量没改造。**网络编辑器开 "non-compilable badge"** 就能看哪些挡了 compile。

文档警告:**"resist the urge to overuse compiled blocks...especially in a production environment."** — compile 不是越多越好。正确节奏:
1. 网络先跑通(不 compile)
2. Performance Monitor 找瓶颈
3. 只对大循环 + 独立 piece 数 ≥ 数十才 compile
4. 改造成本(spare inputs / 移除 stamp)和收益必须对得上

### 拓扑邻接 — half-edge 替代 O(n²) 嵌套

| 你想 | 嵌套法(慢) | half-edge(快) |
|---|---|---|
| 找面的所有邻面 | `primpoints` + `pointprims` 双嵌套 | `primhedge` → `hedge_next` + `hedge_nextequiv` |
| 检查边是否边界 | 看共享该 edge 的 prim 数 | `hedge_equivcount(h) == 1`(教科书) |
| 经过某点的所有边 | `pointprims` + 每个 prim 找含该点两条边 | `pointhedge` + `hedge_nextequiv` 循环 |
| 边循环(edge loop) | 几乎写不出来 | half-edge 跳跃法标准实现 |

mesh 行走 / 拓扑清理类操作有 10-100 倍速度差。

### Spatial query 选型(性能 + 精度同时考虑)

| 你想 | 性能 / 精度选 |
|---|---|
| 知道半径,要全部点 | `nearpoints(geo, P, r)` — 不给距离不排序 |
| 半径 + 数量上限 + 要距离 | `pcfind(geo, "P", P, r, n, dists)` — 排序 + 距离一次拿到 |
| 半径 + 邻居自己也有半径(球碰球) | `pcfind_radius(...)` |
| 流式 / 大邻域 / 配 SPH 核 | `pcopen + pcfilter`(官方 SPH 实现,不要手写) |
| 表面距离(稀疏 mesh / 投影) | `xyzdist + primuv` 三段式 |
| 仅 3D 位置不要 prim | `minpos(geo, P)` |

**反常识**:
- `nearpoints` 只查点不查表面 — 大三角形 / 稀疏 mesh 会丢掉表面上离查询位置很近、但顶点都很远的 prim → 用 `xyzdist`
- `nearpoints` **不返回距离**,要 `length(@P-...)` 自己算 → 浪费 → 改 `pcfind`
- `nearpoints` 文档**未明确指定**返回顺序 → 想要按距离排序必用 `pcfind`

### Packed primitive 性能与陷阱

| 操作 | 性能 |
|---|---|
| 复制 packed | 复制引用,极便宜 |
| `xyzdist` 对 packed | 看 bbox 不看内部,不准 |
| 改 packed transform | `intrinsic:packedfulltransform`(不 unpack 唯一便宜路径) |
| 改 packed material | 特例,可改(material attrib) |
| 改 packed velocity | 特例,可改(vel attrib,通过 motion blur 通道传播) |
| 改 packed 内部 geometry | 必须 unpack(实例化收益解除) |
| 删 packed fragment | **不省内存**(原 model 还在);要 unpack 剩下的再删 |

PCG 性能关键决策点:**散布完后再调单个实例形状 = 必须 unpack = 失去实例化** — 设计时要预先决定"是否需要 per-instance 形状变化",不要散布完发现要改。

### Attribute 写入并行安全

**setpointattrib mode** 决定多线程同点写入是否冲突:

| Mode | 并行行为 |
|---|---|
| `set` | last-write-wins(不可预测,**避免**) |
| `add` / `min` / `max` / `mult` | reduction,确定 |
| `toggle` | 翻转(group attrib 切换专用) |
| `append` | 字符串/数组追加 |

涉及多线程同时写同目标点(常见于 compile + multithread 的 piece 内交互)必须挑 reduction mode。

### Sparse 写入陷阱

`setpointattrib` 自动创建属性,**默认值是 0/空**。Sparse 写入(if 条件下才 set)未访问的点保持默认 0,不是你期望值。修法:**先 `addattrib(0, "point", "name", default)` 设默认值再 `setpointattrib`**。

### Expression / 时间精度

`Houdini 每帧从头算`(文档原文),expression **不依赖前一帧**。"累积式"必须 Solver SOP / DOPs / 写文件持久化,expression 自己不存。

时间变量:**用 `$T` 不要用 `$FF`**(精度警告)— 长时间序列(>1000 帧)`$FF` 有精度漂移。
