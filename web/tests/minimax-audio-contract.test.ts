import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { assertMiniMaxCloneDurationSeconds, buildMiniMaxEndpoint, buildMiniMaxSpeechRequest, buildMiniMaxVoiceCloneRequest, normalizeMiniMaxVoiceId, parseMiniMaxFileId, parseMiniMaxSpeechResponse } from "../src/lib/minimax-contract.ts";

test("MiniMax Speech 2.8 request uses the native TTS contract", () => {
    assert.deepEqual(
        buildMiniMaxSpeechRequest("speech-2.8-hd", {
            text: "欢迎使用音频工作台",
            voiceId: "male-qn-qingse",
            speed: 1.2,
            volume: 6,
            pitch: -2,
            emotion: "happy",
            sampleRate: 32_000,
            format: "wav",
            language: "Chinese",
            watermark: true,
        }),
        {
            model: "speech-2.8-hd",
            text: "欢迎使用音频工作台",
            stream: false,
            output_format: "url",
            voice_setting: { voice_id: "male-qn-qingse", speed: 1.2, vol: 6, pitch: -2, emotion: "happy" },
            audio_setting: { sample_rate: 32_000, bitrate: 128_000, format: "wav", channel: 1 },
            language_boost: "Chinese",
            aigc_watermark: true,
        },
    );
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/v1", "speech"), "https://api.minimaxi.com/v1/t2a_v2");
});

test("MiniMax rapid voice cloning enforces its two-step native route and voice ID", () => {
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com", "file-upload"), "https://api.minimaxi.com/v1/files/upload");
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com", "voice-clone"), "https://api.minimaxi.com/v1/voice_clone");
    assert.equal(normalizeMiniMaxVoiceId("narrator_01"), "narrator_01");
    assert.throws(() => normalizeMiniMaxVoiceId("7-short"), /英文字母开头/u);
    assert.deepEqual(JSON.parse(buildMiniMaxVoiceCloneRequest("12345", "narrator_01", "speech-2.8-turbo", "欢迎回来")), {
        file_id: 12345,
        voice_id: "narrator_01",
        text: "欢迎回来",
        model: "speech-2.8-turbo",
        need_noise_reduction: true,
        need_volume_normalization: true,
        aigc_watermark: false,
    });
    assert.equal(parseMiniMaxFileId('{"file":{"file_id":12345},"base_resp":{"status_code":0}}'), "12345");
});

