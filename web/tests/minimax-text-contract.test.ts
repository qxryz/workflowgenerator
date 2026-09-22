import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

// minimax-text.ts 现在静态依赖 @/services/server-storage（服务端透传路由），
// node --experimental-strip-types 不认识 @/ 别名。这里把别名指向 src/，
// 并把传输层换成桩：本文件只校验纯函数与请求体形状，不发起真实请求。
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (specifier === "@/services/server-storage")
            return {
                url: `data:text/javascript,${encodeURIComponent('export const proxyModelPost = async () => { throw new Error("Unexpected transport call"); };')}`,
                shortCircuit: true,
            };
        if (specifier.startsWith("@/")) return { url: new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const { buildMiniMaxAnthropicRequest, parseMiniMaxAnthropicResponse } = await import("../src/services/api/minimax-text.ts");

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

test("MiniMax M3 service is pinned to the native Anthropic endpoint over the raw passthrough route", () => {
    const source = readFileSync(new URL("../src/services/api/minimax-text.ts", import.meta.url), "utf8");
    assert.match(source, /buildMiniMaxEndpoint\(config\.baseUrl,\s*"text"\)/u);
    assert.doesNotMatch(source, /assertMiniMaxBillingSupports/u);
    // 走 proxyModelPost 而非 postModelJson，是为了保留供应商原样的状态码与错误体。
    // 断言"经 proxyModelPost 发出，且 Anthropic 端点必需的 anthropic-version 头"
    // 这一规则本身，而不是逐参数的完整调用串——后者会在任何一次签名调整时误报。
    assert.match(source, /proxyModelPost\(\s*endpoint,/u);
    assert.match(source, /\{ "anthropic-version": "2023-06-01" \}/u);
    assert.doesNotMatch(source, /postModelJson\(/u);
    assert.doesNotMatch(source, /chat\/completions/u);
});
