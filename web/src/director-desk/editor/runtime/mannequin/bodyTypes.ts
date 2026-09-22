import type { CharacterBodyType } from "../../schema/directorProject";

export type { CharacterBodyType };

export const DEFAULT_CHARACTER_BODY_TYPE: CharacterBodyType = "mannequin";

export interface CharacterBodyProportions {
  hipY: number;
  pelvisRadius: number;
  pelvisScale: [number, number, number];
  legSpread: number;
  torsoLowerRadius: number;
  torsoUpperRadius: number;
  torsoLowerHeight: number;
  torsoUpperHeight: number;
  torsoLowerScale: [number, number, number];
  torsoUpperScale: [number, number, number];
  shoulderWidth: number;
  shoulderRadius: number;
  upperArmRadius: number;
  upperArmLength: number;
  forearmRadius: number;
  forearmLength: number;
  elbowRadius: number;
  wristRadius: number;
  handRadius: number;
  handScale: [number, number, number];
  thighRadius: number;
  thighLength: number;
  calfRadius: number;
  calfLength: number;
  kneeRadius: number;
  ankleRadius: number;
  footRadius: number;
  footLength: number;
  footScale: [number, number, number];
  neckRadius: number;
  neckHeight: number;
  headRadius: number;
  headScale: [number, number, number];
  faceOffsetZ: number;
  eyeRadius: number;
  noseScale: [number, number, number];
  mouthScale: [number, number, number];
  jointRadiusScale: number;
}

export interface CharacterBodyPreset {
  bodyType: CharacterBodyType;
  label: string;
  defaultScale: [number, number, number];
  labelAnchorY: number;
  proportions: CharacterBodyProportions;
}

const BASE_PROPORTIONS: CharacterBodyProportions = {
  hipY: 0.74,
  pelvisRadius: 0.22,
  pelvisScale: [1.22, 0.62, 0.8],
  legSpread: 0.16,
  torsoLowerRadius: 0.18,
  torsoUpperRadius: 0.22,
  torsoLowerHeight: 0.26,
  torsoUpperHeight: 0.48,
  torsoLowerScale: [0.95, 0.96, 0.78],
  torsoUpperScale: [1.42, 1.08, 0.88],
  shoulderWidth: 0.39,
  shoulderRadius: 0.11,
  upperArmRadius: 0.095,
  upperArmLength: 0.325,
  forearmRadius: 0.078,
  forearmLength: 0.296,
  elbowRadius: 0.078,
  wristRadius: 0.064,
  handRadius: 0.082,
  handScale: [0.82, 1, 0.82],
  thighRadius: 0.135,
  thighLength: 0.395,
  calfRadius: 0.11,
  calfLength: 0.385,
  kneeRadius: 0.095,
  ankleRadius: 0.07,
  footRadius: 0.09,
  footLength: 0.22,
  footScale: [0.95, 0.55, 1.42],
  neckRadius: 0.075,
  neckHeight: 0.13,
  headRadius: 0.182,
  headScale: [0.73, 1.08, 0.75],
  faceOffsetZ: 0.18,
  eyeRadius: 0.022,
  noseScale: [0.42, 0.58, 0.32],
  mouthScale: [0.55, 0.1, 0.08],
  jointRadiusScale: 1,
};

function preset(
  bodyType: CharacterBodyType,
  label: string,
  labelAnchorY: number,
  patch: Partial<CharacterBodyProportions> = {},
  defaultScale: [number, number, number] = [1, 1, 1]
): CharacterBodyPreset {
  return {
    bodyType,
    defaultScale,
    label,
    labelAnchorY,
    proportions: {
      ...BASE_PROPORTIONS,
      ...patch,
    },
  };
}

