import { useMemo } from "react";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { normalizeAudioDefaultsForModel } from "@/lib/audio-defaults";
import { defaultAdapterForVendor, legacyVendorForApiFormat, resolveAdapterForModel, type VendorId } from "@/lib/model-catalog";
import { miniMaxBillingModeForAdapter } from "@/lib/model-adapters";
import { getProviderDefinition, modelBelongsToProvider, type ProviderProtocol } from "@/lib/model-providers";
import { DASH_SCOPE_BEIJING_BASE_URL, PRESET_CHANNEL_DEFAULTS, PRESET_CHANNEL_IDS, nextCustomChannelName, type BuiltInChannelPreset } from "@/lib/preset-channels";
import { miniMaxCredentialError, normalizeMiniMaxVideoInputMode, type MiniMaxVideoInputMode } from "@/lib/minimax-contract";
import {
    normalizeSeedance25Continuation,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    type Seedance25Continuation,
    type Seedance25InputMode,
    type Seedance25OutputFormat,
    type Seedance25TaskMode,
} from "@/lib/seedance-2-5";

export { DASH_SCOPE_BEIJING_BASE_URL, PRESET_CHANNEL_IDS, nextCustomChannelName } from "@/lib/preset-channels";

export type ApiCallFormat = ProviderProtocol;
export type ModelCapability = "image" | "video" | "text" | "audio";
export type ChannelPreset = BuiltInChannelPreset;
export type MinimaxBillingMode = "token-plan" | "payg";
export type ReasoningEffort = "auto" | "low" | "medium" | "high" | "xhigh";
export type ExternalTerminalApp = "terminal" | "ghostty";
export type ChannelModel = {
    name: string;
    capability: ModelCapability;
    provider?: ApiCallFormat;
    /** 新架构：该模型使用的协议适配器；缺省按模型目录推断。 */
    adapter?: string;
    script?: string;
};

export type ModelChannel = {
    id: string;
    name: string;
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    /** 新架构：用户选择的厂商；缺省由 apiFormat 推导。 */
    vendor?: string;
    /** 新架构：渠道使用的协议适配器；缺省由 apiFormat 推导。 */
    adapter?: string;
    /** 新架构：各能力是否在该渠道启用；缺省按适配器能力表推断。 */
    capabilities?: Partial<Record<ModelCapability, boolean>>;
    /** 内置渠道始终存在，可编辑并一键恢复为无 Key 的初始配置。 */
    preset?: ChannelPreset;
    models: ChannelModel[];
};

export type AiConfig = {
    channelMode: "remote" | "local";
    baseUrl: string;
    apiKey: string;
    apiFormat: ApiCallFormat;
    channels: ModelChannel[];
    model: string;
    imageModel: string;
    videoModel: string;
    textModel: string;
    audioModel: string;
    audioVoice: string;
    audioFormat: string;
    audioSpeed: string;
    audioInstructions: string;
    zodiacSystemPrompt: string;
    imagePromptPrefix: string;
    videoSeconds: string;
    vquality: string;
    videoGenerateAudio: string;
    videoWatermark: string;
    seedance25TaskMode: Seedance25TaskMode;
    seedance25Continuation: Seedance25Continuation;
    seedance25OutputFormat: Seedance25OutputFormat;
    seedance25InputMode: Seedance25InputMode;
    seedance25Seed: string;
    seedance25ReturnLastFrame: string;
    seedance25WebSearch: string;
    seedance25CameraFixed: string;
    minimaxVideoInputMode: MiniMaxVideoInputMode;
    minimaxVideoPromptOptimizer: string;
    minimaxVideoFastPretreatment: string;
    systemPrompt: string;
    reasoningEffort: ReasoningEffort;
    models: string[];
    quality: string;
    size: string;
    background: string;
    imageWatermark: string;
    imageOptimizePrompt: string;
    count: string;
    canvasImageCount: string;
    terminalApp: ExternalTerminalApp;
    agentScanPaths: string[];
};

export type WebdavSyncConfig = {
    url: string;
    username: string;
    password: string;
    directory: string;
    lastSyncedAt: string;
};
export type ConfigTabKey = "channels" | "agents" | "preferences" | "prompt-sources" | "webdav" | "updates";

