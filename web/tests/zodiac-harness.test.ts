import assert from "node:assert/strict";
import test from "node:test";

import { composeZodiacSystemPrompt } from "../src/lib/agent/zodiac-harness.ts";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";

test("the harness distinguishes declared outputs from exploratory results", () => {
    const prompt = composeZodiacSystemPrompt();
    assert.match(prompt, /声明好的输出槽/);
    assert.match(prompt, /探索式操作/);
    assert.match(prompt, /永远不要同时/);
    assert.match(prompt, /"executionMode":"guided"/);
    assert.match(prompt, /只有用户明确要求“全自动”“直接跑完”“无需确认”/);
    assert.match(prompt, /不要因此改动结果槽自身的 advanceMode/);
});

test("the harness asks one material question through safe declarative UI", () => {
    const prompt = composeZodiacSystemPrompt();
    assert.match(prompt, /只有一个尚未确定的选择会实质改变作品或工作流时/);
    assert.match(prompt, /上下文已经足够时直接推进/);
    assert.match(prompt, /每次最多问一个问题、输出一个 zodiac-ui/);
    assert.match(prompt, /zodiac-ui 与 zodic-ops 不得在同一条回答中出现/);
    assert.match(prompt, /不得输出 HTML、CSS、JavaScript、事件处理器/);
    assert.match(prompt, /单选（2–4 项）/);
    assert.match(prompt, /多选（2–6 项）/);
    assert.match(prompt, /资产选择（1–12 项，nodeId 必须来自当前画布）/);
    assert.match(prompt, /摘要确认/);
});

test("the harness exposes only active create-menu plugin catalog fields and marks the director desk as non-generative", () => {
    const pluginId = "zodiac-director-test";
    try {
        registerNodeDefinitions(
            [
                {
                    type: "director-desk:project",
                    title: "导演台",
                    description: "交互式分镜规划项目",
                    icon: "🎬",
                    defaultSize: { width: 480, height: 320 },
                    defaultMetadata: { content: "private storyboard default" },
                    Content: () => null,
                },
                {
                    type: "director-desk:hidden",
                    title: "内部节点",
                    description: "不得暴露",
                    icon: "🔒",
                    defaultSize: { width: 240, height: 160 },
                    showInCreateMenu: false,
                    Content: () => null,
                },
            ],
            pluginId,
        );

        const prompt = composeZodiacSystemPrompt();
        assert.match(prompt, /\{"type":"director-desk:project","title":"导演台","description":"交互式分镜规划项目"\}/);
        assert.doesNotMatch(prompt, /director-desk:hidden|private storyboard default/);
        assert.match(prompt, /director-desk:project 是交互式分镜规划项目，不是生成动作/);
        assert.match(prompt, /绝不能对它使用 run_generation/);
    } finally {
        unregisterPluginNodes(pluginId);
    }

    assert.doesNotMatch(composeZodiacSystemPrompt(), /director-desk:project/);
});

test("active skills are layered in stable priority order", () => {
    const prompt = composeZodiacSystemPrompt(undefined, [
        { id: "director", name: "创意导演", version: "1.2.0", body: "先定义创意方向。" },
        { id: "story", name: "视觉叙事", body: "再组织镜头。" },
    ]);
    assert.ok(prompt.indexOf("创意导演") < prompt.indexOf("视觉叙事"));
    assert.match(prompt, /1\. 创意导演 · 1\.2\.0/);
});

test("canvas context includes data readiness without leaking full media content", () => {
    const prompt = composeZodiacSystemPrompt({
        title: "广告工作流",
        selectedNodeIds: ["image"],
        nodes: [
            {
                id: "image",
                type: "image",
                title: "主视觉",
                position: { x: 0, y: 0 },
                metadata: { content: "data:image/png;base64,secret", prompt: "夜景" },
            },
        ],
        connections: [],
    });
    assert.match(prompt, /"hasContent":true/);
    assert.doesNotMatch(prompt, /base64,secret/);
});

test("canvas context identifies direct upstream result slots with safe version summaries", () => {
    const prompt = composeZodiacSystemPrompt({
        title: "成片工作流",
        selectedNodeIds: ["video-action"],
        nodes: [
            {
                id: "script-result",
                type: "text",
                title: "分镜结果槽",
                position: { x: 0, y: 0 },
                metadata: { content: "镜头从城市上空缓慢下降", status: "success", terminalOutputRevision: 3 },
            },
            {
                id: "image-result",
                type: "image",
                title: "首帧结果槽",
                position: { x: 300, y: 0 },
                metadata: {
                    content: "data:image/png;base64,private-media-body",
                    storageKey: "/Users/example/private/first-frame.png",
                    status: "success",
                    mimeType: "image/png",
                    bytes: 2048,
                    naturalWidth: 1920,
                    naturalHeight: 1080,
                },
            },
            {
                id: "video-action",
                type: "config",
                title: "生成视频",
                position: { x: 700, y: 0 },
                metadata: { generationMode: "video", prompt: "生成一段城市宣传片" },
            },
        ],
        connections: [
            { fromNodeId: "script-result", toNodeId: "video-action" },
            { fromNodeId: "image-result", toNodeId: "video-action" },
        ],
    });

    assert.match(prompt, /"directUpstreamResultSlots":\[\{"id":"script-result"/);
    assert.match(prompt, /"currentVersion":\{"ready":true,"revision":3,"characters":11\}/);
    assert.match(prompt, /"dimensions":"1920x1080"/);
    assert.doesNotMatch(prompt, /private-media-body/);
    assert.doesNotMatch(prompt, /\/Users\/example\/private/);
});

test("canvas context exposes declared outputs so continuation cannot duplicate existing work", () => {
    const prompt = composeZodiacSystemPrompt({
        title: "短视频工作流",
        selectedNodeIds: [],
        nodes: [
            {
                id: "first-frame-action",
                type: "config",
                title: "生成首帧",
                position: { x: 0, y: 0 },
                metadata: { generationMode: "image", prompt: "香港夜景，高楼之间飞行" },
            },
            {
                id: "first-frame-result",
                type: "image",
                title: "首帧结果",
                position: { x: 400, y: 0 },
                metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "first-frame-action", slotState: "empty" },
            },
        ],
        connections: [{ fromNodeId: "first-frame-action", toNodeId: "first-frame-result" }],
    });

    assert.match(prompt, /"declaredOutputSlots":\[\{"id":"first-frame-result"/);
    assert.match(prompt, /"resultSlotSourceNodeId":"first-frame-action"/);
    assert.match(prompt, /已经存在的动作、结果槽和连线不得换新 id 再创建一遍/);
    assert.match(prompt, /香港夜景，高楼之间飞行/);
});
