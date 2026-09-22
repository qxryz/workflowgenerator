---
name: poster-motion-generator
description: |
  Poster Motion Generator turns an uploaded poster into a MiniMax H3 single-take motion poster. It analyzes aspect ratio, subject, poster type, layout, visual hierarchy, typography, and motion potential, then offers 8 motion directions with Direction 1 Progressive Activation and Direction 2 Paper-Roll Reveal prioritized. The uploaded poster is the final lock-frame reference, not a required opening frame. Built in: motion-effect term table, direction-aware SFX wording, and timestamp storyboard prompt format. All user-facing output follows the user's conversation language.
trigger-words: [Poster Motion Generator, poster animation, poster-to-video, dynamic poster, 海报动效, 动态海报, 一键转视频, 海报动态生成器, poster video, MiniMax H3]
---

# Poster Motion Generator

## When to use

Use this Skill when the user uploads at least one poster image and wants an 8–15s single continuous animated poster video that fills the whole frame, preserves the original composition, and keeps poster text readable.

Do not use it for original poster design, multi-shot narrative films, or simple slideshows.

## Language consistency

- Follow the user's conversation language for every rule and output.
- If the user chats in Chinese, all replies, choice cards, `Final_Video_Spec.md`, storyboard text, and generation prompts must be Chinese.
- If the user chats in English, all output must be English.
- If the user mixes languages or specifies a target language, preserve that mix or target language.
- Preserve on-poster text by default. Do not translate or localize unless the user explicitly asks.

## Step 1: Required precheck

- The user must upload at least one poster image before this Skill starts.
- If no poster is uploaded, reply exactly: `请先上传一张海报图片`.
- Do not continue to analysis, direction selection, spec writing, storyboard, or generation before a poster exists.

## Step 2: Poster analysis and aspect-ratio mapping

After a poster is uploaded, analyze:

- Orientation: landscape (width > height), portrait (height > width), or square (width ≈ height).
- Numeric width/height estimate: directly estimate width ÷ height as a decimal, such as 1.78, 0.80, or 1.00.
- Mathematical mapping: compare the estimate against MiniMax H3 supported ratios and choose the smallest absolute difference:
  - 21:9 = 2.3333
  - 16:9 = 1.7778
  - 4:3 = 1.3333
  - 1:1 = 1.0000
  - 3:4 = 0.7500
  - 9:16 = 0.5625
- Output format: `Orientation: [landscape/portrait/square], width-height estimate: ≈[X.XX], mapped supported ratio: [final ratio]`.
- Mark ratio deviation: ratio basically matches / ratio deviation exists and background extension is required.
- Mark whether the poster content already fills the image frame or contains white borders, blank space, or framing margins.

Accept any poster ratio. Do not reject and do not ask the user to confirm the ratio. When deviation exists, extend the poster background color and texture to fill extra output area while keeping core content uncropped, unstretched, and free of black bars.

## Step 3: Automatic orientation cross-check

Immediately after analysis, verify:

- Numeric value > 1 should mean landscape.
- Numeric value < 1 should mean portrait.
- Numeric value ≈ 1 should mean square.

If the orientation and numeric estimate conflict, re-analyze only once with this focused request: `Directly compare this image width and height. Which is larger? Approximately how many times is width compared with height? Provide a width ÷ height numeric estimate.` Use the second result as final. Do not loop. If conflict remains, continue and rely on background extension.

## Step 4: Required poster content analysis

Record:

- Poster type: person / product / food / architecture / typography-only / abstract graphic / no clear subject.
- Visual subject: position, scale, direction, and final pose.
- For no-person posters, identify the main motion carrier: main title, product, logo, graphic, texture, light, or color relationship.
- Composition and space: subject placement, foreground/midground/background, blank areas, and depth.
- Style and palette: minimal, retro, cyberpunk, hand-drawn, streetwear, etc., plus dominant colors.
- Text layout: title, slogan, logo, secondary text positions, hierarchy, and layout; text must remain readable.
- Five visual layers: background/base shapes, core recognition element, main title and logo, supporting information, decorative graphics and atmosphere.
- Visual anchor: person for person posters, product for product posters, main food for food posters, building for architecture posters, main title/core type for typography posters, and the strongest graphic/texture/color/light relationship for abstract or no-subject posters.
- Motion potential for both directions: usable reveal methods, core elements, per-element entrance order, trajectory, action, and depth layer.
- Direction 2 only: detect whether the poster outer contour is a regular rectangle or has notches, irregular cuts, rounded corners, or other contour features.
- Direction 2 only: recommend paper-roll axis and unfolding direction. Landscape posters prefer horizontal unfolding; portrait posters prefer vertical unfolding.

## Step 5: Offer common motion directions for user selection

Show motion-direction choice cards and pause for the user selection. Recommendation order must prioritize Direction 1 Progressive Visual-Element Activation first and Direction 2 Paper-Roll Reveal second; other directions are supplementary recommendations. If the user asks for full options, show all directions.

### Direction 1: Progressive Visual-Element Activation

Start from a clean initial frame. Poster elements appear one by one by visual hierarchy and importance, move around the visual anchor with depth motion, return to their original positions, and form the complete original poster layout.

### Direction 2: Paper-Roll Reveal

A fully rolled physical paper cylinder drops from above, stores tension, then snaps open. The paper is blank during unfolding, fills the whole frame once flat, then poster elements appear through depth, parallax, material transition, and local motion before restoring the original layout.

### Direction 3: Naked-eye 3D Breakout

The core person, product, food item, architectural detail, or main title actively bursts from the poster plane toward the lens, creates strong depth impact, then returns and locks into the original layout. Best for person, product, sports, food, streetwear, and e-commerce posters.

### Direction 4: Layered Parallax Awakening

Preserve the poster layout while splitting foreground, midground, background, and typography layers. Use push-in, tracking, subtle orbit, depth-of-field change, and local micro-motion to create a living poster. Best for photography, person, architecture, brand, and lifestyle posters.

### Direction 5: Particle / Wireframe / Point-Line-Plane Reconstruction

Core elements deconstruct into points, lines, planes, particles, wireframes, or graphic fragments, then reassemble into the original poster layout. Best for tech, cyber, gaming, abstract graphic, logo, and typography posters.

### Direction 6: Light and Material Micro-Sculpting

Use volumetric light, light sweeps, reflections, highlights, shadows, and material gloss changes to awaken metal, glass, plastic, fabric, skin, food, or architecture surfaces with restrained layout motion. Best for luxury, product, food, architecture, and minimal posters.

### Direction 7: Kinetic Typography Layout Build

