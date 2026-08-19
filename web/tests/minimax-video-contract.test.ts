import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMiniMaxEndpoint, buildMiniMaxH3Request, miniMaxVideoInputModeError, resolveMiniMaxVideoInputMode } from "../src/lib/minimax-contract.ts";

const videoServiceSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
const videoPanelSource = readFileSync(new URL("../src/components/video-settings-panel.tsx", import.meta.url), "utf8");
const videoPageSource = readFileSync(new URL("../src/pages/video/index.tsx", import.meta.url), "utf8");
const configStoreSource = readFileSync(new URL("../src/stores/use-config-store.ts", import.meta.url), "utf8");
const canvasTypesSource = readFileSync(new URL("../src/types/canvas.ts", import.meta.url), "utf8");
const canvasGenerationSource = readFileSync(new URL("../src/lib/canvas/canvas-generation-helpers.ts", import.meta.url), "utf8");
const canvasNodeSource = readFileSync(new URL("../src/components/canvas/canvas-node.tsx", import.meta.url), "utf8");

test("MiniMax H3 uses the exact native V2 create and query routes", () => {
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/anthropic", "video-h3"), "https://api.minimaxi.com/v2/video_generation");
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/v1", "video-query", "h3-task"), "https://api.minimaxi.com/v2/query/video_generation/h3-task");
    assert.match(videoServiceSource, /provider: "openai" \| "seedance" \| "minimax"/u);
    assert.match(videoServiceSource, /config\.apiFormat === "ark" \|\| isMiniMaxAdapter/u);
    assert.match(videoServiceSource, /postVideoJson<MiniMaxH3TaskResponse>[\s\S]*?buildMiniMaxEndpoint\(config\.baseUrl, "video-h3"\)/u);
    assert.match(videoServiceSource, /getVideoJson<MiniMaxH3TaskResponse>[\s\S]*?buildMiniMaxEndpoint\(config\.baseUrl, "video-query", task\.id\)/u);
    assert.doesNotMatch(videoServiceSource, /assertMiniMaxBillingSupports/u);
    assert.match(videoServiceSource, /new Blob\(\[JSON\.stringify\(body\)\]\)\.size > 64 \* 1024 \* 1024/u);
});

test("MiniMax H3 explicit and automatic input modes produce exclusive native roles", () => {
    const firstLast = buildMiniMaxH3Request("MiniMax-H3", {
        prompt: "首尾画面平滑过渡",
        mode: "first-last",
        images: ["data:image/png;base64,AAAA", "data:image/png;base64,BBBB"],
        resolution: "2K",
        duration: 8,
        ratio: "adaptive",
    });
    assert.deepEqual(firstLast.content.map((part) => part.role).filter(Boolean), ["first_frame", "last_frame"]);
    const lastFrame = buildMiniMaxH3Request("MiniMax-H3", {
        prompt: "以这张图作为结尾",
        mode: "last-frame",
        images: ["data:image/png;base64,AAAA"],
        resolution: "768P",
        duration: 6,
        ratio: "9:16",
    });
    assert.deepEqual(lastFrame.content.map((part) => part.role).filter(Boolean), ["last_frame"]);
    assert.equal(lastFrame.ratio, "adaptive");

    const oneReference = buildMiniMaxH3Request("MiniMax-H3", {
        prompt: "参考人物造型",
        mode: "reference",
        images: ["data:image/png;base64,AAAA"],
        resolution: "768P",
        duration: 6,
        ratio: "9:16",
    });
    assert.deepEqual(oneReference.content.map((part) => part.role).filter(Boolean), ["reference_image"]);
    assert.equal(oneReference.ratio, "9:16");

    assert.equal(resolveMiniMaxVideoInputMode("auto", { images: 1, videos: 0, audios: 0 }), "first-frame");
    assert.equal(resolveMiniMaxVideoInputMode("auto", { images: 2, videos: 0, audios: 0 }), "first-last");
    assert.equal(resolveMiniMaxVideoInputMode("auto", { images: 2, videos: 1, audios: 0 }), "reference");
    assert.match(miniMaxVideoInputModeError("first-last", { images: 1, videos: 0, audios: 0 }), /2 张图片/u);
    assert.equal(miniMaxVideoInputModeError("reference", { images: 2, videos: 0, audios: 0 }), "");
    assert.match(videoServiceSource, /normalizeMiniMaxVideoInputMode\(config\.minimaxVideoInputMode\)/u);
});

