import { modelExperienceKind, seedreamImageContract } from "../model-providers.ts";

export type ImageQualityOption = { value: string; label: string; hint?: string };
export const DEFAULT_IMAGE_QUALITY_OPTIONS: ImageQualityOption[] = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];

export function imageQualityOptionsForModel(protocol: string, modelName: string): ImageQualityOption[] {
    const experience = modelExperienceKind(protocol as never, modelName, "image");
    if (experience === "minimax-image" || experience === "agnes-image") return [];
    if (experience === "grok-image")
        return [
            { value: "1k", label: "1K", hint: "更快" },
            { value: "2k", label: "2K", hint: "细节更多" },
        ];
    if (experience === "seedream-image") {
        const minPixels = seedreamImageContract(modelName)?.minPixels || 0;
        return [
            { value: "1k", label: "1K", hint: "快速" },
            { value: "2k", label: "2K", hint: "高清" },
            { value: "4k", label: "4K", hint: "精细输出" },
        ].filter((option) => option.value !== "1k" || minPixels <= 1024 ** 2);
    }
    return DEFAULT_IMAGE_QUALITY_OPTIONS;
}

/** Resolve a local choice before display and submission, without editing saved settings. */
export function normalizeImageGenerationQuality(protocol: string, modelName: string, value: string | undefined): string {
    const experience = modelExperienceKind(protocol as never, modelName, "image");
    // Other providers and custom scripts own their quality vocabulary. Preserve
    // saved values (for example DALL-E's standard/hd) for the request adapter.
    if (experience !== "seedream-image" && experience !== "grok-image") return value || "auto";
    const options = imageQualityOptionsForModel(protocol, modelName);
    const current = (value || "auto").trim().toLowerCase();
    const tier = ({ low: "1k", standard: "1k", medium: "2k", hd: "2k", high: "4k" } as Record<string, string>)[current] || current;
    if (options.some((option) => option.value === tier)) return tier;
    return experience === "grok-image" ? tier === "4k" ? "2k" : "1k" : "2k";
}
