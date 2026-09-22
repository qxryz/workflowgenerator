import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

globalThis.__structuredAssetPersistence = { storage: new Map(), blobs: new Map(), remote: new Map(), exported: undefined };
globalThis.window = { setTimeout: () => 0 };
const state = globalThis.__structuredAssetPersistence;
const mocks = new Map([
    [
        "@/lib/server-state-storage",
        `const state = globalThis.__structuredAssetPersistence; export const serverStateStorage = { getItem: async key => state.storage.get(key) || null, setItem: async (key, value) => { if (state.beforeWrite) await state.beforeWrite(); state.storage.set(key, value); if (state.corruptWrite) state.storage.set(key, JSON.stringify({ state: { assets: [] }, version: 0 })); }, removeItem: async key => { state.storage.delete(key); } };`,
    ],
    [
        "@/services/image-storage",
        `const state = globalThis.__structuredAssetPersistence; export const resolveImageUrl = async key => 'resolved:' + key; export const cleanupUnusedImages = async () => {}; export const uploadImage = async () => { throw new Error('unexpected upload'); }; export const getImageBlob = async key => state.blobs.get(key); export const setImageBlob = async (key, value) => { state.blobs.set(key, value); };`,
    ],
    [
        "@/services/file-storage",
        `export const cleanupUnusedMedia = async () => {}; export const resolveMediaUrl = async (key, fallback) => key ? "resolved:" + key : fallback; export const getMediaBlob = async key => globalThis.__structuredAssetPersistence.blobs.get(key); export const setMediaBlob = async (key, blob) => { globalThis.__structuredAssetPersistence.blobs.set(key, blob); };`,
    ],
    ["@/services/asset-file-storage", `export const cleanupUnusedAssetFiles = async () => {}; export const getAssetFileBlob = async () => null; export const setAssetFileBlob = async () => {};`],
    ["@/services/media-retention-policy", `export const markMediaReferencesChanged = () => {}; export const withMediaStorageFence = operation => operation();`],
    ["@/services/media-reference-snapshot", `export const registerRuntimeMediaReferenceProvider = () => () => {};`],
    ["@/lib/canvas/canvas-portability", `export const normalizeCanvasProject = value => value;`],
    ["@/stores/canvas/use-canvas-store", `const state = { hydrated: true, projects: [], replaceProjects: projects => { state.projects = projects; } }; export const useCanvasStore = { getState: () => state, subscribe: () => () => {} };`],
    [
        "@/services/webdav-sync",
        `const state = globalThis.__structuredAssetPersistence; export const WEBDAV_MANIFEST_FILE_NAME = 'manifest.json'; export const normalizeWebdavPath = value => value; export const downloadWebdavFile = async (config, path) => state.remote.get(path) || null; export const uploadWebdavFile = async (config, path, blob) => { state.remote.set(path, blob); };`,
    ],
    ["file-saver", `export const saveAs = blob => { globalThis.__structuredAssetPersistence.exported = blob; };`],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (mocks.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks.get(specifier))}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]s$/.test(specifier)) {
            const url = new URL(`${specifier}.ts`, context.parentURL);
            if (existsSync(url)) return nextResolve(url.href, context);
        }
        return nextResolve(specifier, context);
    },
});

const { useAssetStore } = await import("../src/stores/use-asset-store.ts");
const { exportAssets, readAssetPackage } = await import("../src/pages/assets/asset-transfer.ts");
const { createZip } = await import("../src/lib/zip.ts");
const { syncAppDataToWebdav } = await import("../src/services/app-sync.ts");
const image = (id, current) => ({ id, title: id, partId: "hero", versionId: `version-${id}`, isCurrent: current, storageKey: `image:${id}`, dataUrl: `blob:${id}`, width: 10, height: 10, bytes: 3, mimeType: "image/png" });
const asset = (kind) => ({
    kind,
    title: "小狸",
    coverUrl: "blob:old",
    tags: [],
    data: { description: "蓝色围巾", fields: { 性格: "害羞" }, parts: [], referencePrompt: "服饰参考 @[node:old]，外形参考 @[node:current]", images: [image("old", false), image("current", true)] },
});

