import { Vector2 } from "three";

import { MANNEQUIN_GEOMETRY } from "./mannequinPose";

interface HumanoidMaterialProps {
    color: string;
}

interface SegmentProps {
    color: string;
    length: number;
    name?: string;
    position: [number, number, number];
    radius: number;
    rotation?: [number, number, number];
    scale?: [number, number, number];
}

interface JointProps {
    color: string;
    name?: string;
    position: [number, number, number];
    radius: number;
    scale?: [number, number, number];
}

interface HandProps {
    color: string;
    position: [number, number, number];
    radius: number;
    scale: [number, number, number];
    side: "left" | "right";
}

interface FootProps {
    color: string;
    length: number;
    position: [number, number, number];
    radius: number;
    scale: [number, number, number];
    side: "left" | "right";
}

interface TorsoProps {
    abdomenPosition: [number, number, number];
    abdomenScale: [number, number, number];
    chestPosition: [number, number, number];
    chestScale: [number, number, number];
    color: string;
    pelvisPosition: [number, number, number];
    pelvisRadius: number;
    pelvisScale: [number, number, number];
    showPelvis?: boolean;
    torsoLowerHeight: number;
    torsoLowerRadius: number;
    torsoUpperHeight: number;
    torsoUpperRadius: number;
}

interface PelvisProps {
    color: string;
    pelvisPosition: [number, number, number];
    pelvisRadius: number;
    pelvisScale: [number, number, number];
}

interface HeadProps {
    color: string;
    eyeRadius: number;
    faceOffsetZ: number;
    headRadius: number;
    headScale: [number, number, number];
    mouthScale: [number, number, number];
    neckHeight: number;
    neckPosition: [number, number, number];
    neckRadius: number;
    noseScale: [number, number, number];
    position: [number, number, number];
    rotation: [number, number, number];
}

export function HumanoidMaterial({ color }: HumanoidMaterialProps) {
    return <meshStandardMaterial color={color} metalness={0} roughness={0.7} />;
}

function JointMaterial() {
    return <meshStandardMaterial color="#151a20" metalness={0.015} roughness={0.76} />;
}

function SoleMaterial() {
    return <meshStandardMaterial color="#0c1015" metalness={0.01} roughness={0.82} />;
}

