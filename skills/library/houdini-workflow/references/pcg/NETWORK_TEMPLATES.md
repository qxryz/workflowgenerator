> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# SOP Network Skeletons by Stage

Copy-paste starting points for each of the 5 stages. Ascii topology + node-by-node purpose.

## Stage 1: Volume / shape generation

### Skeleton 1A: Box accretion (DLA-style) — for organic-feel buildings

```
[origin_box]                     [seed_volume]
   │ (defines unit module)         │ (defines growable area)
   ▼                               ▼
[unit_box null]              [isooffset (fogvolume)]
                                   │
                                   ▼
                              [scatter (npts=400)]
                                   │
                                   ▼
                              [make_grid wrangle (rint snap)]
                                   │
                                   ▼
                              [fuse (0.001, distancesnap)]
                                   │
                                   ▼
                              [delete_edge_points wrangle]
                                   │
                                   ▼
                              [PUB_candidate_pts null]
                                   │
                                   ▼
[repeat_begin (feedback)] ─────────┤
        ▲                          │
        │                          ▼
        │                   [pick_random wrangle (detail)]
        │                          │
        │                          ▼
        │                   [copytopoints1] ←── [unit_box]
        │                          │
        │                          ▼
        │                   [merge2] ←── [previous boxes]
        │                          │
        └─────── [repeat_end] ◄────┘
                    │
                    ▼
                  [OUT]
```

**Key choices**:
- `repeat_begin/end method=feedback` — state accumulates
- `scatter npts=400` — enough for ~80 unique post-fuse points
- `radius=2.1` in delete_edge_points = grid_step × 1.05

### Skeleton 1B: Voronoi tessellation — for cells / districts

```
[footprint_polygon]
       │
       ▼
[scatter_2d (npts=N_cells)]
       │
       ▼
[voronoi_split_2d]   (or voronoifracture3d for 3D)
       │
       ▼
[per_cell_attribs wrangle]    (writes i@cell_id, f@cell_area)
       │
       ▼
[OUT]
```

### Skeleton 1C: L-system — for branching structures (trees, blood vessels)

```
[lsystem (with rule string)]
       │
       ▼
[convertline → polywire (give branches thickness)]
       │
       ▼
[per_segment_attribs wrangle]   (writes i@depth, f@thickness)
       │
       ▼
[OUT]
```

### Skeleton 1D: Cellular automata — for caves / dungeons

```
[grid_2d (large)]
       │
       ▼
[random_fill wrangle (i@alive = rand > 0.5)]
       │
       ▼
[for-loop (count=4 generations)] ─────┐
       │                              │
       ▼                              │
[cellular_step wrangle (i@alive = neighbour rule)]
       │                              │
       ▼                              │
[for-end] ◄───────────────────────────┘
       │
       ▼
[blast non-alive points]
       │
       ▼
[OUT]
```

## Stage 2: Volume merging → outer hull

### Skeleton 2A: VDB boolean union (the standard)

```
[Stage1 output (overlapping geometry)]
       │
       ▼
[vdbfrompolygons (voxel_size = grid_step / 4)]
       │
       ▼
[convertvdb (output type: polygon, iso=0)]
       │
       ▼
[transform (ty=1e-7)]   (avoid edge-case rounding)
       │
       ▼
[make_grid wrangle (re-quantize)]
       │
       ▼
[fuse (0.001, distancesnap)]
       │
       ▼
[OUT]
```

### Skeleton 2B: Polybool (only if input is clean and polybool won't fail)

```
[Stage1 output (separate clean meshes)]
       │
       ▼
[for-loop pairwise boolean union]
       │
       ▼
[OUT]
```

Use only when shapes are guaranteed non-coplanar / non-touching. Otherwise use 2A.

## Stage 3: Semantic init — the spine

### Skeleton 3: Single wrangle classifier

```
[Stage2 hull]
       │
       ▼
[facet (consolidatepts)]    (split shared edges if not already separate)
       │
       ▼
[measure (writes @area)]
       │
       ▼
[normal (writes @N)]
       │
       ▼
[init wrangle (writes s@type)]
       │
       ▼
[OUT (semantic-tagged hull)]
```

The init wrangle is the project soul. Template:

```c
// primitive wrangle
int pts[] = primpoints(0, @primnum);
vector normal = point(0, "N", pts[0]);
vector pos = point(0, "P", pts[0]);

if (normal.y > 0.7) s@type = "roof";
else if (normal.y < -0.7) {
    s@type = (pos.y < 0.01) ? "floor" : "support";
    if (s@type == "support") s@type += (@area < threshold ? "_partial" : "_full");
}
else s@type = "wall";
```

Adjust the dictionary per asset class.

## Stage 4: Refinement + module dispatch

### Skeleton 4A: Wall refinement (semantic subdivision)

