import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { MANNEQUIN_POSE_PRESETS, type PosePresetDefinition } from "../src/director-desk/editor/presets/mannequinPosePresets.ts";
import { BODY_TYPE_OPTIONS, getBodyPreset } from "../src/director-desk/editor/runtime/mannequin/bodyTypes.ts";
import {
    clampPoseControlValue,
    degreesToRadians,
    getPoseControlRange,
    getProceduralPoseLandmarks,
    resolveProceduralGroundedPose,
    resolveProceduralPose,
    type MannequinPoint,
    type PoseGroundContact,
    type ProceduralPoseLandmarks,
    type ProceduralPoseTransforms,
} from "../src/director-desk/editor/runtime/mannequin/mannequinPose.ts";

function getPreset(id: PosePresetDefinition["id"]) {
    const preset = MANNEQUIN_POSE_PRESETS.find((item) => item.id === id);
    assert.ok(preset, `${id} preset must exist`);
    return preset;
}

function landmarksFor(preset: PosePresetDefinition, bodyType = "mannequin") {
    return getProceduralPoseLandmarks(preset.controls, getBodyPreset(bodyType), preset.groundContact);
}

function distance(left: MannequinPoint, right: MannequinPoint) {
    return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

function poseSignature(controls: Record<string, number>) {
    const pose = resolveProceduralPose(controls);
    return [
        pose.bodyOffsetY,
        ...pose.bodyRotation,
        ...pose.torsoRotation,
        ...pose.headRotation,
        ...pose.leftShoulderRotation,
        ...pose.rightShoulderRotation,
        ...pose.leftElbowRotation,
        ...pose.rightElbowRotation,
        ...pose.leftHandRotation,
        ...pose.rightHandRotation,
        ...pose.leftHipRotation,
        ...pose.rightHipRotation,
        ...pose.leftKneeRotation,
        ...pose.rightKneeRotation,
        ...pose.leftFootRotation,
        ...pose.rightFootRotation,
    ];
}

function resolvedControlValue(pose: ProceduralPoseTransforms, key: string) {
    const [prefix, axis] = key.split(".");
    const rotationAxis = axis === "pitch" || axis === "bend" ? 0 : axis === "yaw" || axis === "twist" ? 1 : 2;
    const transformKey = `${prefix}Rotation` as keyof ProceduralPoseTransforms;
    const rotation = pose[transformKey];
    assert.ok(Array.isArray(rotation), `${key} must resolve to a rotation`);
    return rotation[rotationAxis];
}

function expectedControlRadians(key: string, value: number) {
    const reversesDirection = /^(leftShoulder|rightShoulder|leftHip|rightHip)\.pitch$/u.test(key) || /^(leftElbow|rightElbow)\.bend$/u.test(key);
    return degreesToRadians(reversesDirection ? -value : value);
}

function contactValues(landmarks: ProceduralPoseLandmarks, groundContact: PoseGroundContact) {
    if (groundContact === "left-foot") return [landmarks.leftFootBottomY];
    if (groundContact === "right-foot") return [landmarks.rightFootBottomY];
    if (groundContact === "left-foot-right-knee") return [landmarks.leftFootBottomY, landmarks.rightKneeBottomY];
    if (groundContact === "right-foot-left-knee") return [landmarks.rightFootBottomY, landmarks.leftKneeBottomY];
    if (groundContact === "both-knees") return [landmarks.leftKneeBottomY, landmarks.rightKneeBottomY];
    return [landmarks.leftFootBottomY, landmarks.rightFootBottomY];
}

test("joint-specific limits preserve authored elbow, knee, shoulder and hip motion", () => {
    assert.deepEqual(getPoseControlRange("leftElbow.bend"), { min: -5, max: 145 });
    assert.deepEqual(getPoseControlRange("rightKnee.bend"), { min: -5, max: 145 });
    assert.deepEqual(getPoseControlRange("leftShoulder.pitch"), { min: -120, max: 120 });
    assert.deepEqual(getPoseControlRange("rightHip.pitch"), { min: -45, max: 125 });

    const pose = resolveProceduralPose({
        "leftShoulder.pitch": 112,
        "leftElbow.bend": 132,
        "rightHip.pitch": 100,
        "rightKnee.bend": 135,
    });

    assert.equal(pose.leftShoulderRotation[0], degreesToRadians(-112));
    assert.equal(pose.leftElbowRotation[0], degreesToRadians(-132));
    assert.equal(pose.rightHipRotation[0], degreesToRadians(-100));
    assert.equal(pose.rightKneeRotation[0], degreesToRadians(135));
});

test("every authored preset value reaches its intended procedural joint without silent clamping", () => {
    MANNEQUIN_POSE_PRESETS.forEach((preset) => {
        const pose = resolveProceduralPose(preset.controls);

        Object.entries(preset.controls).forEach(([key, value]) => {
            const range = getPoseControlRange(key);
            assert.ok(value >= range.min && value <= range.max, `${preset.label} ${key}=${value} must stay inside ${range.min}..${range.max}`);
            assert.ok(Math.abs(resolvedControlValue(pose, key) - expectedControlRadians(key, value)) < 1e-12, `${preset.label} ${key} must not be clamped or remapped to the wrong axis`);
        });
    });
});

test("positive front lift and human hinge controls move limbs in anatomical directions", () => {
    const shoulder = landmarksFor({ id: "stand", label: "shoulder", groundContact: "both-feet", controls: { "rightShoulder.pitch": 35 } });
    const hip = landmarksFor({ id: "stand", label: "hip", groundContact: "both-feet", controls: { "rightHip.pitch": 35 } });
    const elbow = landmarksFor({ id: "stand", label: "elbow", groundContact: "both-feet", controls: { "rightElbow.bend": 70 } });
    const knee = landmarksFor({ id: "stand", label: "knee", groundContact: "both-feet", controls: { "rightKnee.bend": 70 } });
    const neutral = landmarksFor(getPreset("stand"));

    assert.ok(shoulder.rightHand[2] > neutral.rightHand[2] + 0.45, "shoulder front lift must move the hand toward +Z");
    assert.ok(hip.rightKnee[2] > neutral.rightKnee[2] + 0.25, "hip front lift must move the knee toward +Z");
    assert.ok(elbow.rightHand[2] > neutral.rightHand[2] + 0.35, "elbow flexion must bring the hand forward");
    assert.ok(knee.rightAnkle[2] < neutral.rightAnkle[2] - 0.35, "knee flexion must fold the ankle backward");
});

test("all 20 presets ground their declared contacts across all eight body types", () => {
    assert.equal(MANNEQUIN_POSE_PRESETS.length, 20);

    BODY_TYPE_OPTIONS.forEach(({ bodyType }) => {
        const bodyPreset = getBodyPreset(bodyType);
        const tolerance = Math.max(0.022, bodyPreset.labelAnchorY * 0.03);

        MANNEQUIN_POSE_PRESETS.forEach((preset) => {
            const landmarks = getProceduralPoseLandmarks(preset.controls, bodyPreset, preset.groundContact);
            const points = Object.values(landmarks).flatMap((value) => (Array.isArray(value) ? value : [value]));
            assert.ok(points.every(Number.isFinite), `${bodyType} ${preset.label} landmarks must remain finite`);
            assert.ok(Math.abs(landmarks.supportBottomY) < 1e-9, `${bodyType} ${preset.label} declared support must sit on the ground`);
            contactValues(landmarks, preset.groundContact).forEach((value) => assert.ok(Math.abs(value) <= tolerance, `${bodyType} ${preset.label} selected contacts must share the ground plane`));
            assert.ok(landmarks.leftFootBottomY >= -0.005 && landmarks.rightFootBottomY >= -0.005, `${bodyType} ${preset.label} feet must not pass through the ground`);
            assert.ok(landmarks.leftKneeBottomY >= -0.005 && landmarks.rightKneeBottomY >= -0.005, `${bodyType} ${preset.label} knees must not pass through the ground`);
            assert.ok(landmarks.head[1] > landmarks.pelvis[1], `${bodyType} ${preset.label} head must stay above the pelvis`);
        });
    });
});

test("double-kneel grounding adapts only the body types whose feet would penetrate", () => {
    const preset = getPreset("kneel-two");
    const adultPose = resolveProceduralGroundedPose(preset.controls, getBodyPreset("mannequin"), preset.groundContact);
    const chibiPose = resolveProceduralGroundedPose(preset.controls, getBodyPreset("chibi"), preset.groundContact);

    assert.equal(adultPose.leftFootRotation[0], degreesToRadians(-120));
    assert.ok(chibiPose.leftFootRotation[0] < degreesToRadians(-120));
    assert.ok(chibiPose.leftFootRotation[0] >= degreesToRadians(-150));
});

test("each of the 20 presets satisfies its user-visible geometric intent", () => {
    const adultBody = getBodyPreset("mannequin");
    const adultTolerance = Math.max(0.022, adultBody.labelAnchorY * 0.03);
    const stand = landmarksFor(getPreset("stand"));
    const validated = new Set<string>();

    MANNEQUIN_POSE_PRESETS.forEach((preset) => {
        const pose = landmarksFor(preset);
        validated.add(preset.id);

        switch (preset.id) {
            case "stand":
                assert.ok(pose.head[1] > pose.pelvis[1] + 1);
                assert.ok(Math.abs(pose.leftFootBottomY) < 1e-9 && Math.abs(pose.rightFootBottomY) < 1e-9);
                break;
            case "t-pose":
                assert.ok(Math.abs(pose.leftHand[1] - pose.leftShoulder[1]) < 0.03);
                assert.ok(Math.abs(pose.rightHand[1] - pose.rightShoulder[1]) < 0.03);
                assert.ok(pose.leftHand[0] < -1.4 && pose.rightHand[0] > 1.4);
                break;
            case "walk":
                assert.ok(pose.leftKnee[2] > 0.2 && pose.rightKnee[2] < -0.2);
                assert.ok(pose.leftHand[2] < 0 && pose.rightHand[2] > 0.45);
                assert.ok(pose.rightFootBottomY > 0.12);
                break;
            case "run":
                assert.ok(pose.rightKnee[2] > 0.4 && pose.leftKnee[2] < -0.3);
                assert.ok(pose.leftHand[2] > 0.8 && pose.rightHand[2] < 0);
                assert.ok(Math.abs(pose.rightFootBottomY) < 1e-9);
                break;
            case "sit":
                assert.ok(pose.leftKnee[2] > pose.pelvis[2] + 0.55 && pose.rightKnee[2] > pose.pelvis[2] + 0.55);
                assert.ok(pose.leftAnkle[1] < pose.leftKnee[1] - 0.45 && pose.rightAnkle[1] < pose.rightKnee[1] - 0.45);
                assert.ok(pose.pelvis[1] < stand.pelvis[1] * 0.7 && pose.pelvis[1] > 0.65, "seated pelvis must sit at chair height instead of hovering or collapsing");
                break;
            case "crouch":
                assert.ok(pose.pelvis[1] < landmarksFor(getPreset("sit")).pelvis[1]);
                assert.ok(pose.leftKnee[2] > 0.55 && pose.rightKnee[2] > 0.55);
                assert.ok(distance(pose.leftHand, pose.leftKnee) < 0.35 && distance(pose.rightHand, pose.rightKnee) < 0.35);
                break;
            case "kneel-one":
                assert.ok(Math.abs(pose.leftFootBottomY - pose.rightKneeBottomY) < 0.04);
                assert.ok(pose.leftKnee[2] > 0.55 && pose.rightAnkle[2] < -0.35);
                assert.ok(pose.pelvis[1] < 0.85);
                break;
            case "kneel-two":
                assert.ok(Math.abs(pose.leftKneeBottomY) < 1e-9 && Math.abs(pose.rightKneeBottomY) < 1e-9);
                assert.ok(pose.leftAnkle[2] < -0.35 && pose.rightAnkle[2] < -0.35);
                assert.ok(Math.abs(pose.leftAnkle[2] - pose.leftKnee[2]) > Math.abs(pose.leftAnkle[1] - pose.leftKnee[1]) * 3);
                assert.ok(Math.abs(pose.rightAnkle[2] - pose.rightKnee[2]) > Math.abs(pose.rightAnkle[1] - pose.rightKnee[1]) * 3);
                assert.ok(Math.abs(pose.leftFootBottomY) < adultTolerance && Math.abs(pose.rightFootBottomY) < adultTolerance);
                break;
            case "hands-on-hips":
                assert.ok(pose.leftHand[0] < 0 && pose.rightHand[0] > 0);
                assert.ok(Math.abs(pose.leftHand[1] - pose.pelvis[1]) < 0.08 && Math.abs(pose.rightHand[1] - pose.pelvis[1]) < 0.08);
                assert.ok(Math.abs(pose.leftElbow[0]) > Math.abs(pose.leftHand[0]) && Math.abs(pose.rightElbow[0]) > Math.abs(pose.rightHand[0]));
                break;
            case "lean":
                assert.ok(pose.head[0] > pose.pelvis[0] + 0.12);
                assert.ok(Math.abs(pose.rightFootBottomY) < 1e-9 && pose.leftFootBottomY > 0.06);
                break;
            case "bow":
                assert.ok(pose.chest[2] > pose.pelvis[2] + 0.45 && pose.head[2] > pose.chest[2] + 0.3);
                assert.ok(Math.abs(pose.leftKnee[2]) < 0.05 && Math.abs(pose.rightKnee[2]) < 0.05);
                break;
            case "think":
                assert.ok(distance(pose.rightHand, pose.headForward) < 0.34, "thinking hand must reach the chin/face");
                assert.ok(distance(pose.leftHand, pose.rightElbow) < 0.25, "support arm must sit beneath the thinking arm");
                break;
            case "fight":
                assert.ok(pose.leftHand[2] > pose.chest[2] + 0.45 && pose.rightHand[2] > pose.chest[2] + 0.45);
                assert.ok(Math.abs(pose.leftHand[0]) < 0.2 && Math.abs(pose.rightHand[0]) < 0.2);
                break;
            case "kick":
                assert.ok(Math.abs(pose.leftFootBottomY) < 1e-9);
                assert.ok(pose.rightFootBottomY > 0.7 && pose.rightFoot[2] > pose.leftFoot[2] + 1);
                break;
            case "throw":
                assert.ok(pose.rightHand[1] > pose.rightShoulder[1] + 0.25 && pose.rightHand[2] < pose.pelvis[2]);
                assert.ok(pose.leftHand[2] > pose.leftShoulder[2] + 1);
                break;
            case "push":
                assert.ok(pose.leftHand[2] > pose.leftShoulder[2] + 1 && pose.rightHand[2] > pose.rightShoulder[2] + 1);
                assert.ok(Math.abs(pose.leftHand[1] - pose.rightHand[1]) < 0.01 && Math.abs(pose.leftHand[2] - pose.rightHand[2]) < 0.01);
                break;
            case "wave":
                assert.ok(pose.rightHand[1] > pose.rightShoulder[1] + 0.35 && pose.rightHand[0] > pose.head[0] + 0.6);
                assert.ok(pose.leftHand[1] < pose.leftShoulder[1] - 0.9);
                break;
            case "reach":
                assert.ok(pose.rightHand[2] > pose.rightShoulder[2] + 1);
                assert.ok(Math.abs(pose.rightHand[1] - pose.rightShoulder[1]) < 0.08);
                break;
            case "cross-arms":
                assert.ok(pose.leftHand[0] > 0 && pose.rightHand[0] < 0);
                assert.ok(Math.abs(pose.leftHand[1] - pose.rightHand[1]) < 0.01 && Math.abs(pose.leftHand[2] - pose.rightHand[2]) < 0.01);
                assert.ok(pose.leftHand[1] > pose.pelvis[1] + 0.4);
                break;
            case "phone":
                assert.ok(pose.leftHand[2] > pose.chest[2] + 0.45 && pose.rightHand[2] > pose.chest[2] + 0.45);
                assert.ok(distance(pose.leftHand, pose.rightHand) < 0.2);
                assert.ok(pose.headForward[1] < pose.head[1], "positive head pitch must look down toward the phone");
                break;
        }
    });

    assert.equal(validated.size, 20);
});

test("every non-neutral preset resolves to a distinct procedural pose", () => {
    const signatures = new Map<string, string>();

    MANNEQUIN_POSE_PRESETS.forEach((preset) => {
        const signature = JSON.stringify(poseSignature(preset.controls).map((value) => Number(value.toFixed(6))));
        assert.equal(signatures.has(signature), false, `${preset.label} must not duplicate ${signatures.get(signature) ?? "another preset"}`);
        signatures.set(signature, preset.label);
    });
});

test("the rendered hierarchy uses pelvis and torso pivots plus per-preset grounding", () => {
    const componentSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/ProceduralMannequin.tsx", import.meta.url), "utf8");
    assert.match(componentSource, /resolveProceduralGroundedPose\(controls, preset, groundContact\)/u);
    assert.match(componentSource, /getProceduralGroundingOffset\(pose, preset, groundContact\)/u);
    assert.match(componentSource, /position=\{\[0, groundingOffsetY \+ pose\.bodyOffsetY, 0\]\}/u);
    assert.match(componentSource, /name="humanoid-pelvis-pivot" position=\{\[0, p\.hipY, 0\]\} rotation=\{pose\.bodyRotation\}/u);
    assert.match(componentSource, /<Pelvis color=\{color\} pelvisPosition=\{\[0, 0, 0\]\}/u);
    assert.match(componentSource, /name="humanoid-torso-pivot" rotation=\{pose\.torsoRotation\}/u);
    assert.match(componentSource, /pelvisPosition=\{\[0, 0, 0\]\}/u);
    assert.match(componentSource, /showPelvis=\{false\}/u);
    assert.match(componentSource, /name="humanoid-left-hand-control"[^>]+rotation=\{pose\.leftHandRotation\}/u);
    assert.match(componentSource, /name="humanoid-right-foot-control"[^>]+rotation=\{pose\.rightFootRotation\}/u);
});

test("the native pose panel exposes wrist and foot controls with joint-specific ranges", () => {
    assert.deepEqual(getPoseControlRange("leftHand.pitch"), { min: -75, max: 75 });
    assert.deepEqual(getPoseControlRange("rightHand.twist"), { min: -90, max: 90 });
    assert.deepEqual(getPoseControlRange("leftFoot.pitch"), { min: -150, max: 75 });
    assert.deepEqual(getPoseControlRange("rightFoot.roll"), { min: -45, max: 45 });
    assert.equal(clampPoseControlValue("leftFoot.pitch", -999, "chibi"), -150);
    assert.equal(clampPoseControlValue("rightKnee.bend", 999, "child"), 145);

    const panelSource = readFileSync(new URL("../src/director-desk/editor/panels/CharacterPanel.tsx", import.meta.url), "utf8");
    [
        ["左手腕", "leftHand.pitch", "leftHand.twist", "leftHand.roll"],
        ["右手腕", "rightHand.pitch", "rightHand.twist", "rightHand.roll"],
        ["左脚掌", "leftFoot.pitch", "leftFoot.twist", "leftFoot.roll"],
        ["右脚掌", "rightFoot.pitch", "rightFoot.twist", "rightFoot.roll"],
    ].forEach(([title, ...keys]) => {
        assert.match(panelSource, new RegExp(`title: "${title}"`, "u"));
        keys.forEach((key) => assert.match(panelSource, new RegExp(`key: "${key.replace(".", "\\.")}"`, "u")));
    });
    assert.match(panelSource, /rangeAriaLabel=\{`\$\{group\.title\} · \$\{control\.label\} 滑杆`\}/u);
    assert.match(panelSource, /numberAriaLabel=\{`\$\{group\.title\} · \$\{control\.label\}`\}/u);
    assert.match(panelSource, /const range = getPoseControlRange\(control\.key, role\.bodyType\)/u);
    assert.match(panelSource, /max=\{String\(range\.max\)\}/u);
    assert.match(panelSource, /min=\{String\(range\.min\)\}/u);
    assert.match(panelSource, /clampPoseControlValue\(control\.key, Number\(value\), role\.bodyType\)/u);
    assert.match(panelSource, /normalizeNumberValue=\{\(value\) =>/u);

    const controlsSource = readFileSync(new URL("../src/director-desk/editor/panels/InspectorControls.tsx", import.meta.url), "utf8");
    assert.match(controlsSource, /const \[numberDraft, setNumberDraft\] = useState<string \| null>\(null\)/u);
    assert.match(controlsSource, /type=\{normalizeNumberValue \? "text" : "number"\}/u);
    assert.match(controlsSource, /rawValue\.trim\(\) === "" \|\| !Number\.isFinite\(Number\(rawValue\)\)/u);
});

test("all eight silhouettes retain a loader-free procedural fallback", () => {
    assert.equal(BODY_TYPE_OPTIONS.length, 8);
    BODY_TYPE_OPTIONS.forEach(({ bodyType }) => assert.equal(getBodyPreset(bodyType).bodyType, bodyType));

    const partsSource = readFileSync(new URL("../src/director-desk/editor/runtime/mannequin/mannequinParts.tsx", import.meta.url), "utf8");
    assert.match(partsSource, /capsuleGeometry/u);
    assert.match(partsSource, /cylinderGeometry/u);
    assert.match(partsSource, /sphereGeometry/u);
    assert.doesNotMatch(partsSource, /useGLTF|GLTFLoader|\.glb/u);
});
