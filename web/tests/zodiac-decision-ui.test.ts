import assert from "node:assert/strict";
import test from "node:test";

import {
    extractZodiacDecisionPayload,
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
