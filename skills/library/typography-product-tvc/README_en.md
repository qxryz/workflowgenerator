# Typography Product TVC

[中文版](README.md)

From product brief to cinematic TVC keyframes — your AI advertising creative director.

A skill that turns your AI agent into a **TVC Advertising Creative Director**, handling the complete creative pipeline for television commercials and brand advertising: from a product brief to production-ready multi-grid storyboard image prompts and video prompts.


## Mandatory Four-Step Flow

1. **Reference image + one-line request**: for example, “Make a 15-second TVC for this silver coupe.” The AI enters the full creative flow: requirement breakdown → creative concept → look confirmation → asset generation → storyboard + video script.
2. **Product multiview prompt → the image-generation model render**: the AI outputs a product multiview prompt for the image-generation model edit mode with the reference image, producing standardized multi-angle product views.
3. **3×3 storyboard prompt → the image-generation model render**: the AI outputs a 3×3 storyboard prompt with per-panel composition, lighting, camera direction, and typography placement; the user renders it with the multiview and environment references.
4. **Video prompts → MiniMax H3 segments → approval → final composite**: the AI splits the storyboard plan into matching segments, generates each MiniMax H3 segment separately, waits for approval, then assembles the final video with product-specific background music.




## Strict Five-Step Flow

The Skill now follows a fixed order: 1) collect reference images and brand name; 2) generate and confirm product multi-view images; 3) generate and confirm a 3×3 storyboard; 4) generate 3–5 video segments and review them one by one; 5) composite all approved segments and add product-matched BGM. If brand name, reference role, hero product, or product appearance is unclear, the Skill must ask before generating.

## Main Reference: Square Collage

The Skill now treats `reference-674fc8d5.mp4` as the primary reference for production thinking: square framing, square collage, dual-track narrative, micro-to-macro alternation, text as structural design, and smooth directionally consistent motion. Storyboards and MiniMax H3 segments should follow this reference for structure and pacing first, then use the live-action typography reference as a secondary motion reference when product features need smoother spatial text behavior.

## Three Typography Reference Modes

The Skill now includes four reference modes: Main “square square collage” for square or social-first dual-track TVCs and collage-led structure; A “K-pop studio group typography” for youth, fashion, sportswear, light lifestyle, and social product scenes; B “live-action 3D product feature words” for earbuds, phones, smart hardware, performance products, and human-device interaction; C “circular folding kinetic typography” for geometric products, packaging, logos, visual hooks, and premium motion-design moments. When creating the 3×3 storyboard and each MiniMax H3 segment, the Skill selects a primary and secondary reference based on product traits, feature claims, and visual style, then states the reason in the segment prompt.

## Lower-Panel Earbud Ad Template

The Skill now treats the earbud ad from `reference-674fc8d5.mp4` as a standard template: the the top area carries a human/info track and the bottom area carries the earbud product track, and typography must act as 3D feature words, circular rings, wipe words, or parameter labels that move in sync with subject motion and beat hits.

## Segment Approval and Music

After the 3×3 storyboard is approved, the Skill does not jump directly to a final video. It first generates 3–5 MiniMax H3 segments according to the storyboard plan. Each segment is reviewed separately; only approved segments are assembled into the final TVC. The main reference is the square square collage flow, and background music is matched to product category: tech uses electronic low-end, sports/outdoor uses light athletic beats, beauty/fragrance uses refined editorial beats, food and beverage uses bright pop rhythms, and automotive/mechanical products use cinematic hybrid music.

## How It Works

The workflow mirrors real TVC advertising production stages:

```
"Make a 30-second TVC for an outdoor camera"
        ↓
  Phase 1: Creative Brief        ← Client Brief
  Phase 2: Creative Proposal     ← Creative Director Pitch
  Phase 3: Look Development      ← Art Style Lock
  Phase 4: Pre-production        ← Casting & Wardrobe + Product Photography + Location Scouting
  Phase 5: Storyboard & Shoot    ← Storyboard + On-set Shooting
  Phase 6: Review & Iteration    ← Director's Review + Revisions
  Phase 7: Delivery              ← Final Delivery
        ↓
  Copy-paste-ready multi-grid storyboard image prompts,
  video prompts & creative docs
```

