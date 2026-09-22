# Quality Control Checklist

Score each item pass / revise. A final deliverable needs all critical items to pass.

## Critical

- Subject identity, silhouette, facial landmarks, product geometry, or architecture remain stable.
- Texture stays inside the declared mask and visibly follows the form or layout.
- Growth is continuous: seed, travel, peak, hold, and reset are all observable.
- Camera and lighting remain locked unless a measured move is specified.
- Typography and logos remain readable, or are explicitly deferred to compositing.

## Visual

- Texture reference is recognizable through palette, motif, scale, and edge behavior.
- Growth has a clear focal point and does not cover the whole frame without intent.
- Occlusion is coherent at folds, edges, and overlaps.
- Peak frame has enough contrast and negative space for poster copy.
- Variants differ by one controlled variable and retain the same protected zones.

## Technical

- Aspect ratio and duration match the requested platform.
- First and last frames support the stated loop strategy.
- Export plan includes a clean master, platform crops, and a text-safe frame.
- No unintended watermark, UI chrome, or reference-image borders are present.

## Minimal repair loop

1. Identify the first failing item and its timestamp.
2. Tighten the relevant mask, anchor, or timing instruction.
3. Regenerate only the affected shot or keyframe.
4. Recheck temporal continuity and the clean hold frame.
