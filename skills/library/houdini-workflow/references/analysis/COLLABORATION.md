> Source: user-supplied Houdini-Design-Skills-20260910.zip. Historical examples and corpus counts are source observations, not validation of the current task. Apply the entrypoint scope, actual application capabilities and delivery requirements before these recipes.

# Collaboration Analysis: 6 Layers from Cross-Wrangle to Cross-Project

Procedural modeling "collaboration" isn't just team coordination. It's a 6-layer stack where each layer is a different view of the same project DAG.

```
┌─────────────────────────────────────────────────────────────────┐
│ L6 Cross-project   How can this asset's logic be reused?       │
├─────────────────────────────────────────────────────────────────┤
│ L5 Cross-tool      How does Houdini → Unreal/Unity export?     │
├─────────────────────────────────────────────────────────────────┤
│ L4 Cross-person    How are tasks split: artist / TD / coder?   │
├─────────────────────────────────────────────────────────────────┤
│ L3 Cross-subnet    Service nodes + bus contracts               │
├─────────────────────────────────────────────────────────────────┤
│ L2 Cross-node      Schema contracts (which attribs in/out)     │
├─────────────────────────────────────────────────────────────────┤
│ L1 Cross-wrangle   Protocol attributes vs geometric attributes │
└─────────────────────────────────────────────────────────────────┘
```

For each layer: math model + Lake House evidence + concrete debt + how to score.

## L1: Cross-wrangle — attribute as protocol

**Math model**: each wrangle is `f: (G_geo, G_attr) → (G_geo', G_attr')`. Composition is function composition. Protocol attributes are side-channels.

**Lake House evidence**: `i@stop`, `i@keep`, `i@convert`, `i@raypoint` are written by one wrangle and read by a different one downstream — pure inter-wrangle messages, NOT geometry.

**Algorithm view**: this is "liveness analysis" from compilers. A protocol attribute should be:
- DEFINED by exactly one writer
- USED by 1+ readers
- KILLED (cleaned up) after the last reader

**The debt**: Lake House never kills protocol attributes. Final geometry carries ~30 attributes per prim, ~2/3 dead. Memory waste = O(N × |dead_protocol_attrs|).

**Score: protocol leakage rate** = `dead protocol attrs / total attrs`. Healthy: <10%. Lake House: ~60%.

**Refactor**: convention `_p_xxx` for protocol attributes; `attribcleanup` at every subnet output.

## L2: Cross-node — schema contracts

**Math model**: each subnet has type `(Pre_attrs, Post_attrs)` where `Pre = required input attribs`, `Post = guaranteed output attribs`. Composition correct iff `Pre(B) ⊆ Post(A)`.

This is **structural typing** (not nominal). Subnets are functions over attribute schemas; schemas form a lattice ordered by ⊆.

**Lake House evidence**: the implicit `(s@name, s@variation, v@scale, @N, @up)` quintuple is the contract every `*_modules` subnet expects. Any module subnet missing one of these silently fails (wrong orientation, wrong scale, no module loaded).

**The debt**: schema is **implicit**. New collaborator must read all VEX to know "what attribs are required where". No `schema.md`, no validation.

**Score: schema implicitness** = `undocumented contracts / total contracts`. Healthy: <20%. Lake House: 100%.

**Refactor**:
- For each subnet, write a comment block declaring `Pre / Post`.
- Add `attribcreate` at subnet entry to default-init missing `Pre` attributes (with sentinel value), so missing-attrib bugs surface immediately.

## L3: Cross-subnet — service nodes + dependency depth

**Math model**: subnet-level DAG `D = (V_sub, E_sub)`.
- **Service node** = vertex with in-degree ≥ 2 (consumed by multiple).
- **Dependency depth** of an edge: 0 = points to subnet itself; 1 = points to subnet's IN/OUT/PUB_; ≥2 = points to internal node (white-box).

**Lake House evidence**: 5 service nodes, 18 cross-subnet edges, ~30% are white-box (depth ≥ 2). The most painful one is `arch → column/keep_touching_walls` — column can't refactor internals without breaking arch.

**Algorithm view**:
- PageRank / centrality identifies architectural keystones
- Min-cut / Louvain community detection suggests team boundaries
- White-to-black refactoring reduces effective coupling

**The debt**: service nodes exist but aren't named as such; white-box dependencies create fragile architecture.

**Score: white-box ratio** = `edges with depth≥2 / total cross-subnet edges`. Healthy: 0%. Lake House: ~30%.

**Refactor**:
1. Create `services/` subnet at top level (or PUB_xxx prefix convention).
2. Move/rename 5 service nodes there.
3. Update all `object_merge.objpath1` to point at new locations.

## L4: Cross-person — Conway's Law applied

