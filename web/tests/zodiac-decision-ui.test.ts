import assert from "node:assert/strict";
import test from "node:test";

import {
    extractZodiacDecisionPayload,
    hasZodiacDecisionProtocol,
    hasExplicitZodiacDecisionProtocol,
    normalizeZodiacDecisionUi,
    stripZodiacDecisionPayload,
} from "../src/lib/agent/zodiac-decision-ui.ts";

function fenced(value: unknown, ticks = "```") {
    return `先选定这一层。\n${ticks}zodiac-ui\n${JSON.stringify(value)}\n${ticks}`;
}

test("single choice accepts two to four bounded options and strips its protocol", () => {
    const reply = fenced({
        id: "visual-direction",
        type: "single_choice",
        question: "先选一个画面方向",
        options: [
            { id: "clean", label: "干净留白", description: "主体更突出" },
            { id: "cinematic", label: "电影质感" },
        ],
        allowCustom: true,
    });

    assert.deepEqual(extractZodiacDecisionPayload(reply), {
        text: "先选定这一层。",
        decision: {
            id: "visual-direction",
            type: "single_choice",
            question: "先选一个画面方向",
            options: [
                { id: "clean", label: "干净留白", description: "主体更突出" },
                { id: "cinematic", label: "电影质感" },
            ],
            allowCustom: true,
        },
    });

    const tooFew = JSON.parse(JSON.stringify(extractZodiacDecisionPayload(reply)?.decision)) as Record<string, unknown>;
    tooFew.options = [{ id: "only", label: "唯一选项" }];
    assert.equal(normalizeZodiacDecisionUi(tooFew), undefined);

    const tooMany = {
        ...tooFew,
        options: Array.from({ length: 5 }, (_, index) => ({ id: `option-${index}`, label: `选项 ${index}` })),
    };
    assert.equal(normalizeZodiacDecisionUi(tooMany), undefined);
});

test("multi choice accepts at most six unique options", () => {
    const decision = normalizeZodiacDecisionUi({
        id: "delivery",
        type: "multi_choice",
        question: "需要哪些版本？",
        options: Array.from({ length: 6 }, (_, index) => ({ id: `format-${index}`, label: `版本 ${index + 1}` })),
    });
    assert.equal(decision?.type, "multi_choice");
    assert.equal(decision?.options.length, 6);

    assert.equal(normalizeZodiacDecisionUi({
        id: "duplicate",
        type: "multi_choice",
        question: "选择",
        options: [{ id: "same", label: "一" }, { id: "same", label: "二" }],
    }), undefined);
});

test("short text keeps only bounded declarative labels", () => {
    assert.deepEqual(normalizeZodiacDecisionUi({
        id: "campaign-name",
        type: "short_text",
        question: "这次活动叫什么？",
        placeholder: "输入活动名",
        submitLabel: "继续",
    }), {
        id: "campaign-name",
        type: "short_text",
        question: "这次活动叫什么？",
        placeholder: "输入活动名",
        submitLabel: "继续",
    });

    assert.equal(normalizeZodiacDecisionUi({
        id: "campaign-name",
        type: "short_text",
        question: "这次活动叫什么？",
        placeholder: "x".repeat(121),
    }), undefined);
});

test("asset picker accepts one to twelve existing node references", () => {
    const decision = normalizeZodiacDecisionUi({
        id: "source-assets",
        type: "asset_picker",
        question: "用哪张图继续？",
        options: [
            { nodeId: "image-result-1", label: "产品正面" },
            { nodeId: "图片结果槽-2", label: "产品侧面", description: "上一轮生成" },
        ],
        multiple: true,
    });
    assert.equal(decision?.type, "asset_picker");
    assert.equal(decision?.options.length, 2);

    assert.equal(normalizeZodiacDecisionUi({
        id: "bad-assets",
        type: "asset_picker",
        question: "用哪张图？",
        options: [{ nodeId: "bad node/id", label: "不可用" }],
    }), undefined);

    assert.equal(normalizeZodiacDecisionUi({
        id: "too-many-assets",
        type: "asset_picker",
        question: "用哪些图？",
        options: Array.from({ length: 13 }, (_, index) => ({ nodeId: `image-${index}`, label: `图 ${index}` })),
    }), undefined);
});

