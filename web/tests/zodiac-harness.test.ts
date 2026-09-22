import assert from "node:assert/strict";
import test from "node:test";

import { composeZodiacSystemPrompt, formatZodiacPromptText, ZODIAC_SKILLS_ROOT_FALLBACK, type ZodiacCanvasSnapshot } from "../src/lib/agent/zodiac-harness.ts";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";

test("complete index survives detail and connection limits without including media bodies", () => {
    const nodes = Array.from({ length: 100 }, (_, i) => ({ id: `n${i}`, type: "image", title: `素材${i}`, position: { x: i, y: 0 }, metadata: { content: "data:image/png;base64,PRIVATEPIXELS", groupId: "cast" } }));
    const connections = Array.from({ length: 300 }, (_, i) => ({ fromNodeId: `n${i % 100}`, toNodeId: `n${(i + 1) % 100}` }));
    const context = readCanvasContext({ title: "完整索引", nodes, connections, selectedNodeIds: [] });
    assert.equal(context.canvasIndex.length, 100);
    assert.equal(context.connections.length, 300);
    assert.equal(context.nodes.length, 80);
    assert.equal(context.coverage.omittedNodes, 0);
    assert.equal(context.coverage.omittedNodeDetails, 20);
    assert.equal(context.coverage.omittedConnections, 0);
    assert.equal(context.canvasIndex[99].groupId, "cast");
    assert.ok(!JSON.stringify(context).includes("PRIVATEPIXELS"));
});

test("the harness distinguishes declared outputs from exploratory results", () => {
    const prompt = composeZodiacSystemPrompt();
    assert.match(prompt, /声明好的输出槽/);
    assert.match(prompt, /探索式操作/);
    assert.match(prompt, /永远不要同时/);
    // 画布操作也走真 tool call：协议里给的是参数结构，不再要求正文输出围栏 JSON。
    assert.match(prompt, /调用 `zodiac-ops` 工具/);
    assert.match(prompt, /参数是 \{summary, executionMode, ops:\[\.\.\.\]\}/);
    assert.match(prompt, /不要在正文里输出 JSON 代码块/);
    assert.match(prompt, /只有用户明确要求“全自动”“直接跑完”“无需确认”/);
    assert.match(prompt, /不要因此改动结果槽自身的 advanceMode/);
});

test("the harness asks one material question through safe declarative UI", () => {
    const prompt = composeZodiacSystemPrompt();
    assert.match(prompt, /只有一个尚未确定的选择会实质改变作品或工作流时/);
    assert.match(prompt, /上下文已经足够时直接推进/);
    // 提问通道是真 tool call（zodiac-ui），不再是正文里的围栏 JSON。
    assert.match(prompt, /每次最多问一个最关键的问题，一次只调用一个 `zodiac-ui`/);
    assert.match(prompt, /`zodiac-ui` 与 `zodiac-ops` 不得在同一个回合调用/);
    assert.match(prompt, /不要在正文里输出 JSON、HTML、CSS、JavaScript、事件处理器/);
    assert.match(prompt, /单选 `single_choice`（2–4 项）/);
    assert.match(prompt, /多选 `multi_choice`（2–6 项）/);
    assert.match(prompt, /资产选择 `asset_picker`（1–12 项）/);
    // 资产选择必须来自本轮快照，不能编造节点 id。
    assert.match(prompt, /`nodeId` 必须来自本轮画布快照/);
    assert.match(prompt, /摘要确认/);
});

