export type MiniMaxBillingMode = "token-plan" | "payg";
export type MiniMaxCredentialKind = MiniMaxBillingMode | "unknown";
export type MiniMaxNativeTask = "text" | "image" | "video-h3" | "video-hailuo" | "speech" | "voice-clone";
export type MiniMaxVideoInputMode = "auto" | "first-frame" | "last-frame" | "first-last" | "reference";
export type MiniMaxResolvedVideoInputMode = Exclude<MiniMaxVideoInputMode, "auto">;

/** MiniMax documents Token Plan keys as `sk-cp-*` and pay-as-you-go keys as
 * `sk-api-*`. The model-list endpoint accepts both, so key identity must be
 * checked before using that endpoint as a connection test. */
export function miniMaxCredentialKind(apiKey: string): MiniMaxCredentialKind {
    const key = apiKey.trim().toLowerCase();
    if (key.startsWith("sk-cp")) return "token-plan";
    if (key.startsWith("sk-api")) return "payg";
    return "unknown";
}

export function miniMaxCredentialError(mode: MiniMaxBillingMode, apiKey: string) {
    const kind = miniMaxCredentialKind(apiKey);
    if (kind === "unknown" || kind === mode) return "";
    return mode === "token-plan" ? "当前填写的是按量计费 API Key（sk-api），请改用 Token Plan Key（sk-cp）" : "当前填写的是 Token Plan Key（sk-cp），请改用按量计费 API Key（sk-api）";
}

export function assertMiniMaxCredentialMatches(mode: MiniMaxBillingMode, apiKey: string) {
    const error = miniMaxCredentialError(mode, apiKey);
    if (error) throw new Error(error);
}
export type MiniMaxVideoReferenceCounts = { images: number; videos: number; audios: number };

export const MINIMAX_CN_API_BASE_URL = "https://api.minimaxi.com";
export const MINIMAX_CN_TOKEN_PLAN_BASE_URL = "https://api.minimaxi.com";

