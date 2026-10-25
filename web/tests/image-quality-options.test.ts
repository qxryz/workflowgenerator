import assert from "node:assert/strict";
import test from "node:test";
import { imageQualityOptionsForModel, normalizeImageGenerationQuality } from "../src/lib/generation/image-quality-options.ts";

const seedreamModels = ["doubao-seedream-4-5-251128", "doubao-seedream-5-0-lite-260128"];
test("Seedream models that require more than 1K only expose supported resolutions", () => {
    for (const model of seedreamModels) {
        assert.deepEqual(
            imageQualityOptionsForModel("ark", model).map((choice) => choice.value),
            ["2k", "4k"],
        );
        for (const inherited of ["1k", "1K", "low", "standard", "auto", ""]) assert.equal(normalizeImageGenerationQuality("ark", model, inherited), "2k");
        for (const inherited of ["4k", "4K", "high"]) assert.equal(normalizeImageGenerationQuality("ark", model, inherited), "4k");
    }
});
test("switching from a 1K model resolves the local value against the newly selected model", () => {
    const lowResolutionModel = "doubao-seedream-4-0-250828";
    assert.deepEqual(
        imageQualityOptionsForModel("ark", lowResolutionModel).map((choice) => choice.value),
        ["1k", "2k", "4k"],
    );
    assert.equal(normalizeImageGenerationQuality("ark", lowResolutionModel, "low"), "1k");
    assert.equal(normalizeImageGenerationQuality("ark", seedreamModels[0], "low"), "2k");
    assert.equal(normalizeImageGenerationQuality("ark", seedreamModels[1], "2k"), "2k");
});
test("Grok resolutions match its existing 1K/2K provider mapping", () => {
    const model = "grok-imagine-image-quality";
    assert.deepEqual(
        imageQualityOptionsForModel("xai", model).map((choice) => choice.value),
        ["1k", "2k"],
    );
    for (const inherited of ["auto", "low", "1k"]) assert.equal(normalizeImageGenerationQuality("xai", model, inherited), "1k");
    for (const inherited of ["medium", "high", "hd", "2k", "4k"]) assert.equal(normalizeImageGenerationQuality("xai", model, inherited), "2k");
});
test("generic image quality preserves existing supplier and custom script values", () => {
    assert.deepEqual(
        imageQualityOptionsForModel("openai", "custom-image").map((choice) => choice.value),
        ["auto", "high", "medium", "low"],
    );
    for (const value of ["1k", "2k", "4k", "auto", "standard", "hd", "provider-quality", "CustomQuality"])
        assert.equal(normalizeImageGenerationQuality("openai", "custom-image", value), value);
    for (const value of ["standard", "hd"])
        assert.equal(normalizeImageGenerationQuality("openai", "dall-e-3", value), value);
    assert.equal(normalizeImageGenerationQuality("openai", "custom-image", undefined), "auto");
});
test("models without an exposed quality parameter do not gain unsupported options", () => {
    for (const [protocol, model] of [
        ["minimax", "image-01"],
        ["agnes", "agnes-image-2.1-flash"],
    ]) {
        assert.deepEqual(imageQualityOptionsForModel(protocol, model), []);
        assert.equal(normalizeImageGenerationQuality(protocol, model, "1k"), "1k");
    }
});
