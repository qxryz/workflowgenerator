import { Euler, Quaternion, Vector3 } from "three";

import type { CharacterBodyPreset, CharacterBodyProportions, CharacterBodyType } from "./bodyTypes";

export type MannequinRotation = [number, number, number];
export type MannequinPoint = [number, number, number];
export type PoseGroundContact = "both-feet" | "left-foot" | "right-foot" | "left-foot-right-knee" | "right-foot-left-knee" | "both-knees";

export const MANNEQUIN_GEOMETRY = {
    chestHeightScale: 0.78,
    chestProfileHalfExtent: 0.515,
    shoulderBridgeCenterScale: 0.4,
    shoulderBridgeRadiusScale: 0.2,
    headHeightScale: 0.92,
    headCenterOffsetScale: 0.75,
    neckChestOverlapScale: 0.12,
    minimumNeckChestOverlap: 0.006,
    visibleNeckHeightScale: 0.62,
    visibleNeckTorsoLimitScale: 0.18,
} as const;

export interface MannequinAxialLayout {
    abdomenY: number;
    chestY: number;
    headY: number;
    neckBottomY: number;
    neckHeight: number;
    neckTopY: number;
    neckY: number;
    shoulderBridgeTopY: number;
    shoulderY: number;
    visibleNeckHeight: number;
}

export function getMannequinAxialLayout(p: CharacterBodyProportions): MannequinAxialLayout {
    const abdomenY = p.hipY + p.pelvisRadius * 0.6 + p.torsoLowerHeight * 0.5;
    const chestY = abdomenY + p.torsoLowerHeight * 0.5 + p.torsoUpperHeight * 0.5 + p.torsoUpperRadius * 0.1;
    const shoulderBridgeTopY = chestY
        + p.torsoUpperHeight * MANNEQUIN_GEOMETRY.chestHeightScale * MANNEQUIN_GEOMETRY.shoulderBridgeCenterScale
        + p.torsoUpperRadius * MANNEQUIN_GEOMETRY.shoulderBridgeRadiusScale;
    const neckChestOverlap = Math.max(
        p.neckRadius * MANNEQUIN_GEOMETRY.neckChestOverlapScale,
        MANNEQUIN_GEOMETRY.minimumNeckChestOverlap,
    );
    const visibleNeckHeight = Math.min(
        p.neckHeight * MANNEQUIN_GEOMETRY.visibleNeckHeightScale,
        p.torsoUpperHeight * MANNEQUIN_GEOMETRY.visibleNeckTorsoLimitScale,
    );
    const neutralHeadNeckOverlap = Math.max(
        p.headRadius * (p.headScale[1] * MANNEQUIN_GEOMETRY.headHeightScale - MANNEQUIN_GEOMETRY.headCenterOffsetScale),
        0,
    );
    const neckTopY = shoulderBridgeTopY + visibleNeckHeight + neutralHeadNeckOverlap;
    const neckBottomY = shoulderBridgeTopY - neckChestOverlap;
    const neckHeight = neckTopY - neckBottomY;
    const neckY = (neckBottomY + neckTopY) * 0.5;
    const headY = neckTopY + p.headRadius * MANNEQUIN_GEOMETRY.headCenterOffsetScale;
    const shoulderY = chestY + p.torsoUpperHeight * 0.16 + p.shoulderRadius * 0.4;

    return {
        abdomenY,
        chestY,
        headY,
        neckBottomY,
        neckHeight,
        neckTopY,
        neckY,
        shoulderBridgeTopY,
        shoulderY,
        visibleNeckHeight,
    };
}

export function getMannequinContactMetrics(
    p: CharacterBodyProportions,
    headRotation: MannequinRotation = [0, 0, 0],
) {
    const layout = getMannequinAxialLayout(p);
    const headOffset = new Vector3(0, layout.headY - layout.neckTopY, 0);
    const rotation = new Quaternion().setFromEuler(new Euler(...headRotation));
    const rotatedHeadCenter = headOffset.clone().applyQuaternion(rotation);
    const neckContactInHeadSpace = rotatedHeadCenter
        .clone()
        .multiplyScalar(-1)
        .applyQuaternion(rotation.clone().invert());
    const headAxes = new Vector3(
        p.headRadius * p.headScale[0],
        p.headRadius * p.headScale[1] * MANNEQUIN_GEOMETRY.headHeightScale,
        p.headRadius * p.headScale[2],
    );
    const headNeckContactQ = (neckContactInHeadSpace.x / headAxes.x) ** 2
        + (neckContactInHeadSpace.y / headAxes.y) ** 2
        + (neckContactInHeadSpace.z / headAxes.z) ** 2;

    return {
        chestNeckSignedGap: layout.neckBottomY - layout.shoulderBridgeTopY,
        headNeckContactQ,
        ...layout,
    };
}