export const MINIMAX_IMAGE_RATIOS = ["1:1", "16:9", "4:3", "3:2", "2:3", "3:4", "9:16", "21:9"] as const;
export const MINIMAX_VIDEO_RATIOS = ["adaptive", "21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const;
export const MINIMAX_VIDEO_RESOLUTIONS = ["768P", "2K"] as const;
export const MINIMAX_VIDEO_INPUT_MODES = ["auto", "first-frame", "last-frame", "first-last", "reference"] as const;
export const MINIMAX_HAILUO_MODELS = ["MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast"] as const;
export const MINIMAX_HAILUO_RESOLUTIONS = ["768P", "1080P"] as const;
export const MINIMAX_HAILUO_DURATIONS = [6, 10] as const;

export type MiniMaxNativeRoute = {
    id: MiniMaxNativeTask;
    label: string;
    method: "GET" | "POST";
    path: string;
    docsUrl: string;
    paygOnly?: boolean;
};

const nativeRoutes: Record<MiniMaxNativeTask, MiniMaxNativeRoute> = {
    text: {
        id: "text",
        label: "MiniMax Anthropic Messages",
        method: "POST",
        path: "/anthropic/v1/messages",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/text-chat-anthropic",
    },
    image: {
        id: "image",
        label: "MiniMax 图片生成",
        method: "POST",
        path: "/v1/image_generation",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/image-generation-t2i",
    },
    "video-h3": {
        id: "video-h3",
        label: "MiniMax H3 视频生成",
        method: "POST",
        path: "/v2/video_generation",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/video-generation-v2-create",
        paygOnly: true,
    },
    "video-hailuo": {
        id: "video-hailuo",
        label: "MiniMax Hailuo 2.3 视频生成",
        method: "POST",
        path: "/v1/video_generation",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/video-generation-t2v",
    },
    speech: {
        id: "speech",
        label: "MiniMax Speech 2.8",
        method: "POST",
        path: "/v1/t2a_v2",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/speech-t2a-http",
    },
    "voice-clone": {
        id: "voice-clone",
        label: "MiniMax 声音复刻",
        method: "POST",
        path: "/v1/voice_clone",
        docsUrl: "https://platform.minimaxi.com/docs/api-reference/voice-cloning-clone",
        paygOnly: true,
    },
};

export function miniMaxNativeRoute(task: MiniMaxNativeTask) {
    return nativeRoutes[task];
}

export function miniMaxNativeRoutesForModel(model: string) {
    const value = model.toLowerCase();
    if (isMiniMaxTextModel(model)) return [nativeRoutes.text];
    if (value === "image-01") return [nativeRoutes.image];
    if (value === "minimax-h3") {
        return [
            nativeRoutes["video-h3"],
            {
                id: "video-h3" as const,
                label: "MiniMax H3 任务查询",
                method: "GET" as const,
                path: "/v2/query/video_generation/{task_id}",
                docsUrl: "https://platform.minimaxi.com/docs/api-reference/video-generation-v2-query",
                paygOnly: true,
            },
        ];
    }
    if (isMiniMaxHailuoModel(model)) {
        return [
            nativeRoutes["video-hailuo"],
            {
                id: "video-hailuo" as const,
                label: "MiniMax Hailuo 任务查询",
                method: "GET" as const,
                path: "/v1/query/video_generation?task_id={task_id}",
                docsUrl: "https://platform.minimaxi.com/docs/api-reference/video-generation-query",
            },
            {
                id: "video-hailuo" as const,
                label: "MiniMax Hailuo 视频下载",
                method: "GET" as const,
                path: "/v1/files/retrieve?file_id={file_id}",
                docsUrl: "https://platform.minimaxi.com/docs/api-reference/video-generation-download",
            },
        ];
    }
    if (value.startsWith("speech-2.8-")) {
        return [
            nativeRoutes.speech,
            {
                id: "voice-clone" as const,
                label: "上传复刻样本",
                method: "POST" as const,
                path: "/v1/files/upload",
                docsUrl: "https://platform.minimaxi.com/docs/api-reference/voice-cloning-uploadcloneaudio",
                paygOnly: true,
            },
            nativeRoutes["voice-clone"],
        ];
    }
    return [];
}

/** MiniMax exposes /anthropic, /v1 and /v2 routes from one bare service origin. */
export function normalizeMiniMaxOrigin(baseUrl: string) {
    const raw = baseUrl.trim().replace(/\/+$/, "");
    if (!raw) return "";
    try {
        const url = new URL(raw);
        const path = url.pathname.replace(/\/+$/, "");
        const marker = path.search(/\/(?:anthropic|v1|v2)(?:\/|$)/i);
        url.pathname = marker >= 0 ? path.slice(0, marker) || "/" : path || "/";
        url.search = "";
        url.hash = "";
        return url.toString().replace(/\/+$/, "");
    } catch {
        return raw.replace(/\/(?:anthropic|v1|v2)(?:\/.*)?$/i, "");
    }
}

export function buildMiniMaxEndpoint(baseUrl: string, task: MiniMaxNativeTask | "video-query" | "video-hailuo-query" | "video-retrieve" | "file-upload", exactId?: string) {
    const origin = normalizeMiniMaxOrigin(baseUrl);
    if (!origin) throw new Error("请先配置 MiniMax 线路地址");
    if (task === "text") return `${origin}/anthropic/v1/messages`;
    if (task === "image") return `${origin}/v1/image_generation`;
    if (task === "video-h3") return `${origin}/v2/video_generation`;
    if (task === "video-query") {
        if (!exactId?.trim()) throw new Error("MiniMax H3 任务 ID 不能为空");
        return `${origin}/v2/query/video_generation/${encodeURIComponent(exactId.trim())}`;
    }
    if (task === "video-hailuo") return `${origin}/v1/video_generation`;
    if (task === "video-hailuo-query") return `${origin}/v1/query/video_generation?task_id=${encodeExactMiniMaxId(exactId, "任务")}`;
    if (task === "video-retrieve") return `${origin}/v1/files/retrieve?file_id=${encodeExactMiniMaxId(exactId, "文件")}`;
    if (task === "speech") return `${origin}/v1/t2a_v2`;
    if (task === "file-upload") return `${origin}/v1/files/upload`;
    return `${origin}/v1/voice_clone`;
}

export function miniMaxTaskForModel(model: string): MiniMaxNativeTask | null {
    const value = model.toLowerCase();
    if (isMiniMaxTextModel(model)) return "text";
    if (value === "image-01") return "image";
    if (value === "minimax-h3") return "video-h3";
    if (isMiniMaxHailuoModel(model)) return "video-hailuo";
    if (value.startsWith("speech-2.8-")) return "speech";
    return null;
}

export function isMiniMaxTextModel(model: string) {
    return model.trim().toLowerCase().startsWith("minimax-m");
}

export function isMiniMaxHailuoModel(model: string) {
    const value = model.trim().toLowerCase();
    return value === "minimax-hailuo-2.3" || value === "minimax-hailuo-2.3-fast";
}

export function isMiniMaxHailuoFastModel(model: string) {
    return model.trim().toLowerCase() === "minimax-hailuo-2.3-fast";
}

function closestRatio(value: string, candidates: readonly string[], fallback: string) {
    if (candidates.includes(value)) return value;
    const dimensions = value.match(/^(\d+(?:\.\d+)?)(?::|x)(\d+(?:\.\d+)?)$/i);
    if (!dimensions) return fallback;
    const target = Number(dimensions[1]) / Number(dimensions[2]);
    return candidates
        .filter((candidate) => candidate !== "adaptive")
        .reduce((best, candidate) => {
            const [w, h] = candidate.split(":").map(Number);
            const [bestW, bestH] = best.split(":").map(Number);
            return Math.abs(w / h - target) < Math.abs(bestW / bestH - target) ? candidate : best;
        }, fallback);
}

export function normalizeMiniMaxImageRatio(value: string) {
    return closestRatio(value, MINIMAX_IMAGE_RATIOS, "1:1");
}

export function normalizeMiniMaxVideoRatio(value: string, hasReference: boolean) {
    if (hasReference && (!value || value === "auto")) return "adaptive";
    return closestRatio(!hasReference && (value === "auto" || value === "adaptive") ? "16:9" : value, MINIMAX_VIDEO_RATIOS, "16:9");
}

export function normalizeMiniMaxVideoResolution(value: string) {
    const normalized = value.trim().toLowerCase();
    return normalized === "2k" || normalized === "1440" || normalized === "2160" || normalized === "high" || normalized === "4k" ? "2K" : "768P";
}

export function normalizeMiniMaxVideoInputMode(value: unknown): MiniMaxVideoInputMode {
    return typeof value === "string" && MINIMAX_VIDEO_INPUT_MODES.includes(value as MiniMaxVideoInputMode) ? (value as MiniMaxVideoInputMode) : "auto";
}

/** Auto is the only mode that derives frame roles from the attached media. */
export function resolveMiniMaxVideoInputMode(mode: MiniMaxVideoInputMode, counts: MiniMaxVideoReferenceCounts): MiniMaxResolvedVideoInputMode {
    if (mode !== "auto") return mode;
    if (counts.videos || counts.audios || counts.images > 2 || counts.images === 0) return "reference";
    return counts.images === 2 ? "first-last" : "first-frame";
}

export function miniMaxVideoInputModeError(mode: MiniMaxVideoInputMode, counts: MiniMaxVideoReferenceCounts) {
    if (mode === "auto") return "";
    const hasNonImageMedia = counts.videos > 0 || counts.audios > 0;
    if (mode === "first-frame" && (counts.images !== 1 || hasNonImageMedia)) return "首帧模式需要且只使用 1 张图片";
    if (mode === "last-frame" && (counts.images !== 1 || hasNonImageMedia)) return "尾帧模式需要且只使用 1 张图片";
    if (mode === "first-last" && (counts.images !== 2 || hasNonImageMedia)) return "首尾帧模式需要且只使用 2 张图片";
    if (mode === "reference" && counts.images + counts.videos + counts.audios === 0) return "参考素材模式需要至少 1 项图片、视频或音频";
    return "";
}

export type MiniMaxImageInput = {
    prompt: string;
    ratio: string;
    count: number;
    optimizePrompt?: boolean;
    referenceImage?: string;
    responseFormat?: "url" | "base64";
    seed?: number;
    watermark?: boolean;
};

export function buildMiniMaxImageRequest(model: string, input: MiniMaxImageInput) {
    const prompt = input.prompt.trim();
    if (!prompt) throw new Error("请输入图片提示词");
    if (prompt.length > 1500) throw new Error("MiniMax 图片提示词不能超过 1500 个字符");
    return {
        model: model || "image-01",
        prompt,
        aspect_ratio: normalizeMiniMaxImageRatio(input.ratio),
        response_format: input.responseFormat || "url",
        n: Math.max(1, Math.min(9, Math.floor(input.count) || 1)),
        prompt_optimizer: input.optimizePrompt !== false,
        ...(typeof input.seed === "number" ? { seed: Math.trunc(input.seed) } : {}),
        ...(typeof input.watermark === "boolean" ? { aigc_watermark: input.watermark } : {}),
        ...(input.referenceImage ? { subject_reference: [{ type: "character", image_file: input.referenceImage }] } : {}),
    };
}

type MiniMaxImageResponse = {
    data?: { image_urls?: string[]; image_base64?: string[] } | Array<Record<string, unknown>>;
    base_resp?: { status_code?: number; status_msg?: string };
};

export function parseMiniMaxImageResponse(payload: MiniMaxImageResponse) {
    assertMiniMaxResponse(payload);
    const data = payload.data;
    const urls = !Array.isArray(data) ? data?.image_urls || [] : data.flatMap((item) => (typeof item.url === "string" ? [item.url] : []));
    const base64 = !Array.isArray(data) ? data?.image_base64 || [] : data.flatMap((item) => (typeof item.base64 === "string" ? [item.base64] : []));
    const images = [...urls, ...base64.map((value) => (value.startsWith("data:") ? value : `data:image/jpeg;base64,${value}`))];
    if (!images.length) throw new Error("MiniMax 图片接口没有返回图片");
    return images;
}

export type MiniMaxH3Input = {
    prompt: string;
    mode: MiniMaxVideoInputMode;
    images?: string[];
    videos?: string[];
    audios?: string[];
    resolution: string;
    duration: number;
    ratio: string;
    watermark?: boolean;
};

export function buildMiniMaxH3Request(model: string, input: MiniMaxH3Input) {
    const text = input.prompt.trim();
    if (!text) throw new Error("MiniMax H3 请求必须包含非空文字提示");
    const images = input.images || [];
    const videos = input.videos || [];
    const audios = input.audios || [];
    if (images.length > 9) throw new Error("MiniMax H3 最多支持 9 张参考图");
    if (videos.length > 3) throw new Error("MiniMax H3 最多支持 3 个参考视频");
    if (audios.length > 3) throw new Error("MiniMax H3 最多支持 3 个参考音频");
    const counts = { images: images.length, videos: videos.length, audios: audios.length };
    const modeError = miniMaxVideoInputModeError(input.mode, counts);
    if (modeError) throw new Error(modeError);
    const mode = resolveMiniMaxVideoInputMode(input.mode, counts);

    const content: Array<Record<string, unknown>> = [{ type: "text", text }];
    if (mode === "first-frame") content.push({ type: "image_url", image_url: { url: images[0] }, role: "first_frame" });
    if (mode === "last-frame") content.push({ type: "image_url", image_url: { url: images[0] }, role: "last_frame" });
    if (mode === "first-last") {
        content.push({ type: "image_url", image_url: { url: images[0] }, role: "first_frame" });
        content.push({ type: "image_url", image_url: { url: images[1] }, role: "last_frame" });
    }
    if (mode === "reference") {
        images.forEach((url) => content.push({ type: "image_url", image_url: { url }, role: "reference_image" }));
        videos.forEach((url) => content.push({ type: "video_url", video_url: { url }, role: "reference_video" }));
        audios.forEach((url) => content.push({ type: "audio_url", audio_url: { url }, role: "reference_audio" }));
    }
    const hasReference = content.length > 1;
    return {
        model: model || "MiniMax-H3",
        content,
        resolution: normalizeMiniMaxVideoResolution(input.resolution),
        duration: Math.max(4, Math.min(15, Math.floor(input.duration) || 6)),
        ratio: mode === "first-frame" || mode === "last-frame" || mode === "first-last" ? "adaptive" : normalizeMiniMaxVideoRatio(input.ratio, hasReference),
        ...(typeof input.watermark === "boolean" ? { aigc_watermark: input.watermark } : {}),
    };
}

export type MiniMaxH3TaskResponse = {
    task_id?: string;
    task?: { status?: string; content?: { url?: string }; error?: { message?: string } | string };
    base_resp?: { status_code?: number; status_msg?: string };
};

export function parseMiniMaxH3CreateResponse(payload: MiniMaxH3TaskResponse) {
    assertMiniMaxResponse(payload);
    return exactMiniMaxId(payload.task_id, "MiniMax H3 接口没有返回任务 ID");
}

export function parseMiniMaxH3QueryResponse(payload: MiniMaxH3TaskResponse): { status: "pending" | "completed" | "failed"; url?: string; error?: string } {
    assertMiniMaxResponse(payload);
    const status = payload.task?.status?.toLowerCase();
    if (status === "succeeded") {
        const url = payload.task?.content?.url;
        return url ? { status: "completed", url } : { status: "failed", error: "MiniMax H3 任务成功但没有返回视频地址" };
    }
    if (status === "failed" || status === "cancelled") {
        const error = payload.task?.error;
        return { status: "failed", error: typeof error === "string" ? error : error?.message || "MiniMax H3 视频生成失败" };
    }
    return { status: "pending" };
}

export type MiniMaxHailuoInput = {
    prompt?: string;
    firstFrameImage?: string;
    duration: number;
    resolution: string;
    promptOptimizer?: boolean;
    fastPretreatment?: boolean;
    watermark?: boolean;
};

export function normalizeMiniMaxHailuoVideoOptions(resolution: string, duration: number) {
    const normalizedDuration = duration === 10 ? 10 : 6;
    const normalizedResolution = /^1080p?$/iu.test(resolution.trim()) && normalizedDuration === 6 ? "1080P" : "768P";
    return { resolution: normalizedResolution as (typeof MINIMAX_HAILUO_RESOLUTIONS)[number], duration: normalizedDuration as (typeof MINIMAX_HAILUO_DURATIONS)[number] };
}

export function buildMiniMaxHailuoRequest(model: string, input: MiniMaxHailuoInput) {
    const normalizedModel = MINIMAX_HAILUO_MODELS.find((item) => item.toLowerCase() === model.trim().toLowerCase());
    if (!normalizedModel) throw new Error("请选择 MiniMax Hailuo 2.3 视频模型");
    const prompt = input.prompt?.trim() || "";
    if (prompt.length > 2000) throw new Error("MiniMax Hailuo 视频提示词不能超过 2000 个字符");
    const firstFrameImage = input.firstFrameImage?.trim() || "";
    if (isMiniMaxHailuoFastModel(normalizedModel) && !firstFrameImage) throw new Error("MiniMax Hailuo 2.3 Fast 需要一张首帧图片");
    if (!firstFrameImage && !prompt) throw new Error("文生视频需要填写提示词");
    const promptOptimizer = input.promptOptimizer !== false;
    const options = normalizeMiniMaxHailuoVideoOptions(input.resolution, input.duration);
    return {
        model: normalizedModel,
        ...(prompt ? { prompt } : {}),
        ...(firstFrameImage ? { first_frame_image: firstFrameImage } : {}),
        duration: options.duration,
        resolution: options.resolution,
        prompt_optimizer: promptOptimizer,
        fast_pretreatment: promptOptimizer && input.fastPretreatment === true,
        aigc_watermark: input.watermark ?? false,
    };
}

export type MiniMaxHailuoImageMetadata = {
    mimeType?: string;
    bytes?: number;
    width?: number;
    height?: number;
};

export function miniMaxHailuoImageError(image: MiniMaxHailuoImageMetadata) {
    const mimeType = image.mimeType?.trim().toLowerCase();
    if (mimeType && !["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(mimeType)) return "首帧图片仅支持 JPEG、PNG 或 WebP 格式";
    if (typeof image.bytes === "number" && image.bytes >= 20 * 1024 * 1024) return "首帧图片需要小于 20MB";
    if (typeof image.width === "number" && typeof image.height === "number" && Number.isFinite(image.width) && Number.isFinite(image.height) && image.width > 0 && image.height > 0) {
        if (Math.min(image.width, image.height) <= 300) return "首帧图片短边需要大于 300px";
        const ratio = image.width / image.height;
        if (ratio < 2 / 5 || ratio > 5 / 2) return "首帧图片宽高比需要在 2:5 到 5:2 之间";
    }
    return "";
}

export type MiniMaxHailuoTaskResponse = {
    task_id?: string;
    status?: string;
    file_id?: string;
    error_message?: string;
    base_resp?: { status_code?: number; status_msg?: string };
};

export type MiniMaxHailuoFileResponse = {
    file?: { file_id?: string; download_url?: string };
    base_resp?: { status_code?: number; status_msg?: string };
};

export function parseMiniMaxHailuoCreateResponse(payload: MiniMaxHailuoTaskResponse) {
    assertMiniMaxResponse(payload);
    return exactMiniMaxId(payload.task_id, "MiniMax Hailuo 接口没有返回任务 ID");
}

export function parseMiniMaxHailuoQueryResponse(payload: MiniMaxHailuoTaskResponse): { status: "pending" } | { status: "completed"; fileId: string } | { status: "failed"; error: string } {
    assertMiniMaxResponse(payload);
    const status = payload.status?.trim().toLowerCase();
    if (status === "success") return { status: "completed", fileId: exactMiniMaxId(payload.file_id, "MiniMax Hailuo 任务成功但没有返回文件 ID") };
    if (status === "fail" || status === "failed") return { status: "failed", error: payload.error_message?.trim() || "MiniMax Hailuo 视频生成失败" };
    return { status: "pending" };
}

export function parseMiniMaxHailuoFileResponse(payload: MiniMaxHailuoFileResponse) {
    assertMiniMaxResponse(payload);
    const url = payload.file?.download_url?.trim();
    if (!url) throw new Error("MiniMax Hailuo 文件接口没有返回下载地址");
    return url;
}

export type MiniMaxSpeechInput = {
    text: string;
    voiceId: string;
    speed?: number;
    volume?: number;
    pitch?: number;
    emotion?: string;
    sampleRate?: number;
    format?: "mp3" | "wav" | "flac";
    language?: string;
    watermark?: boolean;
};

export function buildMiniMaxSpeechRequest(model: string, input: MiniMaxSpeechInput) {
    const text = input.text.trim();
    if (!text) throw new Error("请输入要生成语音的文字");
    if (text.length >= 10_000) throw new Error("MiniMax 同步语音文本需要少于 10000 个字符");
    if (!input.voiceId.trim()) throw new Error("请填写 MiniMax 音色 ID");
    return {
        model,
        text,
        stream: false,
        output_format: "url",
        voice_setting: {
            voice_id: input.voiceId.trim(),
            speed: Math.max(0.5, Math.min(2, input.speed ?? 1)),
            vol: Math.max(0, Math.min(10, input.volume ?? 1)),
            pitch: Math.max(-12, Math.min(12, input.pitch ?? 0)),
            ...(input.emotion && input.emotion !== "auto" ? { emotion: input.emotion } : {}),
        },
        audio_setting: {
            sample_rate: input.sampleRate || 32_000,
            bitrate: 128_000,
            format: input.format || "mp3",
            channel: 1,
        },
        ...(input.language && input.language !== "auto" ? { language_boost: input.language } : {}),
        aigc_watermark: input.watermark ?? false,
    };
}

export type MiniMaxSpeechResponse = {
    data?: { audio?: string };
    base_resp?: { status_code?: number; status_msg?: string };
};

export function parseMiniMaxSpeechResponse(payload: MiniMaxSpeechResponse, format: "mp3" | "wav" | "flac" = "mp3") {
    assertMiniMaxResponse(payload);
    const audio = payload.data?.audio;
    if (!audio) throw new Error("MiniMax 语音接口没有返回音频");
    if (/^(?:https?:|data:|blob:)/i.test(audio)) return audio;
    const mime = format === "wav" ? "audio/wav" : format === "flac" ? "audio/flac" : "audio/mpeg";
    return `data:${mime};base64,${hexToBase64(audio)}`;
}

export function normalizeMiniMaxVoiceId(value: string) {
    const voiceId = value.trim();
    if (!/^[A-Za-z][A-Za-z0-9_-]{6,254}[A-Za-z0-9]$/.test(voiceId)) {
        throw new Error("MiniMax 音色 ID 需为 8–256 位，以英文字母开头，且不能以 - 或 _ 结尾");
    }
    return voiceId;
}

export function assertMiniMaxCloneDurationSeconds(duration: number) {
    if (!Number.isFinite(duration) || duration <= 0) throw new Error("无法读取声音样本时长，请换一个有效的音频文件");
    if (duration < 10) throw new Error("声音样本至少需要 10 秒");
    if (duration > 300) throw new Error("声音样本不能超过 5 分钟");
}

export function buildMiniMaxVoiceCloneRequest(fileId: string, voiceId: string, model: string, previewText?: string, watermark = false) {
    const exactFileId = normalizeMiniMaxFileId(fileId);
    const fields = JSON.stringify({
        voice_id: normalizeMiniMaxVoiceId(voiceId),
        ...(previewText?.trim() ? { text: previewText.trim(), model } : {}),
        need_noise_reduction: true,
        need_volume_normalization: true,
        aigc_watermark: watermark,
    });
    return `{"file_id":${exactFileId},${fields.slice(1)}`;
}

export function parseMiniMaxFileId(rawPayload: string) {
    let payload: { file?: { file_id?: string }; base_resp?: { status_code?: number; status_msg?: string } };
    try {
        // Protect every bare file_id before JSON.parse so JavaScript never
        // rounds an int64 through Number. Other response fields stay ordinary
        // JSON and continue through the shared MiniMax business-error check.
        const protectedPayload = rawPayload.replace(/("file_id"\s*:\s*)(-?(?:0|[1-9]\d*))(?![.\deE])/gu, '$1"$2"');
        payload = JSON.parse(protectedPayload) as typeof payload;
    } catch {
        throw new Error("MiniMax 上传接口返回的 JSON 无效");
    }
    assertMiniMaxResponse(payload);
    const fileId = payload.file?.file_id;
    if (typeof fileId !== "string" || !fileId) throw new Error("MiniMax 上传接口没有返回文件 ID");
    return normalizeMiniMaxFileId(fileId);
}

function normalizeMiniMaxFileId(fileId: string) {
    const value = fileId.trim();
    if (!/^[1-9]\d*$/u.test(value)) throw new Error("MiniMax 文件 ID 必须是正十进制整数");
    const maxInt64 = "9223372036854775807";
    if (value.length > maxInt64.length || (value.length === maxInt64.length && value > maxInt64)) throw new Error("MiniMax 文件 ID 超出 int64 范围");
    return value;
}

export function assertMiniMaxResponse(payload: { base_resp?: { status_code?: number; status_msg?: string } }) {
    const code = payload.base_resp?.status_code;
    if (typeof code === "number" && code !== 0) throw new Error(payload.base_resp?.status_msg || `MiniMax 请求失败（${code}）`);
}

function exactMiniMaxId(value: unknown, missingMessage: string) {
    if (typeof value !== "string" || !value.trim()) throw new Error(missingMessage);
    return value.trim();
}

function encodeExactMiniMaxId(value: unknown, label: string) {
    return encodeURIComponent(exactMiniMaxId(value, `MiniMax ${label} ID 不能为空`));
}

function hexToBase64(hex: string) {
    const normalized = hex.trim();
    if (!/^(?:[0-9a-f]{2})+$/i.test(normalized)) return normalized;
    const bytes = new Uint8Array(normalized.length / 2);
    for (let index = 0; index < bytes.length; index += 1) bytes[index] = Number.parseInt(normalized.slice(index * 2, index * 2 + 2), 16);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}
