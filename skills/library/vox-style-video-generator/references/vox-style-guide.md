# Vox Style Guide — Writing Voice & Visual Grammar

## Part 1: Writing

### The arc

Every Vox-style explainer follows the same skeleton. Do not deviate until you've mastered it:

1. **Cold open (1 beat).** A concrete, surprising fact, image, or question. Never "Today we're going to talk about..." — start inside the story. "In the seventh century, Tang China built the largest, richest city on Earth."
2. **The turn to context (1 beat).** Signal the zoom-out: "To understand how, you have to go back to..." / "But that's not the whole story." This sentence is the genre's signature move.
3. **Escalating explanation (50–70% of beats).** One throughline, developed step by step. Each beat should make the viewer feel slightly smarter than the last. Use numbers, comparisons to familiar scale ("an area the size of..."), and named specifics over categories.
4. **Complication (1–2 beats).** The tension, cost, or irony. "But all of this depended on one fragile thing..."
5. **Resolution + reframe (1–2 beats).** Land the plane by returning to the cold open with new meaning. The last line should be quotable.

### Sentence-level rules

- Present tense for historical narrative ("Merchants arrive from Persia" not "arrived")
- Second person sparingly but deliberately ("You've probably seen this painting")
- Concrete over abstract: "two million people" not "a massive population"
- Vary rhythm: follow a long sentence with a three-word one. It lands.
- Read every beat aloud (or imagine TTS reading it). If you stumble, the voice model will too.
- Numbers: write them the way they should be SPOKEN ("two million," "the year 750") — TTS handles words more reliably than digits.
- No em dashes in narration text destined for TTS if the user's style rules forbid them in written deliverables; commas and periods pace speech fine.

### Beat budgeting

| Film length | Beats | Words/beat | Total words |
|---|---|---|---|
| 45–60s | 6–8 | 25–35 | ~200 |
| 90s | 10–12 | 25–35 | ~330 |
| 3 min | 16–22 | 30–40 | ~650 |

Speaking rate ≈ 150 wpm at documentary pace. Trust these budgets; overwritten scripts are the #1 cause of rushed, cramped films.

## Part 2: Visual Grammar

The Vox look is **mixed-media editorial collage**. It reads as designed, not generated. Its components:

### Core elements

- **Paper cutouts.** Subjects (people, buildings, objects) rendered as illustrated or archival-photo cutouts with visible white borders (3–6px sticker edge) and soft drop shadows, arranged in shallow layered depth.
- **Textured background.** Aged cream/off-white paper, subtle grain, sometimes a solid saturated field (the Tang example uses vermillion red) as the outer frame with the collage on a paper panel inside it.
- **Halftone dots.** Screen-print dot patterns as accent fills or shadows — the signature print-media tell.
- **Tape and pins.** Washi-tape strips at panel corners, as if pinned to a board.
- **Flat geometric accents.** A triangle, circle, or dot in the accent color, placed asymmetrically. One or two per frame maximum.
- **Limited palette.** Cream base + ink/charcoal + ONE accent color carried through every frame. Set it in `script.json` and never let it drift.
- **Editorial typography.** Bold condensed sans (or a culturally appropriate display face) for on-frame titles; small caps labels; a "stamp" or seal motif works well for historical topics.

### What it is NOT

Photorealism, 3D renders, gradient meshes, glossy lighting, anime, watercolor washes without structure. If a frame could be a movie still, it's wrong. If it could be a magazine spread, it's right.

### The style suffix

Append this (adapted per project) to every Seedream prompt:

> "Editorial mixed-media collage style: illustrated paper cutouts with white sticker borders and soft drop shadows layered on textured aged-cream paper, halftone dot accents, washi tape strips, one or two flat geometric shapes in {accent_color}, limited palette of cream, charcoal ink, and {accent_color}, bold condensed editorial typography, generous margins, 16:9 composition with clear focal hierarchy, flat graphic lighting, print-media texture. NOT photorealistic, no 3D rendering, no gradients."

### Per-frame prompt template

```
{beat.visual — subject, arrangement, focal point}.
Composition: {where the eye lands, what flanks it, background layer}.
{caption_text ? "Large title text reading '" + caption_text + "' in bold condensed type, top-right panel" : "No text"}.
{style suffix}
```

### Cultural adaptation

Adapt the collage's source material to the subject, not the grammar itself. Tang China: ink-wash mountains, seal stamps, hanfu figures. A Wall Street topic: ticker tape, engraved-currency crosshatching, brass and green. A space topic: NASA archival photo cutouts, blueprint grid. The white borders, halftone, tape, and single accent color stay constant — they ARE the style.

### Motion grammar (Stage 4 prompts)

The frame is a designed object; motion should feel like a camera exploring a collage, plus one living detail:

| Do | Don't |
|---|---|
| Slow 2D push-in (3–5% zoom over clip) | 3D dolly, orbit, perspective shift |
| Layer parallax (background drifts slower) | Elements detaching or flying |
| Clouds/smoke/water as the one moving element | Faces animating or lip movement |
| Element slides in from edge and settles | Morphing, dissolves within the shot |
| Gentle texture shimmer | Camera shake, handheld feel |

Template: "Subtle motion graphics animation of this collage: {beat.motion}. All elements remain flat paper cutouts. Slow steady 2D camera. No 3D rotation, no face animation, no text warping, no style change."

### Subtitle style (Stage 6)

Vox burns narration as bold captions: white fill, heavy black outline (3–4px) or slab shadow, bold sans (e.g., Archivo Black / Inter ExtraBold), bottom-center, ~4% margin, max 2 lines / ~42 chars per line, sentence-case. Chunk at clause boundaries, never mid-phrase. Optional: highlight one key word per caption in the accent color.
