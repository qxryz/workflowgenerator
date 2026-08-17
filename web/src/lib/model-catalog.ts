import type { ModelCapability } from "@/stores/use-config-store";
import type { AdapterId } from "./model-adapters";
import type { ModelParamSchema } from "./model-param-schema";

/**
 * 模型目录：厂商与模型是纯数据，和“协议适配器”分离。
 *
 * 每条模型记录声明：厂商、能力、使用哪个适配器、可选的参数 schema 键。
 * 新模型 90% 场景只需在这里加一条数据。
 */
export type VendorId = "openai" | "anthropic" | "google" | "qwen" | "minimax-token-plan" | "minimax-api" | "xai" | "agnes" | "ark" | "custom";

export type ModelVendorDefinition = {
    id: VendorId;
    label: string;
    shortLabel: string;
    defaultBaseUrl: string;
    description: string;
    accent: string;
    /** 该厂商模型默认可用的适配器（按能力细分）。 */
    adapters: Readonly<Partial<Record<ModelCapability, AdapterId>>>;
};

export type CatalogModelEntry = {
    name: string;
    label: string;
    vendor: VendorId;
    capability: ModelCapability;
    description: string;
    /** 该模型实际走哪个适配器；缺省按 vendor.adapters 推断。 */
    adapter?: AdapterId;
    /** 模型专属参数面板；声明后界面自动按此 schema 渲染，缺省回落到通用面板。 */
    parameters?: ModelParamSchema;
    /** 是否出现在渠道编辑页的精选推荐区；不影响完整模型选择和接口拉取结果。 */
    recommended?: boolean;
};

export const modelVendors: readonly ModelVendorDefinition[] = [
    {
        id: "openai",
        label: "OpenAI",
        shortLabel: "OpenAI",
        defaultBaseUrl: "https://api.openai.com",
        description: "适合 OpenAI 官方接口和兼容渠道",
        accent: "#111827",
        adapters: { text: "openai-compatible", image: "openai-compatible", video: "openai-compatible", audio: "openai-compatible" },
    },
    {
        id: "anthropic",
        label: "Anthropic",
        shortLabel: "Anthropic",
        defaultBaseUrl: "https://api.anthropic.com",
        description: "Claude 文本与多模态理解",
        accent: "#d97706",
        adapters: { text: "anthropic" },
    },
    {
        id: "google",
        label: "Google Gemini",
        shortLabel: "Gemini",
        defaultBaseUrl: "https://generativelanguage.googleapis.com",
        description: "Gemini 原生生成接口",
        accent: "#4f46e5",
        adapters: { text: "gemini", image: "gemini", video: "gemini" },
    },
    {
        id: "qwen",
        label: "阿里云百炼 / 千问",
        shortLabel: "千问",
        defaultBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
        description: "千问语音生成、声音克隆与语音转录模型",
        accent: "#6d5dfc",
        adapters: { audio: "dashscope-audio" },
    },
    {
        id: "minimax-token-plan",
        label: "MiniMax Token Plan（原 Coding Plan）",
        shortLabel: "MiniMax Token Plan",
        defaultBaseUrl: "https://api.minimaxi.com",
        description: "使用 Token Plan 专属 Key；可用模型与额度由套餐决定，不会转用 API 计费",
        accent: "#f25a29",
        adapters: { text: "minimax-token-plan-native", image: "minimax-token-plan-native", video: "minimax-token-plan-native", audio: "minimax-token-plan-native" },
    },
    {
        id: "minimax-api",
        label: "MiniMax API 计费",
        shortLabel: "MiniMax API",
        defaultBaseUrl: "https://api.minimaxi.com",
        description: "使用 API 计费 Key，支持 MiniMax 全部已接入模型",
        accent: "#f25a29",
        adapters: { text: "minimax-api-native", image: "minimax-api-native", video: "minimax-api-native", audio: "minimax-api-native" },
    },
    {
        id: "xai",
        label: "xAI Grok",
        shortLabel: "Grok",
        defaultBaseUrl: "https://api.x.ai/v1",
        description: "Grok 文本、图片与视频创作",
        accent: "#2563eb",
        adapters: { text: "openai-compatible", image: "xai", video: "xai" },
    },
    {
        id: "agnes",
        label: "Agnes AI",
        shortLabel: "Agnes",
        defaultBaseUrl: "https://apihub.agnes-ai.com/v1",
        description: "Agnes 全模态模型接口",
        accent: "#db2777",
        adapters: { text: "openai-compatible", image: "agnes", video: "agnes" },
    },
    {
        id: "ark",
        label: "火山方舟",
        shortLabel: "方舟",
        defaultBaseUrl: "https://ark.cn-beijing.volces.com/api/v3",
        description: "豆包 Seedream、Seedance 与文本模型",
        accent: "#0891b2",
        adapters: { text: "openai-compatible", image: "ark-media", video: "ark-media" },
    },
    {
        id: "custom",
        label: "自定义",
        shortLabel: "自定义",
        defaultBaseUrl: "https://example.com",
        description: "自定义脚本或兼容渠道",
        accent: "#64748b",
        adapters: {},
    },
];