test("asset upsert and rehydration retain authored reference text and original image IDs", async () => {
    for (const kind of ["character", "scene"]) {
        const id = await useAssetStore.getState().upsertAssetPersisted(undefined, asset(kind));
        const revised = { ...asset(kind), data: { ...asset(kind).data, referencePrompt: "自定义 @[node:old]，保留这个版本。" } };
        assert.equal(await useAssetStore.getState().upsertAssetPersisted(id, revised), id);
        await useAssetStore.persist.rehydrate();
        const restored = useAssetStore.getState().assets.find((item) => item.id === id);
        assert.equal(restored.data.referencePrompt, revised.data.referencePrompt);
        assert.deepEqual(
            restored.data.images.map((item) => item.id),
            ["old", "current"],
        );
        assert.equal(restored.data.images[0].dataUrl, "resolved:image:old");
        assert.equal(restored.coverUrl, "resolved:image:current");
    }
});

test("real asset ZIP export/import preserves reference prompts, images and legacy absence", async () => {
    for (const key of ["image:old", "image:current"]) state.blobs.set(key, new Blob(["abc"], { type: "image/png" }));
    const assets = useAssetStore.getState().assets;
    const legacy = { ...assets[0], id: "legacy", data: { ...assets[0].data } };
    delete legacy.data.referencePrompt;
    await exportAssets([...assets, legacy]);
    const restored = await readAssetPackage(new File([state.exported], "assets.zip", { type: "application/zip" }));
    assert.deepEqual(restored, [...assets, legacy]);
    assert.equal(Object.hasOwn(restored.at(-1).data, "referencePrompt"), false);
    assert.equal(await state.blobs.get("image:old").text(), "abc");
});

test("WebDAV merge restores structured image URLs and keeps explicit historical references", async () => {
    useAssetStore.getState().replaceAssets([]);
    const remoteAssets = ["character", "scene"].map((kind) => ({ ...asset(kind), id: `remote-${kind}`, createdAt: "2026-09-01", updatedAt: "2026-09-15" }));
    state.remote.set("assets/manifest.json", new Blob([JSON.stringify({ app: "infinite-canvas", version: 1, domain: "assets", data: { assets: remoteAssets }, files: [] })]));
    const result = await syncAppDataToWebdav({});
    assert.equal(result.assets, 2);
    for (const hydrated of useAssetStore.getState().assets) {
        assert.equal(hydrated.data.referencePrompt, remoteAssets[0].data.referencePrompt);
        assert.deepEqual(
            hydrated.data.images.map((item) => item.dataUrl),
            ["resolved:image:old", "resolved:image:current"],
        );
        assert.deepEqual(
            hydrated.data.images.map((item) => item.id),
            ["old", "current"],
        );
        assert.equal(hydrated.coverUrl, "resolved:image:current");
    }
});

test("collection assets preserve enabled sets, relationship links and avatar files through ZIP and hydration", async () => {
    for (const kind of ["character", "scene"]) {
        const original = asset(kind);
        const collected = {
            ...original,
            coverUrl: "blob:avatar",
            data: {
                ...original.data,
                collectionVersion: 1,
                avatarImageId: "avatar",
                parts: [{ id: "outfit", groupId: "outfit", title: "雨衣", description: "", expectedOutput: "", prompt: "黄色雨衣", enabled: false }],
                relationships: [{ id: "relation", targetAssetId: "neighbor", targetName: "小熊", label: "邻居" }],
                referencePrompt: "@[node:outfit]\n@[node:relationships]",
                images: [...original.data.images, { ...image("avatar", true), partId: "avatar" }],
            },
        };
        const id = await useAssetStore.getState().upsertAssetPersisted(undefined, collected);
        await useAssetStore.persist.rehydrate();
        const hydrated = useAssetStore.getState().assets.find((item) => item.id === id);
        assert.equal(hydrated.coverUrl, "resolved:image:avatar");
        assert.equal(hydrated.data.collectionVersion, 1);
        assert.equal(hydrated.data.parts[0].enabled, false);
        assert.deepEqual(
            hydrated.data.relationships,
            collected.data.relationships.map((relation) => ({ ...relation, sourceAssetId: id, sourceName: collected.title })),
        );
        state.blobs.set("image:avatar", new Blob(["avatar pixels"], { type: "image/png" }));
        await exportAssets([hydrated]);
        state.blobs.delete("image:avatar");
        const [restored] = await readAssetPackage(new File([state.exported], "collection.zip", { type: "application/zip" }));
        assert.deepEqual(restored, hydrated);
        assert.equal(await state.blobs.get("image:avatar").text(), "avatar pixels");
    }
});