export interface PoseControlRange {
    min: number;
    max: number;
}

export interface ProceduralPoseTransforms {
    bodyOffsetY: number;
    bodyRotation: MannequinRotation;
    torsoRotation: MannequinRotation;
    headRotation: MannequinRotation;
    leftShoulderRotation: MannequinRotation;
    rightShoulderRotation: MannequinRotation;
    leftElbowRotation: MannequinRotation;
    rightElbowRotation: MannequinRotation;
    leftHandRotation: MannequinRotation;
    rightHandRotation: MannequinRotation;
    leftHipRotation: MannequinRotation;
    rightHipRotation: MannequinRotation;
    leftKneeRotation: MannequinRotation;
    rightKneeRotation: MannequinRotation;
    leftFootRotation: MannequinRotation;
    rightFootRotation: MannequinRotation;
}

export interface ProceduralPoseLandmarks {
    pelvis: MannequinPoint;
    chest: MannequinPoint;
    head: MannequinPoint;
    headForward: MannequinPoint;
    leftShoulder: MannequinPoint;
    rightShoulder: MannequinPoint;
    leftElbow: MannequinPoint;
    rightElbow: MannequinPoint;
    leftHand: MannequinPoint;
    rightHand: MannequinPoint;
    leftHip: MannequinPoint;
    rightHip: MannequinPoint;
    leftKnee: MannequinPoint;
    rightKnee: MannequinPoint;
    leftAnkle: MannequinPoint;
    rightAnkle: MannequinPoint;
    leftFoot: MannequinPoint;
    rightFoot: MannequinPoint;
    leftFootBottomY: number;
    rightFootBottomY: number;
    leftKneeBottomY: number;
    rightKneeBottomY: number;
    supportBottomY: number;
}

const DEFAULT_ROTATION_RANGE: PoseControlRange = { min: -90, max: 90 };
const GROUND_PENETRATION_TOLERANCE = 0.005;
const FOOT_GROUNDING_STEP_RADIANS = degreesToRadians(1);
const CONTROL_RANGES: Readonly<Record<string, PoseControlRange>> = {
    "body.offsetY": { min: -2, max: 2 },
    "body.pitch": { min: -60, max: 60 },
    "body.yaw": { min: -180, max: 180 },
    "body.roll": { min: -55, max: 55 },
    "torso.pitch": { min: -60, max: 60 },
    "torso.yaw": { min: -80, max: 80 },
    "torso.roll": { min: -50, max: 50 },
    "head.pitch": { min: -50, max: 50 },
    "head.yaw": { min: -80, max: 80 },
    "head.roll": { min: -45, max: 45 },
    "leftShoulder.pitch": { min: -120, max: 120 },
    "rightShoulder.pitch": { min: -120, max: 120 },
    "leftShoulder.spread": { min: -105, max: 105 },
    "rightShoulder.spread": { min: -105, max: 105 },
    "leftShoulder.twist": { min: -120, max: 120 },
    "rightShoulder.twist": { min: -120, max: 120 },
    "leftElbow.bend": { min: -5, max: 145 },
    "rightElbow.bend": { min: -5, max: 145 },
    "leftHand.pitch": { min: -75, max: 75 },
    "rightHand.pitch": { min: -75, max: 75 },
    "leftHand.twist": { min: -90, max: 90 },
    "rightHand.twist": { min: -90, max: 90 },
    "leftHand.roll": { min: -65, max: 65 },
    "rightHand.roll": { min: -65, max: 65 },
    "leftHip.pitch": { min: -45, max: 125 },
    "rightHip.pitch": { min: -45, max: 125 },
    "leftHip.spread": { min: -55, max: 55 },
    "rightHip.spread": { min: -55, max: 55 },
    "leftHip.twist": { min: -65, max: 65 },
    "rightHip.twist": { min: -65, max: 65 },
    "leftKnee.bend": { min: -5, max: 145 },
    "rightKnee.bend": { min: -5, max: 145 },
    "leftFoot.pitch": { min: -150, max: 75 },
    "rightFoot.pitch": { min: -150, max: 75 },
    "leftFoot.twist": { min: -45, max: 45 },
    "rightFoot.twist": { min: -45, max: 45 },
    "leftFoot.roll": { min: -45, max: 45 },
    "rightFoot.roll": { min: -45, max: 45 },
};

