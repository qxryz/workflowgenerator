> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Wrangle Algorithm Catalog

The core conviction of this skill: **every non-trivial wrangle implements a classical CS algorithm in geometric disguise**. Once named, the wrangle inherits all the algorithm's properties — complexity, convergence, failure modes, refactor options.

## How to use this catalog

When you see a new wrangle, before explaining what the code does, identify:

1. **Algorithm name** — match against catalog below
2. **Complexity** — derived from the algorithm
3. **Replacement options** — alternative algorithms with different tradeoffs

## The 7 most common algorithms in procedural modeling wrangles

### A1. Topological longest path / Bellman-Ford-style relaxation

**Signature pattern**: writes `i@height` (or `i@level`, `i@rank`) per primitive based on neighbour heights, often inside a feedback for-loop.

```c
foreach(int in_p; incoming_list)
    append(in_heights, prim(0, "height", in_p));
if(max(in_heights) >= my_height)
    my_height = max(in_heights) + 1;
```

- **Math**: ∀v: dist(v) = max(dist(u)+1) for u→v in DAG
- **Complexity**: O(V × diameter) iterations. Lake House: V≈30, diameter≈5 → 150 ops.
- **Failure mode**: cycles cause non-termination. Detect via "outcoming.height ≤ my.height".
- **Replacement**: real topological sort in detail wrangle (one-shot O(V+E)) — but loses the modular per-prim shape.

### A2. Markov-chain stochastic accretion (DLA-style)

**Signature pattern**: `pick_random` style wrangle inside a feedback loop where state accumulates (merge2 between iterations).

```python  # the meta-shape
state_{n+1} = state_n ∪ {sample(candidates(state_n), weights)}
```

- **Math**: 1st-order Markov chain on state space = subsets of grid points.
- **Complexity**: O(N × |candidates|) — far cheaper than true DLA's O(N²) random walk.
- **Failure mode**: produces disconnected blobs because there's no contact-check. Lake House compensates with VDB union downstream.
- **Replacement**: true DLA (add rejection step) → O(N²) but produces fractals. Or Poisson-disk → O(N) but uniform-only.

### A3. Spatial range query + attribute join (`pcopen + pciterate + pcimport`)

**Signature pattern**:
```c
int handle = pcopen(0, "P", @P, r, k);
while(pciterate(handle)) {
    pcimport(handle, "attr1", v1);
    pcimport(handle, "attr2", v2);
}
```

- **Math**: spatial JOIN — `SELECT n.* FROM neighbours WHERE dist(n.P, current.P) < r`.
- **Complexity**: O(M × log N) per call (KD-tree query). 10x faster than `nearpoints + point()` due to cache locality.
- **Failure mode**: `r` too small → empty handle; too large → quadratic blowup.
- **Replacement**: `nearpoints + point()` (slower) or `pcfind` (different return shape).
- **Architecture rule**: if you're doing "based on neighbour attribute X, decide Y" — ALWAYS use this pattern, never manual loop.

### A4. Multi-ray decision tree (CSG-style classification)

**Signature pattern**: 2-4 `intersect()` calls in different directions, then if-else cascade.

```c
int inter1 = intersect(1, @P, @N*10, pw, uvw);
int inter2 = intersect(1, @P+@N*0.01, {0,-10,0}, pw2, uvw2);
int inter3 = intersect(2, @P, @N, pw3, uvw3);

if(inter1 != -1) { ... }       // branch A
else if(inter2 != -1) { ... }  // branch B
else { ... }                   // branches C/D
```

- **Math**: K rays → 2^K boolean states → enumerate branches.
- **Complexity**: O(K × log P_in_input) per query. BVH-accelerated.
- **Failure mode**: K-1 rays might decide wrong if priority is wrong. Always check: when ALL rays hit, which one wins?
- **Replacement**: precompute geometric relationships (slower upfront, faster per-query). Or SDF query (continuous, but discretization error).
- **Architecture rule**: this is the "if-else upgrade" — let rays explore the geometry instead of pre-computing relationships.

### A5. Adjacency from incidence (manual `polyneighbours`)

**Signature pattern**: for each prim, collect `pointprims` for each of its points, then count occurrences (parity check for shared edges).

```c
foreach (int p; pts) append(neighs, pointprims(0, p));
for(int nm = 0; nm <= max_nm; nm++) {
    foreach (int n; neighs) if(n == nm) found++;
    if (found > 0 && found%2==0) append(neigh_prims, nm);
}
```