test("removing a collection avatar stays cleared after save and restart hydration", async () => {
    for (const kind of ["character", "scene"]) {
        const collected = { ...asset(kind), coverUrl: "blob:avatar", data: { ...asset(kind).data, collectionVersion: 1, avatarImageId: "avatar", images: [image("current", true), { ...image("avatar", true), partId: "avatar" }] } };
        const id = await useAssetStore.getState().upsertAssetPersisted(undefined, collected);
        await useAssetStore.getState().upsertAssetPersisted(id, { ...collected, coverUrl: "", data: { ...collected.data, avatarImageId: undefined, images: [image("current", true)] } });
        await useAssetStore.persist.rehydrate();
        const restored = useAssetStore.getState().assets.find((item) => item.id === id);
        assert.equal(restored.coverUrl, "");
        assert.equal(restored.data.avatarImageId, undefined);
        assert.equal(restored.data.images[0].dataUrl, "resolved:image:current");
    }
});

const collection = (title) => ({ ...asset("character"), title, data: { ...asset("character").data, collectionVersion: 1, referencePrompt: "自定义正文", images: [], relationships: [] } });

test("persisted relationship changes publish both endpoints after acknowledgment and survive restart", async () => {
    useAssetStore.getState().replaceAssets([]);
    const a = await useAssetStore.getState().addAssetPersisted(collection("父亲"));
    const b = await useAssetStore.getState().addAssetPersisted(collection("女儿"));
    let release;
    state.beforeWrite = async () => {
        state.beforeWrite = undefined;
        await new Promise((resolve) => {
            release = resolve;
        });
    };
    const payload = collection("父亲");
    payload.data.relationships = [{ id: "family", targetAssetId: b, targetName: "女儿", label: "父亲" }];
    const saving = useAssetStore.getState().upsertAssetPersisted(a, payload);
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    assert.equal(useAssetStore.getState().assets.find((item) => item.id === b).data.relationships.length, 0);
    release();
    await saving;
    await useAssetStore.persist.rehydrate();
    const [parent, child] = [a, b].map((id) => useAssetStore.getState().assets.find((item) => item.id === id));
    assert.equal(parent.data.relationships[0].sourceAssetId, a);
    assert.deepEqual(child.data.relationships, [{ id: "family", targetAssetId: a, targetName: "父亲", label: "父亲", sourceAssetId: a, sourceName: "父亲" }]);
    assert.equal(parent.data.referencePrompt, "自定义正文\n@[node:relationships]");
    assert.equal(child.data.referencePrompt, "自定义正文\n@[node:relationships]");
    await useAssetStore.getState().upsertAssetPersisted(b, { ...child, data: { ...child.data, relationships: [] } });
    assert.deepEqual(
        useAssetStore.getState().assets.map((item) => item.data.relationships),
        [[], []],
    );
});

test("failed or mismatching durable writes do not expose a successful relationship and subsequent saves recover", async () => {
    const original = useAssetStore.getState().assets;
    state.beforeWrite = async () => {
        state.beforeWrite = undefined;
        throw new Error("disk unavailable");
    };
    await assert.rejects(useAssetStore.getState().addAssetPersisted(collection("失败角色")), /disk unavailable/);
    assert.strictEqual(useAssetStore.getState().assets, original);
    state.corruptWrite = true;
    await assert.rejects(useAssetStore.getState().addAssetPersisted(collection("不完整角色")), /尚未写入/);
    state.corruptWrite = false;
    assert.strictEqual(useAssetStore.getState().assets, original);
    const [a, b] = await Promise.all([useAssetStore.getState().addAssetPersisted(collection("并发 A")), useAssetStore.getState().addAssetPersisted(collection("并发 B"))]);
    await useAssetStore.persist.rehydrate();
    assert.ok(useAssetStore.getState().assets.some((item) => item.id === a));
    assert.ok(useAssetStore.getState().assets.some((item) => item.id === b));
});

