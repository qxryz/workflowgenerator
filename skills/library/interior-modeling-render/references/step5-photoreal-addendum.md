This appendix supplements the main STEP 5 without replacing its workflow, geometry locks, or review gates. Read it whenever STEP 5 runs and merge applicable rules. Explicit user requirements take precedence over approved project conditions, which take precedence over defaults. Color-temperature and focal-length examples in the main text are not mandatory settings.

# STEP 5 Supplement: Reference-driven photographic realism and acceptance

After model and route approval, transform the approved walkthrough into a coherent interior video with the appearance of real architectural photography. Change surface treatment and approved lighting, weather, or exterior conditions, not the floor plan, furniture design, or camera route. Prompts improve consistency but cannot guarantee every generation succeeds; use visual anchors, inspection, and bounded repair as the acceptance gate.

### 5.1 Separate geometry, motion, and appearance authority

1. The approved Blender scene and actual renders own walls, openings, object count, scale relationships, furniture identity, and placement. The approved walkthrough owns viewpoint, motion, timing, occlusion, and framing. Resolve conflicting references using the established structural priority; ask only about a conflict with no approved priority.
2. Classify every current visual reference. Use photographic results for surface and lighting standards; use simplified models only for structure or comparison. Filenames, software watermarks, and promotional claims are not evidence of realism.
3. Assign each contributing reference its own role and bind it to its actual input order. Let images carry their visual information instead of reconstructing their color relationships in prose. Do not carry over comparison borders, captions, interfaces, or watermarks.
4. Analyze every user-specified reference, then validate current reference count and format limits. If they cannot all be used together, do not silently drop files; propose representative selection or grouped preparation and obtain confirmation where needed.
5. Claim access to a reference library only when its files or authorized Subject Library attachments are actually available. For reuse across projects, retain authorized reference assets or valid library associations, not only fragile web links or conversation-specific numbers. Without references, disclose that written standards are being used; obtain the image first when matching a particular picture is required.

All reference preparation, frame extraction, and QA in this appendix follow the main minimal-canvas policy. Internal use does not require publication. Reuse approved references first; show one current anchor only for a necessary creative review, and do not publish other process images, diagnostic clips, or failed retries by default.

### 5.2 Mandatory sequence whenever STEP 5 runs

1. Check the source walkthrough, geometry authority, duration, framing, and approved audio. Do not ask again for established locks.
2. Establish one internally coherent lighting condition: explicit current requirements first, then approved scene conditions. Do not combine direct sunlight, overcast light, and artificial lighting from different references into a contradictory setup.
3. Produce one photographic appearance anchor from a representative approved scene or walkthrough view, preserving framing and furniture. Reuse an existing validated anchor if it matches the current conditions. An appearance anchor is not an opening keyframe unless explicitly requested.
4. Inspect geometry, lighting logic, material separation, contact shadows, and requested changes. Extra texture or brightness alone does not pass when the image still looks like a simplified model. Obtain user review before video work when the new appearance introduces a material creative choice.
5. Use the approved walkthrough for motion and the accepted appearance anchor for the look. Do not inherit simplified shaders, uniform lighting, or outline rendering just because the source video's layout is correct.
6. Inspect the complete video; a successful still is not proof of video quality. Preserve approved audio and do not add music, dialogue, footsteps, or subtitles without a request.

### 5.3 Core photographic-treatment prompt

Use the complete core below, filling bracketed fields from the current scene and omitting inapplicable material items. Bind every input individually to its actual reference slot in the final prompt. Never submit unresolved placeholders.

