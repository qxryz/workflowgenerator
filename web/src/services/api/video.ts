import axios from "axios";
import { nanoid } from "nanoid";

import { dataUrlToFile } from "@/lib/image-utils";
import { isMiniMaxAdapter } from "@/lib/model-adapters";
import { getMediaBlob, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl } from "@/services/image-storage";
import { boolConfig, buildSeedancePromptText, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceVideoReferenceError, SEEDANCE_REFERENCE_LIMITS } from "@/lib/seedance-video";
import {
    buildSeedance25TaskPrompt,
    isSeedance25Model,
    normalizeSeedance25Continuation,
    normalizeSeedance25Duration,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    seedance25ImageRole,
    seedance25InputModeError,
    seedance25MultimodalReferenceError,
    SEEDANCE_25_REFERENCE_LIMITS,
} from "@/lib/seedance-2-5";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, resolveModelScript, type AiConfig } from "@/stores/use-config-store";
import { getDesktopModelJson, isDesktopApp, postDesktopModelJson } from "@/services/desktop-storage";
import { runModelPlugin } from "./model-plugin";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { persistGeneratedVideo } from "@/lib/video-result-persistence";
import {
    assertMiniMaxCredentialMatches,
    buildMiniMaxEndpoint,
    buildMiniMaxHailuoRequest,
    buildMiniMaxH3Request,
    isMiniMaxHailuoModel,
    miniMaxHailuoImageError,
    normalizeMiniMaxVideoInputMode,
    parseMiniMaxHailuoCreateResponse,
    parseMiniMaxHailuoFileResponse,
    parseMiniMaxHailuoQueryResponse,
    parseMiniMaxH3CreateResponse,
    parseMiniMaxH3QueryResponse,
    resolveMiniMaxVideoInputMode,
    type MiniMaxBillingMode,
    type MiniMaxHailuoFileResponse,
    type MiniMaxHailuoTaskResponse,
    type MiniMaxH3TaskResponse,
    type MiniMaxVideoInputMode,
} from "@/lib/minimax-contract";

type VideoResponse = {
    id: string;
    request_id?: string;
    status?: string;
    error?: { message?: string };
    url?: string;
    result_url?: string;
    video_url?: string;
    content?: { video_url?: string; url?: string } | null;
    video?: { url?: string; duration?: number } | null;
};
type ApiVideoResponse = VideoResponse | { code?: number | string; data?: VideoResponse | null; msg?: string; message?: string; error?: { message?: string } };
type SeedanceTask = {
    id: string;
    status?: "queued" | "running" | "succeeded" | "completed" | "failed" | "cancelled" | "expired";
    error?: { code?: string; message?: string } | null;
    content?: { video_url?: string; url?: string; last_frame_url?: string } | null;
    url?: string;
    result_url?: string;
    video_url?: string;
};
type ApiEnvelope<T> = T | { code?: number | string; data?: T | null; msg?: string; message?: string; error?: { message?: string } };
type RequestOptions = { signal?: AbortSignal };

export type VideoGenerationResult = { blob?: Blob; url?: string; mimeType?: string; lastFrameUrl?: string };
export type VideoGenerationTask = { id: string; provider: "openai" | "seedance" | "minimax" | "xai" | "agnes" | "plugin"; model: string };
export type VideoGenerationTaskState = { status: "pending" } | { status: "completed"; result: VideoGenerationResult } | { status: "failed"; error: string };

/** Results for scripted (plugin) video models, which run their own create+poll in one shot at task creation. */
const pluginVideoResults = new Map<string, VideoGenerationResult>();

function aiApiUrl(config: AiConfig, path: string) {
    return buildApiUrl(config.baseUrl, path);
}

function aiHeaders(config: AiConfig, contentType?: string) {
    return {
        Authorization: `Bearer ${config.apiKey}`,
        ...(contentType ? { "Content-Type": contentType } : {}),
    };
}

