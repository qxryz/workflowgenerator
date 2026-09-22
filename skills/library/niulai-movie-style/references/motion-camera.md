# Niulai protagonist motion and camera rules

Use this reference when the user asks for Niulai-style motion, video prompts, camera movement, 主角运动, 运镜, or when an image result will later be animated. These rules come from a reference video analysis and describe reusable production behavior, not a specific shot to copy.

## Motion thesis

Niulai motion should feel like a technically limited early-3D character system: the protagonist is readable, but movement is rigid, segmented, and physically under-simulated. Avoid polished animation curves, natural anticipation, realistic weight transfer, and cinematic camera smoothing.

## Protagonist motion rules

- **Stiff idle posture:** when still, keep the body upright or linearly posed, with limbs held away from the body and no convincing weight distribution.
- **Whole-body pivot turns:** rotate head, neck, torso, and hips as one crude rigid unit around a vertical axis. Avoid layered neck/shoulder/hip compensation.
- **Linear translation:** jumps, falls, dodges, or forward movement travel along straight paths at nearly constant speed, without natural acceleration or deceleration.
- **No anticipation or impact absorption:** remove wind-up, squash, compression, knee bend, and soft landing recovery. The body pops into motion and stops abruptly.
- **Pose popping:** shock, pain, realization, or panic is expressed by snapping into a pose, such as both hands touching the head, then holding with tiny mechanical shakes.
- **Sliding feet:** feet may skate across the ground or fail to match the walking cycle. Ground contact can be weak, late, or visibly misregistered.
- **Rigid gestures:** arms swing or lift in one-axis rotations, wrists stay straight, shoulders rise too high, and hands float or intersect nearby meshes.
- **Vacant eye behavior:** gaze stays static, misaligned, or poorly converged during motion; do not add polished eye tracking or expressive facial animation.

## Camera and framing rules

- **Static-camera jump cuts:** prefer cuts between locked-off cameras. The character moves awkwardly inside a fixed frame rather than being followed smoothly.
- **Linear camera moves:** when the camera pans, dollies, or zooms, use simple linear motion with abrupt starts and stops. Avoid ease-in, ease-out, handheld sophistication, or stabilized cinematic arcs.
- **Collision-disregarding camera:** the camera path may clip through foliage, rocks, props, or background geometry instead of elegantly avoiding obstacles.
- **Awkward low-angle close-ups:** use slightly low or flat-perspective close-ups that emphasize crude face planes and primitive geometry.
- **Sudden scale offsets:** dramatic moments can cut abruptly to extreme close-ups of a body part, object, or face without transitional coverage.
- **Unmotivated reframing:** allow small framing mismatches, hard cuts, and blunt position jumps, as if assembled in a simple game engine cutscene tool.

## Timing and beat behavior

- Build scenes from short readable action beats rather than fluid continuous acting.
- Let major changes happen as pops, cuts, or constant-speed translations.
- Hold awkward poses slightly too long after a gesture, landing, or realization.
- Use tiny mechanical shakes sparingly; the main failure should remain rigging and camera simplicity, not glitch effects.

## Prompt clause

Use or adapt this clause in video/image-to-video prompts:

```text
Motion and camera should feel like a primitive early-3D cutscene: stiff idle posture, whole-body pivot turns, one-axis arm gestures, sliding feet, constant-speed jumps or translations, no anticipation, no soft landing, pose-popping reactions, vacant misaligned gaze, locked-off static-camera jump cuts, linear pans or zooms with abrupt starts and stops, occasional camera clipping through simple background geometry, and awkward low-angle close-ups. Avoid polished animation curves, natural weight transfer, expressive facial acting, smooth handheld cinematography, and cinematic easing.
```
