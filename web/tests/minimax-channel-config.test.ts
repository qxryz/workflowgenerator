import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const webRoot = fileURLToPath(new URL("../", import.meta.url));
const server = await createServer({
    root: webRoot,
    configFile: false,
    resolve: { alias: { "@": `${webRoot}/src` } },
    ssr: { noExternal: ["file-saver"] },
    plugins: [
        {
            name: "test-file-saver",
            enforce: "pre",
            resolveId(id) {
                return id === "file-saver" ? "\0test-file-saver" : undefined;
            },
            load(id) {
                return id === "\0test-file-saver" ? "export const saveAs = () => undefined;" : undefined;
            },
        },
    ],
    server: { middlewareMode: true, hmr: false },
    optimizeDeps: { noDiscovery: true },
    appType: "custom",
    logLevel: "silent",
});

after(() => server.close());

const configModule = await server.ssrLoadModule("/src/stores/use-config-store.ts");
const fileModule = await server.ssrLoadModule("/src/services/config-file.ts");
const linkConfigModule = await server.ssrLoadModule("/src/lib/link-config.ts");
const webdavModule = await server.ssrLoadModule("/src/services/webdav-sync.ts");
const limitedResponseModule = await server.ssrLoadModule("/src/lib/limited-response.ts");
const syncValidationModule = await server.ssrLoadModule("/src/services/app-sync-validation.ts");

function miniMaxConfig(vendor: "minimax-token-plan" | "minimax-api", overrides: Record<string, unknown> = {}) {
    const channel = configModule.createModelChannel({
        id: vendor,
        name: vendor === "minimax-token-plan" ? "MiniMax Token Plan" : "MiniMax API",
        vendor,
        adapter: "minimax-native",
        apiFormat: "minimax",
        baseUrl: vendor === "minimax-token-plan" ? "https://plan.example" : "https://payg.example",
        apiKey: vendor === "minimax-token-plan" ? "plan-key" : "payg-key",
        models: [{ name: "MiniMax-M3", capability: "text" }],
        ...overrides,
    });
    return {
        ...configModule.defaultConfig,
        channels: [channel],
        models: [`${vendor}::MiniMax-M3`],
        model: `${vendor}::MiniMax-M3`,
        textModel: `${vendor}::MiniMax-M3`,
    };
}

test("each MiniMax vendor channel stores one ordinary connection", () => {
    const channel = configModule.createModelChannel({ apiFormat: "minimax", vendor: "minimax-token-plan" });
    assert.equal(channel.baseUrl, "https://api.minimaxi.com");
    assert.equal(channel.apiKey, "");
    assert.equal(Object.hasOwn(channel, "minimaxPlanBaseUrl"), false);
    assert.equal(Object.hasOwn(channel, "minimaxPlanApiKey"), false);
    assert.equal(Object.hasOwn(channel, "minimaxBillingMode"), false);
    assert.equal(Object.hasOwn(channel, "minimaxTokenPlanVideoAccess"), false);
});

test("MiniMax request resolution derives billing from the vendor-matched adapter", () => {
    const paygConfig = miniMaxConfig("minimax-api");
    const payg = configModule.resolveModelRequestConfig(paygConfig, paygConfig.model);
    assert.equal(payg.baseUrl, "https://payg.example");
    assert.equal(payg.apiKey, "payg-key");
    assert.equal(payg.vendor, "minimax-api");
    assert.equal(payg.adapter, "minimax-api-native");
    assert.equal(payg.minimaxBillingMode, "payg");

    const tokenConfig = miniMaxConfig("minimax-token-plan");
    const token = configModule.resolveModelRequestConfig(tokenConfig, tokenConfig.model);
    assert.equal(token.baseUrl, "https://plan.example");
    assert.equal(token.apiKey, "plan-key");
    assert.equal(token.vendor, "minimax-token-plan");
    assert.equal(token.adapter, "minimax-token-plan-native");
    assert.equal(token.minimaxBillingMode, "token-plan");
});