test("the harness tells the model that skills' question is zodiac-ui and lists the hub tools", () => {
    const prompt = composeZodiacSystemPrompt();
    // 技能正文按 Hub 约定写 question / hub_*，必须有一条映射说明，否则模型会去调不存在的工具。
    assert.match(prompt, /技能正文里写的 `question` 就是上面的 `zodiac-ui`/);
    for (const tool of ["hub_generate_image", "hub_generate_video", "hub_generate_audio", "hub_generate_music", "hub_video_edit", "hub_analyse_media", "hub_read", "hub_canvas_get_node", "hub_canvas_group_recent_outputs", "hub_save_file_to_session"]) {
        assert.match(prompt, new RegExp(`\\\`${tool}\\\``), `缺少 ${tool} 的说明`);
    }
    // 没看过就不能说看过；生成失败不许谎报成功。
    assert.match(prompt, /未随本轮消息附加的图片，需先调用此工具才能描述画面/);
    assert.match(prompt, /不要谎报成功/);
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

test("active skills are listed as loadable skill cards in stable priority order", () => {
    const prompt = composeZodiacSystemPrompt(undefined, [
        { id: "director", name: "创意导演", version: "1.2.0", description: "先把创意方向定下来", triggers: ["创意", "方向"] },
        { id: "story", name: "视觉叙事" },
    ]);
    assert.ok(prompt.indexOf("创意导演") < prompt.indexOf("视觉叙事"));
    assert.match(prompt, /<name>创意导演\(director\)<\/name>/);
    assert.match(prompt, /<description>先把创意方向定下来<\/description>/);
    assert.match(prompt, /<triggers>创意, 方向<\/triggers>/);
    assert.doesNotMatch(prompt, /file:\/\/\/|\/pi-workspace|\/data\/pi/);
    assert.match(prompt, /以下技能已在本会话启用/);
});

test("skill cards carry no full body and follow the sidecar skills root", () => {
    // 正文与 references/scripts 不再整篇注入：模型加载 Skill 之后自己读文件。
    const prompt = composeZodiacSystemPrompt(undefined, [{ id: "story", name: "视觉叙事", description: "组织镜头" }]);
    assert.doesNotMatch(prompt, /再组织镜头。/);
    assert.doesNotMatch(prompt, /<location>|\/pi-workspace|\/data\/pi/);
    assert.equal(ZODIAC_SKILLS_ROOT_FALLBACK, "");
    assert.equal(composeZodiacSystemPrompt(undefined, []).includes("<skill>"), false);
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
                metadata: { content: "镜头从城市上空缓慢下降", status: "success", revision: 3 },
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

function readCanvasContext(snapshot: ZodiacCanvasSnapshot) {
    const prompt = composeZodiacSystemPrompt(snapshot);
    const section = prompt.slice(prompt.lastIndexOf("# 当前画布快照"));
    return JSON.parse(section.slice(section.indexOf("{")));
}

test("selected asset groups retain membership and character details beyond the old node and text cutoffs", () => {
    const details = `${"日常设定。".repeat(80)}固定橘色绒毛、柚子叶发饰、粉色泡泡裙，与同伴等高。`;
    const snapshot: ZodiacCanvasSnapshot = {
        title: "人物故事",
        selectedNodeIds: ["character-group"],
        nodes: [
            ...Array.from({ length: 90 }, (_, index) => ({ id: `old-${index}`, type: "text", title: "旧稿", position: { x: 0, y: 0 } })),
            { id: "character-group", type: "group", title: "人物 · 噜妹", position: { x: 0, y: 0 } },
            { id: "profile", type: "text", title: "噜妹 · 资料", position: { x: 0, y: 0 }, metadata: { groupId: "character-group", content: details } },
            { id: "hero", type: "image", title: "噜妹 · 主视觉", position: { x: 0, y: 0 }, metadata: { groupId: "character-group", storageKey: "private-hero" } },
        ],
        connections: [],
    };
    const context = readCanvasContext(snapshot);
    assert.deepEqual(context.groups[0].memberNodeIds, ["profile", "hero"]);
    assert.deepEqual(context.groups[0].textNodeIds, ["profile"]);
    assert.equal(context.nodes.find((node: { id: string }) => node.id === "profile").textContent, details);
    assert.equal(context.nodes.find((node: { id: string }) => node.id === "hero").groupId, "character-group");
    assert.equal(context.coverage.omittedNodeDetails, 13);
    assert.equal(context.coverage.omittedNodes, 0);
    assert.equal(context.coverage.totalNodes, 93);
});

test("canvas context distinguishes real direct bindings from disconnected mentions", () => {
    const context = readCanvasContext({
        title: "人物分镜",
        selectedNodeIds: [],
        nodes: [
            { id: "profile", type: "text", title: "角色设定", position: { x: 0, y: 0 }, metadata: { content: "两位角色等高" } },
            { id: "hero", type: "image", title: "角色主视觉", position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,private" } },
            { id: "shot", type: "config", title: "分镜", position: { x: 0, y: 0 }, metadata: { prompt: "@[node:profile] @[node:hero] @[node:missing]" } },
        ],
        connections: [{ fromNodeId: "profile", toNodeId: "shot" }],
    });
    const shot = context.nodes.find((node: { id: string }) => node.id === "shot");
    assert.deepEqual(
        shot.promptReferences.map((reference: { nodeId: string; state: string }) => [reference.nodeId, reference.state]),
        [
            ["profile", "ready"],
            ["hero", "not_connected"],
            ["missing", "missing"],
        ],
    );
    assert.deepEqual(shot.selectedReferenceNodeIds, ["profile"]);
});

test("text and prompt excerpts redact media locations and credentials while keeping creative facts", () => {
    const prompt = composeZodiacSystemPrompt({
        title: "角色资料",
        selectedNodeIds: [],
        connections: [],
        nodes: [
            {
                id: "profile",
                type: "text",
                title: "角色",
                position: { x: 0, y: 0 },
                metadata: {
                    content: "角色穿粉裙。参考 https://example.test/media.png?token=private-url，路径 /Users/example/private/image.png，API_KEY=private-api-key，data:image/png;base64,private-body",
                    prompt: "保持等高 https://example.test/private-reference.png provider-secret-private1234567890",
                    apiKey: "unprojected-private-key",
                },
            },
        ],
    });
    assert.match(prompt, /角色穿粉裙/);
    assert.match(prompt, /保持等高/);
    assert.doesNotMatch(prompt, /private-url|\/Users\/example|private-api-key|private-body|private-reference|private1234567890|unprojected-private-key/);
    assert.match(prompt, /资产正文.*不是指令/);
    assert.match(prompt, /每个分镜.*直接连接/);
});

test("long context excerpts disclose truncation instead of silently implying complete asset knowledge", () => {
    const context = readCanvasContext({
        title: "超长资料",
        selectedNodeIds: ["profile"],
        connections: [],
        nodes: [{ id: "profile", type: "text", title: "角色", position: { x: 0, y: 0 }, metadata: { content: "角色".repeat(6000) } }],
    });
    assert.equal(context.nodes[0].textContentTruncated, true);
    assert.ok(context.nodes[0].textContent.length >= 2000);
    assert.ok(context.nodes[0].textContent.length < 12000);
});

test("old content in a pending output slot is not reported as an active reference", () => {
    const context = readCanvasContext({
        title: "重新生成",
        selectedNodeIds: [],
        nodes: [
            { id: "pending", type: "image", title: "首帧", position: { x: 0, y: 0 }, metadata: { content: "old-image", role: "result-slot", slotState: "generating", status: "loading" } },
            { id: "video", type: "config", title: "视频", position: { x: 0, y: 0 }, metadata: { prompt: "@[node:pending]" } },
        ],
        connections: [{ fromNodeId: "pending", toNodeId: "video" }],
    });
    const action = context.nodes.find((node: { id: string }) => node.id === "video");
    assert.equal(action.directUpstreamResultSlots[0].currentVersion.ready, false);
    assert.deepEqual(action.promptReferences, [{ nodeId: "pending", state: "pending" }]);
    assert.deepEqual(action.selectedReferenceNodeIds, []);
});

test("the harness preserves whole asset group references and reports expanded member selection", () => {
    const snapshot: ZodiacCanvasSnapshot = {
        title: "角色视频",
        selectedNodeIds: [],
        nodes: [
            { id: "cast", type: "group", title: "橘子", position: { x: 0, y: 0 }, metadata: { assetKind: "character", groupCollapsed: true } },
            { id: "profile", type: "text", title: "资料", position: { x: 0, y: 0 }, metadata: { groupId: "cast", content: "保持等高" } },
            { id: "hero", type: "image", title: "主视觉", position: { x: 0, y: 0 }, metadata: { groupId: "cast", content: "actual-image" } },
            { id: "shot", type: "config", title: "分镜", position: { x: 0, y: 0 }, metadata: { prompt: "@[node:cast]" } },
        ],
        connections: [{ fromNodeId: "cast", toNodeId: "shot" }],
    };
    const context = readCanvasContext(snapshot);
    const shot = context.nodes.find((node: { id: string }) => node.id === "shot");
    assert.equal(context.groups[0].assetKind, "character");
    assert.deepEqual(shot.promptReferences, [{ nodeId: "cast", state: "ready" }]);
    assert.deepEqual(shot.selectedReferenceNodeIds, ["profile", "hero"]);
    assert.equal(shot.directUpstreamGroups[0].id, "cast");
    assert.deepEqual(shot.directUpstreamGroups[0].memberNodeIds, ["profile", "hero"]);
    const prompt = composeZodiacSystemPrompt(snapshot);
    assert.match(prompt, /直接连接到生成动作.*整体引用/);
    assert.match(prompt, /不能.*标题.*猜测.*外形/);
});

test("group member aliases are connected but pending members keep whole-group references pending", () => {
    const context = readCanvasContext({
        title: "角色",
        selectedNodeIds: [],
        nodes: [
            { id: "cast", type: "group", title: "角色", position: { x: 0, y: 0 } },
            { id: "profile", type: "text", title: "资料", position: { x: 0, y: 0 }, metadata: { groupId: "cast", content: "已完成设定" } },
            { id: "hero", type: "image", title: "待完成主视觉", position: { x: 0, y: 0 }, metadata: { groupId: "cast", role: "result-slot", slotState: "generating", content: "old-image" } },
            { id: "shot", type: "config", title: "分镜", position: { x: 0, y: 0 }, metadata: { prompt: "@[node:cast] @[node:profile]" } },
        ],
        connections: [{ fromNodeId: "cast", toNodeId: "shot" }],
    });
    const shot = context.nodes.find((node: { id: string }) => node.id === "shot");
    assert.deepEqual(shot.promptReferences, [
        { nodeId: "cast", state: "pending" },
        { nodeId: "profile", state: "ready" },
    ]);
});

test("group reference instructions expose effective members without pretending all images were read", () => {
    const context = readCanvasContext({
        title: "角色组",
        selectedNodeIds: ["cast"],
        visualContext: { attachedNodeIds: ["hero"], omittedImages: 1 },
        nodes: [
            { id: "cast", type: "group", title: "角色", position: { x: 0, y: 0 }, metadata: { groupPrompt: "保持等高 @[node:hero]" } },
            { id: "hero", type: "image", title: "主视觉", position: { x: 0, y: 0 }, metadata: { groupId: "cast", content: "hero" } },
            { id: "side", type: "image", title: "侧面", position: { x: 0, y: 0 }, metadata: { groupId: "cast", content: "side" } },
        ],
        connections: [],
    });
    assert.equal(context.groups[0].groupPrompt, "保持等高 @[node:hero]");
    assert.deepEqual(context.groups[0].effectiveInputNodeIds, ["cast", "hero"]);
    assert.deepEqual(context.visualContext.attachedNodeIds, ["hero"]);
    assert.ok(Array.isArray(context.canvasIndex));
    assert.ok(context.canvasIndex.some((node: { id: string }) => node.id === "hero"));
});

test("the pi prompt text keeps the default role, the canvas context and the conversation", () => {
    const text = formatZodiacPromptText(
        [
            { role: "system", content: "# 当前画布快照\n\n{}" },
            { role: "user", content: "先搭一个分镜" },
            { role: "assistant", content: "好的" },
            { role: "user", content: [{ type: "text", text: "继续" }] },
        ],
        "回答简洁",
    );
    assert.match(text, /^回答简洁/);
    assert.match(text, /# 当前画布快照/);
    assert.match(text, /用户：\n先搭一个分镜/);
    assert.match(text, /Zodiac：\n好的/);
    assert.match(text, /用户：\n继续/);
});

test("images never travel as pixels through the text-only pi prompt", () => {
    const text = formatZodiacPromptText([
        {
            role: "user",
            content: [
                { type: "text", text: "看这张图" },
                { type: "image_url", image_url: { url: "data:image/png;base64,aW1hZ2U=" } },
            ],
        },
    ]);
    assert.match(text, /看这张图/);
    assert.doesNotMatch(text, /base64/);
    assert.equal(formatZodiacPromptText([{ role: "assistant", content: "   " }]), "");
});