export function degreesToRadians(value: number) {
    return (value * Math.PI) / 180;
}

function clamp(value: number, min: number, max: number) {
    return Math.min(max, Math.max(min, value));
}

export function getBodyTypePoseLimit(bodyType?: string | null): number {
    switch (bodyType) {
        case "chibi":
            return 58;
        case "child":
            return 72;
        default:
            return 90;
    }
}

export function getPoseControlRange(controlKey: string, _bodyType?: CharacterBodyType): PoseControlRange {
    return CONTROL_RANGES[controlKey] ?? DEFAULT_ROTATION_RANGE;
}

export function clampPoseControlValue(controlKey: string, value: number, bodyType?: CharacterBodyType) {
    const finiteValue = Number.isFinite(value) ? value : 0;
    const range = getPoseControlRange(controlKey, bodyType);
    return clamp(finiteValue, range.min, range.max);
}

function controlDegrees(controls: Record<string, number>, key: string, bodyType?: CharacterBodyType) {
    return clampPoseControlValue(key, controls[key] ?? 0, bodyType);
}

function controlRadians(controls: Record<string, number>, key: string, bodyType?: CharacterBodyType) {
    return degreesToRadians(controlDegrees(controls, key, bodyType));
}

export function getRotationFromControls(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): MannequinRotation {
    return [controlRadians(controls, `${prefix}.pitch`, bodyType), controlRadians(controls, `${prefix}.yaw`, bodyType), controlRadians(controls, `${prefix}.roll`, bodyType)];
}

export function getSingleAxisRotation(controls: Record<string, number>, key: string, bodyType?: CharacterBodyType): MannequinRotation {
    return [controlRadians(controls, key, bodyType), 0, 0];
}

function getLimbRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): MannequinRotation {
    return [-controlRadians(controls, `${prefix}.pitch`, bodyType), controlRadians(controls, `${prefix}.twist`, bodyType), controlRadians(controls, `${prefix}.spread`, bodyType)];
}

function getExtremityRotation(controls: Record<string, number>, prefix: string, bodyType?: CharacterBodyType): MannequinRotation {
    return [controlRadians(controls, `${prefix}.pitch`, bodyType), controlRadians(controls, `${prefix}.twist`, bodyType), controlRadians(controls, `${prefix}.roll`, bodyType)];
}

function getHingeRotation(controls: Record<string, number>, key: string, direction: 1 | -1, bodyType?: CharacterBodyType): MannequinRotation {
    return [direction * controlRadians(controls, key, bodyType), 0, 0];
}

function rotationQuaternion(rotation: MannequinRotation) {
    return new Quaternion().setFromEuler(new Euler(rotation[0], rotation[1], rotation[2], "XYZ"));
}

function composeQuaternion(...rotations: MannequinRotation[]) {
    return rotations.reduce((result, rotation) => result.multiply(rotationQuaternion(rotation)), new Quaternion());
}

function pointTuple(point: Vector3): MannequinPoint {
    return [point.x, point.y, point.z];
}

function lowestBoxCornerY(center: Vector3, halfExtents: Vector3, rotation: Quaternion) {
    let lowestY = Number.POSITIVE_INFINITY;

    for (const xSign of [-1, 1]) {
        for (const ySign of [-1, 1]) {
            for (const zSign of [-1, 1]) {
                const corner = new Vector3(xSign * halfExtents.x, ySign * halfExtents.y, zSign * halfExtents.z).applyQuaternion(rotation).add(center);
                lowestY = Math.min(lowestY, corner.y);
            }
        }
    }

    return lowestY;
}

interface RawLandmarks extends Omit<ProceduralPoseLandmarks, "supportBottomY"> {
    supportBottomY: number;
}