Main title, logo, slogan, and supporting text write on, slide in, expand, compress, or assemble along strokes, spacing, layout direction, and grid systems. Best for typography-only, event, music, exhibition, and brand-slogan posters.

### Direction 8: Physical Atmosphere Loop

Preserve the original composition and enhance atmosphere with rain, snow, smoke, mist, wind, dust, sparks, lens flares, water ripples, paper grain, or film grain. The subject only keeps tiny living motion. Best for cinematic, cultural, travel, architecture, and mood posters.

Direction recommendation rules:

- All poster types: recommendation cards must list Direction 1 Progressive Visual-Element Activation first, then Direction 2 Paper-Roll Reveal second.
- Person posters: after Directions 1 and 2, optionally add 3D breakout, layered parallax, or physical atmosphere.
- Product / food posters: after Directions 1 and 2, optionally add 3D breakout, material micro-sculpting, or layered parallax.
- Architecture posters: after Directions 1 and 2, optionally add layered parallax, material micro-sculpting, or physical atmosphere.
- Typography posters: after Directions 1 and 2, optionally add kinetic typography or particle reconstruction.
- Abstract / no-clear-subject posters: after Directions 1 and 2, optionally add particle reconstruction, material micro-sculpting, or physical atmosphere.
- Every direction must restore the original poster at the final lock frame, keep text readable, and fill the whole frame.

## Step 6: Global spec lock

After direction selection, write `Final_Video_Spec.md` locking:

- aspect_ratio: nearest supported ratio from Step 2.
- model: MiniMax H3 (per-segment) + image_synthesize (keyframe) + FFmpeg (assembly).
- resolution: 1080P for video segments (2K deferred when tool-limited); keyframe images at 1K–2K.
- duration: 8–15s, user-selected, not automatically 15s. Single continuous shot inside each segment; segments joined by FFmpeg concat.
- camera mode: **per-segment single continuous shot**, no internal cuts within a segment; segment-to-segment transitions are FFmpeg concat (no fancy transitions by default).
- dynamic direction: selected motion direction.
- keyframe_count: number of pre-rendered keyframe images, typically 1 opening + N element-introduction keyframes + 1 lock-frame. Recommended: 5–9 keyframes for an 8–15s video.
- bgm_required: `true` (user opted in) or `false` (default). BGM is generated separately via `batch_text_to_music` and mixed in at FFmpeg stage (Step 9.3).
- full-frame policy: no black bars, no top/bottom blank space, no side blank space, no letterbox or pillarbox.
- ratio adaptation: extend background color and texture when needed; do not crop, stretch, or add black bars.
- lock-frame policy: the last keyframe (keyframe N) must be a 1:1 visual restoration of the original poster (composition, color, text layout). After concat, the final 1–2s of the assembled video uses Breathing Pulse / Lens Flare Blink / Material Shift only; text is fully still; subject must not keep scaling or drifting.
- motion-term lock: every storyboard segment and prompt section must explicitly tag the motion effect type using the standard terminology in the reference table below. MiniMax H3 responds strongly to explicit motion terms; using them is more reliable than abstract descriptions.
- onomatopoeia style lock: based on the chosen direction's mood, lock one onomatopoeia style library (see Step 8.2) and keep it consistent throughout the entire video.

### Animation Effect Term Reference (use when writing prompts)

| Motion effect type | Standard term (EN/CN) | Use case | Key parameters |
|---|---|---|---|
| **Jelly Pop entrance** | `Jelly Pop` / 果冻弹跳 | Main title, logo, character avatar | scale 0.3→1.1→1.0, elastic easing with bounce |
| **Scale & Bounce** | `Scale & Bounce` / 放大回弹 | Subject / product entrance | scale 0→1, elastic easing |
| **Stroke-by-stroke writing** | `Kinetic Typography` / 逐字书写 | Main title, logo, signature | along stroke direction, 0.2–0.4s/character |
| **Typewriter** | `Typewriter` / 打字机 | Subtitle, supporting copy | 0.05–0.1s/character |
| **Scroll unroll** | `Scroll Unroll` / 卷轴展开 | Subtitle, slogan, decorative band | horizontal/vertical, 0.5–1s unroll |
| **Card slide-in** | `Card Slide-in` / 卡片滑入 | Supporting tag, info card | edge slide-in, light bounce |
| **Paper breakout** | `Paper Breakout` / 纸面破出 | Direction 2 core element | paper → 3D → back-to-plane |
| **Light sweep** | `Light Sweep` / 光束扫掠 | Direction C element activation | one main beam, 1–2s sweep |
| **Brush stroke** | `Brush Stroke` / 笔触勾勒 | Direction D line art | pen path feel, 0.5–1s/segment |
| **Slice reassembly** | `Slice Reassembly` / 切片飞入 | Direction E assembly | fly in from off-screen, click lock |
| **Parallax push-in** | `Parallax Push-in` / 视差推近 | Multi-layer posters | push-in + micro orbit |
| **Orbital display** | `Orbital Display` / 环绕展示 | Product / architecture / 3D subject | 8–15° micro orbit |
| **Particle reconstruction** | `Particle Reconstruction` / 粒子重组 | Tech / cyber / logo | point → line → plane, bottom-up aggregation |
| **Breathing pulse** | `Breathing Pulse` / 呼吸感 | Continuous after lock-frame | very low amplitude, 1–2s period |
| **Lens flare blink** | `Lens Flare Blink` / 光斑闪烁 | Atmospheric / cinematic | random interval, 1–3 times |
| **Material shift** | `Material Shift` / 材质微变 | Matte → print texture | synced with element-by-element entrance |

## Step 7: Storyboard rules

Design only the selected direction as one continuous shot. Do not storyboard unselected directions.

### Shared rules

- 8–15s, single continuous shot, no internal cuts, no transitions.
- Fill the whole video frame.
- Treat the uploaded poster as the final lock-frame reference, not a required starting frame. The opening may be blank, partial, or abstract, as long as the final lock frame matches the original poster composition, color, and text layout.
- By default, animate only three main layers: background/base shapes, core recognition element, main title/logo. Supporting information and decorations should simply fade into position, unless the poster has two or fewer meaningful layers.
- Strict sequence: background/structure first → visual anchor enters with depth or scale motion → main title/logo strengthens near climax → supporting text and decoration enter at the end.
- The previous element must fully settle for about 0.5–1s before the next element enters.
- Only one element may perform an active entrance at any time.
- Supporting text and decorative details must not appear while the core subject is entering.
- The core visual anchor must not gradually fade in, transparently appear, or slowly emerge from mist/light. It must actively enter by running, walking, rotating upward, assembling, rushing from depth, or breaking out of the paper.
- Every trajectory must match the final position.
- Every element must declare its depth layer: background, midground, or foreground.
- Text must stay readable and become completely still after placement.

