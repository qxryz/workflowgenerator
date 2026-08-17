import assert from "node:assert/strict";
import test from "node:test";

import { stripZodiacDecisionPayload } from "../src/lib/agent/zodiac-decision-ui.ts";
import { stripZodiacToolPayload } from "../src/lib/agent/zodiac-tool-proposal.ts";
import { sanitizeZodiacSessionProtocol } from "../src/services/zodiac-session-sanitization.ts";

const currentProposal = JSON.stringify({
    summary: "创建图片流程",
    executionMode: "guided",
    ops: [{ type: "add_node", id: "image", nodeType: "config" }],
});
const legacyProposal = JSON.stringify({
    summary: "旧提案",
    ops: [{ op: "add_node", id: "copy", nodeType: "text" }],
});
const stripAllProtocol = (text: string) => stripZodiacDecisionPayload(stripZodiacToolPayload(text));

test("archived assistant protocol is removed before list excerpts and previews consume it", () => {
    const source = {
        id: "history-1",
        summary: `可见摘要\n\`\`\`zodic-ops\n${currentProposal}\n\`\`\``,
        items: [
            { id: "user", role: "user", text: `用户原文\n\`\`\`zodic-ops\n${currentProposal}\n\`\`\`` },
            { id: "assistant-current", role: "assistant", text: `方案已整理\n\`\`\`zodic-ops\n${currentProposal}\n\`\`\`` },
            { id: "assistant-legacy", role: "assistant", text: `旧方案说明\n\`\`\`json\n${legacyProposal}\n\`\`\`` },
        ],
    };

    const result = sanitizeZodiacSessionProtocol(source, stripAllProtocol);

    assert.equal(result.changed, true);
    assert.equal(result.session.summary, "可见摘要");
    assert.equal(result.session.items[0].text, source.items[0].text, "user-authored code is never rewritten");
    assert.equal(result.session.items[1].text, "方案已整理");
    assert.equal(result.session.items[2].text, "旧方案说明");
});

test("session protocol migration is idempotent and preserves ordinary JSON examples", () => {
    const ordinary = `接口示例\n\`\`\`json\n${JSON.stringify({ ops: [{ type: "add_node", id: "example", nodeType: "text" }] })}\n\`\`\``;
    const source = {
        summary: "普通摘要",
        items: [{ id: "assistant", role: "assistant", text: ordinary }],
    };

    const first = sanitizeZodiacSessionProtocol(source, stripAllProtocol);
    const second = sanitizeZodiacSessionProtocol(first.session, stripAllProtocol);

    assert.equal(first.changed, false);
    assert.equal(first.session, source);
    assert.equal(first.session.items[0].text, ordinary);
    assert.equal(second.changed, false);
    assert.equal(second.session, source);
});

test("unfinished archived protocol never reaches a history preview", () => {
    const source = {
        summary: "摘要",
        items: [{ id: "assistant", role: "assistant", text: "可见回答\n```zodic-ops\n{\"summary\":\"未完成\"" }],
    };

    assert.equal(sanitizeZodiacSessionProtocol(source, stripAllProtocol).session.items[0].text, "可见回答");
});

test("unfinished ordinary JSON survives archived session sanitation", () => {
    const ordinary = "说明\n```json\n{\"example\":";
    const source = {
        summary: "普通摘要",
        items: [{ id: "assistant", role: "assistant", text: ordinary }],
    };

    const result = sanitizeZodiacSessionProtocol(source, stripAllProtocol);

    assert.equal(result.changed, false);
    assert.equal(result.session, source);
    assert.equal(result.session.items[0].text, ordinary);
});

test("generated decision protocol is removed from old session previews", () => {
    const source = {
        summary: "摘要",
        items: [{
            id: "assistant",
            role: "assistant",
            text: "先选画面方向\n```zodiac-ui\n{\"id\":\"direction\",\"type\":\"single_choice\",\"question\":\"选哪个？\",\"options\":[{\"id\":\"a\",\"label\":\"明亮\"},{\"id\":\"b\",\"label\":\"深色\"}]}\n```",
        }],
    };

    assert.equal(sanitizeZodiacSessionProtocol(source, stripAllProtocol).session.items[0].text, "先选画面方向");
});