function calculateRawLandmarks(pose: ProceduralPoseTransforms, preset: CharacterBodyPreset, groundContact: PoseGroundContact): RawLandmarks {
    const p = preset.proportions;
    const scale = new Vector3(...preset.defaultScale);

    const { chestY, headY, neckTopY, shoulderY } = getMannequinAxialLayout(p);
    const armOriginY = shoulderY - p.shoulderRadius * 0.55;
    const elbowY = -(p.upperArmLength + p.upperArmRadius + p.elbowRadius);
    const wristY = -(p.forearmLength + p.forearmRadius + p.wristRadius);
    const handY = -p.handRadius - 0.05;
    const legOriginY = p.hipY - p.pelvisRadius * 0.35;
    const kneeY = -(p.thighLength + p.thighRadius + p.kneeRadius);
    const ankleY = -(p.calfLength + p.calfRadius + p.ankleRadius);
    const footY = -p.footRadius - 0.045;

    const pelvis = new Vector3(0, p.hipY, 0);
    const bodyQuaternion = rotationQuaternion(pose.bodyRotation);
    const torsoQuaternion = composeQuaternion(pose.bodyRotation, pose.torsoRotation);

    const fromPelvis = (relativePoint: Vector3, rotation = bodyQuaternion) => relativePoint.applyQuaternion(rotation).add(pelvis.clone());
    const scaledPoint = (point: Vector3) => point.multiply(scale);

    const chest = fromPelvis(new Vector3(0, chestY - p.hipY, 0), torsoQuaternion);
    const headQuaternion = composeQuaternion(pose.bodyRotation, pose.torsoRotation, pose.headRotation);
    const headPivot = fromPelvis(new Vector3(0, neckTopY - p.hipY, 0), torsoQuaternion);
    const head = headPivot.clone().add(new Vector3(0, headY - neckTopY, 0).applyQuaternion(headQuaternion));
    const headForward = head.clone().add(new Vector3(0, 0, p.faceOffsetZ + p.headRadius * 0.25).applyQuaternion(headQuaternion));

    function armLandmarks(side: "left" | "right") {
        const sideSign = side === "left" ? -1 : 1;
        const shoulderRotation = side === "left" ? pose.leftShoulderRotation : pose.rightShoulderRotation;
        const elbowRotation = side === "left" ? pose.leftElbowRotation : pose.rightElbowRotation;
        const handRotation = side === "left" ? pose.leftHandRotation : pose.rightHandRotation;
        const shoulder = fromPelvis(new Vector3(sideSign * p.shoulderWidth, armOriginY - p.hipY, 0), torsoQuaternion);
        const upperArmQuaternion = composeQuaternion(pose.bodyRotation, pose.torsoRotation, shoulderRotation);
        const forearmQuaternion = composeQuaternion(pose.bodyRotation, pose.torsoRotation, shoulderRotation, elbowRotation);
        const handQuaternion = composeQuaternion(pose.bodyRotation, pose.torsoRotation, shoulderRotation, elbowRotation, handRotation);
        const elbow = shoulder.clone().add(new Vector3(0, elbowY, 0).applyQuaternion(upperArmQuaternion));
        const wrist = elbow.clone().add(new Vector3(0, wristY, 0).applyQuaternion(forearmQuaternion));
        const hand = wrist.clone().add(new Vector3(0, handY, 0.02).applyQuaternion(handQuaternion));

        return { shoulder, elbow, hand };
    }

    function legLandmarks(side: "left" | "right") {
        const sideSign = side === "left" ? -1 : 1;
        const hipRotation = side === "left" ? pose.leftHipRotation : pose.rightHipRotation;
        const kneeRotation = side === "left" ? pose.leftKneeRotation : pose.rightKneeRotation;
        const footRotation = side === "left" ? pose.leftFootRotation : pose.rightFootRotation;
        const hip = fromPelvis(new Vector3(sideSign * p.legSpread, legOriginY - p.hipY, 0));
        const thighQuaternion = composeQuaternion(pose.bodyRotation, hipRotation);
        const calfQuaternion = composeQuaternion(pose.bodyRotation, hipRotation, kneeRotation);
        const footQuaternion = composeQuaternion(pose.bodyRotation, hipRotation, kneeRotation, footRotation);
        const knee = hip.clone().add(new Vector3(0, kneeY, 0).applyQuaternion(thighQuaternion));
        const ankle = knee.clone().add(new Vector3(0, ankleY, 0).applyQuaternion(calfQuaternion));
        const foot = ankle.clone().add(new Vector3(0, footY + p.footScale[1] * (-p.footRadius * 0.46), p.footRadius * 0.74 + p.footScale[2] * (p.footLength * 0.3)).applyQuaternion(footQuaternion));
        const soleHalfExtents = new Vector3(p.footScale[0] * p.footRadius * 0.76, p.footScale[1] * p.footRadius * 0.05, p.footScale[2] * p.footLength * 0.4);
        const footBottomY = lowestBoxCornerY(foot, soleHalfExtents, footQuaternion);
        const kneeBottomY = knee.y - p.kneeRadius * 0.58 * p.jointRadiusScale;

        return { hip, knee, ankle, foot, footBottomY, kneeBottomY };
    }

    const leftArm = armLandmarks("left");
    const rightArm = armLandmarks("right");
    const leftLeg = legLandmarks("left");
    const rightLeg = legLandmarks("right");
    const supportBottomY = Math.min(
        ...(groundContact === "left-foot"
            ? [leftLeg.footBottomY]
            : groundContact === "right-foot"
              ? [rightLeg.footBottomY]
              : groundContact === "left-foot-right-knee"
                ? [leftLeg.footBottomY, rightLeg.kneeBottomY]
                : groundContact === "right-foot-left-knee"
                  ? [rightLeg.footBottomY, leftLeg.kneeBottomY]
                  : groundContact === "both-knees"
                    ? [leftLeg.kneeBottomY, rightLeg.kneeBottomY]
                    : [leftLeg.footBottomY, rightLeg.footBottomY]),
    );

    return {
        pelvis: pointTuple(scaledPoint(pelvis)),
        chest: pointTuple(scaledPoint(chest)),
        head: pointTuple(scaledPoint(head)),
        headForward: pointTuple(scaledPoint(headForward)),
        leftShoulder: pointTuple(scaledPoint(leftArm.shoulder)),
        rightShoulder: pointTuple(scaledPoint(rightArm.shoulder)),
        leftElbow: pointTuple(scaledPoint(leftArm.elbow)),
        rightElbow: pointTuple(scaledPoint(rightArm.elbow)),
        leftHand: pointTuple(scaledPoint(leftArm.hand)),
        rightHand: pointTuple(scaledPoint(rightArm.hand)),
        leftHip: pointTuple(scaledPoint(leftLeg.hip)),
        rightHip: pointTuple(scaledPoint(rightLeg.hip)),
        leftKnee: pointTuple(scaledPoint(leftLeg.knee)),
        rightKnee: pointTuple(scaledPoint(rightLeg.knee)),
        leftAnkle: pointTuple(scaledPoint(leftLeg.ankle)),
        rightAnkle: pointTuple(scaledPoint(rightLeg.ankle)),
        leftFoot: pointTuple(scaledPoint(leftLeg.foot)),
        rightFoot: pointTuple(scaledPoint(rightLeg.foot)),
        leftFootBottomY: leftLeg.footBottomY * scale.y,
        rightFootBottomY: rightLeg.footBottomY * scale.y,
        leftKneeBottomY: leftLeg.kneeBottomY * scale.y,
        rightKneeBottomY: rightLeg.kneeBottomY * scale.y,
        supportBottomY: supportBottomY * scale.y,
    };
}