### Poster-type guidance

Use poster type to choose the visual anchor and entrance style: person uses action/spatial entrance; product uses action/material entrance; food uses light/material detail; architecture uses spatial growth; typography uses writing/layout motion; abstract posters use graphic, texture, color, or light relationships.

### Direction 1 storyboard (Progressive Activation · 10s timestamp template)

> A timestamp template. Compress to 8s or extend to 15s as needed. If a poster has many elements, compress the supporting/decorative segment; never compress the stability gap between elements.

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:01 | Full-frame clean white / solid color base fills the frame | — | BGM fade-in, `<ambient drone>` |
| 0:01–0:02 | Background and base color block structure established (lowest decorative layer fades in first if any) | `Material Shift` (if applicable) | `<subtle texture sound>` |
| 0:02–0:04 | Visual anchor pushes in from far depth to middle to near, lands in its final poster pose | `Parallax Push-in` / `Scale & Bounce` | Character: `<footsteps>` + `<fabric rustling>`; Product: `<mechanical rotation>` + `<parts clicking>` |
| 0:04–0:04.5 | Anchor stabilizes for 0.5s | — | SFX decays |
| 0:04.5–0:06 | Main title and logo enter (along stroke direction / Jelly Pop / Scale & Bounce) | `Jelly Pop` / `Kinetic Typography` / `Scale & Bounce` | `<pen scratching>` or `<paper sliding>` + character beat cues |
| 0:06–0:06.5 | Title stabilizes for 0.5s | — | SFX decays |
| 0:06.5–0:08 | Subtitle, supporting tags, decorative elements enter one by one | `Card Slide-in` / `Typewriter` / `Scroll Unroll` | `<pen scratching>` continued / `<swoosh>` |
| 0:08–0:09 | Settling transition (motion decelerates to stable) | — | BGM fades |
| 0:09–0:10 | Post-lock micro motion: breathing pulse / lens flare blink / material shift | `Breathing Pulse` / `Lens Flare Blink` | Very low-volume `<ambient drone>` continues |

After formation, enter lock state: text is fully still; the subject only retains micro breathing, micro-expression, hair motion, light flow, or material shift; the subject's proportion and composition must not change.

### Direction 2 storyboard (Paper-Roll Reveal · 10s timestamp template)

> The four phases are time sections inside one continuous shot, not separate shots. No cuts, jumps, fades, flash-to-white, or flash-to-black. Phase transitions happen only through camera acceleration, deceleration, or direction change.

| Timestamp | Phase | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|---|
| 0:00–0:02 | Phase 1 · Drop & snap-open reveal | A fully rolled cylindrical paper roll drops in from the top of frame with weight, inertia, and slight rotation; lands and holds tension for 0.5–1s, then snaps open decisively; the paper unfolds quickly with inertial shake and decelerates into flatness. The roll contour must match the actual poster contour | — | Drop: `<impact>`; snap-open: `<paper unfurling>`; shake: `<paper flutter>` |
| 0:02–0:02.5 | Phase 2 · Paper fully spread | Paper is fully flat, fills the whole frame; content has not yet appeared, hold a 0.5s breath moment | — | `<paper settling>` |
| 0:02.5–0:05 | Phase 3 · Core elements emerge | Background and base color blocks fill in first; each core element `Paper Breakout`s from the paper into 3D space one by one, completing a "breakout → spatial activation → back-to-plane" micro-loop; each element fully completes and stabilizes before the next starts. Material transitions from matte paper to print texture | `Paper Breakout` + `Material Shift` | Per-element SFX (mapped per element type, same as Direction 1) |
| 0:05–0:07 | Phase 3 · Title and logo | Main title, logo, signature land via `Jelly Pop` / `Kinetic Typography` | `Jelly Pop` / `Kinetic Typography` | `<pen scratching>` / character beats |
| 0:07–0:08 | Phase 3 · Supporting and decoration | Subtitle and decoration land via `Card Slide-in` / `Scroll Unroll` | `Card Slide-in` / `Scroll Unroll` | `<swoosh>` |
| 0:08–0:09 | Phase 4 · Settling | All elements return to original position, scale, hierarchy | — | BGM fades |
| 0:09–0:10 | Phase 4 · Post-lock micro motion | Text fully still; subject only retains `Breathing Pulse` / `Lens Flare Blink` / `Material Shift` | `Breathing Pulse` / `Lens Flare Blink` / `Material Shift` | Very low-volume continues |

Paper material must include spiral paper layers on the roll edge, elastic shake, curl rebound, sliding highlights, disappearing crease shadows, and paper fiber edges.

### Direction 3 storyboard (Naked-eye 3D Breakout)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Clean base color fills frame; the core subject (character / product / food / title) bursts out from the poster plane toward the camera for 0.5–0.8s, then rapidly returns to its original position | `Scale & Bounce` (with z-axis push) | Out: `<whoosh>`; return: softened `<impact>` |
| 0:02–0:04 | After the subject returns, perform a light secondary activation (gentle push-forward + bounce) to reinforce the spatial sense | `Scale & Bounce` | Soft `<whoosh>` |
| 0:04–0:06 | Title and logo strengthen | `Jelly Pop` / `Kinetic Typography` | Character beats |
| 0:06–0:08 | Supporting and decoration enter | `Card Slide-in` | `<swoosh>` |
| 0:08–0:10 | Lock-frame + micro motion | `Breathing Pulse` | Very low ambient |

### Direction 4 storyboard (Layered Parallax Awakening)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Full-frame poster forms; camera begins to push in, background and middle layers create parallax | `Parallax Push-in` | `<ambient drone>` |
| 0:02–0:04 | The depth layer containing the subject moves independently; micro orbit 5–8° | `Orbital Display` | Very soft `<fabric rustling>` |
| 0:04–0:06 | Text layer undergoes subtle depth-of-field change (foregrounded / backgrounded) | `Material Shift` | — |
| 0:06–0:08 | Camera slowly pulls back to a wide shot | — | BGM fades |
| 0:08–0:10 | Lock-frame + micro motion | `Breathing Pulse` | Very low ambient |