async function postVideoJson<T>(config: AiConfig, url: string, body: Record<string, unknown>, options?: RequestOptions) {
    if (isDesktopApp() && (config.apiFormat === "ark" || isMiniMaxAdapter((config as AiConfig & { adapter?: string }).adapter))) {
        const payload = await postDesktopModelJson<T>(url, config.apiKey, body);
        if (!payload) throw new Error("桌面原生模型请求不可用");
        return payload;
    }
    return (await axios.post<T>(url, body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data;
}

async function getVideoJson<T>(config: AiConfig, url: string, options?: RequestOptions) {
    if (isDesktopApp() && (config.apiFormat === "ark" || isMiniMaxAdapter((config as AiConfig & { adapter?: string }).adapter))) {
        const payload = await getDesktopModelJson<T>(url, config.apiKey);
        if (!payload) throw new Error("桌面原生模型请求不可用");
        return payload;
    }
    return (await axios.get<T>(url, { headers: aiHeaders(config), signal: options?.signal })).data;
}

export async function requestVideoGeneration(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationResult> {
    const task = await createVideoGenerationTask(config, prompt, references, videoReferences, audioReferences, options);
    const { delayMs, maxAttempts } = videoGenerationPollingPolicy(task);
    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        if (options?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
        const state = await pollVideoGenerationTask(config, task, options);
        if (state.status === "completed") return state.result;
        if (state.status === "failed") throw new Error(state.error);
        if (attempt === maxAttempts - 1) {
            const label =
                task.provider === "seedance" ? "Seedance" : task.provider === "minimax" ? (isMiniMaxHailuoModel(modelOptionName(task.model)) ? "MiniMax Hailuo" : "MiniMax H3") : task.provider === "xai" ? "Grok" : task.provider === "agnes" ? "Agnes" : "";
            const recoverable = task.provider === "minimax" ? `（任务 ID：${task.id}）` : "";
            throw new Error(`${label ? `${label} ` : ""}视频生成仍在处理${recoverable}，可稍后继续查询`);
        }
        await delay(delayMs, options?.signal);
    }
    throw new Error("视频生成超时，请稍后重试");
}

export function videoGenerationPollingPolicy(task: VideoGenerationTask) {
    if (task.provider === "minimax" && isMiniMaxHailuoModel(modelOptionName(task.model))) return { delayMs: 10_000, maxAttempts: 91 };
    if (task.provider === "minimax") return { delayMs: 5_000, maxAttempts: 181 };
    if (task.provider === "seedance" && isSeedance25Model(modelOptionName(task.model))) return { delayMs: 5_000, maxAttempts: 361 };
    return { delayMs: task.provider === "seedance" || task.provider === "xai" || task.provider === "agnes" ? 5_000 : 2_500, maxAttempts: 120 };
}

export async function createVideoGenerationTask(config: AiConfig, prompt: string, references: ReferenceImage[] = [], videoReferences: ReferenceVideo[] = [], audioReferences: ReferenceAudio[] = [], options?: RequestOptions): Promise<VideoGenerationTask> {
    const selectedModel = (config.model || config.videoModel).trim();
    const requestConfig = resolveModelRequestConfig(config, selectedModel);
    const script = resolveModelScript(config, selectedModel);
    if (script) return createPluginVideoTask(requestConfig, selectedModel, script, prompt, references, options);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (isMiniMaxAdapter(requestConfig.adapter)) {
        if (isMiniMaxHailuoModel(requestConfig.model)) return createMiniMaxHailuoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
        if (requestConfig.model.toLowerCase() === "minimax-h3") return createMiniMaxH3Task(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
        throw new Error("当前 MiniMax 视频模型尚未接入原生工作台");
    }
    if (requestConfig.apiFormat === "xai") return createXaiVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    if (requestConfig.apiFormat === "agnes") return createAgnesVideoTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    if (isSeedanceVideoConfig(requestConfig)) {
        return createSeedanceTask(requestConfig, selectedModel, prompt, references, videoReferences, audioReferences, options);
    }
    if (videoReferences.length || audioReferences.length) {
        throw new Error("当前视频接口不支持参考视频或参考音频，请切换到 Seedance 2.0 / 火山 Agent Plan 模型，或移除参考资产");
    }
    return createOpenAIVideoTask(requestConfig, selectedModel, prompt, references, options);
}

export async function pollVideoGenerationTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    if (task.provider === "plugin") {
        const result = pluginVideoResults.get(task.id);
        return result ? { status: "completed", result } : { status: "failed", error: "插件视频任务已失效，请重新生成" };
    }
    const requestConfig = resolveModelRequestConfig(config, task.model);
    assertVideoConfig(requestConfig, requestConfig.model);
    if (task.provider === "minimax") return isMiniMaxHailuoModel(requestConfig.model) ? pollMiniMaxHailuoTask(requestConfig, task, options) : pollMiniMaxH3Task(requestConfig, task, options);
    if (task.provider === "seedance") return pollSeedanceTask(requestConfig, task, options);
    if (task.provider === "xai") return pollXaiVideoTask(requestConfig, task, options);
    if (task.provider === "agnes") return pollAgnesVideoTask(requestConfig, task, options);
    return pollOpenAIVideoTask(requestConfig, task, options);
}

async function createPluginVideoTask(config: AiConfig, model: string, script: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    const refs = await Promise.all(references.map((image) => imageToDataUrl(image)));
    const result = videoPluginResult(
        await runModelPlugin({
            capability: "video",
            script,
            config,
            prompt,
            images: refs,
            params: {
                seconds: normalizeVideoSeconds(config.videoSeconds),
                size: normalizeVideoSize(config.size),
                resolution: normalizeVideoResolution(config.vquality),
                ratio: config.size,
                generateAudio: boolConfig(config.videoGenerateAudio, true),
                watermark: boolConfig(config.videoWatermark, false),
            },
            signal: options?.signal,
        }),
    );
    const id = nanoid();
    pluginVideoResults.set(id, result);
    return { id, provider: "plugin", model };
}

function videoPluginResult(result: unknown): VideoGenerationResult {
    if (result instanceof Blob) return { blob: result };
    if (typeof result === "string") return { url: result, mimeType: "video/mp4" };
    if (result && typeof result === "object") {
        const record = result as Record<string, unknown>;
        if (record.blob instanceof Blob) return { blob: record.blob };
        const url = [record.url, record.video_url, record.result_url].find((value) => typeof value === "string" && value) as string | undefined;
        if (url) return { url, mimeType: "video/mp4" };
    }
    throw new Error("模型调用脚本没有返回视频");
}

export async function storeGeneratedVideo(result: VideoGenerationResult): Promise<UploadedFile> {
    return persistGeneratedVideo(result, uploadMediaFile, isDesktopApp());
}

async function createOpenAIVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const body = new FormData();
    body.append("model", modelOptionName(model));
    body.append("prompt", prompt);
    body.append("seconds", normalizeVideoSeconds(config.videoSeconds));
    if (normalizeVideoSize(config.size)) body.append("size", normalizeVideoSize(config.size)!);
    body.append("resolution_name", normalizeVideoResolution(config.vquality));
    body.append("preset", "normal");
    const files = await Promise.all(references.slice(0, 7).map(async (image) => dataUrlToFile({ ...image, dataUrl: await imageToDataUrl(image) })));
    files.forEach((file) => body.append("input_reference[]", file));
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config), signal: options?.signal })).data);
        if (!created.id) throw new Error("视频接口没有返回任务 ID");
        return { id: created.id, provider: "openai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务创建失败"));
    }
}