export const modelCatalog: readonly CatalogModelEntry[] = [
    // OpenAI
    { name: "gpt-image-2", label: "GPT Image 2", vendor: "openai", capability: "image", description: "图片生成与编辑" },
    { name: "sora-2", label: "Sora 2", vendor: "openai", capability: "video", description: "视频生成" },
    { name: "gpt-5.5", label: "GPT 5.5", vendor: "openai", capability: "text", description: "文本与视觉理解" },
    { name: "gpt-4o-mini-tts", label: "GPT-4o mini TTS", vendor: "openai", capability: "audio", description: "语音生成" },
    // 阿里云百炼 / 千问音频
    { name: "qwen-audio-3.0-tts-flash", label: "Qwen Audio TTS Flash", vendor: "qwen", capability: "audio", adapter: "dashscope-audio", description: "自然语音合成与克隆音色" },
    { name: "qwen3-tts-vc-2026-01-22", label: "Qwen3 TTS Voice Clone", vendor: "qwen", capability: "audio", adapter: "dashscope-audio", description: "克隆音色语音合成" },
    { name: "qwen3-asr-flash", label: "Qwen3 ASR Flash", vendor: "qwen", capability: "audio", adapter: "dashscope-audio", description: "短音频语音转录" },
    // MiniMax API 计费；Token Plan 从此目录复用其实际支持的子集。
    { name: "MiniMax-M3", label: "MiniMax M3", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "当前会话支持文字与图片；接口另支持视频理解" },
    { name: "MiniMax-M2.7", label: "MiniMax M2.7", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "长上下文文本与 Agent 推理", recommended: false },
    { name: "MiniMax-M2.7-highspeed", label: "MiniMax M2.7 Highspeed", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "M2.7 高速文本与 Agent 推理", recommended: false },
    { name: "MiniMax-M2.5", label: "MiniMax M2.5", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "文本、代码与 Agent 工作流", recommended: false },
    { name: "MiniMax-M2.5-highspeed", label: "MiniMax M2.5 Highspeed", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "M2.5 高速文本与代码生成", recommended: false },
    { name: "MiniMax-M2.1", label: "MiniMax M2.1", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "多语言编程与复杂任务", recommended: false },
    { name: "MiniMax-M2.1-highspeed", label: "MiniMax M2.1 Highspeed", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "M2.1 高速多语言编程", recommended: false },
    { name: "MiniMax-M2", label: "MiniMax M2", vendor: "minimax-api", capability: "text", adapter: "minimax-api-native", description: "高效编码与 Agent 工作流", recommended: false },
    { name: "image-01", label: "MiniMax Image 01", vendor: "minimax-api", capability: "image", adapter: "minimax-api-native", description: "图片生成与角色参考编辑" },
    { name: "MiniMax-H3", label: "MiniMax H3", vendor: "minimax-api", capability: "video", adapter: "minimax-api-native", description: "支持文本、图片、视频与音频参考的视频生成" },
    { name: "MiniMax-Hailuo-2.3", label: "MiniMax Hailuo 2.3", vendor: "minimax-api", capability: "video", adapter: "minimax-api-native", description: "文生视频与单首帧图生视频" },
    { name: "MiniMax-Hailuo-2.3-Fast", label: "MiniMax Hailuo 2.3 Fast", vendor: "minimax-api", capability: "video", adapter: "minimax-api-native", description: "需要首帧图片的快速图生视频" },
    { name: "speech-2.8-hd", label: "MiniMax Speech 2.8 HD", vendor: "minimax-api", capability: "audio", adapter: "minimax-api-native", description: "高品质语音生成与声音克隆" },
    { name: "speech-2.8-turbo", label: "MiniMax Speech 2.8 Turbo", vendor: "minimax-api", capability: "audio", adapter: "minimax-api-native", description: "低延迟语音生成与声音克隆" },
    // Google Gemini
    { name: "gemini-3.1-flash-image-preview", label: "Gemini Image", vendor: "google", capability: "image", description: "图片生成与编辑" },
    { name: "gemini-3.1-pro-preview", label: "Gemini Pro", vendor: "google", capability: "text", description: "文本与多模态理解" },
    // xAI Grok
    { name: "grok-imagine-image-quality", label: "Grok Imagine Image", vendor: "xai", capability: "image", description: "1K / 2K 图片生成与多图编辑" },
    { name: "grok-imagine-video", label: "Grok Imagine Video", vendor: "xai", capability: "video", description: "文生视频、图生视频与参考图引导" },
    { name: "grok-imagine-video-1.5", label: "Grok Imagine Video 1.5", vendor: "xai", capability: "video", description: "支持 1080p 图生视频" },
    { name: "grok-4.5", label: "Grok 4.5", vendor: "xai", capability: "text", description: "文本与视觉理解" },
    // Agnes
    { name: "agnes-2.5-flash", label: "Agnes 2.5 Flash", vendor: "agnes", capability: "text", description: "快速文本与多模态理解" },
    { name: "agnes-image-2.1-flash", label: "Agnes Image 2.1 Flash", vendor: "agnes", capability: "image", description: "图片生成与编辑" },
    { name: "agnes-video-v2.0", label: "Agnes Video V2.0", vendor: "agnes", capability: "video", description: "带声音的视频生成" },
    // 火山方舟
    { name: "doubao-seedream-5-0-lite-260128", label: "Seedream 5.0 Lite", vendor: "ark", capability: "image", description: "最新图片创作模型" },
    { name: "doubao-seedream-4-5-251128", label: "Seedream 4.5", vendor: "ark", capability: "image", description: "多图编辑与 4K 输出", recommended: false },
    { name: "doubao-seedance-2-5-260628", label: "Seedance 2.5", vendor: "ark", capability: "video", description: "30 秒连贯生成、50 个多模态参考、视频延长与精准编辑" },
    { name: "doubao-seedance-2-0-260128", label: "Seedance 2.0", vendor: "ark", capability: "video", description: "图文音视频混合参考与原生声音" },
    { name: "doubao-seedance-1-5-pro-251215", label: "Seedance 1.5 Pro", vendor: "ark", capability: "video", description: "有声视频生成", recommended: false },
    { name: "doubao-seed-2-0-lite-260215", label: "Doubao Seed 2.0 Lite", vendor: "ark", capability: "text", description: "文本与多模态理解" },
];