export function resolveProceduralPose(controls: Record<string, number>, bodyType?: CharacterBodyType): ProceduralPoseTransforms {
    const bodyOffsetY = controlDegrees(controls, "body.offsetY", bodyType);
    const pose: ProceduralPoseTransforms = {
        bodyOffsetY,
        bodyRotation: getRotationFromControls(controls, "body", bodyType),
        torsoRotation: getRotationFromControls(controls, "torso", bodyType),
        headRotation: getRotationFromControls(controls, "head", bodyType),
        leftShoulderRotation: getLimbRotation(controls, "leftShoulder", bodyType),
        rightShoulderRotation: getLimbRotation(controls, "rightShoulder", bodyType),
        leftElbowRotation: getHingeRotation(controls, "leftElbow.bend", -1, bodyType),
        rightElbowRotation: getHingeRotation(controls, "rightElbow.bend", -1, bodyType),
        leftHandRotation: getExtremityRotation(controls, "leftHand", bodyType),
        rightHandRotation: getExtremityRotation(controls, "rightHand", bodyType),
        leftHipRotation: getLimbRotation(controls, "leftHip", bodyType),
        rightHipRotation: getLimbRotation(controls, "rightHip", bodyType),
        leftKneeRotation: getHingeRotation(controls, "leftKnee.bend", 1, bodyType),
        rightKneeRotation: getHingeRotation(controls, "rightKnee.bend", 1, bodyType),
        leftFootRotation: getExtremityRotation(controls, "leftFoot", bodyType),
        rightFootRotation: getExtremityRotation(controls, "rightFoot", bodyType),
    };

    return pose;
}

