> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# VEX Recipes: Copy-Paste Snippets for Common PCG Problems

Each recipe = problem statement + minimal VEX + when to use + variations.

## R1: Snap to grid

**Problem**: Random points need to align to a grid (so modules can stack).

```c
// point wrangle
@P.x = rint(@P.x / grid_x) * grid_x;
@P.y = rint(@P.y / grid_y) * grid_y;
@P.z = rint(@P.z / grid_z) * grid_z;
```

**MUST follow with** `fuse(tol3d=0.001, snaptype=distancesnap)` to dedupe.

## R2: Filter sparse points (density threshold)

**Problem**: Remove points that don't have enough neighbors (i.e., remove edge/isolated points).

```c
// point wrangle
int handle = pcopen(0, "P", @P, radius, max_pts);
if (pcnumfound(handle) < min_neighbors) {
    removepoint(0, @ptnum);
}
```

**Tuning**: `radius` ≈ 1.05 × grid step; `min_neighbors` = 5 for "interior" detection in 3D grid; lower for "any neighbor" filtering.

## R3: Compute density score (without deleting)

**Problem**: Get density value per point for downstream weighting (don't filter yet).

```c
// point wrangle
int handle = pcopen(0, "P", @P, radius, max_pts);
i@density = pcnumfound(handle);
// optional: f@density_norm = (float)i@density / max_pts;
```

Better than R2 because it preserves data — downstream wrangles can sort/weight by density.

## R4: Probability with condition bonus

**Problem**: "Top floor windows should be more frequent than bottom."

```c
// primitive wrangle
float prob = ch("base_probability");
float bonus = 0;

vector pos = point(0, "P", primpoints(0, @primnum)[0]);
if (pos.y > top_threshold)  bonus += 0.2;        // top floor: +20%
if (@N.z > 0)              bonus += 0.1;          // south-facing: +10%

if (rand(seed + @primnum) > prob + bonus) {
    // didn't pass — leave as-is
} else {
    s@type = "window";
}
```

**The "+= bonus" pattern** is the universal way to combine multiple soft preferences.

## R5: Geometric veto (post-hoc filtering)

**Problem**: After deciding "this is a window", check if the position is actually viable.

```c
// primitive wrangle, AFTER assigning s@type = "window"
vector center = (sum_of_pts) / npts;
vector normal = point(0, "N", primpoints(0, @primnum)[0]);

vector pw, uvw;
int hit = intersect(input_obstacles, center, normal * check_distance, pw, uvw);

if (hit != -1) {
    s@type = "wall";  // veto — revert
}
```

**Pattern**: distribute liberally → veto via geometry check. Always cleaner than "compute valid positions upfront".

## R6: Pick one element from candidates (detail wrangle)

**Problem**: Choose exactly one prim/point to mark, randomly weighted.

```c
// detail wrangle
int candidates[];
for (int i = 0; i < nprimitives(0); i++) {
    if (prim(0, "is_candidate", i) == 1) {
        append(candidates, i);
    }
}
if (len(candidates) == 0) return;

float seed = ch("seed");
int picked = candidates[(int)rint(fit(rand(seed), 0, 1, 0, len(candidates)-1))];
setprimattrib(0, "selected", picked, 1, "set");
```

Used for "pick the entrance door", "pick the chimney location", etc.

## R7: Module attribute init

**Problem**: At a candidate point, set the module name and variation to load.

```c
// point wrangle
float seed = ch("seed");
int max_var = chi("max_variation");

s@name = s@type;                                           // "window", "door", etc.
s@variation = sprintf("0%d", (int)rint(fit(rand(seed + @ptnum), 0, 1, 1, max_var)));
v@scale = {1, 1, 1};
v@up = {0, 1, 0};
// @N is already set from the source prim
```

Downstream `file` SOP loads `modules/<cat>/<cat>_<s@name>_<s@variation>.obj`.

## R8: Variable-length tiling (no seams)

**Problem**: Place N modules along a polyline of unknown length. Modules can't stretch arbitrarily.

```c
// detail wrangle
vector p1 = point(0, "P", 0);
vector p2 = point(0, "P", npoints(0) - 1);
float dist = distance(p1, p2);
float module_size = ch("module_size");

int n = (int)rint(dist / module_size);
if (n < 1) n = 1;
float scale_z = (dist / n) / module_size;

vector dir = normalize(p2 - p1);
for (int x = 0; x < n; x++) {
    vector pos = p1 + dir * scale_z * module_size * (x + 0.5);
    int pt = addpoint(0, pos);
    setpointattrib(0, "N", pt, dir);
    setpointattrib(0, "up", pt, {0, 1, 0});
    setpointattrib(0, "scale", pt, set(1, 1, scale_z));
    setpointattrib(0, "name", pt, "rail_segment");
}
```

`scale_z` is typically 0.95-1.05 (not visible). Used for railings, roof tiles, stair steps.

## R9: Compute orientation angle (atan2 way, not acos)

**Problem**: Module needs to face along @N. Compute Y-axis rotation in degrees.

```c
// point wrangle
@angle = degrees(atan2(@N.x, @N.z));   // [-180, 180]
// for [0, 360]:
if (@angle < 0) @angle += 360;
```

**Don't use** `acos(dot(@N, ref))` + sign correction — atan2 is unambiguous.

## R10: Apply orientation + position from attributes

**Problem**: Place a module rotated by `@angle` and translated to a target.

```c
// point wrangle
matrix3 rot = ident();
rotate(rot, radians(@angle), {0, 1, 0});
@P *= rot;

vector translation = point(1, "P", 0);  // target position from input #1
@P += translation;
```

Often used inside a copytopoints alternative when full matrix control is needed.

## R11: Find topology neighbours (modern API)

```c
// primitive wrangle
int neighs[] = polyneighbours(0, @primnum);  // direct API in 17.5+

// point wrangle
int point_neighs[] = neighbours(0, @ptnum);
```

Pre-17.5 fallback: see R11b below.

## R11b: Find topology neighbours (manual, pre-17.5)

```c
// primitive wrangle
int pts[] = primpoints(0, @primnum);
int neighs[];
foreach (int p; pts) append(neighs, pointprims(0, p));

int max_nm = max(neighs);
int neigh_prims[];
for (int nm = 0; nm <= max_nm; nm++) {
    if (nm == @primnum) continue;
    int found = 0;
    foreach (int n; neighs) if (n == nm) found++;
    if (found > 0 && found % 2 == 0) {  // shared edge = even count
        append(neigh_prims, nm);
    }
}
```

Parity check on shared vertices. NEVER use distance-based neighbor for topology.

## R12: Read attributes from neighbours (spatial JOIN)

```c
// point wrangle
int handle = pcopen(input_neighbours, "P", @P, radius, max_pts);
while (pciterate(handle)) {
    int neigh_id;
    vector neigh_dir;
    pcimport(handle, "id", neigh_id);
    pcimport(handle, "dir", neigh_dir);

    // use neigh_id, neigh_dir to make decisions about @P
}
```

10x faster than `nearpoints + point()` reverse lookup. Use whenever you need neighbor attributes, not just positions.

## R13: Single-step iterator pattern (for-loop block helper)

```c
// detail wrangle, runs inside feedback for-loop block
int found = 0;
for (int i = 0; i < nprimitives(0); i++) {
    if (some_condition(i)) {
        // mark / modify
        setprimattrib(0, "marked", i, 1, "set");
        found = 1;
        break;  // ← critical: only one per iteration
    }
}
if (found == 0) i@stop = 1;  // signal block_end to terminate
```

For "find one, process, repeat" patterns. Used for graph contraction, pair finding, etc.

## R14: Topo-sort longest path (height/level assignment)

```c
// detail wrangle inside feedback for-loop, with chi("primnum") = current prim
int pr = chi("primnum");
int incoming[] = prim(0, "incoming", pr);
int my_h = prim(0, "height", pr);

int in_heights[];
foreach (int in_p; incoming) append(in_heights, prim(0, "height", in_p));
if (len(in_heights) > 0 && max(in_heights) >= my_h) {
    my_h = max(in_heights) + 1;
}
setprimattrib(0, "height", pr, my_h, "set");

// also push outgoing
int outgoing[] = prim(0, "outcoming", pr);
foreach (int out_p; outgoing) {
    if (prim(0, "height", out_p) <= my_h) {
        setprimattrib(0, "height", out_p, my_h + 1, "set");
    }
}
```

Used for layered structures (roof tiers, dependency levels).

## R15: Multi-ray decision tree (geometric branching)

```c
// point wrangle
vector pw1, uvw1, pw2, uvw2, pw3, uvw3;
int inter1 = intersect(input1, @P, @N * 10, pw1, uvw1);
int inter2 = intersect(input1, @P + @N * 0.01, {0,-10,0}, pw2, uvw2);
int inter3 = intersect(input2, @P, @N * 10, pw3, uvw3);

if (inter1 != -1) {
    // direction has neighbor — extend toward it
    @P = pw1;
    i@_p_extended = 1;
}
else if (inter2 != -1) {
    // neighbor below — drop
    @P.y = pw2.y;
}
else {
    // open space — create end cap or sidewall
    int side_pr = addprim(0, "poly");
    addvertex(0, side_pr, @ptnum);
    foreach (int n; neighbours(0, @ptnum)) {
        if (point(0, "P", n).y != @P.y) addvertex(0, side_pr, n);
    }
}
```

For "make this geometry adapt to its environment" cases. Used for roof joining, wall ending, tower capping.

## R16: Quantized seed key (for deterministic noise)

**Problem**: `rand(seed + @P.x)` gives different values for `@P.x = 1.0` and `@P.x = 1.00000001`. You need consistency for points "logically on the same line/plane".

```c
float key_y = rint(@P.y * 100) / 100;        // 0.01 precision
float random_offset = fit(rand(seed + key_y), 0, 1, -0.04, 0.04);
@P.y += random_offset;
```

**Three flavors**:
- `rint(x*10)/10` — for relbbox boundary tests (0.1 precision)
- `rint(x*100)/100` — for position-as-seed-key (0.01 precision)
- `abs(rint(v))` — for "is this axis-aligned?" tests

## R17: Flip face winding (change normal direction)

```c
// primitive wrangle
int pts[] = primpoints(0, @primnum);
removeprim(0, @primnum, 0);  // 0 = keep points, just remove the prim
int new_pr = addprim(0, "poly");
for (int x = len(pts) - 1; x >= 0; x--) {
    addvertex(0, new_pr, pts[x]);
}
```

The ONLY reliable way to flip a normal. Modifying `@N` directly does NOT flip winding.

## R18: Procedural UV (no tile repeats)

**Problem**: Each prim should pull a unique random region from one big texture.

```c
// point wrangle in primitive context
vector uvspace = chv("uvspace");           // size of the source texture in world units
float seed = ch("seed") + ch("iteration");

vector bbx_min, bbx_max;
getbbox(0, bbx_min, bbx_max);
float ws_h = bbx_max.y - bbx_min.y;
float ws_w = bbx_max.x - bbx_min.x;

float uvs_h = ws_h / uvspace.y;
float uvs_w = ws_w / uvspace.x;
float free_h = 1 - uvs_h;
float free_w = 1 - uvs_w;

float rand_u = fit(rand(seed),     0, 1, 0, free_w);
float rand_v = fit(rand(seed + 7), 0, 1, 0, free_h);

vector rel = relbbox(0, @P);
vector2 uv = set(rel.x * uvs_w + rand_u, rel.y * uvs_h + rand_v);

int vtx = pointvertex(0, @ptnum);
setvertexattrib(0, "uv", vtx, -1, uv, "set");
```

The crown-jewel UV pattern. Each prim gets a randomly-placed crop from one texture — eliminates tiling artifacts.

## R19: Cleanup protocol attributes (subnet exit hygiene)

```c
// detail wrangle at subnet OUT
removeprimattrib(0, "_p_stop");
removeprimattrib(0, "_p_keep");
removeprimattrib(0, "_p_raypoint");
// ... or use attribdelete SOP with pattern "_p_*"
```

Adopt convention: protocol attributes (inter-wrangle messages) prefixed with `_p_`. Cleanup at subnet boundary.

## R20: Centroid + normal of a primitive

```c
// primitive wrangle helper
int pts[] = primpoints(0, @primnum);
vector center = {0,0,0};
foreach (int p; pts) center += point(0, "P", p);
center /= len(pts);

vector normal = point(0, "N", pts[0]);  // assume normal is on points
```

Used so often it's worth memorizing. Center for placement, normal for orientation.

## R21: Deformation-to-velocity bridge (two-stage solver)

**Problem**: A solver A (e.g. ripplesolver / cloth) deforms geometry; you want solver B (RBD / particles) to react to that deformation as initial velocity, not at every frame, and only after a trigger.

```c
// Bridge wrangle. Input 0 = current deformed geo, Input 1 = rest geo.
vector shockwave = point(1, "P", @ptnum) - @P;   // delta from rest
@v   = @N * length(shockwave) * ch("velocity_gain");
@v  *= @Frame > chi("trigger_frame");           // gate single-shot energy

// optional: cull weak motion before next solver
if (length(@v) < ch("min_speed")) removepoint(0, @ptnum);
@v *= 1 + rand(@ptnum + 6223) * ch("jitter");   // randomise survivors
```

The frame gate is the trapdoor — without it, you double-inject energy every frame.

## R22: Edge-walked distance + sweep diameter

**Problem**: A branching polyline (vine, root, vein) needs varying tube diameter — fat at root, thin at tip.

```
path geometry  →  edgetransport  (cost = "primintrinsic:measuredperimeter" or 1)
              →  attribremap     (ramp:  dist→pscale)
              →  resample        (subdivide)
              →  sweep           (uses pscale as radius)
```

VEX is minimal — `attribwrangle1: @pscale = @curveu;` or `@P.y = @h;`. The intelligence is in the node choice: edgetransport spreads attribute *along* the graph, not through space.

When you need: trunk-to-tip taper, sap-flow time map, lightning fade, anything with "distance from a designated root."

## R23: Conditional point synthesis at extrema

**Problem**: Add a boundary point/prim only at the start and end of a polyline (not interior).

```c
// point wrangle — fires only on first and last point
if (@ptnum == 0) {
    vector pos = @P - chf('extend_dist') * v@tangentu;
    int p2 = addpoint(0, pos);
    addprim(0, 'polyline', p2, @ptnum);
    setpointattrib(0, 'name', p2, '', 'set');           // anchor name
    setpointattrib(0, 'name', @ptnum, 'piece_0', 'set');
}
if (@ptnum == @numpt - 1) {
    vector pos = @P + chf('extend_dist') * v@tangentu;
    int p2 = addpoint(0, pos);
    addprim(0, 'polyline', @ptnum, p2);
    setpointattrib(0, 'name', p2, '', 'set');
    setpointattrib(0, 'name', @ptnum, sprintf('piece_%d', @numpt-1), 'set');
}
```

The named "" anchor + "piece_N" pattern is **constraint-network preparation** — null-name anchors get treated as world-fixed by Bullet/Vellum, named pieces are RBD bodies. Used in 2401_22 rope bridge.

## R24: Camera-locked anchor via `optransform()` inverse

**Problem**: A floating UI/marker geometry should *appear* fixed in screen space even as the camera moves.

```c
// detail wrangle — input 0 = the marker geo
matrix cam = optransform(chs("cam_path"));   // current camera world matrix
@P *= cam;                                   // bring point into camera-relative frame
```

Anti-pattern: parenting in OBJ context (loses procedural traceability). This pattern keeps everything in SOPs.

Inverse use case: "static camera, animated object" → multiply by `invert(optransform(cam))`.

## R25: Quaternion stacking (additive spin on top of base orientation)

**Problem**: Object should face along `@N` AND spin around its own axis AND wobble.

```c
// Step 1: base orient from N + up
matrix3 m = maketransform(@N, @up);
vector4 base = quaternion(m);

// Step 2: extra rotations as quats
vector4 spin   = quaternion(ch('spin_speed') * @Time, @N);
vector4 wobble = quaternion(set(ch('wob_x'), ch('wob_y'), ch('wob_z')));  // axis-scaled trick

// Step 3: stack via quaternion multiplication (right-to-left = innermost first)
@orient = qmultiply(qmultiply(base, spin), wobble);
```

The `quaternion(vector axis * angle)` shorthand: passing a non-normalised vector treats its length as the rotation angle. Saves a separate `angle, axis` argument.

## R26: Surface-tangent noise projection (noise that flows across, not into, a surface)

**Problem**: A noise displacement should move points *along* the surface, not push them through it.

```c
// point wrangle on a meshed surface with @N defined
vector raw_noise = curlnoise(@P * ch('freq') + @Time * ch('speed'));

// Project away the normal component → keep only tangent component
vector tangent_noise = raw_noise - dot(raw_noise, @N) * @N;

// Apply
@P += tangent_noise * ch('amp');

// To carry colour along the displacement, look up the source colour at the moved position:
@Cd = prim(0, "Cd", xyzdist(0, @P));
```

Behind: `dot(noise, N)` extracts the perpendicular component, multiplied by `N` gives the perpendicular vector; subtract it → only tangent left. Used for water flow, fur grooming, surface paint.

## R27: Direct read from input N via `@opinput<N>_<attr>`

**Problem**: Reading attributes from input 1+ is verbose with `point(1, "...", @ptnum)`.

```c
// Verbose
vector other_P  = point(1, "P", @ptnum);
float other_age = point(1, "age", @ptnum);

// Concise — implicit @ptnum lookup, type inferred for built-in attrs
vector other_P = @opinput1_P;
float other_age = @opinput1_age;     // user attribs default to FLOAT — type if needed:
v@other_v = @opinput1_v;
```

Built-in attrs (P/N/Cd/v/orient/id/name) get the right type automatically; user-defined attribs default to float — declare prefix (`v@`, `i@`, `s@`) when needed. Saves ~5 chars per read; use for short bridge wrangles. Don't use for one-off reads where the verbose form is clearer.

## R28: `@TimeInc` for accumulating solvers (not `@Time%1`)

**Problem**: Inside a `sopsolver`, you want to accumulate rotation angle across frames.

```c
// WRONG — @Time%1 wraps every second, snaps state back to 0
angle = $PI/2 * @Time%1;

// RIGHT — @TimeInc = 1/24s per frame; accumulates monotonically
angle = $PI/2 * @TimeInc;
m = ident(); rotate(m, angle, @up);
@P *= m;
```

Rule: any per-frame delta inside a solver = `@TimeInc`. `@Time` only for sample-the-clock effects.

## R29: Iterative path connection (solver-driven growth)

**Problem**: Grow a polyline outward from a seed point, picking the next neighbour based on a noise-aligned direction.

```c
// Inside a sopsolver — runs each frame
int near[] = nearpoints(0, @P, ch("search_r"));
foreach (int n; near) {
    if (n == @ptnum || point(0, "active", n)) continue;

    vector to_n = point(0, "P", n) - @P;
    vector noise_dir = point(0, "noise_N", @ptnum);

    if (dot(normalize(to_n), noise_dir) >= 0) {  // within 90° of growth direction
        addprim(0, 'polyline', @ptnum, n);
        setpointattrib(0, "active", n, 1);
        setpointattrib(0, "age",    n, @Frame);
        break;                                    // one connection per frame per active point
    }
}
```

Pair with `chramp("color", @age / max_age)` for fade-in trail. Master VEX 121-128 builds 4 variations on this — the search radius, noise field, and "active" propagation rule are the 3 knobs.

## R30: Solver tolerance drift correction

**Problem**: After 1000 solver ticks, accumulated float error makes positions drift off-grid visibly.

```c
// Inside the solver, every cycle
if (abs(sum(@P * axis) - target_slice) <= 0.001) {
    @P = round_to_unit(@P);     // re-snap to nominal grid
}
```

The check `abs(... - target) <= ε` lets solver-state float freely most of the time but pins it back when within ε of the canonical position. Without this, Rubik's-cube-style discrete-motion solvers visibly desync after a minute.

## R31: detail-intrinsic group manipulation (random group cull)

**Problem**: Read the project's primitive groups dynamically, randomly select one each frame, and delete its members.

```c
// detail wrangle, runs each frame
string groups[] = detailintrinsic(0, "primitivegroups");
int idx = int(rand(@Frame) * len(groups));
string victim = groups[idx];
int prims[] = expandprimgroup(0, victim);
foreach (int pr; prims) removeprim(0, pr, 1);   // 1 = remove orphan points
```

`detailintrinsic` reads the *current* group list — works even after upstream changes have added/removed groups. Useful for randomly-revealing assemblies, click-to-shatter UI, etc.

## R32: bbox-corner anchor scaffold

**Problem**: Build N anchor lines from N hand-placed points down to N bbox corners.

```c
// detail wrangle — input 1 = hand-placed anchors, input 2 = bbox-corner geo
for (int i = 0; i < 4; i++) {
    vector top = point(1, 'P', i);
    vector bot = point(2, 'P', i);

    // Optional: inset/offset the bbox corner before connecting
    bot.z += chf('z_offset') * ((i == 0 || i == 1) ? -1 : 1);

    int pt_top = addpoint(0, top);
    int pt_bot = addpoint(0, bot);
    addprim(0, 'polyline', pt_bot, pt_top);
}
```

The `for i in 0..3` loop unrolls 4 anchor lines; per-corner offset modulated by `(i==0||i==1) ? -1 : 1` gives front/back symmetry. Used in 2401_22 rope-bridge tensor cables.

## R33: Sliding-puzzle swap (solver pattern)

**Problem**: A grid where one tile is missing; each beat, swap the missing tile with a random neighbour, sliding it visually.

```c
// detail wrangle inside a sopsolver
int missing  = chi("missing_idx");
int W        = chi("grid_w");
int neighbours[] = array(missing-1, missing+1, missing-W, missing+W);
// Filter: keep only valid (in-grid) neighbours
int valid[];
foreach (int n; neighbours)
    if (n >= 0 && n < npoints(0) && (n != missing-1 || missing % W != 0))
        append(valid, n);

float t   = @Time * ch("rate");
float frac = t - floor(t);
if (frac < 0.05) {
    // Snap-on-beat: pick new target
    int pick = valid[int(rand(@Frame) * len(valid))];
    setdetailattrib(0, "swap_target", pick, "set");
    setdetailattrib(0, "missing_idx", pick, "set");        // missing tile moves
} else {
    // Mid-beat: blend missing tile toward target
    int target = detail(0, "swap_target");
    vector tp = point(0, "P", target);
    vector mp = point(0, "P", missing);
    setpointattrib(0, "P", missing, lerp(mp, tp, frac), "set");
}
```

The mod-time + snap pattern ensures the puzzle "clicks" at integer beats but slides smoothly between. Generalizes to any "discrete state at integer beats, interpolated between."

## R34: Vertex-prim index for reliable curve endpoint detection

**Problem**: Mark the start point of every polyline. Using `uv.x < 0.1` is unreliable.

```c
// point wrangle on resampled curves
int prims[] = pointprims(0, @ptnum);
int prim_id = prims[0];
int verts[] = primvertices(0, prim_id);

// vertexprimindex returns the per-prim vertex index (0 = start, last = end)
int vtx = pointvertex(0, @ptnum);
int vidx = vertexprimindex(0, vtx);

if (vidx == 0)               setpointgroup(0, "start", @ptnum, 1);
if (vidx == len(verts) - 1)  setpointgroup(0, "end",   @ptnum, 1);
```

Use this whenever you need start/end of a curve, especially after `resample`/`fuse` may have shifted UVs. The vertex-prim index is the topology-truth answer.

## R35: chramp + per-point age/distance for color or scale

**Problem**: A common pattern: map an attribute (age, distance, height) into a color OR scale via an artist-authored ramp.

```c
// point wrangle
float t = fit(@age, 0, ch("max_age"), 0, 1);
@Cd      = chramp("color_ramp", t);
@pscale  = chramp("scale_ramp", t) * ch("base_scale");
```

`chramp` UI-edits the curve right in the parameter panel — much faster iteration than fit + if-else cascades. Use for trails, fade-ins, growth animations, vegetation health gradients.

The 落于ivi master collection uses chramp 30+ times — it's the universal "artist control over a single mapping" pattern.

## R36: Uniform-direction sampling (the right way to randomize a vector)

**Problem**: `rand()` returns a vector biased toward the +x +y +z octant — visibly clumpy on instanced geometry.

```c
// point wrangle
v@N    = sample_direction_uniform(rand(@ptnum));        // unit sphere uniform
v@up   = sample_sphere_uniform(rand(@ptnum + 7));       // ditto
v@disk = sample_circle_edge_uniform(rand(@ptnum + 13)); // unit circle edge
```

These 3 functions are the only correct way to get uniformly-random orientations. `rand()` returns ∈ [0,1]^3 — cube biased, NOT spherical. Master VEX 135 spells this out.

When you instance things and they look "more aligned with axes than they should": you used `rand()` instead of these. Switch.

## R37: Dihedral for "rotate Z to N" instancing

**Problem**: A flat disk / decal / patch needs to lay flat on a surface where the normal is `@N` (not necessarily `{0,1,0}`).

```c
// point wrangle — built-in copytopoints assumes Z-aligned source
matrix3 m = dihedral({0,0,1}, @N);   // matrix that rotates {0,0,1} to @N
@orient = quaternion(m);
```

`dihedral(a, b)` returns the **shortest-arc** rotation matrix from a to b. The standard recipe to align Z-aligned source geometry to surface normals — Houdini's copy/instance defaults assume Z is forward.

For "Z to N + spin around N":
```c
matrix3 m = dihedral({0,0,1}, @N);
rotate(m, @Time * ch('spin'), @N);
@orient = quaternion(m);
```

Master VEX 128 is the canonical 2-line form.

## R38: HSV cycle — distinct color per group/index

**Problem**: N groups (or N pieces) need clearly-distinguishable colors, not random-and-occasionally-similar.

```c
// primitive wrangle
int n = chi('numgroups');
i@switch = @primnum % n;
@Cd = hsvtorgb(float(@switch) / n, 1, 1);
```

HSV-cycle gives even hue spacing — 8 groups = 8 colors 45° apart, all clearly distinct. Random Cd often produces two near-identical reds.

Variant — color by group name (stable across renders):
```c
foreach (string g; detailintrinsic(0, 'primitivegroups')) {
    if (inprimgroup(0, g, @primnum) == 1) {
        @Cd = rand(random_shash(g));      // random_shash = stable string→seed
    }
}
```

`random_shash(string)` is the only correct way to seed `rand()` from a string identifier.

## R39: Polar / cylindrical coords + twirl

**Problem**: Apply rotational deformation centered on origin, optionally with twirl-by-distance for spiral effects.

```c
// point wrangle
float angle = atan(@P.x, @P.y);
float r     = length(set(@P.x, @P.y));   // 2D radius — exclude z

float amount = radians(ch('amount'));
float twirl  = r * ch('twirl');           // adds angle proportional to radius

@P.x = sin(amount + angle + twirl) * r;
@P.y = cos(amount + angle + twirl) * r;
```

The `r * twirl` term is the key — without it, plain rotation; with it, **archimedean spiral** (used in galaxy / hurricane / cinnamon-roll deformations).

Use `length(set(@P.x, @P.y))` not `length(@P)` — exclude the axis you're rotating around.

## R40: UV-tile micro-pattern (procedural texture, no raster)

**Problem**: A surface needs a tiling micro-pattern (dots, hex, stripes) authored in VEX, with per-tile randomization. No image texture wanted.

```c
// point wrangle — requires @uv on the geometry
int   tiles = chi('tiles');
float rand  = ch('rand');
float start = ch('dotradius_start');
float end   = ch('dotradius_end');

vector offset = rand(floor(@uv * tiles)) * {1,1,0};   // per-tile random
offset = fit(offset, 0, 1, -rand, rand);
offset.z = 0;

@Cd = smooth(start, end, length( frac(@uv * tiles) * {2,2,0} - {1,1,0} + offset ));
```

Pipeline: `floor(uv*tiles)` = per-tile id (used as rand seed), `frac(uv*tiles)*{2,2,0}-{1,1,0}` = tile-local coords centered on 0, `length()` = radial gradient, `smooth(start, end, ...)` = soft circle, `+ offset` = per-tile jitter.

Variants:
- Replace `length()` with `max(abs())` for square pattern.
- Replace `smooth()` with `chramp("dot", ...)` for artist-controlled falloff.
- Multiply by `rand(floor(uv*tiles))` for per-tile color.

This is the **frac+floor+rand+fit** pipeline — the universal procedural-texture-without-texture template. Master VEX 140-158 walks through 19 progressive refinements of it.

## R41: Edge-axis rotation with pivot (rotate about an arbitrary edge)

**Problem**: Hinge a flap of geometry around a specific edge (door, window shutter, fan blade).

```c
// primitive or point wrangle
int pts[] = primpoints(0, @primnum);
vector p0 = point(0, 'P', pts[0]);
vector p1 = point(0, 'P', pts[1]);

vector axis  = normalize(p0 - p1);          // hinge direction
vector pivot = (p0 + p1) / 2;                // pivot at midpoint of edge
float angle  = radians(ch('angle'));

matrix3 rot = ident();
rotate(rot, angle, axis);

// Move to origin, rotate, move back — the only correct order
@P -= pivot;
@P *= rot;
@P += pivot;
```

The translate-rotate-translate sandwich is mandatory because matrix multiplication rotates around origin; we want to rotate around the edge midpoint. Master VEX 49-62 has the full progression including the `instance(pivot, N, scale, postrot, orient, pivot)` form for full transform.

Used for: doors swinging on hinges, fingers articulating, fan blades, butterfly wings.

## R42: xyzdist + primuv — "snap to surface and inherit attribute"

**Problem**: For each free-floating point, find the closest surface point, snap there, and copy the surface's color/uv/normal.

```c
// point wrangle — input 1 is the surface
int prim;
vector uv;
@d = xyzdist(1, @P, prim, uv);          // get nearest prim+uv on input 1

@P = primuv(1, 'P', prim, uv);          // snap to surface
@Cd = primuv(1, 'Cd', prim, uv);
@N  = primuv(1, 'N',  prim, uv);
i@source_prim = prim;                   // optional: remember source for later
```

This is **point→surface attribute transfer at one shot**. Faster and more controllable than `attribtransfer` SOP because you choose what to copy.

Variant: keep the original `@P`, only inherit attributes:
```c
int prim; vector uv;
xyzdist(1, @P, prim, uv);
@Cd = primuv(1, 'Cd', prim, uv);
```

Used everywhere: scattered points → take surface color, sim points → carry rest-pose color, particle paint → look up base color from a static reference.

## R43: Look-at orient (face the origin, or any target)

**Problem**: A grid of objects should all face a target point.

```c
// point wrangle
vector to_target = chv('target') - @P;
@orient = quaternion(maketransform(normalize(to_target), {0,1,0}));
```

To face the origin: `to_target = -@P`. Used in master VEX `set_orient`. If you also want pitch/yaw/roll on top, stack quaternions per R25.

## R44: Spiral along curve via tangent-axis quaternion

**Problem**: Distribute points along a curve, then have each point spiral around the curve's local tangent direction.

```c
// point wrangle on a resampled curve — needs v@tangentu (or v@N along curve)
float speed  = @Time * ch('speed');
float angle  = speed + @curveu * ch('spirals');   // spirals scales with curve U

vector4 q = quaternion(v@tangentu * angle);       // axis-scaled quaternion
@N = qrotate(q, @N);                              // rotate the existing N around tangent
```

The `quaternion(axis * angle)` shorthand encodes both axis and angle in one vector. `@curveu * spirals` makes denser turns at the curve's end if spirals > 1.

Pair with a `polywire` or `sweep` to render the spiraling normal as visible geometry. Master `spiral_vex` is the canonical form.

## R45: `setprimintrinsic('transform', ...)` for packed-prim scaling

**Problem**: A packed primitive (single point representing a sub-network of geometry) won't respond to `@P *= scale_matrix` because the geometry is hidden inside.

```c
// point wrangle on packed prims (one point per prim)
matrix3 m = ident();
scale(m, chv('scale'));
setprimintrinsic(0, 'transform', @ptnum, m);
```

Packed prims have a hidden internal transform matrix (`primintrinsic`) that controls how their unpacked geometry is rendered. Modifying `@P` only moves the wrapper point; the packed geometry rotates/scales around its own internal pivot via this intrinsic.

Same pattern for rotation: `rotate(m, angle, axis)` then `setprimintrinsic`. Used for instancing, RBD pieces, anything "packed".

## R46: Lifetime decrement + variable-life cull

**Problem**: Particles or instanced points should live for N frames, then disappear. With per-point variation.

```c
// Spawn wrangle (point wrangle, runs once on spawn)
int life    = chi("life");
int lifeVar = chi("lifeVar");
@lifetime = life + int(rint(fit01(rand(@P*342), -lifeVar, lifeVar)));
@creationFrame = @Frame;

// Tick wrangle (inside solver, runs each frame)
if (@lifetime == 0) removepoint(0, @ptnum);
@lifetime--;
```

`fit01(rand(seed), -V, V)` symmetric jitter around mean. The `int(rint(...))` cast ensures whole-frame counts.

`@creationFrame` enables age-based effects:
```c
@P.y += chf("liftRate") * (@Frame - @creationFrame);   // rise over time
@Cd  = chramp("fade", (@Frame - @creationFrame) / @lifetime);
```

Used for sparks, pollen, lightning arcs, anything with a finite life.

## R47: `findattribval` anti-join (dedupe by id across inputs)

**Problem**: Two point sets share an `@id` attribute. Keep only points whose `@id` is NOT present in the other input.

```c
// point wrangle on input 0 — input 1 is the "exclude" set
if (findattribval(1, "point", "id", @id, 0) != -1) {
    removepoint(0, @ptnum);
}
```

`findattribval(input, class, attrname, value, start)` returns the first index where the attribute equals the value, or -1 if absent. The `start=0` is the search starting index.

Use cases:
- "remove already-spawned points" (dedupe across solver iterations)
- "keep only points without a matching twin" (set difference)
- "where does this id live in the other geo?" (lookup)

This is **set-membership test in O(N)**. For large N, prefer building an attribute promotion + `findattribval`.

## R48: Ray-cast spawn (intersect → addpoint at hit, kill original)

**Problem**: Each source point should fire a ray. Where the ray hits, spawn a new point (carrying source attribs); then delete the original.

```c
// point wrangle. Input 1 = collision geometry.
vector hit;
float u, v;

if (intersect(1, @P, @N * chf("range"), hit, u, v) != -1) {
    int newPt = addpoint(0, hit);
    setpointattrib(0, "id",            newPt, @id,    "set");
    setpointattrib(0, "lifetime",      newPt, @lifetime, "set");
    setpointattrib(0, "N",             newPt, -@N,    "set");   // flip — ricochet
    setpointattrib(0, "creationFrame", newPt, @Frame, "set");
}

removepoint(0, @ptnum);
```

Flipping `N` to `-N` makes the spawned point "bounce back" — useful for chained ray hops (lightning, fracture propagation, sound bouncing).

If you want to keep the original point too, drop the final `removepoint`. But typically you spawn-then-kill so the ray-front advances.

## R49: Mutual-handshake cell migration (cellular automaton with safe swaps)

**Problem**: A grid where some cells are occupied and some empty. Each tick, occupied cells want to migrate to a random adjacent empty cell — but two cells must not target the same destination, and a cell shouldn't migrate without consent.

```c
// 1) Occupied → pick random empty neighbour (point wrangle, group='occupied')
int avail[];
foreach (int n; neighbours(0, @ptnum)) {
    if (!inpointgroup(0, "occupied", n) && i@block == 0) append(avail, n);
}
if (len(avail)) i@target = avail[int(rand(@ptnum * @id, detail(-1, "iteration")) * len(avail))];

// 2) Empty → pick random occupied neighbour (point wrangle, group='!occupied')
int avail[];
foreach (int n; neighbours(0, @ptnum)) {
    if (inpointgroup(0, "occupied", n) && point(0, "block", n) == 0) append(avail, n);
}
if (len(avail)) i@target = avail[int(rand(@ptnum, detail(-1, "iteration")) * len(avail))];

// 3) Handshake check (point wrangle on occupied, inputs: 0=self, 1=self, 2=self)
int desired_cell = point(1, "target", @ptnum);
if (desired_cell == -1) return;
int desired_pt   = point(2, "target", desired_cell);
if (@ptnum == desired_pt) {
    // Both sides agree — execute swap
    setpointgroup(0, "occupied", desired_cell, 1);
    setpointgroup(0, "occupied", @ptnum,       0);
    setpointattrib(0, "id", desired_cell, @id);
    @id = -1;
}

// 4) Cooldown to prevent flip-flopping (point wrangle, runs after swap)
if (i@prev_id != @id) { i@swap_iteration = detail(-1, "iteration"); i@block = 1; }
if (detail(-1, "iteration") - i@swap_iteration >= chi("delay")) i@block = 0;
i@prev_id = @id;
```

The handshake is the key: A picks B, B picks A, only then swap. Otherwise A might overwrite B's data while B is being overwritten by C.

---

# Synthesis 135 Reflections — VEX + Node Inventory

The original author referenced an external study inventory; it is not a dependency of this skill. The recipes below are retained as examples, not a claim that every source project was validated here.

Quick-reference highlights:

## Top VEX functions (newly verified)
- `intersect()` — corpus production-grade ray cast (5 paradigms: 0118 baker, 0181 normal unify, 0207 silhouette, 0419 LIDAR, 0584 collision)
- `xyzdist + primuv` — closest surface point + sample (collision/snap/baker)
- `pcfind / pcopen + pcfilter` — neighborhood (works on **arbitrary attribute** P/Cd/N/v)
- `volumegradient` — volume attribute gradient (gradient flow paradigm)
- `dihedral(v1, v2)` → matrix3 (vector→vector rotation, rare)
- `eulertoquaternion(euler, XFORM_XYZ)` — euler→quaternion (3 paradigms累计: matrix/axis-angle/euler)
- `toNDC / fromNDC` — camera projection (silhouette extraction trick)
- `relbbox / getbbox_size` — coordinate utilities
- `sprintf('piece_%i_chumk_%02i', a, b)` — production naming
- `inpointgroup / neighbours` — cellular automata primitives
- `addpoint + addprim + addvertex + setpointgroup + setpointattrib` — wrangle 内动态拓扑

## Top nodes (newly verified)
- **RBD production**: rbdmaterialfracture, rbdbulletsolver, rbdconfigure, rbdconstraintproperties, rbdconvertconstraints, rbdexplodedview, rbdio, rbdxform, pointvelocity, bulletsoftconrel, hardconrel
- **Vellum**: vellumdrape (static), vellumconstraintproperty, vellumsource
- **Pyro microsolver**: gasdisturb, gasfieldvop, gasopencl
- **POP**: popreplicate, popinteract, popaxisforce, popadvectbyvolumes, popfluid, popstream
- **FLIP**: collisionsource, multisolver (FLIP+sopsolver same substep)
- **Heightfield**: full HF system (maskbyfeature, erode microsolver chain)
- **CHOP**: jiggle (spring physics封装)
- **VDB**: vdbtospheres, vdbcombine, vdbreshapesdf, vdbsmoothsdf
- **Performance**: compile_begin/end + invoke
- **HDA**: switchif, $OS group naming, partition+name+foreach piece 三件套
- **Procedural**: polyexpand2d (with @edgedist), relax, softtransform, attribinterpolate, attribfromvolume, distancealonggeometry, distancefromgeometry, clusterpoints, triangulate2d, drawcurve
- **UV**: uvautoseam → uvflatten → uvlayout 三件套, uvquickshade
- **Wire**: wirecapture + wiredeform (wire-driven mesh deformation)
- **Labs (production blackbox)**: labs::simple_rope_wrap, labs::sphere_generator, labs::extract_silhouette, labs::calculate_slope, labs::autouv, labs::tree_simple_leaf, labs::curve_branches

The cooldown prevents the same cell from migrating twice in N iterations (would make patterns flicker).

This is **stable-marriage / Gale-Shapley per frame**. Used for crystal growth, traffic simulation, occupancy dynamics. Source: 落于ivi 2403_14.

## R50: Multiplicative mask stacking

**Problem**: An effect should fire only where multiple soft conditions are simultaneously satisfied. Each condition has a continuous strength.

```c
// point wrangle
float mask_noise  = f@mask_noise - f@mask_noise_end;       // ramp difference
float mask_fabric = fit(f@mask_fabric, 0.5, 1, 1, 0);       // INVERTED fit
float mask_dist   = chramp("falloff", fit(length(@P), 6, 10, 0, 1));
float mask_angle  = clamp(dot(@N, {0,1,0}), 0, 1);

float final = mask_noise * mask_fabric * mask_dist * mask_angle;
@P.y += final * ch("amplitude");
```

Multiplicative because: any single mask = 0 must zero the result. (Additive would let one strong mask overpower the rest.)

Three useful sub-patterns:
- `chramp(name, value)` for artist-shaped one-knob masks
- `fit(x, a, b, 1, 0)` (inverted) for "high values fade"
- `clamp(dot(N, target), 0, 1)` for facing-direction masks

Source: 落于ivi 2401_01 polar water wave.

## R51: Polar / cylindrical angle to UV (radial wrap)

**Problem**: Need a 0..1 attribute around the Y axis (so that a ramp drives an effect rotating around the origin).

```c
// point wrangle
float angle = atan(@P.z, @P.x) / $PI;       // [-1, 1]
angle       = fit(angle, -1, 1, 0, 1);      // [0, 1]
float t     = (angle + ch("rotate") * @Time) % 1;   // time-rotated wrap
@Cd         = chramp("ring", t);
```

`atan(z, x)` not `atan2(x, y)` — Houdini's `atan(y, x)` returns [-π, π]; divide by π for [-1, 1].

For cylindrical: also include `@P.y`:
```c
float u_ring  = (atan(@P.z, @P.x) / $PI + 1) / 2;
float v_axis  = relbbox(0, @P).y;
v@uv = set(u_ring, v_axis, 0);   // cylinder UV unwrap
```

Source: 2401_01 — drives rippling water wavefront expanding outward.

## R52: Blend toward reference geometry (procedural morph target)

**Problem**: Geometry should smoothly transition to a target shape based on a per-point mask.

```c
// point wrangle. Input 1 = target geometry (must have matching @ptnum).
float bias = chramp("ramp", fit(length(@P), 7.5, 10, 0, 1));
@P = lerp(@P, point(1, "P", @ptnum), bias);
```

Two-target morph (input 1 + input 2):
```c
float bias = chramp("ramp", @blend);
@P = lerp(@P, point(1, "P", @ptnum), fit(bias, 0,   0.5, 0, 1));
@P = lerp(@P, point(2, "P", @ptnum), fit(bias, 0.5, 1,   0, 1));
```

The two-target form is the core of multi-stage shape morphing (used in 2310_3101 weaving — a 7-stage transition between deformed curves).

Combine with R50 (mask stacking) to make the morph fire only in specific regions.

## R53: Prefix sum stacking (place items on top of each other)

**Problem**: A column of objects with different heights — each should sit on top of the previous one without gaps.

```c
// point wrangle on a polyline whose primintrinsic carries an array attribute "height"
float h[] = prim(0, 'height', i@primnum);   // array of per-segment heights
v@P.y = sum(h[0:i@ptnum]);                  // cumulative sum up to this point's index
```

`sum(arr[0:i])` is the **prefix sum** — `arr[0] + arr[1] + ... + arr[i-1]`. Each point's Y becomes the running total, so points stack exactly without overlap regardless of variable heights.

Generalizes to any 1D layout problem: stair steps with variable rise, beads on a string with variable size, layered shells with variable thickness.

Source: 落于ivi 2402_09 stacking objects.

## R54: Trail visualization (motion-blur-style streaks)

**Problem**: Visualize moving particles' direction as short tail lines.

```c
// point wrangle on a copy of the particles
@P = @P - (@v * chf("trailLength")) * @TimeInc;
```

Move each point backward along its velocity by `trailLength * dt`. Connect the original and trail point with a `polyline` for visible streaks. Combine with `pscale = chramp("trail", curveu)` to taper the line.

`@TimeInc` (frame duration in seconds) keeps the trail length frame-rate-independent — at 24 fps and 48 fps, the trail looks the same length.

## R55: Stage progression via blend chain (multi-stage shape morph)

**Problem**: A geometry should transition through N distinct shapes over time, blending smoothly between consecutive stages.

```c
// Each stage has 4 wrangles repeated with subscripts:
// 1. Stage-N deformation (sin / matrix / etc — defines shape)
// 2. f@pscale = chramp("Scale", @curveu - @Time * 0.1) * 4;          // scale envelope
// 3. v@P = lerp(@P, v@opinput1_P, chramp("Blend", @curveu - @Time * 0.1));   // blend to next stage
// 4. (optional) extra blend to a third stage:
//    v@P = lerp(@P, v@opinput1_P, fit(rblend, 0,   0.5, 0, 1));
//    v@P = lerp(@P, v@opinput2_P, fit(rblend, 0.5, 1,   0, 1));
```

Two key tricks:
1. **`@curveu - @Time * 0.1`** as the ramp X-axis — makes the blend wave sweep along the curve, giving directional progression instead of synchronous transition.
2. **3-way blend via `fit(t, 0, 0.5, 0, 1)` + `fit(t, 0.5, 1, 0, 1)`** — the first half blends to stage A, the second half blends to stage B. Smooth handoff at t=0.5.

Source: 落于ivi 2310_3101 weaving (7 progressive stages).

## R56: fBm — fractal noise loop (octave layering)

**Problem**: Need natural-looking noise (mountains, clouds, terrain). Single `noise()` is too smooth.

```c
// point or volume wrangle
vector npos    = @P / 1.0 + set(0, 666, 0);   // arbitrary offset to avoid origin
float namp     = 1.0;
float nval     = 0.0;
float nweight  = 0.0;
int   oct      = chi("octaves");                      // typically 4-9

for (int i = 0; i < oct; i++) {
    float n = abs(-0.5 + noise(set(npos.x, npos.y, npos.z, @Time)));   // 4D for animation
    nval    += n * namp;
    nweight += namp;
    npos    *= 2.132433;                              // lacunarity (avoid integers)
    namp    *= 0.666;                                 // persistence (gain)
}

float final = nval / nweight;                         // normalize
@Cd = pow(final, 0.8765);                             // gamma for visual punch
```

- `lacunarity` = 2.132433 (NOT 2.0 — exact powers create visible grids)
- `persistence` = 0.666 (controls roughness; <0.5 smooth, >0.7 noisy)
- `abs(noise - 0.5)` flips the noise into "turbulence" (sharp valleys) — drop the abs for plain fBm
- Normalize by `nweight` so amplitude is independent of `oct`

When `unifiednoise` SOP is too rigid, this is the manual recipe.

Source: 落于ivi VEX整理03 wrangle 47.

## R57: Mitered inset (uniform corner offset on polylines)

**Problem**: Inset a polyline by a fixed distance, but corners need extra inset (proportional to `1/sin(half_angle)`) so the offset distance is uniform.

```c
// point wrangle on a polyline (interior points only — pin endpoints separately)
float inset = chf("inset");
int nb[] = neighbours(0, @ptnum);
if (len(nb) != 2) return;          // skip endpoints / branch points

vector pos_0 = point(0, "P", nb[0]);
vector pos_1 = point(0, "P", nb[1]);

vector a = normalize(@P - pos_0);
vector b = normalize(@P - pos_1);
vector c = normalize(a + b) * -inset;       // bisector direction
float halfsine = sqrt((1.0 - dot(a, b)) / 2.0);   // sin of half-angle

@P += c / halfsine;
```

Why `1/halfsine`: at a 90° corner, walking the bisector by `inset` only moves you `inset * sin(45°) ≈ 0.707 * inset` perpendicular to the edge. Dividing by `sin(half_angle)` undoes the projection.

For 180° corners (straight line), `halfsine = 1` and the divide is a no-op. For acute angles, the divisor approaches 0 — clamp to avoid blowups.

Source: VEX整理03.

## R58: Cylindrical wrap (flat → tube)

**Problem**: A flat strip should wrap into a cylinder around the Y axis.

```c
// point wrangle
float rot    = chf("rotate");                   // 1 = full wrap, 0.5 = half wrap
float angle  = relbbox(0, @P).y * $PI * 2 * rot;

@P.z = cos(angle) * @P.x;
@P.x = sin(angle) * @P.x;
```

`relbbox.y * 2π` parametrizes Y from 0 to one full turn. `@P.x` becomes the radius (preserves the strip's width). `@P.z` is built fresh.

Inverse — cylinder back to flat:
```c
float angle = atan(@P.z, @P.x);
@P.x = length(set(@P.x, 0, @P.z));
@P.z = angle / (2 * $PI) * radius;
```

## R59: Smooth tangent via central difference (per-point curve normal)

**Problem**: Compute a smooth tangent direction along a polyline, with proper handling at endpoints.

```c
// point wrangle
vector pos;
if (@ptnum == 0) {
    @N = point(0, "P", @ptnum + 1) - @P;                                   // forward diff
} else if (@ptnum == npoints(0) - 1) {
    @N = @P - point(0, "P", @ptnum - 1);                                   // backward diff
} else {
    @N = (point(0, "P", @ptnum + 1) - point(0, "P", @ptnum - 1)) / 2;      // central diff
}
@N = normalize(@N);
```

Central difference is more accurate than `@N = next - current` (forward only), especially at curves. Endpoints use one-sided differences because there's no "before -1" or "after last".

This is the **finite-difference tangent** — discretized first derivative. Accurate to O(h²) for central; O(h) for forward/backward.

## R60: HSV adjustment (shift hue/saturation/value as one operation)

**Problem**: Shift the entire palette of `@Cd` by deltas in hue, saturation, value space (not RGB).

```c
// point wrangle
@Cd = hsvtorgb(rgbtohsv(@Cd) + set(ch("hue"), ch("sat"), ch("val")));
```

Useful for color theme variations, day/night palette shift, faded/saturated UI variants. Hue is angular: shift by 0.5 inverts colors (red ↔ cyan).

Hue-only shift on negative-N faces (handles back-face coloring):
```c
@Cd = @N;
if (sign(sum(@N)) < 0) {
    vector hsv = rgbtohsv(-@N);
    hsv.x -= 0.5;            // half-rotation = complementary color
    @Cd = hsvtorgb(hsv);
}
```

Source: master VEX `set_face_colour`.

## R61: Random alphabet pick (string array sampling)

**Problem**: Need random chars/strings per point.

```c
// point wrangle
string alphabet[] = string[](array(
    "A","B","C","D","E","F","G","H","I","J","K","L","M",
    "N","O","P","Q","R","S","T","U","V","W","X","Y","Z"));

s@text = alphabet[int(fit01(rand(@ptnum), 0, len(alphabet) - 1))];
```

`string[](array(...))` is the verbose array-literal cast. `fit01(rand, 0, len-1)` maps rand to valid index range. `int()` truncates.

Use for procedural keyboard, runes, hex, license plates. Substitute `array("0".."F")` for hex chars, etc.

## R62: Hanging wire / catenary builder (detail wrangle)

**Problem**: Build a sagging cable between two anchor points, shape controlled by a ramp.

```c
// detail wrangle. Input 0 = 2 anchor points (start, end).
int N = chi("number_of_points");
vector A = point(0, "P", 0);
vector B = point(0, "P", 1);

for (int i = 1; i <= N; i++) {
    float t = float(i) / (N + 1);
    vector p = lerp(A, B, t);
    p.y -= chramp("Shape", t);          // sag controlled by ramp
    addpoint(0, p);
    if (i == 1) addprim(0, "polyline", 0, 2);                        // start segment
    else if (i == N) addprim(0, "polyline", N + 1, 1);                // end segment
    else addprim(0, "polyline", i + 1, i + 2);                        // interior segments
}
```

The chramp lets the artist draw the shape — drop a parabola for catenary, an asymmetric curve for off-balance hangs, multiple humps for tangled wire.

Source: 落于ivi VEX整理04.

## R63: Centroid pivot via stored inverse transform

**Problem**: Center a model at origin, do something, then return it to original position. (Used for rotation around centroid, scaling about centroid, etc.)

```c
// Wrangle 1: capture + center (point wrangle)
vector min, max;
getpointbbox(0, min, max);
vector centroid = (max + min) / 2.0;

matrix xform = invert(maketransform(0, 0, centroid, {0,0,0}, {1,1,1}));
@P *= xform;

// Save the matrix on every point so we can undo later
4@xform_matrix = xform;

// ... do work in centroid-relative coords ...

// Wrangle 2: restore (point wrangle)
@P *= invert(4@xform_matrix);
```

The matrix attribute lives on every point, which is wasteful for large meshes — promote to detail with `attribpromote` if memory matters.

Source: 落于ivi VEX整理04. Cleaner than `xform → ... → xform-with-negative-translate`.

## R64: Fan-open via per-prim rotation by index U

**Problem**: A line of N prims should fan out — rotated symmetrically around the center.

```c
// point or primitive wrangle
float spread = chf("spread");
v@P -= prim(0, "P", i@primnum);   // local pivot at prim centroid

float u = i@primnum / float(i@numprim - 1);   // 0..1 along the row
float amount = (u - 0.5) * spread;             // -spread/2 to +spread/2

matrix3 m = ident();
rotate(m, amount, {0,0,1});
v@P *= m;

v@P.z = u * 0.1;                  // slight Z stagger so they don't overlap
```

Combine with **modulo z-fold** for accordion fans:
```c
@P.z += (relbbox(0, @P).x * chi("steps")) % 2;   // 0/1 alternating fold
@P.z *= chf("depth");
```

Source: 2402_08 fan model.

## R65: Cumulative arc length along polyline

**Problem**: Per-point attribute `length_partial` = arc length from polyline start to this point.

```c
// primitive wrangle
int pts[] = primpoints(0, @primnum);
float length = 0;
addattrib(0, "point", "length_partial", 0.0);

for (int i = 1; i < len(pts); i++) {
    vector pa = point(0, "P", pts[i - 1]);
    vector pb = point(0, "P", pts[i]);
    length += distance(pa, pb);
    setpointattrib(0, "length_partial", pts[i], length);
}
f@length = length;            // total arc length on the prim
```

The `length_partial / @length` ratio gives a more accurate "how far along the curve am I" than `@curveu` (which is parametric, not arc-length-based, so it bunches at high-curvature regions).

Use whenever animation speed should be uniform along a non-uniform curve (cars on winding roads, walks along a path).

## How to use this catalog

When facing a new PCG problem:
1. Identify the problem in plain language ("filter sparse points", "pick one entrance", etc.)
2. Find matching recipe(s) above
3. Copy → adapt to context → done

Don't reinvent. These 20 recipes cover ~80% of the VEX in a typical PCG project.

## Batch 41 additions

### Discrete 1D wave equation (PDE in solver SOP — corpus 第 11 真算法工程 0257)

```c
// solver1 attribwrangle1 — compute Accel + Speed
if (@ptnum < 1 || @ptnum >= @numpt - 1) { return; }  // fixed endpoints

vector p0 = point(geoself(), "P", @ptnum - 1);
vector p1 = point(geoself(), "P", @ptnum);
vector p2 = point(geoself(), "P", @ptnum + 1);

float u_prev = p0.y;
float u_center = p1.y;
float u_next = p2.y;

float dx = (p2.x - p1.x);
float dt = 1.0 / (float)$FPS;
float v = chf("v");

f@Accel = v * v * (u_next + u_prev - 2 * u_center) / (dx * dx);
f@Speed += f@Accel * dt;

// solver1 attribwrangle2 — integrate position
@P.y += f@Speed * dt;
```

**关键点**:
- 中央差分近似 ∂²u/∂x²
- Verlet 风格 2 步: Accel → Speed → P
- 固定端 boundary `if (ptnum<1 || ptnum>=numpt-1) return`
- `dt = 1/$FPS` 跟 Houdini 帧率对齐
- CFL: dt < dx/v 数值稳定性约束

**拓展**: 改 `.y` 为 vector → 3D 振动, 改 stencil 5-point Laplacian → 2D 波动 / 热方程 / 反应扩散.

### Ray + copytopoints projection (production 0-wrangle)

```
testgeometry / source mesh
  ↓ ray (project to target surface, dir=N or custom)
  ↓ copytopoints (instance prefab on each projected point)
target surface (e.g., grid)
```

无 wrangle 全节点. 跟 `intersect()` VEX 函数同概念但 production 更常用 ray 节点.

### popgrains line constraint (noodle/rope sim — 1D strand 第 3 paradigm)

DOP 内 popgrains 第二输入吃 sopsolver 输出的 line connectivity:

```
DOP:
  popobject + popsource (emit, attribwrangle1: i@pid=ptnum, @pscale=0.1)
  → popsolver
      → sopsolver1: dop_geometry → add (按 pid 连接) → resample → convertline → output line
      → popgrains (input2 = sopsolver1) — grains 沿 line 互相约束
  → gravity + groundplane
SOP output: polywire → subdivide
```

**关键**: `i@pid` = grain identity, DOP-internal sopsolver = production trick.

### Vellum pin to moving target (universal anim pattern)

```
animated_target (sphere transform / character anim)
  ↓
vellumconstraints (mode=stretch+pin, attach_geom=animated)
  ↓
vellumsolver
```

无 VEX. 配 `color-as-group` (0017) 可分阶段释放 pin.

---

## Batch 34 additions

### Sim attribute modification (4 paradigms)
- **sopsolver inside DOP** — most common (15+ projects: 0497/0511/0613/0494/0533/0540)
- `geometrywrangle` (DOP-level wrangle, 0143) — direct sim attribute modification (vs SOP attribwrangle)
- `enablesolver` (DOP, 0143/0494) — conditionally activate RBD pieces
- `attribvop in sopsolver` (0034/0533/0540) — VOP-style

### Pyro burst paradigm (corpus < 5)
- `pyroburstsource` — short burst (vs `pyrosource` persistent), explosion VFX
- `vdbactivate` — limit volume to bbox (performance trick)
- `volumetrail` — visualize v field (debug)
- volume `pcopen + pcfilter` — neighborhood v averaging

### Sim transform reuse (production performance)
- `extracttransform` SOP — extract transform matrix from packed prims (~10 projects)
- Wrangle equiv:
  ```c
  matrix m = point(1, 'transform', i@class);
  @P *= m;
  ```
- Use case: sim only one mesh, reuse transforms for other meshes
- Same paradigm as `pointdeform` (0140) and `attribinterpolate` (0258) — sim → SOP transfer reuse

## Batch 35 additions

### v field generation (4 paradigms)
- `volumevop + aaflownoise + vecsetcompon` (0334) — procedural v field, 极简 7 节点
- `vdbfromparticles + popadvectbyvolumes` (0489) — particle-based v field
- `pyroburstsource → volumevop pcfilter` (0420) — explosion-driven v field
- `curlnoise + dihedral` (0530) — surface tangent v field

### v field debug
- `volumetrail` SOP — sample v field, output trail polylines (corpus < 5: 0334/0420)

### Single-nearest-point
- `nearpoint(input, P)` — single nearest point (vs `nearpoints(input, P, radius, max)` array)
- Distance-based culling: `if (distance(@P, nearpos) > thresh) removepoint(0, @ptnum);`

### Edge-based fracture
- `edgefracture` — fracture mesh edges along user-drawn curve (vs voronoi cell-based)
- `edgegroup_to_curve` (labs) — edge group → polyline (corpus < 5)

### Matrix ↔ quaternion VOP
- `vectomatx` (3 vectors → matrix3) → `matxtoquat` → quaternion
- 4 ways to create quaternion: matrix / axis-angle / euler / vectomatx+matxtoquat

### Vellum cleanup chain
- `vellumio + vellumpostprocess` (production standard after vellumsolver)

### POP curve force
- `popcurveforce` — POP particles forced along a curve (production curve-driven, corpus rare)

### Cloth tear paradigms (4)
1. vellum + edgefracture + drawcurve (0042) — interactive user-drawn
2. glue_over_gap (0322) — vellum biscuit
3. vellumconstraints break threshold — force-driven
4. vellum + popforce — explicit force

## Batch 36 additions

### Multi-layer sim (production VFX)
- 双层 sim + pointdeform sync: 主 sim 大尺度 + 二级 sim 细节
- pointdeform binding: 主 sim 变形 → 二级 sim 输入
- Projects: 0131 (鱼游动), 0044 (chain proxy), 0594 (concrete → 钢筋), 0140 (Bullet Soft animation)

### Stochastic attribute spread (vs explicit neighbours)
```c
if (@Cd > 0.1 * rand(@ptnum + @Frame)) @Cd = 1;
```
- Wave-like spread without nearpoints/pcfind explicit
- Apply in sopsolver (cumulative across frames)
- 0395 alpha dissolve

### Radial vector idiom (P - reference center)
```c
vector pos = point(1, 'P', 0);
v@N = normalize(@P - pos);
```
- Direction from reference center to current point
- Projects: 0633, 0086, 0297

### KineFX for non-character procedural
- `kinefx::rigdoctor` + `kinefx::rigattribwrangle` — works on grass/hair/any procedural deform
- Not only for character rigging
- Project: 0297 (草堆)

### Spiral curve nodes
- `spiral` SOP — built-in spiral primitive (vs 0162 wrangle `up * sin + out * cos`)
- Parameters: turns / radius / height / segments

### POP curve force
- `popcurveforce` — POP particles forced along arbitrary curve (vs `popaxisforce` along axis)
- Projects: 0298 (spiral), 0309 (扰乱)

### Cd → Alpha
```c
@Alpha = @Cd.r * 0.75;
```
- Standard transparency drive via color channel

## Batch 37 additions

### `unifiednoise_static` (production noise standard)
- VOP node, multi-type (perlin/simplex/sparse-convolution/worley)
- `_static` doesn't depend on time (vs `unifiednoise`)
- ~10-15 corpus projects
- Better than turbnoise for production

### Multi-layer noise stack
- 0007 (4 mountain), 0091 (3 noise modes), 0139 (4+ noise in 1 VOP), 0310 (mountain1+2), 0494 (turbnoise per scale)
- Pattern: divconst per layer for frequency control + switch enable per layer

### Vellum fluid
- `vellumconstraints_grain` — vellum fluid/sand constraint
- `vellumpack + vellumunpack` — cache-friendly packing
- POP forces work in vellumsolver too (popaxisforce / popforce / popwind)

### `fluidsource` SOP (universal)
- `fluidsource` — works with both Pyro and FLIP (vs `pyrosource` Pyro-only)
- Production choice for complex Pyro/FLIP coupling

### Composite v field
```c
vector direction = @N * (rand(@ptnum * @Frame) + 0.5);
vector outwards = normalize(@P - center);
@v = (direction + outwards) * random * dist_falloff * mult;
```
- Combine multiple v sources with random + falloff

### `@opinput<N>_<attr>` shorthand
- `@opinput1_P` = `point(1, 'P', @ptnum)` shorthand
- Built-in attr auto-typed; user attr defaults to float

### 3-way mix VOP
- `importpoint × 3 + mix VOP` = 3-way mesh blend
- vs 2-way mix (0157 particle morph)
- Use case: user blend between 3 mesh states

### `@N = @v * 2` debug viz
- Visualize velocity field by writing it to N (visible in viewport)

## Batch 38 additions

### UV ↔ 3D bidirectional bridge
- **3D → UV space**: `@P = @uv` or `@P = set(uv.x, 0, uv.y);`
- **UV → 3D**: `vector pos = uvsample(input, attr, uv_attr, uv_coord); @P = pos;`
- `uvsample(input, attr_name, uv_attr_name, uv_coord)` — sample mesh attribute at UV coord
- Inverse of `xyzdist + primuv` (which is 3D → UV → attribute)

### `frac()` for periodic animation
```c
float u = @uv.x;
u -= @Time * ch("speed") * fit01(rand(@primnum), .5, 1.5);
u = frac(u);
@Alpha = u;
```
- `frac()` returns fractional part [0, 1] — periodic loop
- vs chramp(time): one-shot vs perpetual loop

### `pointvertex + vertex` cross-class lookup
```c
int pt = pointvertex(0, @ptnum);
vector uv = vertex(0, "uv", pt);
```
- Get vertex attribute from a point (cross-class)
- Used when UV is on vertex (per-prim) but you need per-point access

### FBX/USD export naming
- `@fbx_translation` (auto-attribute on FBX import) — subtract before export to center mesh
- `s@name + s@path` for FBX export (already documented)
- Combined with multi-LOD switch = production game pipeline

### Production HDA recognition
- 100+ nodes + multi-output + multi-LOD + semantic naming + FBX/USD export ready
- 8+ corpus examples: 0021 / 0287 / 0494 / 0540 / 0203 / 0383 / 0466 / 0282

### `popwrangle for proximity release` (sticking pattern)
- Particle has sticking attribute (set on scatter)
- popwrangle in popnet checks distance to external object (input N)
- When close enough: clear sticking → particle releases
- Production usage: character interactions, swarm behavior

### Long semantic node naming (teaching style)
- `pospath_and_stuck_attribs_for_sticking_behaviour` (attribcreate)
- `release_by_proximity_to_secont_input` (popwrangle)
- Indicates teaching-oriented project (vs production usually short names)

## Batch 39 additions

### Color → Group automation
```c
s@color_string = sprintf("rgb_%f_%f_%f", v@Cd.x, v@Cd.y, v@Cd.z);
```
+ `groupsfromname` SOP = unique strings → multi-group
- Use case: prim with discrete colors → automatic per-color processing groups

### `ramps::2.0` VOP node
- Built-in multi-ramp library (linear / smooth / step / hermite / etc)
- vs `rampparm` = single chramp
- ~10 corpus projects

### (p, q)-torus knot parametric formula
```c
float t = (float)@ptnum / @numpt * 2 * PI;
float radial = R + r * cos(q * t);
@P = set(radial * cos(p * t), radial * sin(p * t), r * sin(q * t));
```
- Classic torus knot — choose (p, q) coprime for non-trivial knot
- 0354 implements this in VOP

### Shockwave wave equation
```c
vector center = chv("center");
vector dir = normalize(@P - center);
float dist = distance(@P, center);
float wave = abs(ch("t_offset") / dist - 1);
float falloff = pow(fit(1.0 / wave, 0, 1, 0, 1), ch("exp"));
@P += dir * falloff * turbnoise(@P);
```
- Radial displacement wave with time-dependent falloff
- Add turbnoise for natural irregularity
- 0379 / 0473 / 0497 / 0086 share this pattern

### `labs::superformula_shapes`
- Superformula procedural shape generator (Gielis 2003)
- Parameters: m / n1 / n2 / n3 / a / b control flower-like shapes
- Use for petals / starfish / snowflakes / abstract shapes

### User HDA prefix convention
- `agz::torusknot` (0354), `labs::xxx`, `sidefx::xxx`
- Production HDA naming convention with author/vendor prefix

## Batch 40 additions

### Mesh blending universal (6+ paradigm)
```c
// Mask-driven (0288)
@P = lerp(@P, point(1, 'P', @ptnum), @mask * ch('blend'));

// Distance-driven (0157)
@P = mix(@P, target_P, fit(distance(@P, target_P), src_min, src_max, 0, 1));

// Age-driven (0086)
@P = lerp(@P, target_P, chramp('ramp', @nage));

// Time-driven (0001)
@P = lerp(@P, target_P, chramp('time', @Time));
```
Pattern: `lerp/mix(P, target, factor)` where factor comes from distance/age/mask/time/curveu

### Mask smoothing chain
```
attribtransfer (source mask) → attribcopy → attribblur → smooth mask
```
Discrete mask (group / Cd / distance threshold) → continuous gradient

### Sim 内 dynamic constraint modification (3 paradigm)
- `vellumconstraintproperty` in DOP (0331) — runtime constraint adjustment
- `@restlength *= @falloff` in sopsolver (0518) — SOP-side modification in solver
- `pointdeform` sync (0140) — sim → SOP transfer

### Dual-LOD voronoifracture (production performance)
```
mesh
├─ voronoifrac_low → for sim
└─ voronoifrac_high → for render
attribtransfer between them
```
Use case: simulate cheap, render detailed. Same paradigm as multi-LOD switch (0021/0189)

### `labs::rbd_edge_strip`
- RBD pieces → edge stripe geometry
- Use for fracture seam visualization (corpus < 5)
- vs `edgegroup_to_curve` (cloth-side, 0042)

### `switch_FAST` quality toggle
- Production user-facing switch between fast/slow modes
- Same pattern as `switchif` HDA expression-driven switching

2. Find matching recipe(s) above
3. Copy → adapt to context → done

Don't reinvent. These 20 recipes cover ~80% of the VEX in a typical PCG project.

## Batch 42 additions

### Array random selection without replacement (production VEX idiom)

```c
// detail wrangle
int keep = chi('Keep');
int items[] = expandpointgroup(0, 'source_group');

for (int i = 0; i < keep; i++) {
    int idx = int(fit01(rand(@ptnum, i), 0, len(items) - 1));
    setpointgroup(0, 'kept', items[idx], 1, 'set');
    pop(items, idx);   // 不放回 — 关键
}
```

**用途**: 从 N 候选 (端点 / scatter / candidate prim) 不放回抽 K 个. `pop(array, idx)` 是 VEX 数组移除核心.

### SOP→DOP force injection (sopsolver attribtransfer 万能模板)

```
SOP side:
  build force/v field as point attribute → null
DOP side:
  rigidbodysolver / vellumsolver / popsolver
    → sopsolver1
        ├ dop_geometry (拉当前帧 DOP)
        ├ object_merge1 (拉 SOP "force" 节点)
        └ attribtransfer (force.v → DOP pieces.v)
        → OUT
```

无 VEX. 任意 SOP-computed field 可注入 DOP, 比 popforce/popwind 更灵活. 0497 案例.

### Compile blocks 4 In/Out 通道 (Houdini 18+ OpenCL)

```
sopsolver inside DOP:
  attached_relationship_geometry → Constraints_In (compile_begin) → ... → Constraints_Out (compile_end)
  dop_geometry → Geometry_In → ... → Geometry_Out
  feedbacks → Feedbacks_In
  impacts → Impacts_In
```

大型 RBD sim production 标志. 0540 11+ rbdbulletsolver 并列教学.

### popvop pcfilter velocity field (flocking)

```
popvop:
  geometryvopglobal (P)
  → pcopen (radius, max_count) → pcfilter → output v
```

邻居加权平均 → 平滑速度场. vs aaflownoise (procedural) — pcfilter 是 emergent 邻居行为.

### VDB silhouette inside detection

```
source → vdbfrompolygons → vdbreshapesdf → vdbsmooth → convertvdb
plane → boolean (intersect with vdb-converted) → triangulate2d → scatter
```

模型轮廓投影 / 复杂形态简化. 0166 sphere 群 → silhouette → 内部流动粒子.

### distancealonggeometry (geodesic)

```
geom → fuse → distancealonggeometry (起点 group)
```

沿 mesh 表面 geodesic distance vs xyzdist 直线. mesh falloff 必须用这个. 0540 RBD lesson 用.

### sopsolver 在 DOP 的 3 种正交用途

1. **Force injection** — attribtransfer SOP field → DOP pieces (0497)
2. **Constraint mod** — sort/delete/wrangle 改 attached_relationship_geometry (0540, 0533)
3. **Group propagation** — BFS nearpoints + setpointgroup on dop_geometry (0454)

## Batch 43 additions

### sopsolver 在 DOP 的第 4 种用途: Sim geometry mod (新增)

```
sopsolver1 inside DOP solver:
  dop_geometry (拉 sim 几何, e.g., filament)
  → attribvop (curlnoise on P → 加扰动)
  → OUT
```

直接改 sim geometry 节点位置, **不是 force / 不是 constraint, 是 P 自身**. 0013 filament 用这个让规则圆环 → 自然扭曲.

**4 种正交分类轴 (what is mutated)**:
- v (force injection)
- constraint (constraint mod)
- group membership (group propagation)
- P (geometry mod) ← 新增

### Filament solver setup (corpus < 5 极少见)

```
DOP:
  popobject + popsource (emit from sphere surface)
  → popsolver
      → sourcefilaments (从 source 抽 filament initial seed)
      → filamentsolver (Biot-Savart 涡丝)
      → popadvectbyfilaments (粒子被涡丝 advect)
```

无 VEX. 适合: 涡环 / 烟圈 / 龙卷 / 大尺度旋转流. 比 FLIP/pyro 轻量数百倍.

### Trail-retime-scatter (修复 fast-motion gap 万能模板)

无 VEX 全节点链:

```
fast-moving geom (animated)
  → trail (record N 帧 history → multi-frame geometry)
  → timeblend / retime (在 history 帧间插值)
  → scatter (在每个插值帧 scatter)
  → connectivity (按 sub-frame piece 分类)
  → 多 popnet emit
```

**核心**: SOP 端预处理把 N 帧间隔运动 → 连续 sub-frame 几何 → 每帧 scatter → 帧间无缝. vs DOP substep 增加 sim 频率 (慢, 难调).

### Rest + ray 锚定 (粒子记得原始表面位置)

```
fast geom → pointjitter → scatter → popnet (advect)
         → rest1 (锁定 rest pose 坐标)
         → ray (投回原 mesh 表面)
```

`rest` 节点给点配 `v@rest = @P` 在第一帧, sim 飘走时 rest 记得原始位置. 配 ray 投回表面.

### Curve attract velocity field 三件套 (popvop 万能模板)

```
popvop:
  geometryvopglobal (P)
  → minpos(P, curve_geom) → 曲线最近点位置
  → xyzdist(P, curve_geom) → 距离 + uv
  → primuv(curve_geom, attrib, prim, uv) → 沿曲线属性 (tangent / orient)
  → mix(P, minpos, bias) → 拉向曲线
  → output v (or P)
```

**三件套** = minpos (坐标) + xyzdist (uv) + primuv (沿曲线属性).

**复合 velocity field**:
```
curlnoise(P) * coef + primuv(curve, P, tangent)
= 流动 + 跟随曲线方向
```

### HSV adjust idiom (texture color → hue mod)

```
attribvop:
  rgbtohsv (Cd) → vec3 (h, s, v)
  vectofloat (extract h)
  multiply (h * input2)
  floattovec (h_mod, multiply, const) → new HSV
  hsvtorgb → output Cd
```

**关键**: 调 hue 比调 saturation/value 简单. 0013 用这个把 texture color 转 HSV 调 hue 输出.

## Batch 44 additions

### SDF gradient push-out (极简软体碰撞)

```c
// attribvop or wrangle
float sdf = volumesample(1, "surface", @P);
if (sdf < 0) {
    vector grad = volumegradient(1, "surface", @P);
    @P += -normalize(grad) * abs(sdf);  // 沿梯度反方向推出 |sdf| 距离
}
```

**用途**: kinematic source 跟 deformable mesh 接触, 不需要 Vellum/Bullet sim. 7 节点替代数百节点物理.

### 离散曲率 κ ≈ |Δt| / Δs (1D curve)

```c
// point wrangle on resampled curve
int prev = max(0, @ptnum - 1);
int next = min(@numpt - 1, @ptnum + 1);
vector p_prev = point(0, "P", prev);
vector p_next = point(0, "P", next);

vector tangent = normalize(p_next - p_prev);
float arc_len = length(p_next - p_prev);

// curvature via tangent angle change (跟 i±2 邻居比, 更平滑)
int next2 = min(@numpt - 1, @ptnum + 2);
vector p_next2 = point(0, "P", next2);
vector tangent2 = normalize(p_next2 - p_next);

float angle = acos(clamp(dot(tangent, tangent2), -1.0, 1.0));
f@curvature = angle / arc_len;  // discrete κ
```

**用途**: sweep tube 横截面 = pscale * curvature → 弯曲处粗, 直处细. 0608 用 VOP 版 (qdistance 数值更稳定).

### Geometry solver 属性扩散 (cellular automaton on mesh)

```c
// 在 geometry solver 内 wrangle, group = '' (per point)
int nbs[] = neighbours(0, @ptnum);
foreach (int n; nbs) {
    float self = f@heat;
    if (self > 0) {
        float prev = point(0, "heat", n);
        setpointattrib(0, "heat", n, max(prev, self * 0.95));  // 0.95 = decay
    }
}
```

**用途**: discrete heat equation/BFS spread on mesh. 配 attribpaint 涂初始 source. 跟真物理 ∇² Laplacian 不同, 是 forward propagate + decay 简化.

### VOP 内 build geometry (procedural generator)

```c
// VOP equivalent for procedural geometry from scratch (in attribvop)
// 概念等价 wrangle:
for (int i = 0; i < N1; i++) {
    for (int j = 0; j < N2; j++) {
        // ...
        for (int k = 0; k < N6; k++) {
            vector p = ...;  // matrix transform chain
            int pt = addpoint(0, p);
            int prim = addprim(0, "polyline");
            addvertex(0, prim, pt);
        }
    }
}
```

VOP 节点版: `addpoint + addprim + addvertex` 在 nested for_begin/end 内. 0618 6 嵌套 for-loop spiral generator.

### attribpaint (production interactive 绘制)

```
mesh → attribpaint (用户 viewport 涂抹 attrib float/color)
   → solver (扩散 / 衰减)
```

无 VEX. user-driven source, 跟 drawcurve 同源. production 标准 input 节点.

### Discrete heat equation (PDE on mesh)

```c
// 真物理 Laplacian 版, 在 geometry solver 内
int nbs[] = neighbours(0, @ptnum);
float laplacian = 0;
foreach (int n; nbs) {
    laplacian += point(0, "heat", n) - f@heat;
}
laplacian /= len(nbs);  // average

float alpha = chf("alpha");  // diffusion coefficient
f@heat += alpha * laplacian;  // forward Euler
```

**vs forward propagate (上面)**: 这个是真 Laplacian, 数学正确, 但需要稳定性 (alpha < 0.5 for stability).

## Batch 45 additions

### Geodesic distance + ceiling → ring discretization

```c
// VEX wrangle on resampled mesh (or VOP surfacedist)
// 简化: 假设 'src' group 有起点, 用 attrib "geodist" 已被 distancealonggeometry 算好
float dist = f@geodist;
float ring_width = chf("ring_width");

// 4 mode 切换
int mode = chi("mode");
if (mode == 0) {
    f@mask = dist;                              // continuous
} else if (mode == 1) {
    f@mask = ceil(dist / ring_width);           // ring index
} else if (mode == 2) {
    float d2 = f@geodist2;
    f@mask = ceil((dist - d2) / ring_width);    // 等差环
} else {
    float radius = chf("radius");
    if (dist > radius) f@mask = -1;             // bounded
    else f@mask = ceil(dist / ring_width);
}
```

**配合**: VOP 的 `surfacedist` 节点等价 `distancealonggeometry` (后者是 SOP 节点). 0617 用 4 mode switch.

### Worleynoise stack with switch (cellular pattern)

```
attribvop (or wrangle):
  vector noise1 = worleynoise(P, ...);     // 一次 cell
  vector noise2 = worleynoise(P, ...);     // 同 P 第二个 worley
  vector noise3 = worleynoise(noise2, ...); // 二次 worley (基于 worley1 输出)
  switch (mode, [noise1, noise3, ...]) → output
```

**worley vs turb**: worley = 自然 cell 边界 (sharp), turb = 平滑 gradient. 配 group threshold + polyextrude → 程序化岩石/科幻面板.

### Multi-layer noise + extrude recursive (multi-LOD detail)

```
geo
  → noise → group threshold → polyextrude (一级凸出)
  → subdivide (给二级足够分辨率)
  → noise (再来一次, 频率不同) → group → polyextrude (二级凸出)
```

无 VEX 全节点. 大形 (低频 noise) + 裂痕 (高频 noise) = 多 LOD.

### Contact-driven attribute state machine

```c
// solver SOP wrangle (或等价 VOP intersect chain)
vector dir = vector(getbbox_size(1));
vector hitpos;
vector hituv;
int hitprim = intersect(1, @P, dir, hitpos, hituv);

float hit_indicator = (hitprim >= 0) ? 1.0 : 0.0;

// state machine: 增加 → 限制 → 衰减
@wet = clamp(@wet + hit_indicator, 0, 1);
@wet *= chf("decay");  // 0.95 等 < 1
```

**state machine 三步**: 增加 (event) → clamp (上限) → multiply (衰减). production 万能模板, 适合 wet/dry, 健康/血量, 充能, 火焰温度等.

### popreplicate fission system (粒子分裂)

```
popnet:
  poplocation (起点 emit)
  → popgroup (active group, e.g., 'age<N')
  → popreplicate (active 分裂成 N children)
  → popwind (扩散方向)
```

**popreplicate** 把每个 active particle 复制 N 个新 particle (parent + N children, 继承 attr 但独立 v). 病毒/植物/生物分裂标准节点.

### Trail-polywire 粒子轨迹 → 分支几何

```
popnet output
  → trail (record N 帧 history, 保留 pid)
  → timeshift → resample
  → wire / polywire (1D 点轨迹 → 圆柱 mesh)
  → vdb → smooth → convertvdb → mesh-ify
  → attribtransfer color + attribblur (color 扩散)
```

无 VEX 全节点. trail 保留 pid → 同粒子轨迹连成 line → polywire 出 tube.

### 4-layer solver progressive teaching (production paradigm)

把同一 effect 分 4 层 solver 实现, 每层加一层 logic:

```
solver1: base (attribcopy + attribtransfer)         — 状态继承
solver2: + intersect (event detection)              — 加事件检测
solver3: + add + clamp (state mutation)             — 加状态修改
solver4: + multiply decay (lifecycle complete)      — 加完整生命周期
```

production teaching 标志, 0622/0540/0054/0049 都用. 跟 incremental refinement layout (落于ivi 标志) 同源.

## Batch 46 additions

### Winding number → metaball-like blending (vs SDF)

无 VEX (节点链):

```
multi mesh source (open mesh OK!)
  ↓ pointsfromvolume (在 bbox 内填点)
  ↓ windingnumber (sample)
  ↓ volumerasterizeattributes (point attr → volume)
  ↓ vdbsmooth (平滑)
  ↓ convertvdb (volume → mesh)
```

**vs SDF**:
- SDF 链: vdbfrompolygons → vdbreshapesdf → vdbsmoothsdf → convertvdb (要求 closed manifold)
- WN 链: 不要求 manifold/closed, 多 mesh 重叠 winding 累加自动融合

适合 metaball-like CSG / 多 mesh blend / open mesh 处理.

### connectadjacentpieces lattice (SOP 节点)

```
scatter on isooffset surface
  → connectadjacentpieces (max_dist + max_neighbors)
  → polywire (1D → 圆柱)
  → vdb-smooth-convert + remesh
```

**vs VEX** (`pcfind + addprim('polyline') + addvertex`): 节点更便捷, VEX 更可控. 适合快速 lattice / wireframe.

### Mesh blending 万能模板 — 6 种 weight 来源

```c
vector P_target = point(input2_or_1, "P", @ptnum);
float weight;

// 选 weight 来源:
weight = fit(distance(@P, ref), inner, outer, 1, 0);          // distance
weight = fit(turbnoise(@P*freq), srcmin, srcmax, 0, 1);       // noise (0093 新)
weight = mask * blend;                                          // mask (attribblur/paint)
weight = chramp("s_ramp", @nage);                              // age
weight = chramp("s", @curveu);                                 // ramp formula
weight = clamp(myPt - 1 + 2*shift, 0, 1);                     // wavefront

@P = lerp(@P, P_target, weight);
```

**8 paradigm 累计** (0157, 0398, 0086, 0288, 0001, 0494, 0509, 0093). production 万能模板 — 选 weight 来源 = 选效果.

### N as force / direction 基础 idiom

```c
// wrangle: just bind N (let downstream use)
@N;
```

**production 应用** (4+ paradigm):
- vellum grain magnetic (0029)
- self-offset velocity (0633)
- grass radial kinefx orient (0297)
- popvop initial v (0166)

mesh 表面 N 是天然 vector field — 免费 + production-default.

### vellumconstraints_grain vs popgrains 二选一

```
vellumconstraints_grain: vellum 系统颗粒
  → 配 vellumcloth 时 cloth + grain 双向耦合
  → 用 vellumsolver 解算
  → 适合: 颗粒 + 布料联动 (沙子+布袋), 弹性颗粒

popgrains: pop 系统颗粒
  → 单独颗粒 PBD
  → 用 popsolver 解算
  → 适合: 大规模颗粒 (雪/沙/米), 不需要跟 vellum 耦合
```

**production 选**: 跟 cloth/hair 联动 → vellumconstraints_grain; 单独大规模 → popgrains.

## Batch 47 additions

### Sim ↔ non-sim lerp (解决 sim popping 万能模板)

```c
// wrangle: input 0 = non-sim, input 1 = sim 结果
float offset = fit01(@curveu, 1, 100);  // per-point staggered start
float animate = chramp("animate", fit(f@Frame, $FSTART + offset, 200, 0, 1));
@P = lerp(@P, @opinput1_P, animate);
```

**关键**:
- per-point offset → 沿 mesh 一段一段激活, 解决 sim 启动 popping
- `@opinput1_P` = input 1 第 ptnum 的 P (简化语法)
- 通用模板 — 任何 sim (vellum/FLIP/Bullet/pyro) 都可加这个 blend 层

### Per-point staggered start time (universal idiom)

```c
// 让每点 start frame 不同 (沿 mesh / 沿 curve / 按 id)
float offset = fit01(driver, 1, 100);  // driver 可以是 @curveu / @ptnum / @id / @P.y
float animate = chramp("animate", fit(f@Frame, $FSTART + offset, EndFrame, 0, 1));
```

**driver 选择**:
- `@curveu` — 沿曲线方向
- `@ptnum` — 按拓扑顺序
- `@id` — 按 emit order (粒子)
- `@P.y` — 按高度 (重力效果)
- `rand(@ptnum)` — 完全随机

跟 0488/0526/0148 staggered timing 同 paradigm.

### `@opinputN_X` 简化语法 (vs point() / importpoint)

```c
// 三种等价:
@P_input1 = @opinput1_P;              // 最短 — 拉 input 1 在当前 ptnum 的 P
@P_input1 = point(1, "P", @ptnum);    // point() 函数
v@P_input1 = vector(point(1, "P", @ptnum));  // 显式 cast
```

**用途**: blend / mix / 引用其他 input 的 attribute, 不用 point() 函数.

### `f@speed = length(v@v)` (attr promotion)

```c
// 1 行 wrangle, scalar 速度从 vector 提取
f@speed = length(v@v);
```

**用途**: color by speed, condition on speed, 或后续 ramp 驱动.

### popcurveforce setup (curve-driven force)

```
DOP:
  popobject + popsource (emit)
  → popsolver
      → popcurveforce (input = curve geom)
        → 沿 curve 方向 + 朝 curve attract
```

无 VEX. drawcurve interactive 给 curve, popcurveforce 把 curve 转 force.

### vdbactivate + volumevop (体积场标准前置)

```
vdb (empty)
  → vdbactivate (input2 = mesh)  ← 关键: 限制 active voxels 到 mesh 附近
  → volumevop (e.g., aaflownoise)
  → popadvectbyvolumes (粒子被 advect)
```

无 VEX. 性能必备 — 任何 vdb-based volume sim 都该先 vdbactivate.

### Boolean (mesh ∩ plane) = 几何等高线

```
displaced_mesh (terrain)
plane (circle + reverse + transform.y for animation)
  → boolean (intersection)
  → contour line geometry
```

无 VEX. 跟 SDF iso / color group / surfacedist ring 是 4 种 contour paradigm.

### Particle force 选择 cheat sheet

| 力源 | 节点 | 适合 |
|------|------|------|
| 全局/重力 | popforce | gravity, wind direction |
| 全局风 | popwind | 简单 wind |
| 任意场 | popadvectbyvolumes | noise/sim volume velocity |
| 沿曲线 | popcurveforce | drawcurve user path |
| 旋转 | popaxisforce | tornado, vortex |
| 任意 VOP | popvop | 自定义 force computation (minpos+xyzdist+primuv 三件套) |

**production**: 6 种力 + popvop 任意自定义, 覆盖几乎所有 force 需求.

## Batch 48 additions

### Solver + ray = 永久变形 (footprint / impression)

无 VEX 全节点链:

```
solver SOP:
  Prev_Frame (上一帧 P)
  → ray (Prev_Frame → Input_2 collider)
  → ray 直接改 P 到 hit point (永久, 不弹回)
  → OUT
```

**关键**: `ray` 节点不只 detect — 它直接把 P 改到 hit point. Prev_Frame 让 P 在帧间累积. 0 wrangle 实现踩雪/沙地脚印.

### Gas* microsolvers cheat sheet (DOP 内 fluid 工具)

| Microsolver | 作用 |
|------------|------|
| gastemperatureupdate | 温度场更新 (热传导/衰减) |
| gasfieldvop | VOP-based 任意 field 修改 (万能修改器) |
| gasdiffuse | 扩散 (温度/烟/密度) |
| gasdisturb | 加扰动 |
| gasopencl | OpenCL 加速 microsolver |
| gasprojectnondivergent | 投影使速度场无散 |
| gasvelocityupdate | 速度场更新 |
| gasresizeflip | FLIP 体积自适应 resize |

**用**: 塞 flipsolver / pyrosolver 内部, 自定义 sim 行为. 跟 force (gravity/popforce) 不同 — gas* 改 field 而非 force.

### Temperature → viscosity 启动 (1 行 wrangle)

```c
// SOP wrangle on source mesh
@temperature = 2;
```

DOP 链:
```
flipsolver
  → gastemperatureupdate (每帧温度衰减)
  → flipsolver 用 temperature 影响 viscosity
```

适合: lava 凝固 / wax cooling / 冰冻 / 焦油 / 巧克力固化.

### Heightfield collider 标准链

```
heightfield (空 hf)
  → heightfield_project (input2 = hf, input3 = mesh) → 投影 mesh
  → staticobject (DOP 内 collider)
```

无 VEX. 2.5D 地形专用, vs vdb 3D collider. 适合地表/山丘/terrain.

### 切割 selection 标准 idiom

```c
// dist-based selection
float dist = xyzdist(1, @P);
if (dist > ch("treshold")) i@group_selection = 1;

// random selection
float val = rand(@ptnum + chi("random_seed"));
if (val > ch("tresh")) i@group_selection = 1;

// connectivity-based (after voronoi fracture)
int primcount = len(pointprims(0, @ptnum));
@Cd = primcount > 1;  // edge / corner detection
```

后续 `split` 节点按 group_selection 切片. production 标准 cutting selection.

### RBD pipeline 三件套 cleanup

无 VEX:
- **rbdinteriordetail** — 内部面加 detail noise
- **rbdconnectedfaces** — 提取共面 (作 constraint)
- **rbddisconnectedfaces** — 清除独立面 (sim-internal 但视觉无意义)

production 切割后 cleanup 标准链.

### High/Low Quality multi-LOD output

无 VEX:
```
rbdmaterialfracture → 3 流输出:
  ├ High_Quality_Geo (render)
  ├ Low_Quality_Geo (sim)
  └ Constraints (constraint geom)
```

sim 用 low (省时间), render 用 high. production 标准 sim/render 分离.

## Batch 49 additions

### Matrix transformation 三件套 (corpus master)

```c
// A. primintrinsic 'transform' read/write
matrix3 xform = primintrinsic(0, 'transform', @primnum);
setprimintrinsic(0, 'transform', @primnum, xform);

// B. lookat + slerp + qconvert (朝向 target 平滑旋转)
matrix3 look = lookat(@P, target_pos);
xform = qconvert(slerp(quaternion(xform), quaternion(look), mask));
//      ^^^^^^^^                                              ^^^^
//      quaternion → matrix3                                   blend weight (0..1)

// C. prerotate (LHS local rotation)
prerotate(xform, mask * PI, normalize(cross(target_dir, {0,1,0})));
//        矩阵   弧度        旋转轴 (翻滚轴 = cross(direction, up))

setprimintrinsic(0, 'transform', @primnum, xform);
```

**关键**:
- 旋转 blend 必须用 quaternion + slerp (不能 lerp 矩阵, 会变形)
- prerotate (LHS local) vs rotate (RHS world)
- 翻滚轴 idiom: `cross(direction, up)` = perpendicular axis

### Distance falloff 公式 cheat sheet

```c
// N=2 物理重力/库仑
float mask = 1 / pow(length(target_dir), 2) * scale;

// N=7 急衰减 (van der Waals-like, 局部 attractor)
float mask = 1 / pow(length(target_dir), 7) * 765;

// User-tunable 替代
float mask = chramp("falloff", clamp(length(target_dir) * 0.125, 0, 1));
```

### Hair production 6 件套 setup

无 VEX 全节点链:

```
skin (mesh)
  → groupexpression / paint mask (source group)
  → hairgen1 (生成 guide hairs)
  → guideadvect (input2 = vdb, input3 = velocity field) → 毛发 advect
  → guideprocess (cleanup)
  → guideskinattriblookup (skin attr → hair attr)
  → hairgen2 (final hair)
  → hairclump (聚团)
```

`volumevelocityfromsurface` 生成 surface-aligned 速度场:
```
mesh → vdbfrompolygons + volumevelocityfromsurface → vdb velocity field
```

### Hair cleanup wrangles (production idiom)

```c
// 反转 hair 方向 (从 root 朝外 vs 朝内)
v@N *= -1;

// 删短 hair (parametric < threshold)
if (f@p < 0.1)
    removeprim(0, @primnum, 1);  // 第三参数 1 = 删 unused points
```

### Mesh morph 2 paradigm

**Paradigm 1: point-order mix (拓扑对齐)**
```
mesh A → scatter → sort
mesh B → scatter → sort (同样 sort 规则)
  → attribvop:
    importpoint(input1, P, ptnum) → P_B
    mix(P_A, P_B, bias) → output P
```

**Paradigm 2: vdbmorphsdf (SDF 逐帧)**
```
mesh A → vdbfrompolygons → SDF_A
mesh B → vdbfrompolygons → SDF_B
  → solver1:
    Prev_Frame (上帧 SDF, 初始 = SDF_A)
    vdbmorphsdf (Prev_Frame → SDF_B, step) → 逐帧从 A 形变到 B
    → OUT
  → convertvdb → mesh
```

**production 选**: 拓扑可对齐 → point-order; 拓扑不可对齐 → vdb.

### Gooey HDA paradigm 3 环节

无 VEX 全节点:
1. **切开**: clip → top/bottom + polyfill 填补切口
2. **拉丝几何**: scatter spheres on 切口 → pointdeform 形变 → vdbfrompolygons → vdbcombine (跟 main mesh 合并) → vdbsmooth (融合)
3. **拉伸**: softpeak / peak / bend / mirror

**关键节点**: `vdbcombine` (多 vdb union/intersection/blend). 跟 vdbsmooth + vdbreshapesdf 配合 = 平滑融合.

### switch_to_selection_guide (production HDA debug)

```
HDA 内部:
  switch_to_selection_guide → output0
    - 0: final mesh
    - 1+: debug 显示 (selection guide / source group / intermediate state)
```

无 VEX. production HDA debug 标志, 让 user 在 HDA parameter 上切到 debug mode 查看中间状态.

## Batch 50 additions

### Vellum container collider 标准链

```
tube → polyfill (封口) → matchsize → smooth → transform
  → reverse (反转法向, 内壁朝内)
  → REF_collsion null
```

无 VEX. `reverse` 关键 — vellum 才能正确跟内壁 collide.

### Ocean evaluate + RBD 取巧浮力

```
oceanspectrum (parameters: wind/wave/chop)
  → oceanevaluate (input1=grid, input2=spectrum)
  → 输出 grid displacement + velocity

RBD pieces (rbdmaterialfracture → assemble)
  → pointvelocity (input2=oceanevaluate output) → sample velocity
  → rbdbulletsolver (input2=pointvelocity)
```

无 VEX. 数百倍快于真 FLIP buoyancy, 远景 OK.

### Houdini Crowd System setup

```
agent → agentclip → crowdsource (input2=mask attribpaint)
  ↓
dopnet:
  crowdobject + crowdsolver
    → crowdstate (walking/idle 行为状态)
    → popsource (emit)
    → popsteerobstacle (避障 vs popforce)
    → gravity
```

无 VEX. corpus < 5 罕见 production crowd setup.

### Edit node (production interactive 第 3 件套)

```
mesh → edit (用户 viewport 拖动单个点 P)
  → 后续节点 (sim/process)
```

无 VEX. 直接改 P (vs attribpaint 改 attr / drawcurve 创 curve). 适合手动 fine-tune.

### Controlled N via getattrib + subtract (碎块朝 target)

```c
// VOP equivalent (controlled_N)
vector ref_pos = getattrib(input1, "P", 0);  // 第 0 点 = centroid/target
vector controlled_dir = ref_pos - @P;        // 朝 ref 方向
v@N = controlled_dir;
// 或 normalize:
v@N = normalize(controlled_dir);
```

production "single reference target" 标准 idiom.

### v_predict pcfilter velocity (smooth flocking-like)

```
attribvop (v_predict):
  pcopen (P, radius, max) → handle
  → pcfilter (handle, "v") → avg neighbor velocity
  → divconst (avg / N)
  → add (P + avg) → predicted position
  → ramp (control timing)
  → output v
```

让 emit 粒子 velocity 平滑跟随邻居, 跟 0166 popvop pcfilter 同源.

### FLIP 后处理标准链

```
flipsolver output
  → fluidcompress (压缩 cache, production 必备)
  → filecache (存盘)
  → particlefluidsurface (mesh-ify, FLIP particles → polygon surface)
```

无 VEX. fluidcompress 减小 cache 文件大小.

### vellumconstraintproperty (DOP runtime constraint mod)

DOP forces subnet 内:
```
vellumsolver:
  forces subnet:
    vellumconstraintproperty1 (改 pressure / stretch / etc.)
    vellumconstraintproperty2 (改第 2 类 constraint)
    → FORCE output
```

无 VEX. runtime 改 constraint property, 比 SOP-side parm 更细致.

## Batch 51 additions

### Auto-close detection (drawcurve trick)

```c
// detail wrangle (after drawcurve)
vector pt1 = point(0, 'P', 0);
vector pt2 = point(0, 'P', npoints(0)-1);
float dist = length(pt1 - pt2);
if (dist <= chf('auto_close_dist')) {
    setdetailattrib(0, 'close', 1, 'set');
}
```

### drawcurve cutting tool (4th paradigm)

```
drawcurve → resample → polyextrude → boolean (mesh ∩ tool) → assemble → RBD sim
```

### labs::straight_skeleton_3d setup

```
mesh → labs::straight_skeleton_3d → cleanup chain (sweep + fuse + remesh + ray + smooth)
```

### wiresolver setup

```
1D curve → attribwrangle (`i@pintoanimation = 1`) → resample
  → DOP: wireobject + wiresolver + (gravity)
```

### attribinterpolate + scatter on animated mesh

```
animated_mesh → unpack → timeshift → scatter
  → attribinterpolate (input2 = unpack)
```

### `xyzdist + primuv` find target idiom

```c
float dist;
int prim;
vector uv;
dist = xyzdist(1, @P, prim, uv);
vector target_pos = primuv(1, "P", prim, uv);
vector target_tangent = primuv(1, "tangent", prim, uv);
```

### `frac()` loop wrap

```c
float loop_pos = frac(time + offset);
```

### Voronoi seed 动画 (moving seed → moving cell)

```
seed_points → attribvop (xyzdist + primuv + frac → shifted P)
  → voronoifracture (input2 = shifted seeds)
```

## Batch 52 additions

### `@id` vs `@ptnum` (跨帧稳定 random)

```c
// 跨帧稳定 — particle 唯一 id
@pscale = rand(@id);
@Cd = rand(@id + 100);
@v = noise(@id * 0.1) * scale;

// 跨帧不稳定 — ptnum 跨帧变 (粒子加/删)
@pscale = rand(@ptnum);  // 危险!
```

popsource 自动给每 particle 配独立 @id. 持续发射 sim 必用 @id.

### Texture-driven height (image → mesh)

```c
// 用 color 通道作 height
v@P.y = v@Cd.r - 0.5;  // R 通道 → height (-0.5 .. 0.5)

// 或沿 N 推
v@P += v@N * v@Cd.r * height_scale;
```

链: attribfrommap → attribblur (减锯齿) → wrangle → polyextrude.

### `P2 = P` / `P = P2` backup-restore idiom

```c
// w1: backup
v@P2 = @P;

// ...操作 P...

// w2: restore
@P = @P2;
```

vs rest 节点 — 同概念但 wrangle 版.

### planepointdistance + smooth + lerp (plane displacement)

```c
// PARAMETERS
float in = chf('in');
float out = chf('out');
float off = chf('offset');
float soft = chf('soften');

// PLANE
vector p;
vector pos_pt = point(1, 'P', 0);
vector nml = prim_normal(1, 0, vector(0.0));

float d = planepointdistance(pos_pt, nml, v@P, p);
vector plane = p + normalize(nml) * off;

// SIGNED DISTANCE (上/下 plane)
vector dir = normalize(pos_pt - v@P);
float angle = dot(dir, nml);
float sdist = sign(angle) * d;

// SMOOTH MASK + LERP
float bias = smooth(-out, in, sdist);
float mask = smooth(-soft, soft, sdist);
vector pos = lerp(v@P, plane, bias);

// OUTPUT
f@mask = mask;
v@P = pos;
```

**用途**: plane attract / plane snap / plane mask. 跟 mesh blending 万能模板第 10 paradigm.

### `smooth(min, max, value)` Hermite smoothstep

```c
// smooth pulse (centered at 0)
float pulse = smooth(-X, X, value);

// smooth ramp (0..1 between start..end)
float ramp = smooth(start, end, value);
```

vs fit + clamp: smooth 端点 derivative=0, 更平滑.

### `sign + dot` 二分类 idiom

```c
vector dir = normalize(target - @P);
float side = sign(dot(dir, nml));  // +1 / -1 / 0
float sdist = side * abs_dist;     // signed distance
```

### gasparticleseparate setup (FLIP 不混合)

```
DOP:
  flipsolver:
    forces subnet:
      gasparticleseparate (粒子互斥 force)
```

无 VEX. corpus < 5 罕见, multi-source FLIP 不混合关键节点.

### 2-source FLIP + Cd 保留

```
left_box → flipsource1 → color RED (Cd attribute)
right_box → flipsource2 → color BLUE
  → merge → flipsolver (Cd 自动 advect)
  → gasparticleseparate (空间不混)
```

无 VEX. Cd 自动跟 FLIP 一起 advect.

### `staticsolver + Collision` FLIP collider

```
DOP:
  Collision (staticobject — collider mesh)
  → staticsolver (跟 collision 互通, 不动)
  → flipsolver merge1
```

无 VEX. 字母 / 容器 / 地形作 FLIP collider.

### 持续发射 RBD 标准链

```
popnet (emit) → delete (清理过期) → attribwrangle (`@pscale = rand(@id)`)
  → copytopoints (input1 = prefab) → assemble → dopnet bulletrbdsolver
```

production fountain / continuous emit RBD 标准.

### attribfrommap + attribblur + rest (image → mesh 标准链)

```
geometry (sample 点位置)
  → attribfrommap (UV → Cd 从 texture)
  → attribblur (平滑 Cd, 减锯齿)
  → rest (锁定 rest pos)
  → wrangle 用 Cd 改 P
  → 后续 split / extrude
```

无 VEX 主流程, attribblur 是减锯齿关键.

## Batch 53 additions

### copytocurves (沿曲线 prefab 自动 align)

```
prefab geometry → copytocurves (curve as input2, 自动 align tangent)
              → assemble → packed pieces
              → pointvelocity (推第一个 piece)
              → rbdbulletsolver
```

无 VEX. vs copytopoints + orientalongcurve 二选一. 0403 多米诺骨牌.

### pointvelocity initial v (一次性 trigger sim)

```
packed pieces → pointvelocity (给指定 group/index 加 initial v) → RBD sim
```

无 VEX. vs sopsolver attribtransfer (持续 force injection) / popforce (持续) — pointvelocity 是一次性最简方法.

### split + add 平行偏移 (双轨道)

```
原 curve → copytopoints (group1 line)
       → split → add1 (offset +) + add2 (offset -)
       → merge → polywire
```

无 VEX. point-level offset 跟 normal/tangent 局部对齐, vs transform 整体 rigid translation.

### Sim UV/color preservation 2 paradigm

```
方法 A (pre-sim): mesh + UV → flipsource (粒子化, attr 跟着) → flipsolver → output
方法 B (post-sim): mesh-ify sim → attribtransfer (UV from rest geo via xyzdist)
```

无 VEX. 简单 → A; 准确 → B (反 sim mesh 拉对应 UV). 0412 教学.

### Agent + crowd setup

```
agent → agentclip → agentcliptransitiongraph → testsim_crowdtransition
     → retime → agentunpack → effect (boolean/vellum/FLIP)
```

无 VEX. vs KineFX (rig 修改 vs 动画播放).

### popattract in vellumsolver

```
vellumsolver:
  forces:
    popgroup (target) → popattract (input2 = popgroup, 朝 target attract)
```

无 VEX. vs popcurveforce / popvop 三件套.

### fit01 attr remap (1 行 wrangle)

```c
@viscosity = fit01(@viscosity, 10, 400);
```

把 0..1 viscosity 映射到 10..400 (FLIP solver 实际范围). 1 行 production parm 缩放 idiom.

### Texture → mesh preprocessing chain

```
mesh → attribfrommap (texture → @Cd or @uv)
    → splitpoints (vertex UV 不混叠)
    → attribpromote (vertex ↔ point)
    → uvquickshade (UV → vis color, 检查)
```

production 标准前置, 喂 sim 的 mesh 准备.

## Batch 54 additions

### `v@N = v@v` velocity → normal (1 行 production idiom)

```c
v@N = v@v;
```

**用途**: pointvelocity 给 v, 后续 copytopoints/polywire/sweep 期望 N 来 align — 1 行转换.

**变体**:
- `v@N = normalize(P - center)` — 径向 (0297/0633)
- `v@N = curlnoise(P)` — noise 方向
- `@N;` — passive bind (让 normal 节点的 N 流过)

### Solver + append to array attribute (animation recording)

```c
// solver attribvop2 等价 wrangle
// Prev_Frame array attribute (上一帧)
// Input_1 current value (当前帧)
f[]@history;
push(f[]@history, point(1, "P", @ptnum).y);  // append current frame value to array
```

**用途**: 记录动画到 array, 后续 `getelement(array, fit_index)` 按 index playback. vs trail (multi-frame geometry) 更轻量.

### `getelement(array, index)` playback

```c
// playback recorded animation per-piece offset
int total_frames = len(f[]@history);
int playback_index = int(fit(@curveu, 0, 1, 0, total_frames - 1));
@P.y = f[]@history[playback_index];
```

每 piece 用不同 fit (offset) → staggered playback.

### Weave (编织) `@primnum%2` alternating idiom

```c
float scale = chf('Scale');
float amp_z = chf('Amplitude_Z') * scale;
int freq_z = chi('Frequency_Z');

if (@primnum % 2 == 0) {
    v@P.z += sin(@curveu * freq_z) * amp_z;  // 偶数 prim 上
} else {
    v@P.z -= sin(@curveu * freq_z) * amp_z;  // 奇数 prim 下
}
```

**generalization**:
- `@primnum%N` for N-fold alternating
- `@id%2` for instance alternating
- `(@ptnum / N) % 2` for chunk alternating

### Traveling pscale ramp `chramp(@curveu - @Time*0.1)`

```c
f@pscale = chramp('Scale', @curveu - @Time * 0.1) * 4;
```

`@curveu - @Time*0.1` = 沿曲线随时间偏移 ramp. 配 sweep → 编织线条粗细随时间动画 (animated traveling pscale).

### 2-target staggered lerp (mesh blending 第 10 paradigm)

```c
float rblend = chramp('Blend', @blend);

v@P = lerp(@P, v@opinput1_P, fit(rblend, 0, 0.5, 0, 1));
v@P = lerp(@P, v@opinput2_P, fit(rblend, 0.5, 1, 0, 1));
```

阶段 1 (0..0.5) 朝 target1, 阶段 2 (0.5..1) 朝 target2. mesh blending 万能模板第 10 paradigm.

### Curve bend ramp(curveu) (草/hair/strand)

```c
float bend_factor = chramp('Bend', @curveu);  // root=0, tip=1 → tip 弯多
@P += @N * bend_factor * chf('amount');

@width = chramp('Size', 1 - @curveu) * chf('Radius');  // root 粗 tip 细 (草叶)
```

production 草/hair/strand 弯曲 + 粗细变化标准.

### pyrosourcespread setup (directional propagation)

```
mesh
  → attribpaint (绘制 source)
  → comb (绘制 direction 方向场)
  → pyrosourcespread (沿 direction 扩散 source)
  → polyextrude / vdb chain (后续生长)
```

无 VEX. corpus < 5 罕见高级节点, 适合冰刺/苔藓/锈迹/火焰蔓延.

## Batch 55 additions

### Ray-tree growth 4 件套 (闪电/根系/血管 production 标准)

```c
// hit_pts wrangle (in solver SOP)
vector hit;
float u, v;
int life = chi("life");
int lifeVar = chi("lifeVar");
lifeVar = int(rint(fit01(rand(@P*342), -lifeVar, lifeVar)));

if (intersect(1, @P, @N*chf("range"), hit, u, v) != -1) {
    int newPt = addpoint(0, hit);
    setpointattrib(0, "id", newPt, @id, "set");
    setpointattrib(0, "lifetime", newPt, life+lifeVar, "set");
    setpointattrib(0, "N", newPt, -@N, "set");
    setpointattrib(0, "creationFrame", newPt, @Frame, "set");
}
removepoint(0, @ptnum);
```

```c
// delete_existing wrangle (dedup)
if (findattribval(1, "point", "id", @id, 0) != -1) removepoint(0, @ptnum);
```

```c
// lifetime wrangle
if (@lifetime == 0) removepoint(0, @ptnum);
@lifetime--;
```

```c
// max_arcs wrangle
if (@primnum > ch("maxBolts1") - 1) removeprim(0, @primnum, 1);
```

**4 件套**: intersect+addpoint / id+findattribval dedup / lifetime accumulator / max_arcs prim limit.

### Per-curve random truncation (拖尾长度多样化)

```c
int Seed = chi('Seed');
float Min = chf('Min');
float Max = chf('Max');

if (@curveu > fit01(rand(@id + Seed), Min, Max)) {
    removepoint(0, @ptnum);
}
```

每条 curve 用 id 随机长度阈值, 超过的点全删. 0174 拖尾案例.

### `@curveu1` vs `@curveu`

trail/sweep chain 后的层级: 原 curve = `@curveu`, trail 后 sub-curve = `@curveu1`. production 链中要看清楚当前层级.

### labs::flowmap pipeline (game-shader 6 件套)

```
mesh + UV → labs::flowmap → labs::flowmap_guide (curve dir)
         → labs::flowmap_obstacle (障碍物) → labs::flowmap_to_color (RG)
         → labs::flowmap_visualize → labs::maps_baker (export)
```

无 VEX. game-shader 流动效果 production 完整 pipeline.

### labs::sine_wave (sin displacement 节点版)

```
mesh → labs::sine_wave (axis + freq + amp parm)
```

无 VEX. 等价 `@P.y = sin(@P.x * freq) * amp` 但有 UI parm.

### vellumpressure setup (内部气压膨胀)

```
mesh (closed) → vellumcloth → vellumpressure (constraints mode)
             → vellumsolver
                 forces: vellumconstraintproperty (DOP runtime 调)
```

无 VEX. 气球/软体充气. 0170/0518 案例.

### subnet 复用 pipeline (HDA 雏形)

```
subnet1: trail → add → resample → wrangle → resample → wrangle → output
```

把 pipeline 封 subnet, 复用给多分支. production 准备 HDA 化的过渡.

## Batch 56 additions

### 2D perpendicular normal `(-dir.z, 0, dir.x)` (XZ 平面 90° 旋转)

```c
// per-point on resampled polyline
vector p_next = point(0, "P", @ptnum + 1);
vector dir = normalize(@P - p_next);
vector n = set(-dir.z, 0, dir.x);  // 90° rotation in XZ plane
@N = n;
```

vs cross / polyframe: 平面 curve 最快; 3D 任意方向 → cross; 需要 up vector → polyframe. 0190 案例.

### Production tool 单节点 multi-mode (5 parm + switch)

```
attribvop:
  parm1, parm2, parm3, parm4, parm5 (5 modes)
  parm_bind = output attribute name
  switch (1..N) → 选择 mode → output to bind
```

production HDA 雏形, user-facing tool 标准. 0192/0617/0089 案例.

### `chramp(@gradient)` 沿 line 形态控制万能 idiom

```c
f@gradient = (float)@ptnum / (float)(@numpt - 1);  // 0..1 归一
@P.y += chramp('shape', @gradient);                 // chramp 改 P.y
@Cd = @gradient;                                    // visualize
```

5+ paradigm: 塔形 (0197) / 旋转楼梯 (0286) / 齿轮齿廓 (0254) / 编织粗细 (0125) / 草尖 (0115).

### `intersect_all` 数命中 (vs `intersect` 单击中)

```c
vector cp[]; vector uvw[]; int prims[];
int hits = intersect_all(0, P, dir, cp, prims, uvw, 0.01, -1);

i@hit_count = hits;

for (int i = 0; i < hits; i++) {
    if (prims[i] != @primnum) {
        i@group_inside = 1;  // 内部 face 检测
    }
}
```

vs intersect (只第一 hit): intersect_all 适合"穿透检测/数命中". 0206/0394 production fracture cleanup 用.

### 内部 face 检测 (production fracture/extrude 必备 cleanup)

```c
vector dir = @N * ch("range");
vector cp[]; vector uvw[]; int prims[];
int hits = intersect_all(0, @P, dir, cp, prims, uvw, 0.01, -1);

for (int i = 0; i < hits; i++) {
    if (prims[i] != @primnum) {
        i@group_inside = 1;
    }
}
```

排除自己 + 命中其他 → 内部. delete or 单独处理. 跟 0394 玻璃预切割同 paradigm.

### labs::autouv + uvlayout (production UV 标准链)

```
geo → labs::autouv (自动 unwrap) → uvlayout (pack UV islands)
```

无 VEX. game asset 必备. 0197/0214/0625 案例.

### `i@a = hits` debug attribute

```c
i@hit_count = intersect_all(...);  // 把中间值挂 attribute
```

production debugging 标准 trick — 把不可见的中间值变成可视 attribute, viewport 看 / spreadsheet 检查.

## Batch 57 additions

### Neighbours-based pscale (自适应 size)

```c
int nbs[] = neighbours(0, @ptnum);
float dist_min = 1e3;
foreach (int nb; nbs) {
    float d = distance(@P, point(0, "P", nb));
    if (d < dist_min) dist_min = d;
}
f@pscale = dist_min;
```

mesh 上密的小, 稀的大 — 自适应 size. 0230 鳞片案例.

### `f@dist = length(pt1 - pt2)` (1 行求距离)

```c
// detail wrangle (after intersectionanalysis or ray)
vector pt1 = point(0, "P", 1);
vector pt2 = point(0, "P", 0);
f@dist = length(pt2 - pt1);
```

production 简化, 配 font 节点 viewport display. 0221 案例.

### `@copynum` (copyxform 内置 copy index)

```c
// 在 copyxform 后的 wrangle
float t = fit(@copynum, 0, 1, -1, 1);  // -1..1 双向
@P += @P * t * sin(@uv.x * ch('freq')) * ch('scale') * {1, 0, 1};
```

`@copynum` vs `@ptnum`: copynum = copy 操作 index; ptnum = point index. 编织/instance 区分用. 0237 案例.

### `{1, 0, 1}` mask vector (选维度操作)

```c
@P += offset * {1, 0, 1};   // XZ 偏移, Y 不动
@v *= {0, 1, 0};            // 只保留 Y velocity
@N = N * {1, 0, 0};         // 只保留 X normal
```

production 简化, 跟 `abs(cross(N, {0,1,0}))` 同源 — vector mask 选轴.

### measure (mesh 几何分析)

```
mesh → measure (output: area / curvature / gradient / local axes)
```

无 VEX. mesh 几何分析瑞士军刀. 0608/0252/0230/0235 案例.

### maskbyfeature (attribute → mask)

```
mesh + attribute → maskbyfeature (chramp UI 配 → 0..1 mask)
```

无 VEX. vs 手写 `fit(attr, srcmin, srcmax, 0, 1)`. 0235 案例.

### intersectionanalysis (find closest pair)

```
geo merge → intersectionanalysis → ray + foreach + calc_dist + font
```

无 VEX. corpus 罕见 SOP 节点. 0221 求两 curve 最近距离.

### primuv reproject (mesh-mesh 投影)

```c
// scale/screen wrangle
v@P = primuv(1, "P", 0, v@P);  // 把 v@P 当 UV, 拉 input1 P
```

vs ray + copytopoints (几何 ray): primuv = UV-based. 0230/0054 案例.

### `v@localx = v@N` (1 行 alias)

```c
v@localx = v@N;
```

production simple bind, 让后续节点用 `localx` 作 direction 而不是默认 N. 跟 `v@N = v@v` (0115) / `@N;` (0029) 同 family. 0235 案例.

---

## Update 2026-05-14 — Official docs deep-read recipes

来自 12 轮 Houdini 21 官方文档精读。完整笔记:`houdini_vex_session_2026_05_14.md` + `houdini_synthesis_2026_05_14.md`。挑对实战 PCG 最有杠杆的 idiom 增补。

### R-NEW-1: pcopen + pcfilter = 官方 SPH/KDE 实现

**Problem**: 想做"邻居距离加权求和"(密度场 / smooth color / KDE)。

**官方一行解**(不要手写距离权重):

```c
int handle = pcopen(1, "P", @P, radius, maxpts);
v@smooth_color = pcfilter(handle, "Cd");   // SPH reconstruction filter,自动距离加权
```

文档明确:`pcfilter` 是 "reconstruction filtering" = SPH 核函数加权。比手写 `pcfind + foreach + length(@P-...) 加权` 简洁且快。

### R-NEW-2: half-edge 沿面遍历 / 跨面跳邻居 / 边界检测

**Problem**: 找邻面 / 沿边走 / 边界检测 / 边循环 — 不要用 `primpoints + pointprims` 嵌套(O(n²))。

```c
// 沿面绕一圈
int h0 = primhedge(0, @primnum);
int h = h0;
do {
    int p = hedge_dstpoint(0, h);   // 这条边的目标点
    h = hedge_next(0, h);
} while (h != h0);

// 跨面跳邻居
int h_other = hedge_nextequiv(0, h);
int neighbor_prim = hedge_prim(0, h_other);

// 边界判定(教科书惯用法)
if (hedge_equivcount(0, h) == 1) {
    // 只有一个等价 half-edge → 边界边,无邻面
}
```

half-edge 单 int 标识,内部 = (prim, vertex_index_in_prim) 配对。

### R-NEW-3: setpointattrib 8 种 mode — 并行写入聚合命脉

**Problem**: 多线程 wrangle 同时写同一目标点不冲突。

```c
setpointattrib(0, "Cd", @ptnum, color, "set");      // 默认覆盖,多线程 last-write-wins
setpointattrib(0, "weight", @ptnum, w, "add");      // 累加,并行安全
setpointattrib(0, "max_h", @ptnum, h, "max");       // 取最大,并行安全
setpointattrib(0, "min_d", @ptnum, d, "min");       // 取最小
setpointattrib(0, "xform", @ptnum, m, "mult");      // 矩阵相乘
setpointattrib(0, "tags", @ptnum, "x", "append");   // 字符串/数组追加
setpointattrib(0, "group_in", @ptnum, 0, "toggle"); // 翻转,group 切换
```

**add/min/max/mult 是 reduction,并行确定**;set 不是。涉及多写同点必须挑 reduction mode。

### R-NEW-4: xyzdist + primuv = "投影 + 在落点拿任意属性"三段式

**Problem**: 把 P 投影到表面,然后取该投影点的 N / Cd / 任意属性。

```c
int prim;
vector uv;
float d = xyzdist(1, @P, prim, uv);             // 距离 + 落点信息
vector surf_P = primuv(1, "P", prim, uv);       // 投影到表面的真实位置
vector surf_N = primuv(1, "N", prim, uv);       // 表面法线
vector surf_Cd = primuv(1, "Cd", prim, uv);     // 表面颜色
```

⚠️ packed prim 和非均匀缩放 sphere/tube/circle 距离不准,必要时 unpack。

### R-NEW-5: intersect dir 长度 = max distance(99% 教程没说清)

**Problem**: 射线相交,但默认 `intersect(geo, P, normalize(dir), ...)` 只能命中 1 单位内。

```c
// 错(只能 1 单位):
intersect(1, @P, normalize(dir), p, u, v);

// 对(无限远):
intersect(1, @P, normalize(dir) * 1e6, p, u, v);

// 对(限定 10 单位):
intersect(1, @P, normalize(dir) * 10, p, u, v);
```

文档原话:"uses the length of the vector as the maximum distance to search"。

兄弟:`intersect_all()` 拿沿线全部命中;`intersect()` + `"farthest"` flag 拿最远命中。

### R-NEW-6: curlnoise 兄弟函数 — divergence-free 流场全家桶

**Problem**: 散布物体方向 / 毛发流向 / 流体感运动,不要用 `vector(noise(),noise(),noise())`(那是带源场,粒子会聚)。

```c
v@dir = curlnoise(@P * 0.5);          // Perlin curl(默认)
v@dir = curlnoise2d(vector2(@P.x, @P.z));  // 2D 流(沿地面)
v@dir = curlxnoise(@P * 0.5);          // simplex 版,更便宜
v@dir = cwnoise(@P * 0.5);             // Worley 元胞流
```

兄弟还有 `curlgxnoise / curlgxnoise2d`(gradient-space)。

### R-NEW-7: random_shash + pnoise — 字符串 seed 与周期 noise

**Problem 1**: 按 `s@name` 分类着色。

```c
v@Cd = vector(random(random_shash(s@name)));
```

**Problem 2**: 做无缝循环贴图 / 循环动画。`noise()` 不周期,要 tileable 用 `pnoise(p, period)`:

```c
float n = pnoise(@uv * 4, 4);  // period = 4 → uv 0~1 范围内有 4 个周期单元,首尾接合
```

### R-NEW-8: expandpointgroup — VEX 里求值 group 表达式字符串

**Problem**: 想在 VEX 里"动态构造 group 字符串然后取索引"。

```c
int pts[] = expandpointgroup(0, "0-10 @Cd.x>0.5");
// 返回所有满足该 pattern 的点号数组,foreach 处理
```

兄弟:`expandprimgroup` `expandvertexgroup`。

**反常识**:`nearpoints` / `pcfind` 的 ptgroup 参数也接同样语法 — 一步完成"先 group 再 query":

```c
int pts[] = nearpoints(1, "@Cd.x>0.5", @P, 2.0);  // 只在红色点里找近邻
```

### R-NEW-9: chi/chf/chv/chs + Create Parameters 一键生成 spare param

**Problem**: 想给 wrangle 节点加一个旋钮,不想手动 Edit Parameter Interface。

```c
// 在 wrangle 里直接写:
float force = chf("force_strength");
vector dir = chv("wind_dir");
int seed = chi("rand_seed");
string name_filter = chs("filter_name");
```

写完后,**点 wrangle 节点参数面板上的 "Create Parameters" 按钮** → 自动生成对应 4 个 spare param。这是 36 patterns 里"wrangle 自带几个旋钮"的官方做法。

spare param 对 VEX 透明 — `ch()` `chi/chf/chv/chs` 访问跟普通参数完全一样。

### R-NEW-10: opdef: / oplib: — HDA 嵌入文件引用

**Problem**: HDA 里要带模块库 / 配置 / 默认 texture,想自给自足分发。

```
opdef:.?modules.obj         # 当前 asset 嵌入文件(最常用)
opdef:/Sop/myasset?lib.obj  # 跨 asset / 跨库引用
oplib:.?shared_modules.obj  # 同 .hda 库内其他 asset 共享(更高效)
```

任何 Houdini 接受 filename 的字段都能用(File SOP / Texture / hou.readFile)。

**oplib vs opdef**:配套 asset(facade + roof + door)共用一份模块库 → 那份库放在某个 asset,其他 asset 用 `oplib:.?library.obj` 引用,**只装一份不重复**。

### R-NEW-11: setattribtypeinfo — 自定义"方向类"属性 transform 才正确

**Problem**: 自定义 `v@up` `v@tangent` 等"方向"属性,SOP transform 后方向歪了。

```c
// 在 wrangle 里:
v@up = ...;
setattribtypeinfo(0, "point", "up", "vector");   // 通用方向
setattribtypeinfo(0, "point", "up", "normal");   // 法线类(transform 用 inverse-transpose)
setattribtypeinfo(0, "point", "up", "point");    // 位置类
setattribtypeinfo(0, "point", "up", "color");    // 颜色(transform 不动)
setattribtypeinfo(0, "point", "up", "quaternion"); // 四元数
```

`v@N` 等标准名自动设 "normal" type info;自定义名默认 "vector"(transform 时不会做 inverse-transpose 法线变换)。

### R-NEW-12: pcfind_radius — "球碰球"邻居查询(实例自带半径)

**Problem**: 散布带尺寸的实例(树 / 石头 / 房子),做防重叠 / Poisson disk 改良时用。

```c
// 假设每个点有 f@pscale 表示"自身半径":
int pts[] = pcfind_radius(0, "P", "pscale", @P, max_radius, max_pts);
// 返回的邻居考虑了它们各自的 pscale,真"球碰球"
```

跟 `pcfind` 区别:后者是纯 KNN(点对点距离),前者考虑两点各自的半径。

### 总结对照表 — 跟 36 patterns 互补关系

新 idiom 跟现有 R1-R36 patterns 不重复,而是补**spatial / topology / 并行写入 / 资产化**这几个之前覆盖弱的领域。具体对照见 原作者的历史汇总（未随此 Skill 分发）。

## Batch 58 additions

### Quaternion twist along curve (精确 3D 旋转 idiom)

```c
vector axis = @N * @curveu * ch('twist');
axis += rand(@primnum) * ch('offset');

vector twist = v@up * noise(@curveu * 20) * 3 * chramp('width', @curveu);

vector4 q = quaternion(axis);
@P += qrotate(q, twist) * ch('radius');
```

vs sin twist (0125/0237 一维方向): quaternion = 完整 3D 旋转, 任意 twist 方向. 配 orientalongcurve / polyframe 必备前置. 0243 案例.

### Distance-driven curveu offset + chramp (扩散/燃烧)

```c
vector source_pos = point(1, 'P', 0);
float d = distance(v@Pavg, source_pos);
d = fit(d, ch('inmin'), ch('inmax'), ch('outmin'), ch('outmax'));

float u = -ch('minoffset') + @curveu + d;
u = clamp(u, 0, 1);
@Cd = vector(chramp('col', u));
```

距离近的先燃烧, 远的后. chramp + driver 第 7 种 (distance). 0241 钢丝球案例.

### Animated curve sections (跑马灯 wrap-around)

```c
float min = ch('min');
float max = ch('max');
float speed = @Time * 0.3 * rand(@primnum) + 0.5;
speed *= rand(@primnum) > 0.5 ? 1 : -1;

min += rand(@primnum);
max -= rand(@primnum, 123);

min = (min + speed) % 1;
max = (max + speed) % 1;

if (@uv.x < min || @uv.x > max) removepoint(0, @ptnum);
```

per-prim wrap-around uv 范围 + 删除外的点 = 跑马灯/流动光带. 0245 案例.

### Production batch FBX export (foreach + rop_fbx + python)

```
mesh group → connectivity (per piece @class)
  → foreach_begin (per piece)
      → wrangle: s@path = sprintf('%s', @class)
      → null
      → rop_fbx (export 当前 piece, 用 s@path 命名)
      → python1 (后处理 — 调外部 cmd / 设 metadata)
  → foreach_end
```

corpus 极少 (< 10), production pipeline 必备. 0247 案例.

### `@Pavg` (attribpromote-derived prim center)

```
mesh point P → attribpromote (point P → prim Pavg, mode = average)
            → primitive wrangle: v@Pavg available
```

vs `primcentroid()` 函数 (wrangle 内现算): attribpromote 提前算好多次用. 0241 案例.

### add 节点 (散点 → wireframe)

```
散点 → add (mode: by group / by attribute / by all / by primitive) → 自动连 lines
```

vs connectadjacentpieces (按距离/邻居数 piece-level): add 是简单 line 连接. 0241 钢丝球网状.

### attribremap (节点版 chramp remap)

```
mesh + attribute → attribremap (chramp UI 配 attribute → 新值)
```

vs 手写 wrangle `chramp(name, attr)`: 节点版 + UI 直观调. 0243 案例.

### chramp + driver 8 paradigm

`chramp('name', driver)` + 8 种 driver:
- @curveu / @gradient (`ptnum/numpt-1`) / @nage / @age / @id / @primnum / @ptnum / @P.y / **distance** (新)

production "1 idiom + 8 driver" — chramp 是 corpus 50+ 次最常用 idiom.

### labs::extract_silhouette + trace + cop2net (2D contour)

```
3D mesh → labs::extract_silhouette (2D silhouette curve)
2D image → trace (image → contour curve)
sop → cop2net + geometry → 用 sop 的 cop 处理
```

无 VEX. corpus < 5 用. production game-asset / illustration 流程. 0245 案例.

## Batch 59 additions

### `nearpoint + distance + threshold removepoint` (去重)

```c
vector P2 = point(1, 'P', nearpoint(1, v@P));
float d = distance(v@P, P2);
if (d < 0.00001) removepoint(0, @ptnum);
```

production 删除重复点标准 idiom. 0.00001 浮点 threshold 跟 fuse tol3d=0.001 同 family. 0323 voronoi 网球案例.

### NDC view-frustum culling (production performance)

```c
i@insideCamera = @Frame;

vector offset = {-0.5, -0.5, 0};
vector xformuv = @uv * maketransform(0, 0, offset, {0,0,0}, {1,1,1}, {0,0,0});

if (xformuv.x < ch("camera_X")*-0.5 || xformuv.x > ch("camera_X")*0.5) i@insideCamera = 0;
if (xformuv.y < ch("camera_Y")*-0.5 || xformuv.y > ch("camera_Y")*0.5) i@insideCamera = 0;
if (@uv.z >= ch("far") || @uv.z <= ch("near")) i@insideCamera = 0;
```

uv 来自 uvtexture NDC mode. production 大场景 cull viewport 外, 10-100x 性能提升. 0328 案例.

### Solver history-aware accumulator (永久保留)

```c
// solver attribwrangle1
if (@insideCamera == 0 && @opinput1_insideCamera != 0) {
    @insideCamera = @opinput1_insideCamera;
}
```

通用模板: 当前 default + 上一帧 not default → 用上一帧覆盖. "一旦满足永久保留" 任务. 0328 案例.

### KineFX 4 件套 (rig animation)

```
lsystem (or curve)
  → kinefx::rigdoctor (修复 rig attrs, 必备前置)
  → kinefx::rigpose (应用 pose 动画)
  → orientalongcurve (生成 N/up tangent frame)
  → attribdelete (清理 KineFX attrs)
```

无 VEX. vs Agent system (预制动画): KineFX = procedural rig low-level. 0320 案例.

### KineFX + vellum cloth 二级动画

```
KineFX rig 动画 → split pin region → copytopoints 叶片
                → vellumcloth → vellumsolver
```

无 VEX. 角色配饰/叶片/衣物 production 标准. 0320 案例.

### 2 paradigm image → heightfield mask

```
heightfield → mask volumewrangle (height-based) 内部
            → mask_from_cops volumewrangle 外部 cop image
            → switch
            → height wrangle (apply mask)
            → heightfield_blur → heightfield_layerclear
```

volumewrangle 调 `colormap('image.png', uv)` 拉外部 image. 0327 案例.

### Heightfield 微节点 family

heightfield_blur / layerclear / project / erode / paint / terrace / distort. production 地形 paradigm (vs mesh).

### `i@flag = @Frame` (timestamp 作 multi-purpose flag)

```c
i@insideCamera = @Frame;
```

vs `i@flag = 1`: @Frame 信息量更多 (boolean + 时间戳). 0328 案例.

## Batch 60 additions

### detangle 节点 setup (反穿插)

```
multi-curve → rest → detangle (一次)
            → repeat_begin → detangle → repeat_end (iterative 多次)
```

无 VEX. corpus < 5 罕见 SOP 节点. vs vellum hair (sim-based) — detangle 几何处理快但仅"避免穿插". 0330 案例.

### vellumrestblend (DOP 内 rest pose blend)

```
vellumsolver:
  forces:
    vellumrestblend (sim 中每帧 blend P 跟 rest P)
```

无 VEX. vs SOP 端 lerp(@P, opinput1_P) (0299): vellumrestblend 在 sim 中实时 blend. 0333 案例.

### Production sim cache 三件套 (rbdio / vellumio / flipio)

vs filecache (通用): sim-aware (知道 packed pieces / vellum geometry / FLIP particles 内部结构). 0394/0333 案例.

### Lambertian toon shading (chramp 离散化)

```c
@Cd = dot(@N, chv('light'));
@Cd = clamp(@Cd, 0, 1);
@Cd = chramp('ramp', @Cd);
```

production toon shading 标准 idiom. 0335 案例.

### popwind + popattract + staticobject 3 件套 (流动衰减)

```
popsource → popsolver
              → popwind (推) → popattract (input2 = sphere, 吸)
              → staticobject (collider, 阻挡)
```

无 VEX. 推 + 吸 + 阻挡 → 平衡. 0337 案例.

### `@Cd = relbbox(@P)` (1 行 bbox 配色)

```c
@Cd = relbbox(@P);
```

production 极简, 0..1 vec 直接当 RGB. 0337 案例.

### `pointprims[0]` per-curve noise seed

```c
int ps[] = pointprims(0, @ptnum);
int p = ps[0];
vector offset = xnoise(v@P + set(p,p,p) - {.5,.5,.5});
v@P += offset;
```

不同 curve 不同 noise pattern (但同 curve 内 smooth). 0330 案例.

### chramp + driver 9 paradigm (完整覆盖)

```c
@Cd = chramp('ramp', driver);
```

driver 9 种: @curveu / @gradient / @nage / @id / @primnum / @ptnum / @P.y / **distance** (0241) / **Lambertian dot(N, light)** (0335).

production "1 idiom + 9 driver" — chramp 是 corpus 50+ 次最常用 idiom.

### DOP collider 3 paradigm

| 节点 | 适合 |
|------|------|
| **staticobject** | 任意 mesh static collider |
| **rbdpackedobject** | 动态 RBD |
| **groundplane** | 无限平面 |

production 选: 任意 mesh static → staticobject (0337); 动态 RBD → rbdpackedobject; 大 ground → groundplane.

## Batch 61 additions

### sopsolver 5 种正交用途 (新增 ray adherence)

```
1. Force injection (0497): attribtransfer SOP field → DOP pieces
2. Constraint mod (0540): sort/delete/wrangle 改 constraint
3. Group propagation (0454): BFS nearpoints + setpointgroup
4. Sim geometry mod (0013): attribvop 改 P 直接修改
5. Ray adherence (0348): ray (input2 = target_mesh) 投回 mesh 表面 ← 新
```

### Distance-driven scatter density

```c
float scatter = fit(length(v@P), max_d, 0, 0, 1);
scatter = chramp('curve', scatter);
v@Cd = scatter;
```

scatter "Density Attribute" mode + Cd 双重用. 0342 案例.

### `i@active` Bullet RBD activation

```c
i@active = 1;
```

Bullet RBD 内置约定. 跟 `@deforming/@mass/@density` 同 family. 0342 案例.

### Color channel encoding

```c
v@Cd = set(f@infection, 0, 0);
f@infection = v@Cd.r;
```

Cd 同时存 visualize + data. attribpaint 涂 → SOP 端转 scalar. 0343 案例.

### Modular asset assembly (节点级)

```
prefab → transform → copy → mirror → merge
```

无 VEX. copy + mirror = 1 prefab → 多对称. 0344 案例.

### sopsolver "ray" inside popsolver (粒子贴 mesh)

```
popsolver: popsource → popforce noise → sopsolver "ray":
                                          dop_geometry → ray (input2 = target_mesh)
```

无 VEX. sopsolver 第 5 种用途. 0348 root growth 案例.

### Cellular automaton on mesh (neighbours spread)

```c
int nb[] = neighbours(0, @ptnum);
for (int i = 0; i < len(nb); i++) {
    f@infection += point(0, 'infection', nb[i]) * ch('infect_mult') * random(@ptnum);
}
if (f@infection > 1) f@infection = 1;
```

discrete spread + saturation + random 扰动. 0343 案例.

## Batch 62 additions

### enablesolver in PRESOLVE (Bullet RBD sim 启停)

```
rbdbulletsolver:
  forces:
    PRESOLVE ← enablesolver (input from sopsolver / parm / time)
```

无 VEX. corpus 罕见 < 5. production "时间触发 sim" 标准. 0422 案例.

### sopsolver pointvelocity in DOP (timed v injection)

```
sopsolver1 (inside dopnet PRESOLVE):
  dop_geometry → pointvelocity → OUT
```

无 VEX. vs SOP 端 pointvelocity (0403, 一次性 trigger): DOP 内 pointvelocity = 配 enablesolver 实现 timed activation. 0422 案例.

### Production sim cache 三件套对比

| 节点 | 类型 |
|------|------|
| **filecache** | 通用 SOP 数据 |
| **rbdio** | RBD-aware (0394) |
| **vellumio** | Vellum-aware (0333) |
| **flipio** | FLIP-aware |

production 选: 通用 → filecache; sim-specific → 三件套.

### Mixamo character rig + capture + bonedeform

```
mesh (file) → capture (auto-skin)
            → captureoverride (手动调 weight)
            → bonedeform (apply bone transforms)
            → output deformed mesh
```

无 VEX. 60+ Mixamo bones (mixamorig_Hips → Spine → Neck/Head → Shoulder → Arm → Hand → 5 fingers, etc.). 0427 案例.

### Production character animation 3 paradigm

```
1. KineFX (procedural): rigdoctor + rigpose + orientalongcurve (0320)
2. Agent system (预制): agent + agentclip + agentcliptransitiongraph + crowdtransition (0415)
3. Mixamo + capture (FBX 导入): file → capture + captureoverride + bonedeform (0427)
```

production 选: 程序化 → KineFX; 预制角色 → Agent; FBX 导入 → Mixamo+capture.

### Production game asset pipeline (FBX export)

```
几何 (procedural) → UV (uvproject + uvtransform / autouv + uvlayout)
                  → labs::quickmaterial (PBR material)
                  → rop_fbx (export FBX)
                  → Unity / Unreal import
```

无 VEX. corpus 5+ production game asset 工程 (0247/0246/0203/0345/0349/0428). 0428 magic projectile 案例.

### labs:: prefix family 完整列表

```
labs::sine_wave / spiral / torusknot / superformula_shapes
labs::flowmap (6 件套 game-shader)
labs::quickmaterial (PBR)
labs::thicken (line → tube)
labs::sticky_uvs (UV preservation)
labs::quickrigid (RBD setup)
labs::extract_silhouette (2D silhouette)
labs::autouv (auto UV unwrap)
```

无 VEX. production master 必懂 — SideFX Labs 官方扩展, 优先用.

## Batch 63 additions

### Production character animation 4 paradigm

```
1. KineFX (procedural): rigdoctor + rigpose + orientalongcurve (0320)
2. Mixamo manual: file → capture + captureoverride + bonedeform (60+ bones, 0427)
3. fbxcharacterimport HDA: kinefx::fbxcharacterimport (一节点, 0450) ← 新
4. Agent system: agent + agentclip + agentcliptransitiongraph (0415)
```

production 选: 程序化 → KineFX; production-grade → Mixamo manual; 快速原型 → fbxcharacterimport HDA; 预制角色 → Agent.

### `collisionsource` (mesh → VDB collision)

```
mesh → collisionsource → VDB collision → staticobject (DOP)
```

无 VEX. vs 手动 vdbfromparticles/vdbfrompolygons. production 一节点搞定. 0450 案例.

### Distance mask × N + sort + scatter 拓扑对齐 (mesh blending 第 11 paradigm)

```
mesh1 → scatter1 → sort1 (sort by ptnum / position)
mesh2 → scatter2 → sort2 (sort 同样)
attribcopy (mesh1 ← mesh2 P)
distancefromgeometry × N → 复合 mask
attribadjustvector blend_positions (用 mask blend P)
```

无 VEX 主流程. sort + scatter 对齐让 ptnum 一一对应. 0455 案例.

### `v@oldP = @P` (备份 P production trick)

```c
v@oldP = @P;
```

production 多步 P 变换前置. 跟 0163 `P2 = P` backup-restore 同 family. 0455 案例.

### CHOPnet (channel + spring) 物理

```
chopnet:
  geometry1 (拉 SOP 数据进 CHOP)
  spring (channel-based wave + decay 物理)
  OUT_channel
回 SOP: channel 节点 (拉 chop OUT_channel)
```

无 VEX. spring CHOP = production "弹性 overshoot" (vs lerp 直接). 0030/0153/0398/0458 同 family.

### Boolean 接缝作为 emit source

```
mesh + 动态 displaced sphere → boolean (intersect) → 接缝 mesh
                                                   → popsource emit at 接缝
                                                   → popnet
```

无 VEX. production "用几何控制 effect 区域" 标准. 0042/0166/0394/0300/0460 同 family.

### file + clean + matchsize (production 导入 mesh 标准前置)

```
file (FBX/OBJ import) → clean (remove duplicates / fix topology) → matchsize (规整 bbox)
```

无 VEX. production 导入外部 mesh 标准前置链. 跟 production export 反向. 0460 案例.

### Age-driven pscale (chramp + age driver)

```c
float fitage = fit(@age, 0, 4, 0, 1);
float ramp_fitage = chramp('ramp_fitage', fitage);
@pscale = ramp_fitage * chf('pscale_multiplier');
```

跟 0086/0345 同 family — chramp + driver 9 种之一 (age). 0460 案例.

### `maskfromgeometry` (distancefromgeometry alias)

```
mesh + target → maskfromgeometry → 0..1 mask
```

无 VEX. distancefromgeometry 重命名版 (production HDA-like rename). 0458 案例.

## Batch 64 additions

### Production sim 4 件套对比 (4 大 sim 类型)

```
Pyro:    smokeobject + pyrosolver + volumesource + gasresizefluiddynamic (0483)
FLIP:    flipsource + flipobject + flipsolver + force (0290)
Vellum:  vellumconstraints (5 mode) + vellumsolver + (forces) + (vellumio cache) (0480/0333)
RBD:     rbdmaterialfracture + rbdconfigure + rbdbulletsolver + rbdio cache (0540)
```

无 VEX. 缺一件 → sim 不会跑 / 跑错. production master 必懂.

### `gasresizefluiddynamic` (production pyro 必备)

```
pyrosolver:
  smokeobject → gasresizefluiddynamic (动态调容器尺寸) → staticobject + volumesource
```

无 VEX. 自动跟流体扩展 + 收缩到必要范围. 跟 vdbactivate (0280) 同 family — 稀疏优化. 0483 案例.

### Pyro source preparation (SOP → DOP source)

```
SOP: vdb (容器形状) → pointvelocity (给 v) → pyrosource (生成 source: density/temp/vel)
                                          → attribnoise (扰动)
                                          → volumerasterizeattributes
DOP: volumesource (从 SOP 拉 volume) → pyrosolver
```

无 VEX. pyrosource = production "mesh → pyro emit" 标准节点.

### KineFX 5 paradigm (新增 jointdeform pair)

```
1. KineFX procedural: rigdoctor + rigpose + orientalongcurve (0320)
2. Mixamo manual: file → capture + captureoverride + bonedeform (0427)
3. fbxcharacterimport HDA: 一节点 import (0450)
4. fbxcharacterimport + jointdeform pair: full character HDA pipeline (0486) ← 新
5. Agent system: agent + agentclip + agentcliptransitiongraph (0415)
```

production 选: 程序化/完全控制/快速原型/标准 pipeline/预制角色 → 5 选 1.

### Production "复杂 mesh 拆分" 标准链 (准备阶段)

```
file → clean → matchsize → split × N → subdivide / normal → material × N
     → collisionsource → 多 null outputs (给 downstream sim)
```

无 VEX. production 准备阶段标准前置. 0487/0428/0450 案例.

### Multi-OUT vellum lab (production HDA 雏形)

```
vellum sim → 多 cache + 多 timeshift → 多 OUT null:
  OUT_VELLUM_FLUIDS_MESH / GRAINS / AIRBUBBLES / GEL / BALLS / BALOONS
```

无 VEX. 让 downstream 选组件 (vs 全部输出). 跟 0021 Bridge A 8 OUT / 0494 5 OUT 同 family.

### vellum 多 mode 同时 (production-grade complex)

```
vellumsolver1: cloth + pressure (球体充气)
vellumsolver2: grain (颗粒 1)
vellumsolver3: grain (颗粒 2)
```

无 VEX. production-grade 标志 — 多 solver 同时跑不同 mode.

### `pointdeform` (mesh-deform-mesh)

```
target mesh + capture geometry + deform geometry → pointdeform → deformed
```

无 VEX. vs KineFX bonedeform (用 bones): pointdeform 用 mesh 驱动 mesh, 更通用.

### `material` 节点 (production material assignment)

```
mesh + material 路径 → material 节点 → per-prim material
```

无 VEX. vs labs::quickmaterial (创建 PBR HDA): material 是 assign existing.

### Production 准备阶段 工程 paradigm

工程 没 final viewport effect, 多 null outputs (named for downstream). multi-stage pipeline 一环. 0247/0428/0450/0487/0480 案例.

## Batch 65 additions

### Production game-ready 5 件套 (game asset 完整 pipeline)

```
1. 几何: grid + boolean × N + mountain × N
2. Cleanup: labs::delete_small_parts × N (清除碎屑)
3. UV: foreach + labs::autouv (per piece) + uvlayout (pack)
4. Material: labs::quickmaterial (PBR)
5. Sim: rbdmaterialfracture + rbdbulletsolver + rbdio cache
```

无 VEX. production "game-ready asset" 完整工程标志. 0499/0428/0345/0349 案例.

### `labs::delete_small_parts` (fracture cleanup 必备)

```
fractured mesh → labs::delete_small_parts (size threshold) → 删除小碎屑
```

无 VEX. corpus < 5 用 — production 必备. 0499 案例.

### labs:: HDA family 12+ 完整列表

```
sine_wave / spiral / torusknot / superformula_shapes / flowmap (6 件套)
quickmaterial / thicken / sticky_uvs / quickrigid / extract_silhouette / autouv
delete_small_parts ← 新
```

production master 看到 labs:: 立刻识别官方扩展.

### VOP matrix construction (corpus 罕见高级 idiom)

```
attribvop:
  geometryvopglobal (P)
  → normalize → cross × 2 → vectomatx (3x3 rotation)
  → m3tom4 (4x4) → translate(P) + multiply → final 4x4 transform
  → bind output
```

无 VEX. VOP linear algebra family: vectomatx / m3tom4 / m4tom3 / invert / determinant. 0495 案例.

### Apply transform via importpoint + invert + multiply

```
attribvop:
  geometryvopglobal (P)
  → importpoint(input1 = upstream transform geom)
  → invert (取逆) → multiply (P * inv)
  → output
```

无 VEX. "一个 transform 驱动多 mesh" rig follows idiom. 0495 案例.

### `displacenml` VOP (normal-based displacement)

```
attribvop:
  geometryvopglobal (P, N) → bind noise → displacenml(P, N, scale, noise) → output
```

无 VEX. vs wrangle `@P += @N * noise * scale`: VOP 节点版 production 标准. 0493 案例.

### `object_merge` (跨工程数据传递)

```
object_merge (op:/path/工程A/OUT) → 引用上游工程 output
```

无 VEX. production multi-stage pipeline 必备. 0490 案例.

### Production multi-stage pipeline (4 stage 完整)

```
Stage 1: 数据准备 (file + clean + matchsize, character/mesh prep) ← 0450/0428/0487
Stage 2: Sim 工程 (vellum/pyro/RBD/FLIP) ← sim 工程
Stage 3: 引用 + 后处理 (object_merge + render/export) ← 0490/0247
Stage 4: Export (rop_fbx + python) ← 0247/0428
```

无 VEX. production master 必懂 — multi-stage 是 production-grade 标志.

## Batch 66 additions

### `volumevelocityfromcurves` (drawcurve → velocity field)

```
drawcurve / line + bound vdb
  → volumevelocityfromcurves → velocity vdb
  → volumevelocity → velocity attribute
  → flipsolver / popsolver
```

无 VEX. production "user curve → volume velocity field" 标准节点. 0554 案例.

### Image-driven sim (image color → multi-attribute)

```c
// per-point wrangle (after attribfrommap)
vector white = {1, 1, 1};
f@density = clamp((length(white) - length(v@Cd)) * 1000, 200, 999999);
f@viscosity = v@Cd.x * chf('max_viscosity');
f@mass = detail(0, 'dist', 0);
```

production "image RGB 通道分别用作不同 sim attribute" idiom. 0554 案例.

### Image-driven extrude (Cd.r → @zscale → polyextrude)

```c
// per-prim wrangle
f@scale = @Cd.r / 15 - 0.025;
float random = fit01(float(@primnum) / float(@numprim), 0, 1);
@zscale = @Cd.r * (pow((@scale * random * 3), 3) + 0.02);
```

```
mesh + image → 上述 wrangle → polyextrude (用 @zscale 作 distance)
```

production "image color → geometry height". 0555 案例.

### `helix` attribvop (sin/cos along ptnum)

```c
float t = float(@ptnum) / float(@numpt);
float angle = t * chf('parm1');
vector helix = set(sin(angle), 0, cos(angle));
@P += helix * chf('parm2');
```

production helix 万能 idiom. 0556 案例 + 跟 0162/0286/0354/0428/0618 同 family.

### Multi-noise variants (production fBm-like fractal noise)

```
mainCurve
  → noise (大尺度 displacement)
  → mid_noise (中尺度)
  → small_noise × N (小尺度细节)
```

无 VEX 主流程, 多 attribvop turbnoise. production 显式拆分 noise 节点 vs fBm 一节点. 0556 案例.

### Connectivity + per-class color

```c
float rand = rand(@class + 1256);
@Cd = chramp("color_ramp", rand);
```

```
mesh → connectivity (per piece @class) → wrangle (rand by class → chramp)
```

production multi-curve coloring 标准. 0556 案例.

### VEX 条件 5 种形式 (production C-like)

```c
// 1. if
if (@P.y > 0) @Cd = {1, 0, 0};

// 2. if-else
if (cond) {} else {}

// 3. if-else-if-else
if (cond1) {} else if (cond2) {} else {}

// 4. switch
switch (chi('mode')) {
    case 0: @Cd = {1, 0, 0}; break;
    case 1: @Cd = {0, 1, 0}; break;
    default: @Cd = {1, 1, 1}; break;
}

// 5. ternary
@Cd = (cond) ? vector(1, 0, 0) : vector(0, 0, 1);

// 复合条件
if (a > 0 && b < 1) {}
if (a > 0 || b < 0) {}
if (!cond) {}
```

VEX 跟 C 同语法. 0557 教学.

### `attribfrommap` (image → mesh attribute)

```
mesh → uvproject → attribfrommap (texture path) → @Cd from image
```

无 VEX. production image → attribute 标准. 0554/0555/0327/0244/0204/0463 等多案例.

### `detail()` 拉跨 wrangle 共享数据

```c
// detail wrangle: 算 detail attribute
f@dist = distance(point(0,'P',0), point(0,'P',1));

// 后续 point wrangle 拉
f@mass = detail(0, 'dist', 0);
```

跨 wrangle 共享 scalar / vector 数据 (vs detail attribute via attribpromote chain). 0554 案例.

## Batch 67 additions

### Production VOP `E_*/I_*` 命名约定

```
attribvop:
  I_P__00..05         ← Input P 多 alias (switch 用)
  I_OpInput2__00/01/02 ← Input from second input
  I_ptnum__00..04

  [body — VOP nodes + switch (multi-mode)]

  E_P__00, E_Cd__00..05, E_pscale__00..05, E_orient__00..07  ← Export
```

无 VEX. production VOP HDA-grade naming. 大写 (0568) / 小写 (`e_*/i_*` 0578) 都用. corpus < 5 严格.

### Quaternion 6 节点 family (production rotation 完整)

```
eulertoquat (vec3 → vec4)
qrotate (quat × vector → rotated)
qdistance (2 quat 距离)
qinvert (求逆)
slerp (球面插值, 不能用 lerp!)
quaternion (axis, angle → quat)
```

无 VEX. production "quaternion blend 必备 slerp" — lerp 直线插值错误. 0571 案例.

### Centroid-based rotation (围 centroid 转)

```c
vector centroid = ...;  // from extractcentroid
vector relative = @P - centroid;
vector4 quat = eulertoquat(rotation_euler);
vector rotated = qrotate(quat, relative);
@P = centroid + rotated;
```

production "rotate around point" 标准. 跟 maketransform(pivot=centroid) 同概念. 0571 案例.

### connectivity + extractcentroid + per-piece quat rotate

```
mesh → connectivity (per piece @class)
     → extractcentroid (per class centroid)
     → attribvop (per piece quat rotate around per-class centroid)
```

无 VEX. production "per-piece independent rotation". 0571 案例.

### `primuv` VOP 节点 (uv-based attribute lookup)

```
primuv (input geom, attrib_name, primnum, uv) → attribute value at prim/uv
```

无 VEX. production 用途: popvop curve attract (0054) / mesh growth (0578) / delta motion follow (0586) / mesh-to-mesh sample (0230).

### Delta motion idiom (动态 mesh 驱动 follow)

```c
// VOP equivalent
xyzdist (input2 = current torus, P) → uv
primuv (input3 = timeshift torus, attr=P, primnum, uv) → P_hist
primuv (input2 = current torus, attr=P, primnum, uv) → P_curr
subtract (P_curr - P_hist) → motion delta
add (P + delta) → 粒子 follow motion
```

production "动态 mesh 驱动静态 mesh follow" 标准. uv-based 跟 mesh 拓扑无关. 0586 案例.

### alembic + unpack + timeshift (动态 mesh 历史采样)

```
alembic (动画文件) → unpack → mesh
                  → timeshift (frame offset, e.g., -1) → 历史 mesh
```

无 VEX. alembic 适合任意几何动画 (vs FBX 角色 + bone). 0586 案例.

### Transform 表示 4 paradigm (rotation 完整)

```
1. euler angle: (rx, ry, rz) — 简单 axis-aligned
2. quaternion: eulertoquat / qrotate / slerp (0571/0243) — 平滑 blend
3. matrix: vectomatx + m3tom4 (0495) / maketransform — 完整 4x4
4. dihedral: dihedral() VEX (0258) — 2 vector 间 rotation
```

production 选: 简单 → euler; blend → quaternion; 完整 → matrix; 2 vector 间 → dihedral.

## Batch 68 additions

### VOP 端等价 wrangle 操作 (production VOP node family)

```
wrangle              VOP node
setpointattrib       setattrib (0593)
removepoint          removepoint (0591)
findattribval        findattribval (0591)
if (cond) {}         if_begin / end_if block (0591)
addpoint             addpoint (0618)
addprim              addprim (0618)
addvertex            addvertex (0618)
```

corpus < 5 工程用纯 VOP 节点完成 wrangle 等价 — production VOP HDA 标志.

### Bullet 内置 attribute set via VOP (production "VOP 控制 sim state")

```
attribvop:
  setattrib (geom, "active", ptnum, 1)     → i@active
  setattrib (geom, "deforming", ptnum, 1)   → @deforming
  setattrib (geom, "orient", ptnum, quat)   → Bullet orient
  setattrib (geom, "pivot", ptnum, P)       → 旋转中心
  setattrib (geom, "pscale", ptnum, scale)  → size
```

无 VEX. Bullet RBD 内置 attribute 完整: i@active / @deforming / @mass / @density / @v / @w / orient / pivot / pscale. 0593 案例.

### `quattomatx` (quaternion → 3x3 matrix)

```
quaternion (axis, angle) → quattomatx → 3x3 matrix
                                      → m3tom4 → 4x4 (跟 vectomatx/m3tom4/m4tom3 同 family)
```

production transform 表示间转换. 0593 案例.

### Transform 表示完整转换 family (4 paradigm 互转)

```
eulertoquat    (euler → quat)
quattomatx     (quat → 3x3)
m3tom4         (3x3 → 4x4)
m4tom3         (4x4 → 3x3)
vectomatx      (3 vec → 3x3)
```

production 4 paradigm (euler/quat/matrix/dihedral) 间互转. 0571/0593/0495 案例.

### pcopen + pcfilter spread (vs neighbours 拓扑)

```c
// VOP equivalent in solver
pcopen (P, attr, radius, max_count) → handle
pcfilter (handle, attr) → 邻居加权平均
add (current_attr + pcfilter_result * coef) → 累加 spread
```

无 VEX 主流程. vs neighbours (0343 拓扑邻居): pcopen+pcfilter 空间搜索 (radius). production 选: mesh 上 → neighbours (sharp); 散点/跨 mesh → pcopen+pcfilter (smooth). 0598 案例.

### Noise-modulated pcopen radius

```
attribvop:
  turbnoise (P) → vecsetcompon (modify radius/max_count) → pcopen
```

无 VEX. production "spread 区域不均匀" 高级 idiom. 0598 案例.

### `nearpoint` VOP (Voronoi-like 区域划分)

```
attribvop:
  geometryvopglobal (P)
  → nearpoint(input1 = scatter, P) → 最近 scatter ptnum
  → importpoint(input1, attr, ptnum) → 拉 scatter 点 attribute
```

无 VEX. vs voronoifracture (geometry-level Voronoi): nearpoint 是 attribute-level Voronoi. 0599 案例.

### Per-region xform (nearpoint + xform VOP)

```
attribvop:
  nearpoint → ptnum
  random(ptnum) → per-region random
  turbnoise(ptnum) → per-region noise
  xform(P, scatter_centroid, rotation, scale, ...) → 应用 transform
```

无 VEX. vs connectivity + extractcentroid + per-piece quat rotate (0571 拓扑分块): nearpoint 是 spatial Voronoi. 0599 案例.

### `xform` VOP node (production transform 节点)

```
xform (P, center, rotation, scale, ...) → transformed P
```

无 VEX. vs wrangle maketransform / matrix multiply. production VOP transform 标准. 0599 案例.

## Batch 69 additions

### `trig` VOP node (production "周期函数")

```
trig (value, frequency, amplitude) → sin/cos 多周期波形
```

无 VEX. vs wrangle `sin(value * freq) * amp`. 0600 案例.

### Multi nearpoint + distance + trig 干涉

```
attribvop:
  for i in 1..N:
    nearpoint(input_i, P) → ptnum_i
    distance(P, importpoint(input_i, "P", ptnum_i)) → distance_i
    trig(distance_i * freq_i) → sin wave_i
  multiply (sum) → displacenml → output
```

无 VEX. production "多源 sin 干涉" 标准. 0600 案例.

### SDF gradient pull-back (跟 push-out 反向)

```c
// 0605 pull-back
float sdf = volumesample(source_vdb, P);
vector grad = volumegradient(source_vdb, P);
vector push_back = grad * sdf;
P = mix(P, P - push_back, distance_factor);
```

vs 0603 push-out: 反向, attract 而非 repel. 跟 0603 同 family.

### Multi mesh anti-collision (vdbfrompolygons + nested if)

```
multi mesh → merge → vdbfrompolygons → vdb
attribvop:
  for i in 1..N:
    if_begin (volumesamplefile_i < 0):
      multiply → push-out_i
    end_if → subtract_i
  output → blur_mask + blur_P
```

无 VEX 主流程. nested if_begin/end_if VOP block (corpus 罕见). 0604 案例.

### `grandom` VOP node (gaussian random)

```
grandom (seed, sigma) → gaussian random (mean=0, sigma 散布)
```

无 VEX. vs `random` (uniform): grandom 正态分布. 0606 案例.

### `bias + grandom` pattern (gaussian sampling)

```
attribvop:
  bias (parameter) + grandom (sigma) → mix factor (gaussian-distributed around bias)
```

production "centered random" 标准 — 大部分粒子靠近 bias, 少部分外散. 0606 案例.

### popvop curve attract 三件套进阶 (production-grade)

```
基础 (0054): minpos + xyzdist + primuv → mix(P, minpos, bias)

进阶 (0606):
  4 xyzdist + 4 primuv (multi-curve query)
  3 minpos
  multi mix + multi multiply (复合 blend)
  bias + grandom (gaussian per-particle)
  switch (multi-mode)
```

无 VEX. production "multi-curve attract + statistical sampling".

### Distance / closest 7 paradigm

```
1. xyzdist (VEX, 直线 point-mesh)
2. distancealonggeometry (SOP, 沿表面 geodesic)
3. surfacedist (VOP, VOP geodesic)
4. intersectionanalysis (SOP, 多 geometry pair)
5. neighbours + foreach (VEX, mesh 邻居)
6. pcfind / pcopen (VEX, 空间散点)
7. nearpoint (VOP, spatial Voronoi 划分)
```

production 选: 直线 → xyzdist; 沿表面 → distancealonggeometry; mesh 邻居 → neighbours; 散点 → pcfind; spatial Voronoi → nearpoint.

## Batch 70 additions

### `minpos` with `maxdist` parameter

```
minpos(input, P, maxdist) → 最近点 (限制 maxdist 内, 超过返回 null)
```

无 VEX. vs minpos 无 maxdist (0054): 限制版用于 sparse connection. 0610 案例.

### Connection paradigm 4 种

```
1. 全连接 (笛卡尔积): nested for-loop + npoints + addpoint chain (0611)
2. 限距离 (minpos with maxdist): minpos(P, maxdist) + addpoint (0610)
3. 邻近 (pcfind): pcfind/pcopen + addprim 'polyline' (0612)
4. 拓扑邻接 (connectadjacentpieces SOP): connectadjacentpieces (0024)
```

production 选: 看连接稠密度 / 距离限制 / 拓扑.

### `npoints` VOP node

```
npoints(input) → 总点数
```

无 VEX. corpus 罕见 — 跟 wrangle `npoints(input)` 同概念但 VOP. 0611 案例.

### `findattribvalcount` + `findattribvalindex` VOP (group query)

```
findattribvalcount(input, class, attr_name, value) → 满足 attr=value 的点数
findattribvalindex(input, class, attr_name, value, index) → 第 N 个 ptnum
```

无 VEX. corpus 罕见 — production "按 attribute 值找点群" idiom. 0619 案例.

### Per-piece aggregation in pure VOP

```
attribvop:
  findattribvalcount(input, "class", current_class) → count
  for_begin (i=0..count):
    findattribvalindex(input, "class", current_class, i) → ptnum_i
    getattrib(input, "Cd", ptnum_i) → color_i
    max(...) → 累积 max color
  end_for
  output max_color
```

无 VEX. vs SOP connectivity + foreach piece (0488): 等价但 pure VOP. 0619 案例.

### Nested for-loop in VOP iteration count

```
3 层: 0615 curlnoise lines
5 层: 0611 cross product connect
6 层: 0618 spiral nested
```

无 VEX. production "VOP 内多层 iteration" = procedural geometry generator.

### Procedural noise lines (curlnoise + nested for-loop)

```
attribvop:
  for_begin1 (length=N1):
    curlnoise(P) → noise → add P → addpoint
    for_begin2 (length=N2):
      curlnoise → add → addpoint + addprim + addvertex
      ...
```

无 VEX. production "多层 curlnoise displacement" 自然 strand / hair. 0615 案例.

## Batch 71 additions

### chramp(u) → primuv re-position (curve density)

```c
float u = float(@ptnum) / (@numpt - 1);
float new_u = chramp('func', u);          // 必须 non-decreasing
@P = primuv(0, 'P', 0, new_u);
```

### Production VEX cookbook 8 idioms (0196 master)

```c
// 概率删点
removepoint(0, rand(@ptnum + ch("seed")) < ch("probability") ? @ptnum : -1);
// 概率删 prim
removeprim(0, rand(@primnum + ch("seed")) < ch("probability") ? @primnum : -1, 1);
// Power-curved random scale
@pscale = fit01(pow(rand(@ptnum + ch('seed')), ch('power')), ch('min'), ch('max'));
// Quaternion rotation
@rot = quaternion(angle, chv('axis'));
// chramp + rand color
v@Cd = vector(chramp('color', rand(@ptnum + ch('seed'))));
// curlnoise + mask
@P += curlnoise(@P) * {1,0,1} * fit01(rand);
// Foreach 元数据
int copynum = prim(0, 'copynum', @primnum);
int ite = detail(1, 'iteration', 0) * 2;
// Reference + up
@N = normalize(point(1, 'P', 0) - @P);
@up = {0, 1, 0};
// 高维 hash
float u = rand(set(@elemnum % 666, @elemnum / 666, seed));
```

### Heightfield system standard chain

```
heightfield → heightfield_project (input2=mesh) → heightfield_noise → heightfield_blur → heightfield_distort → heightfield_remap
```

### "归 0 → 制作 → 归位" workflow

```
input animated mesh → tran (xform 归 0) → [subnet 复杂 procedural] → tran1 (反 xform) → matchsize
```

### Reference 4 件套 (production HDA)

```
HDA subnet:
  Ref_bbox null + Ref_direction null + Ref_size null + Re_pos null
```

### addpoint + removeprim prim → point only

```c
// primitive wrangle
addpoint(0, @P);
removeprim(0, @primnum, 1);
```

## Batch 72 additions

### Production rock generator (worley + turb stack)

```
attribvop:
  worley → turb modulation → worley(modified) → subtract worley × 2 (ridge) → displacenml
  multi switch (N mode)
```

无 VEX. 0621 案例.

### "几何属性当 v" 4 paradigm

```c
v@v = v@P;                                  // P 当 v (从原点向外)
v@v = v@N;                                  // N 当 v (mesh 表面方向)
v@v = normalize(@P - center);                // 径向 v
v@v = curlnoise(@P);                         // noise field v
```

production "v initialization" 4 种. 0623/0633/0297/0337 案例.

### Color-driven velocity scale

```c
v@v *= pow(v@Cd, 2);  // velocity 跟 Cd² 关联
```

vs chramp (driver → Cd): 反向 (Cd → velocity). 0623 案例.

### POP fluid 4 件套

```
popnet:
  popsource → popproperty → popfluid (粒子级流体) → popdrag → popforce → popsolver
```

无 VEX. vs FLIP: popfluid 粒子级 lighter, FLIP volume-based heavier accurate. 0623 案例.

### Mesh blending 第 12 paradigm (noise + anim + relbbox 复合)

```c
float aanoise_val = aanoise(@P);
vector relbbox_val = relbbox(0, @P);
float anim = chf('anim');
float fit_val = fit(aanoise_val + anim + relbbox_val.y, ...);
float ramp_weight = chramp('ramp', fit_val);
@P = mix(@P, target_P, ramp_weight);
```

mesh blending 万能模板第 12 paradigm. 0624 案例.

### `length(@v) < threshold` removepoint

```c
if (length(@v) < ch('threshold')) removepoint(0, @ptnum);
```

production "速度 threshold dissolve". 0624/0623 案例.

### mesh → pyro source 完整链

```
mesh dissolve → trail (record P 历史) → pyrosource → volumerasterizeattributes → pyrosolver → filecache
```

无 VEX 主流程. production "mesh → pyro source → sim" 标准. 0624 案例.

### Reverse-time trick

```
forward sim (image → 散落) → cache to disk → retime (Frame 倒放) → visually 等价 reverse sim
```

无 VEX. production "汇集 / 形成" effect 经典. 0629/0631 案例.

### chramp + driver 10 paradigm

```c
@Cd = chramp('ramp', driver);  // driver 10 选 1
```

driver 10 种: @curveu / @gradient / @nage / @id / @primnum / @ptnum / @P.y / distance / Lambertian / **speed** (新).

## Batch 73 additions

### `multisolver` (production 多 solver 协作)

```
multisolver:
  flipsolver1 (FLIP sim)
  sopsolver1 (post-process per frame): dop_geometry → attribtransfer → OUT
```

无 VEX. corpus < 5 — production 高级 sim 协作. 0630 案例.

### Color preservation through sim 3 paradigm

```
A. Pre-sim: mesh + UV → flipsource (attr 跟着粒子) → flipsolver → output (0412)
B. Post-sim: mesh-ify sim → attribtransfer (UV from rest geo via xyzdist) (0412)
C. Sim-内每帧: multisolver + sopsolver attribtransfer in DOP (0630, 新)
```

production 选: 简单 sim 内 → A; 准确 render → B; sim-内每帧 → C.

### Multi attribvop "N manipulation" 3 步 chain

```
add_N: P + P + parm → 把 N 放大
Change_normals: cross(P, axis) + multiply → cross 旋转 N
Noise_N: turbnoise + add(N + noise) → noise 扰动 N
```

无 VEX 主流程. production "N manipulation" 3 步标准. 0632 案例.

### `staticsolver` (production groundplane physics)

```
popnet:
  staticsolver (input = groundplane) → ground 物理 collider
  + gravity + popwind + popdrag + popwrangle
```

无 VEX. DOP wrapper for groundplane. 跟 staticobject 同 family. 0632 案例.

### Production audio CHOP 9 节点 pipeline

```
chopnet:
  file → delete → trim → pass → envelope → limit → trigger → spring → shift → rename → export → SOP
```

无 VEX. production "audio → animation" 标准. 0076 案例.

### `envelope + limit + trigger + spring` 4 件套 (audio reactive)

```
audio → envelope (low-pass) → limit (clamp) → trigger (threshold) → spring (弹性 reaction)
```

无 VEX. production "audio reactive animation" 万能模板. 0076 案例.

### Noise function 4 大类 (VEX cookbook)

```c
snoise(P, ...)            // simplex (production 默认)
anoise(P, ...)            // alligator (sharp/cell)
onoise(P, ...)            // original perlin (经典)
snoise(P, periodX, ...)    // periodic snoise (循环)
```

Parm chain: freq / offset / amp / turb / rough / atten. 0084 案例.

### `@pscale = fit01(min, max, rand)` (per-point random pscale)

```c
@pscale = fit01(ch('minvalue'), ch('maxvalue'), rand(@ptnum));
```

production "per-point random within range" 标准. 0632 案例.
