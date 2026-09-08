import assert from "node:assert/strict";
import test from "node:test";

import { inferModelProvider, modelBelongsToProvider } from "../src/lib/model-providers.ts";
import { defaultAdapterForVendor, getModelVendor, legacyApiFormatForVendor } from "../src/lib/model-catalog.ts";
import { getModelAdapter, isOpenRouterAdapter, legacyApiFormatForAdapter } from "../src/lib/model-adapters.ts";

test("OpenRouter vendor uses its dedicated adapter for every capability", () => {
    const vendor = getModelVendor("openrouter");
    assert.equal(vendor?.defaultBaseUrl, "https://openrouter.ai/api/v1");
    assert.deepEqual(vendor?.adapters, { text: "openrouter", image: "openrouter", video: "openrouter", audio: "openrouter" });
    assert.equal(defaultAdapterForVendor("openrouter"), "openrouter");
});

test("OpenRouter adapter is native for all capabilities and falls back to the openai api format", () => {
    const adapter = getModelAdapter("openrouter");
    assert.deepEqual(adapter?.capabilities, { text: "native", image: "native", video: "native", audio: "native" });
    assert.equal(adapter?.auth, "bearer");
    assert.equal(isOpenRouterAdapter("openrouter"), true);
    assert.equal(isOpenRouterAdapter("openai-compatible"), false);
    assert.equal(legacyApiFormatForVendor("openrouter"), "openai");
    assert.equal(legacyApiFormatForAdapter("openrouter"), "openai");
});

test("aggregator-style vendor/model ids are not attributed to a single provider", () => {
    assert.equal(inferModelProvider("google/gemini-2.5-flash-image"), undefined);
    assert.equal(inferModelProvider("x-ai/grok-imagine-image-2.0"), undefined);
    assert.equal(inferModelProvider("bytedance-seed/seedream-4.5"), undefined);
    assert.equal(inferModelProvider("openai/gpt-5"), undefined);
    // 因此聚合渠道保存模型时不会被按厂商误过滤
    assert.equal(modelBelongsToProvider("google/gemini-2.5-flash-image", "openai"), true);
    assert.equal(modelBelongsToProvider("minimax/hailuo-3-max", "openai"), true);
});