export const CONFIG_STORE_KEY = "workflowgenerator:ai_config_store";
const CHANNEL_MODEL_SEPARATOR = "::";
const OPENAI_BASE_URL = getProviderDefinition("openai").baseUrl;
export function createPresetChannel(preset: ChannelPreset): ModelChannel {
    const defaults = PRESET_CHANNEL_DEFAULTS[preset];
    if (preset === "voice") {
        return createModelChannel({
            ...defaults,
            preset,
            capabilities: { text: false, image: false, video: false, audio: true },
            models: defaults.models.map((model) => ({ ...model, provider: "qwen", adapter: "dashscope-audio" })),
        });
    }
    return createModelChannel({
        ...defaults,
        preset,
        models: defaults.models.map((model) => ({ ...model, provider: "openai" })),
    });
}

export function resetPresetChannel(channel: ModelChannel) {
    return channel.preset ? createPresetChannel(channel.preset) : channel;
}

export const defaultConfig: AiConfig = {
    channelMode: "local",
    baseUrl: OPENAI_BASE_URL,
    apiKey: "",
    apiFormat: "openai",
    channels: [createPresetChannel("free"), createPresetChannel("voice")],
    model: `${PRESET_CHANNEL_IDS.free}::gpt-image-2`,
    imageModel: `${PRESET_CHANNEL_IDS.free}::gpt-image-2`,
    videoModel: `${PRESET_CHANNEL_IDS.free}::sora-2`,
    textModel: `${PRESET_CHANNEL_IDS.free}::gpt-5.5`,
    audioModel: `${PRESET_CHANNEL_IDS.voice}::qwen-audio-3.0-tts-flash`,
    audioVoice: "alloy",
    audioFormat: "mp3",
    audioSpeed: "1",
    audioInstructions: "",
    zodiacSystemPrompt: "",
    imagePromptPrefix: "",
    videoSeconds: "6",
    vquality: "720",
    videoGenerateAudio: "true",
    videoWatermark: "false",
    seedance25TaskMode: "generate",
    seedance25Continuation: "natural",
    seedance25OutputFormat: "mp4",
    seedance25InputMode: "reference",
    seedance25Seed: "-1",
    seedance25ReturnLastFrame: "true",
    seedance25WebSearch: "false",
    seedance25CameraFixed: "false",
    minimaxVideoInputMode: "auto",
    minimaxVideoPromptOptimizer: "true",
    minimaxVideoFastPretreatment: "false",
    systemPrompt: "",
    reasoningEffort: "auto",
    models: [
        `${PRESET_CHANNEL_IDS.free}::gpt-image-2`,
        `${PRESET_CHANNEL_IDS.free}::sora-2`,
        `${PRESET_CHANNEL_IDS.free}::gpt-5.5`,
        `${PRESET_CHANNEL_IDS.voice}::qwen-audio-3.0-tts-flash`,
        `${PRESET_CHANNEL_IDS.voice}::qwen3-tts-vc-2026-01-22`,
        `${PRESET_CHANNEL_IDS.voice}::qwen3-asr-flash`,
    ],
    quality: "auto",
    size: "1:1",
    background: "",
    imageWatermark: "false",
    imageOptimizePrompt: "true",
    count: "1",
    canvasImageCount: "3",
    terminalApp: "terminal",
    agentScanPaths: [],
};

export const defaultWebdavSyncConfig: WebdavSyncConfig = {
    url: "",
    username: "",
    password: "",
    directory: "workflowgenerator",
    lastSyncedAt: "",
};

type ConfigStore = {
    config: AiConfig;
    webdav: WebdavSyncConfig;
    isConfigOpen: boolean;
    configTab: ConfigTabKey;
    shouldPromptContinue: boolean;
    updateConfig: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    updateWebdavConfig: <K extends keyof WebdavSyncConfig>(key: K, value: WebdavSyncConfig[K]) => void;
    isAiConfigReady: (config: AiConfig, model: string) => boolean;
    openConfigDialog: (shouldPromptContinue?: boolean, tab?: ConfigTabKey) => void;
    setConfigDialogOpen: (isOpen: boolean) => void;
    clearPromptContinue: () => void;
};