test("confirmation summary is a short bounded list", () => {
    assert.deepEqual(normalizeZodiacDecisionUi({
        id: "confirm-storyboard",
        type: "confirm_summary",
        question: "按这个分镜继续？",
        summary: ["三段式结构", "竖屏 9:16", "先生成首帧"],
        confirmLabel: "开始编排",
        cancelLabel: "再调整",
    }), {
        id: "confirm-storyboard",
        type: "confirm_summary",
        question: "按这个分镜继续？",
        summary: ["三段式结构", "竖屏 9:16", "先生成首帧"],
        confirmLabel: "开始编排",
        cancelLabel: "再调整",
    });

    assert.equal(normalizeZodiacDecisionUi({
        id: "empty-summary",
        type: "confirm_summary",
        question: "继续？",
        summary: [],
    }), undefined);
});

test("schema fails closed on extra fields, invalid ids and incorrect primitive types", () => {
    const base = {
        id: "direction",
        type: "single_choice",
        question: "选哪个？",
        options: [{ id: "a", label: "A" }, { id: "b", label: "B" }],
    };
    assert.equal(normalizeZodiacDecisionUi({ ...base, html: "<button>运行</button>" }), undefined);
    assert.equal(normalizeZodiacDecisionUi({ ...base, id: "bad id" }), undefined);
    assert.equal(normalizeZodiacDecisionUi({ ...base, allowCustom: "yes" }), undefined);
    assert.equal(normalizeZodiacDecisionUi({ ...base, question: `问题${String.fromCharCode(0)}` }), undefined);
    assert.equal(normalizeZodiacDecisionUi({ ...base, options: [{ id: "a", label: "A", onClick: "run()" }, { id: "b", label: "B" }] }), undefined);
});

test("invalid and unfinished explicit blocks are hidden from visible copy", () => {
    const invalid = "可见回答\n```zodiac-ui\n{\"type\":\"short_text\",\"script\":\"alert(1)\"}\n```\n下一句";
    assert.equal(extractZodiacDecisionPayload(invalid), undefined);
    assert.equal(stripZodiacDecisionPayload(invalid), "可见回答\n\n下一句");

    const unfinished = "可见回答\r\n```zodiac-ui\r\n{\"id\":\"partial\"";
    assert.equal(extractZodiacDecisionPayload(unfinished), undefined);
    assert.equal(stripZodiacDecisionPayload(unfinished), "可见回答");
});

test("ordinary JSON and unrelated fences remain untouched", () => {
    const ordinary = "说明\n```json\n{\"type\":\"single_choice\"}\n```";
    const javascript = "示例\n```javascript\nbutton.onclick = run\n```";
    assert.equal(stripZodiacDecisionPayload(ordinary), ordinary);
    assert.equal(stripZodiacDecisionPayload(javascript), javascript);
    assert.equal(extractZodiacDecisionPayload(ordinary), undefined);
});

test("four-tick fences preserve embedded triple ticks and CRLF is supported", () => {
    const payload = {
        id: "copy",
        type: "short_text",
        question: "补充一句文案",
        placeholder: "可以提到 ```，它只是文本",
    };
    const reply = `继续前补充文案\r\n\`\`\`\`ZODIAC-UI\r\n${JSON.stringify(payload)}\r\n\`\`\`\``;
    assert.deepEqual(extractZodiacDecisionPayload(reply), { text: "继续前补充文案", decision: payload });
});

test("multiple decision blocks are rejected and all remain hidden", () => {
    const first = fenced({
        id: "one",
        type: "short_text",
        question: "第一个问题",
    });
    const second = fenced({
        id: "two",
        type: "short_text",
        question: "第二个问题",
    });
    const reply = `${first}\n${second}`;
    assert.equal(extractZodiacDecisionPayload(reply), undefined);
    assert.equal(stripZodiacDecisionPayload(reply), "先选定这一层。\n\n先选定这一层。");
});

test("recovers a provider-distorted raw decision and hides transport sentinels", () => {
    const payload = {
        id: "visual-direction",
        type: "single_choice",
        question: "先选一个画面方向",
        options: [
            { id: "cinematic", label: "电影写实" },
            { id: "graphic", label: "平面插画" },
        ],
    };
    const reply = `方向已经明确。\n<|minimax|> zodiac-ui ${JSON.stringify(payload)} [blocked]`;
    assert.deepEqual(extractZodiacDecisionPayload(reply), { text: "方向已经明确。", decision: payload });
    assert.equal(stripZodiacDecisionPayload(reply), "方向已经明确。");
    assert.equal(hasExplicitZodiacDecisionProtocol(reply), true);
});

test("unfinished raw decisions are hidden and never parsed", () => {
    const reply = "先选风格。\nzodiac-ui {\"id\":\"style\",\"type\":\"short_text\"";
    assert.equal(extractZodiacDecisionPayload(reply), undefined);
    assert.equal(stripZodiacDecisionPayload(reply), "先选风格。");
    assert.equal(hasExplicitZodiacDecisionProtocol(reply), true);
});