- **Math**: A = (I^T × I) − degree_diag, where I is the vertex-prim incidence matrix.
- **Why parity**: shared edge ⇒ 2 shared vertices ⇒ prim appears 2× (even). Corner-touch ⇒ 1× (odd, not a real neighbour).
- **Complexity**: O(V × E_per_prim²). Lake House: 480 ops total.
- **Replacement**: `polyneighbours()` (Houdini 17.5+) — same algorithm, single-line API.
- **Architecture rule**: NEVER use distance-based "neighbour" detection in topology contexts. Only parity-of-shared-vertices is correct.

### A6. Kernel density estimation + threshold filter (delete-edge-points)

**Signature pattern**: count neighbours within radius, delete if below threshold.

```c
int handle = pcopen(0, "P", @P, r, max_n);
if (pcnumfound(handle) < threshold) removepoint(0, @ptnum);
```

- **Math**: `ρ(x) ≈ |samples ∩ B(x, r)| / |B|` (ball-kernel KDE), then `keep iff ρ > τ`.
- **Complexity**: O(N × log N) with KD-tree.
- **Failure mode**: radius/threshold strongly coupled — must tune together. Edge cases: dense clusters all retained, sparse regions completely removed.
- **Replacement**: write `i@density = pcnumfound(handle)` as side-channel, defer the kill decision to a separate filter wrangle (see PATTERNS.md "separation of scoring vs filtering").

### A7. Level-set boolean union (VDB pipeline)

**Signature pattern**: `vdbfrompolygons → convertvdb → fuse`.

- **Math**: φ_union(x) = min(φ_i(x)) for SDF of each input shape; extract `{x : φ_union(x) = 0}` via marching cubes.
- **Why over polybool**: Lipschitz continuous → robust to coplanar/touching/微小重叠. Polybool fails (退化面 / 自相交) on these.
- **Complexity**: O(M_tri × V_voxel) — worse than polybool's O(M_tri²) average, but **always correct**.
- **Cost**: prim attributes are LOST in conversion. If you need them downstream, transfer to points first, attribtransfer back after.
- **Architecture rule**: any geometry merging step in production should be VDB-based, not polybool-based.

### A8. Graph-distance attribute via `edgetransport` (BFS/Dijkstra-on-edges, packaged as a node)

**Signature pattern**: `findshortestpath` (or hand-marked source group) → `edgetransport` writes `f@dist` along the connectivity graph → `attribremap` → drives `pscale`/color/`@P.y` → `sweep`/extrude.

```
remesh → random_selection (start, end) → findshortestpath
       → polypath → edgetransport (cost = edge length)
       → attribremap (ramp dist→pscale)
       → resample → sweep (pscale = tube diameter)
```

- **Math**: `edgetransport` computes single-source shortest-path distance over the polyline graph. Like Dijkstra on edge weights = edge length; like BFS if you set cost=1.
- **Complexity**: O((V+E) log V) — done in C++ inside the node, no VEX needed.
- **Failure mode**: disconnected components → unreachable points keep `@dist = -1` (or input value). Always `groupcreate dist > 0` then process inside the group.
- **Why use this over manual `pcopen` chain**: edgetransport respects topology; pcopen is a Euclidean distance kernel that ignores edges. Use edgetransport for "distance from root along branches" (vines, roots, cracks); use pcopen for "distance through space" (light, wind, heat).
- **Architecture rule**: any procedural shape with a "trunk → branches → tips" structure should use this. Combine with `polywire` (varying radius) for organic tubes/roots/vines.

### A9. Two-stage solver chain with attribute bridge

**Signature pattern**: Solver A produces deformation/positions per frame; a wrangle converts (rest_P − current_P) into velocity / impulse / activation; Solver B consumes that as initial conditions or per-frame force.

```c
// Bridge wrangle between solver A (e.g. ripplesolver) and solver B (RBD)
vector shockwave = point(1, "P", @ptnum) - @P;  // delta from rest
@v   = @N * length(shockwave) * 10;             // scalar magnitude → vector velocity
@v  *= @Frame > 12;                             // optional frame gate
```

then:

```c
// Cull weak motion before next solver
if (length(@v) < 0.25) removepoint(0, @ptnum);
@v *= 1 + rand(@ptnum + 6223);                   // jitter remaining
```

