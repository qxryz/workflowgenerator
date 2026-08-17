export type Seedance25TaskMode = "generate" | "extend" | "edit";
export type Seedance25Continuation = "natural" | "ending";
export type Seedance25OutputFormat = "mp4" | "mov";
export type Seedance25InputMode = "reference" | "first-frame" | "first-last";

export type Seedance25ReusableVideo = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

type Seedance25ReferenceImage = {
    type?: string;
    bytes?: number;
};

type Seedance25ReferenceVideo = {
    type: string;
    bytes?: number;
    durationMs?: number;
    width?: number;
    height?: number;
};

type Seedance25ReferenceAudio = {
    type?: string;
    bytes?: number;
    durationMs?: number;
};

export const SEEDANCE_25_TASKS = [
    { value: "generate", label: "生成视频" },
    { value: "extend", label: "延长视频" },
    { value: "edit", label: "编辑视频" },
] as const;

export const SEEDANCE_25_CONTINUATIONS = [
    { value: "natural", label: "自然续写" },
    { value: "ending", label: "指定结尾" },
] as const;

export const SEEDANCE_25_INPUT_MODES = [
    { value: "reference", label: "自由创作", description: "只写描述，也可以添加图片或视频参考" },
    { value: "first-frame", label: "从图片开始", description: "用 1 张图片确定视频的开场画面" },
    { value: "first-last", label: "指定开始与结束", description: "用 2 张图片确定开始和结束画面" },
] as const;

export const SEEDANCE_25_GENERATION_DURATIONS = [4, 10, 15, 20, 30] as const;
export const SEEDANCE_25_EXTENSION_DURATIONS = [4, 10, 15, 20, 30] as const;
export const SEEDANCE_25_OUTPUT_FORMATS = [
    { value: "mp4", label: "MP4", description: "通用播放" },
    { value: "mov", label: "MOV", description: "专业后期" },
] as const;
export const SEEDANCE_25_REFERENCE_LIMITS = {
    total: 50,
    images: 30,
    videos: 10,
    audios: 10,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 200 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
    mediaMaxDurationMs: 30_000,
    mediaTotalDurationMs: 30_000,
} as const;

const SEEDANCE_25_IMAGE_MIME_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/webp", "image/bmp", "image/tiff", "image/gif", "image/heic", "image/heif"];
const SEEDANCE_25_VIDEO_MIME_TYPES = ["video/mp4", "video/quicktime"];
const SEEDANCE_25_AUDIO_MIME_TYPES = ["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/wave"];

export function isSeedance25Model(value: string) {
    const name = String(value || "").toLowerCase();
    return /(?:seedance|sd)[-_.\s]*2[-_.\s]*5/u.test(name) || name.includes("seedance-2-5");
}

export function normalizeSeedance25TaskMode(value: string | undefined): Seedance25TaskMode {
    return value === "extend" || value === "edit" ? value : "generate";
}

export function normalizeSeedance25Continuation(value: string | undefined): Seedance25Continuation {
    return value === "ending" ? "ending" : "natural";
}

export function normalizeSeedance25OutputFormat(value: string | undefined): Seedance25OutputFormat {
    return value === "mov" ? "mov" : "mp4";
}

export function normalizeSeedance25InputMode(value: string | undefined): Seedance25InputMode {
    return value === "first-frame" || value === "first-last" ? value : "reference";
}

export function normalizeSeedance25Seed(value: string | number | undefined) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return -1;
    return Math.max(-1, Math.min(4_294_967_295, Math.trunc(numeric)));
}

export function seedance25ImageRole(inputMode: Seedance25InputMode, index: number) {
    if (inputMode === "first-frame") return index === 0 ? "first_frame" : "reference_image";
    if (inputMode === "first-last") return index === 0 ? "first_frame" : index === 1 ? "last_frame" : "reference_image";
    return "reference_image";
}

