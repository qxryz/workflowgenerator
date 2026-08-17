import axios from "axios";

import {
    assertMiniMaxCloneDurationSeconds,
    assertMiniMaxCredentialMatches,
    assertMiniMaxResponse,
    buildMiniMaxEndpoint,
    buildMiniMaxSpeechRequest,
    buildMiniMaxVoiceCloneRequest,
    normalizeMiniMaxVoiceId,
    parseMiniMaxFileId,
    parseMiniMaxSpeechResponse,
    type MiniMaxSpeechInput,
} from "@/lib/minimax-contract";
import { isDesktopApp, postDesktopModelJson, postDesktopModelMultipart, postDesktopModelRawJson } from "@/services/desktop-storage";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import type { QwenAudioTask } from "@/lib/qwen-audio-contract";

const MINIMAX_AUDIO_MODELS = new Set(["speech-2.8-hd", "speech-2.8-turbo"]);
const MINIMAX_CLONE_MAX_BYTES = 20 * 1024 * 1024;

type MiniMaxAudioRequest = ReturnType<typeof resolveModelRequestConfig> & {
    minimaxBillingMode?: "token-plan" | "payg";
};

type MiniMaxVoiceCloneInput = {
    file: File;
    voiceId: string;
    previewText?: string;
    watermark?: boolean;
};

type MiniMaxVoiceCloneResponse = {
    demo_audio?: string;
    base_resp?: { status_code?: number; status_msg?: string };
};

export function isMiniMaxAudioModelForTask(modelValue: string, task: QwenAudioTask) {
    if (task === "transcription") return false;
    return MINIMAX_AUDIO_MODELS.has(modelOptionName(modelValue).toLowerCase());
}

export function assertMiniMaxCloneAudioFile(file: File) {
    if (file.size > MINIMAX_CLONE_MAX_BYTES) throw new Error("MiniMax 声音样本不能超过 20 MB");
    const allowedMime = ["audio/wav", "audio/x-wav", "audio/mpeg", "audio/mp3", "audio/mp4", "audio/x-m4a"];
    if (!/\.(?:wav|mp3|m4a)$/i.test(file.name) && !allowedMime.includes(file.type.toLowerCase())) {
        throw new Error("MiniMax 声音复刻支持 WAV、MP3 或 M4A 音频");
    }
}

export async function assertMiniMaxCloneAudioDuration(file: File, readDuration: (file: File) => Promise<number> = readAudioDuration) {
    let duration: number;
    try {
        duration = await readDuration(file);
    } catch {
        throw new Error("无法读取声音样本时长，请换一个有效的音频文件");
    }
    assertMiniMaxCloneDurationSeconds(duration);
}

export async function requestMiniMaxSpeech(config: AiConfig, modelValue: string, input: MiniMaxSpeechInput, signal?: AbortSignal) {
    const request = resolveMiniMaxRequest(config, modelValue);
    const format = input.format || "mp3";
    const payload = buildMiniMaxSpeechRequest(request.model || "speech-2.8-hd", input);
    const result = await postMiniMaxJson<Record<string, unknown>>(request, buildMiniMaxEndpoint(request.baseUrl, "speech"), payload, signal);
    return parseMiniMaxSpeechResponse(result, format);
}

export async function requestMiniMaxVoiceClone(config: AiConfig, modelValue: string, input: MiniMaxVoiceCloneInput, signal?: AbortSignal) {
    const request = resolveMiniMaxRequest(config, modelValue);
    assertMiniMaxCloneAudioFile(input.file);
    if ((input.previewText?.trim().length || 0) > 1000) throw new Error("MiniMax 试听文本不能超过 1000 个字符");
    const voiceId = normalizeMiniMaxVoiceId(input.voiceId);
    const upload = await postMiniMaxUpload(request, input.file, signal);
    const fileId = parseMiniMaxFileId(upload);
    const body = buildMiniMaxVoiceCloneRequest(fileId, voiceId, request.model || "speech-2.8-hd", input.previewText, input.watermark);
    const result = await postMiniMaxRawJson<MiniMaxVoiceCloneResponse>(request, buildMiniMaxEndpoint(request.baseUrl, "voice-clone"), body, signal);
    assertMiniMaxResponse(result);
    return { voice: voiceId, previewUrl: result.demo_audio?.trim() || undefined };
}

function resolveMiniMaxRequest(config: AiConfig, modelValue: string) {
    const request = resolveModelRequestConfig(config, modelValue) as MiniMaxAudioRequest;
    if (request.apiFormat !== "minimax") throw new Error("当前模型没有使用 MiniMax 原生线路");
    const mode = request.minimaxBillingMode || "payg";
    assertMiniMaxCredentialMatches(mode, request.apiKey);
    if (!request.baseUrl.trim()) throw new Error(`请先配置 MiniMax ${mode === "token-plan" ? "Token Plan" : "API 计费"}线路地址`);
    if (!request.apiKey.trim()) throw new Error(`请先配置 MiniMax ${mode === "token-plan" ? "Token Plan Key" : "API Key"}`);
    return request;
}

