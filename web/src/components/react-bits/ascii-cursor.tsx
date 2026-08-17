"use client";

import { createPortal, extend, useFrame, useThree, Canvas } from "@react-three/fiber";
import { useFBO, shaderMaterial } from "@react-three/drei";
import { Bloom, ChromaticAberration, EffectComposer } from "@react-three/postprocessing";
import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";

type SimulationMaterial = THREE.ShaderMaterial & {
    uTime: number;
    uMouse: THREE.Vector2;
    uPreviousState: THREE.Texture | null;
    uResolution: THREE.Vector2;
    uDecay: number;
    uSpeed: number;
    uRadius: number;
};

type DisplayMaterial = THREE.ShaderMaterial & {
    uSimulationState: THREE.Texture | null;
    uFontTexture: THREE.Texture | null;
    uResolution: THREE.Vector2;
    uColor: THREE.Color;
    uBackgroundColor: THREE.Color;
    uCharCount: number;
    uGridSize: number;
    uEnableFade: boolean;
    uOpacity: number;
};

const AsciiSimulationMaterial = shaderMaterial(
    {
        uTime: 0,
        uMouse: new THREE.Vector2(),
        uPreviousState: null,
        uResolution: new THREE.Vector2(),
        uDecay: 0.02,
        uSpeed: 0,
        uRadius: 0.05,
    },
    `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    `
        uniform float uTime;
        uniform vec2 uMouse;
        uniform sampler2D uPreviousState;
        uniform vec2 uResolution;
        uniform float uDecay;
        uniform float uSpeed;
        uniform float uRadius;
        varying vec2 vUv;

        void main() {
            float previous = texture2D(uPreviousState, vUv).r;
            float aspect = uResolution.x / uResolution.y;
            float distanceToPointer = length((vUv - uMouse) * vec2(aspect, 1.0));
            float brush = smoothstep(uRadius, 0.0, distanceToPointer);
            brush *= smoothstep(0.0, 0.1, uSpeed);
            float value = max(previous, brush) - uDecay;
            gl_FragColor = vec4(vec3(max(0.0, value)), 1.0);
        }
    `,
);

const AsciiDisplayMaterial = shaderMaterial(
    {
        uSimulationState: null,
        uFontTexture: null,
        uResolution: new THREE.Vector2(),
        uColor: new THREE.Color(0, 1, 0),
        uBackgroundColor: new THREE.Color(),
        uCharCount: 10,
        uGridSize: 10,
        uEnableFade: true,
        uOpacity: 1,
    },
    `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
    `
        uniform sampler2D uSimulationState;
        uniform sampler2D uFontTexture;
        uniform vec2 uResolution;
        uniform vec3 uColor;
        uniform vec3 uBackgroundColor;
        uniform float uCharCount;
        uniform float uGridSize;
        uniform bool uEnableFade;
        uniform float uOpacity;
        varying vec2 vUv;

        float random(vec2 point) {
            return fract(sin(dot(point.xy, vec2(12.9898, 78.233))) * 43758.5453123);
        }

        void main() {
            vec2 grid = uResolution / uGridSize;
            vec2 cell = floor(vUv * grid) / grid;
            float signal = texture2D(uSimulationState, cell + (0.5 / grid)).r;
            if (signal < 0.01) discard;

            float character = floor(random(cell) * uCharCount);
            vec2 localUv = fract(vUv * grid);
            vec2 atlasUv = vec2((localUv.x + character) / uCharCount, localUv.y);
            float characterMask = texture2D(uFontTexture, atlasUv).a;
            if (random(cell + 10.0) > 0.7) characterMask = 0.0;

            float alpha = uEnableFade ? signal : 1.0;
            gl_FragColor = vec4(mix(uBackgroundColor, uColor, characterMask), alpha * uOpacity);
        }
    `,
);

extend({ AsciiSimulationMaterial, AsciiDisplayMaterial });

function createFontTexture(characters: string) {
    const fontSize = 64;
    const canvas = document.createElement("canvas");
    const context = canvas.getContext("2d");
    if (!context) return new THREE.Texture();

    canvas.width = characters.length * fontSize;
    canvas.height = fontSize;
    context.font = `bold ${fontSize}px ui-monospace, SFMono-Regular, Menlo, monospace`;
    context.fillStyle = "white";
    context.textAlign = "center";
    context.textBaseline = "middle";
    Array.from(characters).forEach((character, index) => {
        context.fillText(character, index * fontSize + fontSize / 2, fontSize / 2);
    });

    const texture = new THREE.CanvasTexture(canvas);
    texture.minFilter = THREE.NearestFilter;
    texture.magFilter = THREE.NearestFilter;
    texture.needsUpdate = true;
    return texture;
}

type SceneProps = Required<
    Pick<
        AsciiCursorProps,
        | "characters"
        | "size"
        | "color"
        | "backgroundColor"
        | "enableFade"
        | "spread"
        | "persistence"
        | "opacity"
        | "enableBloom"
        | "bloomStrength"
        | "bloomRadius"
        | "enableChromaticAberration"
        | "chromaticAberrationOffset"
    >
> & {
    simulationScene: THREE.Scene;
};