**Math model**: Conway's Law (1968) — system architecture mirrors team communication structure. Formally:
```
isomorphism(team_communication_graph) ≅ isomorphism(code_dependency_graph)
```

Reverse application: design `code_dependency_graph` to **enforce** desired team boundaries.

**Algorithm view**: balanced graph partitioning (NP-hard, approximated via Metis / Louvain).

**Lake House evidence**: solo project — Conway's Law trivially satisfied (1 person → no boundaries). But if scaled to 3 devs:
- Devs A: Create_body_base + init_attributes + body_attribs (15 subnets, high cohesion)
- Devs B: roof_base + body_modules + roof_modules (12 subnets)
- Devs C: support + stairs + tower + pier + setdressing + deformation (the rest)

Cross-team edges ≈ 6 / 50 = 12% — acceptable.

**Special case**: `setdressing` consumes from 5 subnets — **inherently** crosses any team boundary. Conclusion: setdressing should be owned by an individual contributor, not assigned to a team.

**Score: cross-team coupling** = `cross-team edges / total edges`. Healthy: <15%. Compute via Louvain on D.

## L5: Cross-tool — functorial export

**Math model**: each DCC tool is a category. Pipeline export = a functor `F: C_houdini → C_unreal`. Some functors are **forgetful** (lossy).

**Algorithm view**: find the maximum lossless subgraph `G' ⊆ G_houdini` such that `F | G'` is structure-preserving.

**Lake House evidence**: project is Houdini-internal only. If exported to Unreal:
- 5-stage architecture is tool-portable (reimplementable in Unreal PCG)
- VEX is tool-specific (not portable)
- `s@type` strings might be lost (FBX has poor string-attrib support)

**The debt**: no consideration of cross-tool path. Asset is locked to Houdini.

**Score: portable subset ratio** = `tool-portable nodes / total nodes`. Healthy: >60% (algorithm portable, just impl tool-specific). Lake House: ~40% (the 5-stage pipeline is portable; everything else is Houdini-bound).

**Refactor**: identify which subnets implement portable algorithms vs Houdini-specific tricks. Document the algorithm in a `algorithm.md` so it can be re-implemented in any tool.

## L6: Cross-project — framework parameterization

**Math model**: any procedural asset is an instantiation of a parameterized template:
```
ProceduralAsset⟨V, S, M, P, D⟩
  V ∈ {DLA, L-system, Voronoi, CellularAutomata, Manual}
  S ∈ {NormalBased, PositionBased, GraphBased, Hybrid}
  M ∈ {CopyToPoints, Instancing, Stamp}
  P ∈ {DivideAndExtrude, NoiseDisplacement, MaterialOnly}
  D ∈ {LatticeMountain, FFD, BendTwist, None}
```

5⁵ = 3125 combinations; ~50 are meaningful. The framework's **strategy coverage** = meaningful_combinations / total_combinations.

**Lake House** = `⟨DLA, NormalBased, CopyToPoints, DivideAndExtrude, LatticeMountain⟩`.

**The debt**: 5-stage architecture exists in the project but isn't extracted as a reusable template/HDA.

**Score: framework abstraction** = `parameterized stages / total decisions`. Healthy: >80%. Lake House: 0% (everything hardcoded).

**Refactor**: extract the 5-stage skeleton as a framework. Each stage has a `strategy` slot that can be swapped for a different concrete implementation. New asset types = new strategy combinations.

## The 6-layer scorecard (architecture maturity dashboard)

| Layer | Metric | Healthy | Lake House |
|-------|--------|---------|------------|
| L1 | protocol leakage rate | <10% | ~60% |
| L2 | schema implicitness | <20% | 100% |
| L3 | white-box ratio | 0% | ~30% |
| L4 | cross-team coupling | <15% | (n/a — solo) |
| L5 | portable subset ratio | >60% | ~40% |
| L6 | framework abstraction | >80% | 0% |

Scoring a project on these 6 metrics converts "I feel this is messy" into "L3 white-box is 30% over the 0% target — here's the refactor to fix it."

## Recommended order to fix debts

When you have time to refactor:

1. **L4 first** if team — it sets the boundaries for everything else
2. **L1 next** — quick win, immediate memory saving, easier debugging
3. **L3 next** — biggest architectural payoff, enables L5 and L6
4. **L5 / L6** later — only relevant once L3 is clean
5. **L2** opportunistic — write `schema.md` as you touch each subnet

## Lake House's "teaching limit"

The Lake House project is excellent for learning L1-L3 (tactics). It teaches you nothing about L4-L6 because it's a solo Houdini-only project with no framework abstraction. To master L4-L6, study other resources:

- L4: SideFX Game Tools repository (multi-author HDA library)
- L5: Houdini Engine for Unreal samples
- L6: Epic's PCG samples / SideFX Labs

This skill's methodology applies to all of them — only the source material changes.