test("MiniMax H3 native workbench exposes only supported controls and media limits", () => {
    assert.match(videoPanelSource, /ui\.experience === "minimax-video"/u);
    assert.match(videoPanelSource, /MINIMAX_VIDEO_RESOLUTIONS/u);
    assert.match(videoPanelSource, /MINIMAX_VIDEO_RATIOS/u);
    assert.match(videoPanelSource, /素材模式/u);
    assert.match(videoPanelSource, /"last-frame": "尾帧"/u);
    assert.match(videoPanelSource, /1–2 张图片也不会转为首尾帧/u);
    assert.match(videoPageSource, /const supportsVideoReferences = \([^;]*videoExperience === "seedance-video"[^;]*isMiniMaxH3[^;]*\) && !seedance25FrameMode/u);
    assert.match(videoPageSource, /const supportsAudioReferences = \([^;]*videoExperience === "seedance-video"[^;]*isMiniMaxH3[^;]*\) && !seedance25FrameMode/u);
    assert.match(videoPageSource, /const maxVideoReferenceBytes = isMiniMaxH3 \? 50 \* 1024 \* 1024/u);
    assert.match(videoPageSource, /MiniMax H3 最多支持 3 个参考视频/u);
    assert.match(videoPageSource, /MiniMax H3 最多支持 3 个参考音频/u);
});

test("MiniMax H3 guards official reference formats and keeps long tasks recoverable", () => {
    assert.match(videoServiceSource, /image\/jpeg.*image\/png.*image\/webp/u);
    assert.match(videoServiceSource, /imageMaxBytes: 30 \* 1024 \* 1024/u);
    assert.match(videoServiceSource, /videoMaxBytes: 50 \* 1024 \* 1024/u);
    assert.match(videoServiceSource, /audioMaxBytes: 15 \* 1024 \* 1024/u);
    assert.match(videoServiceSource, /JSON\.stringify\(body\)[\s\S]*?64 \* 1024 \* 1024/u);
    assert.match(videoPageSource, /miniMaxH3ReferenceError\(activeReferences, activeVideoReferences, activeAudioReferences\)/u);
    assert.match(videoPageSource, /const \{ maxAttempts, delayMs: pollDelayMs \} = videoGenerationPollingPolicy\(log\.task\)/u);
    assert.match(videoServiceSource, /isMiniMaxHailuoModel\(modelOptionName\(task\.model\)\)[\s\S]*?delayMs: 10_000, maxAttempts: 91/u);
    assert.match(videoServiceSource, /if \(task\.provider === "minimax"\) return \{ delayMs: 5_000, maxAttempts: 181 \}/u);
    assert.match(videoPageSource, /status: "生成中" as const[\s\S]*?task: log\.task/u);
    assert.match(videoPageSource, /云端任务仍在处理中，可从生成记录继续查询/u);
});

