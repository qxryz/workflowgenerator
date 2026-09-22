# Style system

Use this reference to choose a preset or tune a difficult source. Define the look
through observable production limits rather than one film, game, engine, or meme.

## Visual thesis

Aim for **sincere technical insufficiency**: an understandable scene built with too
few polygons, failed proportions, crude rigging, poor collision, too few textures,
too few assets, and lighting placed without mature cinematography. The charm should
be accidental, direct, and awkward rather than a refined low-poly aesthetic.

## Eleven style pillars

### 1. Coarse geometry

- Use few large planes, awkward edge flow, hard normals, and lumpy silhouettes.
- Build joints from blocks, hands from wedges or rectangular fingers, and faces
  from crude cheek, brow, nose, jaw, and mouth planes.
- Use visibly fewer masses, not merely smaller triangles. Heads, torsos, limbs, and
  animal bodies should not retain smooth source-faithful outlines through dense facets.
- Avoid clean triangular mosaics, elegant facets, smooth subdivision, and toy forms.

### 2. Broken proportions

- Release source-faithful head/body ratio, limb length, torso width, neck length,
  joint size, paw/hoof scale, muzzle size, and animal body mass.
- Mix oversized heads or paws with short limbs, rigid necks, broad torsos, narrow
  shoulders, uneven leg lengths, or mismatched primitive parts.
- Keep species, person count, clothing category, semantic action, and broad identity
  readable. The result may be foolish or clumsy, but not horrific or injury-like.

### 3. Failed pose and rigging

- Preserve the meaning of the action while changing exact joint angles and balance.
- Use locked torsos, shoulders lifted too high, elbows kinked on one axis, wrists
  that do not compensate, straight knees, planted feet, floating hands, and weak contact.
- Remove natural counter-pose, subtle weight transfer, muscle deformation, and the
  smooth shoulder/elbow/hip behavior of a competent character rig.

### 4. Visible collision failures

- Add one to three plausible intersections in contact-heavy images: sleeve into
  elbow, upper arm through shoulder or garment, hand into sleeve or held prop,
  loose clothing into torso, fur into harness, or adjacent bodies slightly intersecting.
- Keep clipping legible and local. Do not hide faces, erase full limbs, expose bodies,
  imply injury, or make every joint penetrate every mesh.

### 5. Unrefined faces and gaze

- Reuse simple eyeball and eye-texture construction across multiple characters.
- Allow unequal eye sizes, slightly off-center pupils, imperfect gaze convergence,
  stiff eyelids, crude brows, flat mouth slits, and frozen expressions.
- Keep the broad emotion readable; remove professional subtle acting and beauty polish.

### 6. Tiny rough textures

- Use visibly small, blurry diffuse maps with seams, mirrored details, UV stretching,
  inconsistent scale, crude painted shadows, and limited color steps.
- Make diffuse/base color the dominant or only material channel. Remove coherent
  PBR response, normal/displacement detail, subsurface skin, layered fabric/fur,
  clearcoat, and realistic reflections. Mix dead-flat areas with a few wrongly shiny patches.
- Replace hair strands, fur grooming, pores, fabric weave, and fine embroidery with
  noisy repeated patches or a few thick texture cards.

### 7. Obvious repetition

- Reuse the same bark, grass, plank, stone, wall, fur, scale, cloth, skin, hair,
  and eye maps where plausible.
- Make tiling visible. Repetition is evidence of a small asset budget, not a flaw
  to hide with procedural variation.

### 8. Sparse repeated background

- Keep only the minimum scene masses required to identify the setting.
- Reuse two or three tree, bush, post, rock, building, beam, or prop models many times.
- Remove small signs, decorative trim, incidental set dressing, and unique clutter.
- Avoid both detailed environments and deliberately clean voxel worlds.

### 9. Naive lighting

- Prefer one blunt directional or overhead-front light plus weak ambient fill.
- Allow flat local color, clipped foreheads/noses/hands, muddy eye sockets and necks,
  hard low-resolution shadows, weak contact shadows, and exposure mismatch.
