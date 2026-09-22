import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { existsSync } from "node:fs";
import test from "node:test";

const calls = [];
globalThis.__mediaReferenceDeliveryCalls = calls;
const mocks = new Map([
    [
        "axios",
        `export default {
        post: async (url, body) => {
            globalThis.__mediaReferenceDeliveryCalls.push({ url, body });
            return { data: { id: "task", request_id: "task", data: [{ b64_json: "AAAA" }],
                candidates: [{ content: { parts: [{ inlineData: { mimeType: "image/png", data: "AAAA" } }] } }] } };
        }, isAxiosError: () => false, isCancel: () => false
    };`,
    ],
    [
        "@/stores/use-config-store",
        `export const resolveModelRequestConfig = config => config;
        export const resolveModelScript = config => config.testScript;
        export const modelOptionName = model => model;
        export const buildApiUrl = (base, path) => base + path;`,
    ],
    ["@/services/image-storage", `export const imageToDataUrl = async image => image.resolvedDataUrl ?? image.dataUrl;`],
    ["@/services/file-storage", `export const getMediaBlob = async () => null; export const uploadMediaFile = async () => null;`],
    // Seedance (and the raw/minimax adapters) route provider JSON through the
    // server bridge instead of axios. Without this mock the real module loads,
    // calls fetch("/api/model/json-post") and dies on a relative URL in Node.
    [
        "@/services/server-storage",
        `export const postModelJson = async (url, apiKey, body) => {
            globalThis.__mediaReferenceDeliveryCalls.push({ url, body });
            return { id: "task", request_id: "task", status: "queued" };
        };
        export const getModelJson = async () => ({ id: "task", status: "queued" });
        export const postModelRawJson = async () => ({ id: "task" });
        export const postModelMultipart = async () => ({ id: "task" });
        export const proxyModelPost = async () => new Response("");
        export const fetchModelList = async () => ({ data: [] });
        export const flushPendingWrites = async () => undefined;
        export const getStoredValue = async () => null;
        export const setStoredValue = async () => undefined;
        export const removeStoredValue = async () => undefined;
        export const listStoredValues = async () => [];
        export const clearStoredValues = async () => undefined;
        export const commitStoredValues = async () => undefined;
        export const getStoredMedia = async () => null;
        export const readStoredMediaDataUrl = async () => null;
        export const readStoredMediaBlob = async () => null;
        export const putStoredMedia = async () => null;
        export const fetchRemoteMedia = async () => null;
        export const fetchRemoteBytes = async () => new Blob();
        export const removeStoredMedia = async () => undefined;
        export const listStoredMedia = async () => [];
        export const createServerJsonStore = () => ({
            getItem: async () => null,
            setItem: async (key, value) => value,
            removeItem: async () => undefined,
            clear: async () => undefined,
            iterate: async () => undefined,
            keys: async () => [],
        });`,
    ],
    [
        "./model-plugin",
        `export const runModelPlugin = async input => {
            globalThis.__mediaReferenceDeliveryCalls.push({ body: input }); return "https://example.com/generated.mp4";
        }; export const normalizePluginImages = value => [value];`,
    ],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (mocks.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks.get(specifier))}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return { url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
        if (specifier.startsWith(".") && context.parentURL?.startsWith("file:") && !/\.[cm]?[jt]s$/.test(specifier)) {
            const url = new URL(`${specifier}.ts`, context.parentURL);
            if (existsSync(url)) return { url: url.href, shortCircuit: true };
        }
        return nextResolve(specifier, context);
    },
});

