# Standardized Shot Table Specification (v1.1 — Audio-Mode Aware)

## STEP 5: Standardized Shot Table Video Prompts (Seven Columns, v1.1)

After character cards and scene cards are locked, output standardized video prompts as a shot information table. This step is mandatory and cannot be swapped with storyboard or video generation. Create a project table named `standard-shot-table`.

**v1.1 change**: the table now has **seven columns** (was six). The new seventh column is **`Audio Mode`**. The existing `Audio & Dialogue Track` column is upgraded with a mandatory **`Mouth State`** field per second. These two additions are the single most important defenses against AI character-confusion lip-sync errors.

The table must have exactly seven columns in this order:

| Shot ID & Duration | Continuity Handoff | Reference Anchors (Spatial + Identity) | Hook Type | Shot Description (Per-Second Directives) | Audio & Dialogue Track (with Mouth State) | **Audio Mode (v1.1)** |
|---|---|---|---|---|---|---|

Column rules:

- **Shot ID & Duration**: shot number plus planned duration, e.g. `S03 / 6s`.
- **Continuity Handoff**: how this shot naturally continues from the previous shot's ending image, prop position, eyeline, character posture, sound bridge, or emotional state, AND how it sets up the next shot's opening. This is the cross-shot continuity spine.
- **Reference Anchors (Spatial + Identity)**: four sub-fields, all mandatory.
  - `Fixed Landmarks` — exact named landmarks from the scene card, with their screen-relative positions (e.g. `door-frame: right third`, `kitchen-island: center bottom`).
  - `Character Positions (camera view)` — for every character in the shot, screen-relative position (left/center/right, top/mid/bottom, foreground/midground/background), facing direction, and initial pose.
  - `Exited Character Status` — for any character who was in the previous shot but is not in this shot, state their off-screen position and reason (e.g. `Mia — exited frame-left, last seen holding apple basket at door-frame`).
  - `Lighting Baseline` — inherited key/fill/rim direction from the scene card, plus any per-shot modifier (e.g. `key: warm overhead, fill: cool bounce right, modifier: window-backlit silhouette`).
  - Plus identity bindings: exact approved character card names and exact approved scene card name.
  - **v1.1 add**: for `dialogue` rows, the `Character Positions` block must explicitly mark `SPEAKER` next to the on-screen speaker's row, and `non-speaker mouth: closed` for every other on-screen character.
- **Hook Type**: one short label from a controlled vocabulary, e.g. `visual-joke`, `reversal`, `suspense`, `tender`, `chase`, `reveal`, `callback`, `expression-beat`. Used for the per-episode hook distribution self-check.
- **Shot Description**: shot size, camera movement, Dutch-angle design, performance style, SFX, negative prompt, **video-model generation notes** (use the model selected after capability checking; keep prompt structure, camera, packaging, text/UI, and performance details matched to that model), and a required `Per-Second Directives` subsection. The subsection must break the shot into second-by-second instructions such as `0–1s`, `1–2s`, `2–3s`; for sub-second critical beats, use `2.0–2.5s` style markers. Each per-second directive MUST cover all **six** required elements (v1.1 adds element 6):
  1. Action / pose / expression (squash-and-stretch, anticipation, overshoot, follow-through where applicable)
  2. Camera movement (push / pull / pan / tilt / handheld-shake / locked / orbit)
  3. Spatial position (where the character is, what they hold, what landmark is in frame)
  4. Audio cue (narration / dialogue / SFX / breath / silence — or `silent` if intentional)
  5. Handoff to the next second or next shot (what state this second locks in for the next one)
  6. **v1.1: Mouth State** — for every on-screen character, mark `mouth: open/closed` and which character is the speaker this second (e.g. `mouth: Mia open (speaking), Grandma closed (listening)`). For narration seconds, every on-screen character's mouth must be `closed` and the on-screen speaker (if any) is by definition listening, not talking.
