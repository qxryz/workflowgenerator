import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildMiniMaxAnthropicRequest, parseMiniMaxAnthropicResponse } from "../src/services/api/minimax-text.ts";

test("MiniMax M3 serializes system and multimodal messages to Anthropic Messages", () => {
    const request = buildMiniMaxAnthropicRequest(
        "MiniMax-M3",
        [
            { role: "system", content: "只描述看得见的内容" },
            {
                role: "user",
                content: [
                    { type: "text", text: "比较这两张图" },
                    { type: "image_url", image_url: { url: "data:image/png;base64,QUJD" } },
                    { type: "image_url", image_url: { url: "https://cdn.example.com/reference.jpg" } },
                ],
            },
            { role: "assistant", content: "我会逐项比较。" },
        ],
        "回答要简洁",
    );

    assert.equal(request.model, "MiniMax-M3");
    assert.equal(request.stream, false);
    assert.equal(request.system, "回答要简洁\n\n只描述看得见的内容");
    assert.deepEqual(request.messages, [
        {
            role: "user",
            content: [
                { type: "text", text: "比较这两张图" },
                { type: "image", source: { type: "base64", media_type: "image/png", data: "QUJD" } },
                { type: "image", source: { type: "url", url: "https://cdn.example.com/reference.jpg" } },
            ],
        },
        { role: "assistant", content: [{ type: "text", text: "我会逐项比较。" }] },
    ]);
});

test("MiniMax M3 coalesces adjacent same-role turns and parses content text", () => {
    const request = buildMiniMaxAnthropicRequest("MiniMax-M3", [
        { role: "user", content: "第一段" },
        { role: "user", content: "第二段" },
    ]);
    assert.deepEqual(request.messages, [
        {
            role: "user",
            content: [
                { type: "text", text: "第一段" },
                { type: "text", text: "第二段" },
            ],
        },
    ]);
    assert.equal(
        parseMiniMaxAnthropicResponse({
            content: [
                { type: "text", text: "第一部分" },
                { type: "text", text: "第二部分" },
            ],
        }),
        "第一部分第二部分",
    );
});

test("MiniMax M3 service is pinned to the native Anthropic endpoint and desktop bridge", () => {
    const source = readFileSync(new URL("../src/services/api/minimax-text.ts", import.meta.url), "utf8");
    assert.match(source, /buildMiniMaxEndpoint\(config\.baseUrl,\s*"text"\)/u);
    assert.doesNotMatch(source, /assertMiniMaxBillingSupports/u);
    assert.match(source, /postDesktopModelJson<MiniMaxAnthropicResponse>/u);
    assert.match(source, /"anthropic-version":\s*"2023-06-01"/u);
    assert.doesNotMatch(source, /chat\/completions/u);
});