### Direction 5 storyboard (Particle / Wireframe / Point-Line-Plane Reconstruction)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Poster elements are first decomposed into points / lines / planes / particles / wireframes / graphic fragments, scattering off-screen for 0.5–0.8s | — | `<shimmer>` |
| 0:02–0:04 | Elements aggregate from outside to inside, bottom-up, into the poster layout | `Particle Reconstruction` | `<glitch>` / `<whoosh>` |
| 0:04–0:06 | Subject aggregation completes; title and logo land via `Jelly Pop` | `Jelly Pop` | Character beats |
| 0:06–0:08 | Supporting and decoration aggregate | `Card Slide-in` | `<swoosh>` |
| 0:08–0:10 | Lock-frame + micro motion | `Breathing Pulse` / `Lens Flare Blink` | Very low ambient |

### Direction 6 storyboard (Light and Material Micro-Sculpting)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Poster slowly fades in; volumetric light begins to sweep across metal / glass / plastic / fabric / skin / food / architecture surfaces from one side | `Material Shift` | `<shimmer>` |
| 0:02–0:04 | Highlights and reflections light up one by one; reflected environment flares appear | `Lens Flare Blink` | `<subtle texture sound>` |
| 0:04–0:06 | The text layer is precisely lit by a side beam; text edges briefly glow | `Material Shift` | `<swoosh>` |
| 0:06–0:08 | Shadows and highlights stabilize | — | BGM fades |
| 0:08–0:10 | Lock-frame + micro motion (continuous very subtle light flares drift) | `Breathing Pulse` / `Lens Flare Blink` | Very low ambient |

### Direction 7 storyboard (Kinetic Typography Layout Build)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Background fills in; main title writes stroke by stroke along the brush direction | `Kinetic Typography` | `<pen scratching>` |
| 0:02–0:04 | Main title finishes; subtitle appears with `Typewriter` or `Scroll Unroll` | `Typewriter` / `Scroll Unroll` | `<typewriter click>` / `<paper sliding>` |
| 0:04–0:06 | Logo lands via `Jelly Pop` | `Jelly Pop` | Character beats |
| 0:06–0:08 | Supporting info (date / venue / event info) appears via `Card Slide-in` | `Card Slide-in` | `<swoosh>` |
| 0:08–0:10 | Lock-frame + micro motion | `Breathing Pulse` | Very low ambient |

### Direction 8 storyboard (Physical Atmosphere Loop)

| Timestamp | Visual action | Motion effect term | Onomatopoeia / SFX |
|---|---|---|---|
| 0:00–0:02 | Poster forms; rain / snow / smoke / mist / wind / dust / sparks / flares / water ripples / paper grain / film grain begin to lay the base | `Lens Flare Blink` | Element-corresponding ambient (rain / wind / current etc.) |
| 0:02–0:04 | Subject only does very subtle hair / clothing / smoke / mist drift | `Material Shift` | Ambient continues |
| 0:04–0:06 | Title / light layers slowly change (light flare drift / shadow gentle swing) | `Lens Flare Blink` / `Material Shift` | Ambient continues |
| 0:06–0:08 | Atmospheric loop stabilizes | — | BGM fades |
| 0:08–0:10 | Lock-frame + micro motion | `Breathing Pulse` / `Lens Flare Blink` | Very low ambient |

### Direction-specific storyboard general rules

- 8s version: proportionally compress all time slots; no slot shorter than 0.5s.
- 15s version: extend middle segments (core anchor / main title) by +0.5–1s each; everything else unchanged.
- If a poster has many elements, prioritize compressing the "supporting and decoration" segment; never compress the stability gap (every element must have ≥0.5s stabilization time after entrance).
- All directions must keep the final lock-frame identical to the original poster, with readable text and full-frame content.

## Step 8: Audio design

MiniMax H3 synchronized audio is on by default. Storyboard and prompt must include:

### 8.1 BGM ambience (throughout)

- One restrained ambient bed runs through the entire video; volume is restrained and does not overpower.
- Rhythm curve: soft bed at opening → stronger during climax → fade to low-level ambient after lock.
- After settling, do not go fully silent; retain very low-volume continuous ambient bed to match the post-lock micro motion.

### 8.2 Onomatopoeia style library (lock one set per direction; keep consistent)

MiniMax H3 responds well to Chinese-style onomatopoeia; **writing onomatopoeia explicitly is more reliable than relying only on English SFX tags**. Based on the chosen direction's mood, lock one onomatopoeia style library:

| Direction mood | BGM style | Onomatopoeia style (examples) | Applicable directions |
|---|---|---|---|
| **Restrained / elegant** | Minimal electronic + piano overtones | "咻——叮！" / "嗒——" | Direction 1, 4, 6 |
| **Impact / striking** | Drum hits + low-frequency bass | "轰——" / "啪嗒！" / "啵-唧-啵" | Direction 2, 3 |
| **Tech / professional / B2B** | Synth pad + electric current | "嗡——" / "嘶——" / "咔哒" | Direction 5, 6 |
| **Artistic / humanistic** | Piano / acoustic guitar / strings | "沙沙——" / "唰——" / "滴答滴答" | Direction 7 |
| **Modern / design / geometric** | Electronic beat + rhythmic chips | "嗖——" / "咔哒" / "叮-咚-铛" | Direction 5, 8 |
| **Cinematic / atmosphere / mood** | Strings + granular ambient | "呼——" / "咝——" + environmental foley | Direction 4, 8 |

### 8.3 Per-element-type SFX mapping

| Element type | English SFX tag | Recommended onomatopoeia (Chinese-style) | Trigger action |
|---|---|---|---|
| Character entrance | `<footsteps>`, `<fabric rustling>` | "嗒——嗒——" footsteps / "沙——" clothing | Running / walking / turning |
| Product entrance | `<mechanical rotation>`, `<parts clicking>` | "嗡——咔哒" / "啵唧" | Rotation / rise / assembly |
| Text entrance | `<pen scratching>`, `<paper sliding>` | "沙沙——" / "唰——" | Writing / sliding in |
| Graphic / texture entrance | `<subtle texture sound>` | "嘶——" very soft | Fade in / material change |
| Background bed | `<ambient drone>` | Continuous low-frequency ambient | Full duration |
| Direction 2 paper roll | `<paper roll drop>`, `<impact>`, `<paper unfurling>`, `<paper flutter>`, `<paper settling>` | "轰——" drop / "啪嗒" snap / "唰——" unfurl / "沙沙" flutter / "嗒" settle | Paper-roll phases |
| Post-lock micro motion | — | Very low-volume continuous ambient | After lock |

### 8.4 Per-direction SFX sequence