export function seedance25InputModeError(
    mode: Seedance25TaskMode,
    inputMode: Seedance25InputMode,
    counts: { images: number; videos: number; audios: number },
) {
    if (mode !== "generate" || inputMode === "reference") return "";
    if (counts.videos || counts.audios) return "使用开场或结束图片时，不能同时添加参考视频或音频";
    if (inputMode === "first-frame") {
        if (counts.images === 0) return "请添加 1 张开场图片";
        if (counts.images > 1) return "开场画面只能使用 1 张图片";
    }
    if (inputMode === "first-last") {
        if (counts.images === 0) return "请添加开始和结束两张图片";
        if (counts.images === 1) return "还需要添加 1 张结束图片";
        if (counts.images > 2) return "开始与结束画面只能使用 2 张图片";
    }
    return "";
}

export function normalizeSeedance25RemoteVideoUrl(value: string) {
    const trimmed = value.trim();
    if (/^https:\/\//i.test(trimmed) || /^asset:\/\/asset-[a-z\d_-]+$/i.test(trimmed)) return trimmed;
    if (/^asset-[a-z\d_-]+$/i.test(trimmed)) return `asset://${trimmed}`;
    return "";
}

export function seedance25DurationOptions(mode: Seedance25TaskMode) {
    return mode === "extend" ? SEEDANCE_25_EXTENSION_DURATIONS : SEEDANCE_25_GENERATION_DURATIONS;
}

export function normalizeSeedance25Duration(value: string | number, mode: Seedance25TaskMode) {
    if (mode === "edit") return -1;
    if (String(value).trim() === "-1") return -1;
    const fallback = 30;
    const seconds = Math.floor(Number(value) || fallback);
    return Math.max(4, Math.min(30, seconds));
}

export function seedance25TaskLabel(mode: Seedance25TaskMode) {
    return SEEDANCE_25_TASKS.find((item) => item.value === mode)?.label || "生成视频";
}

export function seedance25ReferenceError(mode: Seedance25TaskMode, videos: Seedance25ReferenceVideo[]) {
    if (videos.length > SEEDANCE_25_REFERENCE_LIMITS.videos) return "Seedance 2.5 最多支持 10 个参考视频";
    if (mode !== "generate" && videos.length < 1) return "请至少连接 1 个视频作为原片";
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const source = videos[index];
        const label = mode !== "generate" && index === 0 ? "原片" : `视频${index + 1}`;
        if (!SEEDANCE_25_VIDEO_MIME_TYPES.includes(source.type)) return `${label}仅支持 mp4/mov 格式`;
        if (source.bytes && source.bytes > SEEDANCE_25_REFERENCE_LIMITS.videoMaxBytes) return `${label}超过 200MB，请压缩后再上传`;
        if (source.durationMs) {
            const minimumMs = mode === "edit" && index === 0 ? 4_000 : 2_000;
            if (source.durationMs < minimumMs) return `${label}时长不能少于 ${minimumMs / 1000} 秒`;
            if (source.durationMs > SEEDANCE_25_REFERENCE_LIMITS.mediaMaxDurationMs) return `${label}时长不能超过 30 秒`;
            totalDurationMs += source.durationMs;
        }
        if (source.width && source.height) {
            if (source.width < 300 || source.width > 6_000 || source.height < 300 || source.height > 6_000) return `${label}宽高需要在 300-6000px 之间`;
            const ratio = source.width / source.height;
            if (ratio < 0.4 || ratio > 2.5) return `${label}宽高比需要在 0.4-2.5 之间`;
            const pixels = source.width * source.height;
            if (pixels < 640 * 640 || pixels > 3_326 * 2_494) return `${label}总像素需要在 409600-8295044 之间`;
        }
    }
    if (totalDurationMs > SEEDANCE_25_REFERENCE_LIMITS.mediaTotalDurationMs) return "Seedance 2.5 参考视频总时长不能超过 30 秒";
    return "";
}