const { requestEdit } = await import("../src/services/api/image.ts");
const { createVideoGenerationTask } = await import("../src/services/api/video.ts");
const IMAGE = "data:image/png;base64,aGVsbG8=";
const image = (index = 0) => ({ id: `image-${index}`, name: `角色${index + 1}.png`, type: "image/png", dataUrl: IMAGE });
const images = (count) => Array.from({ length: count }, (_, index) => image(index));
const video = () => ({ id: "video", name: "动作参考", url: "https://example.com/input.mp4", type: "video/mp4", durationMs: 3000 });
const audio = () => ({ id: "audio", name: "声音参考", url: "https://example.com/input.mp3", type: "audio/mpeg", durationMs: 3000 });
const config = (apiFormat, extra = {}) => ({
    apiFormat,
    model: "model",
    videoModel: "model",
    imageModel: "model",
    baseUrl: "https://example.com/v1",
    apiKey: "test",
    size: "auto",
    quality: "auto",
    vquality: "720p",
    videoSeconds: "5",
    count: "1",
    systemPrompt: "",
    imagePromptPrefix: "",
    ...extra,
});

for (const [format, limit] of [
    ["xai", 3],
    ["openai", 7],
    ["agnes", 1],
    ["ark", 9],
]) {
    test(`${format} video rejects excess images before sending a partial reference set`, async () => {
        calls.length = 0;
        await assert.rejects(createVideoGenerationTask(config(format), "保留所有角色", images(limit + 1)), /参考图|首帧图片|参考素材/u);
        assert.equal(calls.length, 0);
    });
}

test("Grok image rejects excess references before sending a partial reference set", async () => {
    calls.length = 0;
    await assert.rejects(requestEdit(config("xai"), "保留所有角色", images(4)), /参考图/u);
    assert.equal(calls.length, 0);
});

for (const [kind, videos, audios] of [
    ["video", Array.from({ length: 4 }, video), []],
    ["audio", [], Array.from({ length: 4 }, audio)],
]) {
    test(`Seedance rejects excess ${kind} references before creating a task`, async () => {
        calls.length = 0;
        await assert.rejects(createVideoGenerationTask(config("ark"), "保留参考", images(1), videos, audios), /参考视频|参考音频/u);
        assert.equal(calls.length, 0);
    });
}

for (const format of ["xai", "openai", "agnes", "ark", "gemini", "plugin", "openrouter"]) {
    test(`${format} image refuses unreadable reference data instead of treating the request as text-only`, async () => {
        for (const dataUrl of ["", "data:image/png;base64,", "data:text/html;base64,aGVsbG8="]) {
            calls.length = 0;
            const extras = format === "plugin" ? { testScript: "return image;" } : format === "openrouter" ? { vendor: "openrouter" } : {};
            await assert.rejects(requestEdit(config(format, extras), "保留角色", [{ ...image(), dataUrl }]), /参考图.*(读取失败|无效)|图片.*(读取失败|无效)/u);
            assert.equal(calls.length, 0);
        }
    });
}

for (const format of ["xai", "openai", "agnes", "ark", "plugin", "openrouter"]) {
    test(`${format} video refuses unreadable reference data`, async () => {
        calls.length = 0;
        const extras = format === "plugin" ? { testScript: "return video;" } : format === "openrouter" ? { vendor: "openrouter" } : {};
        await assert.rejects(createVideoGenerationTask(config(format, extras), "保留角色", [{ ...image(), dataUrl: "" }]), /参考图.*(读取失败|无效)|图片.*(读取失败|无效)/u);
        assert.equal(calls.length, 0);
    });
}

test("a video plugin rejects unsupported video and audio inputs", async () => {
    for (const [videos, audios] of [
        [[video()], []],
        [[], [audio()]],
    ]) {
        calls.length = 0;
        await assert.rejects(createVideoGenerationTask(config("openai", { testScript: "return video;" }), "参考素材", images(1), videos, audios), /脚本.*不支持.*参考视频.*参考音频/u);
        assert.equal(calls.length, 0);
    }
});

test("an image plugin rejects a mask it cannot send", async () => {
    calls.length = 0;
    await assert.rejects(requestEdit(config("openai", { testScript: "return image;" }), "编辑", images(1), image()), /脚本.*不支持.*蒙版/u);
    assert.equal(calls.length, 0);
});

