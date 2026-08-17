import type { CharacterRigState } from "../../schema/directorProject";
import { MANNEQUIN_POSE_PRESETS } from "../../presets/mannequinPosePresets";
import { getBodyPreset, type CharacterBodyType } from "./bodyTypes";
import { getMannequinAxialLayout, getProceduralGroundingOffset, resolveProceduralGroundedPose } from "./mannequinPose";
import { Foot, Hand, Head, Joint, Pelvis, Segment, Torso } from "./mannequinParts";

interface ProceduralMannequinProps {
    bodyType?: CharacterBodyType;
    color?: string;
    rigState?: CharacterRigState;
}

export function ProceduralMannequin({ bodyType, color = "#4F8EF7", rigState }: ProceduralMannequinProps) {
    const preset = getBodyPreset(bodyType);
    const controls = rigState?.controls ?? {};
    const p = preset.proportions;
    const groundContact = MANNEQUIN_POSE_PRESETS.find((item) => item.id === rigState?.posePresetId)?.groundContact ?? "both-feet";
    const pose = resolveProceduralGroundedPose(controls, preset, groundContact);
    const groundingOffsetY = getProceduralGroundingOffset(pose, preset, groundContact);

    const { abdomenY, chestY, headY, neckHeight, neckY, shoulderY } = getMannequinAxialLayout(p);
    const armOriginY = shoulderY - p.shoulderRadius * 0.55;
    const elbowY = -(p.upperArmLength + p.upperArmRadius + p.elbowRadius);
    const wristY = -(p.forearmLength + p.forearmRadius + p.wristRadius);
    const handY = -p.handRadius - 0.05;

    const hipJointY = p.hipY - p.pelvisRadius * 0.15;
    const legOriginY = p.hipY - p.pelvisRadius * 0.35;
    const kneeY = -(p.thighLength + p.thighRadius + p.kneeRadius);
    const ankleY = -(p.calfLength + p.calfRadius + p.ankleRadius);
    const footY = -p.footRadius - 0.045;
    const jointScale: [number, number, number] = [p.jointRadiusScale, p.jointRadiusScale, p.jointRadiusScale];

    return (
        <group name={`procedural-${preset.bodyType}`} position={[0, groundingOffsetY + pose.bodyOffsetY, 0]} scale={preset.defaultScale}>
            <group name="humanoid-pelvis-pivot" position={[0, p.hipY, 0]} rotation={pose.bodyRotation}>
                <Pelvis color={color} pelvisPosition={[0, 0, 0]} pelvisRadius={p.pelvisRadius} pelvisScale={p.pelvisScale} />
                <group name="humanoid-torso-pivot" rotation={pose.torsoRotation}>
                    <Torso
                        abdomenPosition={[0, abdomenY - p.hipY, 0]}
                        abdomenScale={p.torsoLowerScale}
                        chestPosition={[0, chestY - p.hipY, 0]}
                        chestScale={p.torsoUpperScale}
                        color={color}
                        pelvisPosition={[0, 0, 0]}
                        pelvisRadius={p.pelvisRadius}
                        pelvisScale={p.pelvisScale}
                        torsoLowerHeight={p.torsoLowerHeight}
                        torsoLowerRadius={p.torsoLowerRadius}
                        torsoUpperHeight={p.torsoUpperHeight}
                        torsoUpperRadius={p.torsoUpperRadius}
                        showPelvis={false}
                    />
                    <Head
                        color={color}
                        eyeRadius={p.eyeRadius}
                        faceOffsetZ={p.faceOffsetZ}
                        headRadius={p.headRadius}
                        headScale={p.headScale}
                        mouthScale={p.mouthScale}
                        neckHeight={neckHeight}
                        neckPosition={[0, neckY - p.hipY, 0]}
                        neckRadius={p.neckRadius}
                        noseScale={p.noseScale}
                        position={[0, headY - p.hipY, 0]}
                        rotation={pose.headRotation}
                    />

                    <Joint color={color} position={[-p.shoulderWidth * 0.86, shoulderY - p.hipY, 0]} radius={p.shoulderRadius} scale={jointScale} />
                    <Joint color={color} position={[p.shoulderWidth * 0.86, shoulderY - p.hipY, 0]} radius={p.shoulderRadius} scale={jointScale} />

                    <group position={[-p.shoulderWidth, armOriginY - p.hipY, 0]} rotation={pose.leftShoulderRotation}>
                        <Segment color={color} length={p.upperArmLength} position={[0, -(p.upperArmLength * 0.5 + p.upperArmRadius), 0]} radius={p.upperArmRadius} />
                        <group position={[0, elbowY, 0]} rotation={pose.leftElbowRotation}>
                            <Joint color={color} position={[0, 0, 0]} radius={p.elbowRadius} scale={jointScale} />
                            <Segment color={color} length={p.forearmLength} position={[0, -(p.forearmLength * 0.5 + p.forearmRadius), 0]} radius={p.forearmRadius} />
                            <Joint color={color} position={[0, wristY, 0]} radius={p.wristRadius} scale={jointScale} />
                            <group name="humanoid-left-hand-control" position={[0, wristY, 0]} rotation={pose.leftHandRotation}>
                                <Hand color={color} position={[0, handY, 0.02]} radius={p.handRadius} scale={p.handScale} side="left" />
                            </group>
                        </group>
                    </group>

                    <group position={[p.shoulderWidth, armOriginY - p.hipY, 0]} rotation={pose.rightShoulderRotation}>
                        <Segment color={color} length={p.upperArmLength} position={[0, -(p.upperArmLength * 0.5 + p.upperArmRadius), 0]} radius={p.upperArmRadius} />
                        <group position={[0, elbowY, 0]} rotation={pose.rightElbowRotation}>
                            <Joint color={color} position={[0, 0, 0]} radius={p.elbowRadius} scale={jointScale} />
                            <Segment color={color} length={p.forearmLength} position={[0, -(p.forearmLength * 0.5 + p.forearmRadius), 0]} radius={p.forearmRadius} />
                            <Joint color={color} position={[0, wristY, 0]} radius={p.wristRadius} scale={jointScale} />
                            <group name="humanoid-right-hand-control" position={[0, wristY, 0]} rotation={pose.rightHandRotation}>
                                <Hand color={color} position={[0, handY, 0.02]} radius={p.handRadius} scale={p.handScale} side="right" />
                            </group>
                        </group>
                    </group>
                </group>

                <Joint color={color} position={[-p.legSpread, hipJointY - p.hipY, 0]} radius={p.thighRadius * 1.08} scale={jointScale} />
                <Joint color={color} position={[p.legSpread, hipJointY - p.hipY, 0]} radius={p.thighRadius * 1.08} scale={jointScale} />

                <group position={[-p.legSpread, legOriginY - p.hipY, 0]} rotation={pose.leftHipRotation}>
                    <Segment color={color} length={p.thighLength} position={[0, -(p.thighLength * 0.5 + p.thighRadius), 0]} radius={p.thighRadius} />
                    <group position={[0, kneeY, 0]} rotation={pose.leftKneeRotation}>
                        <Joint color={color} position={[0, 0, 0]} radius={p.kneeRadius} scale={jointScale} />
                        <Segment color={color} length={p.calfLength} position={[0, -(p.calfLength * 0.5 + p.calfRadius), 0]} radius={p.calfRadius} />
                        <Joint color={color} position={[0, ankleY, 0]} radius={p.ankleRadius} scale={jointScale} />
                        <group name="humanoid-left-foot-control" position={[0, ankleY, 0]} rotation={pose.leftFootRotation}>
                            <Foot color={color} length={p.footLength} position={[0, footY, p.footRadius * 0.74]} radius={p.footRadius} scale={p.footScale} side="left" />
                        </group>
                    </group>
                </group>

                <group position={[p.legSpread, legOriginY - p.hipY, 0]} rotation={pose.rightHipRotation}>
                    <Segment color={color} length={p.thighLength} position={[0, -(p.thighLength * 0.5 + p.thighRadius), 0]} radius={p.thighRadius} />
                    <group position={[0, kneeY, 0]} rotation={pose.rightKneeRotation}>
                        <Joint color={color} position={[0, 0, 0]} radius={p.kneeRadius} scale={jointScale} />
                        <Segment color={color} length={p.calfLength} position={[0, -(p.calfLength * 0.5 + p.calfRadius), 0]} radius={p.calfRadius} />
                        <Joint color={color} position={[0, ankleY, 0]} radius={p.ankleRadius} scale={jointScale} />
                        <group name="humanoid-right-foot-control" position={[0, ankleY, 0]} rotation={pose.rightFootRotation}>
                            <Foot color={color} length={p.footLength} position={[0, footY, p.footRadius * 0.74]} radius={p.footRadius} scale={p.footScale} side="right" />
                        </group>
                    </group>
                </group>
            </group>
        </group>
    );
}
