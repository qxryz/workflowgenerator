import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

import { getProviderDefinition, inferModelProvider, modelExperienceKind, modelUiAdaptation } from "../src/lib/model-providers.ts";

const adaptersSource = readFileSync(new URL("../src/lib/model-adapters.ts", import.meta.url), "utf8");
const catalogSource = readFileSync(new URL("../src/lib/model-catalog.ts", import.meta.url), "utf8");
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
const catalogModule = await server.ssrLoadModule("/src/lib/model-catalog.ts");

test("MiniMax model families select the native provider and workbench experiences", () => {
    assert.equal(inferModelProvider("MiniMax-M3"), "minimax");
    assert.equal(inferModelProvider("image-01"), "minimax");
    assert.equal(inferModelProvider("MiniMax-H3"), "minimax");
    assert.equal(inferModelProvider("MiniMax-Hailuo-2.3"), "minimax");
    assert.equal(inferModelProvider("MiniMax-Hailuo-2.3-Fast"), "minimax");
    assert.equal(inferModelProvider("speech-2.8-hd"), "minimax");
    assert.equal(modelExperienceKind("minimax", "image-01", "image"), "minimax-image");
    assert.equal(modelExperienceKind("minimax", "MiniMax-H3", "video"), "minimax-video");
    assert.equal(modelExperienceKind("minimax", "MiniMax-Hailuo-2.3", "video"), "minimax-hailuo-video");
    assert.equal(modelExperienceKind("minimax", "MiniMax-Hailuo-2.3-Fast", "video"), "minimax-hailuo-video");
    assert.equal(modelExperienceKind("minimax", "speech-2.8-turbo", "audio"), "minimax-audio");
    assert.equal(modelUiAdaptation("minimax", "MiniMax-H3", "video").native, true);
    assert.equal(modelUiAdaptation("minimax", "MiniMax-Hailuo-2.3", "video").native, true);
    assert.equal(modelUiAdaptation("minimax", "MiniMax-Hailuo-2.3-Fast", "video").native, true);
    assert.equal(modelUiAdaptation("minimax", "speech-2.8-hd", "audio").native, true);
    const presets = getProviderDefinition("minimax").presets.map((preset) => preset.name);
    assert.equal(presets.includes("MiniMax-Hailuo-2.3"), true);
    assert.equal(presets.includes("MiniMax-Hailuo-2.3-Fast"), true);
});

test("MiniMax catalog exposes separate Token Plan and API billing vendors", () => {
    assert.match(adaptersSource, /id:\s*"minimax-token-plan-native"[\s\S]*?capabilities:\s*\{\s*text:\s*NATIVE,\s*image:\s*NATIVE,\s*video:\s*NATIVE,\s*audio:\s*NATIVE\s*\}[\s\S]*?legacyProtocols:\s*\[\]/u);
    assert.match(adaptersSource, /id:\s*"minimax-api-native"[\s\S]*?capabilities:\s*\{\s*text:\s*NATIVE,\s*image:\s*NATIVE,\s*video:\s*NATIVE,\s*audio:\s*NATIVE\s*\}[\s\S]*?legacyProtocols:\s*\["minimax"\]/u);
    const tokenVendor = catalogModule.getModelVendor("minimax-token-plan");
    const apiVendor = catalogModule.getModelVendor("minimax-api");
    assert.equal(tokenVendor.label, "MiniMax Token Plan（原 Coding Plan）");
    assert.equal(apiVendor.label, "MiniMax API 计费");
    assert.equal(catalogModule.legacyApiFormatForVendor("minimax-token-plan"), "minimax");
    assert.equal(catalogModule.legacyApiFormatForVendor("minimax-api"), "minimax");
    assert.equal(catalogModule.defaultAdapterForVendor("minimax-token-plan"), "minimax-token-plan-native");
    assert.equal(catalogModule.defaultAdapterForVendor("minimax-api"), "minimax-api-native");
    for (const modelName of ["MiniMax-M3", "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd", "speech-2.8-turbo"]) {
        assert.match(catalogSource, new RegExp(`name: "${modelName.replace(".", "\\.")}"[\\s\\S]*?vendor: "minimax-api"[\\s\\S]*?adapter: "minimax-api-native"`, "u"));
    }
    assert.doesNotMatch(catalogSource, /vendor:\s*"minimax-api"[^\n]*(?:music|音乐)/iu);
});

test("Token Plan and API billing expose the same complete native catalog without local entitlement filtering", () => {
    const tokenNames = catalogModule.catalogModelsForVendor("minimax-token-plan").map((model: { name: string }) => model.name);
    const apiNames = catalogModule.catalogModelsForVendor("minimax-api").map((model: { name: string }) => model.name);
    const textModels = ["MiniMax-M3", "MiniMax-M2.7", "MiniMax-M2.7-highspeed", "MiniMax-M2.5", "MiniMax-M2.5-highspeed", "MiniMax-M2.1", "MiniMax-M2.1-highspeed", "MiniMax-M2"];
    const expected = [...textModels, "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd", "speech-2.8-turbo"];
    assert.deepEqual(tokenNames, expected);
    assert.deepEqual(apiNames, expected);
    assert.equal(tokenNames.length, 14);
    assert.equal(catalogModule.catalogModelsForVendor("minimax-token-plan")[0].adapter, "minimax-token-plan-native");
    assert.equal(catalogModule.catalogModelsForVendor("minimax-api")[0].adapter, "minimax-api-native");
});

test("MiniMax recommendations stay curated while the complete selector remains unfiltered", () => {
    const expected = ["MiniMax-M3", "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd", "speech-2.8-turbo"];
    assert.deepEqual(catalogModule.recommendedCatalogModelsForVendor("minimax-token-plan").map((model: { name: string }) => model.name), expected);
    assert.deepEqual(catalogModule.recommendedCatalogModelsForVendor("minimax-api").map((model: { name: string }) => model.name), expected);
    assert.equal(catalogModule.catalogModelsForVendor("minimax-token-plan").length, 14);
    assert.equal(catalogModule.catalogModelsForVendor("minimax-api").length, 14);
    assert.equal(catalogModule.recommendedCatalogModelsForVendor("agnes").length, 3);
    assert.equal(catalogModule.recommendedCatalogModelsForVendor("ark").length, 4);
});