| Direction | SFX sequence (by timestamp) |
|---|---|
| Direction 1 Progressive Activation | ambient drone on → per-element SFX (by entrance order) → ambient fades at settle |
| Direction 2 Paper-Roll Reveal | paper roll drop → impact → paper unfurling → paper flutter → paper settling → element SFX continues → ambient |
| Direction 3 Breakout | whoosh out → softened impact → element SFX → ambient |
| Direction 4 Parallax | ambient drone full duration → very soft fabric rustling (during orbit) → ambient |
| Direction 5 Particle Reconstruction | shimmer (scatter) → glitch (aggregating) → element SFX → ambient |
| Direction 6 Light & Material | shimmer (light sweep) → subtle texture sound (material change) → ambient |
| Direction 7 Kinetic Typography | pen scratching (main title) → typewriter click (subtitle) → swoosh (supporting) → ambient |
| Direction 8 Physical Atmosphere | element-corresponding ambient (rain / snow / smoke / mist / wind / current) full duration → fades at settle |

### 8.5 SFX discipline

- SFX must strictly follow the element-by-element sequential timing
- Never play SFX for an element that has not yet entered
- Never stack multiple element SFX simultaneously
- Each SFX triggers only when its element's entrance action begins, and naturally decays after the element settles
- Post-lock micro-motion SFX volume must be far below the entrance SFX

### 8.6 Optional background BGM (user opt-in)

> **New in v1.0.0.** The original poster video uses H3 synchronized audio (per-segment SFX + ambient). Users may opt in to also receive a separately generated background BGM track, mixed in at assembly time (Step 9.3).

**Opt-in decision rules:**

| User signal | Default behavior |
|---|---|
| User explicitly says "加 BGM" / "with BGM" / "要背景音乐" | `bgm_required: true` |
| User explicitly says "不加 BGM" / "no BGM" / "纯拟音" | `bgm_required: false` |
| No signal | `bgm_required: false` (default, do not surprise the user) |

**BGM generation rules:**

- BGM is generated **separately** from the per-segment SFX audio (do not ask H3 to mix BGM in).
- BGM prompt inherits the locked direction mood (Step 8.2 onomatopoeia style table) and the poster's visual atmosphere.
- BGM style mapping (lock one per video):

| Direction mood | BGM style | Suggested BGM prompt seed |
|---|---|---|
| Restrained / elegant | Minimal electronic + piano overtones | "minimal electronic with soft piano overtones, restrained, atmospheric, 10s loop" |
| Impact / striking | Drum hits + low-frequency bass | "cinematic impact drums with deep bass, striking, 10s" |
| Tech / professional / B2B | Synth pad + electric current | "synth pad with subtle electric texture, tech, professional, 10s" |
| Artistic / humanistic | Piano / acoustic guitar / strings | "soft piano with acoustic guitar, artistic, intimate, 10s" |
| Modern / design / geometric | Electronic beat + rhythmic chips | "modern electronic beat with rhythmic chips, design, geometric, 10s" |
| Cinematic / atmosphere / mood | Strings + granular ambient | "cinematic strings with granular ambient, atmospheric, mood, 10s" |

- BGM target length: ≥ final video duration (so it can be looped or trimmed).
- BGM volume at mix-in: -18dB to -22dB relative to SFX (BGM sits under SFX, never overpowers).
- Tool: `batch_text_to_music` (Step 9.3.2).
- If the user does not opt in, do not generate BGM, do not show BGM-related choices.

## Step 9: Generation pipeline (keyframe → segment → assemble)

> **Rewritten in v1.0.0.** The old "single H3 call, one continuous shot" pipeline is replaced by a three-stage pipeline: pre-render keyframes → render per-segment video → FFmpeg assemble + optional BGM mix. This is the standard ComfyUI H3 practice and produces more reliable results.

### 9.1 Pre-render keyframes (image_synthesize)

**Goal:** turn the storyboard's "Track B · keyframe image" into real images that anchor the video.

**Per keyframe, write a keyframe prompt that includes:**
- The locked aspect ratio (9:16 / 16:9 / etc.)
- A 1:1 visual description of the frame at that timestamp (composition, element positions, text, lighting, color)
- The motion effect term that has just completed entering (e.g., "Jelly Pop landed", "Parallax Push-in settled")
- For the lock-frame (keyframe N): explicit "preserve the original poster composition, color, and text layout 1:1"

**Tool: `image_synthesize` (one call can render up to 10 keyframes in parallel).**

**Hard rules:**
- Render all keyframes in **one batched call** when count ≤ 10; otherwise split into multiple calls.
- Aspect ratio must match the locked ratio (Step 2).
- Resolution: 1K is usually sufficient; use 2K if the poster is text-heavy and final lock-frame is critical.
- The last keyframe MUST be a 1:1 restoration of the original poster (use the poster as a `input_file_paths` reference for the lock-frame call).
- Save all keyframes under `output/<case_id>/keyframes/kf_NN.png` with zero-padded numbering.

### 9.2 Render per-segment video (gen_videos / batch_image_to_video)

**Goal:** turn each storyboard segment between two adjacent keyframes into a short video clip.

**Per segment, the call structure is:**
- `input_image_path` = the **previous** keyframe (e.g., segment 1 uses `kf_01.png` as `first_frame`, segment 2 uses `kf_02.png` as `first_frame`, etc.)
- `reference_type` = `first_frame` (the previous keyframe is the starting frame; the model interpolates to the natural end of the segment)
- `prompt` = the per-segment prompt derived from Step 10's shot-segment template
- `duration` = segment length (typically 1–3s; tool limits: 6s or 10s — if a segment is shorter, generate at 6s and trim at assembly)
- `resolution` = 1080P (or 768P when tool-limited; 2K deferred)

**Tool: `batch_image_to_video` (parallel per-segment calls when count ≤ 5).**

**Hard rules:**
- One call per segment; never one call for the whole video.
- The segment prompt must reference the previous keyframe and the next keyframe target implicitly.
- Save all segment videos under `output/<case_id>/segments/seg_NN.mp4`.
- After all segments are rendered, **manually verify** the last keyframe actually appears as the final frame of the last segment; if not, the segment is invalid and must be re-rendered with stronger "end at the next keyframe" wording in the prompt.

### 9.3 Assemble + optional BGM mix (FFmpeg)

**Goal:** concatenate the per-segment videos into a single deliverable, optionally mixing in a BGM track.

#### 9.3.1 Video concat (always)

```bash
# Build concat list
ls output/<case_id>/segments/seg_*.mp4 | sort | sed "s|^|file '" | sed "s|$|'|" > /tmp/concat.txt

# Concat with re-encode (safe; preserves all streams)
ffmpeg -f concat -safe 0 -i /tmp/concat.txt -c copy output/<case_id>/assembled.mp4
```

