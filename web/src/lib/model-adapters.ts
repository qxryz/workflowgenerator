import type { ModelCapability } from "@/stores/use-config-store";

/**
 * 协议适配器注册表：把请求协议、鉴权和连接策略与模型目录解耦。
 *
 * 大多数适配器只描述“怎么说话”；当同一厂商的凭据、计费和权益边界
 * 不可混用时，可以拆成多个适配器并复用同一套底层序列化函数。
 * 厂商和模型仍放在 model-catalog.ts。
 */
export type AdapterId =
    | "openai-compatible"
    | "openai-response"
    | "anthropic"
    | "gemini"
    | "dashscope-audio"
    | "minimax-token-plan-native"
    | "minimax-api-native"
    | "ark-media"
    | "xai"
    | "agnes"
    | "custom";
export type AdapterCapabilitySupport = "native" | "script" | "unsupported";
export type AdapterCapabilities = Record<ModelCapability, AdapterCapabilitySupport>;

export type ModelAdapterDefinition = {
    id: AdapterId;
    label: string;
    shortLabel: string;
    description: string;
    defaultBaseUrl: string;
    /** 请求鉴权方式：Bearer 头 / 谷歌专用头 / 自定义（脚本） */
    auth: "bearer" | "x-goog-api-key" | "custom";
    /** 能力表：文本/图片/视频/音频分别支持到什么程度。 */
    capabilities: AdapterCapabilities;
    /** 旧版协议值映射到该适配器（兼容已保存配置）。 */
    legacyProtocols: readonly string[];
};

const NATIVE = "native" as const;
const SCRIPT = "script" as const;
const UNSUPPORTED = "unsupported" as const;

export const modelAdapters: readonly ModelAdapterDefinition[] = [
    {
        id: "openai-compatible",
        label: "OpenAI 兼容",
        shortLabel: "OpenAI",
        description: "OpenAI 官方及绝大多数第三方中转共用的一套格式",
        defaultBaseUrl: "https://api.openai.com",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: NATIVE },
        legacyProtocols: ["openai"],
    },
    {
        id: "openai-response",
        label: "OpenAI Responses",
        shortLabel: "Responses",
        description: "OpenAI 新一代 Responses 接口",
        defaultBaseUrl: "https://api.openai.com",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: NATIVE },
        legacyProtocols: [],
    },
    {
        id: "anthropic",
        label: "Anthropic",
        shortLabel: "Anthropic",
        description: "Claude Messages 原生格式",
        defaultBaseUrl: "https://api.anthropic.com",
        auth: "bearer",
        capabilities: { text: SCRIPT, image: UNSUPPORTED, video: UNSUPPORTED, audio: UNSUPPORTED },
        legacyProtocols: [],
    },
    {
        id: "gemini",
        label: "Google Gemini",
        shortLabel: "Gemini",
        description: "Gemini generateContent 原生格式",
        defaultBaseUrl: "https://generativelanguage.googleapis.com",
        auth: "x-goog-api-key",
        capabilities: { text: NATIVE, image: NATIVE, video: SCRIPT, audio: SCRIPT },
        legacyProtocols: ["gemini"],
    },
    {
        id: "dashscope-audio",
        label: "阿里云百炼音频",
        shortLabel: "千问音频",
        description: "千问语音合成、声音克隆与语音识别接口",
        defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        auth: "bearer",
        capabilities: { text: UNSUPPORTED, image: UNSUPPORTED, video: UNSUPPORTED, audio: NATIVE },
        legacyProtocols: ["qwen"],
    },
    {
        id: "minimax-token-plan-native",
        label: "MiniMax Token Plan 原生",
        shortLabel: "Token Plan",
        description: "使用 Token Plan 专属 Key 调用 MiniMax 原生接口",
        defaultBaseUrl: "https://api.minimaxi.com",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: NATIVE },
        legacyProtocols: [],
    },
    {
        id: "minimax-api-native",
        label: "MiniMax API 计费原生",
        shortLabel: "MiniMax API",
        description: "使用 MiniMax API Key，调用已接入的按量计费原生接口",
        defaultBaseUrl: "https://api.minimaxi.com",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: NATIVE },
        legacyProtocols: ["minimax"],
    },
    {
        id: "ark-media",
        label: "火山方舟媒体",
        shortLabel: "方舟",
        description: "豆包 Seedream / Seedance 媒体生成接口",
        defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: SCRIPT },
        legacyProtocols: ["ark"],
    },
    {
        id: "xai",
        label: "xAI Grok 原生",
        shortLabel: "Grok",
        description: "Grok 图片 / 视频专属接口",
        defaultBaseUrl: "https://api.x.ai/v1",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: UNSUPPORTED },
        legacyProtocols: ["xai"],
    },
    {
        id: "agnes",
        label: "Agnes 原生",
        shortLabel: "Agnes",
        description: "Agnes 图片 / 视频专属接口",
        defaultBaseUrl: "https://apihub.agnes-ai.com/v1",
        auth: "bearer",
        capabilities: { text: NATIVE, image: NATIVE, video: NATIVE, audio: UNSUPPORTED },
        legacyProtocols: ["agnes"],
    },
    {
        id: "custom",
        label: "自定义脚本",
        shortLabel: "自定义",
        description: "由用户脚本完全接管请求，适合非常规接口",
        defaultBaseUrl: "https://example.com",
        auth: "custom",
        capabilities: { text: SCRIPT, image: SCRIPT, video: SCRIPT, audio: SCRIPT },
        legacyProtocols: [],
    },
];

