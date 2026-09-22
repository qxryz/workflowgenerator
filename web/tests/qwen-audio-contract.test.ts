import assert from "node:assert/strict";
import test from "node:test";

import { buildQwenAudioEndpoint, buildQwenSpeechRequest, buildQwenTranscriptionRequest, buildQwenVoiceCloneRequest, isQwenAudioModelForTask, qwenAudioLanguageOptions, qwenAudioNativeRoutesForModel } from "../src/lib/qwen-audio-contract.ts";

test("normalizes DashScope roots before selecting task-specific endpoints", () => {
    assert.equal(
        buildQwenAudioEndpoint("https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1", "asr"),
        "https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/chat/completions",
    );
    assert.equal(
        buildQwenAudioEndpoint("https://workspace.cn-beijing.maas.aliyuncs.com", "voice"),
        "https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/audio/tts/customization",
    );
});

test("Qwen Audio TTS serializer uses provider-native field names", () => {
    const request = buildQwenSpeechRequest("qwen-audio-3.0-tts-flash", {
        text: "欢迎使用音频工作台",
        voice: "longanhuan_v3.6",
        format: "wav",
        sampleRate: 24_000,
        instruction: "温暖、沉稳",
    });

    assert.equal(request.endpoint, "tts");
    assert.deepEqual(request.body, {
        model: "qwen-audio-3.0-tts-flash",
        input: {
            text: "欢迎使用音频工作台",
            voice: "longanhuan_v3.6",
            format: "wav",
            sample_rate: 24_000,
            instruction: "温暖、沉稳",
        },
    });
});

test("Qwen3 voice-clone synthesis maps UI language codes to provider enums", () => {
    const request = buildQwenSpeechRequest("qwen3-tts-vc-2026-01-22", {
        text: "欢迎回来",
        voice: "narrator01_xxx",
        format: "mp3",
        language: "zh",
    });
    assert.equal(request.endpoint, "multimodal");
    assert.deepEqual(request.body, {
        model: "qwen3-tts-vc-2026-01-22",
        input: { text: "欢迎回来", voice: "narrator01_xxx", language_type: "Chinese" },
    });
});

test("audio tasks accept only their matching configured model families", () => {
    assert.equal(isQwenAudioModelForTask("channel::qwen3-asr-flash", "transcription"), true);
    assert.equal(isQwenAudioModelForTask("channel::qwen3-asr-flash", "speech"), false);
    assert.equal(isQwenAudioModelForTask("channel::qwen3-tts-vc-2026-01-22", "voice-clone"), true);
});

test("native audio UI exposes the documented route and complete task language set", () => {
    assert.deepEqual(
        qwenAudioNativeRoutesForModel("qwen3-tts-vc-2026-01-22").map((route) => route.path),
        ["/api/v1/services/audio/tts/customization", "/api/v1/services/aigc/multimodal-generation/generation"],
    );
    const asrLanguages = qwenAudioLanguageOptions("transcription", "qwen3-asr-flash").map((option) => option.value);
    assert.equal(asrLanguages.includes("yue"), true);
    assert.equal(asrLanguages.includes("sv"), true);
    assert.equal(asrLanguages.length, 28);
});

test("voice cloning and ASR serializers match their native HTTP contracts", () => {
    assert.deepEqual(buildQwenVoiceCloneRequest("qwen3-tts-vc-2026-01-22", { audioDataUrl: "data:audio/mpeg;base64,AAA", name: "narrator01", language: "zh" }), {
        model: "qwen-voice-enrollment",
        input: { action: "create", target_model: "qwen3-tts-vc-2026-01-22", preferred_name: "narrator01", audio: { data: "data:audio/mpeg;base64,AAA" }, language: "zh" },
    });
    assert.deepEqual(buildQwenTranscriptionRequest("qwen3-asr-flash", { audioDataUrl: "data:audio/wav;base64,AAA", language: "yue", enableItn: true, context: "品牌名：WorkflowGenerator" }), {
        model: "qwen3-asr-flash",
        messages: [
            { role: "system", content: "品牌名：WorkflowGenerator" },
            { role: "user", content: [{ type: "input_audio", input_audio: { data: "data:audio/wav;base64,AAA" } }] },
        ],
        stream: false,
        asr_options: { language: "yue", enable_itn: true },
    });
});