const VIDEO_KEYWORDS = ["seedance", "video", "sora", "veo", "kling", "wan", "hailuo", "grok-imagine-video"];
const AUDIO_KEYWORDS = ["audio", "tts", "speech", "voice", "sound"];
const IMAGE_KEYWORDS = ["seedream", "gpt-image", "image", "dall-e", "dalle", "imagen", "flux", "sdxl", "stable-diffusion", "midjourney"];

/** Best-effort default capability for a freshly fetched model name; user can override in the channel editor. */
export function guessCapability(name: string): ModelCapability {
    const value = name.toLowerCase();
    if (VIDEO_KEYWORDS.some((keyword) => value.includes(keyword))) return "video";
    if (AUDIO_KEYWORDS.some((keyword) => value.includes(keyword))) return "audio";
    if (IMAGE_KEYWORDS.some((keyword) => value.includes(keyword))) return "image";
    return "text";
}

function findChannelModel(config: AiConfig, value: string): { channel: ModelChannel; model: ChannelModel } | null {
    const decoded = decodeChannelModel(value);
    const name = decoded?.model || value;
    const channel = decoded ? config.channels.find((item) => item.id === decoded.channelId) : config.channels.find((item) => item.models.some((model) => model.name === name));
    const model = channel?.models.find((item) => item.name === name);
    return channel && model ? { channel, model } : null;
}

export function modelCapabilityOf(config: AiConfig, value: string): ModelCapability | undefined {
    return findChannelModel(config, value)?.model.capability;
}

export function modelMatchesCapability(config: AiConfig, value: string, capability?: ModelCapability) {
    if (!capability) return true;
    return modelCapabilityOf(config, value) === capability;
}

export function resolveModelForCapability(config: AiConfig, currentModel: string | undefined, capability: ModelCapability) {
    const defaultModel = capability === "image" ? config.imageModel : capability === "video" ? config.videoModel : capability === "audio" ? config.audioModel : config.textModel;
    const fallbackModel = capability === "image" ? defaultConfig.imageModel : capability === "video" ? defaultConfig.videoModel : capability === "audio" ? defaultConfig.audioModel : defaultConfig.textModel;
    if (currentModel && modelMatchesCapability(config, currentModel, capability)) return currentModel;
    if (defaultModel && modelMatchesCapability(config, defaultModel, capability)) return defaultModel;
    return fallbackModel;
}

export function selectableModelsByCapability(config: AiConfig, capability?: ModelCapability) {
    if (!capability) return config.models;
    return config.channels.flatMap((channel) => channel.models.filter((model) => model.capability === capability).map((model) => encodeChannelModel(channel.id, model.name)));
}

/** The user script (if any) attached to a model; empty string means use the system default call. */
export function resolveModelScript(config: AiConfig, value: string) {
    return findChannelModel(config, value)?.model.script?.trim() || "";
}

export function isAiConfigReady(config: AiConfig, model: string) {
    const request = resolveModelRequestConfig(config, model);
    const credentialError = request.minimaxBillingMode ? miniMaxCredentialError(request.minimaxBillingMode, request.apiKey) : "";
    return Boolean(model.trim() && request.baseUrl.trim() && request.apiKey.trim() && !credentialError);
}

export const useConfigStore = create<ConfigStore>()(
    persist(
        (set, get) => ({
            config: defaultConfig,
            webdav: defaultWebdavSyncConfig,
            isConfigOpen: false,
            configTab: "channels",
            shouldPromptContinue: false,
            updateConfig: (key, value) =>
                set((state) => ({
                    config: {
                        ...state.config,
                        [key]: value,
                    },
                })),
            updateWebdavConfig: (key, value) =>
                set((state) => ({
                    webdav: {
                        ...state.webdav,
                        [key]: value,
                    },
                })),
            isAiConfigReady: (config, model) => isAiConfigReady(config, model),
            openConfigDialog: (shouldPromptContinue = false, configTab = "channels") => set({ isConfigOpen: true, shouldPromptContinue, configTab }),
            setConfigDialogOpen: (isConfigOpen) => set({ isConfigOpen }),
            clearPromptContinue: () => set({ shouldPromptContinue: false }),
        }),
        {
            name: CONFIG_STORE_KEY,
            storage: createJSONStorage(() => localForageStorage),
            version: 3,
            partialize: (state) => ({ config: state.config, webdav: state.webdav }),
            migrate: (persistedState) => persistedState as ConfigStore,
            merge: (persisted, current) => {
                const persistedState = (persisted || {}) as Partial<ConfigStore>;
                const persistedConfig = (persistedState.config || {}) as Partial<AiConfig>;
                const persistedWebdav = (persistedState.webdav || {}) as Partial<WebdavSyncConfig>;
                return {
                    ...current,
                    webdav: { ...defaultWebdavSyncConfig, ...persistedWebdav },
                    config: normalizeAiConfig(persistedConfig),
                };
            },
        },
    ),
);

