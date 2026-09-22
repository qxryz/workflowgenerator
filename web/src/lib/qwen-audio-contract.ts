export type QwenAudioTask = "speech" | "voice-clone" | "transcription";

export type QwenAudioNativeRoute = {
    id: "qwen-audio-tts-http" | "qwen-tts-http" | "qwen-voice-clone-http" | "qwen-asr-compatible";
    label: string;
    path: string;
    docsUrl: string;
    note: string;
};

export type QwenSpeechInput = {
    text: string;
    voice: string;
    format: "mp3" | "wav";
    language?: string;
    sampleRate?: number;
    instruction?: string;
    volume?: number;
    rate?: number;
    pitch?: number;
    aigcTag?: boolean;
};

export function buildQwenVoiceCloneRequest(model: string, input: { audioDataUrl: string; name: string; transcript?: string; language?: string }) {
    return {
        model: "qwen-voice-enrollment",
        input: {
            action: "create",
            target_model: model,
            preferred_name: input.name,
            audio: { data: input.audioDataUrl },
            ...(input.transcript?.trim() ? { text: input.transcript.trim() } : {}),
            ...(input.language && input.language !== "auto" ? { language: input.language } : {}),
        },
    };
}

export function buildQwenTranscriptionRequest(model: string, input: { audioDataUrl: string; language?: string; enableItn?: boolean; context?: string }) {
    return {
        model,
        messages: [
            ...(input.context?.trim() ? [{ role: "system", content: input.context.trim() }] : []),
            { role: "user", content: [{ type: "input_audio", input_audio: { data: input.audioDataUrl } }] },
        ],
        stream: false,
        asr_options: {
            ...(input.language && input.language !== "auto" ? { language: input.language } : {}),
            enable_itn: Boolean(input.enableItn),
        },
    };
}

export const qwenAudioModels: Record<QwenAudioTask, readonly string[]> = {
    speech: ["qwen-audio-3.0-tts-flash", "qwen3-tts-vc-2026-01-22"],
    "voice-clone": ["qwen3-tts-vc-2026-01-22"],
    transcription: ["qwen3-asr-flash"],
};

const QWEN3_LANGUAGE_TYPES: Record<string, string> = {
    zh: "Chinese",
    en: "English",
    de: "German",
    it: "Italian",
    pt: "Portuguese",
    es: "Spanish",
    ja: "Japanese",
    ko: "Korean",
    fr: "French",
    ru: "Russian",
};

const languageLabels: Record<string, string> = {
    auto: "自动识别",
    zh: "中文",
    yue: "粤语",
    en: "英文",
    ja: "日语",
    ko: "韩语",
    fr: "法语",
    de: "德语",
    es: "西班牙语",
    ru: "俄语",
    pt: "葡萄牙语",
    it: "意大利语",
    ar: "阿拉伯语",
    hi: "印地语",
    id: "印尼语",
    th: "泰语",
    tr: "土耳其语",
    uk: "乌克兰语",
    vi: "越南语",
    cs: "捷克语",
    da: "丹麦语",
    fil: "菲律宾语",
    fi: "芬兰语",
    is: "冰岛语",
    ms: "马来语",
    no: "挪威语",
    pl: "波兰语",
    sv: "瑞典语",
};

const qwenAudioTtsLanguages = ["auto", "zh", "en", "fr", "de", "ja", "ko", "ru", "pt", "th", "id", "vi", "es", "it", "ms", "fil", "ar"];
const qwen3TtsLanguages = ["auto", "zh", "en", "de", "it", "pt", "es", "ja", "ko", "fr", "ru"];
const qwenAsrLanguages = ["auto", "zh", "yue", "en", "ja", "de", "ko", "ru", "fr", "pt", "ar", "it", "es", "hi", "id", "th", "tr", "uk", "vi", "cs", "da", "fil", "fi", "is", "ms", "no", "pl", "sv"];

export function qwenAudioLanguageOptions(task: QwenAudioTask, model: string) {
    const values = task === "transcription" ? qwenAsrLanguages : model.toLowerCase().startsWith("qwen-audio-") ? qwenAudioTtsLanguages : qwen3TtsLanguages;
    return values.map((value) => ({ value, label: languageLabels[value] || value }));
}

export function qwen3LanguageType(value?: string) {
    if (!value || value === "auto") return undefined;
    return QWEN3_LANGUAGE_TYPES[value] || value;
}

