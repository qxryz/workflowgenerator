# Building effects from visual intent

Use after the task has selected AE creation, when a reference or revision needs distortion, liquid motion, displacement, a light sweep, trails or procedural texture. These are editable construction choices, not fixed presets or proof that a particular effect is installed. Read the relevant section only. For effect order, mattes, adjustment layers, blur, glow and plugin availability, use compositing dependencies (`compositing-dependencies.md`). For timing, use motion curves (`motion-curves.md`).

## Choose the construction before adding an effect

Describe the visible cause: is the silhouette changing, a surface moving, light travelling across an object, or past positions remaining visible? Separate that cause from the material finish. A circle merging into another circle needs different structure from a static circle with moving color inside it.

| Visual target | Starting structure | Keep editable |
|---|---|---|
| A precise icon changing shape | Native paths with corresponding vertices and tangents | Source paths, shape keys, fill and outline |
| Soft blobs joining and separating | Animated native shapes driving a processed alpha matte | Shapes, spacing, softness, alpha remap and fill |
| Organic wobble or heat shimmer | Isolated target plus Turbulent Displace or a displacement field | Deformation scale, amplitude, flow and affected region |
| Refraction or directional surface distortion | Independent map composition driving Displacement Map | Map, selected channels, alignment and horizontal/vertical strength |
| Light travelling across a logo | Original object plus a bounded moving highlight, or available CC Light Sweep | Original artwork, highlight direction, width, intensity and timing |
| Repeated silhouettes behind motion | Animation inside a precomposition, then Echo or controlled time-offset instances | Source animation, sample interval, history length and fade |
| Evolving cloud-like texture | Fractal Noise or Turbulent Noise in a separate source | Pattern scale, contrast, evolution, offset and coloring |
| Fine film texture | Dedicated grain/noise treatment at delivery scale | Grain size, strength, temporal behavior and protected text |

Before building the representative segment, establish the target layer, source/control layers, coordinate space, alpha behavior, required padding and intended time span. Query the available effect and its actual property tree before writing. Use stable identifiers where exposed, inspect property types and units, and read back values and layer references. Translated labels or a successful “add effect” operation do not prove the intended controls were set. Keep original artwork editable and expose a few meaningful controls in the project's chosen naming language.

## Liquid shapes and controlled morphs

**Choose the model.** For a specific logo outline or matching corners, use path morphing from native reconstruction (`native-reconstruction.md`) and recipes (`recipes.md`). Random distortion does not establish correct point correspondence. For blobs whose boundaries merge and split, a matte construction can express changing topology without inventing hundreds of path keys.

**Build.** Animate native circles or paths inside a padded transparent precomposition. Process their combined alpha with a blur followed by an alpha Levels/curves remap to tighten the softened union. Inspect alpha directly: a luminance-only contrast adjustment does not necessarily tighten transparency. Use the resulting alpha as a matte for a separately editable solid or gradient. Keep any material shading downstream and the source geometry available. This produces a rasterized effect boundary from editable native sources; it is not a vector-path export or a fluid simulation.

**Shape the interaction.** Shape spacing and blur radius determine when necks form; the alpha remap determines contour firmness and can destroy thin connections if pushed too far. Choose a narrow but antialiased transition, inspect at delivery resolution, and compare both dark and light backgrounds. Blur must have room outside the objects. Plan these relationships before animation rather than rescuing damaged contours with a final global blur.

**Animate.** Plan approach, contact, merge, separation and settling with deliberate speed profiles. Most of the action should come from the shapes; mild turbulence can add surface variation if present in the reference. Do not animate a random seed every frame to imitate flow. Check the frame before contact, the narrowest neck, separation and final silhouette; these often reveal popping that endpoint screenshots miss.

Liquify is useful for locally authored deformations when the current control capability can create and preserve its distortion mesh or brush data. A distortion amount can animate an existing deformation; it does not author the missing mesh. If mesh creation is unavailable, choose native paths or a map-based approximation appropriate to the target and disclose differences. Do not claim a liquid effect is implemented merely because its effect entry exists.

## Turbulent distortion and heat shimmer

**Scope.** Apply Turbulent Displace to the intended object or background region. When the person must remain unchanged, keep the portrait outside the distortion chain from the start. Separate matte-based reveal from geometric displacement; deforming the target can move content beyond the original silhouette.