- If the tool requires a common codec, re-encode with `ffmpeg -f concat -safe 0 -i /tmp/concat.txt -c:v libx264 -crf 18 -c:a aac output/<case_id>/assembled.mp4`.
- Concatenated video is the **primary deliverable**.

#### 9.3.2 Optional BGM (only if `bgm_required: true`)

- Generate BGM via `batch_text_to_music` using the prompt seed from Step 8.6 mood table.
- Target length: ≥ final video duration. Sample rate 44100, bitrate 128000+, format mp3.
- Save under `output/<case_id>/bgm/bgm.mp3`.
- Mix BGM under SFX with `ffmpeg`:

```bash
# Loop BGM to match video length, lower volume to -20dB, mix with original audio
ffmpeg -i output/<case_id>/assembled.mp4 -stream_loop -1 -i output/<case_id>/bgm/bgm.mp3 \
  -filter_complex "[1:a]volume=0.1[bgm];[0:a][bgm]amix=inputs=2:duration=first" \
  -c:v copy -c:a aac -shortest output/<case_id>/final.mp4
```

- BGM volume (0.1 ≈ -20dB) is the recommended starting point; adjust per user feedback.

#### 9.3.3 Final delivery file

- Primary: `output/<case_id>/final.mp4` (assembled video, with BGM if opted in)
- Backup: `output/<case_id>/assembled.mp4` (no BGM, SFX only)
- The final video's last 1–2s uses Breathing Pulse / Lens Flare Blink / Material Shift only (matches v0.8.1 lock-frame constraint, now applied to the assembled video rather than a single-shot generation).

- Use MultiModalToVideo / MiniMax H3 multimodal reference mode.
- Use the uploaded poster as the primary `image_infos` reference and treat it as the end-state / final-lock reference in the prompt, not a required opening frame.
- If the user uploads additional reference images, videos, or audio, pass them into the corresponding multimodal reference slots when useful.
- Generate the whole video in one call; do not split into multiple generations.
- Resolution is fixed to 2K.
- Ratio is the mapped ratio from Step 2.
- Duration is an integer from 8–15s based on storyboard pacing.
- Synchronized audio is enabled.

## Step 10: Prompt writing (Storyboard Script Format + Keyframe)

The prompt must stay under 7000 characters (including the `<<<image_1>>>` tag) and follow the user's conversation language. **Use a storyboard-script structure** (the mainstream H3 practice from the ComfyUI community): an opening "global ambience" paragraph + N timestamped "shot segments" + a closing "lock-frame constraint" paragraph + a final "audio paragraph". MiniMax H3 responds strongly to explicit timestamps + motion effect terms + onomatopoeia — **this is far more reliable than abstract descriptions**.

> **v1.0.0 update:** prompts are now written **per segment**, not as one monolithic prompt. Each per-segment prompt is shorter (≤ 1500 characters), focuses on the motion between two adjacent keyframes, and references the previous keyframe as the `first_frame` (set in the tool call, not in the prompt text). Keyframe rendering uses a separate keyframe prompt format (Step 10.5).

### 10.1 Structure overview

```
[Global ambience paragraph]   ← a short global declaration (≤300 chars)
   ↓
[Shot segment 1: 0:00–0:01]   visual action + motion term + onomatopoeia
[Shot segment 2: 0:01–0:02]   ...
...
[Shot segment N]
   ↓
[Lock-frame constraint paragraph]   ← settle + lock + micro motion
   ↓
[Audio paragraph]   ← BGM + onomatopoeia summary + SFX discipline

> **v1.0.0: per-segment prompts only cover one segment each.** The monolithic prompt above is shown for reference but is no longer sent in one call. Instead, Step 10.5 below defines a separate keyframe prompt format.
```

### 10.2 Global ambience paragraph (opening, ≤300 chars)

Write in this order:

1. **Baseline declaration**: use `<<<image_1>>>` as the final-frame reference; the opening frame may be blank, partial, or abstract; the final frame restores composition, colors, and text; full-frame content, no black bars, no blank space, no letterbox/pillarbox.
2. **Ratio adaptation** (if deviation exists): keep the poster core content centered, extend background color and texture into the extra area to fill the full frame, do not crop core content, do not add black bars, do not stretch.
3. **Selected direction declaration**: dynamic direction = [direction name]; mood = [restrained / impact / tech / artistic / modern / cinematic]; aspect ratio = [final ratio]; duration = [N seconds].
4. **Core hard constraint**: `single continuous shot, no cuts, no transitions`.
5. **Text protection**: keep poster text readable, undistorted, unblurred, and fully still after placement.
6. **Onomatopoeia style lock**: [restrained / impact / tech / artistic / modern / cinematic], using the corresponding onomatopoeia style library (see Step 8.2).

### 10.3 Shot segment writing (main body, N segments ordered by timestamp)

**Every shot segment must include 4 items**:

```
[Shot X · timestamp 0:XX–0:XX]
Visual action: [specific visual action description, including motion effect term from Step 6 reference]
SFX: [corresponding onomatopoeia + English tag]
Depth layer: [far / middle / near / foreground / background]
```

#### Writing discipline

- Timestamps must match the storyboard table and reflect the real duration (8/10/15 seconds).
- Motion effect terms must use the standard terminology from the Step 6 reference (Chinese or English); never invent your own.
- Each shot segment describes **only one main element's action**; **never combine multiple elements moving simultaneously in the same shot segment**.
- Onomatopoeia must align with the visual — character entrance uses footsteps / clothing; product uses mechanical; text uses pen / paper; direction-specific onomatopoeia (paper roll / light sweep / slice / line art / atmosphere) is called from Step 8.4.
- The previous element must be fully settled and stable for ≥0.5s before the next element starts (naturally enforced by keeping adjacent shot segments ≥0.5s apart).
- Shot segments are ordered by ascending timestamp; never reorder.

### 10.4 Lock-frame constraint paragraph (closing)

- 1–2s settling transition (motion decelerates to stable).
- The character / subject / main visual MUST end exactly in its original poster position — no horizontal drift, no scale change, no z-axis shift. The final frame must preserve the original composition, color, and text layout 1:1.
- After lock, only retain very subtle `Breathing Pulse` / `Lens Flare Blink` / `Material Shift`; the subject's proportion and composition must not change.
- Text is fully still and aligned to its original position.
- Full-frame content throughout, no black bars, no blank space, no letterbox/pillarbox.

### 10.5 Audio paragraph (final)

Organize as follows:

