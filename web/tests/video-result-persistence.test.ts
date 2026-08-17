import assert from "node:assert/strict";
import test from "node:test";

import { finalizePluginVideoResult, persistGeneratedVideo, type PersistedVideoFile } from "../src/lib/video-result-persistence.ts";

const storedVideo: PersistedVideoFile = {
    url: "asset://localhost/video.mp4",
    storageKey: "video:stored",
    bytes: 42,
    mimeType: "video/mp4",
};

test("desktop remote video persistence failure is explicit and never returns an unowned URL", async () => {
    await assert.rejects(
        persistGeneratedVideo(
            { url: "https://provider.example/result.mp4", mimeType: "video/mp4" },
            async () => {
                throw new Error("native fetch failed");
            },
            true,
        ),
        /视频已生成，但无法保存到本地：native fetch failed/,
    );
});

test("desktop native persistence string errors retain their actionable detail", async () => {
    await assert.rejects(
        persistGeneratedVideo(
            { url: "https://provider.example/result.mp4", mimeType: "video/mp4" },
            async () => {
                throw "无法解析媒体服务器地址";
            },
            true,
        ),
        /视频已生成，但无法保存到本地：无法解析媒体服务器地址/,
    );
});

test("desktop video results return only after local persistence provides a storage key", async () => {
    const result = await persistGeneratedVideo({ url: "https://provider.example/result.mp4" }, async () => storedVideo, true);
    assert.deepEqual(result, storedVideo);
    assert.equal(result.storageKey, "video:stored");
});

test("web video results may retain the remote URL when browser persistence is unavailable", async () => {
    const result = await persistGeneratedVideo(
        { url: "https://provider.example/result.webm", mimeType: "video/webm" },
        async () => {
            throw new Error("indexeddb unavailable");
        },
        false,
    );

    assert.deepEqual(result, {
        url: "https://provider.example/result.webm",
        storageKey: "",
        bytes: 0,
        mimeType: "video/webm",
    });
});

test("plugin video results publish durable ownership and retain all media metadata", async () => {
    const completeVideo: PersistedVideoFile = {
        ...storedVideo,
        width: 1920,
        height: 1080,
        durationMs: 8_000,
    };
    const published: PersistedVideoFile[] = [];
    const discarded: PersistedVideoFile[] = [];

    const result = await finalizePluginVideoResult(
        completeVideo,
        (file) => {
            published.push(file);
            return true;
        },
        async (file) => {
            discarded.push(file);
            return true;
        },
    );

    assert.deepEqual(result, completeVideo);
    assert.deepEqual(published, [completeVideo]);
    assert.deepEqual(discarded, []);
});

test("plugin video results reject remote-only files and discard provisional ownership", async () => {
    const remoteOnly: PersistedVideoFile = {
        url: "https://provider.example/result.mp4",
        storageKey: "",
        bytes: 0,
        mimeType: "video/mp4",
    };
    const discarded: PersistedVideoFile[] = [];

    await assert.rejects(
        finalizePluginVideoResult(
            remoteOnly,
            () => true,
            async (file) => {
                discarded.push(file);
                return true;
            },
        ),
        /视频未能保存到本地，请重试/,
    );
    assert.deepEqual(discarded, [remoteOnly]);
});

test("plugin video results discard the upload when ownership publication fails", async () => {
    const discarded: PersistedVideoFile[] = [];

    await assert.rejects(
        finalizePluginVideoResult(
            storedVideo,
            () => false,
            async (file) => {
                discarded.push(file);
                return true;
            },
        ),
        /视频未能完成保存，请重试/,
    );
    assert.deepEqual(discarded, [storedVideo]);
});
