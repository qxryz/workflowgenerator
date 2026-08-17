import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMiniMaxEndpoint, buildMiniMaxImageRequest, parseMiniMaxImageResponse } from "../src/lib/minimax-contract.ts";

const imageServiceSource = readFileSync(new URL("../src/services/api/image.ts", import.meta.url), "utf8");
const imagePanelSource = readFileSync(new URL("../src/components/image-settings-panel.tsx", import.meta.url), "utf8");
const imagePageSource = readFileSync(new URL("../src/pages/image/index.tsx", import.meta.url), "utf8");

test("MiniMax image-01 uses the native endpoint and supported request fields", () => {
    assert.equal(buildMiniMaxEndpoint("https://api.minimaxi.com/anthropic/v1", "image"), "https://api.minimaxi.com/v1/image_generation");
    assert.deepEqual(
        buildMiniMaxImageRequest("image-01", {
            prompt: "保持人物特征，改为清晨街景",
            ratio: "21:9",
            count: 12,
            optimizePrompt: true,
            watermark: false,
            responseFormat: "base64",
            referenceImage: "data:image/png;base64,AAAA",
        }),
        {
            model: "image-01",
            prompt: "保持人物特征，改为清晨街景",
            aspect_ratio: "21:9",
            response_format: "base64",
            n: 9,
            prompt_optimizer: true,
            aigc_watermark: false,
            subject_reference: [{ type: "character", image_file: "data:image/png;base64,AAAA" }],
        },
    );
});

test("MiniMax image response keeps URLs and turns returned base64 into data URLs", () => {
    assert.deepEqual(
        parseMiniMaxImageResponse({ data: { image_urls: ["https://example.com/result.png"], image_base64: ["AAAA"] }, base_resp: { status_code: 0 } }),
        ["https://example.com/result.png", "data:image/jpeg;base64,AAAA"],
    );
    assert.throws(() => parseMiniMaxImageResponse({ base_resp: { status_code: 1004, status_msg: "invalid parameter" } }), /invalid parameter/u);
});

test("image service and native workbench keep MiniMax generation and character-reference editing on one contract", () => {
    assert.match(imageServiceSource, /config\.apiFormat === "ark" \|\| isMiniMaxAdapter/u);
    assert.match(imageServiceSource, /buildMiniMaxEndpoint\(config\.baseUrl, "image"\)/u);
    assert.match(imageServiceSource, /buildMiniMaxImageRequest\(config\.model/u);
    assert.match(imageServiceSource, /watermark: config\.imageWatermark === "true"/u);
    assert.match(imageServiceSource, /responseFormat: isDesktopApp\(\) \? "url" : "base64"/u);
    assert.match(imageServiceSource, /references\.length !== 1/u);
    assert.match(imageServiceSource, /if \(mask\) throw new Error\("MiniMax image-01 不支持蒙版编辑"\)/u);
    assert.match(imagePanelSource, /experience === "minimax-image"[\s\S]*?人物参考[\s\S]*?不支持蒙版/u);
    assert.match(imagePanelSource, /experience === "seedream-image" \|\| experience === "minimax-image"[\s\S]*?<CreatorSwitch label="添加水印"/u);
    assert.match(imagePageSource, /imageExperience === "minimax-image" \? 1/u);
});
