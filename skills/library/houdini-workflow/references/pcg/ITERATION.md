> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Iteration with Art Direction

Translating artist feedback into specific parameter / wrangle changes.

## The art-direction translation table

Common feedback → specific intervention:

| Artist says | Likely root cause | Specific fix |
|-------------|-------------------|--------------|
| "Too uniform / too repetitive" | `rand()` not seeded by position | Use `rint(@P.x*100)/100 + rint(@P.z*100)/100` as seed. Add per-position noise. |
| "Too random / chaotic" | All probabilities are pure rand | Add `condition_bonus` (Y position, normal direction, area) to bias. |
| "Top has X, bottom doesn't" | No height-based variation | Add `if (relbbox(0, @P).y > 0.7) prob += bonus` |
| "Front looks different from back" | No directional bias | Add `if (@N.z > 0) prob += bonus` for the desired side |
| "Windows are too small/large" | Module .obj size or `v@scale` | Either rescale module or `v@scale = {1, 1, scale}` |
| "Need more variety" | Too few module variations | Add 2-3 new variations to the .obj library |
| "Patterns are too obvious" | Modules placed on perfect grid | Add post-deformation (lattice + mountain) |
| "Looks too perfect / new" | No weathering / wear | Add weathering pass (vertex color jitter, displacement noise) |
| "Decorations clip into walls" | No collision check | Add `intersect()` veto in placement wrangle |
| "Same window on every floor" | Variation seeded by ptnum | Re-seed by `(seed + ptnum + floor_id)` |
| "Door is in wrong place" | `assign_entrance_door` random | Add direction constraint: pick from points where `@N` faces target |
| "Roof is too steep/shallow" | Hard-coded angle in `elevation_platform` | Expose `chf("roof_angle")` in 30-60 range |
| "Too dense / sparse" | `npts` too high / low in scatter | Adjust scatter density or `delete_edge_points` threshold |

## The 4-step iteration loop

When art comes back with feedback:

### Step 1: Disambiguate the feedback

Artists say imprecise things. Ask one clarification:

- "Too random" → "do you mean too varied, or do you want a specific pattern?"
- "Looks weird" → "weird how — proportions? color? placement?"
- "Need more X" → "X by 2x? or just more frequent?"

Don't ask 3 questions. Pick the most blocking one.

### Step 2: Locate the responsible wrangle

Use the project's stage map:

