import assert from "node:assert/strict";
import test from "node:test";

import { arkImageGenerationParameters, imageOutputParameters, inferModelProvider, modelBelongsToProvider, modelUiAdaptation, sanitizeImageRequestPayload, supportsArkPromptOptimization } from "../src/lib/model-providers.ts";

test("known model families resolve to one provider", () => {
    assert.equal(inferModelProvider("gpt-image-2"), "openai");
    assert.equal(inferModelProvider("grok-imagine-video"), "xai");
    assert.equal(inferModelProvider("gemini-3.1-pro-preview"), "gemini");
    assert.equal(inferModelProvider("agnes-video-v2.0"), "agnes");
    assert.equal(inferModelProvider("doubao-seedance-2-0-260128"), "ark");
});

test("a channel rejects models owned or declared by another provider", () => {
    assert.equal(modelBelongsToProvider("gpt-image-2", "openai"), true);
    assert.equal(modelBelongsToProvider("grok-imagine-video", "openai"), false);
    assert.equal(modelBelongsToProvider("custom-openai-deployment", "openai"), true);
    assert.equal(modelBelongsToProvider("custom-deployment", "openai", "xai"), false);
});

test("image payloads only include optional output fields for compatible model families", () => {
    assert.deepEqual(imageOutputParameters("openai", "agnes-t2i-general-model"), {});
    assert.deepEqual(imageOutputParameters("agnes", "agnes-image-2.1-flash"), {});
    assert.deepEqual(imageOutputParameters("openai", "gpt-image-2"), { outputFormat: "png" });
    assert.deepEqual(imageOutputParameters("openai", "dall-e-3"), { responseFormat: "b64_json" });
    assert.deepEqual(imageOutputParameters("ark", "doubao-seedream-5-0-lite-260128"), { responseFormat: "url" });
});

test("Ark image payloads use native Seedream parameters instead of OpenAI fields", () => {
    assert.deepEqual(arkImageGenerationParameters("doubao-seedream-4-5-251128", "2K", 1, false, true), {
        size: "2K",
        response_format: "url",
        sequential_image_generation: "disabled",
        watermark: false,
    });
    assert.deepEqual(arkImageGenerationParameters("doubao-seedream-4-0-250828", "2048x1152", 3, true, true), {
        size: "2048x1152",
        response_format: "url",
        sequential_image_generation: "auto",
        sequential_image_generation_options: { max_images: 3 },
        watermark: true,
        optimize_prompt_options: { mode: "standard" },
    });
    assert.equal(supportsArkPromptOptimization("doubao-seedream-4-5-251128"), false);
    assert.equal(supportsArkPromptOptimization("doubao-seedream-4-0-250828"), true);
});

test("model family recognition keeps native workbench controls when a compatible transport is used", () => {
    assert.deepEqual(modelUiAdaptation("openai", "agnes-t2i-general-model", "image"), {
        native: true,
        label: "原生 UI",
        detail: "Agnes 图片画幅与生成数量",
    });
});

test("legacy image scripts drop output parameters that an Agnes-compatible model rejects", () => {
    assert.deepEqual(
        sanitizeImageRequestPayload(
            "openai",
            "agnes-t2i-general-model",
            { model: "agnes-t2i-general-model", prompt: "portrait", response_format: "b64_json", output_format: "png" },
        ),
        { model: "agnes-t2i-general-model", prompt: "portrait" },
    );
});