test("library replacement, updates and deletions all reconcile reciprocal links", () => {
    const a = { ...collection("A"), id: "a", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    const b = { ...collection("B"), id: "b", createdAt: "2026-01-01", updatedAt: "2026-01-01" };
    a.data.relationships = [{ id: "edge", targetAssetId: "b", targetName: "B", label: "邻居" }];
    useAssetStore.getState().replaceAssets([a, b]);
    assert.equal(useAssetStore.getState().assets[1].data.relationships[0].targetAssetId, "a");
    useAssetStore.getState().updateAsset("a", { title: "新名字" });
    assert.equal(useAssetStore.getState().assets[1].data.relationships[0].sourceName, "新名字");
    useAssetStore.getState().removeAsset("a");
    assert.deepEqual(useAssetStore.getState().assets[0].data.relationships, []);
});

test("a library action during a durable write is retained when the queued save publishes", async () => {
    useAssetStore.getState().replaceAssets([]);
    let release;
    state.beforeWrite = async () => {
        state.beforeWrite = undefined;
        await new Promise((resolve) => {
            release = resolve;
        });
    };
    const saving = useAssetStore.getState().addAssetPersisted(collection("保存中"));
    while (!release) await new Promise((resolve) => setTimeout(resolve, 0));
    const concurrent = useAssetStore.getState().addAsset({ kind: "text", title: "同时新增", coverUrl: "", tags: [], data: { content: "保留" } });
    release();
    const saved = await saving;
    await useAssetStore.persist.rehydrate();
    assert.ok(useAssetStore.getState().assets.some((item) => item.id === concurrent));
    assert.ok(useAssetStore.getState().assets.some((item) => item.id === saved));
});

test("voice recordings survive asset save, native hydration, ZIP export and restore", async () => {
    const original = collection("声音角色");
    original.data.audios = [{ id: "voice", title: "日常音色", partId: "voice-profile", url: "blob:expired", storageKey: "audio:voice", durationMs: 2100, bytes: 11, mimeType: "audio/wav", isCurrent: true }];
    original.data.referencePrompt = "@[node:voice]";
    state.blobs.set("audio:voice", new Blob(["voice bytes"], { type: "audio/wav" }));
    const id = await useAssetStore.getState().upsertAssetPersisted(undefined, original);
    await useAssetStore.persist.rehydrate();
    const hydrated = useAssetStore.getState().assets.find((item) => item.id === id);
    assert.deepEqual(hydrated.data.audios, [{ ...original.data.audios[0], url: "resolved:audio:voice" }]);
    await exportAssets([hydrated]);
    state.blobs.delete("audio:voice");
    const [restored] = await readAssetPackage(new File([state.exported], "voice.zip", { type: "application/zip" }));
    assert.deepEqual(restored.data.audios, hydrated.data.audios);
    assert.equal(restored.data.referencePrompt, "@[node:voice]");
    assert.equal(await state.blobs.get("audio:voice").text(), "voice bytes");
    state.blobs.delete("audio:voice");
    await assert.rejects(exportAssets([hydrated]), /音频文件不可用/);
});

test("WebDAV restores structured voice files and native playback URLs", async () => {
    useAssetStore.getState().replaceAssets([]);
    const remote = { ...collection("远端声音"), id: "remote-voice", createdAt: "2026-01-01", updatedAt: "2026-09-16" };
    remote.data.audios = [{ id: "voice", title: "音色", url: "blob:old", storageKey: "audio:remote", bytes: 5, mimeType: "audio/mpeg" }];
    const file = { storageKey: "audio:remote", path: "assets/files/remote.mp3", mimeType: "audio/mpeg", bytes: 5 };
    state.remote.set(file.path, new Blob(["voice"], { type: "audio/mpeg" }));
    state.remote.set("assets/manifest.json", new Blob([JSON.stringify({ app: "infinite-canvas", version: 1, domain: "assets", data: { assets: [remote] }, files: [file] })]));
    await syncAppDataToWebdav({});
    assert.equal(useAssetStore.getState().assets[0].data.audios[0].url, "resolved:audio:remote");
    assert.equal(await state.blobs.get("audio:remote").text(), "voice");
});

test("an incomplete structured voice archive cannot silently import a missing recording", async () => {
    const original = collection("音色缺失");
    original.data.audios = [{ id: "voice", title: "音色", url: "blob:old", storageKey: "audio:missing", bytes: 5, mimeType: "audio/mpeg" }];
    const zip = await createZip([{ name: "assets.json", data: JSON.stringify({ app: "infinite-canvas", version: 1, assets: [original], files: [] }) }]);
    await assert.rejects(readAssetPackage(new File([zip], "broken.zip", { type: "application/zip" })), /音频文件缺失/);
});