> Transform [approved source walkthrough] into a continuous video that looks photographed by a real camera inside the same interior. [Source walkthrough] supplies viewpoint, height, focal length, route, speed, timing, framing, and occlusion. [Approved model authority] supplies architecture, furniture identity, shape, count, and placement. [Individually identified photographic references] supply only compatible material, lighting, and photographic treatment. Preserve wall offsets, openings, functional zones, relative ceiling height, furniture layout, and continuous-shot continuity. This is an appearance upgrade, not a redesign; do not add, remove, duplicate, or relocate major objects.
>
> Give existing materials real-scale detail and distinct light responses rather than adding noise to simple geometry. Wood retains grain direction, joints, fine pores, and restrained surface reflection at a scale appropriate to the object. Existing painted surfaces show subtle microrelief and natural reflection variation while retaining their intended smoothness; do not convert every wall to rough microcement. Stone, tile, and ceramics show appropriate fine variation, glazing, joints, and edge thickness; handmade irregularity appears only when consistent with the approved material. Fabrics and upholstery have soft folds, compression, seams, and fibers where resolvable, not rigid grids or plastic surfaces. Metals show highlights appropriate to their brushed or polished finish. Glass retains transmission, reflection, thickness cues, and exterior occlusion. Avoid one shared gloss across all surfaces, and do not invent heavy dirt, damage, or decoration to imply occupancy.
>
> Use [approved time, weather, and lighting state]. Principal illumination enters through actual openings or existing fixtures, producing credible falloff from windows into the room, reflected fill, and shadow detail. Shadows beneath furniture legs, countertop objects, skirting, corners, and joints explain physical contact without floating objects or thick dark outlines. For requested direct sun, establish light patches, directions, and penumbrae consistent with the existing window frame. For diffuse daylight, use broad soft illumination, continuous gradients, and subtle but legible contact shadows instead of forcing hard sunlight. Retain fixture states without adding ceiling lamps, windows, or luminous panels. Preserve texture in highlights, information in shadows, and readable exterior detail; avoid uniform fill, clipping, crushed shadows, glow halos, and exaggerated local contrast.
>
> Outside the windows, [preserve the existing environment / apply the explicitly requested replacement]. Place scenery beyond the real openings and balcony, retaining frames, glazing, parapets, and existing occlusion. Show scale appropriate to the viewpoint, distance layers, and motion parallax, not a picture stuck to the glass. An exterior replacement must not enlarge openings or remove the balcony. Exterior illumination agrees with interior light direction, weather, and time.
>
> Preserve the approved architectural perspective, spatial depth, and framing. Do not conceal spatial changes with a new distorted wide angle, tilted verticals, excessive depth blur, or zoom. Detail comes from surfaces and lighting, not sharpening outlines, heavy grain, or smoothing. The interior remains clean and natural, with believable scale and weight, rather than toy-like, waxy, line-art-colored, or a realtime preview.
>
> Keep textures attached to objects and illumination anchored in world space throughout the shot. Sun patches and contact shadows must not slide with the camera. Reflections and highlights change naturally with viewpoint; they are neither frozen decals nor arbitrary jumps. Walls, openings, furniture counts, and silhouettes do not morph, flicker, duplicate, or vanish. No wall or door penetration, teleportation, cuts, or added shots. Retain [approved audio treatment]; do not add unrequested text, people, animals, subtitles, logos, or sounds.

### 5.4 Lighting branches and project-specific scope

- **Direct daylight:** borrow the legibility of frame and vegetation shadows, but derive projection from this project's real openings, weather, and sun elevation. A noon request must not default to elongated sunset lighting. Vegetation shadows require an actual corresponding occluder.
- **Diffuse daylight:** borrow soft side illumination, wall gradients, and grounded furniture. Absence of hard sun patches is not a failure; missing depth, material separation, or lighting logic is.
- **Existing-fixture mix:** retain approved fixture states and combine local fixture influence with window light. Do not universally add fixtures or force a fixed color temperature.
- Noon sunlight and fallen-leaf street scenery belong to the current apartment request, not to every future project. Apply the same material and photographic standards to future confirmed times, weather, and space types.

### 5.5 Acceptance, fallback, and bounded repair

Mark each item pass, fail, or unverified with concrete frame or time evidence:

| Item | Passing evidence | Action |
|---|---|---|
| Structure and furniture | Major walls, openings, furniture identity, count, and placement match approved sources | Clear drift fails even if the result is attractive |
| Motion and boundaries | Approved route and timing, no cuts or penetration of walls or closed openings | Repair the video, not the approved model |
| Lighting logic | Light corresponds to real openings and requested conditions, with appropriate falloff and depth | Missing direct-sun evidence when requested, or forced hard light in a diffuse scene, fails |
| Materials | Major existing materials have distinguishable microdetail, sheen, and light response | Texture-only upgrades, uniform plastic sheen, or waxy upholstery fail |
| Contact and exposure | Objects are grounded, joints credible, essential highlight and shadow detail retained | Floating objects, dark outlined seams, or clipped exteriors require correction |
| Temporal consistency | Beginning, middle, end, and high-risk turns show no clear drift, flicker, or disappearance | Static references do not establish temporal success |
| Explicit user changes | Requested exterior, light, material, or other changes are actually visible | Prompt wording and model self-report are not evidence |

Mark occluded or unresolved details unverified instead of claiming hidden geometry or exact camera values were checked. Still images do not establish real focal length, exact solar elevation, physical render parameters, or construction measurements.

Repair only failed dimensions while retaining accepted geometry, motion, and appearance anchors. Make one substantively revised retry after the first attempt, not unlimited sampling or synonym changes. If the selected model still fails, report the gap and use another compatible model after verifying that it supports the locked inputs and settings; otherwise propose adjusting the goal, adding references, or using more controllable Blender rendering.

When strict frame-by-frame geometry, camera, and timing equivalence is required, prefer actual Blender camera animation and rendering, or explain that generative video editing cannot guarantee it. Only a visually accepted result is a finished photographic walkthrough; label failed work as preview or pending correction. Do not promise that every run will succeed.