export const CHARACTER_BODY_PRESETS: CharacterBodyPreset[] = [
  preset("mannequin", "男性素体", 2.82, {
    shoulderWidth: 0.37,
  }),
  preset("female", "女性素体", 2.8, {
    pelvisScale: [1.36, 0.56, 0.78],
    torsoLowerRadius: 0.16,
    torsoUpperRadius: 0.2,
    torsoLowerScale: [0.86, 0.98, 0.72],
    torsoUpperScale: [1.2, 1.04, 0.8],
    shoulderWidth: 0.35,
    shoulderRadius: 0.105,
    upperArmRadius: 0.085,
    forearmRadius: 0.07,
    handRadius: 0.076,
    thighRadius: 0.115,
    calfRadius: 0.095,
    neckRadius: 0.07,
    headRadius: 0.185,
    headScale: [0.72, 1.09, 0.74],
  }),
  preset("broad", "宽厚素体", 2.93, {
    pelvisScale: [1.34, 0.62, 0.86],
    torsoLowerScale: [1.05, 0.98, 0.84],
    torsoUpperScale: [1.38, 1.08, 0.94],
    torsoUpperRadius: 0.25,
    torsoUpperHeight: 0.52,
    shoulderWidth: 0.47,
    shoulderRadius: 0.14,
    upperArmRadius: 0.12,
    forearmRadius: 0.095,
    handRadius: 0.09,
    thighRadius: 0.145,
    calfRadius: 0.12,
    neckRadius: 0.09,
    headRadius: 0.205,
    headScale: [0.72, 1.05, 0.74],
  }),
  preset("muscular", "健壮素体", 2.89, {
    pelvisScale: [1.32, 0.56, 0.8],
    torsoLowerRadius: 0.17,
    torsoUpperRadius: 0.26,
    torsoLowerScale: [0.95, 0.96, 0.78],
    torsoUpperScale: [1.38, 1.06, 0.9],
    shoulderWidth: 0.43,
    shoulderRadius: 0.145,
    upperArmRadius: 0.125,
    forearmRadius: 0.1,
    handRadius: 0.09,
    thighRadius: 0.15,
    calfRadius: 0.125,
    neckRadius: 0.085,
    headRadius: 0.19,
    headScale: [0.73, 1.07, 0.75],
  }),
  preset("slim", "纤细素体", 2.73, {
    pelvisScale: [1.1, 0.5, 0.7],
    torsoLowerRadius: 0.14,
    torsoUpperRadius: 0.17,
    torsoLowerScale: [0.78, 0.96, 0.68],
    torsoUpperScale: [1.12, 1.02, 0.72],
    shoulderWidth: 0.32,
    shoulderRadius: 0.095,
    upperArmRadius: 0.068,
    forearmRadius: 0.056,
    handRadius: 0.07,
    thighRadius: 0.095,
    calfRadius: 0.078,
    neckRadius: 0.065,
    headRadius: 0.17,
    headScale: [0.72, 1.1, 0.74],
  }),
  preset("teen", "少年素体", 2.58, {
    hipY: 0.64,
    pelvisRadius: 0.22,
    pelvisScale: [1.14, 0.52, 0.74],
    legSpread: 0.15,
    torsoLowerRadius: 0.15,
    torsoLowerHeight: 0.22,
    torsoUpperRadius: 0.18,
    torsoUpperHeight: 0.4,
    torsoLowerScale: [0.82, 0.94, 0.7],
    torsoUpperScale: [1.16, 1.02, 0.76],
    shoulderWidth: 0.32,
    shoulderRadius: 0.095,
    upperArmRadius: 0.074,
    upperArmLength: 0.28,
    forearmRadius: 0.062,
    forearmLength: 0.25,
    handRadius: 0.075,
    thighRadius: 0.103,
    thighLength: 0.35,
    calfRadius: 0.088,
    calfLength: 0.33,
    neckRadius: 0.068,
    headRadius: 0.19,
    headScale: [0.75, 1.1, 0.75],
  }),
  preset("child", "儿童素体", 2.07, {
    hipY: 0.5,
    pelvisRadius: 0.18,
    pelvisScale: [1.08, 0.48, 0.72],
    legSpread: 0.12,
    torsoLowerRadius: 0.13,
    torsoLowerHeight: 0.18,
    torsoUpperRadius: 0.15,
    torsoUpperHeight: 0.3,
    torsoLowerScale: [0.76, 0.9, 0.68],
    torsoUpperScale: [1.02, 0.98, 0.72],
    shoulderWidth: 0.26,
    shoulderRadius: 0.08,
    upperArmRadius: 0.06,
    upperArmLength: 0.2,
    forearmRadius: 0.052,
    forearmLength: 0.18,
    elbowRadius: 0.06,
    wristRadius: 0.05,
    handRadius: 0.06,
    thighRadius: 0.08,
    thighLength: 0.24,
    calfRadius: 0.068,
    calfLength: 0.22,
    kneeRadius: 0.065,
    ankleRadius: 0.054,
    footRadius: 0.07,
    footLength: 0.16,
    neckRadius: 0.06,
    headRadius: 0.195,
    headScale: [0.84, 1.1, 0.8],
  }),
  preset("chibi", "二头身", 1.82, {
    hipY: 0.36,
    pelvisRadius: 0.18,
    pelvisScale: [1.18, 0.52, 0.82],
    legSpread: 0.11,
    torsoLowerRadius: 0.15,
    torsoLowerHeight: 0.12,
    torsoUpperRadius: 0.18,
    torsoUpperHeight: 0.22,
    torsoLowerScale: [1, 0.86, 0.78],
    torsoUpperScale: [1.2, 0.94, 0.82],
    shoulderWidth: 0.25,
    shoulderRadius: 0.085,
    upperArmRadius: 0.065,
    upperArmLength: 0.14,
    forearmRadius: 0.058,
    forearmLength: 0.12,
    elbowRadius: 0.058,
    wristRadius: 0.048,
    handRadius: 0.085,
    thighRadius: 0.082,
    thighLength: 0.15,
    calfRadius: 0.07,
    calfLength: 0.14,
    kneeRadius: 0.065,
    ankleRadius: 0.052,
    footRadius: 0.075,
    footLength: 0.14,
    footScale: [1.15, 0.65, 1.55],
    neckRadius: 0.075,
    neckHeight: 0.06,
    headRadius: 0.49,
    headScale: [0.96, 1.04, 0.9],
    faceOffsetZ: 0.25,
    eyeRadius: 0.026,
    noseScale: [0.34, 0.46, 0.28],
    mouthScale: [0.45, 0.1, 0.07],
    jointRadiusScale: 0.9,
  }, [0.82, 0.82, 0.82]),
];

export const BODY_TYPE_OPTIONS = CHARACTER_BODY_PRESETS.map(({ bodyType, label }) => ({
  bodyType,
  label,
}));

export function normalizeBodyType(value?: string | null): CharacterBodyType {
  return CHARACTER_BODY_PRESETS.some((preset) => preset.bodyType === value)
    ? (value as CharacterBodyType)
    : DEFAULT_CHARACTER_BODY_TYPE;
}

export function getBodyPreset(value?: string | null): CharacterBodyPreset {
  const bodyType = normalizeBodyType(value);
  return CHARACTER_BODY_PRESETS.find((preset) => preset.bodyType === bodyType) ?? CHARACTER_BODY_PRESETS[0];
}

export function getGroundedLabelY(value?: string | null): number {
  return getBodyPreset(value).labelAnchorY;
}