## Key Features

- **Mirrors real TVC production** — Casting & wardrobe, product photography, location scouting, storyboarding, shooting — each stage has a corresponding AI prompt deliverable
- **End-to-end creative pipeline** — From a one-line brief to deliverable storyboard prompts and video scripts, fully AI-driven
- **8 TVC narrative models** — Problem-solution, cinematic product breakdown, brand world crosscut, and more
- **Cinematic visual system** — 5 art style presets (A-E), 12 scene types, per-second camera choreography
- **Product + brand world dual narrative** — Not just product close-ups, but crosscut storytelling in real-world scenes
- **Copy-paste ready** — Output prompts work directly in the image-generation model / MiniMax H3 with no rework needed

## Demo

### Car TVC — Cinematic Product Breakdown

https://github.com/user-attachments/assets/541055ed-d716-4087-86e2-a27d375282ed

### Perfume TVC — Brand World Crosscut

https://github.com/user-attachments/assets/df2d51af-acc2-4f34-a228-8b35ea754345

## Quick Start: Making a Car TVC

A real end-to-end example — from a reference photo to a 15-second commercial.

### Step 1 — Provide a reference image + one-line brief

> "Make a 15-second TVC for this silver sedan"

<img src="https://github.com/user-attachments/assets/0d774888-0dbb-4fb7-a861-ca3116b812b7" width="400" alt="Reference: silver sedan" />

The AI enters the full creative pipeline: brief analysis → creative concept → art style → asset generation → storyboard + video script.

### Step 2 — AI generates multiview prompts → the image-generation model renders

The AI outputs product multiview prompts. Copy to the image-generation model (edit mode, pass in the reference image) to get standardized multi-angle product shots:

<img src="https://github.com/user-attachments/assets/9d97df38-79f1-4a6a-a6bb-0fdbd731faca" width="600" alt="Product multiview" />

### Step 3 — AI generates 3×3 storyboard prompts → the image-generation model renders

The AI outputs a 3×3 multi-grid storyboard prompt (with per-panel composition, lighting, and camera direction). Copy to the image-generation model (edit mode, pass in multiview + environment images):

<img src="https://github.com/user-attachments/assets/1ca54c8a-e1c2-4a13-8e67-461ea327f2ab" width="600" alt="3×3 storyboard grid" />

### Step 4 — AI generates video prompts → MiniMax H3 renders video

The AI outputs a MiniMax H3 video prompt (5 phases / 15s). Use the storyboard grid as the first frame + product multiview as the anchor, dual-image input to MiniMax H3 for the final video.

### Output Summary

| Deliverable | Tool | Purpose |
|-------------|------|---------|
| Product multiview | the image-generation model (edit) | Product anchor for subsequent steps |
| 3×3 storyboard grid | the image-generation model (edit) | Video first frame + visual QA |
| Multi-Phase video script | MiniMax H3 | Generate 15s final video |
| Creative brief document | — | Full creative brief for archival |

## Design Philosophy

Traditional AI-generated ads tend to be an endless loop of "product + black background + rotation." Typography Product TVC is different — it organizes prompt generation around the real TVC production SOP, so every prompt maps to a specific production stage:

- **Narrative-driven** — Determine the narrative model and creative direction first, then generate visuals; no mindless template filling
- **Dual-world crosscutting** — Product close-ups interweave with brand world scenes, telling stories like a real TVC
- **Per-second camera design** — Every storyboard panel has explicit shot size, angle, lighting, and transition logic
- **Progressive human-AI collaboration** — Intervene and adjust at every phase; not a black-box one-click generator

## Three Core Capabilities

### 1. Cinematic Product Breakdown

Product as sole protagonist, pure studio, multi-phase product micro-films:

- Component disassembly/assembly animations (floating parts, exploded views, snap-back)
- Material macro shots (brushed metal, glass refraction, carbon fiber weave)
- Precise per-second camera choreography (ultra-slow reveal → explosive rotation → macro dive)
- Cinematic studio lighting (low-key, side light silhouettes, light flowing with rotation)

### 2. Brand World Crosscut