test("multiple raw decisions fail closed while hiding every payload", () => {
    const first = { id: "one", type: "short_text", question: "第一个问题" };
    const second = { id: "two", type: "short_text", question: "第二个问题" };
    const reply = `开头\nzodiac-ui ${JSON.stringify(first)} [done]\n中间\nzodiac-ui ${JSON.stringify(second)} [blocked]\n结尾`;
    assert.equal(extractZodiacDecisionPayload(reply), undefined);
    assert.equal(stripZodiacDecisionPayload(reply), "开头\n中间\n结尾");
});

test("raw scanner respects escaped quotes and braces inside strings", () => {
    const payload = {
        id: "copy",
        type: "short_text",
        question: "补充一句包含 {大括号} 和 \\\"引号\\\" 的文案",
        placeholder: "也可以输入 ```",
    };
    const reply = `zodiac-ui\n${JSON.stringify(payload)}\n[done]`;
    assert.deepEqual(extractZodiacDecisionPayload(reply)?.decision, payload);
    assert.equal(stripZodiacDecisionPayload(reply), "");
});

test("ordinary mentions, JSON and unrelated provider wrappers remain visible", () => {
    const ordinary = "zodiac-ui 是界面名称，不是传输标记。\n{\"id\":\"ordinary\"}";
    const wrapper = "<|minimax|> 这是一段普通可见说明";
    assert.equal(hasExplicitZodiacDecisionProtocol(ordinary), false);
    assert.equal(stripZodiacDecisionPayload(ordinary), ordinary);
    assert.equal(stripZodiacDecisionPayload(wrapper), wrapper);
});

test("recovers one native choice from duplicated Minimax tool-call transport", () => {
    const payload = {
        id: "aspect-ratio",
        type: "single_choice",
        question: "视频用什么比例？",
        options: [
            { id: "portrait", label: "竖屏 9:16" },
            { id: "landscape", label: "横屏 16:9" },
            { id: "square", label: "方屏 1:1" },
        ],
        allowCustom: true,
    };
    const body = `[aspect-ratio 明确方向后只问画面比例。${JSON.stringify(payload)}]`;
    const reply = `<|minimax|><|tool_call|><|minimax|>${body}<|minimax|><|tool_call|><|minimax|>${body}<|minimax|><|/tool_call|> [blocked]`;
    assert.deepEqual(extractZodiacDecisionPayload(reply), { text: "", decision: payload });
    assert.equal(stripZodiacDecisionPayload(reply), "");
    assert.equal(hasExplicitZodiacDecisionProtocol(reply), true);
});

test("provider tool calls for other schemas are left for their own parser", () => {
    const reply = `<|minimax|><|tool_call|>${JSON.stringify({ summary: "创建节点", ops: [{ type: "add_node" }] })}<|/tool_call|>`;
    assert.equal(hasExplicitZodiacDecisionProtocol(reply), false);
    assert.equal(stripZodiacDecisionPayload(reply), reply);
});

const referenceDecision = {
    id: "fix-refs",
    type: "single_choice",
    question: "按这个角色设定继续？",
    options: [{ id: "continue", label: "按设定继续" }, { id: "adjust", label: "再调整" }],
};
const implicit = { allowImplicit: true };

test("assistant recovery recognizes strict decisions in JSON, unlabelled fences and standalone objects", () => {
    for (const body of [
        `\`\`\`json\n${JSON.stringify(referenceDecision)}\n\`\`\``,
        `\`\`\`\n${JSON.stringify(referenceDecision)}\n\`\`\``,
        `~~~JSON\r\n${JSON.stringify(referenceDecision)}\r\n~~~`,
        JSON.stringify(referenceDecision, null, 2),
    ]) {
        const reply = `保留两个角色的外形和服饰。\n${body}\n继续前选一个。`;
        assert.deepEqual(extractZodiacDecisionPayload(reply, implicit), {
            text: "保留两个角色的外形和服饰。\n\n继续前选一个。",
            decision: referenceDecision,
        });
        assert.equal(hasZodiacDecisionProtocol(reply, implicit), true);
        assert.equal(hasExplicitZodiacDecisionProtocol(reply), false);
    }
});

test("unmarked user JSON and code examples require an explicit assistant recovery opt-in", () => {
    const body = JSON.stringify(referenceDecision);
    for (const reply of [body, `示例\n\`\`\`json\n${body}\n\`\`\``]) {
        assert.equal(extractZodiacDecisionPayload(reply), undefined);
        assert.equal(stripZodiacDecisionPayload(reply), reply);
        assert.equal(hasZodiacDecisionProtocol(reply), false);
    }
});

