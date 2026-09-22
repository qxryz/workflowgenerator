# Set Planning — How Images Relate Within a Set

> **When to load**: Phase 2 Shoot Plan, every time you decide what images make up a set and how they sequence.
>
> **Job**: the business + design logic for arranging a multi-image set — pacing, variety, platform container, narrative arc. Domain knowledge about *which images go in a set, in what order, why*. The single-image and set-level **quality** requirements that each image must satisfy live in `image-quality.md`.

The set walks between two failure modes — **drift** (no harmony) and **monotony** (no variety). Pacing, variety axes, container layout and narrative arc are the four ways a director plans against monotony. (The harmony side is locked via `image-quality.md` — Aesthetic Baseline + cross-image QA.)

---

## 1. Pacing — the set as story

A real listing shoots like a film: scenes have a sequence, intensity rises and falls. 9 hero shots = exhausting; 9 detail shots = boring. Use **pacing patterns**.

### The classic 4-beat structure

| Beat | Job | Visual character |
|---|---|---|
| **1. STATEMENT** (the catch) | Stop the scroll, establish mood | Wide, bold, hero — the cover image |
| **2. CONTEXT** (the projection) | Help the buyer imagine using the product | Lifestyle, model + product, scene-rich |
| **3. DETAIL** (the proof) | Validate workmanship, material, build | Tight, calm, focused, no clutter |
| **4. CONFIDENCE** (the close) | Size, scale, variant, fit — answer the last objection | Functional, clean, informational |

A 9-image set might rhythm as: 1=Statement, 2-4=Context (different beats), 5-7=Detail (different features), 8=Size, 9=Variant.

### Pacing patterns by category (high-level)

| Category | Suggested beat | Why |
|---|---|---|
| Apparel | Statement → Context (3 model angles) → Detail (fabric/work) → Flat-lay → Size chart | Visual decide first, validate fit second |
| 3C | Statement (dark dramatic hero) → Context (in use) → Detail (ports/material) → Spec graphic → Box contents | Spec confidence + use scenarios |
| Beauty | Statement (packshot) → Texture / swatch → Shade range → Ingredient mood → Use scenario | Color/texture decide; ingredients re-validate |
| Furniture | Statement (room scene) → Multi-angle → Detail (joinery / hardware) → Size with human ref → Styling combinations | Scale + craftsmanship + fit-with-existing-decor |
| Food | Statement (final dish) → Ingredient close-up → Process / preparation → Packaging → Serving suggestion | Desire → trust → action |

→ Per-category specific 组图分布表 (image roles + framing + lighting + selling point): `categories/{NN-name}.md`. The category files are the operational defaults; this section is the underlying pacing theory.

### Anti-pattern: the flat set

A set with no pacing reads as 9 catalog shots — every image at the same distance, same energy, same tone. Symptoms:
- Every image is a centered product on a similar background
- No image is wider or tighter than the others by more than ~10%
- Energy stays static (everything calm-still or everything busy-action)
- No "rest" moments between busy ones

Fix: explicitly assign each image a beat in Phase 2 (`# | Beat | Distance | Subject | Energy`).

---

## 2. Variety axes — how not to make N identical images

Pick 3–4 axes and traverse each across the set.

| Axis | Range | Use |
|---|---|---|
| **Distance** | wide → medium → close → macro | Most powerful axis. Mix of all four = visual rhythm |
| **Subject** | product-only / model+product / scene+product / detail-only | Variety in what's IN the frame |
| **Energy** | still elegant / mid-action / dynamic motion | Variety in what's HAPPENING. Implemented per-image via C13 pose-scene coherence |
| **Tone within palette** | dominant note / secondary note / accent-heavy / muted rest | Variety in the WEIGHT of the palette across the set |
| **Density** | calm / moderate / busy | Variety in INFORMATION DENSITY |

### The thumbnail test

Shrink every image of the set to thumbnail size, lay them in a row. Squint. If the row reads as N distinct silhouettes (different distances, different shapes, different brightness patterns), variety is working. If the row reads as N versions of the same blob, variety failed — even if each image individually is fine.

### Axis Collision Check — mandatory before Phase 3 dispatch

After writing the Shoot Plan table in Phase 2, run this check before proceeding:

