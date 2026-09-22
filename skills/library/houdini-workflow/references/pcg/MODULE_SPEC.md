> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Module Library Spec: The Contract Between TD and Artist

The module library is where artists and TDs collaborate. Get this contract right early, or pay 10x in late rework.

## Directory layout

```
modules/
  <category>/
    <category>_<name>_<variation>.obj
    <category>_<name>_<variation>.obj
    ...
  manifest.json   (optional but recommended)
  human_scale_reference.obj   (recommended)
```

Example for a building project:
```
modules/
  body/
    body_window_frame_01.obj
    body_window_frame_02.obj
    body_window_frame_03.obj
    body_window_cut_01.obj
    body_window_plane_01.obj
    body_window_shutter_01.obj
    body_door_frame_01.obj
    body_door_plane_01.obj
    ...
  roof/
    roof_chimney_01.obj
    roof_chimney_02.obj
    roof_window_01.obj
    ...
  stairs/
    stairs_body_step_01.obj
    stairs_body_step_02.obj
    stairs_body_step_03.obj
    stairs_walkway_01.obj
    ...
  setdressing/
    setdressing_box_01.obj
    setdressing_barrel_01.obj
    setdressing_paddle_01.obj
    ...
  human_scale_reference.obj
```

## Naming convention

```
<category>_<name>_<variation>.obj
└────┬───┘ └─┬─┘ └───┬───────┘
     │       │       │
     │       │       └─ "01", "02", "03" — variants of the same logical module
     │       │           Use 2-digit zero-pad. Min 1, recommended 3-5 per name.
     │       │
     │       └─────────  what role this module plays (window / door / chimney)
     │                    Snake_case if multi-word (window_frame).
     │
     └─────────────────  what subnet consumes it (body / roof / stairs / ...)
                          Same as the SOP subnet name for clarity.
```

**Why this structure**:
- Path can be reconstructed from VEX: `"modules/" + s@type + "/" + s@type + "_" + s@name + "_" + s@variation + ".obj"`
- Variations are interchangeable (artist can add `_04` later without code change)
- Categories map 1:1 to subnets (artist sees their work scoped per-feature)

## Pivot convention

```
        +Y
        |
        |
        |        +X
        |       /
        |      /
        |     /
        |    /
        +---*------> +Z (facing OUTWARD)
       /
      /
     /
   pivot at base center
```

- Origin: at the bottom-center of the bounding box
- +Y: up
- +Z: facing outward (the "front" of the module)
- +X: handedness — module's right side

Why bottom-center: copytopoints places modules at the candidate point. Bottom-center pivot means modules sit ON the placement point, not floating around it.

Why +Z forward: matches Houdini's `@N` convention. The wrangle does `setpointattrib(0, "N", pt, normal)`, copytopoints aligns +Z to N.

## Scale convention

**Rule**: 1 unit = 1 grid step (or whatever the project's base length unit is).

For a building with grid (2, 3, 2) — i.e., rooms are 2×3×2 units:
- A wall module is 2 wide × 3 tall × ~0.2 deep
- A window frame is ≤ 2 × ≤ 3 (fits in a wall face)
- A door is ≤ 2 wide × ≤ 3 tall
- A chimney is ~1 × 2 × 1

This keeps `v@scale = {1,1,1}` as the default — no scaling needed unless intentionally varying.

**Variable-length modules** (railings, stair steps): designed at the standard length, then `scale_z` adjusts in VEX (R8 from VEX_RECIPES).

## Variation convention

For each `<category>_<name>`, provide **3-5 variations**. Why this number:

- 1 variation: zero variety, every instance identical (boring)
- 2 variations: visible alternation, pattern still obvious
- 3-5 variations: enough variety that pattern doesn't dominate
- 6+ variations: diminishing returns, artist time wasted

Each variation should be **stylistically consistent** but **geometrically distinct**:
- Different proportions (wider window vs. narrow window)
- Different details (decorated frame vs. plain)
- Different sub-elements (4-pane window vs. 2-pane window)

Don't just rotate / scale a single base. Make each variation actually different.

## Special modules

### `human_scale_reference.obj`

Always include a 1.7m tall human silhouette in the modules directory.
- Confirms scale visually when artist swaps grid sizes
- Loaded as a static reference in the SOP network (`file SOP` somewhere)

### `_debug` modules (optional)

If asset is large, provide low-poly debug versions:
- `body_window_frame_01_debug.obj` — single quad with the right footprint
- Used in fast preview mode (toggle via parameter)

## Manifest file (optional but recommended)

`modules/manifest.json`:
```json
{
  "version": "1.0",
  "grid_unit": 2.0,
  "categories": {
    "body": {
      "names": {
        "window_frame": { "variations": 3, "size": [2.0, 3.0, 0.2] },
        "window_cut":   { "variations": 1, "size": [1.6, 2.4, 0.5] },
        "window_plane": { "variations": 1, "size": [1.6, 2.4, 0.05] },
        "door_frame":   { "variations": 2, "size": [2.0, 3.0, 0.2] }
      }
    },
    "roof": { ... }
  }
}
```

**Use cases**:
- Validation: load manifest in a wrangle, check all paths exist
- Auto-enumeration: SOP can iterate over all variations without hard-coding count
- Documentation: artists can see at a glance what's expected

## Validation checklist (run before shipping)

For every .obj file:
- [ ] Origin at bottom-center
- [ ] +Z faces outward
- [ ] Within nominal bounds (size matches manifest if used)
- [ ] No internal faces, no flipped normals
- [ ] UVs present (even if just box-projection)
- [ ] Triangulated or quad (no n-gons unless intentional)

You can write a validation script:

```python
# pseudocode
for path in glob("modules/**/*.obj"):
    geo = load_obj(path)
    assert geo.bbox.min.y < 0.01, f"{path}: not bottom-center"
    assert geo.face_count > 0, f"{path}: empty"
    # ... etc
```

## Common module pitfalls

### Pitfall 1: Off-center pivot
Symptom: modules float above placement points or sink into them.
Fix: re-export with origin at bottom-center.

### Pitfall 2: Wrong handedness
Symptom: all modules face inward (you see backsides).
Fix: rotate 180° around Y in source DCC, re-export.

### Pitfall 3: Inconsistent scale across variations
Symptom: window_frame_01 is 2m, window_frame_02 is 4m. Random selection produces oversized windows.
Fix: artist normalize all variations to the same nominal bounding box.

### Pitfall 4: Missing variation in middle of sequence
Symptom: `_01` and `_03` exist but `_02` is missing. VEX picks `_02` randomly → empty geometry.
Fix: enforce consecutive numbering, or use manifest to skip missing.

### Pitfall 5: Non-power-of-2 textures
Not strictly a module pitfall but: artist textures should be POT (256, 512, 1024) for engine compatibility.

## Iteration loop with artist

When you (TD) and artist iterate:

1. TD provides initial spec (this doc, customized)
2. Artist makes 1 of each module type as proof-of-concept
3. TD wires it into SOP, gets first procedural pass
4. Both review: scale OK? pivot OK? variety enough?
5. Artist fills out 3-5 variations per name
6. TD validates with manifest
7. Iterate as art direction comes back

Don't let artist start the full library before step 4. Sketch + validate first.

## Module library as separate git repo

Once stable, `modules/` should be its own git repo:
- Artist commits .obj files independently
- TD commits .hip / SOP changes independently
- CI validates module additions against manifest
- Versioning: tag `modules` repo with version, .hip points at specific version

This matures into a "module library asset" that can serve multiple .hip projects.