export function Segment({ color, length, name, position, radius, rotation, scale = [1, 1, 1] }: SegmentProps) {
    const height = length + radius * 1.45;
    const proximalRadius = radius * 1.04;
    const distalRadius = radius * 0.72;
    const profile = [
        new Vector2(0, -height * 0.515),
        new Vector2(distalRadius * 0.82, -height * 0.49),
        new Vector2(distalRadius, -height * 0.34),
        new Vector2(radius * 0.86, -height * 0.08),
        new Vector2(proximalRadius, height * 0.25),
        new Vector2(proximalRadius * 0.98, height * 0.42),
        new Vector2(proximalRadius * 0.82, height * 0.49),
        new Vector2(0, height * 0.515),
    ];

    return (
        <group name={name} position={position} rotation={rotation} scale={scale}>
            <mesh name="humanoid-limb" scale={[1, 1, 0.9]} castShadow receiveShadow>
                <latheGeometry args={[profile, 28]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name="humanoid-limb-joint-line" position={[0, -height * 0.5, 0]} rotation={[Math.PI / 2, 0, 0]} scale={[1, 0.88, 1]}>
                <torusGeometry args={[distalRadius * 0.82, Math.max(radius * 0.028, 0.0025), 6, 24]} />
                <JointMaterial />
            </mesh>
        </group>
    );
}

export function Joint({ color, name = "humanoid-joint", position, radius, scale = [1, 1, 1] }: JointProps) {
    const integratedJoint = radius >= 0.105;
    const surfaceScale: [number, number, number] = integratedJoint ? [0.44, 0.4, 0.44] : [0.62, 0.54, 0.58];
    const lineScale: [number, number, number] = integratedJoint ? [0.46, 0.44, 1] : [0.62, 0.58, 1];

    return (
        <group position={position} scale={scale}>
            <mesh name={`${name}-surface`} scale={surfaceScale} castShadow receiveShadow>
                <sphereGeometry args={[radius, 20, 14]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name={`${name}-line`} rotation={[Math.PI / 2, 0, 0]} scale={lineScale}>
                <torusGeometry args={[radius * 0.58, Math.max(radius * 0.016, 0.0016), 6, 24]} />
                <JointMaterial />
            </mesh>
        </group>
    );
}

export function Hand({ color, position, radius, scale, side }: HandProps) {
    const sideSign = side === "left" ? -1 : 1;
    const prefix = side === "left" ? "humanoid-left" : "humanoid-right";
    const fingerOffsets = [-0.48, -0.16, 0.16, 0.48];
    const fingerLengths = [0.7, 0.84, 0.8, 0.64];

    return (
        <group position={position} scale={scale}>
            <mesh name={`${prefix}-palm`} position={[0, radius * 0.08, 0]} scale={[0.9, 1.22, 0.54]} castShadow receiveShadow>
                <sphereGeometry args={[radius, 24, 16]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh
                name={`${prefix}-thumb`}
                position={[sideSign * radius * 0.74, -radius * 0.45, radius * 0.05]}
                rotation={[0.08, 0, sideSign * 0.7]}
                scale={[0.9, 1, 0.82]}
                castShadow
                receiveShadow
            >
                <capsuleGeometry args={[radius * 0.18, radius * 0.62, 7, 12]} />
                <HumanoidMaterial color={color} />
            </mesh>
            {fingerOffsets.map((offset, index) => (
                <mesh
                    key={offset}
                    name={`${prefix}-finger-${index + 1}`}
                    position={[radius * offset, -radius * 0.96, radius * 0.01]}
                    rotation={[0, 0, offset * 0.06]}
                    scale={[0.86, 1, 0.72]}
                    castShadow
                    receiveShadow
                >
                    <capsuleGeometry args={[radius * 0.13, radius * fingerLengths[index], 6, 10]} />
                    <HumanoidMaterial color={color} />
                </mesh>
            ))}
        </group>
    );
}

export function Foot({ color, length, position, radius, scale, side }: FootProps) {
    const prefix = side === "left" ? "humanoid-left" : "humanoid-right";

    return (
        <group position={position} scale={scale}>
            <mesh name={`${prefix}-ankle-bridge`} position={[0, radius * 0.72, -length * 0.06]} castShadow receiveShadow>
                <cylinderGeometry args={[radius * 0.62, radius * 0.74, radius * 2.55, 22, 3]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name={`${prefix}-foot`} position={[0, -radius * 0.04, length * 0.3]} castShadow receiveShadow>
                <boxGeometry args={[radius * 1.5, radius * 1.08, length * 0.78]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name={`${prefix}-instep`} position={[0, radius * 0.22, length * 0.04]} scale={[0.76, 0.74, 1.04]} castShadow receiveShadow>
                <sphereGeometry args={[radius, 22, 14]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name={`${prefix}-sole`} position={[0, -radius * 0.46, length * 0.3]} scale={[1, 0.1, 1]} receiveShadow>
                <boxGeometry args={[radius * 1.52, radius, length * 0.8]} />
                <SoleMaterial />
            </mesh>
        </group>
    );
}

export function Pelvis({ color, pelvisPosition, pelvisRadius, pelvisScale }: PelvisProps) {
    const pelvisHeight = pelvisRadius * (1.18 + pelvisScale[1] * 0.5);
    const pelvisProfile = [
        new Vector2(0, -pelvisHeight * 0.515),
        new Vector2(pelvisRadius * 0.34, -pelvisHeight * 0.49),
        new Vector2(pelvisRadius * 0.62, -pelvisHeight * 0.24),
        new Vector2(pelvisRadius * 0.94, pelvisHeight * 0.12),
        new Vector2(pelvisRadius * 0.9, pelvisHeight * 0.4),
        new Vector2(pelvisRadius * 0.76, pelvisHeight * 0.49),
        new Vector2(0, pelvisHeight * 0.515),
    ];

    return (
        <>
            <mesh name="humanoid-pelvis" position={pelvisPosition} scale={[pelvisScale[0], 1, pelvisScale[2]]} castShadow receiveShadow>
                <latheGeometry args={[pelvisProfile, 34]} />
                <HumanoidMaterial color={color} />
            </mesh>
        </>
    );
}

export function Torso({ abdomenPosition, abdomenScale, chestPosition, chestScale, color, pelvisPosition, pelvisRadius, pelvisScale, showPelvis = true, torsoLowerHeight, torsoLowerRadius, torsoUpperHeight, torsoUpperRadius }: TorsoProps) {
    const chestHeight = torsoUpperHeight * MANNEQUIN_GEOMETRY.chestHeightScale;
    const chestTopRadius = torsoUpperRadius;
    const chestBottomRadius = torsoUpperRadius * 0.76;
    const chestWidthScale = chestScale[0] * 0.9;
    const abdomenHeight = torsoLowerHeight * 0.88;
    const abdomenTopRadius = torsoLowerRadius * 0.78;
    const abdomenBottomRadius = torsoLowerRadius * 0.94;
    const chestBottomY = chestPosition[1] - chestHeight * 0.5;
    const abdomenTopY = abdomenPosition[1] + abdomenHeight * 0.5;
    const diaphragmHeight = Math.max(chestBottomY - abdomenTopY + torsoLowerRadius * 0.4, torsoLowerRadius * 0.36);
    const diaphragmY = (chestBottomY + abdomenTopY) * 0.5;
    const chestProfile = [
        new Vector2(0, -chestHeight * MANNEQUIN_GEOMETRY.chestProfileHalfExtent),
        new Vector2(chestBottomRadius * 0.82, -chestHeight * 0.49),
        new Vector2(chestBottomRadius, -chestHeight * 0.36),
        new Vector2(chestTopRadius * 0.91, -chestHeight * 0.05),
        new Vector2(chestTopRadius, chestHeight * 0.3),
        new Vector2(chestTopRadius * 0.86, chestHeight * 0.49),
        new Vector2(0, chestHeight * MANNEQUIN_GEOMETRY.chestProfileHalfExtent),
    ];
    const abdomenProfile = [
        new Vector2(0, -abdomenHeight * 0.515),
        new Vector2(abdomenBottomRadius * 0.88, -abdomenHeight * 0.49),
        new Vector2(abdomenBottomRadius, -abdomenHeight * 0.3),
        new Vector2(torsoLowerRadius * 0.86, abdomenHeight * 0.06),
        new Vector2(abdomenTopRadius, abdomenHeight * 0.46),
        new Vector2(0, abdomenHeight * 0.515),
    ];
    const deltoidX = torsoUpperRadius * chestWidthScale * 1.12;
    const deltoidY = chestPosition[1] + chestHeight * 0.27;

    return (
        <>
            <mesh
                name="humanoid-torso-core"
                position={[0, (chestPosition[1] + pelvisPosition[1]) * 0.5, -torsoLowerRadius * 0.04]}
                scale={[abdomenScale[0] * 0.68, 1, abdomenScale[2] * 0.72]}
                castShadow
                receiveShadow
            >
                <capsuleGeometry args={[torsoLowerRadius * 0.72, Math.max(chestPosition[1] - pelvisPosition[1], torsoLowerHeight), 10, 20]} />
                <HumanoidMaterial color={color} />
            </mesh>

            <mesh name="humanoid-ribcage" position={chestPosition} scale={[chestWidthScale, 1, chestScale[2]]} castShadow receiveShadow>
                <latheGeometry args={[chestProfile, 36]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh
                name="humanoid-shoulder-bridge"
                position={[chestPosition[0], chestPosition[1] + chestHeight * MANNEQUIN_GEOMETRY.shoulderBridgeCenterScale, chestPosition[2]]}
                rotation={[0, 0, Math.PI / 2]}
                scale={[1, 1, chestScale[2] * 0.82]}
                castShadow
                receiveShadow
            >
                <capsuleGeometry args={[torsoUpperRadius * MANNEQUIN_GEOMETRY.shoulderBridgeRadiusScale, torsoUpperRadius * 2.16, 10, 24]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh
                name="humanoid-left-deltoid"
                position={[-deltoidX, deltoidY, chestPosition[2]]}
                rotation={[0, 0, -0.16]}
                scale={[torsoUpperRadius * 0.34, torsoUpperRadius * 0.5, torsoUpperRadius * chestScale[2] * 0.4]}
                castShadow
                receiveShadow
            >
                <sphereGeometry args={[1, 28, 18]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh
                name="humanoid-right-deltoid"
                position={[deltoidX, deltoidY, chestPosition[2]]}
                rotation={[0, 0, 0.16]}
                scale={[torsoUpperRadius * 0.34, torsoUpperRadius * 0.5, torsoUpperRadius * chestScale[2] * 0.4]}
                castShadow
                receiveShadow
            >
                <sphereGeometry args={[1, 28, 18]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh name="humanoid-diaphragm" position={[0, diaphragmY, 0]} scale={[abdomenScale[0], 1, abdomenScale[2]]} castShadow receiveShadow>
                <cylinderGeometry args={[chestBottomRadius * 0.93, abdomenTopRadius * 0.98, diaphragmHeight, 28, 3]} />
                <HumanoidMaterial color={color} />
            </mesh>

            <mesh name="humanoid-abdomen" position={abdomenPosition} scale={[abdomenScale[0], 1, abdomenScale[2]]} castShadow receiveShadow>
                <latheGeometry args={[abdomenProfile, 32]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <mesh
                name="humanoid-waist-line"
                position={[abdomenPosition[0], abdomenPosition[1] - abdomenHeight * 0.5, abdomenPosition[2]]}
                rotation={[Math.PI / 2, 0, 0]}
                scale={[abdomenScale[0], abdomenScale[2], 1]}
            >
                <torusGeometry args={[abdomenBottomRadius * 0.88, Math.max(torsoLowerRadius * 0.025, 0.0025), 6, 32]} />
                <JointMaterial />
            </mesh>

            {showPelvis ? <Pelvis color={color} pelvisPosition={pelvisPosition} pelvisRadius={pelvisRadius} pelvisScale={pelvisScale} /> : null}
        </>
    );
}

export function Head({ color, headRadius, headScale, neckHeight, neckPosition, neckRadius, position, rotation }: HeadProps) {
    const headWidth = headRadius * headScale[0];
    const headHeight = headRadius * headScale[1];
    const headDepth = headRadius * headScale[2];
    const neckTopY = neckPosition[1] + neckHeight * 0.5;
    const headOffset: [number, number, number] = [
        position[0] - neckPosition[0],
        position[1] - neckTopY,
        position[2] - neckPosition[2],
    ];

    return (
        <>
            <mesh name="humanoid-neck" position={neckPosition} castShadow receiveShadow>
                <cylinderGeometry args={[neckRadius * 0.82, neckRadius * 1.12, neckHeight, 20, 2]} />
                <HumanoidMaterial color={color} />
            </mesh>
            <group name="humanoid-head-pivot" position={[neckPosition[0], neckTopY, neckPosition[2]]} rotation={rotation}>
                <mesh name="humanoid-head" position={headOffset} scale={[headWidth, headHeight * MANNEQUIN_GEOMETRY.headHeightScale, headDepth]} castShadow receiveShadow>
                    <sphereGeometry args={[1, 32, 22]} />
                    <HumanoidMaterial color={color} />
                </mesh>
            </group>
        </>
    );
}
