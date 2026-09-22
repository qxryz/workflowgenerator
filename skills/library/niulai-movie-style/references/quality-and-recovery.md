# Inverted quality gate and recovery

Inspect the generated image itself. Success means controlled low production value,
not conventional visual polish.

## Hard pass criteria

- **Hard anchor fidelity:** subject count/type, arrangement, semantic action, crop,
  camera, scene category, major props, and dominant color blocks remain recognizable.
- **Fidelity ceiling:** fine faces, eyes, hair, hands, garments, and background are
  visibly simplified; a near-exact polished reproduction fails.
- **Extremely sparse topology:** heads, torsos, limbs, animal bodies, hands, faces,
  foliage, and architecture use a handful of large crude masses. Dense small facets
  that preserve smooth silhouettes fail even if their normals look faceted.
- **Broken proportions:** human or animal head/body, limb, neck, torso, joint,
  muzzle, and paw/hoof ratios visibly depart from the source without changing the
  subject category or becoming horrific.
- **Failed pose and rigging:** semantic action survives, but joint flow, balance,
  weight transfer, torso compensation, and contact are stiff, simplified, or wrong.
- **Visible collision failure:** when plausible contact zones exist, one to three
  local mesh intersections are visible around sleeves, elbows, shoulders, garments,
  hands, held props, fur, or adjacent bodies. Perfectly clean collision fails; facial
  occlusion, missing limbs, exposure, injury-like deformation, or universal clipping also fail.
- **Crude gaze:** character eyes are stiff, slightly unequal or imperfectly aligned,
  and lack professional animation subtlety while remaining non-horrific.
- **Texture poverty:** maps are visibly tiny, blurry, stretched, mirrored, tiled,
  and inconsistent in scale; surfaces are not clean PBR or clay.
- **Material poverty:** diffuse/base color dominates. Normal/displacement, subsurface,
  layered fabric/fur, clearcoat, and realistic reflection models are absent. Flat
  matte areas, wrongly shiny patches, and inconsistent response replace coherent PBR.
- **Asset poverty:** background and repeated objects visibly come from a very small
  reused library; detailed unique set dressing fails.
- **Naive lighting:** illumination is blunt, uneven, and simple, with clipped local
  highlights, muddy patches, basic hard shadows, and no cinematic separation.
- **True reconstruction:** low quality comes from geometry, materials, repetition,
  lighting, and rendering—not only blur, noise, pixelation, or grading.
- **No invention:** add no unrequested subjects, props, horns, cow traits, captions,
  logos, interface, landmarks, or weather changes.

## Scored checks

Score each dimension 0–2. Accept at 20/26 or above only when all hard checks pass.

| Dimension | 0 | 1 | 2 |
|---|---|---|---|
| Broad anchors | lost | partly retained | clearly retained |
| Fidelity ceiling | too exact | mixed | detail clearly reduced |
| Topology budget | dense/smooth | mixed | extremely sparse masses |
| Proportions | source-faithful | mildly altered | visibly broken but readable |
| Pose/rigging | natural | partly stiff | rigid and technically failed |
| Collision | perfectly clean or destructive | subtle/inconsistent | local readable clipping |
| Faces/gaze | refined | partly stiff | crudely convincing |
| Textures | clean/unique | some roughness | tiny and repeated |
| Materials | coherent/PBR | partly simplified | diffuse-only and mismatched |
| Asset reuse | rich variety | some reuse | visibly limited library |
| Background | detailed | reduced | sparse and repetitive |
| Lighting | cinematic | simple | naively uneven |
| Capture restraint | gimmicky | some excess | secondary and subtle |

## Failure recovery

### Too faithful, attractive, or polished

Retry with: “Lock only count/type, layout, semantic action, camera, scene category,
major props, and large color blocks. Release exact pose, silhouette, anatomy, and
clean collision. Discard fine likeness and reduce topology, garment detail, unique
assets, and material sophistication.”

### Polygon count is still too high

Retry with: “Replace each head, torso, limb, paw, garment, and animal body with a
handful of large primitive masses. Remove small facets and silhouette-smoothing edge
loops. Do not reproduce a smooth source outline by tessellating it into many triangles.”

### Proportions remain correct or flattering

Retry with: “Keep subject type, identity anchors, and semantic action, but release
the source silhouette. Deliberately mismatch head/body ratio, limb lengths, neck,
torso width, joint size, muzzle, paws/hooves, and animal body mass. Make assembled
parts awkward rather than elegantly caricatured.”

### Pose still looks natural

Retry with: “Preserve only what the action means. Lock the torso, rotate joints on
one crude axis, raise shoulders too high, kink elbows, straighten wrists, plant feet,
weaken balance and contact, and remove counter-pose, weight transfer, and soft deformation.”

### Garments and bodies remain collision-free

Retry with: “Add one to three local visible intersections at source-evidenced contact
zones: sleeve into elbow, upper arm through shoulder or garment, hand into sleeve or
held prop, garment into torso, fur into harness, or adjacent bodies slightly intersecting.
Keep faces and complete limbs visible; do not imply injury or expose the body.”

### Eyes still look professionally animated

Retry with: “Reuse one crude eye model. Make eye sizes slightly unequal, pupils
off-center, gaze convergence imperfect, eyelids rigid, brows simple, and expression
frozen. Keep it readable and awkward, not grotesque or horrific.”

### Background is too detailed

Retry with: “Delete incidental set dressing. Keep only essential scene masses.
Reuse two or three tree/building/beam/post/rock models many times with minimal
variation. No individually authored clutter or atmospheric depth.”

### Textures are too clean or varied

Retry with: “Replace surfaces with tiny blurry diffuse maps. Make tiling, seams,
UV stretch, mirrored details, inconsistent scale, and reuse clearly visible.
Reuse the same map across multiple compatible objects.”

### Materials still look premium

Retry with: “Remove coherent PBR material response. Use diffuse/base color as the
only reliable channel. Delete normal, displacement, subsurface, clearcoat, layered
fabric/fur, and realistic reflections. Make broad areas dead-flat, allow a few wrongly
shiny patches, and let nearby objects react inconsistently to the same light.”

### Lighting is too professional

Retry with: “Change lighting only. Use one blunt overhead-front directional light
plus weak flat ambient. Create clipped foreheads/noses/hands, muddy eye sockets and
necks, hard low-resolution shadows, weak contact, and uneven nearby exposure. Remove
rim, beauty, three-point, bounce, global illumination, volumetrics, bloom, and depth.”

### Result becomes dark, horrific, or grotesque

Restore source-led color and readable exposure. Keep awkward eyes and crude faces
within ordinary stylization. Remove horror grading, extreme distortion, deep black
voids, dramatic fog, and threatening light.

### Broad composition drifts

Restate subject count/type, approximate coordinates, relative scale, semantic action, camera height,
horizon, foreground occlusion, and background masses. Say “no reframing, recropping,
camera move, subject merge, or rearrangement.”

### Result looks like a filter

Say: “Rebuild every object as an actual primitive 3D asset. Make low polygon count,
repeated maps, reused models, and naive shadowing visible before adding any capture noise.”

### Unwanted cows, horns, captions, or UI

Say: “The skill name is not a content instruction. Render only source-evidenced
content. Add no cows, horns, animal traits, meme text, subtitles, watermarks, logos,
HUD, or new props.”

## Retry discipline

1. Restate all broad anchor locks on every retry.
2. Change only the failed dimension.
3. Prefer lowering fine-detail fidelity over weakening composition locks.
4. Stop after two retries unless the user asks to continue.
5. Disclose remaining hard failures rather than calling the result successful.
