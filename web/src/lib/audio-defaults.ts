export type AudioDefaultsKind = "minimax" | "qwen" | "generic";

export type AudioVoiceOption = {
    value: string;
    label: string;
};

export const openAiAudioVoiceOptions: AudioVoiceOption[] = [
    { value: "alloy", label: "Alloy" },
    { value: "ash", label: "Ash" },
    { value: "ballad", label: "Ballad" },
    { value: "coral", label: "Coral" },
    { value: "echo", label: "Echo" },
    { value: "fable", label: "Fable" },
    { value: "nova", label: "Nova" },
    { value: "onyx", label: "Onyx" },
    { value: "sage", label: "Sage" },
    { value: "shimmer", label: "Shimmer" },
    { value: "verse", label: "Verse" },
    { value: "marin", label: "Marin" },
    { value: "cedar", label: "Cedar" },
];

export const qwenAudioVoiceOptions: AudioVoiceOption[] = [
    { value: "longanhuan_v3.6", label: "龙安欢 · longanhuan_v3.6" },
    { value: "longjielidou_v3.6", label: "龙杰力豆 · longjielidou_v3.6" },
    { value: "loongeva_v3.6", label: "Eva · loongeva_v3.6" },
    { value: "loongjohn", label: "John · loongjohn" },
];

export const qwen3AudioVoiceOptions: AudioVoiceOption[] = [
    { value: "Cherry", label: "Cherry" },
    { value: "Chelsie", label: "Chelsie" },
    { value: "Momo", label: "Momo" },
    { value: "Alek", label: "Alek" },
    { value: "Dolce", label: "Dolce" },
    { value: "Sohee", label: "Sohee" },
    { value: "Ono Anna", label: "Ono Anna" },
];

export const miniMaxAudioVoiceOptions: AudioVoiceOption[] = [
    { value: "male-qn-qingse", label: "青涩青年 · male-qn-qingse" },
    { value: "male-qn-jingying", label: "精英青年 · male-qn-jingying" },
    { value: "male-qn-badao", label: "霸道青年 · male-qn-badao" },
    { value: "male-qn-daxuesheng", label: "青年大学生 · male-qn-daxuesheng" },
    { value: "female-shaonv", label: "少女 · female-shaonv" },
    { value: "female-yujie", label: "御姐 · female-yujie" },
    { value: "female-chengshu", label: "成熟女性 · female-chengshu" },
    { value: "female-tianmei", label: "甜美女性 · female-tianmei" },
];

export type AudioDefaults = {
    voice: string;
    format: string;
    speed: string;
    instructions: string;
};

function modelName(value: string) {
    return value.includes("::") ? value.slice(value.indexOf("::") + 2).toLowerCase() : value.toLowerCase();
}

export function audioDefaultsKindForModel(value: string): AudioDefaultsKind {
    const model = modelName(value);
    if (model === "speech-2.8-hd" || model === "speech-2.8-turbo") return "minimax";
    if (model.startsWith("qwen-audio-") || model.startsWith("qwen3-tts")) return "qwen";
    return "generic";
}

export function audioVoiceOptionsForModel(value: string): AudioVoiceOption[] {
    const model = modelName(value);
    if (model === "speech-2.8-hd" || model === "speech-2.8-turbo") return miniMaxAudioVoiceOptions;
    if (model.startsWith("qwen-audio-")) return qwenAudioVoiceOptions;
    if (model.startsWith("qwen3-tts-vc")) return [];
    if (model.startsWith("qwen3-tts")) return qwen3AudioVoiceOptions;
    return openAiAudioVoiceOptions;
}

export function defaultAudioPreferencesForModel(value: string): AudioDefaults {
    const kind = audioDefaultsKindForModel(value);
    if (kind === "minimax") return { voice: "male-qn-qingse", format: "mp3", speed: "1", instructions: "" };
    if (kind === "qwen") {
        const model = modelName(value);
        return { voice: model.startsWith("qwen-audio-") ? "longanhuan_v3.6" : model.startsWith("qwen3-tts-vc") ? "" : "Cherry", format: "mp3", speed: "1", instructions: "" };
    }
    return { voice: "alloy", format: "mp3", speed: "1", instructions: "" };
}

export function normalizeAudioDefaultsForModel(value: string, current: Partial<AudioDefaults>): AudioDefaults {
    const kind = audioDefaultsKindForModel(value);
    const fallback = defaultAudioPreferencesForModel(value);
    const rawVoice = current.voice?.trim() || "";
    const voice = kind === "generic" ? rawVoice || fallback.voice : rawVoice && rawVoice !== "alloy" ? rawVoice : fallback.voice;
    const supportedFormats = kind === "minimax" ? ["mp3", "wav", "flac"] : kind === "qwen" ? ["mp3", "wav"] : ["mp3", "wav", "opus", "aac", "flac", "pcm"];
    const format = supportedFormats.includes(current.format || "") ? current.format || fallback.format : fallback.format;
    const rawSpeed = Number(current.speed);
    const min = kind === "generic" ? 0.25 : 0.5;
    const max = kind === "generic" ? 4 : 2;
    const speed = String(Math.max(min, Math.min(max, Number.isFinite(rawSpeed) ? rawSpeed : Number(fallback.speed))));
    return { voice, format, speed, instructions: kind === "minimax" ? "" : current.instructions || "" };
}
