# Assembly, Final Review, and Asset Discipline (v1.1 — Audio-Mode Aware)

## STEP 8: Full Film Assembly, BGM Match, and Final Output

After all single-shot clips are approved, concatenate them in table order into the complete main video. Then generate one continuous BGM track that matches the story mood and embed it into the assembled video.

Assembly and BGM rules:

- Preserve the exact shot order from the approved table.
- Match BGM to the assembled video's actual pacing, emotional arc, comedy beats, chase rhythm, and ending tone.
- Duck BGM under dialogue, non-language reactions, narration, and important SFX.
- Preserve existing clip audio and SFX unless the user asks to replace them.
- Do not generate BGM per shot.
- Do not add subtitles or text unless the user explicitly asks.
- Output the final video with clean animation visuals and no storyboard traces, including no `[char:…] [scene:…] [shot:…] [audio_mode:…] [speaker:…]` labels.

**v1.1.1 audio-mode-aware assembly**: the two primary modes for 3D animation are `silent` and `dialogue-led`; `narration-led` is a rare opt-in.

- For `silent` projects (the most common 3D animation mode), no voice bus is needed; the final mix is BGM + SFX only. Lip-sync risk is zero by construction.
- For `dialogue-led` projects, verify the dialogue bus is consistent and the speaker is identifiable per shot. The QC hard gate below will catch mis-binding. This is the most common lip-sync-risk case in 3D animation.
- For `narration-led` projects (rare in 3D animation), the narration is mixed in by H3 (when H3 is the chosen model) or comes in via the per-shot audio. Verify the narration mix is consistent across the assembled film; if any shot's narration is too loud or too quiet, normalize the narration bus to -3dB below the dialogue bus and duck under SFX.

Then show a user choice card:

- Approve final film (recommended)
- Regenerate BGM
- Adjust BGM mix
- Re-render selected clip
- **v1.1: re-mix narration bus (narration-led projects only)**

## STEP 9: Final Review (v1.1 = 12 hard checks, was 10)

Create a short final review text node if the user asks for diagnosis or if there are visible risks.

**v1.1 change**: the QC checklist expands from 10 checks to 12. The two new checks (`Speaker identity correctness` and `Mouth-state consistency`) are the lip-sync safety net. Both are hard gates — failing either blocks final delivery.

**v1.1 hard-gate checks (NEW — any failure blocks delivery)**:

- **Check 11: Speaker identity correctness** — for every `dialogue` and `mixed` row in the assembled film, the character whose mouth is moving during the dialogue second must be the named `SPEAKER` from the storyboard. A wrong-character mouth is an instant fail. To verify: for each dialogue row, sample 2-3 dialogue seconds; check the moving mouth belongs to the speaker. If any row fails, send it back to Step 7 with the v1.1 character-confusion ladder. **This is the single most important QC check in v1.1.**

- **Check 12: Mouth-state consistency** — for every second of every row, the on-screen mouth state matches the row's `Mouth State` from the storyboard:
  - `narration` rows: every on-screen character's mouth is closed for every second.
  - `dialogue` and `mixed` rows: only the named speaker's mouth is open during their dialogue seconds; every other on-screen character's mouth is closed for every second.
  - `silent` rows: every on-screen character's mouth is closed for every second.
  If any row fails, send it back to Step 7 with the v1.1 mouth-state violation ladder.

**Standard v1.0 checks (kept, reordered)**:

1. Character consistency — face, hair, costume, body proportions match the character cards.
2. Scene continuity (verify against the `Reference Anchors` column — did every landmark land where the table said it would?).
3. Emotional anchor payoff — the ending reuses an earlier emotional anchor.
4. Shot purpose clarity — every shot has a clear narrative job.
5. Dialogue intelligibility — when audio is present, the dialogue is audible and the speaker is identifiable (now supplemented by Check 11).
6. Foley/SFX sync (against the `Audio & Dialogue Track` column).
7. BGM balance — BGM ducks under dialogue, narration, and SFX.
8. No storyboard artifacts in final video: no panel borders, sketch lines, arrows, labels, handwritten notes, timing marks, pose ghosts, storyboard text, AND no double-binding labels (`[char:…]`, `[scene:…]`, `[shot:…]`, `[dur:…]`, `[hook:…]`, `[audio_mode:…]`, `[speaker:…]`).
9. Missing or weak clips — any clip marked `placeholder: ...` is documented.
10. Any asset that may need regeneration.

**v1.1.1 audio-mode-specific checks (corrected priority)**: in addition to the 12 above.

- For `silent` projects (the most common 3D animation mode): verify no on-screen mouth movement and no dialogue/narration audio; if present, it contradicts the Step 0 choice.
- For `dialogue-led` projects (the other primary 3D animation mode): verify that every dialogue beat has a paired reaction shot within 1-2 shots; if not, the shot table needs revision.
- For `narration-led` projects (rare in 3D animation): verify that the total narration duration is between 50% and 70% of total runtime (the 60% target with ±10% tolerance); if outside the band, the audio-spine map from Step 2 needs to be revised.

## Canvas Ordering and Grouping Discipline

Whenever a durable artifact is created, organize it immediately in the sequence defined in Step 0. Do not duplicate outputs.

Group every production section in the project:

