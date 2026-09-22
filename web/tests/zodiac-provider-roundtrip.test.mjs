import assert from "node:assert/strict";
import test from "node:test";
import { requestZodicReply, readZodicProviderReply } from "../src/services/api/zodic.ts";
import { defaultConfig, encodeChannelModel } from "../src/stores/use-config-store.ts";
const config = (apiFormat = "openai") => ({ ...defaultConfig, channels: [], apiFormat, baseUrl: "https://provider.example/v1", apiKey: "test-key", textModel: "test-model", model: "test-model" });
const json = (value) => new Response(JSON.stringify(value), { headers: { "content-type": "application/json" } });
const answer = (text) => json({ choices: [{ message: { content: text } }] });
async function withFetch(mock, run) {
    const original = globalThis.fetch;
    globalThis.fetch = mock;
    try {
        await run();
    } finally {
        globalThis.fetch = original;
    }
}
test("OpenAI round trip retains images and distinct tool call results", async () => {
    const requests = [],
        calls = [];
    await withFetch(
        async (url, init) => {
            assert.equal(url, "/api/model/proxy-post");
            requests.push(JSON.parse(init.body));
            return requests.length === 1 ? json({ choices: [{ message: { tool_calls: ["one", "two"].map((nodeId) => ({ function: { name: "hub_read", arguments: JSON.stringify({ nodeId }) } })) } }] }) : answer("已读取");
        },
        async () => {
            const image = { type: "image_url", image_url: { url: "data:image/png;base64,aGVsbG8=" } };
            assert.equal(
                await requestZodicReply(config(), [{ role: "user", content: [{ type: "text", text: "读取" }, image] }], () => {}, {
                    onToolRequest: (r) => {
                        calls.push(r);
                        return { ok: true, result: r.args };
                    },
                }),
                "已读取",
            );
            assert.deepEqual(requests[0].body.messages[0].content[1], image);
            assert.ok(requests[0].body.tools.some((t) => t.function.name === "zodiac-ui"));
            assert.notEqual(calls[0].callId, calls[1].callId);
            assert.deepEqual(
                requests[1].body.messages.slice(-2).map((x) => x.tool_call_id),
                calls.map((x) => x.callId),
            );
        },
    );
});
test("invalid JSON becomes a recoverable result and never executes", async () => {
    const requests = [];
    await withFetch(
        async (_, init) => {
            requests.push(JSON.parse(init.body));
            return requests.length === 1 ? json({ choices: [{ message: { tool_calls: [{ id: "bad", function: { name: "hub_read", arguments: "{" } }] } }] }) : answer("已修正");
        },
        async () => {
            assert.equal(await requestZodicReply(config(), [{ role: "user", content: "读取" }], () => {}, { onToolRequest: () => assert.fail("invalid tool must not execute") }), "已修正");
            assert.equal(JSON.parse(requests[1].body.messages.at(-1).content).ok, false);
        },
    );
});
for (const format of ["openai", "gemini"])
    test(`${format} summary requests omit empty tools`, async () => {
        await withFetch(
            async (_, init) => {
                const body = JSON.parse(init.body).body;
                assert.equal("tools" in body, false);
                assert.equal("tool_choice" in body, false);
                return format === "gemini" ? json({ candidates: [{ content: { parts: [{ text: "摘要" }] } }] }) : answer("摘要");
            },
            async () => assert.equal(await requestZodicReply(config(format), [{ role: "user", content: "摘要" }], () => {}), "摘要"),
        );
    });
