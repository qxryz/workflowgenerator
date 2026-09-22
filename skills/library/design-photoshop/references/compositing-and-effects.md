# Compositing and effects as editable constructions

## Match physical relationships first

Set the subject's scale, ground plane, perspective, camera height and light direction before grading. Correct these relationships before attempting to make mismatched sources agree through a global color effect.

Work in this order where relevant: placement and perspective; mask quality; local exposure/contrast; white balance and saturation; contact and cast shadows; atmospheric depth; shared grain/sharpness; final grade. A correction that compensates for a wrong earlier decision should prompt a review of that decision.

## Choose effects by their visual job

| Goal | Construction | Inspect |
|---|---|---|
| Exposure and tonal separation | Curves adjustment, clipped or locally masked | Black/white detail, skin and product color; avoid clipped channels |
| Color matching | Curves, Hue/Saturation or other available color adjustment with a region mask | Neutral areas, brand colors and material response |
| Depth between objects | Controlled overlap, local contrast and focus | Occlusion order and focus consistency |
| Contact shadow | Separate restrained dark layer close to the contact surface | Contact position, density and absence of a floating gap |
| Cast shadow | Shape/duplicate-derived shadow, transformed to the ground plane and blurred according to distance | Light direction, perspective, edge softness and interaction with existing shadows |
| Raised text or panel | Editable layer style when it describes the intended surface | Stroke weight, light angle and scale; styles alone are not a physical product shadow |
| Glow or bloom | Isolated bright contribution with a reversible soft spread when supported | Highlight shape, clipping and spill, rather than washing out every edge |
| Gradient background | Editable gradient fill or shape gradient | Direction, smoothness, banding and focal hierarchy |
| Texture or grain | Separate clipped/controlled texture layer | Scale and consistency across sources at final resolution |
| Repeated artwork replacement | Smart Object placement | Perspective and whether editing the content updates unintended duplicates |

Use Smart Filters where the operation and document mode support them. A filter applied to ordinary raster pixels is not made reversible merely by giving the layer a descriptive name; preserve a source copy if no reversible equivalent exists.

## Blend modes with intent

- Multiply darkens relative to underlying content and can help shadow construction, but does not determine shadow geometry or realistic density.
- Screen can contribute light from an isolated bright layer; inspect unwanted haze and lifted blacks. A mode choice cannot repair a poor isolation mask.
- Soft Light and Overlay can change contrast as well as color. Keep strength controlled and compare to the ungraded composite.
- Blend If can restrict interaction by tonal range. Split transitions where supported to avoid hard edges, and inspect near moving or revised tonal boundaries.
- Check group blending and clipping scope when an adjustment affects unexpected layers. Verify actual visibility rather than assuming a group contains all effects.

## Representative examples

**Product on a studio backdrop:** retain the product in a Smart Object; extract with a suitable mask; use an editable gradient background; place contact and cast shadows separately; clip local tonal corrections to the product; inspect labels and reflective edges before the finishing grade.

**Portrait with text behind and in front:** reconstruct background gaps separately; isolate the portrait using locally appropriate edges; rebuild each text plane with live type; arrange the layers around the subject; check the letter/subject overlap at native pixels. Keep the original reference hidden for comparison.

**Film-like still:** use a coherent contrast curve and color relationship, then restrained grain matched to output size. Preserve faces and highlight detail. Texture is a finishing decision, not a substitute for lighting or a reason to introduce unstable edge artifacts.