- Avoid rim lights, beauty lights, three-point setups, soft bounce, global illumination,
  volumetric beams, bloom, cinematic fog, and carefully shaped facial light.

### 10. Cheap rendering and capture

- Use weak antialiasing, limited texture filtering, basic shadow maps, jagged edges,
  mild pixel crawl, fine noise, slight color fringe, and screen-capture softness.
- Keep these effects secondary. Do not substitute VHS, CRT, glitch, mosaic, or
  heavy JPEG damage for actual primitive assets.

### 11. Plain mood and color

- Anchor three to six large colors in the source, then render them bluntly.
- Favor sincere, homemade, literal, slightly washed-out or overexposed color.
- Keep dark scenes readable. Do not default to horror, sepia, teal-orange cinema,
  dramatic desaturation, or premium atmospheric depth.

## Presets

### `primitive_folk_cgi` — default

For general images, animals, people, landscapes, objects, and mixed scenes.

- extreme reconstruction; medium identity lock; extremely-low polygon budget;
- broken human/animal proportions, failed rigid posing, and local visible clipping;
- crude asymmetrical meshes and stiff gaze;
- obvious texture tiling and heavy asset reuse;
- sparse repetitive background;
- one naive light plus flat ambient;
- low production value that remains readable.

### `bright_folk_cgi`

Use when the user wants more likeness or a gentler result.

- high reconstruction; high identity lock;
- readable angular faces with fewer intentional gaze errors;
- rough textures and repeated background assets, but less aggressively;
- bright simple daylight with awkward exposure.

### `sunlit_game_map`

For architecture, streets, travel photos, and spatial scenes.

- modular block geometry; repeated facade and ground maps;
- very small prop library and sparse set dressing;
- blunt sky light plus one direction light; simple baked-looking shadows;
- no automatic dark industrial mood.

### `community_cgi_stage`

For portraits, dialogue, group shots, performances, and frontal compositions.

- exact head count and spacing; medium identity lock; semantic-action pose lock only;
- shared eye, skin, cloth, and hair assets; stiff hands and frozen expressions;
- local arm/sleeve/shoulder intersections where figures touch or gesture;
- shallow staged depth and repeated beams/backdrops;
- plain overhead-front light, uneven faces, and no cinematic separation.

### `rough_night_render`

Use only for genuine night sources or explicit night requests.

- a few crude point lights, short falloff, hard shadow maps, and dark gaps;
- repeated emissive maps; readable local colors;
- no horror treatment unless requested.

## Source adjustments

| Source | Lock | Deliberately reduce | Reuse |
|---|---|---|---|
| Portrait | count, facing direction, semantic action, hair mass, clothing blocks | silhouette, head/body ratio, exact pose, face planes, eye alignment, garment collision | eye/skin/hair maps |
| Group | count, spacing, semantic gestures, color blocks | individual proportions, exact joint angles, contact, fingers, garment fit | eyes, skin, cloth, hair assets |
| Animal | species, markings, semantic action, muzzle direction | body ratio, leg/paw scale, balance, fur collision, joints, facial refinement | fur/scale/eye maps |
| Landscape | horizon, landform, palette | foliage variety, rock detail, atmosphere | trees, bushes, grass, rocks |
| Architecture | massing, openings, perspective | trim, glass, facade detail, clutter | wall, roof, ground modules |
| Food/object | silhouette, count, arrangement | curves, labels, microtexture, reflections | surface and label-free maps |

## Strength and fidelity

- `medium`: recognizable and restrained; use only when likeness dominates.
- `high`: every object reads as rebuilt low-poly; detail remains moderately faithful.
- `extreme` (default): preserve subject semantics and composition only; release exact
  pose, silhouette, anatomy, and collision. Use extremely sparse primitive geometry,
  broken proportions, stiff failed rigging, local clipping, repeated maps, sparse
  assets, stiff gazes, and naive lighting.

Use `identity_lock: medium` by default. Raise to `high` only for explicit likeness;
never lower broad composition, semantic action, and subject-count/type locks.