async function pollOpenAIVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const video = unwrapVideoResponse((await axios.get<ApiVideoResponse>(aiApiUrl(config, `/videos/${task.id}`), { headers: aiHeaders(config), signal: options?.signal })).data);
        const url = videoResultUrl(video);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (video.status === "completed") {
            const content = await axios.get<Blob>(aiApiUrl(config, `/videos/${task.id}/content`), { headers: aiHeaders(config), responseType: "blob", signal: options?.signal });
            await assertVideoBlob(content.data);
            return { status: "completed", result: { blob: content.data } };
        }
        if (video.status === "failed" || video.status === "cancelled") return { status: "failed", error: readApiErrorMessage(video.error?.message) || "视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "视频任务查询失败"));
    }
}

async function createXaiVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (audioReferences.length) throw new Error("Grok 视频暂不支持参考音频");
    if (references.length && videoReferences.length) throw new Error("Grok 视频一次只能使用图片或视频其中一种参考素材");
    const body: Record<string, unknown> = {
        model: modelOptionName(model),
        prompt,
        duration: normalizeXaiDuration(config.videoSeconds),
        aspect_ratio: normalizeXaiRatio(config.size),
        resolution: normalizeXaiResolution(config.vquality, model, references.length > 0),
    };
    let path = "/videos/generations";
    if (videoReferences.length) {
        if (videoReferences.length > 1) throw new Error("Grok 视频编辑一次只能使用一个参考视频");
        path = "/videos/edits";
        body.video = { url: await resolvePortableVideoUrl(videoReferences[0]) };
        delete body.duration;
        delete body.aspect_ratio;
        delete body.resolution;
    } else if (references.length === 1) {
        body.image = { url: await imageToDataUrl(references[0]) };
    } else if (references.length > 1) {
        body.reference_images = await Promise.all(references.slice(0, 3).map(async (image) => ({ url: await imageToDataUrl(image) })));
    }
    try {
        const payload = (await axios.post<VideoResponse>(aiApiUrl(config, path), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data;
        const id = payload.request_id || payload.id;
        if (!id) throw new Error("Grok 视频接口没有返回任务 ID");
        return { id, provider: "xai", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Grok 视频任务创建失败"));
    }
}

async function pollXaiVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = (await axios.get<VideoResponse>(aiApiUrl(config, `/videos/${encodeURIComponent(task.id)}`), { headers: aiHeaders(config), signal: options?.signal })).data;
        const url = state.video?.url || videoResultUrl(state);
        if (state.status === "done" && url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "failed" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error) || `Grok 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Grok 视频任务查询失败"));
    }
}

async function createAgnesVideoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    if (videoReferences.length || audioReferences.length) throw new Error("Agnes Video V2.0 当前仅支持文字或一张首帧图片");
    const dimensions = videoDimensions(config.size);
    const duration = Math.max(3, Math.min(18, Math.floor(Number(config.videoSeconds) || 6)));
    const body: Record<string, unknown> = {
        model: modelOptionName(model),
        prompt,
        width: dimensions.width,
        height: dimensions.height,
        // Agnes Video 要求 num_frames 满足 8*n+1，把期望帧数向上对齐到最近的有效值。
        num_frames: 8 * Math.max(1, Math.ceil((duration * 24 - 1) / 8)) + 1,
        frame_rate: 24,
    };
    if (references[0]) body.image = await imageToDataUrl(references[0]);
    try {
        const created = unwrapVideoResponse((await axios.post<ApiVideoResponse>(aiApiUrl(config, "/videos"), body, { headers: aiHeaders(config, "application/json"), signal: options?.signal })).data);
        if (!created.id) throw new Error("Agnes 视频接口没有返回任务 ID");
        return { id: created.id, provider: "agnes", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Agnes 视频任务创建失败"));
    }
}

async function pollAgnesVideoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const baseUrl = config.baseUrl.trim().replace(/\/+$/, "").replace(/\/v1$/i, "");
        const state = unwrapVideoResponse(
            (
                await axios.get<ApiVideoResponse>(`${baseUrl}/agnesapi`, {
                    params: { video_id: task.id, model_name: modelOptionName(task.model) },
                    headers: aiHeaders(config),
                    signal: options?.signal,
                })
            ).data,
        );
        const url = videoResultUrl(state);
        if (url) return { status: "completed", result: await videoResultFromUrl(url, options) };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error) || "Agnes 视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Agnes 视频任务查询失败"));
    }
}

export function inferMiniMaxVideoInputMode(imageCount: number, videoCount: number, audioCount: number): MiniMaxVideoInputMode {
    return resolveMiniMaxVideoInputMode("auto", { images: imageCount, videos: videoCount, audios: audioCount });
}

async function createMiniMaxHailuoTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    assertMiniMaxCredentialMatches(miniMaxBillingMode(config), config.apiKey);
    assertMiniMaxHailuoReferences(modelOptionName(model), references, videoReferences, audioReferences);
    const firstFrameImage = references[0] ? await imageToDataUrl(references[0]) : undefined;
    if (references[0] && !firstFrameImage) throw new Error("MiniMax Hailuo 首帧图片读取失败，请重新上传");
    const body = buildMiniMaxHailuoRequest(modelOptionName(model), {
        prompt,
        firstFrameImage,
        resolution: config.vquality,
        duration: Number(config.videoSeconds),
        promptOptimizer: boolConfig(config.minimaxVideoPromptOptimizer, true),
        fastPretreatment: boolConfig(config.minimaxVideoFastPretreatment, false),
        watermark: boolConfig(config.videoWatermark, false),
    });
    try {
        const payload = await postVideoJson<MiniMaxHailuoTaskResponse>(config, buildMiniMaxEndpoint(config.baseUrl, "video-hailuo"), body, options);
        return { id: parseMiniMaxHailuoCreateResponse(payload), provider: "minimax", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax Hailuo 任务创建失败"));
    }
}

async function pollMiniMaxHailuoTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    assertMiniMaxCredentialMatches(miniMaxBillingMode(config), config.apiKey);
    try {
        const queryPayload = await getVideoJson<MiniMaxHailuoTaskResponse>(config, buildMiniMaxEndpoint(config.baseUrl, "video-hailuo-query", task.id), options);
        const state = parseMiniMaxHailuoQueryResponse(queryPayload);
        if (state.status === "failed") return state;
        if (state.status === "pending") return state;
        const filePayload = await getVideoJson<MiniMaxHailuoFileResponse>(config, buildMiniMaxEndpoint(config.baseUrl, "video-retrieve", state.fileId), options);
        return { status: "completed", result: await videoResultFromUrl(parseMiniMaxHailuoFileResponse(filePayload), options) };
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax Hailuo 任务查询失败"));
    }
}

export function miniMaxHailuoReferenceError(model: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if (videoReferences.length || audioReferences.length) return "MiniMax Hailuo 2.3 仅支持一张首帧图片，不支持参考视频或音频";
    if (references.length > 1) return "MiniMax Hailuo 2.3 最多支持一张首帧图片";
    if (model.trim().toLowerCase() === "minimax-hailuo-2.3-fast" && references.length !== 1) return "MiniMax Hailuo 2.3 Fast 需要一张首帧图片";
    const image = references[0];
    if (!image) return "";
    return miniMaxHailuoImageError({
        mimeType: miniMaxReferenceImageMime(image),
        bytes: image.bytes || reliableDataUrlBytes(image.dataUrl) || undefined,
        width: image.width,
        height: image.height,
    });
}

function assertMiniMaxHailuoReferences(model: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const error = miniMaxHailuoReferenceError(model, references, videoReferences, audioReferences);
    if (error) throw new Error(error);
}

async function createMiniMaxH3Task(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    assertMiniMaxCredentialMatches(miniMaxBillingMode(config), config.apiKey);
    assertMiniMaxH3References(references, videoReferences, audioReferences);
    const mode = normalizeMiniMaxVideoInputMode(config.minimaxVideoInputMode);
    const [images, videos, audios] = await Promise.all([Promise.all(references.map((image) => imageToDataUrl(image))), Promise.all(videoReferences.map(resolvePortableVideoUrl)), Promise.all(audioReferences.map(resolvePortableAudioUrl))]);
    const body = buildMiniMaxH3Request(modelOptionName(model), {
        prompt,
        mode,
        images,
        videos,
        audios,
        resolution: config.vquality,
        duration: Number(config.videoSeconds),
        ratio: config.size,
        watermark: boolConfig(config.videoWatermark, false),
    });
    if (new Blob([JSON.stringify(body)]).size > 64 * 1024 * 1024) throw new Error("MiniMax H3 请求内容不能超过 64MB，请减少或压缩参考素材");
    try {
        const payload = await postVideoJson<MiniMaxH3TaskResponse>(config, buildMiniMaxEndpoint(config.baseUrl, "video-h3"), body, options);
        return { id: parseMiniMaxH3CreateResponse(payload), provider: "minimax", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax H3 任务创建失败"));
    }
}

async function pollMiniMaxH3Task(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    assertMiniMaxCredentialMatches(miniMaxBillingMode(config), config.apiKey);
    try {
        const payload = await getVideoJson<MiniMaxH3TaskResponse>(config, buildMiniMaxEndpoint(config.baseUrl, "video-query", task.id), options);
        const state = parseMiniMaxH3QueryResponse(payload);
        if (state.status === "completed" && state.url) return { status: "completed", result: await videoResultFromUrl(state.url, options) };
        if (state.status === "failed") return { status: "failed", error: state.error || "MiniMax H3 视频生成失败" };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "MiniMax H3 任务查询失败"));
    }
}

function miniMaxBillingMode(config: AiConfig) {
    return ((config as AiConfig & { minimaxBillingMode?: MiniMaxBillingMode }).minimaxBillingMode || "payg") as MiniMaxBillingMode;
}

export const MINIMAX_H3_REFERENCE_LIMITS = {
    images: 9,
    videos: 3,
    audios: 3,
    imageMaxBytes: 30 * 1024 * 1024,
    videoMaxBytes: 50 * 1024 * 1024,
    audioMaxBytes: 15 * 1024 * 1024,
} as const;

export function isMiniMaxH3ImageMime(value: string) {
    return ["image/jpeg", "image/jpg", "image/png", "image/webp"].includes(value.trim().toLowerCase());
}

export function miniMaxH3ReferenceError(references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    if (references.length > MINIMAX_H3_REFERENCE_LIMITS.images) return "MiniMax H3 最多支持 9 张参考图";
    if (videoReferences.length > MINIMAX_H3_REFERENCE_LIMITS.videos) return "MiniMax H3 最多支持 3 个参考视频";
    if (audioReferences.length > MINIMAX_H3_REFERENCE_LIMITS.audios) return "MiniMax H3 最多支持 3 个参考音频";
    for (let index = 0; index < references.length; index += 1) {
        const image = references[index];
        const mimeType = miniMaxReferenceImageMime(image);
        if (mimeType && !isMiniMaxH3ImageMime(mimeType)) return `图片${index + 1}仅支持 JPEG、PNG 或 WebP 格式`;
        const bytes = image.bytes || reliableDataUrlBytes(image.dataUrl);
        if (bytes > MINIMAX_H3_REFERENCE_LIMITS.imageMaxBytes) return `图片${index + 1}超过 30MB，请压缩后再上传`;
    }
    let videoDuration = 0;
    for (let index = 0; index < videoReferences.length; index += 1) {
        const video = videoReferences[index];
        if ((video.bytes || reliableDataUrlBytes(video.url)) > MINIMAX_H3_REFERENCE_LIMITS.videoMaxBytes) return `视频${index + 1}超过 50MB，请压缩后再上传`;
        if (video.durationMs && (video.durationMs < 2000 || video.durationMs > 15_000)) return `视频${index + 1}时长需要在 2-15 秒之间`;
        videoDuration += video.durationMs || 0;
    }
    if (videoDuration > 15_000) return "MiniMax H3 参考视频总时长不能超过 15 秒";
    let audioDuration = 0;
    for (let index = 0; index < audioReferences.length; index += 1) {
        const audio = audioReferences[index];
        if ((audio.bytes || reliableDataUrlBytes(audio.url)) > MINIMAX_H3_REFERENCE_LIMITS.audioMaxBytes) return `音频${index + 1}超过 15MB，请压缩后再上传`;
        if (audio.durationMs && (audio.durationMs < 2000 || audio.durationMs > 15_000)) return `音频${index + 1}时长需要在 2-15 秒之间`;
        audioDuration += audio.durationMs || 0;
    }
    if (audioDuration > 15_000) return "MiniMax H3 参考音频总时长不能超过 15 秒";
    return "";
}

function assertMiniMaxH3References(references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[]) {
    const error = miniMaxH3ReferenceError(references, videoReferences, audioReferences);
    if (error) throw new Error(error);
}

function miniMaxReferenceImageMime(image: ReferenceImage) {
    const declared = image.type.trim().toLowerCase();
    if (declared) return declared;
    return image.dataUrl.match(/^data:([^;,]+)/i)?.[1]?.toLowerCase() || "";
}

/** Only data URLs expose a reliable encoded byte count without a network read. */
function reliableDataUrlBytes(value: string) {
    const match = value.match(/^data:[^;,]+;base64,([a-z\d+/=\s]+)$/i);
    if (!match) return 0;
    const body = match[1].replace(/\s/g, "");
    return Math.max(0, Math.floor((body.length * 3) / 4) - (body.endsWith("==") ? 2 : body.endsWith("=") ? 1 : 0));
}

async function createSeedanceTask(config: AiConfig, model: string, prompt: string, references: ReferenceImage[], videoReferences: ReferenceVideo[], audioReferences: ReferenceAudio[], options?: RequestOptions): Promise<VideoGenerationTask> {
    const seedance25 = isSeedance25Model(modelOptionName(model));
    const taskMode = normalizeSeedance25TaskMode(config.seedance25TaskMode);
    const continuation = normalizeSeedance25Continuation(config.seedance25Continuation);
    const inputMode = taskMode === "generate" ? normalizeSeedance25InputMode(config.seedance25InputMode) : "reference";
    const duration = seedance25 ? normalizeSeedance25Duration(config.videoSeconds, taskMode) : normalizeSeedanceDuration(config.videoSeconds);
    if (!seedance25 && audioReferences.length && !references.length && !videoReferences.length) {
        throw new Error("Seedance 参考音频不能单独使用，请同时添加参考图或参考视频");
    }
    if (seedance25) {
        const error = seedance25MultimodalReferenceError(taskMode, references, videoReferences, audioReferences);
        if (error) throw new Error(error);
        const inputModeError = seedance25InputModeError(taskMode, inputMode, { images: references.length, videos: videoReferences.length, audios: audioReferences.length });
        if (inputModeError) throw new Error(inputModeError);
    } else {
        assertSeedanceVideoReferences(videoReferences);
        assertSeedanceAudioReferences(audioReferences);
    }
    const taskPrompt = seedance25 ? buildSeedance25TaskPrompt(prompt, taskMode, continuation, duration) : prompt;
    const content = await buildSeedanceContent(config, taskPrompt, references, videoReferences, audioReferences, seedance25, inputMode);
    if (!content.length) throw new Error("请输入视频提示词，或连接参考图片/视频/音频");
    const outputFormat = normalizeSeedance25OutputFormat(config.seedance25OutputFormat);
    const hasReferences = references.length + videoReferences.length + audioReferences.length > 0;
    const pureTextGeneration = seedance25 && taskMode === "generate" && !hasReferences;
    const webSearch = boolConfig(config.seedance25WebSearch, false);
    const cameraFixed = boolConfig(config.seedance25CameraFixed, false);
    if (seedance25 && webSearch && !pureTextGeneration) throw new Error("联网搜索只能用于纯文字生成，请先移除参考素材");
    if (seedance25 && cameraFixed && !pureTextGeneration) throw new Error("固定机位只能用于纯文字生成，请先移除参考素材");
    const payload: Record<string, unknown> = {
        model: modelOptionName(model),
        content,
        ratio: seedance25 && (taskMode !== "generate" || inputMode !== "reference") ? "adaptive" : normalizeSeedanceRatio(config.size),
        resolution: seedance25 ? (normalizeSeedanceResolution(config.vquality) === "480p" ? "480p" : "720p") : normalizeSeedanceResolution(config.vquality),
        duration,
        ...(seedance25
            ? {
                  output_format: outputFormat,
                  seed: normalizeSeedance25Seed(config.seedance25Seed),
                  return_last_frame: boolConfig(config.seedance25ReturnLastFrame, true),
                  ...(webSearch ? { tools: [{ type: "web_search" }] } : {}),
                  ...(cameraFixed ? { camera_fixed: true } : {}),
              }
            : {}),
        generate_audio: boolConfig(config.videoGenerateAudio, true),
        watermark: boolConfig(config.videoWatermark, false),
    };
    if (seedance25 && new TextEncoder().encode(JSON.stringify(payload)).byteLength > 64 * 1024 * 1024) {
        throw new Error("Seedance 2.5 请求内容不能超过 64MB，请减少素材或改用公网 URL / 方舟素材 ID");
    }

    try {
        const created = unwrapSeedanceTask(await postVideoJson<ApiEnvelope<SeedanceTask>>(config, seedanceApiUrl(config), payload, options));
        if (!created.id) throw new Error("Seedance 接口没有返回任务 ID");
        return { id: created.id, provider: "seedance", model };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务创建失败"));
    }
}

async function pollSeedanceTask(config: AiConfig, task: VideoGenerationTask, options?: RequestOptions): Promise<VideoGenerationTaskState> {
    try {
        const state = unwrapSeedanceTask(await getVideoJson<ApiEnvelope<SeedanceTask>>(config, seedanceApiUrl(config, task.id), options));
        const url = videoResultUrl(state);
        const outputFormat = normalizeSeedance25OutputFormat(config.seedance25OutputFormat);
        if (url) {
            const result = await videoResultFromUrl(url, options, outputFormat === "mov" ? "video/quicktime" : "video/mp4");
            return { status: "completed", result: { ...result, lastFrameUrl: state.content?.last_frame_url } };
        }
        if (state.status === "succeeded" || state.status === "completed") return { status: "failed", error: "Seedance 任务成功但没有返回视频 URL" };
        if (state.status === "failed" || state.status === "cancelled" || state.status === "expired") return { status: "failed", error: readApiErrorMessage(state.error?.message) || `Seedance 视频生成${state.status === "expired" ? "超时" : "失败"}` };
        return { status: "pending" };
    } catch (error) {
        throw new Error(readAxiosError(error, "Seedance 任务查询失败"));
    }
}

function assertSeedanceVideoReferences(videoReferences: ReferenceVideo[]) {
    const error = seedanceVideoReferenceError(videoReferences);
    if (error) throw new Error(error);
    let total = 0;
    for (const video of videoReferences) {
        if (!video.durationMs) continue;
        if (video.durationMs < 2000 || video.durationMs > 15000) throw new Error("Seedance 参考视频单个时长需要在 2-15 秒之间");
        total += video.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考视频总时长不能超过 15 秒");
}

function assertSeedanceAudioReferences(audioReferences: ReferenceAudio[]) {
    let total = 0;
    for (const audio of audioReferences) {
        if (!audio.durationMs) continue;
        if (audio.durationMs < 2000 || audio.durationMs > 15000) throw new Error("Seedance 参考音频单个时长需要在 2-15 秒之间");
        total += audio.durationMs;
    }
    if (total > 15000) throw new Error("Seedance 参考音频总时长不能超过 15 秒");
}

function seedanceApiUrl(config: AiConfig, taskId?: string) {
    return buildApiUrl(config.baseUrl, `/contents/generations/tasks${taskId ? `/${encodeURIComponent(taskId)}` : ""}`);
}

async function buildSeedanceContent(
    config: AiConfig,
    prompt: string,
    references: ReferenceImage[],
    videoReferences: ReferenceVideo[],
    audioReferences: ReferenceAudio[],
    seedance25 = false,
    inputMode = normalizeSeedance25InputMode(config.seedance25InputMode),
) {
    const content: Array<Record<string, unknown>> = [];
    const text = buildSeedancePromptText(prompt, references, videoReferences, audioReferences);
    if (text) content.push({ type: "text", text });
    const limits = seedance25 ? SEEDANCE_25_REFERENCE_LIMITS : SEEDANCE_REFERENCE_LIMITS;
    for (const [index, image] of references.slice(0, limits.images).entries()) {
        content.push({ type: "image_url", image_url: { url: await resolveSeedanceImageUrl(config, image) }, role: seedance25 ? seedance25ImageRole(inputMode, index) : "reference_image" });
    }
    for (const video of videoReferences.slice(0, limits.videos)) {
        content.push({ type: "video_url", video_url: { url: await resolveSeedanceVideoUrl(video, seedance25) }, role: "reference_video" });
    }
    for (const audio of audioReferences.slice(0, limits.audios)) {
        content.push({ type: "audio_url", audio_url: { url: await resolveSeedanceAudioUrl(audio) }, role: "reference_audio" });
    }
    return content;
}

async function resolveSeedanceImageUrl(config: AiConfig, image: ReferenceImage) {
    const directUrl = image.url || image.dataUrl;
    if (isPublicMediaUrl(directUrl) || directUrl.startsWith("asset://")) return directUrl;
    const dataUrl = await imageToDataUrl(image);
    if (!dataUrl) throw new Error("参考图读取失败，请换一张图片或重新上传");
    return dataUrl;
}

async function resolveSeedanceVideoUrl(video: ReferenceVideo, requireRemoteReference = false) {
    if (isPublicMediaUrl(video.url) || video.url.startsWith("asset://")) return video.url;
    if (requireRemoteReference) throw new Error("Seedance 2.5 参考视频请使用公网 URL 或方舟素材 ID；官方接口不接受本机视频 Base64");
    let blob: Blob | null = null;
    if (video.storageKey) blob = await getMediaBlob(video.storageKey);
    if (!blob && video.url?.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频必须是公网 URL、资产 ID，或本地已保存的视频");
    return blobToDataUrl(blob);
}

async function resolveSeedanceAudioUrl(audio: ReferenceAudio) {
    if (isPublicMediaUrl(audio.url) || audio.url.startsWith("asset://")) return audio.url;
    let blob: Blob | null = null;
    if (audio.storageKey) blob = await getMediaBlob(audio.storageKey);
    if (!blob && audio.url?.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频必须是公网 URL、资产 ID，或本地已保存的音频");
    return blobToDataUrl(blob);
}

async function videoResultFromUrl(url: string, options?: RequestOptions, fallbackMimeType = "video/mp4"): Promise<VideoGenerationResult> {
    try {
        const response = await axios.get<Blob>(url, { responseType: "blob", signal: options?.signal });
        await assertVideoBlob(response.data);
        return { blob: response.data, url, mimeType: response.data.type || fallbackMimeType };
    } catch (error) {
        if (axios.isCancel(error) || options?.signal?.aborted) throw error;
        return { url, mimeType: fallbackMimeType };
    }
}

function assertVideoConfig(config: AiConfig, model: string) {
    if (!model) throw new Error("请先配置视频模型");
    if (!config.baseUrl.trim()) throw new Error("请先配置 Base URL");
    if (!config.apiKey.trim()) throw new Error("请先配置 API Key");
    if (config.apiFormat === "gemini") throw new Error("Gemini 调用格式暂不支持视频生成，请使用 OpenAI 格式渠道");
}

function normalizeVideoSeconds(value: string) {
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    if (value === "auto") return null;
    const size = value || "1280x720";
    if (/^\d+x\d+$/.test(size)) return size;
    return ["9:16", "2:3", "3:4"].includes(size) ? "720x1280" : "1280x720";
}

function normalizeVideoResolution(value: string) {
    if (value === "low") return "480p";
    if (value === "auto" || value === "high" || value === "medium" || /k$/i.test(value)) return "720p";
    const resolution = value.replace(/p$/i, "") || "720";
    return `${resolution}p`;
}

function unwrapVideoResponse(payload: ApiVideoResponse) {
    return unwrapEnvelope(payload, "接口没有返回视频任务");
}

function unwrapSeedanceTask(payload: ApiEnvelope<SeedanceTask>) {
    return unwrapEnvelope(payload, "Seedance 接口没有返回任务");
}

function unwrapEnvelope<T>(payload: ApiEnvelope<T>, emptyMessage: string): T {
    if (!payload) throw new Error(emptyMessage);
    if (typeof payload === "object" && "code" in payload && payload.code !== undefined) {
        if (payload.code !== 0 && payload.code !== "0") throw new Error(readApiErrorMessage(payload) || "请求失败");
        if (!payload.data) throw new Error(emptyMessage);
        return payload.data;
    }
    return payload as T;
}

function videoResultUrl(payload: VideoResponse | SeedanceTask) {
    return ["video" in payload ? payload.video?.url : undefined, payload.video_url, payload.result_url, payload.url, payload.content?.video_url, payload.content?.url].find(
        (url) => typeof url === "string" && (isPublicMediaUrl(url) || /\.mp4(\?|#|$)/i.test(url)),
    );
}

function normalizeXaiDuration(value: string) {
    return Math.max(1, Math.min(15, Math.floor(Number(value) || 6)));
}

function normalizeXaiRatio(value: string) {
    const supported = ["1:1", "16:9", "9:16", "4:3", "3:4", "3:2", "2:3"];
    if (supported.includes(value)) return value;
    if (/^\d+x\d+$/.test(value)) {
        const [width, height] = value.split("x").map(Number);
        const target = width / height;
        return supported.reduce((best, item) => {
            const [w, h] = item.split(":").map(Number);
            const [bw, bh] = best.split(":").map(Number);
            return Math.abs(w / h - target) < Math.abs(bw / bh - target) ? item : best;
        }, "16:9");
    }
    return "16:9";
}

function normalizeXaiResolution(value: string, model: string, hasImage: boolean) {
    const normalized = normalizeVideoResolution(value);
    if (normalized === "1080p" && modelOptionName(model).includes("1.5") && hasImage) return "1080p";
    return normalized === "720p" ? "720p" : "480p";
}

function videoDimensions(value: string) {
    const match = value.match(/^(\d+)x(\d+)$/);
    if (match) return { width: Number(match[1]), height: Number(match[2]) };
    if (["9:16", "2:3", "3:4"].includes(value)) return { width: 720, height: 1280 };
    if (value === "1:1") return { width: 1024, height: 1024 };
    return { width: 1280, height: 720 };
}

async function resolvePortableVideoUrl(video: ReferenceVideo) {
    if (/^(?:https?:|data:)/i.test(video.url)) return video.url;
    let blob: Blob | null = video.storageKey ? await getMediaBlob(video.storageKey) : null;
    if (!blob && video.url.startsWith("blob:")) blob = await (await fetch(video.url)).blob();
    if (!blob) throw new Error("参考视频读取失败，请重新上传");
    return blobToDataUrl(blob);
}

async function resolvePortableAudioUrl(audio: ReferenceAudio) {
    if (/^(?:https?:|data:)/i.test(audio.url)) return audio.url;
    let blob: Blob | null = audio.storageKey ? await getMediaBlob(audio.storageKey) : null;
    if (!blob && audio.url.startsWith("blob:")) blob = await (await fetch(audio.url)).blob();
    if (!blob) throw new Error("参考音频读取失败，请重新上传");
    return blobToDataUrl(blob);
}

function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return `服务返回了 HTML 错误页面（${value.slice(0, 80)}...）`;
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; error?: unknown; detail?: unknown };
    // error 可能是字符串或含 message 的对象
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}

function readAxiosError(error: unknown, fallback: string) {
    if (typeof error === "string") return readApiErrorMessage(error) || error;
    if (axios.isCancel(error)) return "请求已取消";
    if (axios.isAxiosError<{ error?: { message?: string }; msg?: string; message?: string; code?: number | string }>(error)) {
        const responseData = error.response?.data;
        return readApiErrorMessage(responseData) || statusMessage(error.response?.status, fallback);
    }
    if (error instanceof DOMException && error.name === "AbortError") return "请求已取消";
    return error instanceof Error ? readApiErrorMessage(error.message) || error.message : fallback;
}

function statusMessage(status: number | undefined, fallback: string) {
    if (status === 401 || status === 403) return "鉴权失败，请检查 API Key、套餐权限或模型权限";
    if (status === 429) return "请求被限流或额度不足，请稍后重试";
    return status ? `${fallback}（${status}）` : fallback;
}

async function assertVideoBlob(blob: Blob) {
    if (!blob.type.includes("json")) return;
    let payload: { code?: number; msg?: string; error?: { message?: string } };
    try {
        payload = JSON.parse(await blob.text()) as { code?: number; msg?: string; error?: { message?: string } };
    } catch {
        return;
    }
    if (typeof payload.code === "number" && payload.code !== 0) throw new Error(readApiErrorMessage(payload) || "视频下载失败");
    if (payload.error?.message) throw new Error(readApiErrorMessage(payload.error.message) || payload.error.message);
}

function isPublicMediaUrl(value: string) {
    return /^https?:\/\//i.test(value || "");
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timer = setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                clearTimeout(timer);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取本地资产失败"));
        reader.readAsDataURL(blob);
    });
}
