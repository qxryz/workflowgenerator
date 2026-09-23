import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
    root: webRoot,
    configFile: false,
    resolve: { alias: { "@": `${webRoot}/src` } },
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
    logLevel: "silent",
});
after(() => server.close());

const config = await server.ssrLoadModule("/src/stores/use-config-store.ts");

test("free preset opens with Agnes vendor, adapter, and usable defaults", () => {
    const free = config.createPresetChannel("free");
    assert.equal(free.vendor, "agnes");
    assert.equal(free.adapter, "agnes");
    assert.equal(free.apiFormat, "agnes");
    assert.equal(free.baseUrl, "https://apihub.agnes-ai.com/v1");
    assert.deepEqual(free.models.map((model: { name: string }) => model.name), ["agnes-image-2.1-flash", "agnes-video-v2.0", "agnes-2.5-flash"]);
    assert.equal(config.defaultConfig.imageModel, "preset-free::agnes-image-2.1-flash");
});

test("untouched old free preset upgrades while configured channels keep credentials", () => {
    const oldFree = config.createModelChannel({
        id: "preset-free", name: "免费", preset: "free", baseUrl: "https://api.openai.com",
        apiFormat: "openai", vendor: "openai", adapter: "openai-compatible", apiKey: "",
        models: [
            { name: "gpt-image-2", capability: "image" },
            { name: "sora-2", capability: "video" },
            { name: "gpt-5.5", capability: "text" },
        ],
    });
    const upgraded = config.normalizeAiConfig({ channels: [oldFree] });
    assert.equal(upgraded.channels[0].vendor, "agnes");
    assert.equal(upgraded.imageModel, "preset-free::agnes-image-2.1-flash");

    const configured = config.normalizeAiConfig({ channels: [{ ...oldFree, apiKey: "user-key" }] });
    assert.equal(configured.channels[0].vendor, "openai");
    assert.equal(configured.channels[0].apiKey, "user-key");
    assert.deepEqual(configured.channels[0].models.map((model: { name: string }) => model.name), ["gpt-image-2", "sora-2", "gpt-5.5"]);
});