export function useEffectiveConfig() {
    const config = useConfigStore((state) => state.config);
    return useMemo(() => ({ ...config, channelMode: "local" as const }), [config]);
}

function normalizeAgentScanPaths(paths: string[] | undefined) {
    return Array.from(new Set((Array.isArray(paths) ? paths : []).map((path) => path.trim()).filter(Boolean)));
}

/** Normalize a mixed list of raw model names or model objects into deduped ChannelModel entries. */
export function normalizeChannelModels(models: Array<string | ChannelModel> | undefined, provider?: ApiCallFormat): ChannelModel[] {
    const seen = new Set<string>();
    const result: ChannelModel[] = [];
    for (const item of models || []) {
        const name = (typeof item === "string" ? item : item?.name || "").trim();
        if (!name || seen.has(name) || name.toLowerCase().startsWith("fun-music-")) continue;
        const declaredProvider = typeof item === "string" ? undefined : item.provider;
        if (provider && !modelBelongsToProvider(name, provider, declaredProvider)) continue;
        seen.add(name);
        const capability = typeof item === "string" ? guessCapability(name) : item.capability || guessCapability(name);
        const script = typeof item === "string" ? undefined : item.script?.trim() || undefined;
        const adapter = typeof item === "string" ? undefined : item.adapter?.trim() || undefined;
        result.push({ name, capability, provider: provider || declaredProvider, script, ...(adapter ? { adapter } : {}) });
    }
    return result;
}

export function createModelChannel(channel?: Partial<ModelChannel>): ModelChannel {
    const apiFormat = normalizeApiFormat(channel?.apiFormat);
    const vendor = channel?.vendor as VendorId | undefined;
    const miniMaxAdapter = vendor === "minimax-token-plan" || vendor === "minimax-api" ? defaultAdapterForVendor(vendor) : undefined;
    const adapter = miniMaxAdapter || channel?.adapter;
    const models = normalizeChannelModels(channel?.models, apiFormat).map((model) => (miniMaxAdapter ? { ...model, adapter: miniMaxAdapter } : model));
    return {
        id: channel?.id?.trim() || nanoid(),
        name: channel?.name?.trim() || "新渠道",
        baseUrl: channel?.baseUrl?.trim() || defaultBaseUrlForApiFormat(apiFormat),
        apiKey: channel?.apiKey || "",
        apiFormat,
        ...(vendor ? { vendor } : {}),
        ...(adapter ? { adapter } : {}),
        ...(channel?.capabilities ? { capabilities: channel.capabilities } : {}),
        ...(channel?.preset ? { preset: channel.preset } : {}),
        models,
    };
}

export function encodeChannelModel(channelId: string, model: string) {
    return `${channelId}${CHANNEL_MODEL_SEPARATOR}${model.trim()}`;
}

export function isChannelModelValue(value: string) {
    return value.includes(CHANNEL_MODEL_SEPARATOR);
}

export function decodeChannelModel(value: string) {
    const index = value.indexOf(CHANNEL_MODEL_SEPARATOR);
    if (index < 0) return null;
    return { channelId: value.slice(0, index), model: value.slice(index + CHANNEL_MODEL_SEPARATOR.length) };
}

export function modelOptionName(value: string) {
    return decodeChannelModel(value)?.model || value;
}

export function modelOptionLabel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    if (!decoded) return value;
    const channel = config.channels.find((item) => item.id === decoded.channelId);
    return channel ? `${decoded.model}（${channel.name}）` : decoded.model;
}

export function modelOptionsFromChannels(channels: ModelChannel[]) {
    return uniqueModelOptions(channels.flatMap((channel) => channel.models.map((model) => encodeChannelModel(channel.id, model.name))));
}