export function resolveProceduralGroundedPose(controls: Record<string, number>, preset: CharacterBodyPreset, groundContact: PoseGroundContact = "both-feet") {
    let pose = resolveProceduralPose(controls, preset.bodyType);
    if (groundContact !== "both-knees") return pose;

    const minimumFootPitch = degreesToRadians(getPoseControlRange("leftFoot.pitch", preset.bodyType).min);
    const footKeys = [
        ["leftFootRotation", "leftFootBottomY"],
        ["rightFootRotation", "rightFootBottomY"],
    ] as const;

    footKeys.forEach(([rotationKey, bottomKey]) => {
        while (true) {
            const raw = calculateRawLandmarks(pose, preset, groundContact);
            const groundedBottomY = raw[bottomKey] - raw.supportBottomY;
            const currentRotation = pose[rotationKey];
            if (groundedBottomY >= -GROUND_PENETRATION_TOLERANCE || currentRotation[0] <= minimumFootPitch) break;

            const nextPitch = Math.max(minimumFootPitch, currentRotation[0] - FOOT_GROUNDING_STEP_RADIANS);
            pose = { ...pose, [rotationKey]: [nextPitch, currentRotation[1], currentRotation[2]] };
        }
    });

    return pose;
}

export function getProceduralGroundingOffset(pose: ProceduralPoseTransforms, preset: CharacterBodyPreset, groundContact: PoseGroundContact = "both-feet") {
    return -calculateRawLandmarks(pose, preset, groundContact).supportBottomY;
}

export function getProceduralPoseLandmarks(controls: Record<string, number>, preset: CharacterBodyPreset, groundContact: PoseGroundContact = "both-feet"): ProceduralPoseLandmarks {
    const pose = resolveProceduralGroundedPose(controls, preset, groundContact);
    const raw = calculateRawLandmarks(pose, preset, groundContact);
    const rootOffsetY = getProceduralGroundingOffset(pose, preset, groundContact) + pose.bodyOffsetY;
    const translatePoint = (point: MannequinPoint): MannequinPoint => [point[0], point[1] + rootOffsetY, point[2]];

    return {
        pelvis: translatePoint(raw.pelvis),
        chest: translatePoint(raw.chest),
        head: translatePoint(raw.head),
        headForward: translatePoint(raw.headForward),
        leftShoulder: translatePoint(raw.leftShoulder),
        rightShoulder: translatePoint(raw.rightShoulder),
        leftElbow: translatePoint(raw.leftElbow),
        rightElbow: translatePoint(raw.rightElbow),
        leftHand: translatePoint(raw.leftHand),
        rightHand: translatePoint(raw.rightHand),
        leftHip: translatePoint(raw.leftHip),
        rightHip: translatePoint(raw.rightHip),
        leftKnee: translatePoint(raw.leftKnee),
        rightKnee: translatePoint(raw.rightKnee),
        leftAnkle: translatePoint(raw.leftAnkle),
        rightAnkle: translatePoint(raw.rightAnkle),
        leftFoot: translatePoint(raw.leftFoot),
        rightFoot: translatePoint(raw.rightFoot),
        leftFootBottomY: raw.leftFootBottomY + rootOffsetY,
        rightFootBottomY: raw.rightFootBottomY + rootOffsetY,
        leftKneeBottomY: raw.leftKneeBottomY + rootOffsetY,
        rightKneeBottomY: raw.rightKneeBottomY + rootOffsetY,
        supportBottomY: raw.supportBottomY + rootOffsetY,
    };
}