test("implicit recovery never promotes code, nested objects or incomplete ordinary schemas", () => {
    const body = JSON.stringify(referenceDecision, null, 2);
    for (const reply of [
        `\`\`\`javascript\n${body}\n\`\`\``,
        `\`\`\`\`markdown\n\`\`\`zodiac-ui\n${body}\n\`\`\`\n\`\`\`\``,
        JSON.stringify({ example: referenceDecision }, null, 2),
        JSON.stringify([referenceDecision], null, 2),
        `普通数据\n\`\`\`json\n${JSON.stringify({ id: "data", type: "single_choice" })}\n\`\`\``,
        `行内示例：${JSON.stringify(referenceDecision)}`,
        `缩进代码：\n    ${JSON.stringify(referenceDecision)}`,
    ]) {
        assert.equal(extractZodiacDecisionPayload(reply, implicit), undefined, reply);
        assert.equal(stripZodiacDecisionPayload(reply, implicit), reply, reply);
    }
});

test("implicit recovery fails closed on unsafe fields and contradictory decisions", () => {
    const unsafe = `\`\`\`json\n${JSON.stringify({ ...referenceDecision, onClick: "run_generation()" })}\n\`\`\``;
    assert.equal(extractZodiacDecisionPayload(unsafe, implicit), undefined);
    assert.equal(hasZodiacDecisionProtocol(unsafe, implicit), true);
    assert.equal(stripZodiacDecisionPayload(unsafe, implicit), "");
    const conflict = `${JSON.stringify(referenceDecision)}\n${fenced({ id: "other", type: "short_text", question: "补充要求" })}`;
    assert.equal(extractZodiacDecisionPayload(conflict, implicit), undefined);
    assert.equal(stripZodiacDecisionPayload(conflict, implicit), "先选定这一层。");
});

test("streaming buffers candidate JSON until complete without creating partial decisions", () => {
    for (const prefix of ["```zodiac-ui\n", "```json\n", "```\n", ""]) {
        const object = JSON.stringify(referenceDecision);
        for (let length = 1; length < object.length; length += 1) {
            const reply = `先选择。\n${prefix}${object.slice(0, length)}`;
            const options = { ...implicit, streaming: true };
            assert.equal(extractZodiacDecisionPayload(reply, options), undefined);
            assert.equal(stripZodiacDecisionPayload(reply, options), "先选择。", `${prefix} at ${length}`);
        }
    }
    const ordinary = '说明\n```json\n{"example":';
    assert.equal(stripZodiacDecisionPayload(ordinary, { ...implicit, streaming: true }), "说明");
    assert.equal(stripZodiacDecisionPayload(ordinary, implicit), ordinary, "ordinary unfinished data returns when the stream ends");
});

test("complete decision JSON survives an omitted closing fence only after streaming finishes", () => {
    for (const label of ["zodiac-ui", "json", ""]) {
        const reply = `继续前选一个。\n\`\`\`${label}\n${JSON.stringify(referenceDecision)}`;
        assert.equal(extractZodiacDecisionPayload(reply, { ...implicit, streaming: true }), undefined);
        assert.deepEqual(extractZodiacDecisionPayload(reply, implicit), { text: "继续前选一个。", decision: referenceDecision });
    }
});

test("truncated assistant decision envelopes become recoverable without promoting partial data", () => {
    const body = JSON.stringify(referenceDecision).slice(0, -15);
    for (const reply of [body, `说明\n\`\`\`json\n${body}`, `说明\n\`\`\`json\n${body}\n\`\`\``]) {
        assert.equal(extractZodiacDecisionPayload(reply, implicit), undefined);
        assert.equal(hasZodiacDecisionProtocol(reply, implicit), true);
        assert.equal(stripZodiacDecisionPayload(reply, implicit), reply.startsWith("说明") ? "说明" : "");
    }
    const ordinary = '{"id":"example","type":"single_choice"';
    assert.equal(hasZodiacDecisionProtocol(ordinary, implicit), false);
    assert.equal(stripZodiacDecisionPayload(ordinary, implicit), ordinary);
});

test("recovered decision remains schema-valid through a JSON storage round trip", () => {
    const parsed = extractZodiacDecisionPayload(`\`\`\`json\n${JSON.stringify(referenceDecision)}\n\`\`\``, implicit);
    assert.ok(parsed);
    const stored = JSON.parse(JSON.stringify({ text: parsed.text, decision: { ui: parsed.decision, status: "answered", answerLabel: "按设定继续" } }));
    assert.deepEqual(normalizeZodiacDecisionUi(stored.decision.ui), referenceDecision);
    assert.equal(stored.text, "");
    assert.equal(stored.decision.answerLabel, "按设定继续");
});