```
[Audio paragraph]
BGM: [overall style + rhythm curve (soft bed at opening → climax strengthens in mid section → fades to low-level ambient at settle)].
[SFX sequence]
- [timestamp + onomatopoeia + element name + English tag]
- ...
[Post-lock micro-motion SFX]
Very low-volume continuous ambient / material change sound, far below the entrance SFX.
[SFX discipline]
- Strictly follow the element-by-element sequential timing
- Never play SFX for an element that has not yet entered
- Never stack multiple element SFX simultaneously
- Each SFX triggers only when its element's entrance action begins, naturally decays after settling
```

### 10.6 Full prompt template example (Direction 1 · 10s)

> User uploads a person poster (composition: woman centered, large title "THE MOMENT", subtitle "——关于夏天的所有"), Direction 1 selected:

```
<<<image_1>>> as the final-frame reference; opening starts from a clean full-frame white canvas; the final frame restores the poster's composition, colors, and text; full-frame content, no black bars, no blank space, no letterbox/pillarbox. Aspect ratio 9:16, duration 10 seconds, dynamic direction = Direction 1 Progressive Activation, mood = restrained/elegant, using the restrained onomatopoeia style. single continuous shot, no cuts, no transitions. Keep poster text readable, undistorted, unblurred, and fully still after placement.

[Shot 1 · 0:00–0:01]
Visual action: Full-frame pure white base fills the frame; no elements. Depth layer: background.
SFX: BGM fade-in, "嗡——" low-frequency ambient continues <ambient drone>.

[Shot 2 · 0:01–0:02]
Visual action: Background and base color block structure (beige soft halo + edge light film grain) fades in. Motion: Material Shift. Depth layer: background.
SFX: "嘶——" very soft <subtle texture sound>.

[Shot 3 · 0:02–0:04]
Visual action: Female subject pushes in from far depth to middle to near, then lands in the final poster pose (slight head tilt, holding a coffee cup). Motion: Parallax Push-in + Scale & Bounce. Depth layer: far → middle → near.
SFX: "嗒——嗒——" footsteps <footsteps> + "沙——" clothing <fabric rustling>.

[Shot 4 · 0:04–0:04.5]
Visual action: Subject stabilizes for 0.5s; no new elements enter. Depth layer: near.
SFX: Footstep and clothing SFX decays to silence.

[Shot 5 · 0:04.5–0:06]
Visual action: Main title "THE MOMENT" writes stroke by stroke along the brush direction; characters have a light Jelly Pop on landing. Motion: Kinetic Typography + Jelly Pop. Depth layer: foreground.
SFX: "沙沙——" pen tip <pen scratching> + a soft "嗒" on each character landing <typewriter click>.

[Shot 6 · 0:06–0:06.5]
Visual action: Main title stabilizes for 0.5s; text is fully still. Depth layer: foreground.
SFX: Pen tip SFX decays.

[Shot 7 · 0:06.5–0:08]
Visual action: Subtitle "——关于夏天的所有" unrolls horizontally as a Scroll Unroll; bottom date tag "2026.08" slides in as a Card. Motion: Scroll Unroll + Card Slide-in. Depth layer: middle.
SFX: "唰——" scroll unroll <paper sliding> + "嗖——" card slide-in <swoosh>.

[Shot 8 · 0:08–0:09]
Visual action: Settling transition; all element motion decelerates to stable. Depth layer: middle.
SFX: BGM fades.

[Shot 9 · 0:09–0:10]
Visual action: Post-lock micro motion. Subject only retains very subtle breathing (slight chest rise/fall), hair drift, slow film grain flow in the background; subtitle text is fully still. Motion: Breathing Pulse + Material Shift. Depth layer: middle.
SFX: Very low-volume ambient continues.

[Lock-frame constraint]
After restoration, settle for 1–2s, then keep very subtle motion until the end. The subject MUST end exactly in her original poster position (no horizontal drift, no scale change, no z-axis shift); only retain Breathing Pulse / Lens Flare Blink / Material Shift; text is fully still and aligned to original positions; full-frame content throughout; preserve the original composition, color, and text layout 1:1.

[Audio paragraph]
BGM: Minimal electronic + piano overtones; rhythm curve is soft bed at opening → 0:02–0:06 section strengthens with the subject entrance → 0:08 settle fades to low-level ambient.
SFX sequence:
- 0:00 "嗡——" <ambient drone> on
- 0:02 "嗒——嗒——" footsteps <footsteps> + "沙——" clothing <fabric rustling>
- 0:04.5 "沙沙——" pen tip <pen scratching>
- 0:04.5–0:06 "嗒" per character landing <typewriter click>
- 0:06.5 "唰——" scroll unroll <paper sliding>
- 0:07.5 "嗖——" card slide-in <swoosh>
- 0:08 BGM fades
Post-lock micro-motion SFX: very low-volume ambient continues + very soft "嘶——" material change.
SFX discipline: strictly follow the element-by-element sequential timing; never play SFX for an element that has not yet entered; never stack multiple element SFX simultaneously; each SFX triggers only when its element's entrance action begins, naturally decays after settling; post-lock SFX volume must be far below the entrance SFX.
```

### 10.7 Hard constraints that must be written explicitly

- `single continuous shot, no cuts, no transitions`
- `<<<image_1>>>` as the final-frame reference (within the first 50 characters)
- Aspect ratio declaration (within the first 100 characters)
- Duration declaration (within the first 100 characters)
- Text protection declaration (within the first 200 characters)

### 10.5 Keyframe prompt format (new in v1.0.0)

Each keyframe is rendered via `image_synthesize` with a **static-image prompt**. Format:

```
[Keyframe NN · <timestamp> · <role: opening | mid | lock-frame>]

Aspect ratio: <9:16 | 16:9 | 4:3 | 1:1 | 3:4 | 21:9>
Resolution: 1K | 2K
Style reference: <reference the source poster + motion effect term that just completed>

Scene description:
- Background: <color, texture, lighting>
- Visual anchor: <character / product / typography / abstract — pose, position, scale>
- Text: <title position, content, color, font weight; subtitle position, content, color; decoration text>
- Decoration: <secondary elements, supporting graphics, atmosphere effects>
- Composition: <foreground / midground / background layer order>

[If role = lock-frame, add:]
Lock-frame rule: this keyframe MUST restore the original poster 1:1 — same composition, same color, same text layout. Use the source poster as the visual reference.
```

**Keyframe prompt example (KF2 of a 10s D1 storyboard):**

```
[Keyframe 02 · 0:04 · mid]

Aspect ratio: 9:16
Resolution: 1K
Style reference: source poster + Parallax Push-in settled + Scale & Bounce landed

Scene description:
- Background: night-palace rooftops, dim candlelight, dark indigo + warm candle amber
- Visual anchor: woman in red hanfu, center-frame, head-and-waist crop, holding a folded fan in right hand, slight head tilt (final poster pose)
- Text: empty (title enters next)
- Decoration: two candle stands left/right, faint candlelight flares
- Composition: anchor at depth "near", background at depth "far", text layer absent

```