**Parameter relationships.** Amount controls deformation strength; Size controls the scale of the turbulent features, not the speed. Complexity adds finer structure and computation. Evolution changes the pattern's internal form; Offset moves the field through space. Pinning and edge options influence which boundaries remain stable. Verify the controls actually offered by the installed effect. Start by matching large-scale features, then strength and movement; raising Complexity first often adds crawling detail without improving the shape.

**Animate.** For drifting heat, use a directional offset and restrained evolution, with the amplitude matching the intended background distortion. For a wobbling blob, coordinate amplitude with the shape's approach and settling. A designed reveal can bring amplitude back to zero to recover an exact final outline. Uniform Evolution can be intentionally linear; applying an ease to every cycle can make continuous flow visibly hesitate. Keep the random seed fixed unless a discontinuous change is intentional.

**Check.** Observe thin lines, silhouettes, corners and typography at normal speed and at output scale. Inspect maximum distortion for transparent gaps and clipped edges. Reserve source padding from the maximum planned displacement; repeating edge pixels can conceal a gap but may smear the border. If the reference needs only internal color motion, animate a texture through an unchanged matte instead of warping the silhouette.

## Displacement maps, refraction and waves

**Build a real control source.** Keep the map in its own composition, initially matching the target's dimensions, frame rate and time alignment. A neutral field should produce no intentional displacement; in an 8-bit channel, value 128 is the documented neutral value. Map channel values below and above neutral drive opposite directions. Do not enter 128 into properties that expect normalized or floating-point values, or assume a color-managed display swatch proves the input channel value.

Choose horizontal and vertical source channels and their maximum displacement independently. Using the same grayscale field for both axes correlates their motion; it does not create two independent directions. A soft ramp is useful for a broad bend, an animated ripple-like field for a wave, and noise for irregular refraction. A scalar intensity map controls displacement, not physical surface geometry.

**Resolve the sampling boundary.** Some layer-control effects sample source pixels without the control layer's own masks or effects. If noise, blur, color or transforms create the map, precompose that treatment into the map source or use a verified supported input-stage selector. Read back the actual source binding. Check map stretching/centering/tiling, target transforms and timing; do not assume two visually aligned layers are sampled in the same coordinates. Temporarily expose the map for diagnosis, then exclude it from the final visible composite while preserving its use as a control.

**Animate and verify.** Begin with zero strength, enable one axis at a time, then combine the axes. Animate the map's position or form for motion; animate strength for a designed onset or recovery. Check high-contrast straight lines, maximum deflection and borders. A black/white diagnostic ramp makes direction easier to verify than an already complicated texture. Keep padding adequate for the largest excursion. Wrapping edges is appropriate only when repeating content is intended.

For a glass patch, distort a copy of the background beneath the patch, matte it to the glass area, and keep rim/highlight treatment separate. Distorting only a translucent foreground rectangle does not refract the scene behind it. This is a controllable 2D approximation; it does not supply true thickness, physically accurate reflections or hidden background detail.

## Light sweeps and luminous accents

**Choose scope and material.** A sweep across a metallic logo, a broad paper highlight and an emissive neon line need different width, contrast and edge behavior. Keep an unchanged base object. With a supported CC Light Sweep, inspect the available center/direction, width and intensity controls rather than guessing translated names or property indices. A native alternative is a soft gradient strip clipped to the object's alpha; it gives editable highlight movement without pretending to reproduce every shading feature of a dedicated effect.

**Build and animate.** Orient the strip for the intended lighting direction and move it across the object's bounds in the appropriate local or precomposition space. Begin and end far enough outside the object for the full strip and feather to clear. Narrower width creates a brief glint; broader width increases the illuminated area and perceived exposure. Width, speed and intensity jointly determine how long a letter appears bright. Adjust the travel profile to the reference; constant speed through a logo can be correct, while approach or exit may need separate curves.

Use a highlight matte for only the intended artwork. Place glow after the highlight shaping if the intended light should spill outside the silhouette, with enough bounds for that spill; constrain it when the reference contains no spill. Inspect alpha instead of assuming an additive highlight preserves transparency. Do not wash out the original color or thin letter strokes just to make the sweep visible. For neon drawing, first animate a native stroked path with Trim Paths, then build its glow; a travelling highlight alone does not draw the path.

**Check.** Preview before entry, across thin and thick parts, and after exit. Confirm that a moving logo keeps the light in the intended coordinate space, the final artwork is restored, the highlight does not clip to a rectangle, and transparent delivery works over both dark and light backgrounds. Use color and output guidance (`color-rhythm-output.md`) for working-space and highlight clipping issues.

## Echoes, trails and motion blur

