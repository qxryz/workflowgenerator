# Generation Failure and Drift Fallback Policy (Audio-Mode Aware)

## Failure taxonomy

A clip may fail to render, drift from spatial anchors, lose character identity, assign speech to the wrong character, or violate a mouth-state constraint. First classify the cause; do not repeatedly submit the same unchanged request.

## Common fallback ladder

1. Retry once with the exact reference-anchor block, shorter wording, and the relevant audio-mode or mouth-state constraint strengthened.
2. If the cause is duration, motion density, or reference overload, shorten the clip to a supported duration, split the row, remove a nonessential prop, or simplify the action; re-run the shot-table self-check.
3. If the user explicitly selected another model and the failure is model-specific, perform one capability re-check and follow the user's choice when supported. Otherwise explain the capability gap and let the user choose another compatible model; do not switch silently or keep retrying the failing model.
4. After the second failed attempt for the same cause, pause with a choice card: simplify the request, split the shot, supply a reference asset, or skip the shot with a documented placeholder.

The default route remains MiniMax-H3. An explicitly selected other model is an execution choice, never a required or preferred model. Do not preconfigure a named alternative or add a named alternative to option cards.

## Audio and mouth-state fallback

- Narration row: strengthen the narration lock and list every on-screen character whose mouth must remain closed.
- Dialogue row: keep one speaker per shot, bind the speaker's character reference, and keep every non-speaker mouth closed.
- Mixed row: split narration and dialogue into separate rows when the per-second map is unstable.
- Silent row: keep all mouths closed and simplify only the visual action if drift persists.

If the selected model cannot satisfy the requested audio or face-binding behavior, report the capability gap and offer a compatible model or a post-production audio route. Do not silently change the user's model choice.

## After all clips

Do not pass a clip with identity drift, spatial drift, wrong speaker, or mouth-state failure into assembly. Use the latest approved clip only, record any model switch in the project brief, and re-run the matching QC gate.
