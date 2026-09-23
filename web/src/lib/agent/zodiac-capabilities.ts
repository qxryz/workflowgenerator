import type { AiConfig } from "@/stores/use-config-store";
import { resolveChannelModelAdapter } from "../model-catalog.ts";
import { adapterCapabilitySupport, isMiniMaxAdapter } from "../model-adapters.ts";
import { AGNES_VIDEO_CONTRACT } from "../agnes-contract.ts";
import { isMiniMaxHailuoModel, MINIMAX_H3_REFERENCE_LIMITS, MINIMAX_H3_DURATION_SECONDS, MINIMAX_VIDEO_INPUT_MODES, MINIMAX_VIDEO_RATIOS, MINIMAX_VIDEO_RESOLUTIONS, MINIMAX_HAILUO_DURATIONS, MINIMAX_HAILUO_RESOLUTIONS } from "../minimax-contract.ts";
import { isSeedance25Model, SEEDANCE_25_REFERENCE_LIMITS, SEEDANCE_25_GENERATION_DURATIONS, SEEDANCE_25_INPUT_MODES } from "../seedance-2-5.ts";

function videoContract(adapter: string, model: string) {
    if (adapter === "agnes") return AGNES_VIDEO_CONTRACT;
    if (isMiniMaxAdapter(adapter)) {
        if (isMiniMaxHailuoModel(model)) return { inputModes: model.toLowerCase().endsWith("-fast") ? ["first-frame"] : ["text", "first-frame"], references: { images: 1, videos: 0, audios: 0 }, durationSeconds: MINIMAX_HAILUO_DURATIONS, resolutions: MINIMAX_HAILUO_RESOLUTIONS };
        if (model.toLowerCase() === "minimax-h3") return { inputModes: MINIMAX_VIDEO_INPUT_MODES, references: MINIMAX_H3_REFERENCE_LIMITS, durationSeconds: MINIMAX_H3_DURATION_SECONDS, resolutions: MINIMAX_VIDEO_RESOLUTIONS, ratios: MINIMAX_VIDEO_RATIOS };
    }
    if (adapter === "ark-media" && isSeedance25Model(model)) return { inputModes: SEEDANCE_25_INPUT_MODES.map(mode => mode.value), references: SEEDANCE_25_REFERENCE_LIMITS, durationSeconds: SEEDANCE_25_GENERATION_DURATIONS };
    return null;
}

export const ZODIAC_CAPABILITIES_TOOL = {
    name: "hub_list_capabilities",
    description: "读取应用已配置的模型、默认选择和实际支持的创作能力，不含密钥或服务器地址。规划前用它确认能力，配置存在不代表账号一定可调用成功。",
    parameters: { type: "object", properties: {} },
};

export function buildZodiacCapabilities(config: AiConfig) {
    return {
        runtime: { engine: "opencode", files: ["read", "write", "edit", "search", "import_to_canvas"], assetIndex: ".zodiac/assets.json", versionedAssets: true, commands: "approval_required", subagents: ["router", "planner", "executor"] },
        generation: ["image", "video", "speech"],
        documents: ["write", "read", "search", "edit_with_content_hash"],
        workflows: ["ad-tvc", "drama-series", "mv", "custom"],
        unavailable: ["music_generation", "video_editing", "comfyui", "browser_control"],
        defaults: {
            textModel: config.textModel, imageModel: config.imageModel, videoModel: config.videoModel, audioModel: config.audioModel,
            imageSize: config.size, imageCount: config.canvasImageCount, videoSeconds: config.videoSeconds,
            audioVoice: config.audioVoice, audioSpeed: config.audioSpeed,
        },
        models: config.channels.flatMap((channel) => channel.models
            .filter((model) => channel.capabilities?.[model.capability] !== false)
            .map((model) => {
                const adapter = resolveChannelModelAdapter(channel, model);
                return { id: `${channel.id}::${model.name}`, name: model.name, capability: model.capability,
                    configured: !!channel.apiKey.trim() && !!channel.baseUrl.trim(), adapter,
                    support: adapterCapabilitySupport(adapter, model.capability),
                    contract: model.capability === "video" ? videoContract(adapter, model.name) : null,
                };
            })),
        contractSource: "installed_adapter",
        unknownContract: "未列出的参数限制尚未声明，需按实际适配器校验；配置存在不代表账号可调用成功。",
    };
}