function Scene({
    simulationScene,
    characters,
    size,
    color,
    backgroundColor,
    enableFade,
    spread,
    persistence,
    opacity,
    enableBloom,
    bloomStrength,
    bloomRadius,
    enableChromaticAberration,
    chromaticAberrationOffset,
}: SceneProps) {
    const { size: canvasSize, viewport, gl } = useThree();
    const mouse = useRef(new THREE.Vector2(-1, -1));
    const previousMouse = useRef(new THREE.Vector2(-1, -1));
    const speed = useRef(0);
    const frame = useRef(0);
    const simulationMaterial = useRef<SimulationMaterial>(null);
    const displayMaterial = useRef<DisplayMaterial>(null);
    const fontTexture = useMemo(() => createFontTexture(characters), [characters]);
    const targetA = useFBO({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    const targetB = useFBO({ minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

    useEffect(() => {
        const onPointerMove = (event: PointerEvent) => {
            const rect = gl.domElement.getBoundingClientRect();
            mouse.current.set((event.clientX - rect.left) / rect.width, 1 - (event.clientY - rect.top) / rect.height);
        };
        window.addEventListener("pointermove", onPointerMove, { passive: true });
        return () => window.removeEventListener("pointermove", onPointerMove);
    }, [gl.domElement]);

    useEffect(() => () => fontTexture.dispose(), [fontTexture]);

    useFrame(({ clock, camera }) => {
        const writeTarget = frame.current % 2 === 0 ? targetA : targetB;
        const readTarget = frame.current % 2 === 0 ? targetB : targetA;
        const simulation = simulationMaterial.current;
        if (simulation) {
            const distance = mouse.current.distanceTo(previousMouse.current);
            speed.current = THREE.MathUtils.lerp(speed.current, distance, 0.1);
            simulation.uTime = clock.elapsedTime;
            simulation.uMouse = mouse.current;
            simulation.uPreviousState = readTarget.texture;
            simulation.uResolution.set(canvasSize.width, canvasSize.height);
            simulation.uRadius = spread * 0.01;
            simulation.uDecay = 0.02 / Math.max(0.1, persistence);
            simulation.uSpeed = speed.current;
            previousMouse.current.copy(mouse.current);
        }

        gl.setRenderTarget(writeTarget);
        gl.render(simulationScene, camera);
        gl.setRenderTarget(null);

        const display = displayMaterial.current;
        if (display) {
            display.uSimulationState = writeTarget.texture;
            display.uFontTexture = fontTexture;
            display.uResolution.set(canvasSize.width, canvasSize.height);
            display.uColor.set(color);
            display.uBackgroundColor.set(backgroundColor);
            display.uCharCount = Array.from(characters).length;
            display.uGridSize = size;
            display.uEnableFade = enableFade;
            display.uOpacity = opacity;
        }
        frame.current += 1;
    });

    return (
        <>
            {createPortal(
                <mesh>
                    <planeGeometry args={[viewport.width, viewport.height]} />
                    {/* @ts-expect-error shader material registered through extend */}
                    <asciiSimulationMaterial ref={simulationMaterial} />
                </mesh>,
                simulationScene,
            )}
            <mesh>
                <planeGeometry args={[viewport.width, viewport.height]} />
                {/* @ts-expect-error shader material registered through extend */}
                <asciiDisplayMaterial ref={displayMaterial} transparent />
            </mesh>
            {enableBloom || enableChromaticAberration ? (
                <EffectComposer>
                    {enableBloom ? <Bloom luminanceThreshold={0} mipmapBlur intensity={bloomStrength} radius={bloomRadius} /> : <></>}
                    {enableChromaticAberration ? (
                        <ChromaticAberration offset={new THREE.Vector2(chromaticAberrationOffset, chromaticAberrationOffset)} radialModulation={false} modulationOffset={0} />
                    ) : (
                        <></>
                    )}
                </EffectComposer>
            ) : null}
        </>
    );
}

export type AsciiCursorProps = {
    characters?: string;
    size?: number;
    color?: string;
    backgroundColor?: string;
    enableFade?: boolean;
    spread?: number;
    persistence?: number;
    opacity?: number;
    enableBloom?: boolean;
    bloomStrength?: number;
    bloomRadius?: number;
    enableChromaticAberration?: boolean;
    chromaticAberrationOffset?: number;
    className?: string;
};

export default function AsciiCursor({
    characters = "WG+→◇◌×·",
    size = 34,
    color = "#7aa7ff",
    backgroundColor = "#0b0e14",
    enableFade = true,
    spread = 16,
    persistence = 1.8,
    opacity = 0.72,
    enableBloom = false,
    bloomStrength = 1.2,
    bloomRadius = 0.28,
    enableChromaticAberration = false,
    chromaticAberrationOffset = 0.003,
    className,
}: AsciiCursorProps) {
    const simulationScene = useMemo(() => new THREE.Scene(), []);
    const [reduceMotion, setReduceMotion] = useState(false);

    useEffect(() => {
        const media = window.matchMedia("(prefers-reduced-motion: reduce)");
        const update = () => setReduceMotion(media.matches);
        update();
        media.addEventListener("change", update);
        return () => media.removeEventListener("change", update);
    }, []);

    if (reduceMotion) return null;

    return (
        <div className={`pointer-events-none absolute inset-0 z-0 overflow-hidden ${className || ""}`} aria-hidden="true">
            <Canvas orthographic dpr={[1, 1.25]} camera={{ zoom: 1, position: [0, 0, 1], near: 0.1, far: 1000 }} gl={{ alpha: true, antialias: false }} style={{ width: "100%", height: "100%" }}>
                <Scene
                    simulationScene={simulationScene}
                    characters={characters}
                    size={size}
                    color={color}
                    backgroundColor={backgroundColor}
                    enableFade={enableFade}
                    spread={spread}
                    persistence={persistence}
                    opacity={opacity}
                    enableBloom={enableBloom}
                    bloomStrength={bloomStrength}
                    bloomRadius={bloomRadius}
                    enableChromaticAberration={enableChromaticAberration}
                    chromaticAberrationOffset={chromaticAberrationOffset}
                />
            </Canvas>
        </div>
    );
}