**Discipline:**
- Keyframe prompts are static-image prompts; do NOT include motion-effect verbs in the keyframe description (the motion is what `gen_videos` does *between* keyframes, not what `image_synthesize` renders).
- The lock-frame keyframe (last one) must include "preserve original poster 1:1" rule and pass the source poster as `input_file_paths`.
- All keyframes must match the locked aspect ratio; do not change ratio mid-sequence.

## Step 11: Delivery

> **Rewritten in v1.0.0.** The old "one generated video" delivery is replaced by a multi-asset delivery (assembled video + keyframe pack + optional BGM).

The animated poster deliverable consists of:

**Required assets (always):**
- `output/<case_id>/final.mp4` — the assembled animated poster video (Step 9.3 output, BGM-mixed if opted in). Primary deliverable.
- `output/<case_id>/assembled.mp4` — SFX-only version, no BGM (kept as backup).
- `output/<case_id>/keyframes/kf_*.png` — all rendered keyframe images (5–9 typically). Useful for the user to inspect, regenerate individual segments, or remix.
- `output/<case_id>/segments/seg_*.mp4` — per-segment raw videos (kept in case the user wants to re-assemble with different transitions or replace a single segment).
- `Final_Video_Spec.md` — the locked spec from Step 6.
- `prompt.md` — the per-segment prompts + keyframe prompts (for reproducibility).

**Optional assets (only if `bgm_required: true`):**
- `output/<case_id>/bgm/bgm.mp3` — generated BGM track.
- `output/<case_id>/final.mp4` includes the BGM mix (overwrites the SFX-only assembled version).

**Delivery rules:**
- Always preserve full duration (do not trim the final video).
- Always deliver both `final.mp4` (with optional BGM) AND `assembled.mp4` (without BGM), so the user can swap BGM later.
- If any segment failed QA (Step 9.2 "last frame must match next keyframe"), re-render that segment before delivery; never deliver a known-bad segment.
- After delivery, ask whether the user wants adjustment, another direction, re-render any keyframe/segment, or export.

---

## Changelog

### v1.0.0 (2026-08-14) — Major methodology rewrite: single-shot → keyframe-segment-assemble pipeline

This is a methodology-level upgrade. The old "single H3 call, one continuous shot" pipeline is replaced by a three-stage pipeline (keyframe → segment → assemble) with optional BGM. v0.8.0 / v0.8.1 are superseded; their lock-frame constraint logic is preserved and now applies to the assembled video's final segment.

- [refactor] **Step 6 Global spec lock**: added `keyframe_count` and `bgm_required` fields. Resolution is now 1080P for video segments (2K deferred when tool-limited). Camera mode is "per-segment single continuous shot" (segments joined by FFmpeg concat).
- [refactor] **Step 7 Storyboard**: added "Dual-track design: storyboard + keyframe" section. Every storyboard now has Track A (prompt / motion description) and Track B (keyframe image descriptions). Last keyframe = lock-frame = 1:1 restoration of original poster.
- [feature] **Step 8.6 Optional background BGM**: new opt-in BGM section. Default off. If user opts in, BGM generated via `batch_text_to_music` and mixed in at Step 9.3.2.
- [refactor] **Step 9 Generation pipeline**: completely rewritten. Now 9.1 (image_synthesize keyframes) + 9.2 (batch_image_to_video per-segment, prev keyframe as first_frame) + 9.3 (FFmpeg concat + optional BGM mix). The old "single H3 call" is removed.
- [refactor] **Step 10 Prompt writing**: prompts now per-segment (≤ 1500 chars each), focused on motion between two adjacent keyframes. New §10.5 keyframe prompt format added (static-image prompt for image_synthesize).
- [refactor] **Step 11 Delivery**: now multi-asset. Required: final.mp4 + assembled.mp4 + keyframe pack + segment pack + Final_Video_Spec + prompt.md. Optional: bgm.mp3 (only if opted in).
- [preserve] **v0.8.1 lock-frame constraint rule**: still applies. The final 1–2s of the assembled video uses Breathing Pulse / Lens Flare Blink / Material Shift only; text fully still; subject must not keep scaling or drifting; "preserve original composition, color, and text layout 1:1".
  - 原因: 用户明确要求按"prompt → 关键帧 → 拼接"5 步流程制作动态海报；当前工作流是"prompt + H3 一次生成"，新流程是"prompt + 关键帧 + 逐段 + 拼接"，属于方法论级变更，必须升 v1.0.0。
  - 影响范围: Step 6 / Step 7 / Step 8 / Step 9 / Step 10 / Step 11 全部受影响；v0.8.0 / v0.8.1 的所有改动视为历史快照。
  - 回滚方式: 不可回滚（方法论变更）；如需回退到老流程，git checkout v0.8.1 即可。
  - 验证方式: 用 v1.0.0 跑至少 3 个真实案例（觉醒人物 + zine 拼贴 + 文字海报），对比 v0.8.1 末帧失真率。

### v0.8.1 (2026-08-14)
- [fix] Step 10.4 lock-frame constraint rule: added explicit "character / subject / main visual MUST end exactly in its original poster position" + "preserve the original composition, color, and text layout 1:1" constraints.
- [fix] Step 10.4 lock-frame constraint rule: split "only retain micro motion" into a separate bullet and added "subject's proportion and composition must not change" guard.
- [fix] Step 10.4 lock-frame constraint rule: added "text is fully still and aligned to its original position" (was "fully still" only).
- [fix] Step 10.4 lock-frame constraint rule: reinforced "no black bars, no blank space, no letterbox/pillarbox" (was "no black bars" only).
- [sync] Step 10.6 full prompt template example: updated the [Lock-frame constraint] block to mirror the new §10.4 wording, so the example prompt matches the rule.
- [sync] SKILL.cn.md: §10.4 and §10.6 example block updated with matching Chinese wording (中英版本同步).
  - 原因: 觉醒海报 D1 跑测发现末帧女主脸偏左、标题"觉醒"二字粘连; 5 个案例中 3 个有末帧失真问题(翻车级别: 硬伤)
  - 影响范围: 全 8 个方向(末帧约束通用, 不分方向)
  - 回滚方式: 恢复 §10.4 / §10.6 / §10.6 模板示例的 4 处原 wording
  - 验证方式: 改前 case_001-005 末帧失真率 60%; 改后待 5 个案例复跑, 目标 ≤ 10%
