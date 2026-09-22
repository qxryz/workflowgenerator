import test from "node:test";
import assert from "node:assert/strict";

import { hydrateStructuredAssetMedia, shouldRefreshStoredAssetCover } from "../src/lib/asset-media.ts";

test("refreshes persisted local image cover URLs from their storage key", () => {
    assert.equal(shouldRefreshStoredAssetCover("wg-media://localhost/images/old-version", "wg-media://localhost/images/old-version"), true);
    assert.equal(shouldRefreshStoredAssetCover("blob:old-renderer", "blob:old-renderer"), true);
    assert.equal(shouldRefreshStoredAssetCover("data:image/png;base64,old", "data:image/png;base64,old"), true);
});

test("keeps a custom remote cover that is separate from the stored image", () => {
    assert.equal(shouldRefreshStoredAssetCover("https://example.com/custom-cover.jpg", "wg-media://localhost/images/version"), false);
});

test("local and synced structured assets resolve all image versions without changing reference identities", async () => {
    for (const kind of ["character", "scene"] as const) {
        const asset = {
            id: "asset-1",
            kind,
            title: "角色",
            coverUrl: "blob:expired",
            tags: [],
            createdAt: "created",
            updatedAt: "updated",
            data: {
                description: "角色资料",
                fields: { 衣服: "蓝色" },
                referencePrompt: "服饰参考 @[node:old]，正面参考 @[node:current]",
                images: [
                    { id: "old", title: "旧版", storageKey: "image:old", dataUrl: "blob:old", isCurrent: false, width: 10, height: 10, bytes: 1, mimeType: "image/png" },
                    { id: "current", title: "当前", storageKey: "image:current", dataUrl: "wg-media://old", isCurrent: true, width: 10, height: 10, bytes: 1, mimeType: "image/png" },
                    { id: "remote", title: "公网图片", dataUrl: "https://example.com/image.png", width: 10, height: 10, bytes: 1, mimeType: "image/png" },
                ],
            },
        };
        const calls: string[] = [];
        const hydrated = await hydrateStructuredAssetMedia(asset, async (key) => {
            calls.push(key);
            return `resolved:${key}`;
        });
        assert.deepEqual(calls, ["image:old", "image:current"]);
        assert.equal(hydrated.coverUrl, "resolved:image:current");
        assert.deepEqual(
            hydrated.data.images.map((image) => image.id),
            ["old", "current", "remote"],
        );
        assert.equal(hydrated.data.images[0].dataUrl, "resolved:image:old");
        assert.equal(hydrated.data.images[2].dataUrl, "https://example.com/image.png");
        assert.equal(hydrated.data.referencePrompt, asset.data.referencePrompt);
        assert.equal(asset.data.images[0].dataUrl, "blob:old", "hydration does not mutate the source snapshot");
    }
});

test("collection avatars remain the display cover after stored media URLs are restored", async () => {
    const image = (id: string) => ({ id, title: id, storageKey: `image:${id}`, dataUrl: `blob:${id}`, isCurrent: true, width: 10, height: 10, bytes: 1, mimeType: "image/png" });
    const asset = {
        id: "collected",
        kind: "character" as const,
        title: "角色",
        coverUrl: "blob:avatar",
        tags: [],
        createdAt: "created",
        updatedAt: "updated",
        data: { collectionVersion: 1 as const, description: "仅展示", fields: {}, avatarImageId: "avatar", images: [image("main"), { ...image("avatar"), partId: "avatar" }] },
    };
    const result = await hydrateStructuredAssetMedia(asset, async (key) => `resolved:${key}`);
    assert.equal(result.coverUrl, "resolved:image:avatar");
    assert.equal(result.data.avatarImageId, "avatar");
});

test("cleared or missing collection avatars never fall back to collected images or stale covers", async () => {
    for (const kind of ["character", "scene"] as const) {
        for (const avatarImageId of [undefined, "deleted-avatar"]) {
            const asset = {
                id: "collected",
                kind,
                title: "角色",
                coverUrl: "blob:stale-avatar",
                tags: [],
                createdAt: "created",
                updatedAt: "updated",
                data: {
                    collectionVersion: 1 as const,
                    avatarImageId,
                    description: "",
                    fields: {},
                    images: [{ id: "main", title: "主视图", storageKey: "image:main", dataUrl: "blob:main", isCurrent: true, width: 10, height: 10, bytes: 1, mimeType: "image/png" }],
                },
            };
            const restored = await hydrateStructuredAssetMedia(asset, async (key) => `resolved:${key}`);
            assert.equal(restored.coverUrl, "");
            assert.equal(restored.data.images[0].dataUrl, "resolved:image:main");
        }
    }
});

test("structured voice files resolve through the native media resolver without changing IDs or selections", async () => {
    const asset = {
        id: "c",
        kind: "character" as const,
        title: "角色",
        coverUrl: "",
        tags: [],
        createdAt: "",
        updatedAt: "",
        data: { description: "", fields: {}, images: [], audios: [{ id: "voice", title: "音色", url: "blob:expired", storageKey: "audio:voice", bytes: 16, mimeType: "audio/wav", durationMs: 1200, isCurrent: false }] },
    };
    const result = await hydrateStructuredAssetMedia(
        asset,
        async (key) => `image:${key}`,
        async (key) => `media:${key}`,
    );
    assert.deepEqual(result.data.audios, [{ ...asset.data.audios[0], url: "media:audio:voice" }]);
    assert.equal(asset.data.audios[0].url, "blob:expired");
});