- Group project brief and story outline as `<title> story planning` when both exist.
- Group character cards as `<title> character cards`.
- Group scene cards as `<title> scene cards`.
- Group the standardized shot table as `<title> shot table`.
- Group the text storyboards document as `<title> text storyboards` (default mode, one document). Extracted standalone text storyboard nodes and pencil storyboards (visualization mode) are separate groups: `<title> extracted text storyboards` and `<title> multi-panel pencil storyboards`. Keep all storyboard groups separate from rendered clips because storyboards contain double-binding labels, shot numbers, camera icons, arrows, and sketch lines.
- Keep storyboard groups separate from rendered clips because storyboards contain double-binding labels, shot numbers, camera icons, arrows, and sketch lines.
- Group single-shot video clips as `<title> shot clips`; the label must not hard-code a particular video model because the user may explicitly choose another compatible model.
- Group assembled main video, matched BGM, and final composited video as `<title> final delivery` when they exist.

If a generation round produces two or more outputs, group them immediately with a clear title before continuing to the next costly stage.

**v1.1.1 audio groups**: add audio groups only when the audio mode requires them.

- For `dialogue-led` projects, add a `dialogue bus` group node named `<title> dialogue audio` to track the per-shot dialogue assets.
- For `narration-led` projects (rare in 3D animation), add a `narration bus` group node named `<title> narration audio` to track the per-shot VO assets.
- For `silent` projects (the most common 3D animation mode), neither bus is needed.

These groups are referenced by the audio-mode-specific checks above.

## User Choice Card Discipline

Use a choice card for every place that requires user confirmation. Do not replace these confirmations with plain chat questions or prose. Required choice-card gates:

- Immediately after intake, before any next step, to choose screen size / aspect ratio
- Immediately after intake, before any next step, to choose total duration
- **v1.1: Immediately after intake, before any next step, to choose audio mode (narration-led / dialogue-led / silent)**
- After project brief (and after the audio-spine summary)
- After story outline (and after the audio-spine map)
- After character cards (and after the `speaks_on_screen` flags)
- After scene cards
- After standardized shot table (gate 1: approve table before self-check)
- After shot-table self-check passes (gate 2: approve self-check, then immediately choose storyboard mode: text only / text + pencil image)
- After single-shot storyboards (text storyboards document by default with optional extracted standalone nodes; pencil images if the user opted in)
- Before single-shot video-clip rendering, confirm the default MiniMax-H3 route or capability-check a model explicitly selected by the user
- Before single-shot video-clip rendering, to choose video resolution
- After single-shot video clips (now including a "Speaker identity verified" gate)
- After full-film assembly, BGM match, and final composite (now including the 12 hard checks, with speaker-identity and mouth-state as the gating pair)

Default recommended option should be first. Always allow custom user input. If the user says "continue," treat it as choosing the recommended option.

## Regeneration and Latest-Asset Discipline

When the user regenerates or revises any artifact, all downstream steps must use the newest approved artifact, not the older one.

Rules:

- If a character card is regenerated, future shot tables, the text storyboards document (plus any extracted standalone text storyboard nodes), pencil storyboards (if visualization mode is on), single-shot video clips, assembled videos, and final composites must reference the regenerated labeled character card by exact character name. **v1.1: if the regenerated character has a different `speaks_on_screen` flag, every dialogue / mixed row referencing that character must be re-checked for speaker-binding.**
- If a scene card is regenerated, future shot tables, the text storyboards document (plus any extracted standalone text storyboard nodes), pencil storyboards (if visualization mode is on), single-shot video clips, assembled videos, and final composites must reference the regenerated scene card by exact scene name.
- If the shot table is revised, future text storyboards document (or extracted nodes), single-shot video clips, and assembly must use the revised table. The self-check in Step 5.5 must be re-run before storyboarding resumes. **v1.1: if the audio mode is changed in Step 0 after the shot table is built, the table must be revised to match the new audio mode distribution target and the self-check must re-run.**
- If a section in the text storyboards document is revised, the matching single-shot video clip must use the revised section. If that section has been extracted to a standalone node, that node is the source of truth; otherwise the document section is. **v1.1: if a section's `Mouth State` quadrant is revised, the matching clip must be re-rendered and re-checked by the v1.1 mouth-state ladder.**
- If a standalone extracted text storyboard is revised, after the user is satisfied, re-integrate it back into the text storyboards document (replace the placeholder with the latest content) and archive the standalone node.
- In visualization mode, if a pencil storyboard is redrawn, the matching video clip is still bound to the text storyboards document (or extracted node); the pencil image is human-review-only and may be redrawn without forcing a video re-render.
- If a single-shot video clip is re-rendered, assembly, BGM matching, and final composite must use the new clip. If the user explicitly changes the model, record the new model in the Project Brief and re-check per-shot capability and prompt rules. **v1.1: if a clip is re-rendered for any lip-sync reason, the v1.1 character-confusion or mouth-state ladder applies, and the matching QC hard gate (Check 11 or 12) must re-run before assembly.**
- If BGM is regenerated, the final composite must use the regenerated BGM.

After any regeneration:

1. Mark the regenerated artifact as the current approved version in the next text output or reply.
2. Prefer the regenerated file path / node over previous versions in all subsequent prompts.
3. If there are multiple versions, identify the chosen current version by filename or artifact name before continuing.
4. Do not silently mix old and new assets in final assembly.
