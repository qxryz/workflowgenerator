export type BuiltInChannelPreset = "free" | "voice";

export const DASH_SCOPE_BEIJING_BASE_URL = "https://dashscope.aliyuncs.com/compatible-mode/v1";
export const PRESET_CHANNEL_IDS: Record<BuiltInChannelPreset, string> = { free: "preset-free", voice: "preset-voice" };

export const PRESET_CHANNEL_DEFAULTS = {
    free: {
        id: PRESET_CHANNEL_IDS.free,
        name: "免费",
        baseUrl: "https://api.openai.com",
        apiKey: "",
        apiFormat: "openai" as const,
        vendor: "openai",
        adapter: "openai-compatible",
        models: [
            { name: "gpt-image-2", capability: "image" as const },
            { name: "sora-2", capability: "video" as const },
            { name: "gpt-5.5", capability: "text" as const },
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

export function nextCustomChannelName(channels: ReadonlyArray<{ name: string }>) {
    const used = new Set(channels.map((channel) => channel.name.match(/^渠道\s+(\d+)$/u)?.[1]).filter(Boolean).map(Number));
    let index = 1;
    while (used.has(index)) index += 1;
    return `渠道 ${index}`;
}
