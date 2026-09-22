# Visual Style and Cinematic Quality

Use this reference when creating the style bible, character cards, scene cards, storyboard frames, image prompts, or animation prompts.

## Global look

Default to an original late-1990s to early-2000s indoor television sitcom, not a reproduction of any named show. Use frontal eye-level television photography and warm multi-camera studio coverage. The home should feel cozy, cluttered, and genuinely lived in: characters relax, argue, laugh, and survive everyday chaos. The look is an early-TV broadcast image, not a commercial product film, prestige drama, or poster.

## Camera and lighting

Start with a medium-wide master that explains the kitchen/living-room relationship, then cut to medium-close dialogue coverage, two-person over-the-shoulder shots, and facial reaction close-ups. Favor 28–35mm for masters, 40–50mm for dialogue, and 65–85mm for reactions. Use fixed or gently tracking multi-camera positions; comedy comes from entrances, prop misuse, held actions, eye-lines, pauses, and reactions.

Use broad, soft studio key and fill, window fill, ceiling light, and practical lamps. Keep the lighting diagram stable across coverage, with readable faces and hands, no hard rim light, blacked-out shadows, or advertising-style specular highlights. Preserve stable exposure, open blacks, and controlled highlights.

## Palette and production design

When no stronger user or brand palette exists, use honey wood, caramel brown, cream white, dusty pink, brick red, and low-saturation teal. Keep the image warm and naturally saturated but never neon or cyan-orange blockbuster graded.

Design a repeatable kitchen/living room with honey-brown cabinets, cream walls or tile, slightly worn but clean appliances, a refrigerator with a few magnets and family photos, common cups, napkins, condiment bottles, dishes, table textiles, carpets, photos, and one hero prop central to the scene. Leave a clear actor path from doors to counters and tables. Use light foreground occlusion such as a table edge, chair back, or plant only when it adds depth without hiding faces or hands.

## Character design

Create simple, readable, repeatable everyday clothing with a clear silhouette. Keep hair, wardrobe, accessories, and recurring hand props stable in full-body, two-person, and close-up shots. Character cards are the identity source; the period styling layer must never override a user-provided identity. Do not copy named sitcom characters, actors, exact costume combinations, logos, dialogue, or signature props.

## Texture and finish

Place the following in the material/finish portion of prompts instead of stacking empty quality terms:

`soft broadcast sharpness, subtle lens bloom, gentle halation around practical lights, fine uniform analog-video grain, restrained chroma noise, natural skin pores, matte painted wood, slightly worn laminate, cotton and denim weave, soft highlight roll-off, open shadows, stable white balance, consistent exposure, mild motion blur during movement, no artificial HDR`

For a stronger old-TV response, append only when requested:

`slight late-1990s broadcast softness, mild 4:3-era television color response adapted to the requested aspect ratio, delicate tape-like grain without scanlines, very subtle chroma bleed, no heavy VHS distortion`

## CUT MAP first

Write the cut map before visual prose. Every shot must specify timecode, shot ID, framing, focal length, camera position, movement, dominant action, action peak, and cut point. Example:

`00:00-00:03.0｜S01 master｜medium-wide, 28–35mm, eye-level fixed Camera A｜character enters and notices the hero prop｜hard cut on eye-line. 00:03.0-00:05.0｜S02 two-shot｜40–50mm, fixed Camera B, tiny lateral move｜hand reaches to stop the prop｜hard cut on action. 00:05.0-00:06.5｜S03 reaction｜65–85mm, fixed Camera C, short push-in｜closed-mouth awkward reaction｜hard cut on reaction.`

## H3 multi-shot timeline

For H3 full-reference prompts, place the complete CUT MAP first, then state: `follow S01→S02→S03 in exact time order; one dominant action and one clear camera position per segment; never turn the clip into storyboard panels, a contact sheet, or picture-in-picture.` At each cut preserve the 180-degree axis, screen-left/right positions, eye-line, hero-prop state, lighting direction, and exposure. Use hard cuts or motivated J-cuts/L-cuts; do not use random zooms, whip pans, or flashy transitions to hide continuity problems.

## Negative prompt

`boxed composition, storyboard panels, contact sheet, frame-within-frame, UI, poster typography, letterbox bars, pristine catalog kitchen, luxury showroom, dark prestige-drama lighting, harsh rim light, neon colors, cyan-orange blockbuster grade, glossy HDR, plastic skin, waxy face, oversharpening halos, dead black shadows, clipped highlights, exposure pumping, white-balance shift, crawling texture, unstable fabric pattern, random lens change, random zoom, whip pan, unmotivated handheld shake, reversed screen direction, broken eyelines, identity drift, changed wardrobe, duplicate props, missing hero prop, extra fingers, extra limbs, copied TV show characters, copied actor likeness, copied set layout, generated logo, generated subtitles, watermark`

## Continuity checklist

Keep the actor path, 180-degree axis, screen positions, eye-lines, hand occupancy, wardrobe, lighting diagram, prop state, door/window state, and furniture layout stable. Use the outgoing tail frame as the next shot's incoming continuity anchor when supported. Let dialogue remain short and audible, with pauses before punchlines and reaction holds after them.