- **Math**: serialize two PDE solvers via attribute serialization. Solver A (continuous) → attribute → Solver B (discrete RBD).
- **Complexity**: dominated by whichever solver is slower; bridge wrangle is O(N).
- **Failure mode**: forgetting the **frame gate** → bridge fires every frame, double-injecting energy. Always condition on `@Frame > start` or `@Time > t0`.
- **Replacement**: single-solver coupled simulation (Vellum + RBD merge) — more correct but much harder to authoritatively control. Two-stage chain is the pragmatic film/asset choice.
- **Architecture rule**: when you see a project with two `dopnet`s in series and a wrangle between them, the wrangle is **always** the most important node in the project. Read it first.

### A10. Cellular automaton on regular grid (manual `±1, ±W` neighbour math)

**Signature pattern**: solver wrangle on a `30×30` (or general `W×H`) grid where neighbour ptnums are computed by `±1` (left/right) and `±W` (up/down).

```c
// Inside a sopsolver, on a W=30 grid
int W = 30;
int left  = @ptnum - 1;
int right = @ptnum + 1;
int up    = @ptnum - W;
int down  = @ptnum + W;
// gather neighbour states from Prev_Frame input
int n_alive = (point(1,"alive",left)+point(1,"alive",right)+point(1,"alive",up)+point(1,"alive",down));
// transition rule
@alive = (n_alive == 3) || (@alive && n_alive == 2);  // Conway-style
```

- **Math**: discrete dynamical system on a regular lattice; transition function depends only on local neighbourhood.
- **Complexity**: O(N) per tick × T ticks. Fits in a single point wrangle inside a sopsolver.
- **Failure mode**: edge points have invalid neighbours (`@ptnum - 1` wraps to last column, not "off the grid"). Always `if (@ptnum % W == 0) skip_left();` or use a border group to mask.
- **Why this matters**: it's the cheapest way to get emergent patterns (Conway, snow growth, fire spread) without DOP fluids. Master VEX 121 uses this for "growing white-tile reveal" effect.
- **Replacement**: voxel-based volume solver (`gasdiffuse`) — more general but heavier. Lattice CA is the right call for any "tiles flip state by neighbour count" problem.

### A11. Mutual-handshake migration (Gale-Shapley per frame on a CA)

**Signature pattern**: two wrangles running over opposite groups (occupied vs empty), each picking a random target from the *other* group. A third "handshake" wrangle commits the swap only when both sides picked each other.

```c
// Wrangle 1 — occupied points pick a random empty neighbour
foreach (int n; neighbours(0, @ptnum))
    if (!inpointgroup(0, "pts", n)) append(avail, n);
i@target = avail[int(rand(@ptnum * @id, detail(-1, "iteration")) * len(avail))];

// Wrangle 2 — empty points pick a random occupied neighbour
foreach (int n; neighbours(0, @ptnum))
    if ( inpointgroup(0, "pts", n)) append(avail, n);
i@target = avail[int(rand(@ptnum, detail(-1, "iteration")) * len(avail))];

// Wrangle 3 — handshake. Inputs 1 and 2 are both the previous-frame state.
int desired_cell = point(1, "target", @ptnum);          // I want to move here
int desired_pt   = point(2, "target", desired_cell);    // who does my target want?
if (@ptnum == desired_pt) {                             // they want me back
    setpointgroup(0, "pts", desired_cell, 1);
    setpointgroup(0, "pts", @ptnum,       0);
    setpointattrib(0, "id", desired_cell, @id);
    @id = -1;
}
```

- **Math**: distributed conflict resolution. Equivalent to the **stable-marriage / Gale-Shapley algorithm**, but the matching is recomputed each tick instead of converging once.
- **Complexity**: O(N × deg) per iteration, where deg = grid valence (4 for 4-connected, 6 for hex).
- **Why mutual**: without handshake, two occupied cells might pick the same empty cell → both write into it → race condition. With handshake, only the matched pair commits.
- **Cooldown attribute** (essential addition):
  ```c
  if (i@prev_id != @id) { i@swap_iteration = detail(-1, "iteration"); i@block = 1; }
  if (detail(-1, "iteration") - i@swap_iteration >= chi("delay")) i@block = 0;
  ```
  Without cooldown, A→B and B→A flicker on every tick. The `prev_id != id` is the trigger ("I just moved").
- **Failure mode**: if the random seed is the same across iterations, system gets stuck. Always include `detail(-1, "iteration")` in the seed.
- **Replacement**: per-tick Hungarian algorithm (globally optimal) — but Gale-Shapley converges in O(N²) worst case, vs. trivial here.
- Source: 落于ivi 2403_14 — "particles wandering in a quasi-stable equilibrium."

### A12. Fractional Brownian motion (fBm) — octave noise loop