const vendorById = new Map(modelVendors.map((vendor) => [vendor.id, vendor]));
const catalogByName = new Map(modelCatalog.map((model) => [model.name, model]));
export function getModelVendor(vendorId: string): ModelVendorDefinition | undefined {
    return vendorById.get(vendorId as VendorId);
}

export function findCatalogModel(name: string): CatalogModelEntry | undefined {
    return catalogByName.get(name);
}

/** 模型实际使用的适配器：模型声明优先，其次厂商能力默认，最后 OpenAI 兼容。 */
export function resolveAdapterForModel(modelName: string, capability: ModelCapability, declaredAdapter?: string): AdapterId {
    if (declaredAdapter && declaredAdapter !== "custom") return declaredAdapter as AdapterId;
    const entry = findCatalogModel(modelName);
    if (entry?.adapter) return entry.adapter;
    const vendor = entry ? getModelVendor(entry.vendor) : undefined;
    const declared = vendor?.adapters[capability];
    if (declared) return declared;
    // 厂商存在但没有声明该能力：不能当作 OpenAI 兼容原生支持，视为需要脚本。
    return vendor ? "custom" : "openai-compatible";
}

/** 厂商的“特征适配器”：优先取非 OpenAI 兼容的能力适配器，让切换厂商时下拉有明显变化。 */
export function defaultAdapterForVendor(vendorId: VendorId): AdapterId {
    const vendor = getModelVendor(vendorId);
    const adapters = vendor?.adapters || {};
    const capabilityOrder: ModelCapability[] = ["image", "video", "audio", "text"];
    for (const capability of capabilityOrder) {
        const adapter = adapters[capability];
        if (adapter && adapter !== "openai-compatible") return adapter;
    }
    return adapters.text || adapters.image || "openai-compatible";
}

/** 厂商 → 旧版协议：保存渠道时保持请求分发（image/video/audio）行为不变。 */
export function legacyApiFormatForVendor(vendorId: VendorId): string {
    if (vendorId === "qwen") return "qwen";
    if (vendorId === "minimax-token-plan" || vendorId === "minimax-api") return "minimax";
    if (vendorId === "google") return "gemini";
    if (vendorId === "xai") return "xai";
    if (vendorId === "agnes") return "agnes";
    if (vendorId === "ark") return "ark";
    return "openai";
}

/** 旧版协议 → 厂商：用于把老渠道映射回厂商选择。 */
export function legacyVendorForApiFormat(apiFormat: string): VendorId {
    if (apiFormat === "qwen") return "qwen";
    if (apiFormat === "minimax") return "minimax-api";
    if (apiFormat === "gemini") return "google";
    if (apiFormat === "xai") return "xai";
    if (apiFormat === "agnes") return "agnes";
    if (apiFormat === "ark") return "ark";
    return "openai";
}

export function catalogModelsForVendor(vendorId: VendorId) {
    if (vendorId === "minimax-token-plan") {
        return modelCatalog
            .filter((model) => model.vendor === "minimax-api")
            .map((model) => ({ ...model, vendor: "minimax-token-plan" as const, adapter: "minimax-token-plan-native" as const }));
    }
    return modelCatalog.filter((model) => model.vendor === vendorId);
}

/** 渠道编辑页的精选入口；完整模型列表仍由 catalogModelsForVendor 与接口拉取负责。 */
export function recommendedCatalogModelsForVendor(vendorId: VendorId) {
    return catalogModelsForVendor(vendorId).filter((model) => model.recommended !== false);
}

export function catalogModelsForCapability(capability: ModelCapability) {
    return modelCatalog.filter((model) => model.capability === capability);
}