export function prepareSeedance25GeneratedVideoSource(
    video: Seedance25ReusableVideo,
    remoteVideoUrl: string | undefined,
    mode: Exclude<Seedance25TaskMode, "generate">,
    fallbackSeconds = 10,
): { video: Seedance25ReusableVideo; durationSeconds: number } | { error: string } {
    const url = normalizeSeedance25RemoteVideoUrl(remoteVideoUrl || "");
    if (!url) return { error: "这条生成记录缺少仍可用的官方视频地址，请改用公网 URL 或方舟素材 ID" };
    const minimumSeconds = mode === "edit" ? 4 : 2;
    const measuredSeconds = video.durationMs ? Math.round(video.durationMs / 1000) : Math.round(fallbackSeconds > 0 ? fallbackSeconds : 10);
    const durationSeconds = Math.max(minimumSeconds, Math.min(30, measuredSeconds || 10));
    const source = {
        ...video,
        url,
        storageKey: "",
        durationMs: video.durationMs || durationSeconds * 1000,
    };
    const error = seedance25ReferenceError(mode, [
        {
            type: source.mimeType,
            bytes: source.bytes,
            durationMs: source.durationMs,
            width: source.width,
            height: source.height,
        },
    ]);
    return error ? { error } : { video: source, durationSeconds };
}

export function seedance25MultimodalReferenceError(mode: Seedance25TaskMode, images: Seedance25ReferenceImage[], videos: Seedance25ReferenceVideo[], audios: Seedance25ReferenceAudio[]) {
    const total = images.length + videos.length + audios.length;
    if (total > SEEDANCE_25_REFERENCE_LIMITS.total) return "Seedance 2.5 单次最多使用 50 个参考素材";
    if (images.length > SEEDANCE_25_REFERENCE_LIMITS.images) return "Seedance 2.5 最多支持 30 张参考图";
    if (audios.length > SEEDANCE_25_REFERENCE_LIMITS.audios) return "Seedance 2.5 最多支持 10 个参考音频";
    for (let index = 0; index < images.length; index += 1) {
        const image = images[index];
        const type = String(image.type || "").toLowerCase();
        if (type && !SEEDANCE_25_IMAGE_MIME_TYPES.includes(type)) return `图片${index + 1}格式不受支持`;
        if (image.bytes && image.bytes > SEEDANCE_25_REFERENCE_LIMITS.imageMaxBytes) return `图片${index + 1}超过 30MB，请压缩后再上传`;
    }
    const videoError = seedance25ReferenceError(mode, videos);
    if (videoError) return videoError;
    let audioDurationMs = 0;
    for (let index = 0; index < audios.length; index += 1) {
        const audio = audios[index];
        const type = String(audio.type || "").toLowerCase();
        if (type && !SEEDANCE_25_AUDIO_MIME_TYPES.includes(type)) return `音频${index + 1}仅支持 mp3/wav 格式`;
        if (audio.bytes && audio.bytes > SEEDANCE_25_REFERENCE_LIMITS.audioMaxBytes) return `音频${index + 1}超过 15MB，请压缩后再上传`;
        if (audio.durationMs) {
            if (audio.durationMs < 2_000 || audio.durationMs > SEEDANCE_25_REFERENCE_LIMITS.mediaMaxDurationMs) return `音频${index + 1}时长需要在 2-30 秒之间`;
            audioDurationMs += audio.durationMs;
        }
    }
    if (audioDurationMs > SEEDANCE_25_REFERENCE_LIMITS.mediaTotalDurationMs) return "Seedance 2.5 参考音频总时长不能超过 30 秒";
    return "";
}

export function buildSeedance25TaskPrompt(prompt: string, mode: Seedance25TaskMode, continuation: Seedance25Continuation, seconds: number) {
    const instruction = prompt.trim();
    if (mode === "generate") return instruction;
    if (mode === "edit") {
        return `编辑视频：仅对 @视频1 执行下面的修改，保持未提及的画面、人物动作、运镜、声音与时间线不变。\n\n${instruction}`;
    }
    const duration = seconds === -1 ? "由模型判断合适的延长时长" : `续写 ${seconds} 秒`;
    const ending = continuation === "ending" ? "按描述中的结尾收束。" : "自然续写，不要重复原片已有内容。";
    return `向后延长 @视频1，${duration}。保持人物、运动、运镜、光线与声音连贯。${ending}\n\n${instruction}`;
}
