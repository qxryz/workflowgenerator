import type { AiConfig } from "@/stores/use-config-store";

export const ZODIAC_CAPABILITIES_TOOL = {
    name: "hub_list_capabilities",
    description: "读取应用已配置的模型、默认选择和实际支持的创作能力，不含密钥或服务器地址。规划前用它确认能力，配置存在不代表账号一定可调用成功。",
    parameters: { type: "object", properties: {} },
};

export function buildZodiacCapabilities(config: AiConfig) {
    return {
        runtime: { engine: "opencode", files: ["read", "write", "edit", "search", "import_to_canvas"], commands: "approval_required", subagents: ["router", "planner", "executor"] },
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
            .map((model) => ({ id: `${channel.id}::${model.name}`, name: model.name, capability: model.capability, configured: !!channel.apiKey.trim() && !!channel.baseUrl.trim() }))),
    };
}
