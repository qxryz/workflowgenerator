import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
    buildSeedance25TaskPrompt,
    isSeedance25Model,
    normalizeSeedance25Continuation,
    normalizeSeedance25Duration,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25RemoteVideoUrl,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    prepareSeedance25GeneratedVideoSource,
    seedance25ImageRole,
    seedance25InputModeError,
    seedance25MultimodalReferenceError,
    seedance25ReferenceError,
    SEEDANCE_25_REFERENCE_LIMITS,
    SEEDANCE_25_TASKS,
} from "../src/lib/seedance-2-5.ts";

const videoServiceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const videoPageSource = readFileSync(new URL("../src/pages/video/index.tsx", import.meta.url), "utf8");
const videoPanelSource = readFileSync(new URL("../src/components/video-settings-panel.tsx", import.meta.url), "utf8");
const workboardSource = readFileSync(new URL("../src/pages/seedance-2-5/index.tsx", import.meta.url), "utf8");
const workbenchHeaderSource = readFileSync(new URL("../src/components/media-workbench-header.tsx", import.meta.url), "utf8");
const routerSource = readFileSync(new URL("../src/router.tsx", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const canvasTypesSource = readFileSync(new URL("../src/types/canvas.ts", import.meta.url), "utf8");
const canvasGenerationSource = readFileSync(new URL("../src/lib/canvas/canvas-generation-helpers.ts", import.meta.url), "utf8");
const modelCatalogSource = readFileSync(new URL("../src/lib/model-catalog.ts", import.meta.url), "utf8");
const modelDocsSource = readFileSync(new URL("../src/pages/model-adaptations/index.tsx", import.meta.url), "utf8");
const parameterDocsSource = readFileSync(new URL("../src/pages/model-adaptations/model-api-parameters.ts", import.meta.url), "utf8");

test("Seedance 2.5 model matching and task enums normalize predictably", () => {
    assert.equal(isSeedance25Model("doubao-seedance-2-5-preview"), true);
    assert.equal(isSeedance25Model("Seedance 2.5"), true);
    assert.equal(isSeedance25Model("sd2_5-pro"), true);
    assert.equal(isSeedance25Model("doubao-seedance-2-0-260128"), false);
    assert.equal(normalizeSeedance25TaskMode("extend"), "extend");
    assert.equal(normalizeSeedance25TaskMode("unknown"), "generate");
    assert.equal(normalizeSeedance25Continuation("ending"), "ending");
    assert.equal(normalizeSeedance25Continuation(undefined), "natural");
    assert.equal(normalizeSeedance25Duration(2, "generate"), 4);
    assert.equal(normalizeSeedance25Duration(120, "generate"), 30);
    assert.equal(normalizeSeedance25Duration(-1, "generate"), -1);
    assert.equal(normalizeSeedance25Duration(2, "extend"), 4);
    assert.equal(normalizeSeedance25Duration(45, "extend"), 30);
    assert.equal(normalizeSeedance25Duration(30, "edit"), -1);
    assert.equal(normalizeSeedance25OutputFormat("mov"), "mov");
    assert.equal(normalizeSeedance25OutputFormat("avi"), "mp4");
    assert.equal(normalizeSeedance25InputMode("first-frame"), "first-frame");
    assert.equal(normalizeSeedance25InputMode("first-last"), "first-last");
    assert.equal(normalizeSeedance25InputMode("unknown"), "reference");
    assert.equal(normalizeSeedance25Seed(undefined), -1);
    assert.equal(normalizeSeedance25Seed(4_294_967_296), 4_294_967_295);
    assert.equal(seedance25ImageRole("first-last", 0), "first_frame");
    assert.equal(seedance25ImageRole("first-last", 1), "last_frame");
    assert.equal(seedance25ImageRole("reference", 0), "reference_image");
    assert.equal(normalizeSeedance25RemoteVideoUrl("asset-20260811-demo"), "asset://asset-20260811-demo");
    assert.equal(normalizeSeedance25RemoteVideoUrl("https://example.com/source.mp4"), "https://example.com/source.mp4");
    assert.equal(normalizeSeedance25RemoteVideoUrl("blob:local-video"), "");
    assert.deepEqual(
        SEEDANCE_25_TASKS.map((item) => item.label),
        ["生成视频", "延长视频", "编辑视频"],
    );
});

test("Seedance 2.5 generation, extension and edit input contracts fail closed", () => {
    const mp4 = { type: "video/mp4", bytes: 20_000_000, durationMs: 10_000, width: 1280, height: 720 };
    assert.equal(seedance25ReferenceError("generate", []), "");
    assert.equal(seedance25ReferenceError("generate", [mp4]), "");
    assert.match(
        seedance25ReferenceError(
            "generate",
            Array.from({ length: 11 }, () => mp4),
        ),
        /最多支持 10 个/u,
    );
    assert.match(seedance25ReferenceError("generate", [{ ...mp4, durationMs: 31_000 }]), /不能超过 30 秒/u);
    assert.match(seedance25ReferenceError("extend", []), /至少连接 1 个视频/u);
    assert.equal(seedance25ReferenceError("extend", [{ ...mp4, durationMs: 30_000 }]), "");
    assert.match(seedance25ReferenceError("edit", [{ ...mp4, durationMs: 3_000 }]), /不能少于 4 秒/u);
    assert.match(seedance25ReferenceError("edit", [{ ...mp4, durationMs: 31_000 }]), /不能超过 30 秒/u);
    assert.match(seedance25ReferenceError("edit", [{ ...mp4, type: "video/webm" }]), /mp4\/mov/u);
    assert.equal(SEEDANCE_25_REFERENCE_LIMITS.total, 50);
    assert.equal(SEEDANCE_25_REFERENCE_LIMITS.images, 30);
    assert.equal(SEEDANCE_25_REFERENCE_LIMITS.videos, 10);
    assert.equal(SEEDANCE_25_REFERENCE_LIMITS.audios, 10);
    assert.equal(seedance25MultimodalReferenceError("generate", [{ type: "image/png", bytes: 1 }], [], [{ type: "audio/mpeg", bytes: 1, durationMs: 30_000 }]), "");
    assert.match(
        seedance25MultimodalReferenceError(
            "generate",
            Array.from({ length: 31 }, () => ({ type: "image/png", bytes: 1 })),
            [],
            [],
        ),
        /最多支持 30 张/u,
    );
    assert.match(seedance25InputModeError("generate", "first-frame", { images: 0, videos: 0, audios: 0 }), /添加 1 张开场图片/u);
    assert.equal(seedance25InputModeError("generate", "first-frame", { images: 1, videos: 0, audios: 0 }), "");
    assert.equal(seedance25InputModeError("generate", "first-last", { images: 2, videos: 0, audios: 0 }), "");
    assert.match(seedance25InputModeError("generate", "first-last", { images: 1, videos: 0, audios: 0 }), /还需要添加 1 张结束图片/u);
    assert.match(seedance25InputModeError("generate", "first-last", { images: 2, videos: 1, audios: 0 }), /不能同时添加参考视频/u);
});

test("Seedance 2.5 generated records can become extension or edit source videos", () => {
    const localVideo = { url: "blob:local-preview", storageKey: "video/generated/demo.mp4", bytes: 20_000_000, mimeType: "video/mp4", durationMs: 12_000, width: 1280, height: 720 };
    const extended = prepareSeedance25GeneratedVideoSource(localVideo, "https://example.com/generated.mp4", "extend", 12);
    assert.equal("error" in extended, false);
    if (!("error" in extended)) {
        assert.equal(extended.video.url, "https://example.com/generated.mp4");
        assert.equal(extended.video.storageKey, "");
        assert.equal(extended.durationSeconds, 12);
    }
    const edited = prepareSeedance25GeneratedVideoSource(localVideo, "asset-20260811-generated", "edit", 12);
    assert.equal("error" in edited, false);
    if (!("error" in edited)) assert.equal(edited.video.url, "asset://asset-20260811-generated");
    const smartDuration = prepareSeedance25GeneratedVideoSource({ ...localVideo, durationMs: undefined }, "https://example.com/smart.mp4", "extend", -1);
    if (!("error" in smartDuration)) assert.equal(smartDuration.durationSeconds, 10);
    assert.match(prepareSeedance25GeneratedVideoSource(localVideo, undefined, "extend", 12).error || "", /官方视频地址/u);
    assert.match(prepareSeedance25GeneratedVideoSource({ ...localVideo, durationMs: 3_000 }, "https://example.com/short.mp4", "edit", 3).error || "", /不能少于 4 秒/u);
    assert.equal(localVideo.storageKey, "video/generated/demo.mp4");
    assert.match(workboardSource, /用于延长/u);
    assert.match(workboardSource, /用于编辑/u);
    assert.match(workboardSource, /useRecordAsSource\(activeRecord, "extend"\)/u);
    assert.match(workboardSource, /useRecordAsSource\(activeRecord, "edit"\)/u);
});

test("Seedance 2.5 task prompts preserve explicit mode semantics", () => {
    assert.equal(buildSeedance25TaskPrompt("  雨夜长镜头  ", "generate", "natural", 30), "雨夜长镜头");
    assert.match(buildSeedance25TaskPrompt("人物走进车站", "extend", "natural", 12), /向后延长 @视频1[\s\S]*续写 12 秒/u);
    assert.match(buildSeedance25TaskPrompt("人物走进车站", "extend", "natural", -1), /由模型判断合适的延长时长/u);
    assert.match(buildSeedance25TaskPrompt("人物走进车站", "extend", "ending", 12), /按描述中的结尾收束/u);
    assert.match(buildSeedance25TaskPrompt("把外套改为红色", "edit", "natural", -1), /编辑视频：[\s\S]*保持未提及的画面、人物动作、运镜、声音与时间线不变/u);
});

test("Seedance 2.5 uses the existing Ark task endpoint and conditional request fields", () => {
    assert.match(videoServiceSource, /buildApiUrl\(config\.baseUrl, `\/contents\/generations\/tasks/u);
    assert.match(videoServiceSource, /Authorization: `Bearer \$\{config\.apiKey\}`/u);
    assert.match(videoServiceSource, /buildSeedance25TaskPrompt\(prompt, taskMode, continuation, duration\)/u);
    assert.match(videoServiceSource, /taskMode !== "generate" \|\| inputMode !== "reference"/u);
    assert.match(videoServiceSource, /duration,/u);
    assert.match(videoServiceSource, /output_format: outputFormat/u);
    assert.match(videoServiceSource, /seed: normalizeSeedance25Seed/u);
    assert.match(videoServiceSource, /return_last_frame: boolConfig/u);
    assert.match(videoServiceSource, /tools: \[\{ type: "web_search" \}\]/u);
    assert.match(videoServiceSource, /camera_fixed: true/u);
    assert.match(videoServiceSource, /seedance25ImageRole\(inputMode, index\)/u);
    assert.match(videoServiceSource, /lastFrameUrl: state\.content\?\.last_frame_url/u);
    assert.match(videoServiceSource, /官方接口不接受本机视频 Base64/u);
    assert.match(videoServiceSource, /请求内容不能超过 64MB/u);
    assert.match(videoServiceSource, /seedance25 \? \(normalizeSeedanceResolution\(config\.vquality\) === "480p" \? "480p" : "720p"\)/u);
    assert.match(videoServiceSource, /generate_audio: boolConfig/u);
    assert.match(videoServiceSource, /watermark: boolConfig/u);
    assert.doesNotMatch(videoServiceSource, /operation:\s*(?:taskMode|"extend"|"edit")/u);
});

test("Seedance 2.5 exposes three coordinated UI entrances", () => {
    assert.match(workbenchHeaderSource, /label: "SD2\.5", path: "\/workbench\/sd25"/u);
    assert.doesNotMatch(workbenchHeaderSource, /subtitle|Sparkles/u);
    assert.match(routerSource, /path: "\/workbench\/sd25"/u);
    assert.match(workboardSource, /title="专属工作板"/u);
    assert.match(workboardSource, /SEEDANCE_25_TASKS\.map/u);
    assert.match(videoPanelSource, /function Seedance25SettingsPanel/u);
    assert.match(videoPanelSource, /SEEDANCE_25_TASKS\.map/u);
    assert.match(videoPanelSource, /延长时长/u);
    assert.match(videoPanelSource, /衔接方式/u);
    assert.match(videoPanelSource, /\["480p", "720p"\]/u);
    assert.match(videoPanelSource, /SEEDANCE_25_OUTPUT_FORMATS\.map/u);
    assert.match(videoPanelSource, /SEEDANCE_25_INPUT_MODES\.map/u);
    assert.match(videoPanelSource, /联网检索 · 仅纯文字/u);
    assert.match(videoPanelSource, /固定机位 · 仅纯文字/u);
    assert.match(videoPanelSource, /随机种子 · -1 为随机/u);
    assert.match(videoPageSource, /seedance25TaskMode/u);
    assert.match(videoPageSource, /尾帧续作/u);
    assert.match(canvasGenerationSource, /seedance25TaskMode: node\?\.metadata\?\.seedance25TaskMode/u);
});

test("Seedance 2.5 workboard explains source, instruction, and optional references in task order", () => {
    assert.match(workboardSource, /原片（必填）/u);
    assert.match(workboardSource, /接下来发生什么（必填）/u);
    assert.match(workboardSource, /要修改什么（必填）/u);
    assert.match(workboardSource, /补充参考图（可选）/u);
    assert.match(workboardSource, /画面如何开始/u);
    assert.match(workboardSource, /视频地址/u);
    assert.match(workboardSource, /原片时长/u);
    assert.doesNotMatch(workboardSource, /添加普通参考图片/u);
    assert.doesNotMatch(workboardSource, /Input\.Search/u);
});

test("Seedance 2.5 frame modes hide every reference-video affordance in the video workbench", () => {
    assert.match(videoPageSource, /const seedance25ReferenceTitle = seedance25FrameMode/u);
    assert.match(videoPageSource, /拖入 1 张开场图片，或点此选择/u);
    assert.match(videoPageSource, /拖入开始和结束两张图片，或点此选择/u);
    assert.match(videoPageSource, /seedance25FrameMode \? "image\/\*"/u);
    assert.match(videoPageSource, /当前画面模式只使用图片，不能添加参考视频/u);
    assert.match(videoPageSource, /当前画面模式只使用图片，不能添加参考音频/u);
    assert.match(videoPanelSource, /inputMode === "first-frame"[\s\S]*?添加 1 张开场图片后生成/u);
    assert.match(videoPanelSource, /inputMode === "first-last"[\s\S]*?依次添加开始和结束两张图片后生成/u);
});

test("Seedance 2.5 task settings and workboard results persist before success", () => {
    assert.match(configStoreSource, /seedance25TaskMode: Seedance25TaskMode/u);
    assert.match(configStoreSource, /seedance25Continuation: Seedance25Continuation/u);
    assert.match(configStoreSource, /seedance25OutputFormat: Seedance25OutputFormat/u);
    assert.match(configStoreSource, /seedance25InputMode: Seedance25InputMode/u);
    assert.match(configStoreSource, /seedance25Seed: string/u);
    assert.match(configStoreSource, /seedance25ReturnLastFrame: string/u);
    assert.match(configStoreSource, /seedance25WebSearch: string/u);
    assert.match(configStoreSource, /seedance25CameraFixed: string/u);
    assert.match(canvasTypesSource, /seedance25TaskMode\?: "generate" \| "extend" \| "edit"/u);
    assert.match(canvasTypesSource, /seedance25Continuation\?: "natural" \| "ending"/u);
    assert.match(canvasTypesSource, /seedance25OutputFormat\?: "mp4" \| "mov"/u);
    assert.match(canvasTypesSource, /seedance25InputMode\?: "reference" \| "first-frame" \| "first-last"/u);
    assert.match(workboardSource, /createDesktopJsonStore\(/u);
    assert.match(workboardSource, /await persistRecord\(completed\)/u);
    assert.match(workboardSource, /await recordStore\.getItem<BoardRecord>\(record\.id\)/u);
    assert.match(workboardSource, /if \(!publishUploadedMedia\(stored\)\) throw new Error/u);
    assert.match(workboardSource, /publishUploadedImage\(lastFrame\)/u);
});

test("Seedance 2.5 catalog and in-app docs use the official current contract", () => {
    assert.match(modelCatalogSource, /doubao-seedance-2-5-260628/u);
    assert.match(modelDocsSource, /recommendedCatalogModelsForVendor\(vendor\.id\)/u);
    assert.match(modelDocsSource, /vendor\.id !== "minimax-token-plan"/u);
    assert.match(modelDocsSource, /usesDirectNativeAdapter\(selected\.adapter\)/u);
    assert.match(modelDocsSource, /已由应用原生接入，无需添加高级脚本/u);
    assert.match(modelDocsSource, /requestHeaderRowsFor\(selected\)/u);
    assert.doesNotMatch(modelDocsSource, /selected\.vendor\.adapters\[capability\]/u);
    assert.match(modelDocsSource, /架构与新增渠道示例/u);
    assert.match(modelDocsSource, /绑定模型的原生 UI 解释/u);
    assert.match(modelDocsSource, /Zodiac 工作流技术说明/u);
    assert.match(modelDocsSource, /Seedance 2\.5[\s\S]*路线二 \+ 专属工作板/u);
    assert.match(parameterDocsSource, /2607688\?lang=zh/u);
    assert.match(parameterDocsSource, /4–30 秒或 -1/u);
    assert.match(parameterDocsSource, /480p 或 720p；不支持 1080p 和 4K/u);
    assert.match(parameterDocsSource, /output_format/u);
    assert.match(parameterDocsSource, /return_last_frame/u);
    assert.match(parameterDocsSource, /callback_url/u);
    assert.match(parameterDocsSource, /execution_expires_after/u);
    assert.match(parameterDocsSource, /safety_identifier/u);
    assert.match(parameterDocsSource, /不支持 draft、frames 与 flex/u);
    assert.doesNotMatch(parameterDocsSource, /生成时为 15–90 秒/u);
});
