# Visual State Ledger Template

Use this ledger to keep continuity stable across a 2D half-narrated short drama. Every entry must be **2D cel + webtoon** language — no 3D, no photoreal, no live-action drift.

## Per-shot ledger fields

- Shot ID
- Character pose and position
- Screen-space position (left / center / right)
- Depth layer (foreground / midground / background)
- Facing direction and eyeline target
- 180-degree axis and entry / exit direction
- Character expression
- Prop state and orientation
- Scene layout
- Lighting direction
- Time of day
- Background motion
- Emotional state
- **Style check** (one-line confirmation that the shot stays within the locked sub-mode)
- **First-frame anchor** (cross-reference to storyboard, kept short here)
  - `first_frame_source`: file path
  - `referenced_asset_ids`: character / scene / prop IDs used by the shot
  - `asset_bindings`: visible entity -> asset ID mapping
  - `backend`: `the platform’s currently available video capability`
  - `generation_mode`: `platform-supported reference mode`
  - `resolution`: `768P` or `2K`, selected before generation

## Secondary-character continuity gate

Every visible secondary character or extra gets its own stable character-card asset ID in `asset_manifest`. A text-only description is insufficient. The ledger must state where that character stands, which way they face, whom they look at, and whether their identity / wardrobe differs from another role. Any unbound or visually drifting secondary character blocks delivery.
  - `reset_anchor`: `true` / `false`
- What must remain unchanged
- What must change in the next shot

## Continuity rules

- Write concrete visual facts, not moods.
- Each entry must be usable as the next shot's opening state.
- Keep identity anchors separate from transient motion.
- Mark any reusable prop or scene state explicitly.
- **Style block consistency**: every shot's style check should pass the same way (e.g. "guoman-webtoon 流，粗黑描边，平面赛璐珞，强对比光影"). If one shot's style check reads differently (e.g. "smooth shading, soft light"), that's drift — fix the prompt, not the ledger.
- **Optional reference consistency**: when a shot uses `first_frame_source` or `last_frame`, the ledger path must match the storyboard and generation request. If no image reference is used, spatial layout and asset bindings remain mandatory.
- **Last-frame archive**: after the shot is generated, write down the path to `clips/shot_NN_last.png` so the next-shot ledger entry can reference it.
