import assert from "node:assert/strict";
import { after, test } from "node:test";
import { createServer } from "vite";
import { fileURLToPath } from "node:url";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
    root: webRoot,
    configFile: false,
    resolve: { alias: { "@": `${webRoot}/src` } },
    ssr: { noExternal: ["file-saver"] },
    plugins: [{
        name: "test-file-saver",
        enforce: "pre",
        resolveId(id) { return id === "file-saver" ? "\0test-file-saver" : undefined; },
        load(id) { return id === "\0test-file-saver" ? "export const saveAs = () => undefined;" : undefined; },
    }],
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
    logLevel: "silent",
});
after(() => server.close());

const { defaultConfig, createModelChannel } = await server.ssrLoadModule("/src/stores/use-config-store.ts");
const { cancelVideoGenerationTask } = await server.ssrLoadModule("/src/services/api/video.ts");

function config(model: string, vendor: string, baseUrl: string) {
    const channel = createModelChannel({ id: "test", name: "Test", vendor, adapter: vendor === "minimax-api" ? "minimax-native" : "seedance-video", apiFormat: vendor === "minimax-api" ? "minimax" : "openai", baseUrl, apiKey: "test-key", models: [{ name: model, capability: "video" }] });
    return { ...defaultConfig, channels: [channel], models: [`test::${model}`], model: `test::${model}`, videoModel: `test::${model}` };
}

test("MiniMax H3 cancels a queued task through its native endpoint", async (t) => {
    const prior = globalThis.fetch;
    t.after(() => { globalThis.fetch = prior; });
    const calls: Array<{ path: string; url: string }> = [];
    globalThis.fetch = async (path, init) => {
        const body = JSON.parse(String(init?.body));
        calls.push({ path: String(path), url: body.url });
        return new Response(JSON.stringify(String(path).endsWith("json-get") ? { task: { status: "queued" } } : { action: "cancelled", status: "cancelled" }), { headers: { "content-type": "application/json" } });
    };
    const result = await cancelVideoGenerationTask(config("MiniMax-H3", "minimax-api", "https://api.minimax.io"), { id: "123456789012345678", provider: "minimax", model: "test::MiniMax-H3" });
    assert.equal(result.status, "cancelled");
    assert.deepEqual(calls.map((call) => call.path), ["/api/model/json-get", "/api/model/json-delete"]);
    assert.equal(calls[1].url, "https://api.minimax.io/v2/video_generation/123456789012345678");
});

test("a running provider task is never deleted or reported cancelled", async (t) => {
    const prior = globalThis.fetch;
    t.after(() => { globalThis.fetch = prior; });
    const calls: string[] = [];
    globalThis.fetch = async (path) => {
        calls.push(String(path));
        return new Response(JSON.stringify({ task: { status: "running" } }), { headers: { "content-type": "application/json" } });
    };
    const result = await cancelVideoGenerationTask(config("MiniMax-H3", "minimax-api", "https://api.minimax.io"), { id: "123456789012345678", provider: "minimax", model: "test::MiniMax-H3" });
    assert.equal(result.status, "not_cancellable");
    assert.deepEqual(calls, ["/api/model/json-get"]);
});

test("Seedance cancellation requires a subsequent cancelled status", async (t) => {
    const prior = globalThis.fetch;
    t.after(() => { globalThis.fetch = prior; });
    const calls: string[] = [];
    globalThis.fetch = async (path) => {
        calls.push(String(path));
        const payload = calls.length === 1 ? { id: "task-1", status: "queued" } : calls.length === 2 ? {} : { id: "task-1", status: "cancelled" };
        return new Response(JSON.stringify(payload), { headers: { "content-type": "application/json" } });
    };
    const result = await cancelVideoGenerationTask(config("doubao-seedance-2-0", "bytedance", "https://ark.cn-beijing.volces.com/api/v3"), { id: "task-1", provider: "seedance", model: "test::doubao-seedance-2-0" });
    assert.equal(result.status, "cancelled");
    assert.deepEqual(calls, ["/api/model/json-get", "/api/model/json-delete", "/api/model/json-get"]);
});

test("providers without a verified cancel API never send a destructive request", async (t) => {
    const prior = globalThis.fetch;
    t.after(() => { globalThis.fetch = prior; });
    globalThis.fetch = async () => { throw new Error("unexpected provider request"); };
    for (const task of [
        { id: "a", provider: "agnes", model: "agnes-video-v2.0" },
        { id: "b", provider: "minimax", model: "MiniMax-Hailuo-2.3" },
        { id: "c", provider: "xai", model: "grok-imagine-video" },
    ]) {
        const result = await cancelVideoGenerationTask(defaultConfig, task);
        assert.equal(result.status, "unsupported");
    }
});
