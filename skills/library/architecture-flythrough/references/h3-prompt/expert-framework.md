# Embedded H3 Expert Framework: Architectural Flythrough

Read [the architectural prompt entry](../h3-prompt.md) first, then [core workflow](core-workflow.md), [all-purpose reference](modes-all-purpose-reference.md), and [source preservation](editing-preservation.md). This framework operates only at final video-prompt generation. It does not redesign earlier modeling, image-generation, or approval stages.

## Fixed input and mode

Use the approved Blender RGB video and exactly 3–4 styled images: second 0, 1–2 intermediate states, and the ending time. Select the actual H3 all-purpose reference mode. Image times describe visual states; they do not change the generation mode. Missing inputs return to the responsible production stage, never to an alternative mode.

Use the approved manifest's duration, FPS, aspect ratio, and camera movement. Preview dimensions are 2560×1440. Verify current endpoint capabilities at execution time rather than treating source-skill defaults as API guarantees.

## Reference fit before writing

For every real uploaded asset, record what it supplies, what it cannot supply, and whether it is sufficient for its role. RGB controls geometry, perspective, occlusion, camera motion, and timing. The image group and Bible control approved appearance. Do not assign an unobserved reference a role or invent a missing upload.

Apply [clarification routing](clarification-routing.md) only to material unresolved gaps. Reuse already confirmed choices. Sufficient references proceed directly. Insufficient references require a targeted repair or user decision about missing content; do not introduce a new routine approval.

## Build the prompt

1. Identify architectural identity, spatial, motion, style-consistency, and optional audio/text risks.
2. State a concrete visual system from the Bible, not style adjectives alone.
3. Give each landmark a stable identity and position; protect proportions and distinguishing components.
4. Describe the approved motion arc and final architectural composition. Use one `[Shot 1]` with continuous time phases unless cuts were explicitly requested.
5. Add failure controls specific to the scene: no moved/duplicated landmarks, deformed walls, drifting openings, teleportation, or unexplained lighting changes.
6. Apply [audio](audio-dialogue.md), [text/layout](text-ui-layout.md), or [architectural grammars](pattern-grammars.md) only when relevant to the user's request.

Use only these fields in the submitted prompt, with Chinese prose by default and English field names:

```text
subject_definitions:
...

summary: ...

retention_analysis: ...

detailed_description: [Shot 1] ...

overall_soundscape: ...

non_diegetic_music: ...
```

Define each asset once and reference it again where it matters in the timeline. Use “second X” state labels. Keep source motion and structure while allowing the approved visual transformation; do not lock incompatible CG lighting or materials. End at the approved camera composition. Do not add typography, branding, dialogue, packaging, or a new ending unless requested.

## Self-check and handoff

Check that every real asset is mapped, source times agree with the manifest, constraints do not conflict, and image versions match B. Ensure actual endpoint mode, complete six fields, valid times, and no unresolved template variables. Distinguish environmental sound from music; omit extra music when not requested. Save the prompt and its hash, then return to the existing H3 gate and one-generation rule. Prompt QA never replaces output-video QA.
