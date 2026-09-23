/** Limits enforced by the installed Agnes video adapter. */
export const AGNES_VIDEO_CONTRACT = {
    inputModes: ["text", "first-frame"],
    references: { images: 1, videos: 0, audios: 0 },
    durationSeconds: { min: 3, max: 18 },
    frameRate: 24,
} as const;
