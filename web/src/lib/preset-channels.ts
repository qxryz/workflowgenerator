export type BuiltInChannelPreset = "free" | "voice";

export const DASH_SCOPE_BEIJING_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const PRESET_CHANNEL_IDS: Record<BuiltInChannelPreset, string> = { free: "preset-free", voice: "preset-voice" };

export const PRESET_CHANNEL_DEFAULTS = {
    free: {
        id: PRESET_CHANNEL_IDS.free,
        name: "免费",
        baseUrl: "https://apihub.agnes-ai.com/v1",
        apiKey: "",
        apiFormat: "agnes" as const,
        vendor: "agnes",
        adapter: "agnes",
        models: [
            { name: "agnes-image-2.1-flash", capability: "image" as const },
            { name: "agnes-video-v2.0", capability: "video" as const },
            { name: "agnes-2.5-flash", capability: "text" as const },
        ],
    },
    voice: {
        id: PRESET_CHANNEL_IDS.voice,
        name: "语音模型",
        baseUrl: DASH_SCOPE_BEIJING_BASE_URL,
        apiKey: "",
        apiFormat: "qwen" as const,
        vendor: "qwen",
        adapter: "dashscope-audio",
        models: [
            { name: "qwen-audio-3.0-tts-flash", capability: "audio" as const },
            { name: "qwen3-tts-vc-2026-01-22", capability: "audio" as const },
            { name: "qwen3-asr-flash", capability: "audio" as const },
        ],
    },
} as const;

/** Only replace the old, untouched free preset; preserve user credentials and edits. */
export function isUntouchedLegacyFreeChannel(channel: {
    baseUrl: string;
    apiKey: string;
    apiFormat: string;
    vendor?: string;
    adapter?: string;
    capabilities?: Record<string, boolean>;
    models: ReadonlyArray<{ name: string; capability: string; provider?: string; adapter?: string; script?: string }>;
}) {
    const oldModels = ["gpt-image-2", "sora-2", "gpt-5.5"];
    return channel.baseUrl === "https://api.openai.com"
        && !channel.apiKey
        && channel.apiFormat === "openai"
        && (!channel.vendor || channel.vendor === "openai")
        && (!channel.adapter || channel.adapter === "openai-compatible")
        && !Object.values(channel.capabilities || {}).length
        && channel.models.length === oldModels.length
        && channel.models.every((model, index) => model.name === oldModels[index]
            && model.capability === ["image", "video", "text"][index]
            && (!model.provider || model.provider === "openai")
            && !model.adapter && !model.script);
}

export function nextCustomChannelName(channels: ReadonlyArray<{ name: string }>) {
    const used = new Set(channels.map((channel) => channel.name.match(/^渠道\s+(\d+)$/u)?.[1]).filter(Boolean).map(Number));
    let index = 1;
    while (used.has(index)) index += 1;
    return `渠道 ${index}`;
}
