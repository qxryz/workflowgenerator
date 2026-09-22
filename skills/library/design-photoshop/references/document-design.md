# Document construction and reference reconstruction

## Plan editable responsibilities

Describe each visible element by role, intended edit and representation before building it.

| Element | Representation | Reason |
|---|---|---|
| Headline, body copy, labels | Text layers with paragraph/character settings | Wording, size, tracking and line breaks remain editable |
| Circle, panel, line, simple icon | Vector shape layer with fill/stroke | Scales without relying on reference pixels |
| Gradient circle or card | Shape with editable gradient fill or gradient effect | Color stops, direction and geometry can change independently |
| Photo, product or textured illustration | Raster source, often inside a Smart Object, with a mask | Photographic detail is preserved; transformations remain revisable |
| Tonal or color correction | Adjustment layer, clipped or masked when local | Source pixels remain intact |
| Repeated unit or placed artwork | Smart Object where shared content is intended | Content replacement is controlled; use an independent copy when variants must diverge |
| Soft cast shadow or texture | Separate named layer, optionally with reversible filtering | Opacity, shape and blur can be tuned independently |

A Smart Object preserves its source and transform, but a screenshot inside it still has no editable headline or reconstructed shape layers. Define editability by what the recipient can actually change.

## Build a coherent document

- Group by visual responsibility: background, subject, typography, decoration and finishing where useful. Keep a small document simple; do not create empty groups to satisfy a template.
- Name layers by function and content in the chosen naming language. Preserve existing conventions and names that external workflows may depend on.
- Match dimensions, alignment anchors, margins and relative proportions before adding finishing effects. Identify which elements are clipped, which overlap and which continue behind subjects.
- A subject between two words needs separate text layers and a genuine subject mask. Cutting letters out of a flattened photo cannot provide independent text editing.
- Use shape paths for geometric contours. Keep strokes aligned and widths deliberate at the final pixel size. Fractional positions may be appropriate for curves but can soften thin rectilinear edges; inspect the actual raster result rather than snapping every point indiscriminately.
- Use a vector mask for controlled hard contours and a pixel mask for organic detail where appropriate. A clipping mask constrains by underlying transparency; a layer mask directly controls the layer's visibility. Choose by the editing responsibility, not their similar names.

## Typography

- Establish exact copy, line breaks, hierarchy, typeface, weight, leading, tracking and alignment. A font with a similar name may not have the same metrics; check the rendered layout.
- Check missing glyphs and font availability before laying out the full design. If the requested font is missing, identify it and propose an available substitute when necessary; do not silently rasterize text.
- Keep live text in the master. If a downstream consumer requires outlines or pixels, create a separate derivative and label that loss of text editing.
- Preserve actual artwork language independently of layer naming. Do not translate brand copy because the application interface or conversation language changed.

## From a flattened reference

Measure visible geometry and sampling locations; record uncertain font, hidden pixels, lighting and effects as inferred. Prioritize large shapes, hierarchy and spacing before tiny textures. Reconstruct a representative region and compare at matched size before completing the layout.

Hidden content needs another source or a newly constructed fill. Keep that fill on a separate layer and preserve the source. Rebuilt text, shape geometry and photographic reconstruction have different certainty levels; identify those differences in delivery notes rather than promising recovery of the original PSD.
