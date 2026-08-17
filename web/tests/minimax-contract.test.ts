import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
    assertMiniMaxCredentialMatches,
    buildMiniMaxEndpoint,
    buildMiniMaxHailuoRequest,
    buildMiniMaxH3Request,
    buildMiniMaxImageRequest,
    buildMiniMaxSpeechRequest,
    buildMiniMaxVoiceCloneRequest,
    miniMaxCredentialError,
    miniMaxCredentialKind,
    normalizeMiniMaxOrigin,
    miniMaxHailuoImageError,
    normalizeMiniMaxHailuoVideoOptions,
    parseMiniMaxHailuoCreateResponse,
    parseMiniMaxHailuoFileResponse,
    parseMiniMaxHailuoQueryResponse,
    parseMiniMaxH3CreateResponse,
    parseMiniMaxH3QueryResponse,
    parseMiniMaxImageResponse,
    parseMiniMaxSpeechResponse,
} from "../src/lib/minimax-contract.ts";

describe("MiniMax native contract", () => {
    it("keeps Token Plan and API billing credentials in their declared adapters", () => {
        assert.equal(miniMaxCredentialKind("  sk-cp-example  "), "token-plan");
        assert.equal(miniMaxCredentialKind("SK-API-example"), "payg");
        assert.equal(miniMaxCredentialKind("legacy-example"), "unknown");
        assert.equal(miniMaxCredentialError("token-plan", "sk-cp-example"), "");
        assert.equal(miniMaxCredentialError("payg", "sk-api-example"), "");
        assert.match(miniMaxCredentialError("payg", "sk-cp-example"), /Token Plan Key.*按量计费 API Key/u);
        assert.match(miniMaxCredentialError("token-plan", "sk-api-example"), /按量计费 API Key.*Token Plan Key/u);
        assert.throws(() => assertMiniMaxCredentialMatches("payg", "sk-cp-example"), /请改用按量计费 API Key/u);
        assert.throws(() => assertMiniMaxCredentialMatches("token-plan", "sk-api-example"), /请改用 Token Plan Key/u);
    });

    it("derives exact v1/v2/anthropic routes from either configured connection", () => {
        assert.equal(normalizeMiniMaxOrigin("https://api.minimaxi.com/anthropic"), "https://api.minimaxi.com");
        assert.equal(normalizeMiniMaxOrigin("https://api.minimaxi.com/v1/"), "https://api.minimaxi.com");
        assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/anthropic", "text"), "https://api.minimaxi.com/anthropic/v1/messages");
        assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/v1", "image"), "https://api.minimaxi.com/v1/image_generation");
        assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com", "video-h3"), "https://api.minimaxi.com/v2/video_generation");
        assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com", "video-query", "task / 1"), "https://api.minimaxi.com/v2/query/video_generation/task%20%2F%201");
    });

    it("uses the Hailuo V1 create, query, and retrieve routes without coercing IDs", () => {
        const taskId = "9007199254740993123456789";
        const fileId = "0009007199254740993123456789";
        assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/anthropic", "video-hailuo"), "https://api.minimaxi.com/v1/video_generation");
        assert.equal(
            buildMiniMaxEndpoint("https://api.minimaxi.com/v1", "video-hailuo-query", taskId),
            `https://api.minimaxi.com/v1/query/video_generation?task_id=${taskId}`,
        );
        assert.equal(
            buildMiniMaxEndpoint("https://api.minimaxi.com/v2", "video-retrieve", fileId),
            `https://api.minimaxi.com/v1/files/retrieve?file_id=${fileId}`,
        );
        assert.throws(() => buildMiniMaxEndpoint("https://api.minimaxi.com", "video-hailuo-query", 123 as unknown as string), /任务 ID 不能为空/);
        assert.throws(() => buildMiniMaxEndpoint("https://api.minimaxi.com", "video-retrieve", 123 as unknown as string), /文件 ID 不能为空/);
    });

    it("serializes the complete Hailuo body and enforces Fast first-frame input", () => {
        assert.deepEqual(
            buildMiniMaxHailuoRequest("MiniMax-Hailuo-2.3", {
                prompt: "  海面上缓慢推进的镜头  ",
                firstFrameImage: "data:image/webp;base64,AAAA",
                duration: 6,
                resolution: "1080P",
                promptOptimizer: false,
                fastPretreatment: true,
                watermark: true,
            }),
            {
                model: "MiniMax-Hailuo-2.3",
                prompt: "海面上缓慢推进的镜头",
                first_frame_image: "data:image/webp;base64,AAAA",
                duration: 6,
                resolution: "1080P",
                prompt_optimizer: false,
                fast_pretreatment: false,
                aigc_watermark: true,
            },
        );
        assert.deepEqual(
            buildMiniMaxHailuoRequest("MiniMax-Hailuo-2.3", {
                prompt: "纯文本生成",
                duration: 10,
                resolution: "1080P",
            }),
            {
                model: "MiniMax-Hailuo-2.3",
                prompt: "纯文本生成",
                duration: 10,
                resolution: "768P",
                prompt_optimizer: true,
                fast_pretreatment: false,
                aigc_watermark: false,
            },
        );
        assert.deepEqual(normalizeMiniMaxHailuoVideoOptions("1080P", 10), { resolution: "768P", duration: 10 });
        assert.deepEqual(normalizeMiniMaxHailuoVideoOptions("1080P", 6), { resolution: "1080P", duration: 6 });
        assert.throws(
            () => buildMiniMaxHailuoRequest("MiniMax-Hailuo-2.3-Fast", { prompt: "missing frame", duration: 6, resolution: "768P" }),
            /需要一张首帧图片/,
        );
        assert.throws(
            () => buildMiniMaxHailuoRequest("MiniMax-Hailuo-2.3", { prompt: "x".repeat(2001), duration: 6, resolution: "768P" }),
            /不能超过 2000/,
        );
    });

    it("validates reliable Hailuo image metadata and does not guess missing dimensions", () => {
        assert.equal(miniMaxHailuoImageError({ mimeType: "image/webp", bytes: 20 * 1024 * 1024 - 1, width: 1000, height: 400 }), "");
        assert.match(miniMaxHailuoImageError({ mimeType: "image/gif" }), /JPEG、PNG 或 WebP/);
        assert.match(miniMaxHailuoImageError({ bytes: 20 * 1024 * 1024 }), /小于 20MB/);
        assert.match(miniMaxHailuoImageError({ width: 300, height: 1000 }), /短边需要大于 300px/);
        assert.match(miniMaxHailuoImageError({ width: 301, height: 1000 }), /宽高比/);
        assert.equal(miniMaxHailuoImageError({ mimeType: "image/png" }), "");
    });

    it("parses Hailuo string IDs, official states, file URLs, and base_resp errors", () => {
        const taskId = "9007199254740993123456789";
        const fileId = "9007199254740993987654321";
        assert.equal(parseMiniMaxHailuoCreateResponse({ task_id: taskId, base_resp: { status_code: 0 } }), taskId);
        assert.throws(() => parseMiniMaxHailuoCreateResponse({ task_id: 9007199254740993 as unknown as string }), /任务 ID/);
        for (const status of ["Preparing", "Queueing", "Processing"]) {
            assert.deepEqual(parseMiniMaxHailuoQueryResponse({ status }), { status: "pending" });
        }
        assert.deepEqual(parseMiniMaxHailuoQueryResponse({ status: "Success", file_id: fileId }), { status: "completed", fileId });
        assert.throws(() => parseMiniMaxHailuoQueryResponse({ status: "Success", file_id: 42 as unknown as string }), /文件 ID/);
        assert.deepEqual(parseMiniMaxHailuoQueryResponse({ status: "Fail", error_message: "审核未通过" }), { status: "failed", error: "审核未通过" });
        assert.equal(
            parseMiniMaxHailuoFileResponse({ file: { file_id: fileId, download_url: " https://example.com/result.mp4 " } }),
            "https://example.com/result.mp4",
        );
        assert.throws(() => parseMiniMaxHailuoFileResponse({ file: { file_id: fileId } }), /没有返回下载地址/);
        assert.throws(
            () => parseMiniMaxHailuoQueryResponse({ status: "Processing", base_resp: { status_code: 1004, status_msg: "invalid key" } }),
            /invalid key/,
        );
    });

    it("serializes image-01 text and one character reference", () => {
        assert.deepEqual(
            buildMiniMaxImageRequest("image-01", {
                prompt: " editorial portrait ",
                ratio: "1920x1080",
                count: 12,
                optimizePrompt: false,
                referenceImage: "data:image/png;base64,AAAA",
            }), {
            model: "image-01",
            prompt: "editorial portrait",
            aspect_ratio: "16:9",
            response_format: "url",
            n: 9,
            prompt_optimizer: false,
            subject_reference: [{ type: "character", image_file: "data:image/png;base64,AAAA" }],
        });
        assert.deepEqual(parseMiniMaxImageResponse({ data: { image_urls: ["https://example.com/image.png"], image_base64: ["AAAA"] } }), [
            "https://example.com/image.png",
            "data:image/jpeg;base64,AAAA",
        ]);
    });

    it("serializes H3 first/last and reference modes without mixing roles", () => {
        const firstLast = buildMiniMaxH3Request("MiniMax-H3", {
            prompt: "camera arcs around the subject",
            mode: "first-last",
            images: ["https://example.com/a.jpg", "https://example.com/b.jpg"],
            resolution: "2k",
            duration: 99,
            ratio: "auto",
            watermark: true,
        });
        assert.equal(firstLast.duration, 15);
        assert.equal(firstLast.resolution, "2K");
        assert.equal(firstLast.ratio, "adaptive");
        assert.deepEqual(firstLast.content.map((part) => part.role).filter(Boolean), ["first_frame", "last_frame"]);
        assert.equal(firstLast.ratio, "adaptive");
        assert.equal(firstLast.aigc_watermark, true);

        const lastFrame = buildMiniMaxH3Request("MiniMax-H3", {
            prompt: "end on the supplied image",
            mode: "last-frame",
            images: ["https://example.com/end.jpg"],
            resolution: "768P",
            duration: 6,
            ratio: "16:9",
        });
        assert.deepEqual(lastFrame.content.map((part) => part.role).filter(Boolean), ["last_frame"]);
        assert.equal(lastFrame.ratio, "adaptive");

        const references = buildMiniMaxH3Request("MiniMax-H3", {
            prompt: "use the look and soundtrack",
            mode: "reference",
            images: ["asset://image"],
            videos: ["asset://video"],
            audios: ["asset://audio"],
            resolution: "768",
            duration: 8,
            ratio: "9:16",
        });
        assert.deepEqual(references.content.map((part) => part.role).filter(Boolean), ["reference_image", "reference_video", "reference_audio"]);
        assert.throws(() =>
            buildMiniMaxH3Request("MiniMax-H3", {
                prompt: "invalid",
                mode: "first-frame",
                images: ["a"],
                videos: ["v"],
                resolution: "768P",
                duration: 6,
                ratio: "16:9",
            }), /首帧模式需要且只使用 1 张图片/);

        const autoReference = buildMiniMaxH3Request("MiniMax-H3", {
            prompt: "keep both people as visual references",
            mode: "reference",
            images: ["asset://one", "asset://two"],
            resolution: "768P",
            duration: 6,
            ratio: "1:1",
        });
        assert.deepEqual(autoReference.content.map((part) => part.role).filter(Boolean), ["reference_image", "reference_image"]);
    });

    it("parses the H3 V2 asynchronous task shape", () => {
        assert.equal(parseMiniMaxH3CreateResponse({ task_id: "h3-1" }), "h3-1");
        assert.deepEqual(parseMiniMaxH3QueryResponse({ task: { status: "running" } }), { status: "pending" });
        assert.deepEqual(parseMiniMaxH3QueryResponse({ task: { status: "succeeded", content: { url: "https://example.com/video.mp4" } } }), {
            status: "completed",
            url: "https://example.com/video.mp4",
        });
    });

    it("serializes Speech 2.8 controls and accepts URL or hex audio", () => {
        const body = buildMiniMaxSpeechRequest("speech-2.8-hd", {
            text: "你好",
            voiceId: "Chinese (Mandarin)_Gentleman",
            speed: 9,
            volume: 11,
            pitch: -99,
            format: "wav",
            sampleRate: 32_000,
        });
        assert.deepEqual(body.voice_setting, { voice_id: "Chinese (Mandarin)_Gentleman", speed: 2, vol: 10, pitch: -12 });
        assert.deepEqual(body.audio_setting, { format: "wav", sample_rate: 32_000, bitrate: 128_000, channel: 1 });
        assert.equal(body.aigc_watermark, false);
        assert.equal(parseMiniMaxSpeechResponse({ data: { audio: "https://example.com/audio.mp3" } }), "https://example.com/audio.mp3");
        assert.equal(parseMiniMaxSpeechResponse({ data: { audio: "4944" } }, "wav"), "data:audio/wav;base64,SUQ=");
    });

    it("validates the user-owned voice id before cloning", () => {
        assert.deepEqual(JSON.parse(buildMiniMaxVoiceCloneRequest("123", "Narrator_01", "speech-2.8-hd")), {
            file_id: 123,
            voice_id: "Narrator_01",
            need_noise_reduction: true,
            need_volume_normalization: true,
            aigc_watermark: false,
        });
        assert.throws(() => buildMiniMaxVoiceCloneRequest("123", "bad", "speech-2.8-hd"), /8–256/);
    });
});