const adapterById = new Map(modelAdapters.map((adapter) => [adapter.id, adapter]));

export function getModelAdapter(adapterId: string): ModelAdapterDefinition | undefined {
    return adapterById.get(adapterId as AdapterId);
}

/** 旧版协议（apiFormat）映射到适配器；未知值回退 OpenAI 兼容。 */
export function adapterForLegacyProtocol(protocol: string): ModelAdapterDefinition {
    return modelAdapters.find((adapter) => adapter.legacyProtocols.includes(protocol)) || modelAdapters[0];
}

/** 适配器 → 旧版协议：保存渠道时保持请求分发（image/video/audio）行为不变。 */
export function legacyApiFormatForAdapter(adapterId: string): string {
    const adapter = getModelAdapter(adapterId);
    if (!adapter) return "openai";
    const legacy = adapter.legacyProtocols[0];
    if (legacy) return legacy;
    // 新适配器没有旧协议值：文字/图片/音频尽量落到 OpenAI 兼容，避免分发缺失。
    if (adapter.id === "minimax-token-plan-native" || adapter.id === "minimax-api-native") return "minimax";
    if (adapter.id === "anthropic" || adapter.id === "openai-response") return "openai";
    return "openai";
}

export function isMiniMaxAdapter(adapterId: string | undefined): adapterId is "minimax-token-plan-native" | "minimax-api-native" {
    return adapterId === "minimax-token-plan-native" || adapterId === "minimax-api-native";
}

export function miniMaxBillingModeForAdapter(adapterId: string | undefined): "token-plan" | "payg" | undefined {
    if (adapterId === "minimax-token-plan-native") return "token-plan";
    if (adapterId === "minimax-api-native") return "payg";
    return undefined;
}

/** 查询某能力在适配器上的支持程度。 */
export function adapterCapabilitySupport(adapterId: string, capability: ModelCapability): AdapterCapabilitySupport {
    return getModelAdapter(adapterId)?.capabilities[capability] || UNSUPPORTED;
}

/** 是否允许用户在渠道上启用该能力（原生或脚本均可，仅“不支持”被禁止）。 */
export function canEnableCapability(adapterId: string, capability: ModelCapability) {
    return adapterCapabilitySupport(adapterId, capability) !== UNSUPPORTED;
}

export function capabilitySupportLabel(support: AdapterCapabilitySupport) {
    if (support === NATIVE) return "原生支持";
    if (support === SCRIPT) return "需要脚本";
    return "不支持";
}
