> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Architectural Debt Checklist

Common debts seen in procedural modeling projects. For each: **how to spot it** + **concrete refactor**.

## Debt 1: Magic numbers tied to grid scale

**Symptom**: numbers like `2.1`, `0.1`, `1.5`, `3` appearing in many wrangles, all derived from the project's base grid size.

**Spot it**:
```
grep -E "(0\.[0-9]|[0-9]\.[0-9])" all_wrangles.md | sort | uniq -c | sort -rn
```
Watch for the same value appearing 5+ times.

**Why it's debt**: changing grid size requires hunting through 100+ wrangles.

**Refactor**:
1. Add a `grid_size` detail attrib (or HDA parameter) at project root.
2. Replace hardcoded values with `f@grid_size * 1.05` etc.
3. Lake House example: `pcopen(... 2.1, ...)` becomes `pcopen(... f@grid_size * 1.05, ...)`.

## Debt 2: Silent module-path failures

**Symptom**: wrangle constructs string `s@name + "_" + s@variation` for module path. If typoed, `copytopoints` finds nothing and silently produces no geometry.

**Spot it**: search for `sprintf` or string concatenation building file paths in attrib_init wrangles.

**Why it's debt**: bugs are invisible — looks like "missing window" not "typo'd path".

**Refactor**:
1. Add a `validate_modules` wrangle before file SOPs:
   ```c
   string path = "modules/" + s@type + "/" + s@type + "_" + s@name + "_" + s@variation + ".obj";
   if (!file_exists(path)) {  // requires Python SOP wrapper or pre-built manifest
       setpointattrib(0, "_p_error", @ptnum, "module not found: " + path, "set");
   }
   ```
2. Add a debug visualization that highlights points with `_p_error` set.
3. Long-term: build a `modules/manifest.json` and load it as detail attrib for fast lookup.

## Debt 3: Dead protocol attributes leaking

**Symptom**: final geometry carries 30+ attributes per prim, many unused after the consumer wrangle ran.

**Spot it**: in geometry spreadsheet, count attributes on output. If > 15, look for ones that are constant or zero.

**Why it's debt**: memory waste (linear in N), confusing debug, slows down downstream cooks.

**Refactor**:
1. Adopt convention `_p_xxx` for protocol attributes (e.g., `i@_p_stop`, `i@_p_raypoint`).
2. At each subnet's output, add `attribdelete` with pattern `_p_*`.
3. New code should use the prefix; old code can be migrated incrementally.

## Debt 4: Hard-coded itermethod=count where convergence is meaningful

**Symptom**: for-loop block with `itermethod=count` and a fixed N, but the algorithm could naturally terminate (e.g., DLA when no valid placements remain).

**Spot it**: any feedback loop where iteration count is user-controlled. Ask: "what happens when the algorithm naturally finishes before N? what if it can't finish in N?"

**Why it's debt**: under-N runs waste time; over-N runs may produce errors (NaN, empty geometry).

**Refactor**: change to feedback with `i@stop` set when algorithm converges:
```c
// in the loop body's last wrangle
if (no_more_work_to_do()) i@stop = 1;
```
Add a hard cap (e.g., max 100 iterations) as safety net.

## Debt 5: White-box cross-subnet dependencies

**Symptom**: `object_merge.objpath1` points at an internal node like `subnet_X/internal_thing/sub_node`.

**Spot it**:
```bash
grep "objpath1 = " 02_all_node_key_params.txt | grep -v "/IN" | grep -v "/OUT" | grep -v "/PUB_"
```

**Why it's debt**: producer subnet can't refactor internals without breaking consumer.

**Refactor**:
1. In producer subnet, add `null` named `PUB_<purpose>` connected to the current target node.
2. Update consumer's `objpath1` to point at `PUB_*`.
3. Now producer can rewire internals freely.

## Debt 6: Conflated responsibility (single wrangle does 2+ things)

**Symptom**: wrangle name like `pick_random` actually does (1) score candidates (2) sample one (3) delete others.

**Spot it**: read each wrangle aloud. If you say "and" in the description, it's doing too much.

**Why it's debt**: can't reuse one part without the other; can't replace just the scoring.

**Refactor**: split into 3 wrangles (one per responsibility):
- `score_candidates` writes `f@weight`
- `sample_weighted` picks one, sets `i@_p_picked = 1`
- `filter_picked` deletes points where `_p_picked != 1`

## Debt 7: Implicit schemas (zero documentation)

**Symptom**: no comment or doc says "this subnet expects attribs X, Y, Z and produces A, B, C".

**Spot it**: open any subnet, ask "what does it need? what does it write?" If you have to read all internal VEX to answer, it's debt.

**Why it's debt**: new contributor (or future-you) wastes hours reverse-engineering.

**Refactor**: at each subnet's IN node, write a comment block:
```
/* Pre:  prim:s@type, prim:@N, prim:@P
 * Post: point:s@name, point:s@variation, point:v@scale, point:@N, point:@up
 * Side: writes detail i@_p_done = 1 when complete
 */
```

## Debt 8: Missing fallbacks for degenerate input

**Symptom**: wrangle assumes "there's always at least one neighbour" / "the input has at least N points" — no `if (npoints == 0)` guard.

**Spot it**: search for arithmetic on `npoints(0)` or array indexing without bounds check.

**Why it's debt**: edge cases (small geo, fully filtered geo) cause NaN or empty output, often masked until production.

**Refactor**: every wrangle that reads neighbours / iterates should have a degenerate-case branch returning sensible default.

## Debt 9: Variability source coupled to input mutation

**Symptom**: `rand(seed + 67)` always produces the same value, but the wrangle still produces "different" outputs because the input geometry varies between iterations.

**Spot it**: check whether `seed` actually depends on iteration. In Lake House `pick_random`: `seed = ch("seed")` — constant. Variability comes from upstream input change.

**Why it's debt**: if upstream stops changing (bug or reuse), wrangle silently produces identical output every iteration. Hidden coupling.

**Refactor**: `seed = ch("seed") + ch("iteration")`. Variability now explicitly in the seed.

## Debt 10: 1-D variability dimension (no "age" axis)

**Symptom**: project supports "different houses" via seed, but all houses are "new". No way to do "weathered version of same house".

**Spot it**: ask "is there a parameter for time-evolution / damage / wear?" If not, asset is 1-D.

**Why it's debt**: artists can't make "same house, abandoned 50 years" variations.

**Refactor**: add post-deformation `weathering` subnet that takes an `age` parameter and applies stochastic damage (cracks, missing tiles, color desaturation). Doesn't change structure, just appearance.

## How to use this checklist

When reviewing a project:
1. Run through all 10 debts on a quick pass — mark which apply.
2. Score severity (frequency × impact) for each.
3. Triage: fix top 3 first, file the rest as "tech debt backlog".
4. Re-score after each fix to track improvement.

This converts "I feel this code is rough" into a measurable backlog.

## Quantifying total debt

Optional: compute a single "tech debt score":
```
score = Σ (debts_present × severity_weight)
```

Weights (suggested):
- Silent failure debts (#2, #8): 5
- Coupling debts (#5, #9): 4
- Maintenance debts (#1, #3, #4, #7): 3
- Feature gap debts (#10): 2
- Style debts (#6): 1

Lake House would score roughly: 1+2+3+4+5+6+7+8 ≈ 30 (high). A clean refactor target would be < 10.
