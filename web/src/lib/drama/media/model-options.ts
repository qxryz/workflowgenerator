import { imageQualityOptionsForModel, normalizeImageGenerationQuality, type ImageQualityOption } from "@/lib/generation/image-quality-options";
import { isMiniMaxAdapter } from "@/lib/model-adapters";
import { isMiniMaxHailuoModel, normalizeMiniMaxHailuoVideoOptions } from "@/lib/minimax-contract";
import { resolveModelUi } from "@/lib/model-ui-adaptation";
import type { ParamControl } from "@/lib/model-param-schema";
import type { ArtifactKind } from "@/lib/drama/types";
import { modelOptionName, resolveModelRequestConfig, type AiConfig, type ModelCapability } from "@/stores/use-config-store";
import type { ReferenceCapacity } from "./references";

export const capabilityOf = (kind: ArtifactKind): ModelCapability => (kind === "video" ? "video" : kind === "audio" ? "audio" : "image");

export const VIDEO_RESOLUTIONS = [
    { value: "480p", label: "480p" },
    { value: "720p", label: "720p" },
    { value: "1080p", label: "1080p" },
];

/** Empty when the model has no quality choice (the setting is hidden then). */
export function qualityChoices(config: AiConfig, model: string): ImageQualityOption[] {
    return imageQualityOptionsForModel(resolveModelRequestConfig(config, model).apiFormat, modelOptionName(model));
}

export const normalizeQuality = (config: AiConfig, model: string, value: string | undefined) => normalizeImageGenerationQuality(resolveModelRequestConfig(config, model).apiFormat, modelOptionName(model), value);

const hasControl = (controls: ParamControl[], key: string): boolean => controls.some((control) => (control.type === "group" ? hasControl(control.controls, key) : "key" in control && control.key === key));

/** Whether the video model offers a "generate sound" switch, per the same schemas the video workbench uses. */
export function supportsGenerateAudio(config: AiConfig, model: string): boolean {
    const ui = resolveModelUi(resolveModelRequestConfig(config, model).apiFormat, modelOptionName(model), "video");
    return ui.kind === "native" ? ui.experience === "seedance-video" : hasControl(ui.schema.controls, "videoGenerateAudio");
}

/**
 * Sheet pictures a shot's model can take. MiniMax image-01 accepts exactly one character reference, and Hailuo 2.3
 * accepts only the first frame. Other providers check their own limits when the request is made.
 */
export function referenceCapacity(config: AiConfig, kind: "image" | "video", model: string): ReferenceCapacity | undefined {
    const request = resolveModelRequestConfig(config, model);
    if (!isMiniMaxAdapter(request.adapter)) return undefined;
    if (kind === "image") return { max: 1, kinds: ["character"] };
    return isMiniMaxHailuoModel(request.model) ? { max: 0 } : undefined;
}

/** The length the model will actually render for a shot of `seconds`; export trims or holds the last frame to the shot length. */
export function renderedVideoSeconds(config: AiConfig, model: string, seconds: number): number {
    const request = resolveModelRequestConfig(config, model);
    return isMiniMaxAdapter(request.adapter) && isMiniMaxHailuoModel(request.model) ? normalizeMiniMaxHailuoVideoOptions("", seconds).duration : seconds;
}