export function normalizeModelOptionValue(value: string | undefined, channels: ModelChannel[]) {
    const model = (value || "").trim();
    if (!model) return "";
    const decoded = decodeChannelModel(model);
    if (decoded) {
        const channel = channels.find((item) => item.id === decoded.channelId);
        return channel && channel.models.some((item) => item.name === decoded.model) ? model : "";
    }
    const channel = channels.find((item) => item.models.some((entry) => entry.name === model)) || channels[0];
    return channel && channel.models.some((item) => item.name === model) ? encodeChannelModel(channel.id, model) : "";
}

export function resolveModelChannel(config: AiConfig, value: string) {
    const decoded = decodeChannelModel(value);
    const model = decoded?.model || value;
    const matched = decoded ? config.channels.find((channel) => channel.id === decoded.channelId) : config.channels.find((channel) => channel.models.some((item) => item.name === model));
    if (decoded && !matched) throw new Error("该模型的原渠道已删除，请重新选择渠道和模型");
    return (
        matched ||
        config.channels[0] ||
        createModelChannel({ ...createPresetChannel("free"), baseUrl: config.baseUrl, apiKey: config.apiKey, apiFormat: config.apiFormat, models: config.models.map(modelOptionName).map((name) => ({ name, capability: guessCapability(name) })) })
    );
}

export function resolveModelRequestConfig(config: AiConfig, value: string) {
    const channel = resolveModelChannel(config, value);
    const matched = findChannelModel(config, value);
    const model = modelOptionName(value || config.model);
    const vendor = channel.vendor || legacyVendorForApiFormat(channel.apiFormat);
    const declaredAdapter = matched?.model.adapter || channel.adapter || resolveAdapterForModel(model, matched?.model.capability || guessCapability(model));
    const adapter = vendor === "minimax-token-plan" || vendor === "minimax-api" ? defaultAdapterForVendor(vendor) : declaredAdapter;
    const minimaxBillingMode: MinimaxBillingMode | undefined = miniMaxBillingModeForAdapter(adapter);
    return {
        ...config,
        model,
        baseUrl: channel.baseUrl,
        apiKey: channel.apiKey,
        apiFormat: channel.apiFormat,
        vendor,
        adapter,
        minimaxBillingMode,
    };
}

function normalizeChannels(config: AiConfig) {
    const persistedChannels = Array.isArray(config.channels) ? config.channels : [];
    const expandedChannels = expandLegacyMiniMaxChannels(persistedChannels);
    const channels = expandedChannels.map((channel, index) =>
        createModelChannel({
            ...channel,
            id: channel.id || (index === 0 ? "default" : `channel-${index + 1}`),
            name: channel.name || (index === 0 ? "默认渠道" : `渠道 ${index + 1}`),
            models: normalizeChannelModels(channel.models, normalizeApiFormat(channel.apiFormat)),
        }),
    );
    const legacyDefault = channels.find((channel) => channel.id === "default" && !channel.preset);
    const free = channels.find((channel) => channel.preset === "free" || channel.id === PRESET_CHANNEL_IDS.free) || legacyDefault;
    const voice = channels.find((channel) => channel.preset === "voice" || channel.id === PRESET_CHANNEL_IDS.voice);
    const normalizedFree = free ? createModelChannel({ ...free, id: PRESET_CHANNEL_IDS.free, name: "免费", preset: "free" }) : createPresetChannel("free");
    const normalizedVoice = voice ? createModelChannel({ ...voice, id: PRESET_CHANNEL_IDS.voice, name: "语音模型", preset: "voice" }) : createPresetChannel("voice");
    const presetIds = new Set([free?.id, voice?.id, PRESET_CHANNEL_IDS.free, PRESET_CHANNEL_IDS.voice].filter(Boolean));
    return [normalizedFree, normalizedVoice, ...channels.filter((channel) => !presetIds.has(channel.id) && !channel.preset)];
}

type LegacyMiniMaxChannel = ModelChannel & {
    minimaxPlanBaseUrl?: string;
    minimaxPlanApiKey?: string;
    minimaxBillingMode?: MinimaxBillingMode;
};