```
[Stage3 output]
       │
       ▼
[blast (keep s@type=="wall")]
       │
       ▼
[probability_window wrangle]   (s@type "wall" → some become "window")
       │
       ▼
[veto_intersect wrangle]       (windows blocked by geometry → revert to "wall")
       │
       ▼
[probability_door wrangle]     (some "wall" become "door")
       │
       ▼
[entrance_door wrangle (detail)]    (pick exactly one main entrance)
       │
       ▼
[merge with non-wall (s@type=roof, floor, etc.)]
       │
       ▼
[OUT]
```

### Skeleton 4B: Per-category module dispatch (one per category)

```
[Stage3 output, filtered to one s@type category]
       │
       ▼
[get_centroid → centroid_to_point]   (one point per face)
       │
       ▼
[attrib_init wrangle]                (set s@name + s@variation + v@scale + @N + v@up)
       │
       ▼
       │  ┌────────────────────────────────┐
       ├──┤ For composite modules (e.g.    │
       │  │ window = frame + cut + plane + │
       │  │ shutter), branch here.         │
       │  └────────────────────────────────┘
       │
       ├─► [frame_attrib wrangle (s@name += "_frame")] ──► [file] ──► [copytopoints] ──┐
       │                                                                                │
       ├─► [cut_attrib wrangle  (s@name += "_cut")]   ──► [file] ──► [copytopoints] ──┤
       │                                                                                │
       ├─► [plane_attrib wrangle (s@name += "_plane")]──► [file] ──► [copytopoints] ──┤
       │                                                                                │
       └─► [shutter_attrib wrangle (s@name += "_shutter")]──►[file]──►[copytopoints] ──┤
                                                                                         │
                                                              [merge] ◄──────────────────┘
                                                                 │
                                                                 ▼
                                                              [OUT]
```

For a "single module per face" category, just one branch.

## Stage 5: Pattern + deformation

### Skeleton 5A: Wood pattern generation (procedural texture as geometry)

```
[wall geometry]
       │
       ▼
[divide_pattern subnet]                 (divides wall into horizontal/vertical/scale tiles)
       │
       ▼
[uneven_division wrangle]               (jitter division lines for natural look)
       │
       ▼
[extrude wrangle]                       (random per-board depth for woodgrain feel)
       │
       ▼
[uv_prim wrangle (R18 from VEX_RECIPES)] (avoid tile repeat)
       │
       ▼
[OUT]
```

### Skeleton 5B: Lattice + mountain deformation (the standard "make it look hand-crafted")

```
[final geometry]
       │
       ▼
[lattice_box (low res box around geo)]
       │
       ▼
[group_expression "@P.y > $CEY"]          (select top control points)
       │
       ▼
[mountain (apply noise to lattice top)]
       │
       ▼
[lattice (input #0=geo, #1=lattice_box, #2=mountain)]
       │
       ▼
[OUT]
```

For multi-frequency: stack 2-3 of these with progressively finer lattice and smaller noise amplitude.

## Subnet hygiene template

Every subnet should look like:

```
[IN null]
       │
       ▼
[... internal nodes ...]
       │
       ▼
[OUT null]

[PUB_<service_name> null]   (optional, for consumed-by-others outputs)
```

This is just labeling discipline. Day 1 saves day 100's debugging.

## Common patterns repeated across stages

### "Service node" exposure

Inside any subnet that produces something consumed externally:

```
[internal_computation]
       │
       ▼
[PUB_footprint null]   ← dedicated null for external consumption
```

External consumers `object_merge` the `PUB_*` null, never the internal nodes.

### "for-each prim" pattern

When you need per-prim wrangle behavior with full prim context:

```
[geometry]
       │
       ▼
[for-loop block_begin (method=piece)]
       │
       ▼
[per-prim wrangle (uses chi("primnum"))]
       │
       ▼
[for-loop block_end (method=merge)]
       │
       ▼
[OUT]
```

### "iterate until done" pattern

```
[geometry]
       │
       ▼
[for-loop block_begin (method=feedback)] ◄────┐
       │                                       │
       ▼                                       │
[single-step wrangle (sets i@stop=1 when done)]│
       │                                       │
       ▼                                       │
[for-loop block_end (method=feedback)] ───────┘
       │
       ▼
[OUT]
```

## How to use these skeletons

1. Identify which stages your project needs (rare to skip any of the 5)
2. Pick a skeleton variant per stage based on asset class
3. Rename nodes meaningfully (`box1` → `seed_volume`, `wrangle1` → `init_attribs`)
4. Wire `IN` / `OUT` labels at each subnet boundary
5. Add `PUB_*` nulls for service nodes from day 1
6. Connect stages via clean `subnet → subnet` edges, not internal-to-internal

Copy + adapt is much faster than recreating from scratch. The skeletons handle all the wiring details (which input is which, where fuse goes, where to put the for-loop) so you only think about the algorithm-level choices.