test("MiniMax readiness rejects a credential from the other billing vendor", () => {
    const apiWithTokenKey = miniMaxConfig("minimax-api", { apiKey: "sk-cp-wrong-channel" });
    const tokenWithApiKey = miniMaxConfig("minimax-token-plan", { apiKey: "sk-api-wrong-channel" });
    const api = miniMaxConfig("minimax-api", { apiKey: "sk-api-correct" });
    const token = miniMaxConfig("minimax-token-plan", { apiKey: "sk-cp-correct" });
    assert.equal(configModule.isAiConfigReady(apiWithTokenKey, apiWithTokenKey.model), false);
    assert.equal(configModule.isAiConfigReady(tokenWithApiKey, tokenWithApiKey.model), false);
    assert.equal(configModule.isAiConfigReady(api, api.model), true);
    assert.equal(configModule.isAiConfigReady(token, token.model), true);
});

test("MiniMax vendor identity always selects its matching adapter", () => {
    const token = configModule.createModelChannel({ vendor: "minimax-token-plan", apiFormat: "minimax", adapter: "minimax-api-native", models: [{ name: "MiniMax-M3", capability: "text", adapter: "minimax-api-native" }] });
    const api = configModule.createModelChannel({ vendor: "minimax-api", apiFormat: "minimax", adapter: "minimax-token-plan-native", models: [{ name: "MiniMax-M3", capability: "text", adapter: "minimax-token-plan-native" }] });
    assert.equal(token.adapter, "minimax-token-plan-native");
    assert.equal(token.models[0].adapter, "minimax-token-plan-native");
    assert.equal(api.adapter, "minimax-api-native");
    assert.equal(api.models[0].adapter, "minimax-api-native");
});

