> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# PCG Project Playbook: Requirement to Delivery

The end-to-end workflow for building a Houdini PCG asset. Use this when starting a new project or when the user describes a procedural need.

## Step 0: Clarify (1-2 questions max)

Only ask if truly blocking. Common blockers:

- **Asset class** if ambiguous ("a procedural city" — modern/medieval/sci-fi?)
- **Scale** ("one building" vs "a district" — affects performance budget)
- **Output destination** (Houdini-only render vs Unreal export — affects what's allowed)
- **Style references** (link to image / artist if available)

Skip clarification if the question would just stall progress. Sketch with sensible defaults and let the user redirect later.

## Step 1: Asset class → 5-stage strategy

| Asset class | Stage 1 Volume | Stage 3 Semantic | Stage 4 Modules | Stage 5 Deform |
|------------|---------------|------------------|-----------------|----------------|
| Building (residential) | DLA-style box accretion | normal+pos: roof/wall/floor | window/door/chimney | lattice + mountain |
| Castle / fortress | Hand-crafted footprint + extrude | normal+graph: wall/tower/gate/battlement | crenellation/portcullis/banner | minimal (intentional rigidity) |
| Modern city block | Voronoi tessellation of plot | per-cell: building/street/sidewalk | facade panels by floor | none (geometric purity) |
| Vegetation (tree) | L-system / SpaceColonization | per-segment: trunk/branch/leaf | leaf clusters by depth | wind-driven sin/noise |
| Vegetation (forest) | Poisson disk on heightfield | per-tree: species/age/health | tree variants by class | per-tree wind |
| Cave / dungeon | Cellular automata on grid | per-cell: floor/wall/door/treasure | torch/bones/door modules | none (sharp boundaries) |
| Spaceship | Voronoi on hull surface | normal: top/bottom/side | thrusters/antennas/panels | none (mechanical) |
| Vehicle | Rule-based modular assembly | hand-tagged frame | wheel/window/light kits | minimal |
| Terrain | Heightfield + erosion | by slope/altitude: rock/grass/snow | scatter rocks by class | erosion + smoothing |
| Sci-fi corridor | Linear extrude + branching | per-segment: hallway/junction/room | door/light/vent modules | none |

If asset doesn't fit, pick the closest and adapt. The 5-stage skeleton always applies.

## Step 2: Sketch the SOP network skeleton

Open with the standard 5-stage shell (see [NETWORK_TEMPLATES.md](NETWORK_TEMPLATES.md)):

```
[input geo or generator]
   │
   ▼ Stage 1: volume
[volume_subnet]
   │
   ▼ Stage 2: hull
[hull_subnet (VDB if needed)]
   │
   ▼ Stage 3: semantic init
[semantic_init wrangle]   ← THE PIVOT — design the s@type dict here
   │
   ▼ Stage 4: refinement + module dispatch
[refinement_subnet]
   │
   ▼
[module_dispatch_subnets] (one per module category)
   │
   ▼ Stage 5: pattern + deform
[pattern_subnet]
   │
   ▼
[deformation_subnet]
   │
   ▼
[OUT]
```

Each box becomes a subnet with clear `IN` / `OUT` / `PUB_*` interface nodes from day 1.

## Step 3: Design the s@type dictionary (Stage 3)

This is the most consequential decision. The s@type values define what downstream subnets can address.

For a building: `{wall, roof, floor, support_full, support_partial}` — 5 classes.
For a castle: `{wall, tower, gate, battlement, courtyard, keep}` — 6 classes.

**Rules**:
- Keep it under 8 classes (more = chaos)
- Names should be domain-meaningful (`battlement` not `class3`)
- Subdivide later if needed (`wall` can become `wall_main / wall_window / wall_door` in Stage 4)
- Reserve `unknown` as a safety fallback

## Step 4: Identify the 3-5 hardest wrangles, write them

Most subnets are 1-3 lines of VEX. The hard ones (worth pre-writing):

- **Semantic init** — the s@type assigner (see [VEX_RECIPES.md](VEX_RECIPES.md) "semantic init")
- **Module dispatcher** — the s@name + s@variation generator
- **Geometric veto** — the "is this position legal?" wrangle (intersect-based)
- **Module orientation** — the angle/up vector calculator
- **Variable-length tiling** — the integer-segment + scale calculator

For everything else, lean on built-in SOPs (scatter, fuse, polyextrude, copytopoints).

## Step 5: Module library spec

Even before any .obj files exist, lock down the contract:

- Naming: `<category>/<category>_<name>_<variation>.obj`
- Pivot: origin at base center, +Y up, +Z facing outward
- Scale: 1 unit = 1 grid cell (or whatever your project unit is)
- Variations: 3-5 per name (enough variety, not overwhelming)
- See [MODULE_SPEC.md](MODULE_SPEC.md) for the full spec template

Send this spec to the artist EARLY. Module mismatches are the biggest source of late-stage rework.

## Step 6: User-facing parameters

Expose 5-10 parameters at the top-level OBJ or HDA. Categorize:

**Structural (affect overall shape)**:
- `seed` (always)
- `size_x / size_y / size_z` or `target_volume`
- `complexity` (1 knob → multiple internal probabilities)

**Stylistic (affect details)**:
- `window_density`, `decoration_density`, `weathering_amount`

**Hidden / advanced**:
- Internal grid sizes, voxel resolutions, etc. — keep these inside the HDA

See [PARAMETERS.md](PARAMETERS.md) for design principles.

## Step 7: Performance budget

For the first pass, target:
- Cook time per seed: < 5 sec (interactive iteration)
- Polygon count: < 100k (Houdini viewport handles fine)
- Memory: < 500 MB

If first cook exceeds, see [PERFORMANCE.md](PERFORMANCE.md). Common culprits:
- VDB voxel too fine (8x easy speedup)
- Scatter density too high (80% of points get filtered anyway, generate fewer)
- Foreach loop with high iteration count + heavy body
- Cooking the whole DCC every change (wedge / cache strategically)

## Step 8: Iterate with art

When art comes back with feedback, see [ITERATION.md](ITERATION.md). Common patterns:

- "Too uniform" → add condition_bonus to probability + per-position seeding
- "Too random" → reduce `rand()` weight, add deterministic structure
- "Top has more X" → `if (relbbox.y > 0.7) prob += bonus`
- "Avoid X near Y" → add `pcopen` veto in the affected wrangle

## Delivery checklist

Before handing off:

- [ ] Top-level HDA with 5-10 named parameters and tooltips
- [ ] Module library with naming convention + manifest
- [ ] At least 3 example outputs with different seeds
- [ ] Performance: cook < 5 sec at default settings
- [ ] No errors / warnings in any node
- [ ] All `IN` / `OUT` / `PUB_` interface nodes labeled
- [ ] Brief README: how to swap modules, how to extend s@type dict, how to debug
