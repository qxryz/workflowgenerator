# Motion curves: design, reconstruction and verification

Read this when creating or changing keyframed motion. Endpoint values define poses, not the character of movement. Design the speed profile before building the first representative shot; do not leave easing as an optional finishing pass. For a local text or color edit, preserve unrelated animation.

## Observe the reference as movement

For each main action, identify the start, acceleration, peak speed, deceleration, settling and reading hold. Determine whether an object stops, passes through, changes direction or disappears while still moving. A cut or occlusion can hide the end of a move; it does not prove the object stopped there.

Use several timed observations across the action, with denser samples around rapid changes. Express progress relative to the action's start and end. Evenly spaced times with very different displacements indicate a changing speed profile. Estimate the timing of the peak and the duration of the landing, not just the final position. In perspective scenes, distinguish object movement, parent movement and camera projection before fitting a property curve.

For a representative shot, record a compact motion plan:

| Object/property | What to decide before creating keys |
|---|---|
| Main position | Path, start/end times, peak-speed region, stop versus pass-through, reading hold |
| Scale | Anchor, starting and ending size, expansion rhythm, whether overshoot is actually present |
| Rotation | Pivot, direction and total angle, angular acceleration, braking and final orientation |
| Opacity or reveal | Visible interval, overlap with movement and whether the object should still be moving at disappearance |
| Secondary objects | What they follow, purposeful delay and whether their motion shares the same character |

These are design decisions, not a requirement to produce a long plan for every layer. Reuse a curve only for objects that should feel related.

## Choose a motion profile for a reason

| Profile | Typical purpose | Shape and pitfalls |
|---|---|---|
| Decelerating entrance | A title or card arrives and becomes readable | A short launch followed by a longer controlled landing; do not spend most of the shot barely moving |
| Accelerating exit | An element leaves the reading area | Build speed toward the exit; do not automatically brake offscreen as though it were another entrance |
| Rest-to-rest move | An object transfers between two visible resting states | Start and end gently, place peak speed to match the reference; symmetric ease is only one possible choice |
| Continuous pass-through | A path, orbit or camera move continues across intermediate poses | Preserve nonzero speed at through-points; easing every intermediate key to a stop introduces unintended hesitation |
| Deliberate linear motion | A conveyor, constant rotation or measured progress | Keep it linear where the design calls for constant change; polish does not mean adding ease to everything |
| Overshoot and settle | A clearly elastic or weighted arrival | A main arrival, a restrained overshoot and a return that loses energy; use only when supported by the reference or brief |
| Hold or cut | A discrete state change | Hold the value or cut intentionally; do not interpolate a state that should switch instantly |

Avoid a universal ease function that assigns identical incoming and outgoing values to every property and every key. Position, scale and rotation may share an action's rhythm without sharing numerical speed settings. Opacity should support visibility and readability, rather than inherit the geometry's curve automatically.

## Read the graphs correctly

- The Value Graph shows the property value over time. Its slope describes the rate of change; a higher value is not necessarily a faster move. A local maximum/minimum may indicate a reversal or overshoot.
- The Speed Graph shows the rate of change. For spatial motion it describes travel speed along the path; it does not describe the shape of that path. A smooth arc can still have abrupt acceleration.
- Incoming and outgoing controls belong to different segments. For the segment from one key to the next, consider the first key's outgoing behavior and the next key's incoming behavior separately.
- Speed and influence are different controls. Speed sets the rate at the key; influence changes how much of the adjacent time interval the handle affects. An influence percentage is not a percentage of speed or a universal quality setting.
- Automatic or continuous Bezier options may constrain or recalculate handles. When the design requires explicit asymmetric handles, inspect those options before writing and read the result back. Do not assume an ease value alone proves the intended interpolation is active.
- Spatial and temporal interpolation are separate. Adjust spatial tangents for a curved path, temporal handles for acceleration and braking. For straight motion, check that automatic spatial tangents have not introduced an unwanted bend.

Use property units: position in distance per second, rotation in degrees per second, scale in percentage points per second. The same speed value has different meaning for these properties. Spatial position and separated axes also have different easing representations; inspect the actual property and easing dimensions rather than copying the value-array length indiscriminately.

## Build editable native motion

