import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";
import { createServer } from "vite";

const docsSource = readFileSync(new URL("../src/pages/model-adaptations/index.tsx", import.meta.url), "utf8");
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
const parameterModule = await server.ssrLoadModule("/src/pages/model-adaptations/model-api-parameters.ts");

test("MiniMax documentation keeps one curated page per recommended model", () => {
    assert.match(docsSource, /modelVendors\.filter\(\(vendor\) => vendor\.id !== "minimax-token-plan"\)\.flatMap/u);
    assert.match(docsSource, /recommendedCatalogModelsForVendor\(vendor\.id\)/u);
    assert.match(docsSource, /key:\s*`\$\{vendor\.id\}:\$\{model\.name\}`/u);
    assert.match(docsSource, /const referenceDocs = \[/u);
    assert.match(docsSource, /架构与新增渠道示例/u);
    assert.match(docsSource, /绑定模型的原生 UI 解释/u);
    assert.match(docsSource, /Zodiac 工作流技术说明/u);
    assert.match(docsSource, /资产与文件/u);
    assert.match(docsSource, /已适配推荐模型 \/ \{String\(models\.length\).*参考 \/ 04/u);
    assert.match(docsSource, /Token Plan 专属 Key（sk-cp）/u);
    assert.match(docsSource, /MiniMax API Key（sk-api）/u);
    assert.match(docsSource, /两类 Key 不能混用/u);

    const tokenNames = catalogModule.recommendedCatalogModelsForVendor("minimax-token-plan").map((model: { name: string }) => model.name);
    const apiNames = catalogModule.recommendedCatalogModelsForVendor("minimax-api").map((model: { name: string }) => model.name);
    const expected = ["MiniMax-M3", "image-01", "MiniMax-H3", "MiniMax-Hailuo-2.3", "MiniMax-Hailuo-2.3-Fast", "speech-2.8-hd", "speech-2.8-turbo"];
    assert.deepEqual(tokenNames, expected);
    assert.deepEqual(apiNames, expected);
    assert.equal(apiNames.some((name: string) => name.startsWith("MiniMax-M2")), false);
});

test("both MiniMax vendors document the same native speech and clone fields", () => {
    const speech = catalogModule.catalogModelsForVendor("minimax-api").find((model: { name: string }) => model.name === "speech-2.8-hd");
    const tokenRows = parameterModule.modelApiParameterDoc("minimax-token-plan", speech).rows.map((row: { name: string }) => row.name);
    const apiRows = parameterModule.modelApiParameterDoc("minimax-api", speech).rows.map((row: { name: string }) => row.name);
    assert.equal(tokenRows.some((name: string) => name === "复刻上传.file"), true);
    assert.equal(apiRows.some((name: string) => name === "复刻上传.file"), true);
    assert.equal(apiRows.some((name: string) => name === "复刻.aigc_watermark"), true);
    for (const field of ["复刻.clone_prompt", "复刻.language_boost", "复刻.text_validation", "复刻.accuracy"]) {
        assert.equal(apiRows.includes(field), true);
    }
});

test("MiniMax parameter docs match the watermark controls that are actually open", () => {
    const models = catalogModule.catalogModelsForVendor("minimax-api");
    for (const [modelName, parameterName, ui] of [
        ["image-01", "aigc_watermark", "添加水印开关"],
        ["MiniMax-H3", "aigc_watermark", "添加水印开关"],
        ["speech-2.8-turbo", "语音.aigc_watermark", "AIGC 音频标识开关"],
        ["speech-2.8-turbo", "复刻.aigc_watermark", "接口支持；当前工作台待接入"],
    ]) {
        const model = models.find((entry: { name: string }) => entry.name === modelName);
        const field = parameterModule.modelApiParameterDoc("minimax-api", model).rows.find((entry: { name: string }) => entry.name === parameterName);
        assert.equal(field?.ui, ui);
    }
    const h3 = models.find((entry: { name: string }) => entry.name === "MiniMax-H3");
    const h3Note = parameterModule.modelApiParameterDoc("minimax-api", h3).note;
    assert.match(h3Note, /JPEG、PNG、WebP[\s\S]*30 MB[\s\S]*50 MB[\s\S]*15 MB/u);

    const hailuo = models.find((entry: { name: string }) => entry.name === "MiniMax-Hailuo-2.3");
    const tokenHailuoDoc = parameterModule.modelApiParameterDoc("minimax-token-plan", hailuo);
    assert.equal(tokenHailuoDoc.rows.some((entry: { name: string }) => entry.name === "aigc_watermark"), true);
    assert.match(tokenHailuoDoc.note, /各级套餐的实际权限和额度以 MiniMax 接口返回为准/u);
});