**Signature pattern**: a `for (int i = 0; i < oct; i++)` loop that accumulates `noise()` calls with exponentially-shrinking amplitude and exponentially-growing frequency.

```c
vector npos    = @P;
float namp     = 1.0;
float nval     = 0.0;
float nweight  = 0.0;
int   oct      = chi("octaves");

for (int i = 0; i < oct; i++) {
    nval    += abs(-0.5 + noise(set(npos.x, npos.y, npos.z, @Time))) * namp;
    nweight += namp;
    npos    *= 2.132433;     // lacunarity (NOT 2.0 — avoid grid alignment)
    namp    *= 0.666;        // persistence
}
@Cd = pow(nval / nweight, 0.8765);
```

- **Math**: `B(p) = Σ_i amp_i × noise(freq_i × p)`, where `amp_i = persistence^i`, `freq_i = lacunarity^i`. Self-similar across scales.
- **Complexity**: O(oct) per point. `oct=8` is typically enough; >12 has diminishing returns due to noise sample resolution.
- **Why these constants**:
  - `lacunarity ≠ 2.0` — exact powers of 2 cause visible gridding (octaves align). 2.132 is a smooth irrational that scrambles the alignment.
  - `persistence ≈ 0.5–0.7` — controls roughness. Below 0.5 → too smooth (single-octave dominance); above 0.7 → noisy/grainy.
- **Variants**:
  - Drop `abs()` for plain fBm (smooth hills). Keep `abs()` for **turbulence** (sharp valleys, "ridge noise" look).
  - Use `1 - abs(...)` for "billowy clouds".
  - 4D `noise(x,y,z,t)` for animation.
- **Replacement**: `unifiednoise` / `mountain` / `aanoise` SOPs — preconfigured. Hand-rolled fBm is for control over individual octaves (artistic choice or performance tuning).
- Source: 落于ivi VEX整理03 wrangle 47.

### A13. Volume gradient ascent (line/particle advection along density)

**Signature pattern**: solver wrangle reads `volumesamplev` of a precomputed gradient field and steps `@P` along it.

```c
// Inside sopsolver, group='!fixed'
vector grad = volumesamplev(1, 'density', @P);
if (length2(grad) > 0.00001) {
    grad = normalize(grad);
} else {
    @group_fixed = 1;       // no gradient → freeze this point
    grad = {0, 0, 0};
}
@P += grad * chf("Advection_Strength");
```

- **Math**: `P_{n+1} = P_n + h × ∇φ(P_n)` — Euler integration of gradient flow. The point climbs the field.
- **Complexity**: O(N) per tick × T ticks; volume sample is O(1) tri-linear lookup.
- **Critical fix-point group**: when `|grad| < ε`, the point can't decide where to go — pin it with `@group_fixed = 1` so further iterations skip it. Without this, points fluctuate at saddle-points.
- **Source field options**:
  - `volumegradient` SOP on a density volume
  - `volumetrail` SOP for hand-painted vector field
  - `xyzdist + nearprim` for SDF-based gradient
- **Replacement**: POPs `popadvectbyvolumes` — same idea but with proper time integration (RK2/RK4 instead of Euler).
- **Use cases**: vine growth, lightning paths, line-shrink-toward-density, noise-driven sketches.
- Source: 落于ivi 2401_11 line shrinkage via gradient.

### A14. Mean-shift inverse for local "isolation vector"

**Signature pattern**: `pcfilter` averages neighbour positions; `@P − avg` gives a vector pointing AWAY from the local center of mass; its magnitude = how isolated the point is.

```c
int handle = pcopen(0, 'P', @P, ch("radius"), chi("max_pts"));
vector avg = pcfilter(handle, 'P');
@N = @P - avg;            // vector away from local centroid
@magn = length(@N);       // small = dense neighbourhood, large = isolated
```

