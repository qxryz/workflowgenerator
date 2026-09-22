# Masks, edges and retouching

## Choose the extraction method before editing

Inspect the subject against its intended background at native pixels. Separate hard contours, hair/fur, soft focus, translucent material and motion blur; these require different opacity transitions. Selection is a starting estimate, not the finished edge.

| Region | Starting method | Preserve |
|---|---|---|
| Solid product silhouette | Controlled path or refined selection feeding a mask | Edge geometry, perspective and appropriate antialiasing |
| Face and body | Subject selection refined by local mask work | Continuous skin contour and source sharpness |
| Hair or fur | Detail-aware selection/refinement where available, then local mask correction | Fine strands and partial coverage rather than a solid cutout |
| Glass, veil, smoke | Separate transparency and color contribution | Background transmission; a binary mask is insufficient |
| Defocused or motion-soft edge | Graded mask matched to the source | Natural softness and direction |

## Avoid jagged faces on the first pass

1. Start from the highest useful source resolution. Preserve its profile and alpha interpretation; avoid repeated JPEG intermediates, repeated resizing and thresholded masks.
2. Refine the face boundary locally without treating it like loose hair. Preserve subpixel opacity and natural sharpness. Do not use a hard color key for a complex portrait unless the source actually supports that method.
3. Evaluate the mask on dark, light and intended backgrounds. Dark/light inspection reveals fringes; the intended background determines the final treatment.
4. Correct mask geometry separately from contaminated edge color. If the mask is correct but the old background color remains, correct color on a separate bounded layer or use supported decontamination on a preserved duplicate. Global erosion may remove the fringe by removing the subject.
5. Check the composite at 100% and the delivery size before repeating. Do not hide jagged contours with global blur, aggressive feathering, global choking or sharpening. Set local feathering according to focus and final scale, not a universal radius.

Antialiasing describes partial pixel coverage; feathering broadens the transition. They are not interchangeable. A sharper source does not justify a binary mask, and a soft edge does not justify blurring all facial texture.

## Retouch on separate layers

- Preserve identity, expression and requested natural texture. Remove temporary blemishes or distractions within scope; do not reshape facial structure as an unrequested default.
- Use healing/cloning on separate layers when sampling modes support it. Inspect for repeated patterns and avoid sampling across unrelated boundaries.
- Use local dodge/burn to correct uneven luminosity while retaining texture. Frequency separation, if appropriate and available, is a specific texture/tone technique rather than a mandatory first step; excessive low-frequency smoothing produces artificial skin.
- Judge corrections by toggling before/after at matched size. Check pores, product surfaces, fabric texture and boundary continuity, not only overall smoothness.
- Keep masks editable and leave original layers available. Apply destructive operations only to a documented derivative when needed by a supported workflow.

## Missing regions and text removal

- Check whether text is already on a separate layer: hide or edit that layer before considering pixel repair. On flattened artwork, distinguish an area that can be reconstructed from visible neighboring pixels from missing garment construction, facial features or other unique details.
- For small defects, use supported healing, cloning, patching or non-generative content-aware fill on a preserved derivative. Match texture direction, seams and lighting; do not smear a large obstruction with ordinary fill just to avoid generation. Check that the chosen operation does not fall back to any Photoshop built-in generative tool, as prohibited in SKILL.md.
- When substantial content is hidden, explain the choice in everyday terms: “The lettering covers part of the jacket. I can rebuild that area, but the details may differ; do you have an unobstructed image, or may I reconstruct it?” Ask only if the existing brief has not already settled this choice. When true product detail or identity must be preserved, prefer an unobstructed source; do not invent missing details as fact.
- If reconstruction is authorized and Design image editing is available, edit only the needed region while preserving the subject, pose, framing and unaffected pixels. Verify the result against the source, then import it as a separate reconstruction layer or Smart Object with an editable mask. Keep the original, label the reconstructed area and continue the requested Photoshop layout, lighting and PSD delivery. A generated patch is raster content, not recovered original layers.
- If no acceptable source or authorized reconstruction method is available, preserve progress and explain the specific missing input. Do not redirect the user to repair the connector or retry any of its disabled built-in generative tools. Only ask the user to perform manual retouching if they choose that route.

## Assets intended for motion

For later animation, retain hidden overlap and enough background beyond the current crop for the intended movement. Preserve a shared canvas origin when exporting layers or document trim offsets. Test alpha against different backgrounds before handoff; do not bake a background color into semitransparent edges.

One still-image mask is not a temporal tracking solution. A video sequence with changing contours needs frame-aware refinement and playback inspection in the appropriate motion workflow; do not claim a still cutout eliminates video flicker.