/** One-time in-memory normalization: old combined MiniMax credentials become two ordinary channels. */
function expandLegacyMiniMaxChannels(channels: ModelChannel[]) {
    const usedIds = new Set(channels.map((channel) => channel.id).filter(Boolean));
    return channels.flatMap((channel, index) => {
        const legacy = channel as LegacyMiniMaxChannel;
        const hasCombinedFields = Object.hasOwn(legacy, "minimaxPlanBaseUrl") || Object.hasOwn(legacy, "minimaxPlanApiKey") || Object.hasOwn(legacy, "minimaxBillingMode");
        const isMiniMax = channel.apiFormat === "minimax" || channel.vendor === "minimax";
        const apiChannel = { ...channel, vendor: channel.vendor === "minimax" ? "minimax-api" : channel.vendor, ...(isMiniMax ? { adapter: "minimax-api-native" } : {}) };
        if (!isMiniMax || !hasCombinedFields) return [apiChannel];

        const baseName = (channel.name || "").trim() || `渠道 ${index + 1}`;
        const rawModels = Array.isArray(channel.models) ? channel.models : [];
        const originalId = channel.id || `channel-${index + 1}`;
        usedIds.add(originalId);
        const tokenWasSelected = legacy.minimaxBillingMode === "token-plan";
        const apiId = tokenWasSelected ? uniqueMigratedChannelId(`${originalId}-api`, usedIds) : originalId;
        const tokenId = tokenWasSelected ? originalId : uniqueMigratedChannelId(`${originalId}-token-plan`, usedIds);
        return [
            { ...apiChannel, id: apiId, name: `${baseName} · API 计费`, vendor: "minimax-api" },
            {
                ...channel,
                id: tokenId,
                name: `${baseName} · Token Plan`,
                vendor: "minimax-token-plan",
                adapter: "minimax-token-plan-native",
                apiFormat: "minimax" as const,
                baseUrl: legacy.minimaxPlanBaseUrl?.trim() || getProviderDefinition("minimax").baseUrl,
                apiKey: legacy.minimaxPlanApiKey || "",
                models: rawModels,
            },
        ];
    });
}

function uniqueMigratedChannelId(preferred: string, usedIds: Set<string>) {
    let id = preferred;
    let suffix = 2;
    while (usedIds.has(id)) {
        id = `${preferred}-${suffix}`;
        suffix += 1;
    }
    usedIds.add(id);
    return id;
}

export function normalizeAiConfig(persistedConfig: Partial<AiConfig>): AiConfig {
    const config = { ...defaultConfig, ...persistedConfig };
    if (!Array.isArray(persistedConfig.channels)) config.channels = [];
    const channels = normalizeChannels(config);
    const imageModel = normalizeDefaultModel(config.imageModel || config.model, channels, "image");
    const videoModel = normalizeDefaultModel(config.videoModel, channels, "video");
    const textModel = normalizeDefaultModel(config.textModel || config.model, channels, "text");
    const audioModel = normalizeDefaultModel(config.audioModel || defaultConfig.audioModel, channels, "audio");
    const audioDefaults = normalizeAudioDefaultsForModel(audioModel, {
        voice: config.audioVoice,
        format: config.audioFormat,
        speed: config.audioSpeed,
        instructions: config.audioInstructions,
    });
    const firstChannel = channels[0];
    return {
        ...config,
        channelMode: "local",
        baseUrl: firstChannel?.baseUrl || config.baseUrl,
        apiKey: firstChannel?.apiKey || config.apiKey,
        apiFormat: firstChannel?.apiFormat || normalizeApiFormat(config.apiFormat),
        channels,
        models: modelOptionsFromChannels(channels),
        model: normalizeModelOptionValue(config.model, channels) || imageModel || textModel || modelOptionsFromChannels(channels)[0] || "",
        imageModel,
        videoModel,
        textModel,
        audioModel,
        audioVoice: audioDefaults.voice,
        audioFormat: audioDefaults.format,
        audioSpeed: audioDefaults.speed,
        audioInstructions: audioDefaults.instructions,
        zodiacSystemPrompt: config.zodiacSystemPrompt || "",
        imagePromptPrefix: config.imagePromptPrefix || persistedConfig.systemPrompt || "",
        systemPrompt: "",
        reasoningEffort: config.reasoningEffort || "auto",
        videoSeconds: config.videoSeconds || "6",
        vquality: config.vquality || "720",
        videoGenerateAudio: config.videoGenerateAudio || "true",
        videoWatermark: config.videoWatermark || "false",
        seedance25TaskMode: normalizeSeedance25TaskMode(config.seedance25TaskMode),
        seedance25Continuation: normalizeSeedance25Continuation(config.seedance25Continuation),
        seedance25OutputFormat: normalizeSeedance25OutputFormat(config.seedance25OutputFormat),
        seedance25InputMode: normalizeSeedance25InputMode(config.seedance25InputMode),
        seedance25Seed: String(normalizeSeedance25Seed(config.seedance25Seed)),
        seedance25ReturnLastFrame: config.seedance25ReturnLastFrame === "false" ? "false" : "true",
        seedance25WebSearch: config.seedance25WebSearch === "true" ? "true" : "false",
        seedance25CameraFixed: config.seedance25CameraFixed === "true" ? "true" : "false",
        minimaxVideoInputMode: normalizeMiniMaxVideoInputMode(config.minimaxVideoInputMode),
        minimaxVideoPromptOptimizer: config.minimaxVideoPromptOptimizer || "true",
        minimaxVideoFastPretreatment: config.minimaxVideoFastPretreatment || "false",
        imageWatermark: config.imageWatermark || "false",
        imageOptimizePrompt: config.imageOptimizePrompt || "true",
        canvasImageCount: config.canvasImageCount || "3",
        terminalApp: config.terminalApp === "ghostty" ? "ghostty" : "terminal",
        agentScanPaths: normalizeAgentScanPaths(persistedConfig.agentScanPaths),
    };
}