test("MiniMax clone preserves int64 file_id beyond JavaScript safe integer range", () => {
    const fileId = parseMiniMaxFileId('{"file":{"file_id":9007199254740993},"base_resp":{"status_code":0}}');
    assert.equal(fileId, "9007199254740993");
    const body = buildMiniMaxVoiceCloneRequest(fileId, "narrator_01", "speech-2.8-hd");
    assert.match(body, /^\{"file_id":9007199254740993,/u);
    assert.doesNotMatch(body, /"file_id":"/u);
    assert.doesNotMatch(body, /9007199254740992/u);
    assert.match(body, /"aigc_watermark":false/u);
    assert.throws(() => parseMiniMaxFileId('{"file":{"file_id":9223372036854775808}}'), /int64/u);
    assert.throws(() => parseMiniMaxFileId('{"base_resp":{"status_code":1004,"status_msg":"upload rejected"}}'), /upload rejected/u);
});

test("MiniMax clone accepts only 10–300 second audio metadata", () => {
    assert.doesNotThrow(() => assertMiniMaxCloneDurationSeconds(10));
    assert.doesNotThrow(() => assertMiniMaxCloneDurationSeconds(300));
    assert.throws(() => assertMiniMaxCloneDurationSeconds(9.999), /至少需要 10 秒/u);
    assert.throws(() => assertMiniMaxCloneDurationSeconds(300.001), /不能超过 5 分钟/u);
    assert.throws(() => assertMiniMaxCloneDurationSeconds(Number.NaN), /无法读取声音样本时长/u);
});

test("MiniMax browser and desktop clone transports keep upload and request JSON raw", () => {
    const audioSource = readFileSync(new URL("../src/services/api/minimax-audio.ts", import.meta.url), "utf8");
    const desktopSource = readFileSync(new URL("../src/services/desktop-storage.ts", import.meta.url), "utf8");
    const workbenchSource = readFileSync(new URL("../src/pages/audio/index.tsx", import.meta.url), "utf8");
    assert.match(audioSource, /postDesktopModelMultipart\(/u);
    assert.match(audioSource, /postDesktopModelRawJson\(/u);
    assert.match(audioSource, /responseType:\s*"text"/u);
    assert.match(audioSource, /transformResponse:\s*\[\(value\)\s*=>\s*value\]/u);
    assert.match(workbenchSource, /await assertMiniMaxCloneAudioDuration\(sample\)/u);
    assert.match(desktopSource, /invoke<string>\("native_model_multipart_post"/u);
    assert.match(desktopSource, /invoke<string>\("native_model_raw_json_post"/u);
});

test("MiniMax Speech output accepts URL and hex audio payloads", () => {
    assert.equal(parseMiniMaxSpeechResponse({ data: { audio: "https://example.com/speech.mp3" }, base_resp: { status_code: 0 } }), "https://example.com/speech.mp3");
    assert.equal(parseMiniMaxSpeechResponse({ data: { audio: "4869" }, base_resp: { status_code: 0 } }), "data:audio/mpeg;base64,SGk=");
});

test("workflow audio generation routes MiniMax Speech through its native service", () => {
    const source = readFileSync(new URL("../src/services/api/audio.ts", import.meta.url), "utf8");
    const miniMaxBranch = source.indexOf("if (isMiniMaxAdapter(requestConfig.adapter))");
    const openAiSpeech = source.indexOf('aiApiUrl(requestConfig, "/audio/speech")');

    assert.ok(miniMaxBranch >= 0, "workflow audio service must recognize the resolved MiniMax protocol");
    assert.ok(openAiSpeech > miniMaxBranch, "MiniMax must be routed before the OpenAI-compatible fallback");
    assert.match(source, /return requestMiniMaxSpeech\([\s\S]*?config\.model \|\| config\.audioModel/u);
    assert.match(source, /voiceId: configuredVoice && configuredVoice !== "alloy" \? configuredVoice : "male-qn-qingse"/u);
    assert.match(source, /const miniMaxFormat = format === "wav" \|\| format === "flac" \? format : "mp3"/u);
    assert.doesNotMatch(source.slice(miniMaxBranch, source.indexOf('if (requestConfig.apiFormat === "qwen"', miniMaxBranch)), /audio\/transcriptions|music/u);
});

test("workflow audio settings expose only MiniMax fields that are serialized", () => {
    const source = readFileSync(new URL("../src/components/audio-settings-panel.tsx", import.meta.url), "utf8");
    const start = source.indexOf('if (model === "speech-2.8-hd" || model === "speech-2.8-turbo")');
    const end = source.indexOf('if (model.startsWith("qwen-audio-")', start);
    const branch = source.slice(start, end);

    assert.match(branch, /MiniMax 语音设置/u);
    assert.match(branch, /音色 ID/u);
    assert.match(branch, /输出格式/u);
    assert.match(branch, /语速/u);
    assert.doesNotMatch(branch, /声音指令|转录|音乐/u);
});

test("MiniMax native audio workbench sends watermark and exposes MP3, WAV and FLAC", () => {
    const source = readFileSync(new URL("../src/pages/audio/index.tsx", import.meta.url), "utf8");
    assert.match(source, /watermark:\s*speechWatermark/u);
    assert.match(source, /<Toggle label="AIGC 音频标识"[\s\S]*?checked=\{props\.speechWatermark\}/u);
    const miniMaxSpeechPanel = source.slice(source.indexOf("{miniMax ? ("), source.indexOf(") : qwenAudioTts ? ("));
    assert.match(miniMaxSpeechPanel, /value:\s*"mp3"/u);
    assert.match(miniMaxSpeechPanel, /value:\s*"wav"/u);
    assert.match(miniMaxSpeechPanel, /value:\s*"flac"/u);
});

test("voice clone lists both MiniMax vendors without local plan filtering", () => {
    const source = readFileSync(new URL("../src/pages/audio/index.tsx", import.meta.url), "utf8");
    assert.match(source, /if \(!isMiniMaxAudioModelForTask\(value, task\)\) return false;[\s\S]*?return true;/u);
    assert.doesNotMatch(source, /task !== "voice-clone"|minimaxBillingMode !== "token-plan"/u);
    assert.doesNotMatch(source, /请先在渠道中切换线路/u);
});
