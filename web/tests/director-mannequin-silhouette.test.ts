import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MANNEQUIN_POSE_PRESETS } from "../src/director-desk/editor/presets/mannequinPosePresets.ts";
import { BODY_TYPE_OPTIONS, getBodyPreset } from "../src/director-desk/editor/runtime/mannequin/bodyTypes.ts";
import { getMannequinContactMetrics, getProceduralPoseLandmarks, resolveProceduralPose } from "../src/director-desk/editor/runtime/mannequin/mannequinPose.ts";

const BODY_RATIO_TARGETS = {
    mannequin: { heads: [7.4, 7.65], shoulderHeads: [2.7, 3.1] },
    female: { heads: [7.1, 7.45], shoulderHeads: [2.4, 2.8] },
    broad: { heads: [6.9, 7.25], shoulderHeads: [3, 3.4] },
    muscular: { heads: [7.2, 7.55], shoulderHeads: [2.9, 3.3] },
    slim: { heads: [7.45, 7.9], shoulderHeads: [2.45, 2.8] },
    teen: { heads: [6.2, 6.6], shoulderHeads: [2.1, 2.4] },
    child: { heads: [4.8, 5.2], shoulderHeads: [1.45, 1.75] },
    chibi: { heads: [2.15, 2.4], shoulderHeads: [0.42, 0.56] },
} as const;

test("the procedural silhouette uses continuous human proportions instead of toy armor", () => {
    const adult = getBodyPreset("mannequin").proportions;
    const female = getBodyPreset("female").proportions;
    const child = getBodyPreset("child").proportions;

    assert.ok(adult.headRadius * adult.headScale[0] < adult.shoulderWidth * 0.5);
    assert.ok(adult.handRadius <= adult.upperArmRadius * 1.2);
    assert.ok(adult.footLength > adult.footRadius * 2.2);
    assert.ok(adult.upperArmRadius / adult.upperArmLength > 0.28);
    assert.ok(adult.thighRadius / adult.thighLength > 0.3);
    assert.ok(female.pelvisRadius * female.pelvisScale[0] > female.torsoUpperRadius * female.torsoUpperScale[0]);
    assert.ok(child.headRadius > adult.headRadius);
    assert.ok(child.shoulderWidth < adult.shoulderWidth);

    const partsSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/mannequinParts.tsx", import.meta.url), "utf8");
    assert.match(partsSource, /humanoid-ribcage/u);
    assert.match(partsSource, /humanoid-shoulder-bridge/u);
    assert.match(partsSource, /humanoid-diaphragm/u);
    assert.match(partsSource, /humanoid-neck/u);
    assert.match(partsSource, /ankle-bridge/u);
    assert.match(partsSource, /latheGeometry/u);
    assert.match(partsSource, /export function Pelvis/u);
    assert.match(partsSource, /showPelvis \? <Pelvis/u);
    assert.doesNotMatch(partsSource, /hip-shell/u);
    assert.doesNotMatch(partsSource, /humanoid-visor|humanoid-.*-armor/u);
});

test("the head, neck and shoulder envelope stay connected for every body and pose", () => {
    const boundaryRotations: Array<[number, number, number]> = [];
    [-50, 50].forEach((pitch) => {
        [-80, 80].forEach((yaw) => {
            [-45, 45].forEach((roll) => boundaryRotations.push([
                pitch * Math.PI / 180,
                yaw * Math.PI / 180,
                roll * Math.PI / 180,
            ]));
        });
    });

    BODY_TYPE_OPTIONS.forEach(({ bodyType }) => {
        const proportions = getBodyPreset(bodyType).proportions;
        const rotations = [
            ...MANNEQUIN_POSE_PRESETS.map((preset) => resolveProceduralPose(preset.controls).headRotation),
            ...boundaryRotations,
        ];

        rotations.forEach((rotation) => {
            const metrics = getMannequinContactMetrics(proportions, rotation);
            assert.ok(metrics.chestNeckSignedGap <= -0.005, `${bodyType} neck must overlap the shoulder envelope`);
            assert.ok(metrics.headNeckContactQ <= 0.9, `${bodyType} neck pivot must remain inside the rotated head with margin`);
            assert.ok(metrics.visibleNeckHeight <= proportions.torsoUpperHeight * 0.18 + 1e-12, `${bodyType} visible neck must remain proportional to the torso`);
        });
    });

    const adultMetrics = getMannequinContactMetrics(getBodyPreset("mannequin").proportions);
    assert.ok(adultMetrics.visibleNeckHeight >= 0.07 && adultMetrics.visibleNeckHeight <= 0.1, "adult visible neck must stay short and natural");

    const componentSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/mannequinParts.tsx", import.meta.url), "utf8");
    const renderSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/ProceduralMannequin.tsx", import.meta.url), "utf8");
    const poseSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/mannequinPose.ts", import.meta.url), "utf8");
    assert.match(componentSource, /name="humanoid-head-pivot"/u);
    assert.match(renderSource, /getMannequinAxialLayout\(p\)/u);
    assert.match(poseSource, /export function getMannequinAxialLayout/u);
});

test("all eight named body types keep intentional whole-body proportions", () => {
    BODY_TYPE_OPTIONS.forEach(({ bodyType }) => {
        const preset = getBodyPreset(bodyType);
        const p = preset.proportions;
        const landmarks = getProceduralPoseLandmarks({}, preset);
        const headHeight = 2 * p.headRadius * p.headScale[1] * 0.92 * preset.defaultScale[1];
        const totalHeight = landmarks.head[1] + headHeight * 0.5;
        const shoulderWidth = 2 * p.shoulderWidth * preset.defaultScale[0];
        const headWidth = 2 * p.headRadius * p.headScale[0] * preset.defaultScale[0];
        const targets = BODY_RATIO_TARGETS[bodyType];
        const headRatio = totalHeight / headHeight;
        const shoulderHeadRatio = shoulderWidth / headWidth;

        assert.ok(headRatio >= targets.heads[0] && headRatio <= targets.heads[1], `${bodyType} must match its named head-to-height range`);
        assert.ok(shoulderHeadRatio >= targets.shoulderHeads[0] && shoulderHeadRatio <= targets.shoulderHeads[1], `${bodyType} must match its named shoulder silhouette`);
        assert.ok(landmarks.leftHand[1] < landmarks.pelvis[1] && landmarks.leftHand[1] > landmarks.leftKnee[1], `${bodyType} relaxed fingertips must land on the thigh`);
    });

    const male = getBodyPreset("mannequin").proportions;
    const female = getBodyPreset("female").proportions;
    const broad = getBodyPreset("broad").proportions;
    const muscular = getBodyPreset("muscular").proportions;
    const slim = getBodyPreset("slim").proportions;
    const teen = getBodyPreset("teen");
    const child = getBodyPreset("child");
    const chibi = getBodyPreset("chibi");

    assert.ok(female.pelvisRadius * female.pelvisScale[0] / female.shoulderWidth > male.pelvisRadius * male.pelvisScale[0] / male.shoulderWidth);
    assert.ok(broad.shoulderWidth > male.shoulderWidth && broad.torsoUpperRadius > male.torsoUpperRadius);
    assert.ok(muscular.upperArmRadius > broad.upperArmRadius && muscular.thighRadius > male.thighRadius);
    assert.ok(slim.upperArmRadius < female.upperArmRadius && slim.torsoUpperRadius < female.torsoUpperRadius);
    assert.ok(teen.labelAnchorY > child.labelAnchorY && child.labelAnchorY > chibi.labelAnchorY);
});