- Shape feel wrong → Stage 1 (volume) or Stage 5 (deformation)
- Module placement wrong → Stage 4 (refinement / dispatch)
- Specific module looks wrong → modules library (artist's domain, not yours)
- Color / weathering → Stage 5 (pattern) or post-process

### Step 3: Decide intervention level

| Intervention | When to use |
|--------------|-------------|
| Tweak existing parameter | Quick win, no code change |
| Add condition_bonus to existing wrangle | Few-line VEX edit |
| Add new wrangle in same subnet | New rule, doesn't change architecture |
| Add new subnet / category | New module type, structural change |
| Refactor architecture | Multiple repeated requests indicate structural issue |

Start at level 1, escalate only when needed.

### Step 4: Show the change + ask "is this what you meant?"

Don't iterate silently 5 times. Show after each significant change. Artists often realize their first feedback wasn't quite right after seeing your fix.

## Common iteration patterns by intervention type

### Tweak a parameter (level 1)

```
Artist: "Windows feel sparse"
You: bump `window_density` from 0.4 to 0.55, regen, show
```

10 seconds. No code touched.

### Add condition_bonus (level 2)

Artist: "Wait, the second floor windows should be bigger than first floor"

Find the `assign_window_attrib` wrangle. It probably has:
```c
if (rand(seed+@primnum) > prob) ...
```

Modify:
```c
vector pos = point(0, "P", primpoints(0, @primnum)[0]);
float bonus = 0;
if (pos.y > 3.0) bonus = 0.2;            // floor 2+: more frequent

if (rand(seed+@primnum) > prob + bonus) {
    // skip
} else {
    s@type = "window";
    if (pos.y > 3.0) s@variation = "02";  // size variant 02 = larger
    else             s@variation = "01";
}
```

Single wrangle edit. Show artist.

### Add a new wrangle (level 3)

Artist: "Let's add weather vanes on top of chimneys"

Inside `roof_modules/setdressing`:
1. Find chimney attribute wrangle output
2. Insert new wrangle: filter chimney points + add `s@name = "weathervane"` + offset Y
3. Add new file SOP loading `roof_weathervane_01.obj`
4. Add new copytopoints

5 minutes work. Artist creates the .obj file.

### Add a new category / subnet (level 4)

Artist: "We need lanterns hanging from the eaves"

This is a new s@type subdivision (eaves) and a new module category (lanterns). Plan:

1. In Stage 3 init wrangle, add new s@type = "eave" detection (specific normal + position)
2. Create new subnet `eave_modules` mirroring `body_modules` structure
3. Inside it, attribute init writes `s@name = "lantern"` with random scale
4. Spec the module to artist (3 variations)

20 minutes plus artist time. Iteration cycle still under a day.

### Architectural refactor (level 5)

Artist: "Can you make this work for both lake houses AND mountain cabins? They have different roof styles..."

Now we're talking architecture. Plan:

1. Introduce `style_variant` enum parameter ("lake" / "mountain")
2. Refactor `elevation_platform` to read style and adjust angle ranges
3. Add `style_modules/lake/` and `style_modules/mountain/` directories
4. Refactor module dispatch to insert style prefix in path
5. Test all combinations

Days, not minutes. Justify before committing.

## Communication tips

### Use visuals to explain

When showing a fix, screenshot before/after. Don't just say "I added a condition" — show the visible result.

### Use the parameter language

Artists know parameters, not VEX. When discussing fixes:

- ❌ "I added an `intersect()` veto in the wrangle"
- ✅ "I added a check so windows won't overlap with the chimney"

### Give artists fast iteration

If artist tweaks `window_density` and waits 30 seconds for cook → bad UX. Fix:

- Cache mid-pipeline outputs (`null` followed by `cache` SOP)
- Use `wedge` for quick batch comparison
- Strip non-essential subnets when iterating quickly

### Set expectations

Some changes are 1-minute, some are 1-day. Tell the artist upfront:

- "Bumping density: 30 seconds, here's the result"
- "Adding directional bias: 5 minutes, give me a moment"
- "Adding new module category: 20 minutes + you'll need to make 3 variations"
- "Different roof style for mountain: 2 days because it's a structural change"

This builds trust.

## Common pitfalls

### Pitfall 1: Over-engineering on first feedback

Artist: "More windows please"

❌ Refactor entire window system to be parameter-driven with 5 sub-options
✅ Bump `window_density` from 0.4 to 0.55. Done in 10 seconds.

If the same feedback comes 3 times for different aspects, THEN refactor.

### Pitfall 2: Ignoring artist intent

Artist: "Looks too uniform"

❌ Tell them their feedback is invalid because the algorithm is correct
✅ Explore the underlying intent — they want variety. Find a way to add it.

### Pitfall 3: Silent iteration

❌ Quietly make 5 changes, send 1 final result
✅ Show after each change. Faster feedback loop, less wasted effort if going wrong direction.

### Pitfall 4: "It's perfect, ship it" trap

When YOU think it's done, art may not. Always do one more review pass with art.

### Pitfall 5: Not capturing recurring feedback as parameters

If artist asks for "more windows" 3 times across projects, that should become a permanent `window_density` parameter, not 3 ad-hoc tweaks.

## When to push back on art direction

Sometimes "what artist wants" conflicts with "what's procedurally feasible". Examples:

- "Each window should be hand-placed" → defeats the procedural purpose
- "I want exactly 7 chimneys" → fine but means `count`, not procedural
- "Windows should sometimes be in walls and sometimes be in roofs" → ambiguous, ask which

Push back politely:

> "I can do this, but it'll be a special case rather than procedural. Want me to add an override mechanism, or should we change the rule?"

## Iteration cadence

Healthy iteration cycle:

- Initial sketch: 1-2 days
- First art review: 1 hour
- Iteration 1: 1-3 hours
- Iteration 2: 1-3 hours
- Iteration 3: 1 day (more substantial changes)
- Lock for production: 1-2 days

If still iterating after week 2, something's wrong — usually scope creep or unclear vision.

## Document iterations

Keep a brief log of "what was changed and why":

```
2026-05-13: bumped window_density 0.4 → 0.55 per art request "more windows"
2026-05-14: added gravity_bias parameter; was hardcoded at 0.7, now 0-1 range
2026-05-15: added eave subnet for hanging lanterns; new module category required
```

Saves time when revisiting "what did we decide about windows again?".