test("MiniMax Hailuo uses V1 create-query-retrieve and preserves exact string IDs", () => {
    assert.match(videoServiceSource, /export type VideoGenerationTask = \{ id: string;/u);
    assert.match(videoServiceSource, /postVideoJson<MiniMaxHailuoTaskResponse>\(config, buildMiniMaxEndpoint\(config\.baseUrl, "video-hailuo"\), body, options\)/u);
    assert.match(
        videoServiceSource,
        /getVideoJson<MiniMaxHailuoTaskResponse>\(config, buildMiniMaxEndpoint\(config\.baseUrl, "video-hailuo-query", task\.id\), options\)[\s\S]*?getVideoJson<MiniMaxHailuoFileResponse>\(config, buildMiniMaxEndpoint\(config\.baseUrl, "video-retrieve", state\.fileId\), options\)/u,
    );
    assert.match(videoServiceSource, /return \{ id: parseMiniMaxHailuoCreateResponse\(payload\), provider: "minimax", model \}/u);
    assert.match(videoServiceSource, /parseMiniMaxHailuoFileResponse\(filePayload\)/u);
    assert.doesNotMatch(videoServiceSource, /(?:Number|parseInt)\(\s*(?:task\.id|state\.fileId|payload\.(?:task_id|file_id))/u);
    assert.match(videoServiceSource, /getDesktopModelJson<T>\(url, config\.apiKey\)/u);
    assert.match(videoServiceSource, /postDesktopModelJson<T>\(url, config\.apiKey, body\)/u);
});

test("MiniMax Hailuo service enforces media inputs without local plan filtering", () => {
    assert.match(videoServiceSource, /isMiniMaxHailuoModel\(requestConfig\.model\)[\s\S]*?createMiniMaxHailuoTask/u);
    assert.doesNotMatch(videoServiceSource, /minimaxTokenPlanVideoAccess|assertMiniMaxBillingSupports/u);
    assert.match(videoServiceSource, /references\.length > 1[\s\S]*?最多支持一张首帧图片/u);
    assert.match(videoServiceSource, /minimax-hailuo-2\.3-fast[\s\S]*?references\.length !== 1[\s\S]*?需要一张首帧图片/u);
    assert.match(videoServiceSource, /videoReferences\.length \|\| audioReferences\.length[\s\S]*?不支持参考视频或音频/u);
    assert.match(videoServiceSource, /miniMaxHailuoImageError\(\{[\s\S]*?bytes:[\s\S]*?width: image\.width,[\s\S]*?height: image\.height/u);
});

test("MiniMax Hailuo workbench exposes only first-frame native controls", () => {
    assert.match(videoPanelSource, /ui\.experience === "minimax-hailuo-video"/u);
    assert.match(videoPanelSource, /MINIMAX_HAILUO_RESOLUTIONS/u);
    assert.match(videoPanelSource, /MINIMAX_HAILUO_DURATIONS/u);
    assert.match(videoPanelSource, /提示词优化/u);
    assert.match(videoPanelSource, /快速预处理/u);
    assert.match(videoPanelSource, /添加水印/u);
    assert.match(videoPanelSource, /Fast 模型需要一张首帧图片/u);
    assert.doesNotMatch(videoPanelSource, /当前 Token Plan Key 未返回视频额度|套餐权益/u);
    assert.match(videoPageSource, /const maxImageReferences = [^;]*isMiniMaxHailuo \? 1/u);
    assert.match(videoPageSource, /const supportsVideoReferences = [^;]*isMiniMaxH3[^;]*;/u);
    assert.match(videoPageSource, /const supportsAudioReferences = [^;]*isMiniMaxH3[^;]*;/u);
    assert.match(videoPageSource, /accept=\{isMiniMaxHailuo \? "image\/jpeg,image\/png,image\/webp"/u);
    assert.match(videoPageSource, /maxLength=\{isMiniMaxHailuo \? 2000 : undefined\}/u);
    assert.match(videoPageSource, /miniMaxHailuoReferenceError\(modelOptionName\(model\), activeReferences, activeVideoReferences, activeAudioReferences\)/u);
});

test("MiniMax Hailuo model and parameters persist in logs and canvas results", () => {
    assert.match(configStoreSource, /minimaxVideoPromptOptimizer: string/u);
    assert.match(configStoreSource, /minimaxVideoFastPretreatment: string/u);
    assert.match(videoPageSource, /GenerationLogConfig = Pick<\s*AiConfig,[^;]*"minimaxVideoPromptOptimizer"[^;]*"minimaxVideoFastPretreatment"/u);
    assert.match(videoPageSource, /log\.model \|\| t\("视频模型"\)/u);
    assert.match(videoPageSource, /log\.config\.minimaxVideoPromptOptimizer/u);
    assert.match(videoPageSource, /log\.config\.minimaxVideoFastPretreatment/u);
    assert.match(canvasTypesSource, /minimaxVideoPromptOptimizer\?: string/u);
    assert.match(canvasTypesSource, /minimaxVideoFastPretreatment\?: string/u);
    assert.match(canvasGenerationSource, /minimaxVideoPromptOptimizer: node\?\.metadata\?\.minimaxVideoPromptOptimizer/u);
    assert.match(canvasGenerationSource, /minimaxVideoFastPretreatment: node\?\.metadata\?\.minimaxVideoFastPretreatment/u);
    assert.match(canvasNodeSource, /node\.metadata\.model \? modelOptionName\(node\.metadata\.model\) : ""/u);
    assert.match(canvasNodeSource, /node\.metadata\.minimaxVideoPromptOptimizer/u);
    assert.match(canvasNodeSource, /node\.metadata\.minimaxVideoFastPretreatment/u);
});

test("restored Hailuo tasks fail closed when their original channel was deleted", () => {
    assert.match(videoPageSource, /try \{\s*const taskConfig = buildVideoConfig\(\{ \.\.\.effectiveConfig, \.\.\.log\.config \}, log\.task\.model \|\| log\.model\)/u);
    assert.match(
        videoPageSource,
        /const restoredVideoModel = log\.config\.videoModel \|\| log\.model;[\s\S]*?try \{[\s\S]*?resolveModelRequestConfig\(effectiveConfig, restoredVideoModel\);[\s\S]*?updateConfig\("videoModel", restoredVideoModel\);[\s\S]*?catch \(error\)/u,
    );
    assert.doesNotMatch(videoPageSource, /if \(log\.config\.videoModel \|\| log\.model\) updateConfig\("videoModel"/u);
});

test("MiniMax H3 mode persists in the workbench log and canvas node metadata", () => {
    assert.match(configStoreSource, /minimaxVideoInputMode: MiniMaxVideoInputMode/u);
    assert.match(configStoreSource, /minimaxVideoInputMode: "auto"/u);
    assert.match(videoPageSource, /GenerationLogConfig = Pick<\s*AiConfig,[^;]*"minimaxVideoInputMode"/u);
    assert.match(videoPageSource, /updateConfig\("minimaxVideoInputMode", log\.config\.minimaxVideoInputMode\)/u);
    assert.match(canvasTypesSource, /minimaxVideoInputMode\?: "auto" \| "first-frame" \| "last-frame" \| "first-last" \| "reference"/u);
    assert.match(canvasGenerationSource, /minimaxVideoInputMode: node\?\.metadata\?\.minimaxVideoInputMode/u);
});
