# Coordinate Camera Visual Storyboard Specification

## Purpose

Coordinate-based camera planning should be visible and reviewable before video generation. Keep the motion-path map, storyboard sheet, and clean video reference as separate assets because they serve different purposes.

## Shared Rules

1. Use a wide planning canvas unless the user confirms another delivery shape.
2. Aim for enough clarity that coordinates, speed curves, event points, and cut labels remain legible; do not promise a fixed pixel size that the selected model cannot deliver.
3. Keep the motion-path map and storyboard sheet separate.
4. Use one 3×3 master storyboard when nine cuts must appear on one sheet. Create per-cut sub-storyboards only when the user explicitly requests action sub-frames.
5. Tie every panel to a route node, subject position, camera position, scene object, and speed curve.
6. Planning marks must never appear in the final video. Translate arrows, boxes, labels, and curves into written coordinate instructions.
7. Use only clean character references, clean scene references, or annotation-free first frames for video generation.
8. Keep subject coordinates separate from camera focus and identify the camera relationship for every cut.
9. Mark a meaningful speed curve for every cut rather than describing all motion as simply “fast.”

## Motion-Path Overview

The overview is a director's blocking diagram, not a finished poster. It should show:

- ground, walls, obstacles, entrances, exits, and distant targets;
- subject start, target, impact, and landing regions;
- subject route and camera route using visually distinct marks;
- cut identifiers and short coordinate labels;
- speed changes at important route segments.

Use color blocks and arrows when they improve legibility. Avoid decorative detail that competes with the route.

### Creative Brief

```text
Deliverable: action-scene motion-path overview
Canvas: wide planning layout confirmed with the user
Quality target: coordinates and labels remain clear at normal review size
Content: full scene, subject route, camera route, event points, cut labels, coordinate boxes, speed changes
Style: director's blocking diagram or action-route concept sketch, not a movie poster
References: use approved character, scene, and style references only for their assigned roles
```

## Black-and-White 3×3 Master Storyboard

The default master sheet contains nine panels, read from top left to bottom right. Each panel represents one cut in the complete route.

- Use black-and-white line art, pencil thumbnails, or rough animation-board styling.
- Keep character identity, scene geometry, and screen direction consistent.
- Show the key pose, framing, camera position, and motion direction for each cut.
- Limit text to a short cut identifier and, when useful, a brief action label.
- Do not add complex color rendering that could be mistaken for the final visual reference.

### Suggested Nine-Cut Progression

1. Establish the route start and subject-scene relationship.
2. Reveal the first obstacle and movement direction.
3. Show the first traversal or evasive action.
4. Show a turn, brake, or interaction with a major obstacle.
5. Mark a brief leverage or wall-contact point.
6. Introduce a height change, bridge, rail, crowd, or middle-route complication.
7. Show landing and physical recovery.
8. Build the final acceleration or launch preparation.
9. Resolve at the gap, skyline, impact, or final destination.

Adapt this progression to the user's action; do not force parkour beats into unrelated scenes.

### Creative Brief

```text
Deliverable: black-and-white 3×3 master storyboard
Canvas: wide sheet with nine equal panels
Quality target: poses, camera positions, and cut labels remain readable
Content: one route-linked cut per panel, consistent subject and space, clear motion direction
Style: pencil storyboard thumbnails or rough animation line art, no complex color rendering
```

## Clean Scene Reference

When downstream video needs stable scene design, create a separate clean reference that preserves the approved environment and main object layout but contains no arrows, coordinate boxes, speed lines, labels, route marks, or storyboard borders.

## Review Checklist

- Can a reviewer understand where the subject starts and ends?
- Does every storyboard panel advance the action?
- Do coordinate regions match the depicted positions?
- Does the camera route support rather than contradict subject movement?
- Is every cut suitable as a basis for an annotation-free first frame?
- Are planning marks absent from all assets intended as video references?