test("image editing refuses an empty reference set", async () => {
    calls.length = 0;
    await assert.rejects(requestEdit(config("xai"), "保留角色", []), /参考图/u);
    assert.equal(calls.length, 0);
});

test("Grok image sends every accepted reference with matching prompt numbering", async () => {
    calls.length = 0;
    await requestEdit(config("xai"), "保留三个角色", images(3));
    assert.equal(calls.length, 1);
    assert.deepEqual(
        calls[0].body.images.map((ref) => ref.url),
        [IMAGE, IMAGE, IMAGE],
    );
    assert.match(calls[0].body.prompt, /图片1、图片2、图片3/u);
});

test("Seedance sends all supported images, videos and audio in original order", async () => {
    calls.length = 0;
    await createVideoGenerationTask(config("ark"), "参考角色与声音", images(9), Array.from({ length: 3 }, video), Array.from({ length: 3 }, audio));
    assert.equal(calls.length, 1);
    const content = calls[0].body.content;
    assert.equal(content.filter((item) => item.type === "image_url").length, 9);
    assert.equal(content.filter((item) => item.type === "video_url").length, 3);
    assert.equal(content.filter((item) => item.type === "audio_url").length, 3);
});

test("Seedance refuses a local reference video before creating an invalid provider task", async () => {
    calls.length = 0;
    await assert.rejects(
        createVideoGenerationTask(config("ark"), "延续参考视频的动作", images(1), [{ ...video(), url: "wg-media://local-cat", storageKey: "media:local-cat" }]),
        /视频1.*https.*本机视频/u,
    );
    assert.equal(calls.length, 0);
});

test("accepted video references keep their bytes at each adapter's boundary", async () => {
    for (const [format, count] of [
        ["xai", 3],
        ["openai", 7],
        ["agnes", 1],
        ["openrouter", 2],
    ]) {
        calls.length = 0;
        await createVideoGenerationTask(config(format, format === "openrouter" ? { vendor: "openrouter" } : {}), "保留角色", images(count));
        assert.equal(calls.length, 1);
        const body = calls[0].body;
        if (format === "openai") {
            const files = body.getAll("input_reference[]");
            assert.equal(files.length, count);
            assert.deepEqual(await Promise.all(files.map((file) => file.text())), Array(count).fill("hello"));
        } else {
            const urls = format === "xai" ? body.reference_images.map((item) => item.url) : format === "agnes" ? [body.image] : body.frame_images.map((item) => item.image_url.url);
            assert.deepEqual(urls, Array(count).fill(IMAGE));
        }
    }
});

test("MiniMax image and video never omit an unreadable character reference", async () => {
    for (const model of ["image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3"]) {
        calls.length = 0;
        const requestConfig = config("minimax", { adapter: "minimax-api-native", apiKey: "sk-api-test", model });
        const refs = [{ ...image(), dataUrl: "" }];
        await assert.rejects(model === "image-01" ? requestEdit(requestConfig, "保留角色", refs) : createVideoGenerationTask(requestConfig, "保留角色", refs), /参考图.*读取失败/u);
        assert.equal(calls.length, 0);
    }
});

test("one unreadable image aborts the whole request instead of sending the remaining reference", async () => {
    calls.length = 0;
    await assert.rejects(requestEdit(config("xai"), "保留两位角色", [image(), { ...image(1), dataUrl: "" }]), /角色2/u);
    assert.equal(calls.length, 0);
});

test("OpenAI image editing reads the persisted mask before making the multipart request", async () => {
    calls.length = 0;
    await requestEdit(config("openai"), "只修改蒙版区域", images(1), { ...image(1), dataUrl: "", resolvedDataUrl: IMAGE, storageKey: "image:mask" });
    assert.equal(calls.length, 1);
    assert.equal(await calls[0].body.get("mask").text(), "hello");
});