function normalizeDefaultModel(value: string | undefined, channels: ModelChannel[], capability: ModelCapability) {
    const normalized = normalizeModelOptionValue(value, channels);
    if (normalized) {
        const decoded = decodeChannelModel(normalized);
        const channel = decoded ? channels.find((item) => item.id === decoded.channelId) : undefined;
        const model = channel?.models.find((item) => item.name === decoded?.model);
        if (model?.capability === capability) return normalized;
    }
    for (const channel of channels) {
        const model = channel.models.find((item) => item.capability === capability);
        if (model) return encodeChannelModel(channel.id, model.name);
    }
    return "";
}

export function defaultBaseUrlForApiFormat(apiFormat: ApiCallFormat) {
    return getProviderDefinition(apiFormat).baseUrl || OPENAI_BASE_URL;
}

function normalizeApiFormat(apiFormat: unknown): ApiCallFormat {
    return apiFormat === "gemini" || apiFormat === "qwen" || apiFormat === "minimax" || apiFormat === "ark" || apiFormat === "xai" || apiFormat === "agnes" ? apiFormat : "openai";
}

function uniqueModelOptions(models: string[]) {
    return Array.from(new Set((models || []).map((model) => model.trim()).filter(Boolean)));
}

export function buildApiUrl(baseUrl: string, path: string) {
    let normalizedBaseUrl = baseUrl.trim().replace(/\/+$/, "");
    normalizedBaseUrl = normalizeArkPlanBaseUrl(normalizedBaseUrl);
    const lowerBaseUrl = normalizedBaseUrl.toLowerCase();
    const apiBaseUrl = lowerBaseUrl.endsWith("/v1") || lowerBaseUrl.endsWith("/api/v3") || lowerBaseUrl.endsWith("/api/plan/v3") ? normalizedBaseUrl : `${normalizedBaseUrl}/v1`;
    return `${apiBaseUrl}${path}`;
}

function normalizeArkPlanBaseUrl(baseUrl: string) {
    try {
        const url = new URL(baseUrl);
        const path = url.pathname.replace(/\/+$/, "");
        const lowerPath = path.toLowerCase();
        const arkPlanIndex = lowerPath.indexOf("/api/plan/v3");
        if (arkPlanIndex < 0) return baseUrl;
        const end = arkPlanIndex + "/api/plan/v3".length;
        if (lowerPath.length !== end && lowerPath[end] !== "/") return baseUrl;
        url.pathname = path.slice(0, end);
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return baseUrl;
    }
}