1. Identify the actual driver: native keyframes, an expression, a parent, a precomposition or a camera. Changing base keys is not sufficient if an expression replaces their values.
2. Establish meaningful poses and their times. For continuous motion, set suitable temporal interpolation and intended incoming/outgoing behavior. Use native Bezier keys for curves the recipient is expected to edit in the Graph Editor; keep purposeful linear and hold segments.
3. Treat the key at a stop differently from a key that is passed through. Preserve velocity continuity where the motion should flow, and retain deliberate discontinuities at cuts or impacts.
4. Apply each action's profile to the relevant properties. Check scale and rotation as well as position: writing their endpoints and easing only position leaves a mechanically uniform result.
5. Read the resulting key times, values, interpolation types, incoming/outgoing speed and influence, and relevant automatic/continuous settings. Methods such as `keyInInterpolationType`, `keyOutInterpolationType`, `keyInTemporalEase` and `keyOutTemporalEase` can provide evidence when the available AE execution capability exposes them. Discover the actual properties rather than guessing translated display names.
6. Report a failed or unsupported curve write with its object/property and reason. Never swallow that failure and continue reporting polished animation. If a capability cannot set or verify temporal interpolation, use an available supported AE scripting path or state the specific limitation.

When native scripting is available, interpolation and ease are separate decisions: set the intended interpolation through `setInterpolationTypeAtKey`, then apply the chosen incoming/outgoing ease through `setTemporalEaseAtKey`, respecting the actual property's supported types and dimensions. For manual asymmetric curves, account for automatic/continuous Bezier settings instead of letting them silently redefine the handles. Read the final values back; a successful speed/influence write alone is not evidence of the intended curve. Keep the separate incoming and outgoing choices at a key where one side is a hold or deliberate linear segment.

Expressions are appropriate for a deliberately adjustable spring, procedural motion or a shared controller. An expression-driven curve need not appear as a polished base-keyframe graph; verify the evaluated motion and expose useful controls. Do not use expressions merely to hide missing native easing, and do not bake one key per frame to disguise the lack of editable curves.

## Shape common MG actions

**A title sliding into place:** preserve the final layout and reading hold. Set the travel direction and starting offset, then distribute travel so the title moves decisively and lands smoothly. If it starts already offscreen, the visible start need not have zero speed. Coordinate any opacity reveal with the travel; avoid leaving the title nearly transparent until most of its movement is over.

**A planet scaling and rotating into a transition:** choose the visual pivot first. Observe whether scale grows steadily, speeds up into the cut, or brakes at a visible hero pose. Shape rotation's angular speed and scale's rate separately, then align the important visual moment. A fade or handoff may happen during ongoing rotation; do not insert a stop simply because opacity reaches zero. Keep overshoot only when the reference contains it.

**Staggered icons:** establish one suitable motion profile for the family, then offset starts according to hierarchy or a visible wave. Distinguish shared timing from identical placement. Random delays and a blanket ease on all keys do not establish a designed rhythm.

**A camera or orbit through multiple waypoints:** distinguish timing anchors from points that only guide the path. Roving intermediate spatial keys can help redistribute timing, but may shift arrival times. Do not use them for poses that must hit exact reference events without checking their resulting times. Recheck screen-space movement after projection.

## Verify the movement before expanding the sequence

Inspect at least one representative action for each materially different motion profile. Compare the same reference times around launch, peak travel, landing, hold and handoff. Use a normal-speed short preview for the judgment; keyframe icons and isolated stills cannot establish timing quality.

When useful, sample evaluated property values and estimate change per unit time. On position paths, compare traveled distance and screen-space displacement as appropriate. Do not compute apparent speed across a hard cut, conflate percentage scale with projected size, or mistake sparse sampling for proof of a smooth curve. A speed trend supports the diagnosis; it does not replace playback.

Look for abrupt starts or stops, long slow tails, an unintended pause at every key, unsourced bouncing, drifting pivots, and mismatched fade/movement timing. For loops, verify both the pose and velocity across the seam. Motion blur can help represent speed but cannot repair an incorrect speed profile.

Exit condition: the reference's principal timing and character are recognizable, curve writes have been verified where available, and the recipient has useful native keys or clearly explained procedural controls. State any unverified curve capability or meaningful motion difference; do not equate keyframe count with polish.
