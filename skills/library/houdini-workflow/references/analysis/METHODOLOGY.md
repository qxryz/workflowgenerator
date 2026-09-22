> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Methodology: Architect-Level Layer-by-Layer Walkthrough

## The core method

For each "layer" (a node, wrangle, or sub-network), produce 4 sections:

### Section 1: Topology view (what's around it)

```
[upstream node]
    │ (what flows in)
    ▼
[the layer being analyzed]
    │ (what flows out)
    ▼
[downstream node]
```

Always include:
- ASCII topology snippet from `00_topology.txt`
- Inputs by index (`<- [0]X, [1]Y`)
- Where the output is consumed (grep for the node name in topology)

If the wrangle has 2+ inputs, list what each input represents — this is often the most underdocumented thing.

### Section 2: Functional contract

> **「Input: X. Output: Y. Side-channel: Z.」**

One-sentence statement of capability. If you cannot write this in one sentence, the layer is doing too many things — that itself is a finding.

### Section 3: What's implemented (with WHY for each decision)

Table format works best:

| Decision | Node/code chosen | Why this and not alternatives |
|----------|-----------------|-------------------------------|
| ... | ... | ... |

Each row is a **design decision the author made**, not a code description. Examples:
- "Used VDB instead of polybool" → because polybool fails on coplanar/touching geometry
- "Two-tier sampling (top/bottom buckets) instead of continuous weight" → simplest gravity bias

### Section 4: What's deliberately NOT done + what's missing

Two sub-tables:

**Pushed downstream** (intentional): which layer takes responsibility instead.

**Completely missing** (gap): list 2-5 capability gaps. For each:
- The current behavior + concrete failure mode
- A specific refactor sketch (where in the topology to add the fix, what attribute to write, what wrangle to insert)

This converts "vague concerns" into actionable backlog items.

### Section 5 (optional): Architectural takeaway

One paragraph elevating the specific finding to a portable principle. Not every layer needs this — only when the layer demonstrates a transferable pattern.

## Layer ordering

Walk the project in **execution order** (data flow), not in topology display order. Concretely for a typical Houdini procedural building:

```
1. Volume generation       (scatter/grid/quantize/fuse/density)
2. Stochastic accretion    (DLA-style for-loop)
3. Boolean union           (VDB)
4. Derived data            (footprint, edges, connectivity)
5. Semantic init           (s@type assignment) ← THE PIVOT POINT
6. Semantic refinement     (window/door/special-purpose subdivision)
7. Module dispatch         (s@name → .obj path)
8. Per-module subnets      (window/roof/stair/support/...)
9. Decoration / setdressing
10. Final deformation      (lattice + noise)
```

Layer 5 is the watershed — everything before is geometry-only, everything after is semantics-driven. Spending extra time on layer 5 (often a single 30-line wrangle) pays off most because it drives 100+ downstream wrangles.

## Auto-continue rule

When user says "继续" / "go on" / "next layer", **just pick the most natural next layer and start writing**. Do not ask "which one would you like?" — the user has explicitly opted out of being prompted.

Stop only when:
- Two non-overlapping major branches are equally valid (e.g., "should I cover roof or walls next?")
- A destructive action is needed (e.g., creating new files outside the analysis folder)
- The user explicitly asks a question

## Style discipline

- Use **the 4 sections above** as scaffolding, not as headings the user must see — use h3/h4 freely
- Tables > prose for "decisions" and "gaps"
- ASCII diagrams > screenshots (this is text-only environment)
- Prefer **markdown links** to the source artifacts (``01_all_wrangles.md` (the report generated for the current project)`) so user can click through
- Anchor abstract claims to specific line numbers or node paths from the artifacts
- Avoid emojis unless user requests
- Output language matches user's input language (Chinese in → Chinese out, English in → English out)

## When the project is NOT Houdini

The methodology transfers to any DCC procedural project (Blender Geometry Nodes, Unreal PCG, Substance Designer, custom code):

- "Topology view" → the node graph or call graph
- "Wrangle algorithm" → the function being called or implemented
- "Loop block patterns" → for-loops, recursion, fixed-point iteration
- "Cross-subnet bus" → shared data structures, observer patterns, dependency injection
- "Semantic init" → type/tag/role assignment that downstream branches on

Adapt the bundled scripts as needed — they only work for `.hip` cpio archives, but the analysis framework is tool-independent.