export function qwenAudioNativeRoute(task: QwenAudioTask, model: string): QwenAudioNativeRoute {
    const name = model.toLowerCase();
    if (task === "voice-clone") {
        return {
            id: "qwen-voice-clone-http",
            label: "千问声音复刻 HTTP",
            path: "/api/v1/services/audio/tts/customization",
            docsUrl: "https://help.aliyun.com/en/model-studio/voice-clone-design-http-api",
            note: "创建音色后，语音生成必须继续使用相同的 target_model。",
        };
    }
    if (task === "transcription") {
        return {
            id: "qwen-asr-compatible",
            label: "千问 ASR OpenAI 兼容接口",
            path: "/compatible-mode/v1/chat/completions",
            docsUrl: "https://help.aliyun.com/en/model-studio/qwen-asr-api-reference",
            note: "使用 input_audio 与 asr_options，当前采用非流式完整转录。",
        };
    }
    if (name.startsWith("qwen-audio-")) {
        return {
            id: "qwen-audio-tts-http",
            label: "Qwen-Audio-TTS 原生 HTTP",
            path: "/api/v1/services/audio/tts/SpeechSynthesizer",
            docsUrl: "https://help.aliyun.com/en/model-studio/cosyvoice-tts-http-api",
            note: "支持格式、采样率、语速、音调、音量、语言提示与声音指令。",
        };
    }
    return {
        id: "qwen-tts-http",
        label: "Qwen3-TTS 多模态 HTTP",
        path: "/api/v1/services/aigc/multimodal-generation/generation",
        docsUrl: "https://help.aliyun.com/en/model-studio/qwen-tts-api",
        note: "VC 音色必须由声音复刻接口创建，并与当前模型完全一致。",
    };
}

export function qwenAudioNativeRoutesForModel(model: string) {
    const name = model.toLowerCase();
    if (name.startsWith("qwen-audio-")) return [qwenAudioNativeRoute("speech", name)];
    if (name.startsWith("qwen3-tts-vc")) return [qwenAudioNativeRoute("voice-clone", name), qwenAudioNativeRoute("speech", name)];
    if (name.startsWith("qwen3-asr")) return [qwenAudioNativeRoute("transcription", name)];
    return [];
}

export function isQwenAudioModelForTask(model: string, task: QwenAudioTask) {
    const separator = model.indexOf("::");
    const name = (separator >= 0 ? model.slice(separator + 2) : model).toLowerCase();
    return qwenAudioModels[task].some((candidate) => name === candidate);
}

export function buildQwenAudioEndpoint(baseUrl: string, kind: "tts" | "multimodal" | "voice" | "asr") {
    const base = normalizeDashScopeRoot(baseUrl);
    if (kind === "tts") return `${base}/api/v1/services/audio/tts/SpeechSynthesizer`;
    if (kind === "voice") return `${base}/api/v1/services/audio/tts/customization`;
    if (kind === "asr") return `${base}/compatible-mode/v1/chat/completions`;
    return `${base}/api/v1/services/aigc/multimodal-generation/generation`;
}

export function buildQwenSpeechRequest(model: string, input: QwenSpeechInput) {
    if (model.startsWith("qwen-audio-")) {
        return {
            endpoint: "tts" as const,
            body: {
                model,
                input: {
                    text: input.text,
                    voice: input.voice,
                    format: input.format,
                    sample_rate: input.sampleRate || 24_000,
                    ...(input.instruction?.trim() ? { instruction: input.instruction.trim() } : {}),
                    ...(input.language ? { language_hints: [input.language] } : {}),
                    ...(typeof input.volume === "number" ? { volume: input.volume } : {}),
                    ...(typeof input.rate === "number" ? { rate: input.rate } : {}),
                    ...(typeof input.pitch === "number" ? { pitch: input.pitch } : {}),
                    ...(input.aigcTag ? { enable_aigc_tag: true } : {}),
                },
            },
        };
    }
    return {
        endpoint: "multimodal" as const,
        body: {
            model,
            input: {
                text: input.text,
                voice: input.voice,
                ...(qwen3LanguageType(input.language) ? { language_type: qwen3LanguageType(input.language) } : {}),
            },
        },
    };
}

function normalizeDashScopeRoot(baseUrl: string) {
    let base = baseUrl.trim().replace(/\/+$/, "");
    for (const suffix of ["/compatible-mode/v1", "/api/v1", "/v1"]) {
        if (base.toLowerCase().endsWith(suffix)) {
            base = base.slice(0, -suffix.length);
            break;
        }
    }
    return base;
}
