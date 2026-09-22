# Script / Prompt / Narration Contract v2.0

This contract prevents prompt drift and narration paraphrase. The approved script manifest is the only source of spoken text.

## Canonical line record

```yaml
script_line_id: "S03-N02"
channel: "narration"
source_text: "那一刻，我终于看清了龙椅后面的人。"
approved_version: 1
source_hash: "sha256:..."
```

`source_text` is immutable after approval. A punctuation, number, name, particle, tense, or word change is a content change and requires a new version plus user approval.

## Shot prompt record

```yaml
shot_id: "03"
script_line_ids: ["S03-N02"]
narration_text: "那一刻，我终于看清了龙椅后面的人。"
dialogue_line_ids: []
referenced_asset_ids: ["char_protagonist", "char_opponent", "scene_throne_room"]
spatial_layout_hash: "sha256:..."
script_manifest_sha256: "sha256:..."
shot_manifest_sha256: "sha256:..."
prompt_text: "...generated mechanically..."
```

The prompt builder must interpolate the exact approved text and IDs. It may add camera, action, spatial, style, and asset-binding instructions, but may not summarize, reorder, or invent story events. Narration text is metadata for the audio pipeline and must not be presented to H3 as character dialogue.

For H3 shots with dialogue, the prompt must include the audio constraint `dialogue-only; no narrator, voiceover, commentary, or descriptive speech`. This constraint is checked in the submitted payload and does not replace post-generation audio validation.

## Preflight and postflight

1. Before H3 or TTS submission, display the line IDs, exact source text, asset IDs, spatial layout, hashes, and rendered prompt for confirmation.
2. Reject any record with a missing line ID, hash mismatch, text mismatch, unbound visible character, or missing asset.
3. After submission, compare the request payload and provider log to the record. Store the exact payload hash.
4. For narration, force-align the master and each slice to `source_text`. Any omission, insertion, substitution, or reordering invalidates the entire batch.
5. For the narration handoff package, verify narration timing sources, narration audio, and shot manifest all reference the same `script_line_id` and source hash. Final subtitle placement and video assembly are user-owned.

## Repair rule

Do not repair a mismatch by silently editing the prompt or speeding up TTS. Return to the approved script / shot record, issue a proposed change, obtain approval, increment the version, and regenerate the affected narration batch or shot.