test("Gemini tool round trip preserves signed function parts", async () => {
    const part = { functionCall: { name: "hub_read", args: { nodeId: "one" } }, thoughtSignature: "signature" };
    let count = 0;
    await withFetch(
        async (_, init) => {
            const body = JSON.parse(init.body).body;
            if (++count === 1) return json({ candidates: [{ content: { parts: [part] } }] });
            assert.deepEqual(body.contents.at(-2).parts, [part]);
            assert.deepEqual(body.contents.at(-1).parts[0].functionResponse.response, { ok: true, result: "正文" });
            return json({ candidates: [{ content: { parts: [{ text: "已读" }] } }] });
        },
        async () => assert.equal(await requestZodicReply(config("gemini"), [{ role: "user", content: "读取" }], () => {}, { onToolRequest: () => ({ ok: true, result: "正文" }) }), "已读"),
    );
});
test("SSE never consumes trailing content after DONE", async () => {
    const values = [];
    await readZodicProviderReply(new Response('data: {"text":"ok"}\n\ndata: [DONE]\n\ndata: {"text":"late"}', { headers: { "content-type": "text/event-stream" } }), (x) => values.push(x));
    assert.deepEqual(values, [{ text: "ok" }]);
});
test("cancelling a tool stops before another provider request", async () => {
    const controller = new AbortController();
    let count = 0;
    await withFetch(
        async () => {
            count++;
            return json({ choices: [{ message: { tool_calls: [{ id: "one", function: { name: "hub_read", arguments: "{}" } }] } }] });
        },
        async () => {
            await assert.rejects(
                requestZodicReply(config(), [{ role: "user", content: "读取" }], () => {}, {
                    signal: controller.signal,
                    onToolRequest: () => {
                        controller.abort();
                        return { ok: true };
                    },
                }),
                { name: "AbortError" },
            );
            assert.equal(count, 1);
        },
    );
});
test("invalid step rejects the entire canvas proposal before dispatch", async () => {
    let count = 0;
    const ops = [
        { type: "delete_node", id: "existing" },
        { type: "connect_nodes", fromNodeId: "existing" },
    ];
    await withFetch(
        async (_, init) => {
            if (++count === 1) return json({ choices: [{ message: { tool_calls: [{ id: "invalid", function: { name: "zodiac-ops", arguments: JSON.stringify({ summary: "修改", ops }) } }] } }] });
            assert.equal(JSON.parse(JSON.parse(init.body).body.messages.at(-1).content).ok, false);
            return answer("请重新确认连接目标");
        },
        async () => assert.equal(await requestZodicReply(config(), [{ role: "user", content: "修改" }], () => {}, { onToolRequest: () => assert.fail("partial operations must not dispatch") }), "请重新确认连接目标"),
    );
});
test("native decision waits for the user without running subsequent calls", async () => {
    let count = 0,
        executed = 0;
    await withFetch(
        async () => {
            count++;
            return json({
                choices: [
                    {
                        message: {
                            tool_calls: [
                                { id: "decision", function: { name: "zodiac-ui", arguments: JSON.stringify({ id: "theme", type: "short_text", question: "主题是什么？" }) } },
                                { id: "other", function: { name: "hub_read", arguments: "{}" } },
                            ],
                        },
                    },
                ],
            });
        },
        async () => {
            const reply = await requestZodicReply(config(), [{ role: "user", content: "创建" }], () => {}, {
                onToolRequest: () => {
                    executed++;
                    return { ok: true };
                },
            });
            assert.equal(reply, "");
            assert.equal(count, 1);
            assert.equal(executed, 1);
        },
    );
});
test("MiniMax native Messages round trip preserves tool IDs and protocol headers", async () => {
    let count = 0;
    await withFetch(
        async (_, init) => {
            const request = JSON.parse(init.body);
            assert.equal(request.headers["anthropic-version"], "2023-06-01");
            if (++count === 1) {
                assert.ok(request.body.tools.some((t) => t.name === "zodiac-ui"));
                return json({ content: [{ type: "tool_use", id: "mm-call", name: "hub_read", input: { nodeId: "one" } }] });
            }
            assert.deepEqual(request.body.messages.at(-2).content, [{ type: "tool_use", id: "mm-call", name: "hub_read", input: { nodeId: "one" } }]);
            assert.equal(request.body.messages.at(-1).content[0].tool_use_id, "mm-call");
            return json({ content: [{ type: "text", text: "完成" }] });
        },
        async () =>
            assert.equal(
                await requestZodicReply({ ...config(), channels: [{ id: "minimax", name: "MiniMax", vendor: "minimax-api", apiFormat: "minimax", adapter: "minimax-api-native", baseUrl: "https://api.minimaxi.com", apiKey: "sk-api-test-key", models: [{name: "MiniMax-M3", capability: "text"}] }], textModel: encodeChannelModel("minimax", "MiniMax-M3") }, [{ role: "user", content: "读取" }], () => {}, {
                    onToolRequest: () => ({ ok: true, result: "正文" }),
                }),
                "完成",
            ),
    );
});