- **Math**: this is **inverse mean-shift** — mean-shift moves points TOWARD the centroid (clustering); flipping sign gives a "repulsion vector" pointing OUT.
- **Use cases**:
  - **Density score** (`@magn` is "isolatedness")
  - **Border detection** (`@magn > threshold` ⇒ this point is at a boundary)
  - **Outward normal estimation** for unstructured point clouds (when proper `polynormals` doesn't apply)
- **Failure mode**: in a uniform interior, `@magn ≈ 0` and `@N` direction is dominated by float noise. Threshold to use only when `@magn > some_minimum`.
- Source: 落于ivi 2311_2301 mycelium growth.

## Less common but worth knowing

### Iterative single-step finder + i@stop

```c
int found = 0;
for (int i=0; i<nprimitives(0); i++) {
    if (...condition...) {
        // mark/modify
        found++;
        break;       // ⭐ critical
    }
}
if (found == 0) i@stop = 1;
```

This is **work-list algorithm** — mark one item per iteration, outer for-loop reruns until exhausted. See PATTERNS.md "feedback loop = fixed-point iteration".

### Variable-length tiling (`n = round(dist/size); scale = (dist/n)/size`)

```c
int n = (int)rint(dist/module_size);
float scale = (dist/n) / module_size;
```

- **Math**: minimize seam = exact tiling with stretched modules.
- This is **discrete-continuous bridge** — ubiquitous when placing modules along variable-length edges.

### `rint(x*100)/100` discretization for hash-keys

When using a float position as `rand()` seed key OR for equality test:
```c
float pos_y_quantized = rint(pos.y * 100) / 100;
float seed_offset = rand(seed + pos_y_quantized);
```

- Without this, two "logically same" positions get different random values due to float drift.
- 3 flavors: `*10/10` for relbbox boundary tests, `*100/100` for seed keys, `abs(rint())` for axis-aligned direction tests.

## Identification cheatsheet (when you see this → think this)

| You see | Algorithm name |
|---------|---------------|
| `pcopen + pcnumfound + removepoint` | KDE + threshold filter (A6) |
| `pcopen + pciterate + pcimport` | Spatial JOIN (A3) |
| `intersect()` cascaded with else-if | Multi-ray decision tree (A4) |
| `pointprims + count + parity check` | Adjacency from incidence (A5) |
| `vdbfrompolygons → convertvdb` | Level-set boolean (A7) |
| `prim(0, "height", in_p) + max + +1` | Topological longest path (A1) |
| `addpoint + addvertex` inside loop | Polyline / mesh procedural construction |
| `setpointattrib(0, "P", n2, ...)` to neighbour | Multi-point coordinated update |
| `removeprim(0, p, 0) + addprim + reverse vertex` | Winding flip (only way to flip face normal) |
| `for-loop block + i@stop` | Work-list iteration (fixed-point) |
| `feedback method + chi("iteration")` | Iterative state accumulation |
| `piece method` | Per-element parallel map |
| `findshortestpath → edgetransport → sweep` | Graph-distance attribute (A8) |
| Two `dopnet`s in series with wrangle between | Solver chain w/ attribute bridge (A9) — the wrangle is the most important node |
| `point(1, "P", @ptnum) - @P → @v = @N * length(...)` | Deformation-to-velocity bridge (A9 specifically) |
| Solver wrangle reading `point(1,"x",@ptnum±1)` and `±W` | Grid cellular automaton (A10) |
| `optransform()` * @P inside detail wrangle | Camera-locked anchor (rest matrix inverse) |
| `@v *= @Frame > N` or `@Time > t` | **Frame gate** — guards single-shot energy injection |
| `chramp("ramp", t)` per-point | Authored ramp curve as parameter (faster than fit+if-else) |
| 2 wrangles writing `i@target` to opposite groups + handshake check | Mutual-handshake migration / Gale-Shapley per frame (A11) |
| `for (int i=0; i<oct; i++) { val += noise(p*lacunarity^i)*amp^i; }` | Fractional Brownian motion (A12) |
| `volumesamplev → @P += grad * step` inside solver | Volume gradient ascent (A13) |
| `pcfilter → @N = @P - avg` | Mean-shift inverse / isolation vector (A14) |
| `findattribval(input, ..., -1) != -1` | Set-membership test / anti-join across inputs |
| `intersect → addpoint at hit + delete original` | Ray-cast spawn (raymarcher pattern) |
| `if (length(@v) < min) removepoint` after solver | Velocity-gate / energy filter |
| `sum(arr[0:i])` cumulative | Prefix sum stacking |
| `(p_x * steps) % 2` | Modulo Z-fold (accordion fan) |

## Complexity ladder (where the project will scale)

When asked "will this scale to 10x bigger?", check each layer:

- **O(N) per wrangle**: scales linearly. Most VEX is here.
- **O(N log N) with KD-tree**: scales fine to 1M points (most spatial queries).
- **O(N²) without KD-tree**: dies at ~10K points. Look for `for(p1) for(p2) distance(...)`.
- **O(K × N) with K iterations**: feedback loops with high diameter graphs scale poorly.
- **O(V_voxel)**: VDB scales with volume / voxel_size³. Cube root the linear extent.