async function postMiniMaxJson<T extends { base_resp?: { status_code?: number; status_msg?: string } }>(request: MiniMaxAudioRequest, url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    assertNotAborted(signal);
    try {
        if (isDesktopApp()) {
            const result = await postDesktopModelJson<T>(url, request.apiKey, body);
            if (!result) throw new Error("桌面请求没有返回结果");
            return result;
        }
        return (
            await axios.post<T>(url, body, {
                headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
                signal,
            })
        ).data;
    } catch (error) {
        throw normalizeMiniMaxAudioError(error);
    }
}

async function postMiniMaxUpload(request: MiniMaxAudioRequest, file: File, signal?: AbortSignal) {
    assertNotAborted(signal);
    const url = buildMiniMaxEndpoint(request.baseUrl, "file-upload");
    try {
        if (isDesktopApp()) {
            const result = await postDesktopModelMultipart(
                url,
                request.apiKey,
                {
                    fieldName: "file",
                    fileName: file.name,
                    mimeType: file.type || mimeTypeForName(file.name),
                    dataBase64: await fileToBase64(file),
                },
                { purpose: "voice_clone" },
            );
            if (!result) throw new Error("桌面请求没有返回结果");
            return result;
        }
        const form = new FormData();
        form.append("purpose", "voice_clone");
        form.append("file", file, file.name);
        return (
            await axios.post<string>(url, form, {
                headers: { Authorization: `Bearer ${request.apiKey}` },
                responseType: "text",
                transformResponse: [(value) => value],
                signal,
            })
        ).data;
    } catch (error) {
        throw normalizeMiniMaxAudioError(error);
    }
}

async function postMiniMaxRawJson<T extends { base_resp?: { status_code?: number; status_msg?: string } }>(request: MiniMaxAudioRequest, url: string, body: string, signal?: AbortSignal): Promise<T> {
    assertNotAborted(signal);
    try {
        const raw = isDesktopApp()
            ? await postDesktopModelRawJson(url, request.apiKey, body)
            : (
                  await axios.post<string>(url, body, {
                      headers: { Authorization: `Bearer ${request.apiKey}`, "Content-Type": "application/json" },
                      responseType: "text",
                      transformResponse: [(value) => value],
                      signal,
                  })
              ).data;
        if (!raw) throw new Error("模型请求没有返回结果");
        try {
            return JSON.parse(raw) as T;
        } catch {
            throw new Error("MiniMax 接口返回的 JSON 无效");
        }
    } catch (error) {
        throw normalizeMiniMaxAudioError(error);
    }
}

function assertNotAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw new Error("请求已取消");
}

function normalizeMiniMaxAudioError(error: unknown) {
    if (axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError")) return new Error("请求已取消");
    if (axios.isAxiosError(error)) {
        const responseData = error.response?.data;
        let data: { base_resp?: { status_msg?: string }; message?: string; msg?: string; error?: { message?: string } } | undefined;
        try {
            data = typeof responseData === "string" ? (JSON.parse(responseData) as typeof data) : (responseData as typeof data);
        } catch {
            data = undefined;
        }
        return new Error(data?.base_resp?.status_msg || data?.error?.message || data?.message || data?.msg || `MiniMax 音频请求失败${error.response?.status ? `（HTTP ${error.response.status}）` : ""}`);
    }
    if (typeof error === "string" && error.trim()) return new Error(error.trim());
    return error instanceof Error ? error : new Error("MiniMax 音频请求失败");
}

function fileToBase64(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const value = String(reader.result || "");
            resolve(value.includes(",") ? value.slice(value.indexOf(",") + 1) : value);
        };
        reader.onerror = () => reject(new Error("无法读取声音样本"));
        reader.readAsDataURL(file);
    });
}

function readAudioDuration(file: File) {
    return new Promise<number>((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio();
        const finish = (duration?: number) => {
            audio.onloadedmetadata = null;
            audio.onerror = null;
            audio.removeAttribute("src");
            URL.revokeObjectURL(url);
            if (duration === undefined) reject(new Error("invalid audio metadata"));
            else resolve(duration);
        };
        audio.preload = "metadata";
        audio.onloadedmetadata = () => finish(audio.duration);
        audio.onerror = () => finish();
        audio.src = url;
    });
}

function mimeTypeForName(name: string) {
    if (/\.wav$/i.test(name)) return "audio/wav";
    if (/\.m4a$/i.test(name)) return "audio/mp4";
    return "audio/mpeg";
}