1. **Fill in the variety axes for every image** in the Shoot Plan table using this format: `Sub-set · Distance · Subject` (pick one value per axis from the ranges above).
2. **Within each sub-set**, scan for any two images whose `Sub-set · Distance · Subject` combination is identical. If found, that is a collision — adjust one of them (change Distance, change Subject, or move it to a different sub-set) before proceeding.
3. **Across the full set**, verify the Distance axis traverses at least 3 distinct levels (e.g. macro / close / medium / wide). A set that never reaches macro or wide has failed pacing.

> Example collision (BAD): Image 1 = dark-studio · Distance=close · Subject=product-only; Image 4 = dark-studio · Distance=close · Subject=product-only → identical sub-set + Distance + Subject → must resolve by changing Image 4's sub-set (e.g. light-surface) or Distance (e.g. overhead 90°).
>
> Example resolved (GOOD): Image 1 = dark-studio · Distance=close · Subject=product-only; Image 4 = light-surface · Distance=close · Subject=product-only → different sub-set → no collision.

Do not dispatch any generation until the Axis Collision Check passes.

---

## 3. Container layouts — where the set will be seen

The set's design must serve the platform container, not just stand alone.

### Amazon — 7-image carousel (linear scroll)

- Image 1 (main hero): MUST work as a tiny thumbnail in search results — silhouette + brand recognition in 0.5 seconds
- Images 2-7: scrolling carousel, ~3 seconds each
- Pacing recommendation: hero / lifestyle / lifestyle / detail / detail / size / variant
- Each image must work alone (the buyer might leave after image 3); the SET must build trust progressively

### Tmall PDP — main carousel + scrolling detail page

- Top: 5-9 image carousel for the visual story
- Below: long-scroll detail page where additional images intersperse with copy
- Carousel needs cohesion (shared aesthetic baseline); detail-page images can be more functional / informational
- Pacing: carousel is 90% aesthetic + 10% functional; detail page is 30% aesthetic + 70% functional

### XHS / Pinterest / Instagram — 9-grid (visual harmony at thumbnail level)

- Buyers see all 9 thumbnails at once before any single image
- The grid as a WHOLE must have visual harmony — palette continuity, light universe consistency
- If one thumbnail is dramatically different in palette / lighting / mood, the grid feels "off" before any single image is examined
- Pacing: design the grid as a 9-cell composition — alternating distances, alternating subject types, with 1-2 visual "anchors" (high-density images) and 5-6 "rest" (lower-density images) for breathing room
- Diagonal eye path: top-left → top-right → bottom-right → bottom-left

### TikTok Shop / vertical scroll

- Each image is a moment in a vertical scroll; the buyer can flick away in 1 second
- Each image must be self-contained
- Aspect: vertical 9:16 or 4:5 (not 1:1)
- Energy bias: higher than other platforms — TikTok rewards motion / dynamism

### Etsy / Shopee / DTC site

- Often 5-6 images, gallery layout
- Pacing: hero / lifestyle / detail / scale / variant / story-shot
- Brand storytelling matters more; the set's aesthetic baseline IS the brand

→ Hard specs (aspect ratio / file size / banned elements) per platform: `platform-specs.md`.

---

## 4. Narrative arc — the set tells a story

```
DESIRE → TRUST → CONFIDENCE → CHOICE → CLOSURE
   ↓        ↓         ↓          ↓         ↓
 Hero    Lifestyle  Detail    Variants   Size /
 catch   project     proof    selection  scale
         self
         into it
```

| Image type | Emotional job | Visual cue |
|---|---|---|
| Hero / packshot | Desire — "I want this" | Bold composition, strong palette, premium light |
| Lifestyle | Projection — "I see myself with this" | Aspirational scene, model in user's role, warm mood |
| Detail / macro | Trust — "this is well-made" | Sharp focus, revealing light, material truth |
| Spec / infographic | Confidence — "this fits my needs" | Clean callouts, honest specs, no exaggeration |
| Size / scale | Confidence — "it'll fit me / my space" | Real reference object, no perspective trick |
| Variant / multi-color | Choice — "I have options" | Side-by-side, identical lighting, easy comparison |
| Closure shot | Sealing — "yes, I'm buying" | Often the hero re-presented, brand-perfect |

Don't skip emotional beats. A set with 7 hero shots + 0 detail shots feels untrustworthy. A set with 7 detail shots + 0 hero shots feels like a manual, not a listing.