- **Audio & Dialogue Track** (v1.1 upgraded): full audio script for the shot in time order, separate from per-second cues. Fields:
  - `Narration` — voiceover text with time range (omit if no narration; mandatory when row's Audio Mode is `narration`).
  - `Dialogue` — line, speaker, tone, time range. The `speaker` field must use the **exact approved character name** from the character card.
  - `SFX` — keyed sound effects, time-anchored.
  - `Performance Note`:
    - **v1.1: `narrator-mouth-closed: true`** — mandatory for any second covered by `Narration`. The narrator is by definition off-screen; on-screen characters must keep their mouths closed during those seconds, with only expression changes (brows, eyes, jaw tension) to mirror the narration.
    - **v1.1: `expression-path`** — for every narration second, list the on-screen character's expression beat (e.g. `0–1s: brows relax, eyes drift; 1–2s: brows knit, jaw tightens; 2–3s: lips press, gaze drops`). This is the visual half of the audio pairing and prevents the on-screen character from looking dead during voiceover.
    - For on-screen dialogue seconds, list each dialogue line with `eye-line` and `body-action` changes (already in v1.0, kept in v1.1).
    - **v1.1: `speaker-binding`** — for dialogue seconds, explicitly state which character card is the speaker this second; the video model uses this for prompt-side binding.
- **Audio Mode (v1.1 NEW)**: one of four values per row, chosen from a controlled vocabulary:
  - `narration` — voiceover carries the shot; on-screen mouths stay closed.
  - `dialogue` — on-screen characters speak; single-speaker rule and reaction-cut pattern apply.
  - `mixed` — both narration and on-screen dialogue appear in this shot (rare; usually means a hero dialogue beat with opening/closing voiceover; treat as `dialogue` for prompt shaping and add a `mixed-segment` note).
  - `silent` — no narration and no dialogue; only SFX and ambient audio.

Table-wide rules:

- Each shot must naturally inherit the previous shot's image state through the `Continuity Handoff` column and set up the next shot in the same column.
- Each shot row must include per-second directives that cover the entire shot duration from first frame to last frame, including action, pose, expression, camera movement, spatial position, sound cue, **mouth state (v1.1)**, and continuity handoff.
- Per-second directives must be specific enough to generate storyboard panels directly; avoid vague timing such as "continues moving" without body, camera, or prop detail.
- Performance must be exaggerated and elastic, matching Disney-style squash-and-stretch, anticipation, overshoot, follow-through, overlap, arcs, fast pose changes, and clear comedic silhouettes.
- Shot sizes must alternate close-up / extreme close-up with other necessary framing; avoid repetitive framing.
- Dutch-angle tilted compositions must be designed into chase, imbalance, surprise, or slapstick beats.
- Dialogue language only if explicitly requested by the user; otherwise use minimal non-language-specific reactions or mark dialogue as optional / pending confirmation.
- For shots containing narration or dialogue, every second where the character is speaking must record whether the mouth is open or closed; the default is closed for off-screen narrator, open for on-screen dialogue. **v1.1 makes this mandatory, not optional.**
- A character who left the frame must still be tracked in `Exited Character Status` for at least one shot, then dropped after they are explicitly off-stage for two consecutive shots.

### v1.1 Lip-sync safety rules (apply to all rows regardless of audio mode)

These are the core defenses against character-confusion. Violating any of them is a hard fail in the self-check.

1. **Single-speaker rule for dialogue rows**: every row with `Audio Mode = dialogue` or `mixed` may have **at most one on-screen character with their mouth open at any given second**. If two characters need to talk in the same beat, split into separate shots with a `Continuity Handoff` cut between them — do not pack them into one row.
2. **Single-speaker rule for reaction rows**: a reaction row (where no one speaks) is allowed multiple characters on screen, but their mouths must all be `closed` for the entire row.
3. **Non-speaker mouth-closed rule**: in any row with `Audio Mode = dialogue` or `mixed`, every on-screen character that is not the named speaker must keep `mouth: closed` for every second of the row. The video prompt must enforce this (see `model-selection.md`).
4. **Speaker-binding rule**: for any `dialogue` row, the `Reference Anchors > Character Positions` block must mark `SPEAKER` next to the speaker's row, and the `Audio & Dialogue Track > Performance Note > speaker-binding` field must name the speaker by exact character card name. Both are required.
5. **Reaction-cut pattern (v1.1)**: any `dialogue` row that contains a `reveal` / `reversal` / `expression-beat` hook MUST be either (a) a single-speaker close-up of the speaker, OR (b) a speaker + listener composition where the speaker is foreground/center and the listener is midground/background. Speaker-shoulder-over-listener (OTS) framing is preferred. The reverse-shot (listener reacting) is automatically a follow-up row with `Audio Mode = reaction` and `mouth: closed` for both characters — never pack the reaction into the same row as the dialogue.
6. **Narration expression-path rule**: every row with `Audio Mode = narration` must include an `expression-path` in the `Performance Note` describing the on-screen character's face beat-by-beat during the voiceover. The on-screen character is by definition not speaking; their face is the only channel for the narration's emotion.
7. **No overlapping audio in one second (v1.1)**: no per-second directive may contain both `Narration` and `Dialogue` in the same second. If the script needs overlap, push the second with lower priority (usually dialogue) by 0.3–0.5s and use the `Handoff` field to flag the cut.
8. **No cross-character voice bleed**: a `narration` second never uses any on-screen character's voice, and a `dialogue` second never uses the narrator's voice. These are different audio channels in the final mix.

### v1.1 Audio-mode distribution rules (apply across the whole table)

The audio mode chosen in Step 0 enforces a target distribution across the whole table. If the actual distribution drifts, the self-check fails.

**v1.1.1 note**: for 3D animated shorts, the **two primary modes are `silent` and `dialogue-led`**. `narration-led` is a rare opt-in. If a user picked `narration-led` without being asked, surface a confirmation card before proceeding — most 3D animation projects are better served by `silent` or `dialogue-led`, and projects that genuinely need a first-person narrator across the whole short should use the `half-narrated-short-drama` skill instead.

| Audio mode (Step 0) | `narration` rows | `dialogue` rows | `silent` rows | `mixed` rows |
|---|---|---|---|---|
| `silent` (primary, recommended default for visual 3D animation) | 0% | 0% | 100% | 0% |
| `dialogue-led` (primary, recommended when spoken conversation is needed) | ≤ 20% | ≥ 50% (suggested 60%) | ≤ 20% | ≤ 20% |
| `narration-led` (rare opt-in, use with care) | ≥ 50% (suggested 60%) | ≤ 40% (suggested 30%) | ≤ 20% (suggested 10%) | ≤ 10% |

If a user override of the suggested distribution breaks the rules, surface a choice card before continuing.

Then show a user choice card:

- Approve table and run self-check (recommended)
- Adjust shot continuity
- Make animation more exaggerated
- Adjust close-up / extreme-close-up rhythm
- Adjust Dutch-angle design
- **v1.1: re-balance audio mode distribution** (only surfaced when distribution is off-target)

## STEP 5.5: Shot Table Self-Check Gate (Mandatory, v1.1 = seven checks)

Before moving to pencil storyboards, run a hard self-check on the approved shot table. If any check fails, revise the table and re-run before asking the user to approve storyboarding.

**v1.1: the self-check has seven required checks** (was six). The new seventh check enforces the audio-mode and lip-sync safety rules.

1. **Hook density**: every shot has a `Hook Type`; at least one of every three consecutive shots uses a `reveal`/`reversal`/`callback`; the opening shot and the closing shot each carry a strong hook (`visual-joke` / `reversal` / `reveal` / `suspense` / `tender`).
2. **Single-shot duration**: no shot exceeds 15 seconds. If a beat needs more, split it.
3. **Character count per shot**: no shot contains more than three important characters (defined as characters with on-screen action or dialogue). **v1.1: for `dialogue` rows, the on-screen speaking character count is at most 1.**
4. **Spatial anchor inheritance**: for every interior scene with two or more shots, the `Fixed Landmarks` and `Lighting Baseline` of the next shot must either match the previous shot or include an explicit continuity note (e.g. `door-frame moves from right third to center as camera orbits left`).
5. **Per-second directive coverage**: every second from `0s` to the shot duration is covered by a `Per-Second Directives` entry, and each entry contains all **six** required elements (action/pose/expression, camera, spatial, audio cue, **mouth state (v1.1)**, handoff). Sub-second beats like `2.0–2.5s` are allowed but must not leave any time gap.
6. **Cross-shot continuity**: reading the `Continuity Handoff` column row by row produces a continuous chain — no shot starts from a state that contradicts the previous shot's ending. Any shot that flips eyeline, character position, prop state, or lighting must mark the flip explicitly (e.g. `HARD CUT — time skip: 2h`).
7. **v1.1 NEW: Audio mode + lip-sync safety check** — the union of all seven checks below. Any failure is a hard fail.
   - **7a. Audio Mode distribution matches Step 0 choice** (see distribution table above).
   - **7b. Every row has a valid `Audio Mode` value** from the controlled vocabulary.
   - **7c. Every row's `Mouth State` per second is consistent with its `Audio Mode`**:
     - `narration` rows: every on-screen character has `mouth: closed` for every second; the row contains an `expression-path` performance note.
     - `dialogue` and `mixed` rows: at most one on-screen character has `mouth: open` per second, and that character is the named speaker.
     - `silent` rows: every on-screen character has `mouth: closed` for every second.
   - **7d. Every `dialogue` row has `speaker-binding` set in the `Performance Note`** and the `SPEAKER` marker in `Character Positions`.
   - **7e. Every `dialogue` row with a `reveal` / `reversal` / `expression-beat` hook uses single-speaker or OTS framing**, with the reaction (if any) handled in a follow-up row.
   - **7f. No per-second directive contains both `Narration` and `Dialogue` in the same second.**
   - **7g. Narration second count is non-zero if the Step 0 audio mode is `narration-led`, and zero if the Step 0 audio mode is `silent` or `dialogue-led`.** For 3D animated shorts, narration seconds should be rare; if `narration-led` is chosen, double-check the choice before approving.

If all seven pass, place a `shot-table self-check: passed` stamp at the top of the table and show these confirmation choices:

- Approve self-check and draw shot storyboards (recommended)
- Show self-check details
- Revise failed checks
- Re-run self-check

If any check fails, do not enter Step 6. Return to Step 5, list the failed rows, and only re-show the storyboard approval card after the table is fixed and the self-check passes.