Brand world and product world take turns, connected via match cuts:

- Action cameras → skydiving, diving, skiing, climbing
- Off-road vehicles → mountain roads, desert, snow
- Each Phase stays in one world; world switches happen between Phases

### 3. Lifestyle Film

Product stays in the brand world throughout — no studio cutaways:

- Running shoes on feet, watches on wrists, glasses on faces
- Highlighted through cinematography (low-angle tracking, slow motion, depth-of-field shifts)
- Hero Shot concentrated at the end

## Installation

### Cursor

```bash
git clone https://github.com/Ethanxwang/typography-product-tvc.git ~/.cursor/skills/typography-product-tvc
```

### Claude Code

```bash
git clone https://github.com/Ethanxwang/typography-product-tvc.git ~/.claude/skills/typography-product-tvc
```

## Entry Modes

| Mode | Trigger | Description |
|------|---------|-------------|
| **A: Full TVC Pipeline** | "帮我做一条xx产品广告" | Brief → Concept → Style → Assets → Keyframes → Package |
| **B: Quick Asset/Prompt** | "帮我做一个产品 Hero Shot" | Skip creative phase, go to asset or keyframe generation |
| **C: Storyboard** | Provide a TVC script/storyboard | Style → Assets → Convert storyboard to keyframes |
| **D: Iteration** | "这张产品图xx不对" | Fix and regenerate specific assets or keyframes |

## TVC Narrative Models

| Model | Name | Core Logic |
|-------|------|-----------|
| A | Problem-Solution | Pain point → product saves the day |
| B | Cinematic Product Breakdown | Multi-phase micro-film revealing USPs |
| C | Brand World Crosscut | Scene ↔ product close-up crosscutting |
| D | Lifestyle Film | Product stays in scene, highlighted by cinematography |
| E | Emotional Anchor | Emotional story, product as carrier |
| F | Montage Reveal | Visual spectacle → product reveal |
| G | Before/After | Before/after strong contrast |
| H | Brand Anthem | Values-driven, product closes |

## Deliverables

```
my-tvc-project/
├── concept.md                      # TVC creative brief
├── storyboard.md                   # Storyboard (if applicable)
│
├── assets/                         # Product asset prompts (the image-generation model)
│   └── prompts/
│       ├── product-multiview.md
│       ├── product-detail-01.md
│       ├── env-01-extreme-sports.md
│       └── ...
│
├── keyframes/                      # Storyboard keyframe prompts (the image-generation model)
│   └── prompts/
│       ├── grid-01-brand-world.md
│       ├── grid-02-product-world.md
│       ├── endframe.md
│       └── ...
│
└── video-scripts/                  # Multi-Phase video prompts (MiniMax H3)
    ├── segment-01-brand-world.md
    ├── segment-02-product-breakdown.md
    └── ...
```

## How to Use Deliverables

1. **Product multiview** — Copy prompts from `assets/prompts/product-multiview.md` into the image-generation model, edit mode, pass in reference image
2. **Storyboard keyframes** — Copy prompts from `keyframes/prompts/` into the image-generation model, edit mode, pass in multiview + environment images
3. **Video scripts** — Use Multi-Phase scripts from `video-scripts/` with the storyboard grid as first frame + product multiview, input to MiniMax H3

## Knowledge Base Architecture

Knowledge base is organized by crew roles in real ad production, loaded on demand:

| Crew Role | File | Real Production Equivalent | Loading |
|-----------|------|---------------------------|---------|
| Line Producer | `SKILL.md` | Production workflow control, phase transitions | Always loaded |
| Creative Director | `treatment.md` | Creative pitches, narrative models, category strategy, casting decisions | Creative Proposal |
| Director of Photography | `shot-language.md` | Shot language, art style system, scene types, composition paradigms | Look Dev / Storyboard |
| Production Team | `pre-production.md` | Casting & wardrobe, product photography, location scouting, asset consistency | Pre-production |
| Director | `storyboard.md` | Storyboard, video scripts, product breakdown, brand world shots | Storyboard & Shoot |
| Post-production | `delivery.md` | Output formats, iteration guide (11 failure modes) | Review / Delivery |

## License

MIT
