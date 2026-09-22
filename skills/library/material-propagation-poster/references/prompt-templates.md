# Prompt Templates

Use this order so image-to-video engines receive the important constraints first.

## Master Prompt Block

```text
[SOURCE AND COMPOSITION]
Use the uploaded subject image as the exact composition and geometry reference. Keep the camera [locked / specified move], framing [aspect ratio], background, lighting direction, silhouette, facial landmarks, product edges, logos, and existing typography unchanged.

[MATERIAL TRANSFER]
Transfer only the visual language of the uploaded texture reference: [palette], [motif], [edge quality], [scale], [contrast], [surface behavior]. Do not copy the texture reference's unrelated objects or layout.

[GROWTH ACTION]
Growth mode: [branching flow / bloom / contour fill / wrap and cascade]. Seed at [landmark] at [time]. Travel along [route] with [speed/easing]. Reach [coverage] by [time], stop at [boundary], and settle without changing the subject geometry.

[TIMELINE]
0.0s clean source. [seed event]. [travel event]. [peak coverage]. [hold frame]. [loop/reset behavior].

[RENDER QUALITY]
Stable temporal continuity, coherent occlusion, physically consistent attachment to the surface, clean edges, no flicker, no jump cuts, no random camera movement.
```

## Negative Prompt

```text
identity drift, face deformation, extra eyes or limbs, altered silhouette, melted product, invented logo, corrupted typography, background replacement, camera shake, zoom jump, perspective drift, texture floating above the surface, unrelated particles, random sparks, muddy colors, temporal flicker, frame-to-frame popping, hard cut, plastic CGI look, low-detail smear
```

## Shot Table Fields

Use one row per keyframe:

`time | subject state | texture state | route/coverage | camera | lighting | guard`

## Variant Pattern

Create variants by changing one field only:

1. **Route variant**: temple -> neck versus eye-cover -> shoulder.
2. **Material variant**: thermal-spark versus botanical-ink.
3. **Timing variant**: fast 3.5s reveal versus slow 6s reveal.

Label each variant with the changed field and keep all protected zones identical.

## Compact Example

```text
Locked 4:5 portrait of the uploaded marble sculpture. Preserve the blindfold folds, nose, lips, neck, shoulder drape, black halftone background, and all title blocks. Transfer only the reference's smooth blue-green-yellow-red thermal gradient and sparse four-point star peaks. At 0.5s seed a small peak on the left temple, branch across the blindfold and cheek, then flow down the neck and shoulder following the sculpture planes. Reach 60% coverage at 3.5s, hold a clean readable frame from 3.8-4.4s, then reverse the growth to the source state by 5.0s. Locked camera, unchanged lighting, coherent surface adhesion, no deformation, no new objects, no text redraw.
```
