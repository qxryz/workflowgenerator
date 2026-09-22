import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { audioVoiceOptionsForModel, normalizeAudioDefaultsForModel } from "../src/lib/audio-defaults.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("audio defaults normalize to the selected provider contract", () => {
    const qwen = normalizeAudioDefaultsForModel("voice::qwen-audio-3.0-tts-flash", { voice: "alloy", format: "flac", speed: "4" });
    assert.deepEqual(qwen, { voice: "longanhuan_v3.6", format: "mp3", speed: "2", instructions: "" });

    const miniMax = normalizeAudioDefaultsForModel("minimax::speech-2.8-hd", { voice: "alloy", format: "aac", speed: "0.2", instructions: "不应发送" });
    assert.deepEqual(miniMax, { voice: "male-qn-qingse", format: "mp3", speed: "0.5", instructions: "" });
});

test("default voice choices follow the selected provider and preserve custom voice IDs", () => {
    assert.deepEqual(
        audioVoiceOptionsForModel("voice::qwen-audio-3.0-tts-flash").map((option) => option.value),
        ["longanhuan_v3.6", "longjielidou_v3.6", "loongeva_v3.6", "loongjohn"],
    );
    assert.equal(audioVoiceOptionsForModel("minimax-api::speech-2.8-hd")[0]?.value, "male-qn-qingse");
    assert.equal(audioVoiceOptionsForModel("openai::gpt-4o-mini-tts")[0]?.value, "alloy");
    assert.deepEqual(audioVoiceOptionsForModel("voice::qwen3-tts-vc-2026-01-22"), []);
});

test("preferences UI and request paths expose separate scopes", () => {
    const configUi = readSource("../src/components/layout/app-config-modal.tsx");
    const audioWorkbench = readSource("../src/pages/audio/index.tsx");
    const zodiacApi = readSource("../src/services/api/zodic.ts");
    const zodiacPanel = readSource("../src/components/agent/zodic-panel.tsx");
    const zodiacTransport = readSource("../src/services/api/zodiac-transport.ts");
    const imageApi = readSource("../src/services/api/image.ts");
    const configStore = readSource("../src/stores/use-config-store.ts");
    const serverStorage = readSource("../src/services/server-storage.ts");
    const fileStorage = readSource("../src/services/file-storage.ts");
    const imageStorage = readSource("../src/services/image-storage.ts");
    const nativeStorage = readSource("../server/src/storage.rs");

    assert.match(configUi, /新任务默认模型/u);
    assert.match(configUi, /工作流节点默认值/u);
    assert.match(configUi, /Zodiac 默认角色/u);
    assert.match(configUi, /图片提示前缀/u);
    assert.match(configUi, /修改已自动保存在本机/u);
    assert.doesNotMatch(configUi, /允许私有网络媒体下载/u);
    assert.match(readFileSync(new URL("../src/components/layout/config-run-connections.tsx", import.meta.url), "utf8"), /允许私有网络媒体下载/u);
    assert.match(readSource("../src/components/layout/config-run-connections.tsx"), /只使用可信的模型渠道和插件/u);

    // The data root moved from the desktop app's folder picker to a server-side
    // directory, so the layout is asserted against the Rust store now. Media is
    // bucketed under one root, and the upload spool is a dot-directory there.
    assert.match(nativeStorage, /app_data_dir\.join\("config"\)/u);
    assert.match(nativeStorage, /app_data_dir\.join\("media"\)/u);
    assert.match(nativeStorage, /media_root\.join\("\.uploads"\)/u);
    assert.match(nativeStorage, /storage\.media_root\.join\(&bucket\)/u);
    assert.match(imageStorage, /const MEDIA_BUCKET = "images"/u);
    assert.match(fileStorage, /const MEDIA_BUCKET = "media"/u);
    assert.match(readSource("../src/services/asset-file-storage.ts"), /const FILE_BUCKET = "files"/u);

    // A private-network opt-in has to be an explicit boolean at the wire
    // boundary; a truthy string from a config file must not unlock it.
    assert.match(serverStorage, /allowPrivateNetwork: options\.allowPrivateNetwork === true/u);
    assert.match(fileStorage, /config\.allowPrivateNetworkMedia/u);
    assert.match(imageStorage, /config\.allowPrivateNetworkMedia/u);
    assert.match(configStore, /allowPrivateNetworkMedia: false/u);
    assert.match(configStore, /allowPrivateNetworkMedia: config\.allowPrivateNetworkMedia === true/u);
    assert.match(configUi, /自定义音色 ID/u);
    assert.match(configUi, /audioVoiceOptionsForModel/u);
    assert.doesNotMatch(configUi, /label="系统提示词"/u);
    assert.match(audioWorkbench, /useState\(config\.audioModel\)/u);
    assert.match(audioWorkbench, /updateConfig\("audioModel", next\)/u);
    assert.match(zodiacPanel, /runZodiacTurn/u);
    assert.match(zodiacTransport, /runOpenCodeTurn/u);
    assert.match(zodiacApi, /proxyModelPost|requestZodicReply|apiFormat/u);
    assert.doesNotMatch(zodiacPanel, /piReady|sidecar|zodiac-stream/u);
    assert.match(imageApi, /config\.imagePromptPrefix\.trim\(\)/u);
    assert.match(configStore, /imagePromptPrefix: config\.imagePromptPrefix \|\| persistedConfig\.systemPrompt \|\| ""/u);
    assert.match(configStore, /systemPrompt: ""/u);
});