**Identify what should remain.** Repeated readable silhouettes are a time-history design; continuous exposure smear is motion blur; a luminous streak may be a separately drawn path. Pick the mechanism that matches the reference. More copies or a larger blur radius do not make these interchangeable.

For Echo, put the animation whose history matters inside a precomposition and apply Echo to the outer layer. Position animation on that same outer layer occurs outside the image history being sampled and may yield moving copies without the intended positional trail. Keep a sharp leading object separately only when needed, ensuring the history composite does not unintentionally double its brightness. Preserve transparent source bounds instead of introducing an opaque black background.

**Time and brightness controls.** Echo Time is a time interval in seconds: negative values sample the past, positive values sample future states. Convert a desired frame interval using the actual frame rate. Choose history duration first and inspect the resulting samples; Number of Echoes and spacing together determine coverage and render cost. Starting Intensity scales the sequence; Decay controls successive contributions. Add accumulates brightness, while other operators combine samples differently. Select the operator from the intended overlap and alpha behavior, not from a universal preset. Test the installed effect's count/current-frame behavior before using an exact trail-length formula.

**Schedule.** Keep enough source animation before the visible interval for past samples and after it for future samples. A trail may need time to decay after the leader stops; bound the history or animate its visibility intentionally rather than cutting it accidentally at the work-area end. The leader follows its designed motion curves, while history preserves earlier poses. Disabling a layer at the wrong stage can remove the whole trail instead of only its leader.

For independently colored or sized copies, use a manageable number of time-offset instances of an animated source, each with clear controls. Constant-time offsets naturally change spatial spacing as the source accelerates; evenly spaced copies need a different design. Keep effect and instance counts bounded by the actual visual need. If using real motion blur, inspect layer/comp settings, shutter timing and sample quality, and avoid unintentionally stacking it with a time-history effect.

**Check.** Preview a fast segment, a turn, a stop, the first visible frame and the final decay. Look for exposure blowout, black rectangles, wrongly ordered history, doubled leaders and clipped tails. A small test with three distinguishable source states can establish which times are being sampled before applying the effect to the full shot.

## Procedural texture, noise and loops

**Build the source separately.** Fractal Noise and Turbulent Noise are useful for broad, evolving fields; fine film grain is a different scale of texture. Choose feature size relative to the visible object and output resolution. Scale controls pattern size, contrast/brightness shape its distribution, and complexity adds levels of detail. Use Evolution for internal change and Offset for directional drift. Coloring, gradient mapping, matting and the final blend can then remain independent. A monochrome noise field is not transparent merely because its dark areas look black; create the intended alpha or luminance matte explicitly.

**Material first.** For a softly flowing colored background, establish broad value shapes and palette before finer variation. For a frosted surface, a restrained map can drive refraction while a separate fine texture controls surface appearance. Preserve reading areas and faces through layer scope. For film texture, keep grain, exposure flicker and gate movement separate; decide whether grain is stationary or changes between frames. A fixed random seed supports repeatability, but does not by itself create natural temporal grain or a seamless loop.

**Loop deliberately.** Fractal Noise provides Cycle Evolution for cyclic evolution; do not assume Turbulent Noise has the same loop controls. A plain 360-degree Evolution key is not sufficient without the corresponding cycle setup. Align the evolution change with the configured cycle and keep other animated inputs, including offset, contrast, masks and opacity, periodic or unchanged. Offset drift that ends in a different pattern position can break an otherwise cyclic evolution. Use endpoint derivatives that sustain the intended motion through the join rather than easing continuous texture to a stop at each seam.

For an N-frame loop, the hypothetical state at frame N should connect to frame 0; export frames 0 through N-1 so the matching endpoint is not held twice. Review the last few frames followed by the first few, including velocity and grain behavior, not only two stills. If a required loop cannot be made with the available controls, consider a deliberately blended loop with its visible overlap checked and describe the approximation.

## Representative effect check and handoff

Validate the riskiest effect before extending the sequence: source remains editable, the intended target alone is affected, control inputs are bound to the correct source stage, animation reads back, and the result survives maximum displacement/brightness/history and delivery-scale inspection. Compare an effect bypass with the treated version to distinguish intentional changes from unwanted ones. Check both RGB and alpha when transparency matters.

In a copy, change one meaningful control such as sweep width, blob spacing or trail duration and verify that downstream elements update as intended. Return the delivery version to the approved values. Document source/map dependencies and editable controls in the chosen project language. Report unavailable properties, failed writes and visually approximate substitutes explicitly; a recipe in this file is not evidence of a successful AE render.
