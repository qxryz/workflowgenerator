# Image Quality — what makes a good image, a good e-commerce image, and a good e-commerce set

> **When to load**: Phase 2 Shoot Plan, every per-image plan, Phase 4 evaluation.
>
> **Job**: the quality bar — three layers, each built on the previous.
> - **Part 1**: a good photograph, period.
> - **Part 2**: a good e-commerce photograph (commerce constraints on top of Part 1).
> - **Part 3**: a good e-commerce image set (set-level cohesion on top of Parts 1 + 2).
>
> Used both forward (design the image to pass) AND backward (verify after generation). For agent working discipline (intake / output rules / phase gates), see SKILL.md.

---

# Part 1 — A good photograph

A photograph qualifies as good when it satisfies these properties. They apply to any photograph, regardless of commerce; e-commerce adds more on top in Part 2.

- **Subject is readable.** You can tell what the picture is OF in roughly 1 second. The focal subject dominates the frame; supporting elements are clearly subordinate; no second focal subject competes for attention.
- **Composition is intentional.** The eye lands somewhere on purpose — center for symmetric statement, rule-of-thirds for everything else; never the random middle of an unplanned frame. Negative space gives the subject breathing room (luxury / editorial leans into more; mass / dense leans into less). When framing requires a tall subject and the aspect is wide (or vice versa), aspect was chosen wrong.
- **Light direction and quality serve the subject.** Front light flattens form (catalog / beauty); side light reveals form and texture (workmanship / leather / fabric); backlight creates silhouette and translucency (glassware). Hard light is dramatic / masculine / sport; soft light is premium / beauty / food. Default = soft side light at ~45° from upper-left, neutral 5000–5500K daylight; deviate intentionally. For materials, the light angle that REVEALS the material must be chosen on purpose — same fabric flat-lit shows no texture; same fabric grazing-side-lit shows every fiber.
- **Palette is coherent.** Three tones (~60 / 30 / 10 dominant / secondary / accent), one chosen temperature (warm / cool / neutral), one chosen saturation level matching positioning (low for luxury, high for mass).
- **Internal logic holds.** Shadows fall the same direction (one light universe, not two). Scale is plausible — sofa fits the room, watch fits the wrist. Action verbs match the scene (you can't walk on water unless the brief was an ocean walk). Reflections show the surrounding scene, not a different one.
- **Treatment is honest.** The image looks like a real photograph, not a filter-stack. No lens-flare overlays, no fake vignettes, no mirror-plastic finishes on materials that aren't mirror-plastic. Stylization is fine when the user briefs it; default is real.

Material principles in tension (which light each material wants):
- Leather / wood / chunky knit → side light at low grazing angle (reveals grain / weave); front light kills it.
- Smooth fabric (silk, satin) / brushed metal → soft side with controlled specular gradient.
- Polished metal → controlled reveal where the light source itself becomes the reflection; diffused light looks dead.
- Glass / transparent → backlight or side-back; front light makes it invisible.
- Skin → soft frontal + gentle side fill; top light hollows eyes, hard side is dramatic not flattering.

---

# Part 2 — A good e-commerce photograph

E-commerce adds commerce-specific constraints on top of Part 1. The classic six dimensions any e-commerce image is judged against are **Product Clarity / Visual Appeal / Information Delivery / Trust / Brand Consistency / Technical Compliance** — the criteria below operationalize them. Category weights vary (Beauty raises Trust; Jewelry raises Clarity; Baby raises Trust; 3C raises Information) → per-category weight overrides in `category-playbook.md`.

#### C1. Background-product contrast — minimum-viable, harmonious

The product silhouette must be readable against the background, but the contrast should be a ONE-NOTCH harmonious shift, not opposite extreme. Cream garment on black background reads as a high-contrast poster, not a product photo. White garment on pure white blends. Match the background to the product's tonal family, then shift one notch lighter or darker.

| Product | Acceptable harmonious background | Avoid |
|---------|----------------------------------|-------|
| Cream / ivory / off-white | Soft natural white, faintly cool unbleached linen, very pale warm grey | Black, charcoal, saturated colors |
| Pure white | Soft pale grey, very pale warm cream, soft sage | Pure white (blends), pure black (over-contrast) |
| Black device / black garment | Soft warm light grey, muted oat, very pale taupe | Pure white, saturated colors |
| Warm wood furniture | Cool-leaning soft grey, muted off-white plaster, soft pale stone | Cold steel blue, black, saturated red |
| Cool steel / silver | Warm-leaning pale grey, soft warm cream, muted oat | Hot orange, deep navy |
| Saturated color (e.g. red lipstick) | Neutral muted complementary tone | Same-saturation clashing color |
| Patterned product | Solid background in product's dominant color, one notch lighter or darker | Another pattern; high-contrast solid |

**Pure white-bg requirement** (Amazon / JD): pure white seamless RGB(255,255,255); for white / cream / ivory products add subtle natural contact shadow so silhouette stays defined.

**Apparel shortcut**: garment detail / macro / workmanship close-ups and pure display shots default to natural soft white seamless.

#### C2. Detail / macro shots — product-only, single focus, faithful to reference

Detail / macro / workmanship shots must contain the product only — no skin, hands, body parts, irrelevant props. One named focus feature per shot. The focal feature reads as a complete recognizable visual whole — never sliced mid-feature, never cropped to an unrecognizable fragment.

When a product reference is available, the detail shot is content-constrained to what is **actually visible** in the reference. Don't invent unseen structure — a logo where the reference has none, stitching with the wrong direction, hardware in the wrong location, a different number of buttons, a brand mark moved from chest to sleeve. If the reference doesn't show this specific area clearly, choose a different focal feature that IS shown clearly. Never fabricate. If no clear reference exists for any planned detail area, flag the shot as "inferred, lower confidence" and warn the user at hand-off.

#### C3. Apparel gender + cut explicit

For apparel, gender (women's / men's / unisex / kids') + cut (silhouette, fit, length, sleeve shape, neckline shape) must be unambiguous in every image. Without explicit signaling, generation drifts toward generic unisex or the opposite gender — most commonly womenswear drifting masculine (broad shoulders, boxy silhouette, straight waist) or menswear drifting feminine (cinched waist, bust dart).

#### C4. Product prominence + background calmness

Product fills 60–85% of the frame for hero / detail / white-bg / pure-display; 40–60% for lifestyle, never below 40%. Composition anchored on center or rule-of-thirds intersection. Background is calm — no busy patterns, no clutter, no competing focal points (≤ 1–2 intentional supporting elements).

#### C5. Framing integrity — every important element accommodated

Plan the framing before generating: list every important element that must appear (logo, model head, feet if full-body, hands, product edges, recognizable accessories), pick an aspect ratio that gives all of them room, choose a pose / camera distance that fits all of them with breathing room. If aspect + pose physically can't fit them all, change the aspect or change the pose — the model cannot solve a physical fit problem.

Per-element rules:

- **Brand logo** — whole and unobstructed; not cropped by frame edge, not occluded by hands / hair / fabric folds / shadow, not warped. Carried via the product reference; do not invent or alter.
- **Full-body model shot** — head with ≥ 5% margin above the topmost hair down to ≥ 5% margin below the soles. Feet AND shoes fully visible. Aspect: 3:4 or 4:5 vertical only — never 1:1.
- **Half-body / waist-up / chest-up / portrait** — entire head + hair fits inside canvas with ≥ 5% margin above the topmost hair. Never cut at hairline / forehead / eyebrow / eye / nose / mouth.
- **Hands holding product** — full hand or clean wrist crop; never mid-finger, mid-palm, mid-knuckle.
- **Pure product / hero / white-bg / detail** — product whole within frame with clean margin; not edge-clipped (unless the crop is the explicit point).
- **Recognizable accessories** (bag, shoes, jewelry from the locked outfit) — fully shown or intentionally framed at a clean point.

If a planned framing would inevitably amputate any of these, change the framing or split into a separate shot.

#### C6. Pose has affordance + serves the product

Every action verb requires an environment affordance. `Walking` needs a walkable surface; `leaning` needs something to lean on; `holding a mug` needs a mug. When the affordance isn't in the scene, the model either invents the affordance (silently rewriting the scene), produces an impossible result, or produces a stiff paste-in pose. Change the verb, not the scene.

The pose serves the product — focal product visible, unobstructed, logo whole. Pose is a vehicle, not a hero.

#### C7. Pair / set products show the full pair / set

Any product that ships and is used in pairs or as a complete set: every hero / standard studio / multi-angle shot must show the **full pair or full set** in frame. A single piece reads as "they lost one" / "missing piece" and silently kills purchase trust. Per-feature macro / micro-detail shots are the only exception — they may isolate one piece because the crop IS the point.

Trigger categories: footwear; paired jewelry (earrings / stud pairs / matching ring sets / cufflinks); apparel accessories (gloves / mittens / socks); 3C (TWS earbuds + case, dual controllers); paired tableware / drinkware; paired bedding; paired sports gear; paired personal care; matched bag sets.

**Pair-symmetry guard** (especially jewelry / earrings): AI often drifts the second piece (different stone size, facet count, metalwork). Mirror-identicality between the two pieces (size, stone count, facet pattern, metal finish) must be verified at 100% in post.

#### C8. No unbriefed overlay text

Default = no overlay text. No spec callouts (`100% cotton` / `1080p`), no marketing copy (`New Arrival` / `Best Seller`), no badges, banners, stickers, captions, measurement labels, watermarks. Copy is added in post if the platform / brief calls for it. Only text that may appear is text physically on the product itself (logo / on-pack text per the product reference), preserved not regenerated.

**Exception**: when the user explicitly briefs on-image copy (e.g. "在主图右上角写 '夏季新品 19.9 元起'"), quote the exact text and name the font / position as briefed.

#### C9. Truth + reference grounding

The image must be true of the product. Don't fabricate brand names, specs, ingredients, certifications, numeric performance claims, on-pack text, efficacy data, or model-body data (full inventory in SKILL.md → Output Style → Never silently invent).

Every claim of fact (color, structure, logo position, on-pack text, brand mark, product geometry, model identity, scene layout) must be either grounded in an attached reference (evaluated per Iron Law 6) OR explicitly briefed by the user. Without grounding, the model fills the gap with its statistical prior — logos relocate, structure shifts, ingredients drift, model faces change.

#### C10. Platform technical compliance

Pass the platform's hard rules — resolution, file format, file size, background rule, banned elements (watermarks, irrelevant text, borders), product fill % minimum. Failing here means takedown or de-ranking; aesthetic merit cannot save you. → See `platform-specs.md` for per-platform rules.

---

# Part 3 — A good e-commerce image set

A good set walks between two failure modes — **drift** (no harmony) and **monotony** (no variety). They require opposite remedies. Lock the baseline; vary along planned axes within it.

## 3.1 Aesthetic Baseline locked at the set level

A set's "feel" is the sum of its locked dimensions. Decide them at Phase 2; carry them through every image. Drift in any field breaks the set; sameness across all fields produces monotony. Dimensions to lock:

- **Styling Direction** — the named direction (e.g. "Editorial Premium" / "Street Fashion" / "Minimal Clean") + 模特 qi. The north star — every other field operationalizes this.
- **Palette** — dominant / secondary / accent (60 / 30 / 10), temperature, saturation.
- **Light universe** — same source family, quality, temperature, time-of-day equivalent, shadow character, key tier across every image.
- **Color grade** — one named look that wraps every image of the set ("Kinfolk", "Vogue Living September", a specific named adjective).
- **Shooting conditions** — setting, surface family, props family. A model on a sunlit beach in image 5 of a "warm indoor apartment" set breaks the universe.
- **Pacing axes** — planned variety across distance / subject / energy / density (see `set-planning.md`).
- **Container layout** — the platform container shapes the design (Amazon 7-grid / Tmall PDP / XHS 9-grid / TikTok / Etsy — see `set-planning.md`).
- **Narrative arc** — the per-image emotional job sequence (Desire → Trust → Confidence → Choice → Closure).

Per-image plans draw from this baseline; they never invent against it.

## 3.2 Subject identity held identical across the set

When a model / pet / variant recurs across multiple images, identity must not drift. The set should read as one person, one shoot, not a casting reel. Subject drift is one of the most common silent failures: the same listing showing two different-looking models, a pet that loses its markings, a garment that subtly changes cut. Dimensions to hold identical:

- **Product** — category (specific, including gender if apparel), cut / silhouette, color, material / finish, signature features (embroidery, seam, hardware, color-blocking, button count), on-pack text / logo placement.
- **Model** — gender, approximate age, ethnicity / look, face (hair color and exact style, eye / brow / lip shape, default expression), skin tone, body (build, height, shoulder width), hands. For apparel / footwear / bags / jewelry, also lock the surrounding outfit (everything the model wears besides the focal product) so it doesn't shift between shots.
- **Pet** — species + breed, coat color and pattern, age and size, distinguishing markings, default expression / posture.

Every model image must also be unambiguous about how many people are in frame. Pair-product images: pair / set complete (per C7) AND still exactly one human unless the brief calls for more.

## 3.3 Scene context held identical within sub-set

A single set may contain multiple sub-sets (detail / lifestyle / white-bg). Different sub-sets can have different scene context, but every image **within** a sub-set must read as the same place. Past testing failures were almost all caused by drift within a single sub-set (white wall in shot 1, green wall in shot 2). Per sub-set:

- **Detail / macro / workmanship sub-set** — surface, wall or backdrop tone, color grade, light setup. All detail images of the sub-set share these.
- **Lifestyle / scene sub-set** — location, time of day, weather (if outdoor), color grade, recurring props (the same mug, same plant, same notebook — same item, same state, same arrangement).
- **White-bg sub-set** — pure white seamless or near-white seamless, even soft front light, identical exposure.

When the user did not supply a scene reference, the first generated image of a sub-set becomes the canonical scene anchor for the rest (implicit pilot — Iron Law 7).

## 3.4 Pacing — planned variety, not random walk

A set with no pacing reads as 9 catalog shots — every image at the same distance, same energy, same tone. The set must traverse a planned sequence of beats by picking 3–4 variety axes upfront and varying along each (distance / subject / energy / density / tone within palette).

**The thumbnail test**: shrink every image to thumbnail size, lay them in a row, squint. Distinct silhouettes / brightness patterns = variety working. N versions of the same blob = monotony, even if each image individually is fine.

→ Full pacing patterns by category, variety axes catalog, container-specific layouts, narrative arc beats: `set-planning.md`.

## 3.5 Cross-image QA — three layers

After each image satisfies Parts 1 + 2 individually, lay all images side-by-side and run three layers of cross-image checks. Each catches a different failure mode.

### Layer A — Hard consistency (TRUTH)
- Same model where applicable; same product; same outfit (apparel / footwear / bags / jewelry); same scene context within sub-set; same recurring props in the same state; same photographic treatment (color grade / light universe / lens feel / exposure) across the set; no background-product blend in any image.
- Any failure = severe defect; re-tighten the relevant locks (3.1 / 3.2 / 3.3) and regenerate.

### Layer B — Aesthetic Baseline harmony (FEEL)
Squint at the set as a single image:
- Do all images draw from the same palette?
- Does color grade feel uniform?
- Does the light universe direction + quality feel consistent?
- Does the scene family feel like one place?
- Could these have been shot on the same day?

Any "no" = aesthetic drift; re-tighten the Aesthetic Baseline (3.1) and re-generate, anchoring on the strongest already-approved set members.

### Layer C — Variety (MONOTONY)
Look at images one at a time as thumbnails:
- Are silhouettes / compositions distinct?
- Does distance, subject, energy actually vary?
- Do you remember N distinct images, or 1 repeated motif?

A single repeated motif = monotony; re-plan the pacing axes (3.4) and regenerate the dull middle.

A set that passes A + B + C is a designed set, not just a non-broken one.
