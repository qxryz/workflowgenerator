import axios from "axios";

import { isDesktopApp, postDesktopModelJson } from "@/services/desktop-storage";
import { resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { buildQwenAudioEndpoint, buildQwenSpeechRequest, buildQwenTranscriptionRequest, buildQwenVoiceCloneRequest, isQwenAudioModelForTask, qwenAudioModels, type QwenAudioTask, type QwenSpeechInput } from "@/lib/qwen-audio-contract";

export { buildQwenAudioEndpoint, buildQwenSpeechRequest, isQwenAudioModelForTask, qwenAudioModels };
export type { QwenAudioTask, QwenSpeechInput };

export type QwenVoiceCloneInput = {
    audioDataUrl: string;
    name: string;
    transcript?: string;
    language?: string;
};

export type QwenTranscriptionInput = {
    audioDataUrl: string;
    language?: string;
    enableItn?: boolean;
    context?: string;
};

type DashScopeAudioPayload = {
    output?: {
        audio?: { url?: string; data?: string };
        voice?: string;
        voice_id?: string;
    };
    choices?: Array<{ message?: { content?: string } }>;
    request_id?: string;
};

export async function requestQwenSpeech(config: AiConfig, modelValue: string, input: QwenSpeechInput, signal?: AbortSignal) {
    const request = resolveQwenRequest(config, modelValue);
    const model = request.model || "qwen-audio-3.0-tts-flash";
    const payload = buildQwenSpeechRequest(model, input);
    const result = await postDashScope(request, buildQwenAudioEndpoint(request.baseUrl, payload.endpoint), payload.body, signal);
    return requireAudioUrl(result, "语音生成");
}

export async function requestQwenVoiceClone(config: AiConfig, modelValue: string, input: QwenVoiceCloneInput, signal?: AbortSignal) {
    const request = resolveQwenRequest(config, modelValue);
    const body = buildQwenVoiceCloneRequest(request.model || "qwen3-tts-vc-2026-01-22", { ...input, name: normalizeVoiceName(input.name) });
    const result = await postDashScope(request, buildQwenAudioEndpoint(request.baseUrl, "voice"), body, signal);
    const voice = result.output?.voice || result.output?.voice_id;
    if (!voice) throw new Error("声音克隆成功，但服务未返回可用的音色 ID");
    return { voice, requestId: result.request_id };
}

export async function requestQwenTranscription(config: AiConfig, modelValue: string, input: QwenTranscriptionInput, signal?: AbortSignal) {
    const request = resolveQwenRequest(config, modelValue);
    const body = buildQwenTranscriptionRequest(request.model || "qwen3-asr-flash", input);
    const result = await postDashScope(request, buildQwenAudioEndpoint(request.baseUrl, "asr"), body, signal);
    const text = result.choices?.[0]?.message?.content?.trim();
    if (!text) throw new Error("转录完成，但服务未返回文本");
    return { text, requestId: result.request_id };
}

function resolveQwenRequest(config: AiConfig, modelValue: string) {
    const request = resolveModelRequestConfig(config, modelValue);
    if (!request.baseUrl.trim()) throw new Error("请先配置千问渠道地址");
    if (!request.apiKey.trim()) throw new Error("请先配置千问 API Key");
    return request;
}

function normalizeVoiceName(value: string) {
    const name = value.trim().replace(/[^a-zA-Z0-9_]/g, "").slice(0, 16);
    if (!name) throw new Error("请填写由字母、数字或下划线组成的音色名称");
    return name;
}

async function postDashScope(config: AiConfig, url: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<DashScopeAudioPayload> {
    if (signal?.aborted) throw new DOMException("请求已取消", "AbortError");
    try {
        if (isDesktopApp()) {
            const result = await postDesktopModelJson<DashScopeAudioPayload>(url, config.apiKey, body);
            if (!result) throw new Error("桌面请求没有返回结果");
            return result;
        }
        return (await axios.post<DashScopeAudioPayload>(url, body, { headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" }, signal })).data;
    } catch (error) {
        if (axios.isCancel(error) || (error instanceof DOMException && error.name === "AbortError")) throw new Error("请求已取消");
        if (axios.isAxiosError(error)) {
            const data = error.response?.data as { message?: string; msg?: string; error?: { message?: string } } | undefined;
            throw new Error(data?.error?.message || data?.message || data?.msg || `千问音频请求失败${error.response?.status ? `（HTTP ${error.response.status}）` : ""}`);
        }
        if (typeof error === "string" && error.trim()) throw new Error(error.trim());
        throw error instanceof Error ? error : new Error("千问音频请求失败");
    }
}

function requireAudioUrl(payload: DashScopeAudioPayload, label: string) {
    const url = payload.output?.audio?.url;
    if (!url) throw new Error(`${label}完成，但服务未返回音频地址`);
    return url;
}