test("Token Plan preserves every service-listed model without local entitlement state", () => {
    const models = [
        { name: "MiniMax-M3", capability: "text" },
        { name: "MiniMax-H3", capability: "video" },
        { name: "MiniMax-Hailuo-2.3", capability: "video", script: "return 'kept';" },
        { name: "MiniMax-Hailuo-2.3-Fast", capability: "video" },
        { name: "speech-2.8-hd", capability: "audio" },
    ];
    const channel = configModule.createModelChannel({ id: "token", vendor: "minimax-token-plan", apiFormat: "minimax", models });
    assert.equal(Object.hasOwn(channel, "minimaxTokenPlanVideoAccess"), false);
    assert.deepEqual(channel.models.map((model: { name: string }) => model.name), ["MiniMax-M3", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd"]);

    const staleVideoModel = "token::MiniMax-Hailuo-2.3";
    const normalized = configModule.normalizeAiConfig({
        ...configModule.defaultConfig,
        channels: [
            {
                id: "token",
                name: "MiniMax Token Plan",
                vendor: "minimax-token-plan",
                adapter: "minimax-native",
                apiFormat: "minimax",
                baseUrl: "https://plan.example",
                apiKey: "plan-key",
                models,
            },
        ],
        model: staleVideoModel,
        videoModel: staleVideoModel,
    });
    const migrated = normalized.channels.find((channel: { id: string }) => channel.id === "token");
    assert.ok(migrated);
    assert.equal(Object.hasOwn(migrated, "minimaxTokenPlanVideoAccess"), false);
    assert.deepEqual(migrated.models.map((model: { name: string }) => model.name), ["MiniMax-M3", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd"]);
    assert.equal(migrated.models.find((model: { name: string }) => model.name === "MiniMax-Hailuo-2.3")?.script, "return 'kept';");
    assert.equal(normalized.models.includes(staleVideoModel), true);
    assert.equal(normalized.videoModel, staleVideoModel);
    assert.equal(configModule.resolveModelForCapability(normalized, staleVideoModel, "video"), staleVideoModel);
    assert.equal(configModule.selectableModelsByCapability(normalized, "video").includes(staleVideoModel), true);
    assert.equal(configModule.modelCapabilityOf(normalized, staleVideoModel), "video");
    assert.equal(configModule.resolveModelScript(normalized, staleVideoModel), "return 'kept';");
    const request = configModule.resolveModelRequestConfig(normalized, staleVideoModel);
    assert.equal(request.vendor, "minimax-token-plan");
    assert.equal(request.minimaxBillingMode, "token-plan");
    assert.equal(Object.hasOwn(request, "minimaxTokenPlanVideoAccess"), false);
});

test("Token Plan keeps Hailuo as its normalized video default without an entitlement flag", () => {
    const hailuo = "token::MiniMax-Hailuo-2.3";
    const normalized = configModule.normalizeAiConfig({
        ...configModule.defaultConfig,
        channels: [
            {
                id: "token",
                name: "MiniMax Token Plan",
                vendor: "minimax-token-plan",
                adapter: "minimax-native",
                apiFormat: "minimax",
                baseUrl: "https://plan.example",
                apiKey: "plan-key",
                models: [
                    { name: "MiniMax-H3", capability: "video" },
                    { name: "MiniMax-Hailuo-2.3", capability: "video" },
                ],
            },
        ],
        model: hailuo,
        videoModel: hailuo,
    });
    const token = normalized.channels.find((channel: { id: string }) => channel.id === "token");
    assert.equal(Object.hasOwn(token, "minimaxTokenPlanVideoAccess"), false);
    assert.deepEqual(token.models.map((model: { name: string }) => model.name), ["MiniMax-H3", "MiniMax-Hailuo-2.3"]);
    assert.equal(normalized.videoModel, hailuo);
    assert.equal(normalized.models.includes(hailuo), true);
    assert.equal(configModule.selectableModelsByCapability(normalized, "video").includes(hailuo), true);
    assert.equal(configModule.modelCapabilityOf(normalized, hailuo), "video");
    assert.equal(Object.hasOwn(configModule.resolveModelRequestConfig(normalized, hailuo), "minimaxTokenPlanVideoAccess"), false);
});

test("Token Plan channels keep independent credentials without local entitlement filtering", () => {
    const model = { name: "MiniMax-Hailuo-2.3", capability: "video", script: "return 'hailuo';" };
    const first = configModule.createModelChannel({
        id: "token-basic",
        name: "Token Plan Basic",
        vendor: "minimax-token-plan",
        apiFormat: "minimax",
        baseUrl: "https://basic.example",
        apiKey: "basic-key",
        models: [model],
    });
    const second = configModule.createModelChannel({
        id: "token-video",
        name: "Token Plan Video",
        vendor: "minimax-token-plan",
        apiFormat: "minimax",
        baseUrl: "https://video.example",
        apiKey: "video-key",
        models: [model],
    });
    const config = { ...configModule.defaultConfig, channels: [first, second] };
    const firstModel = "token-basic::MiniMax-Hailuo-2.3";
    const secondModel = "token-video::MiniMax-Hailuo-2.3";

    assert.deepEqual(configModule.selectableModelsByCapability(config, "video"), [firstModel, secondModel]);
    assert.equal(configModule.resolveModelRequestConfig(config, firstModel).apiKey, "basic-key");
    assert.equal(configModule.resolveModelScript(config, firstModel), "return 'hailuo';");
    assert.equal(configModule.resolveModelRequestConfig(config, secondModel).apiKey, "video-key");
    assert.equal(configModule.resolveModelScript(config, secondModel), "return 'hailuo';");
});

test("MiniMax Hailuo request defaults normalize independently from saved legacy config", () => {
    assert.equal(configModule.defaultConfig.minimaxVideoPromptOptimizer, "true");
    assert.equal(configModule.defaultConfig.minimaxVideoFastPretreatment, "false");
    const normalized = configModule.normalizeAiConfig({ minimaxVideoPromptOptimizer: "", minimaxVideoFastPretreatment: "" });
    assert.equal(normalized.minimaxVideoPromptOptimizer, "true");
    assert.equal(normalized.minimaxVideoFastPretreatment, "false");
});

test("MiniMax readiness never falls back to the other Key", () => {
    const token = miniMaxConfig("minimax-token-plan", { apiKey: "" }).channels[0];
    const payg = miniMaxConfig("minimax-api").channels[0];
    const config = {
        ...configModule.defaultConfig,
        channels: [token, payg],
        models: ["minimax-token-plan::MiniMax-M3", "minimax-api::MiniMax-M3"],
        model: "minimax-token-plan::MiniMax-M3",
        textModel: "minimax-token-plan::MiniMax-M3",
    };
    assert.equal(configModule.isAiConfigReady(config, config.model), false);
    assert.equal(configModule.resolveModelRequestConfig(config, config.model).apiKey, "");
    assert.equal(configModule.isAiConfigReady(config, "minimax-api::MiniMax-M3"), true);
});

test("a deleted namespaced Token Plan channel never falls back to the first API Key", () => {
    const api = configModule.createModelChannel({
        id: "minimax-api",
        name: "MiniMax API",
        vendor: "minimax-api",
        adapter: "minimax-native",
        apiFormat: "minimax",
        baseUrl: "https://payg.example",
        apiKey: "payg-key-must-not-be-used",
        models: [{ name: "MiniMax-Hailuo-2.3", capability: "video" }],
    });
    const config = {
        ...configModule.defaultConfig,
        channels: [api],
        models: ["minimax-api::MiniMax-Hailuo-2.3"],
        model: "deleted-token::MiniMax-Hailuo-2.3",
        videoModel: "deleted-token::MiniMax-Hailuo-2.3",
    };
    assert.throws(() => configModule.resolveModelChannel(config, config.videoModel), /原渠道已删除，请重新选择/);
    assert.throws(() => configModule.resolveModelRequestConfig(config, config.videoModel), /原渠道已删除，请重新选择/);
});

test("configuration export strips each vendor channel Key without mutating saved config", () => {
    const token = miniMaxConfig("minimax-token-plan").channels[0];
    const payg = miniMaxConfig("minimax-api").channels[0];
    const config = { ...miniMaxConfig("minimax-api"), channels: [token, payg] };
    const stripped = fileModule.stripConfigCredentials(config);
    assert.equal(stripped.channels[0].apiKey, "");
    assert.equal(stripped.channels[1].apiKey, "");
    assert.equal(config.channels[0].apiKey, "plan-key");
    assert.equal(config.channels[1].apiKey, "payg-key");
});

test("configuration import strips executable model scripts and credentials", () => {
    const config = miniMaxConfig("minimax-api", {
        models: [{ name: "MiniMax-M3", capability: "text", script: "globalThis.pwned = true" }],
    });
    const result = fileModule.sanitizeImportedConfig(config);

    assert.equal(result.strippedScripts, 1);
    assert.equal(result.config.channels[0].apiKey, "");
    assert.equal(result.config.apiKey, "");
    assert.equal(Object.hasOwn(result.config.channels[0].models[0], "script"), false);
    assert.equal(config.channels[0].models[0].script, "globalThis.pwned = true");
});

test("a linked endpoint can never import or inherit an API Key", () => {
    const linked = linkConfigModule.readLinkedConfig(
        "?baseUrl=https%3A%2F%2Fgateway.example%2Fv1&apiKey=secret-from-link&keep=1",
    );

    assert.equal(linked.baseUrl, "https://gateway.example/v1");
    assert.equal(linked.hadApiKey, true);
    assert.equal(linked.cleanedSearch, "keep=1");
    assert.equal(linkConfigModule.readLinkedConfig("?baseUrl=http%3A%2F%2Fevil.example").baseUrl, undefined);
    assert.equal(linkConfigModule.readLinkedConfig("?baseUrl=http%3A%2F%2F127.0.0.1%3A11434").baseUrl, "http://127.0.0.1:11434/");
});

test("WebDAV URLs require secure transport and cannot escape their configured root", () => {
    const config = { url: "https://dav.example/root", directory: "Workflow Folder", username: "", password: "" };
    assert.equal(
        webdavModule.buildWebdavUrl(config, "canvas/manifest.json"),
        "https://dav.example/root/Workflow%20Folder/canvas/manifest.json",
    );
    assert.throws(() => webdavModule.buildWebdavUrl(config, "../outside.json"), /路径不安全/u);
    assert.throws(() => webdavModule.buildWebdavUrl(config, "%2e%2e/outside.json"), /路径不安全/u);
    assert.throws(() => webdavModule.buildWebdavUrl({ ...config, directory: "safe\\outside" }, "file"), /路径不安全/u);
    assert.throws(() => webdavModule.buildWebdavUrl({ ...config, url: "http://dav.example/root" }, "file"), /HTTPS/u);
});

test("streamed downloads stop as soon as the byte limit is crossed", async () => {
    const body = new ReadableStream({
        start(controller) {
            controller.enqueue(new Uint8Array([1, 2, 3, 4]));
            controller.enqueue(new Uint8Array([5, 6, 7, 8]));
            controller.close();
        },
    });
    const response = new Response(body);
    await assert.rejects(() => limitedResponseModule.readResponseBytes(response, 6, "too large"), /too large/u);
});

test("WebDAV manifests cannot choose local keys, out-of-domain paths, or unbounded files", () => {
    const valid = { storageKey: "image:abc_123", path: "assets/files/image_abc.png", mimeType: "image/png", bytes: 1024 };
    assert.deepEqual(syncValidationModule.validateRemoteSyncFiles("assets", [valid]), [valid]);
    assert.throws(
        () => syncValidationModule.validateRemoteSyncFiles("assets", [{ ...valid, path: "canvas/files/image_abc.png" }]),
        /越界文件路径/u,
    );
    assert.throws(
        () => syncValidationModule.validateRemoteSyncFiles("assets", [{ ...valid, path: "assets/files/../manifest.json" }]),
        /路径不安全/u,
    );
    assert.throws(
        () => syncValidationModule.validateRemoteSyncFiles("assets", [{ ...valid, bytes: 300 * 1024 * 1024 }]),
        /文件大小/u,
    );
});

test("legacy combined MiniMax channel migrates to two independent vendors without losing credentials", () => {
    const normalized = configModule.normalizeAiConfig({
        ...configModule.defaultConfig,
        channels: [
            {
                id: "legacy-minimax",
                name: "MiniMax",
                vendor: "minimax",
                adapter: "minimax-native",
                apiFormat: "minimax",
                baseUrl: "https://payg.example",
                apiKey: "payg-key",
                minimaxPlanBaseUrl: "https://plan.example",
                minimaxPlanApiKey: "plan-key",
                minimaxBillingMode: "token-plan",
                models: [
                    { name: "MiniMax-M3", capability: "text", provider: "minimax" },
                    { name: "image-01", capability: "image", provider: "minimax" },
                    { name: "MiniMax-H3", capability: "video", provider: "minimax" },
                    { name: "MiniMax-Hailuo-2.3", capability: "video", provider: "minimax" },
                    { name: "speech-2.8-hd", capability: "audio", provider: "minimax" },
                ],
            },
        ],
        model: "legacy-minimax::MiniMax-M3",
        textModel: "legacy-minimax::MiniMax-M3",
    });
    const api = normalized.channels.find((channel: { vendor?: string }) => channel.vendor === "minimax-api");
    const token = normalized.channels.find((channel: { vendor?: string }) => channel.vendor === "minimax-token-plan");
    assert.ok(api);
    assert.ok(token);
    assert.equal(api.id, "legacy-minimax-api");
    assert.equal(api.baseUrl, "https://payg.example");
    assert.equal(api.apiKey, "payg-key");
    assert.equal(token.baseUrl, "https://plan.example");
    assert.equal(token.apiKey, "plan-key");
    assert.equal(token.id, "legacy-minimax");
    assert.deepEqual(api.models.map((model: { name: string }) => model.name), ["MiniMax-M3", "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "speech-2.8-hd"]);
    assert.deepEqual(token.models.map((model: { name: string }) => model.name), ["MiniMax-M3", "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "speech-2.8-hd"]);
    assert.equal(normalized.model, "legacy-minimax::MiniMax-M3");
    const selectedRequest = configModule.resolveModelRequestConfig(normalized, normalized.model);
    assert.equal(selectedRequest.vendor, "minimax-token-plan");
    assert.equal(selectedRequest.adapter, "minimax-token-plan-native");
    assert.equal(selectedRequest.minimaxBillingMode, "token-plan");
    assert.equal(selectedRequest.apiKey, "plan-key");
    for (const channel of [api, token]) {
        assert.equal(Object.hasOwn(channel, "minimaxPlanBaseUrl"), false);
        assert.equal(Object.hasOwn(channel, "minimaxPlanApiKey"), false);
        assert.equal(Object.hasOwn(channel, "minimaxBillingMode"), false);
    }
});

test("legacy MiniMax vendor without combined fields becomes API billing", () => {
    const normalized = configModule.normalizeAiConfig({
        ...configModule.defaultConfig,
        channels: [
            configModule.createModelChannel({
                id: "legacy-api",
                name: "MiniMax",
                vendor: "minimax",
                adapter: "minimax-native",
                apiFormat: "minimax",
                baseUrl: "https://api.example",
                apiKey: "api-key",
                models: [{ name: "MiniMax-M3", capability: "text" }],
            }),
        ],
    });
    const migrated = normalized.channels.find((channel: { id: string }) => channel.id === "legacy-api");
    assert.equal(migrated.vendor, "minimax-api");
    assert.equal(migrated.adapter, "minimax-api-native");
    assert.equal(migrated.apiKey, "api-key");
    assert.equal(normalized.channels.some((channel: { vendor?: string }) => channel.vendor === "minimax-token-plan"), false);
});

test("MiniMax channel editor keeps its fixed protocol internal and has no entitlement filtering UI", () => {
    const source = readFileSync(new URL("../src/components/layout/channel-editor-drawer.tsx", import.meta.url), "utf8");
    const selectSource = readFileSync(new URL("../src/components/layout/model-select-modal.tsx", import.meta.url), "utf8");
    const catalog = readFileSync(new URL("../src/lib/model-catalog.ts", import.meta.url), "utf8");
    assert.match(catalog, /MiniMax Token Plan（原 Coding Plan）/u);
    assert.match(catalog, /MiniMax API 计费/u);
    assert.match(source, /currentVendor === "minimax-token-plan"/u);
    assert.match(source, /apiKey:\s*vendorId === currentVendor \? draft\.apiKey : ""/u);
    assert.doesNotMatch(source, /fetchMiniMaxTokenPlanAccess|minimaxTokenPlanVideoAccess|套餐权益/u);
    assert.doesNotMatch(source, /currentAdapterOptions/u);
    assert.match(source, /!isMiniMaxVendor \? \([\s\S]*?接入方式（适配器）/u);
    assert.match(source, /recommendedCatalogModelsForVendor\(currentVendor\)/u);
    assert.match(source, /精选已适配模型/u);
    assert.doesNotMatch(source, /套餐视频权益/u);
    assert.match(source, /sk-cp-\.\.\./u);
    assert.match(source, /sk-api-\.\.\./u);
    assert.match(source, /disabled=\{Boolean\(minimaxCredentialError\)\}/u);
    assert.doesNotMatch(source, /const unavailableModels = draft\.models\.filter/u);
    assert.match(selectSource, /catalogModelsForVendor\(vendorId\)/u);
    assert.match(selectSource, /recommendedCatalogModelsForVendor\(vendorId\)/u);
    assert.match(selectSource, /推荐模型 \(\$\{recommendedModels\.length\}\)/u);
    assert.match(selectSource, /模型目录 \(\$\{catalogModels\.length\}\)/u);
    assert.match(selectSource, /接口返回 \(\$\{fetched\.length\}\)/u);
    assert.match(selectSource, /setFetched\(Array\.from\(new Set\(models\)\)\)[\s\S]*?setActiveTab\("remote"\)/u);
    assert.doesNotMatch(selectSource, /setFetched\(\(current\) => Array\.from\(new Set\(\[\.\.\.current, \.\.\.models\]\)\)\)/u);
    assert.doesNotMatch(selectSource, /models\.filter\(\(name\) => modelAvailableForVendor/u);
    assert.doesNotMatch(selectSource, /modelAvailableForVendor/u);
    assert.match(selectSource, /已读取 \$\{models\.length\} 个接口返回模型/u);
    assert.doesNotMatch(source, /minimaxPlanBaseUrl|minimaxPlanApiKey|minimaxBillingMode/u);
});

test("MiniMax model listing and every native request path reject the opposite credential kind", () => {
    const imageSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
    const videoSource = readFileSync(new URL("../src/services/api/video.ts", import.meta.url), "utf8");
    const audioSource = readFileSync(new URL("../src/services/api/minimax-audio.ts", import.meta.url), "utf8");
    const textSource = readFileSync(new URL("../src/services/api/minimax-text.ts", import.meta.url), "utf8");
    assert.match(imageSource, /fetchChannelModels[\s\S]*?assertMiniMaxCredentialMatches\("token-plan", channel\.apiKey\)[\s\S]*?assertMiniMaxCredentialMatches\("payg", channel\.apiKey\)/u);
    assert.match(imageSource, /requestMiniMaxImages[\s\S]*?assertMiniMaxCredentialMatches\(miniMaxBillingMode\(config\), config\.apiKey\)/u);
    assert.equal((videoSource.match(/assertMiniMaxCredentialMatches\(miniMaxBillingMode\(config\), config\.apiKey\)/gu) || []).length, 4);
    assert.match(audioSource, /assertMiniMaxCredentialMatches\(mode, request\.apiKey\)/u);
    assert.match(textSource, /assertMiniMaxCredentialMatches\(billingMode, config\.apiKey\)/u);
});
