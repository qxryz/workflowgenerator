export type ProviderProtocol = "openai" | "gemini" | "qwen" | "minimax" | "ark" | "xai" | "agnes";
export type ProviderModelCapability = "image" | "video" | "text" | "audio";

export type ProviderModelPreset = {
    name: string;
    label: string;
    capability: ProviderModelCapability;
    description: string;
};

export type ProviderDefinition = {
    id: ProviderProtocol;
    label: string;
    shortLabel: string;
    baseUrl: string;
    description: string;
    accent: string;
    presets: ProviderModelPreset[];
};

export type ImageOutputParameters = {
    responseFormat?: "b64_json" | "url";
    outputFormat?: "png";
};

export type ModelUiAdaptation = {
    native: boolean;
    label: "原生 UI" | "通用 UI";
    detail: string;
};

export const providerDefinitions: ProviderDefinition[] = [
    {
        id: "openai",
        label: "OpenAI",
        shortLabel: "OpenAI",
        baseUrl: "https://api.openai.com",
        description: "适合 OpenAI 官方接口和兼容渠道",
        accent: "#111827",
        presets: [
            { name: "gpt-image-2", label: "GPT Image 2", capability: "image", description: "图片生成与编辑" },
            { name: "sora-2", label: "Sora 2", capability: "video", description: "视频生成" },
            { name: "gpt-5.5", label: "GPT 5.5", capability: "text", description: "文本与视觉理解" },
            { name: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", capability: "audio", description: "语音生成" },
        ],
    },
    {
        id: "qwen",
        label: "阿里云百炼 / 千问",
        shortLabel: "千问",
        baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        description: "千问语音生成、声音克隆与语音转录模型",
        accent: "#6d5dfc",
        presets: [
            { name: "qwen-audio-3.0-tts-flash", label: "Qwen Audio TTS Flash", capability: "audio", description: "语音合成与克隆音色" },
            { name: "qwen3-tts-vc-2026-01-22", label: "Qwen3 TTS Voice Clone", capability: "audio", description: "克隆音色语音合成" },
            { name: "qwen3-asr-flash", label: "Qwen3 ASR Flash", capability: "audio", description: "语音转录" },
        ],
    },
    {
        id: "minimax",
        label: "MiniMax",
        shortLabel: "MiniMax",
        baseUrl: "https://api.minimaxi.com",
        description: "MiniMax 文本、图片、视频与语音模型",
        accent: "#f25a29",
        presets: [
            { name: "MiniMax-M3", label: "MiniMax M3", capability: "text", description: "当前会话支持文字与图片；接口另支持视频理解" },
            { name: "image-01", label: "MiniMax Image 01", capability: "image", description: "图片生成与角色参考编辑" },
            { name: "MiniMax-H3", label: "MiniMax H3", capability: "video", description: "支持多模态参考的视频生成" },
            { name: "MiniMax-Hailuo-2.3", label: "MiniMax Hailuo 2.3", capability: "video", description: "文生视频与单首帧图生视频" },
            { name: "MiniMax-Hailuo-2.3-Fast", label: "MiniMax Hailuo 2.3 Fast", capability: "video", description: "快速图生视频" },
            { name: "speech-2.8-hd", label: "MiniMax Speech 2.8 HD", capability: "audio", description: "高品质语音生成与声音克隆" },
            { name: "speech-2.8-turbo", label: "MiniMax Speech 2.8 Turbo", capability: "audio", description: "低延迟语音生成与声音克隆" },
        ],
    },
    {
        id: "gemini",
        label: "Google Gemini",
        shortLabel: "Gemini",
        baseUrl: "https://generativelanguage.googleapis.com",
        description: "适合 Gemini 原生生成接口",
        accent: "#4f46e5",
        presets: [
            { name: "gemini-3.1-flash-image-preview", label: "Gemini Image", capability: "image", description: "图片生成与编辑" },
            { name: "gemini-3.1-pro-preview", label: "Gemini Pro", capability: "text", description: "文本与多模态理解" },
        ],
    },
    {
        id: "xai",
        label: "xAI Grok",
        shortLabel: "Grok",
        baseUrl: "https://api.x.ai/v1",
        description: "Grok 文本、图片与视频创作",
        accent: "#2563eb",
        presets: [
            { name: "grok-imagine-image-quality", label: "Grok Imagine Image", capability: "image", description: "1K / 2K 图片生成与多图编辑" },
            { name: "grok-imagine-video", label: "Grok Imagine Video", capability: "video", description: "文生视频、图生视频与参考图引导" },
            { name: "grok-imagine-video-1.5", label: "Grok Imagine Video 1.5", capability: "video", description: "支持 1080p 图生视频" },
            { name: "grok-4.5", label: "Grok 4.5", capability: "text", description: "文本与视觉理解" },
        ],
    },
    {
        id: "agnes",
        label: "Agnes AI",
        shortLabel: "Agnes",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        description: "Agnes 全模态模型接口",
        accent: "#db2777",
        presets: [
            { name: "agnes-2.5-flash", label: "Agnes 2.5 Flash", capability: "text", description: "快速文本与多模态理解" },
            { name: "agnes-image-2.1-flash", label: "Agnes Image 2.1 Flash", capability: "image", description: "图片生成与编辑" },
            { name: "agnes-video-v2.0", label: "Agnes Video V2.0", capability: "video", description: "带声音的视频生成" },
        ],
    },
    {
        id: "ark",
        label: "火山方舟",
        shortLabel: "方舟",
        baseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        description: "豆包 Seedream、Seedance 与文本模型",
        accent: "#0891b2",
        presets: [
            { name: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 Lite", capability: "image", description: "最新图片创作模型" },
            { name: "doubao-seedream-4-5-251128", label: "Seedream 4.5", capability: "image", description: "多图编辑与 4K 输出" },
            { name: "doubao-seedance-2-0-260128", label: "Seedance 2.0", capability: "video", description: "图文音视频混合参考与原生声音" },
            { name: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro", capability: "video", description: "有声视频生成" },
            { name: "doubao-seed-2-0-lite-260215", label: "Doubao Seed 2.0 Lite", capability: "text", description: "文本与多模态理解" },
        ],
    },
];

export function getProviderDefinition(protocol: ProviderProtocol) {
    return providerDefinitions.find((provider) => provider.id === protocol) || providerDefinitions[0];
}

export function providerLabel(protocol: ProviderProtocol) {
    return getProviderDefinition(protocol).label;
}

export function inferModelProvider(modelName: string): ProviderProtocol | undefined {
    const name = modelName.trim().toLowerCase();
    if (!name) return undefined;
    const presetOwner = providerDefinitions.find((provider) => provider.presets.some((preset) => preset.name.toLowerCase() === name));
    if (presetOwner) return presetOwner.id;
    if (/grok/u.test(name)) return "xai";
    if (/agnes/u.test(name)) return "agnes";
    if (/(?:^|[-_/])minimax(?:[-_/]|$)|^speech-2\.8-(?:hd|turbo)$/u.test(name)) return "minimax";
    if (/(?:^|[-_/])(gemini|imagen|veo)(?:[-_/]|$)/u.test(name)) return "gemini";
    if (/(?:doubao|seedream|seedance|volcengine)/u.test(name)) return "ark";
    if (/^(?:gpt-|chatgpt-|o[1-9](?:-|$)|dall-e|sora-|whisper-|tts-)/u.test(name)) return "openai";
    return undefined;
}

export function modelBelongsToProvider(modelName: string, provider: ProviderProtocol, declaredProvider?: ProviderProtocol) {
    if (declaredProvider) return declaredProvider === provider;
    const inferredProvider = inferModelProvider(modelName);
    return !inferredProvider || inferredProvider === provider;
}

export type ModelExperienceKind = "generic-image" | "openai-image" | "gemini-image" | "grok-image" | "agnes-image" | "seedream-image" | "minimax-image" | "generic-video" | "grok-video" | "agnes-video" | "seedance-video" | "minimax-video" | "minimax-hailuo-video" | "qwen-audio" | "minimax-audio";

export function modelExperienceKind(protocol: ProviderProtocol, modelName: string, capability: ProviderModelCapability): ModelExperienceKind {
    const name = modelName.toLowerCase();
    const provider = inferModelProvider(modelName) || protocol;
    if (capability === "audio" && provider === "qwen") return "qwen-audio";
    if (capability === "audio" && provider === "minimax") return "minimax-audio";
    if (capability === "image") {
        if (provider === "minimax") return "minimax-image";
        if (provider === "xai" || name.includes("grok-imagine-image")) return "grok-image";
        if (provider === "agnes" || name.includes("agnes-image")) return "agnes-image";
        if (provider === "ark" || name.includes("seedream")) return "seedream-image";
        if (provider === "gemini" || name.includes("gemini")) return "gemini-image";
        if (provider === "openai" || name.includes("gpt-image") || name.includes("dall")) return "openai-image";
        return "generic-image";
    }
    if (provider === "minimax") return name === "minimax-hailuo-2.3" || name === "minimax-hailuo-2.3-fast" ? "minimax-hailuo-video" : "minimax-video";
    if (provider === "xai" || name.includes("grok-imagine-video")) return "grok-video";
    if (provider === "agnes" || name.includes("agnes-video")) return "agnes-video";
    if (provider === "ark" || name.includes("seedance")) return "seedance-video";
    return "generic-video";
}

/**
 * Optional image-output parameters are only sent to model families that
 * explicitly accept them. OpenAI-compatible relays often reject unknown
 * fields, so custom model names intentionally receive the minimal payload.
 */
export function imageOutputParameters(protocol: ProviderProtocol, modelName: string): ImageOutputParameters {
    const name = modelName.trim().toLowerCase();
    if (protocol === "ark") return { responseFormat: "url" };
    if (protocol === "xai") return { responseFormat: "b64_json" };
    if (protocol !== "openai") return {};
    if (/^dall-e-(?:2|3)$/u.test(name)) return { responseFormat: "b64_json" };
    if (/^gpt-image(?:-|$)/u.test(name)) return { outputFormat: "png" };
    return {};
}

export function supportsArkPromptOptimization(modelName: string) {
    return /(?:^|-)seedream-4-0(?:-|$)/iu.test(modelName.trim());
}

export function arkImageGenerationParameters(modelName: string, size: string | undefined, count: number, watermark: boolean, optimizePrompt: boolean) {
    const multiple = count > 1;
    return {
        ...(size ? { size } : {}),
        response_format: "url" as const,
        sequential_image_generation: multiple ? ("auto" as const) : ("disabled" as const),
        ...(multiple ? { sequential_image_generation_options: { max_images: count } } : {}),
        watermark,
        ...(optimizePrompt && supportsArkPromptOptimization(modelName) ? { optimize_prompt_options: { mode: "standard" as const } } : {}),
    };
}

/** Remove unsupported optional image-output fields from direct calls and saved user scripts alike. */
export function sanitizeImageRequestPayload(protocol: ProviderProtocol, modelName: string, body: unknown) {
    const outputParameters = imageOutputParameters(protocol, modelName);
    if (outputParameters.responseFormat && outputParameters.outputFormat) return body;
    if (typeof FormData !== "undefined" && body instanceof FormData) {
        if (!outputParameters.responseFormat) body.delete("response_format");
        if (!outputParameters.outputFormat) body.delete("output_format");
        return body;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) return body;
    const payload = { ...(body as Record<string, unknown>) };
    if (!outputParameters.responseFormat) delete payload.response_format;
    if (!outputParameters.outputFormat) delete payload.output_format;
    return payload;
}

export function imageOutputParameterLabel(protocol: ProviderProtocol, modelName: string) {
    const parameters = imageOutputParameters(protocol, modelName);
    if (parameters.responseFormat === "url") return "图片链接返回";
    if (parameters.responseFormat) return "Base64 图像返回";
    if (parameters.outputFormat) return "PNG 图像输出";
    return "最小兼容参数";
}

export function modelUiAdaptation(protocol: ProviderProtocol, modelName: string, capability: ProviderModelCapability): ModelUiAdaptation {
    const provider = inferModelProvider(modelName) || protocol;
    if (capability === "audio" && provider === "qwen") return { native: true, label: "原生 UI", detail: "按语音生成、声音克隆或转录任务显示专属参数" };
    if (capability === "audio" && provider === "minimax") return { native: true, label: "原生 UI", detail: "MiniMax 语音生成与声音克隆参数" };
    if (capability === "video" && /(?:seedance|sd)[-_.\s]*2[-_.\s]*5/iu.test(modelName)) return { native: true, label: "原生 UI", detail: "Seedance 2.5 长视频、视频延长与精准编辑" };
    if (capability !== "image" && capability !== "video") return { native: false, label: "通用 UI", detail: "使用通用参数面板" };
    const experience = modelExperienceKind(protocol, modelName, capability);
    const details: Partial<Record<ModelExperienceKind, string>> = {
        "grok-image": "Grok 图片参数与参考图限制",
        "agnes-image": "Agnes 图片画幅与生成数量",
        "seedream-image": "Seedream 清晰度、多图与方舟选项",
        "minimax-image": "MiniMax 图片画幅、数量与角色参考",
        "grok-video": "Grok 时长、画幅与参考素材",
        "agnes-video": "Agnes 首帧、时长与画幅",
        "seedance-video": "Seedance 图像、视频、音频与声音设置",
        "minimax-video": "MiniMax H3 多模态参考、清晰度、时长与画幅",
        "minimax-hailuo-video": "MiniMax Hailuo 首帧、分辨率、时长与生成选项",
    };
    const detail = details[experience];
    return detail ? { native: true, label: "原生 UI", detail } : { native: false, label: "通用 UI", detail: capability === "image" ? "使用通用图像设置" : "使用通用视频设置" };
}

export function modelDisplayName(protocol: ProviderProtocol, modelName: string) {
    const preset = getProviderDefinition(protocol).presets.find((item) => item.name === modelName);
    return preset?.label || modelName;
}
