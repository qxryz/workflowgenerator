import test from "node:test";
import assert from "node:assert/strict";
import { requestZodicReply } from "../src/services/api/zodic.ts";
import { defaultConfig, encodeChannelModel } from "../src/stores/use-config-store.ts";
const tool = (name) => ({ name, description: name, parameters: { type: "object", properties: {} } });
const config = (format) =>
    format === "minimax"
        ? {
              ...defaultConfig,
              channels: [{ id: "mm", name: "MiniMax", vendor: "minimax-api", apiFormat: "minimax", adapter: "minimax-api-native", baseUrl: "https://api.minimaxi.com", apiKey: "sk-api-testing", models: [{ name: "MiniMax-M3", capability: "text" }] }],
              textModel: encodeChannelModel("mm", "MiniMax-M3"),
          }
        : { ...defaultConfig, channels: [], apiFormat: format, baseUrl: "https://model.example/v1", apiKey: "test-key", textModel: "model", model: "model" };
const reply = (format, name) =>
    Response.json(
        format === "gemini"
            ? { candidates: [{ content: { parts: [name ? { functionCall: { name, args: {} } } : { text: "done" }] } }] }
            : format === "minimax"
              ? { content: [name ? { type: "tool_use", id: `call-${name}`, name, input: {} } : { type: "text", text: "done" }] }
              : { choices: [{ message: name ? { tool_calls: [{ id: `call-${name}`, function: { name, arguments: "{}" } }] } : { content: "done" } }] },
    );
const names = (format, body) => (format === "gemini" ? (body.tools?.[0]?.functionDeclarations || []).map((tool) => tool.name) : (body.tools || []).map((tool) => (format === "minimax" ? tool.name : tool.function.name)));

for (const format of ["openai", "gemini", "minimax"]) {
    test(`${format} advertises and validates the same dynamic tool catalog`, async (t) => {
        const original = globalThis.fetch;
        let loaded = false,
            count = 0;
        const dispatched = [];
        globalThis.fetch = async (_url, init) => {
            const body = JSON.parse(init.body).body;
            assert.deepEqual(names(format, body), loaded ? ["custom_load", "custom_read"] : ["custom_load"]);
            count++;
            return reply(format, count === 1 ? "custom_load" : count === 2 ? "custom_read" : undefined);
        };
        t.after(() => {
            globalThis.fetch = original;
        });
        assert.equal(
            await requestZodicReply(config(format), [{ role: "user", content: "read" }], () => {}, {
                tools: () => (loaded ? [tool("custom_load"), tool("custom_read")] : [tool("custom_load")]),
                onToolRequest: (request) => {
                    dispatched.push(request.name);
                    loaded = true;
                    return { ok: true };
                },
            }),
            "done",
        );
        assert.deepEqual(dispatched, ["custom_load", "custom_read"]);
    });
    test(`${format} rejects unadvertised tools without dispatching them`, async (t) => {
        const original = globalThis.fetch;
        let count = 0;
        globalThis.fetch = async (_url, init) => {
            assert.deepEqual(names(format, JSON.parse(init.body).body), ["custom_read"]);
            return reply(format, ++count === 1 ? "hub_generate_image" : undefined);
        };
        t.after(() => {
            globalThis.fetch = original;
        });
        assert.equal(await requestZodicReply(config(format), [{ role: "user", content: "read" }], () => {}, { tools: [tool("custom_read")], onToolRequest: () => assert.fail("unadvertised tools must not execute") }), "done");
    });
}
