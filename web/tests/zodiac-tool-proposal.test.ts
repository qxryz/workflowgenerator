import assert from "node:assert/strict";
import test from "node:test";

import {
    extractZodiacToolPayload,
    hasZodiacToolPayloadProtocol,
    normalizeZodiacCanvasOps,
    prepareZodiacExecutableToolProposal,
    prepareZodiacToolProposal,
    stripZodiacToolPayload,
} from "../src/lib/agent/zodiac-tool-proposal.ts";
import { resolveCanvasInputBindings } from "../src/lib/canvas/canvas-input-bindings.ts";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";

test("legacy provider operation aliases normalize to the current canvas contract", () => {
    const ops = normalizeZodiacCanvasOps([
        { op: "add_node", id: "prompt", nodeType: "config", title: "生成图片" },
        { op: "connect_nodes", source: "prompt", target: "result" },
        { action: "delete_node", id: "ignored" },
        { op: "run_generation", id: "prompt", mode: "image" },
    ]);

    assert.deepEqual(ops, [
        { type: "add_node", id: "prompt", nodeType: "config", title: "生成图片" },
        { type: "connect_nodes", fromNodeId: "prompt", toNodeId: "result" },
        { type: "run_generation", nodeId: "prompt", mode: "image" },
    ]);
});

test("provider-flattened prompts and parameters are assembled into node metadata", () => {
    const ops = normalizeZodiacCanvasOps([
        {
            type: "add_node",
            id: "first-frame",
            nodeType: "config",
            title: "生成首帧",
            generationMode: "image",
            script: "黄昏金色时刻，蜘蛛侠第一视角飞过香港高楼",
            parameters: { model: "seedream-4.5", size: "9:16" },
        },
    ]);
    const node = ops[0];
    assert.equal(node?.type, "add_node");
    if (node?.type !== "add_node") return;
    assert.equal(node.metadata?.generationMode, "image");
    assert.equal(node.metadata?.prompt, "黄昏金色时刻，蜘蛛侠第一视角飞过香港高楼");
    assert.equal(node.metadata?.composerContent, node.metadata?.prompt);
    assert.equal(node.metadata?.model, "seedream-4.5");
    assert.equal(node.metadata?.size, "9:16");
});

test("provider operations fail closed on unknown node types instead of downgrading them to text", () => {
    const ops = normalizeZodiacCanvasOps([
        {
            type: "add_node",
            id: "unsafe",
            nodeType: "hallucinated-widget",
            title: 42,
            metadata: {
                prompt: "保留这个创作意图",
                terminalCommand: "rm -rf something",
                terminalDirectory: "/tmp/hidden",
                terminalConfigured: true,
                storageKey: "forged-owner",
                isBatchRoot: true,
                batchChildIds: ["other-node"],
                terminalImportedArtifactPaths: ["secret.mov"],
                interactive: true,
            },
        },
        { type: "update_node", id: "existing", patch: { type: "unknown-node", title: "保留标题" }, metadata: { terminalConfigured: true } },
        { type: "add_node", id: "valid-looking-sibling", nodeType: "text" },
    ]);

    assert.deepEqual(ops, []);
});

test("active create-menu plugin types may use safe structural operations and metadata", () => {
    const pluginId = "zodiac-director-proposal-test";
    try {
        registerNodeDefinitions(
            [
                {
                    type: "director-desk:project",
                    title: "导演台",
                    description: "交互式分镜规划项目",
                    icon: "🎬",
                    defaultSize: { width: 480, height: 320 },
                    Content: () => null,
                },
                {
                    type: "director-desk:hidden",
                    title: "隐藏节点",
                    icon: "🔒",
                    defaultSize: { width: 240, height: 160 },
                    showInCreateMenu: false,
                    Content: () => null,
                },
            ],
            pluginId,
        );

        const ops = normalizeZodiacCanvasOps([
            {
                type: "add_node",
                id: "director",
                nodeType: "director-desk:project",
                title: "第一幕",
                metadata: {
                    content: "三镜头分镜",
                    terminalCommand: "do-not-run",
                    storageKey: "private-owner",
                    interactive: true,
                },
            },
            { type: "update_node", id: "director", patch: { type: "director-desk:project", title: "第二幕" } },
            { type: "connect_nodes", fromNodeId: "director", toNodeId: "notes" },
            { type: "select_nodes", ids: ["director"] },
            { type: "delete_node", id: "director", nodeType: "director-desk:project" },
        ]);

        assert.deepEqual(ops, [
            {
                type: "add_node",
                id: "director",
                nodeType: "director-desk:project",
                title: "第一幕",
                metadata: { content: "三镜头分镜" },
            },
            { type: "update_node", id: "director", patch: { type: "director-desk:project", title: "第二幕" } },
            { type: "connect_nodes", fromNodeId: "director", toNodeId: "notes" },
            { type: "select_nodes", ids: ["director"] },
            { type: "delete_node", id: "director", nodeType: "director-desk:project" },
        ]);
        assert.deepEqual(
            normalizeZodiacCanvasOps([
                { type: "add_node", id: "hidden", nodeType: "director-desk:hidden" },
                { type: "add_node", id: "valid-looking-sibling", nodeType: "text" },
            ]),
            [],
        );

        const prepared = prepareZodiacToolProposal(
            [
                { type: "add_node", id: "director", nodeType: "director-desk:project", title: "导演台" },
                { type: "update_node", id: "director", metadata: { content: "三镜头分镜" } },
                { type: "connect_nodes", fromNodeId: "notes", toNodeId: "director" },
                { type: "select_nodes", ids: ["director"] },
            ],
            [{ id: "notes", type: "text", title: "创意简报" }],
        );
        assert.equal(prepared.bindings.length, 0);
        assert.ok(prepared.ops.some((op) => op.type === "add_node" && op.nodeType === "director-desk:project"));
        assert.ok(prepared.ops.some((op) => op.type === "update_node" && op.id === "director"));
        assert.ok(prepared.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "notes" && op.toNodeId === "director"));
        assert.ok(prepared.ops.some((op) => op.type === "select_nodes" && op.ids.includes("director")));
        assert.ok(prepareZodiacToolProposal([{ type: "delete_node", id: "director" }], [{ id: "director", type: "director-desk:project", title: "导演台" }]).ops.some((op) => op.type === "delete_node" && op.id === "director"));
    } finally {
        unregisterPluginNodes(pluginId);
    }

    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "add_node", id: "disabled", nodeType: "director-desk:project" }]), []);
});

test("plugin nodes can never become run_generation targets, including existing nodes and type-change attempts", () => {
    const pluginId = "zodiac-director-generation-test";
    try {
        registerNodeDefinitions(
            [
                {
                    type: "director-desk:project",
                    title: "导演台",
                    icon: "🎬",
                    defaultSize: { width: 480, height: 320 },
                    Content: () => null,
                },
            ],
            pluginId,
        );

        assert.deepEqual(
            normalizeZodiacCanvasOps([
                { type: "add_node", id: "director", nodeType: "director-desk:project" },
                { type: "update_node", id: "director", patch: { type: "config" } },
                { type: "run_generation", nodeId: "director", mode: "text" },
            ]),
            [],
        );
        assert.deepEqual(prepareZodiacToolProposal([{ type: "run_generation", nodeId: "director", mode: "text" }], [{ id: "director", type: "director-desk:project", title: "导演台" }]), { ops: [], bindings: [] });
        assert.deepEqual(
            prepareZodiacToolProposal(
                [
                    { type: "update_node", id: "director", patch: { type: "config" } },
                    { type: "run_generation", nodeId: "director", mode: "text" },
                ],
                [{ id: "director", type: "director-desk:project", title: "导演台" }],
            ),
            { ops: [], bindings: [] },
        );
        [
            {
                alias: "desk-new",
                knownNodes: [{ id: "desk", type: "text" as const, title: "已有文本" }],
            },
            {
                alias: "desk-new-2",
                knownNodes: [
                    { id: "desk", type: "text" as const, title: "已有文本" },
                    { id: "desk-new", type: "text" as const, title: "占用别名" },
                ],
            },
        ].forEach(({ alias, knownNodes }) => {
            assert.deepEqual(
                prepareZodiacToolProposal(
                    [
                        { type: "add_node", id: "desk", nodeType: "director-desk:project" },
                        { type: "update_node", id: alias, patch: { type: "config" } },
                        { type: "run_generation", nodeId: alias, mode: "text" },
                    ],
                    knownNodes,
                ),
                { ops: [], bindings: [] },
            );
        });
    } finally {
        unregisterPluginNodes(pluginId);
    }
});

test("connection deletion fails closed when a disabled plugin is one of the live endpoints", () => {
    const knownNodes = [
        { id: "director", type: "director-desk:project", title: "导演台" },
        { id: "notes", type: "text", title: "创意简报" },
    ];
    const knownConnections = [{ id: "notes-to-director", fromNodeId: "notes", toNodeId: "director" }];

    assert.deepEqual(prepareZodiacToolProposal([{ type: "delete_connections", id: "notes-to-director" }], knownNodes, knownConnections), { ops: [], bindings: [] });
    assert.deepEqual(prepareZodiacToolProposal([{ type: "delete_connections", all: true }], knownNodes, knownConnections), { ops: [], bindings: [] });
});

test("node deletion cannot indirectly remove a connection owned by a disabled plugin endpoint", () => {
    const knownNodes = [
        { id: "director", type: "director-desk:project", title: "导演台" },
        { id: "notes", type: "text", title: "创意简报" },
    ];
    const knownConnections = [{ id: "notes-to-director", fromNodeId: "notes", toNodeId: "director" }];

    assert.deepEqual(prepareZodiacToolProposal([{ type: "delete_node", id: "notes" }], knownNodes, knownConnections), { ops: [], bindings: [] });
    assert.deepEqual(prepareZodiacToolProposal([{ type: "delete_node", nodeType: "text" }], knownNodes, knownConnections), { ops: [], bindings: [] });
});

test("a disabled plugin invalidates old receipt operations before canvas apply can downgrade their type", () => {
    const pluginId = "zodiac-director-receipt-test";
    const receiptOps = [
        {
            type: "add_node" as const,
            id: "director",
            nodeType: "director-desk:project",
            title: "导演台",
            metadata: { content: "三镜头分镜" },
        },
    ];

    try {
        registerNodeDefinitions(
            [
                {
                    type: "director-desk:project",
                    title: "导演台",
                    icon: "🎬",
                    defaultSize: { width: 480, height: 320 },
                    Content: () => null,
                },
            ],
            pluginId,
        );
        assert.deepEqual(prepareZodiacToolProposal(receiptOps).ops, receiptOps);
    } finally {
        unregisterPluginNodes(pluginId);
    }
    assert.deepEqual(prepareZodiacToolProposal(receiptOps), { ops: [], bindings: [] });
});

test("legacy add_node may use type as its node kind while viewport stays inside canvas limits", () => {
    assert.deepEqual(normalizeZodiacCanvasOps([{ op: "add_node", id: "legacy-config", type: "config" }]), [
        { type: "add_node", id: "legacy-config", nodeType: "config" },
    ]);
    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "set_viewport", viewport: { x: 0, y: 0, k: 0.05 } }]), [
        { type: "set_viewport", viewport: { x: 0, y: 0, k: 0.05 } },
    ]);
    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "set_viewport", viewport: { x: 0, y: 0, k: 1e-300 } }]), []);
    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "set_viewport", viewport: { x: 2_000_000, y: 0, k: 1 } }]), []);
    assert.deepEqual(normalizeZodiacCanvasOps([{
        type: "add_node",
        id: "bounded",
        nodeType: "config",
        position: { x: 1e308, y: 1e308 },
        x: -1e308,
        y: 1e308,
        width: 1e308,
        height: 1e308,
        metadata: { count: 1e308, fontSize: 1e308 },
    }]), [{ type: "add_node", id: "bounded", nodeType: "config" }]);
});

test("a valid proposal block is parsed but never exposed in assistant copy", () => {
    const reply = [
        "我把图片生成和结果查看分成两层。",
        "```zodic-ops",
        JSON.stringify({ summary: "创建图片流程", executionMode: "guided", ops: [{ op: "add_node", id: "image", nodeType: "config" }] }),
        "```",
    ].join("\n");

    const parsed = extractZodiacToolPayload(reply);
    assert.equal(parsed?.summary, "创建图片流程");
    assert.equal(parsed?.executionMode, "guided");
    assert.deepEqual(parsed?.ops, [{ type: "add_node", id: "image", nodeType: "config" }]);
    assert.equal(parsed?.text, "我把图片生成和结果查看分成两层。");
    assert.equal(stripZodiacToolPayload(reply), "我把图片生成和结果查看分成两层。");
});

test("legacy json without executionMode is accepted only when its legacy op marker is present", () => {
    const legacy = `说明\n\`\`\`json\n${JSON.stringify({ summary: "旧提案", ops: [{ op: "add_node", id: "legacy", nodeType: "text" }] })}\n\`\`\``;
    const ordinary = `接口示例\n\`\`\`json\n${JSON.stringify({ ops: [{ type: "add_node", id: "example", nodeType: "text" }] })}\n\`\`\``;

    assert.deepEqual(extractZodiacToolPayload(legacy)?.ops, [{ type: "add_node", id: "legacy", nodeType: "text" }]);
    assert.equal(stripZodiacToolPayload(legacy), "说明");
    assert.equal(extractZodiacToolPayload(ordinary), undefined);
    assert.equal(stripZodiacToolPayload(ordinary), ordinary);
});

test("provider proposals in unlabeled fences or bare JSON still enter the canvas protocol", () => {
    const payload = {
        summary: "创建首帧与视频流程",
        executionMode: "guided",
        ops: [
            { type: "add_node", id: "first-frame", nodeType: "config", metadata: { generationMode: "image", prompt: "生成香港楼宇间飞行的电影感首帧" } },
            { type: "add_node", id: "first-frame-result", nodeType: "image", title: "首帧" },
            { type: "connect_nodes", fromNodeId: "first-frame", toNodeId: "first-frame-result" },
        ],
    };
    const unlabeled = `方案已经整理。\n\`\`\`\n${JSON.stringify(payload)}\n\`\`\``;
    const bare = `方案已经整理。\n${JSON.stringify(payload, null, 2)}`;

    assert.deepEqual(extractZodiacToolPayload(unlabeled)?.ops, payload.ops);
    assert.equal(extractZodiacToolPayload(unlabeled)?.text, "方案已经整理。");
    assert.deepEqual(extractZodiacToolPayload(bare)?.ops, payload.ops);
    assert.equal(extractZodiacToolPayload(bare)?.text, "方案已经整理。");
    assert.equal(hasZodiacToolPayloadProtocol(unlabeled), true);
    assert.equal(hasZodiacToolPayloadProtocol(bare), true);

    const parsed = extractZodiacToolPayload(bare)!;
    const executable = prepareZodiacExecutableToolProposal(parsed.ops, "生成蜘蛛侠飞行视频", parsed.executionMode);
    const action = executable.ops.find((op) => op.type === "add_node" && op.id === "first-frame");
    const result = executable.ops.find((op) => op.type === "add_node" && op.id === "first-frame-result");
    assert.equal(action?.type === "add_node" ? action.metadata?.prompt : undefined, "生成香港楼宇间飞行的电影感首帧");
    assert.equal(result?.type === "add_node" ? result.metadata?.role : undefined, "result-slot");
    assert.equal(result?.type === "add_node" ? result.metadata?.resultSlotSourceNodeId : undefined, "first-frame");
    assert.ok(executable.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "first-frame" && op.toNodeId === "first-frame-result"));
});

test("a common trailing comma does not turn a canvas proposal into chat copy", () => {
    const reply = [
        "准备装配。",
        "```json",
        '{"summary":"生成视频","executionMode":"guided","ops":[{"type":"add_node","id":"video","nodeType":"config","metadata":{"generationMode":"video","prompt":"生成一段视频",},},],}',
        "```",
    ].join("\n");

    assert.equal(extractZodiacToolPayload(reply)?.ops[0]?.type, "add_node");
    assert.equal(stripZodiacToolPayload(reply), "准备装配。");
});

test("recognizable but malformed canvas JSON is hidden and reported as protocol", () => {
    const malformed = '说明\n```json\n{"summary":"流程","executionMode":"guided","ops":[{"type":"add_node",BROKEN}]}\n```';
    const ordinary = '接口示例\n```\n{"summary":"示例","ops":[]}\n```';

    assert.equal(extractZodiacToolPayload(malformed), undefined);
    assert.equal(stripZodiacToolPayload(malformed), "说明");
    assert.equal(hasZodiacToolPayloadProtocol(malformed), true);
    assert.equal(stripZodiacToolPayload(ordinary), ordinary);
    assert.equal(hasZodiacToolPayloadProtocol(ordinary), false);
});

test("every explicit or unfinished protocol block stays out of user-visible copy", () => {
    const reply = [
        "可见说明",
        "```zodic-ops",
        "{broken",
        "```",
        "```zodic-ops",
        JSON.stringify({ summary: "第二段", executionMode: "guided", ops: [{ type: "add_node", id: "valid", nodeType: "text" }] }),
        "```",
        "```zodic-ops",
        "still streaming",
    ].join("\n");

    assert.equal(stripZodiacToolPayload(reply), "可见说明");
    assert.equal(
        stripZodiacToolPayload("可见说明\n```json\n{\"summary\":\"旧提案\",\"executionMode\":\"guided\",\"ops\":["),
        "可见说明",
    );
    assert.equal(
        stripZodiacToolPayload("可见说明\n```json\n{\"summary\":\"旧提案\",\"ops\":[{\"op\":\"add_node\""),
        "可见说明",
    );
});

test("unfinished ordinary JSON stays visible without a reliable legacy protocol marker", () => {
    const ordinary = "说明\n```json\n{\"example\":";
    const ambiguous = "说明\n```json\n{\"summary\":\"示例\",\"ops\":[";

    assert.equal(stripZodiacToolPayload(ordinary), ordinary);
    assert.equal(stripZodiacToolPayload(ambiguous), ambiguous);
});

test("protocol fences survive backticks and Unicode line separators inside JSON prompt strings", () => {
    const prompt = "先输出 ```json，再写前\u2028```\u2029后";
    const body = JSON.stringify({ summary: "含代码围栏", executionMode: "guided", ops: [{ type: "add_node", id: "writer", nodeType: "config", metadata: { prompt } }] });
    const reply = `可见说明\n\`\`\`\`zodic-ops\n${body}\n\`\`\`\``;

    assert.equal(extractZodiacToolPayload(reply)?.ops[0]?.type, "add_node");
    assert.equal((extractZodiacToolPayload(reply)?.ops[0] as { metadata?: { prompt?: string } })?.metadata?.prompt, prompt);
    assert.equal(stripZodiacToolPayload(reply), "可见说明");
});

test("provider-distorted raw tool payloads are parsed and never shown", () => {
    const payload = {
        summary: "创建图片流程",
        executionMode: "guided",
        ops: [{ type: "add_node", id: "image-maker", nodeType: "config", metadata: { generationMode: "image", prompt: "主体包含 {光影} 和 \\\"反射\\\"" } }],
    };
    const reply = `准备加入画布。\n<|minimax|> zodic-ops ${JSON.stringify(payload)} [blocked]`;
    assert.deepEqual(extractZodiacToolPayload(reply)?.ops, payload.ops);
    assert.equal(stripZodiacToolPayload(reply), "准备加入画布。");
});

test("unfinished raw tool payloads are hidden while ordinary mentions remain", () => {
    const unfinished = "可见说明\nzodic-ops {\"summary\":\"流程\",\"ops\":[";
    const ordinary = "zodic-ops 是内部动作名称，不是这里的示例。";
    assert.equal(extractZodiacToolPayload(unfinished), undefined);
    assert.equal(stripZodiacToolPayload(unfinished), "可见说明");
    assert.equal(stripZodiacToolPayload(ordinary), ordinary);
});

test("Minimax tool-call wrappers recover one executable proposal and hide duplicates", () => {
    const payload = {
        summary: "创建视频流程",
        executionMode: "guided",
        ops: [{ type: "add_node", id: "video-maker", nodeType: "config", metadata: { generationMode: "video" } }],
    };
    const reply = `<|minimax|><|tool_call|>${JSON.stringify(payload)}<|minimax|><|tool_call|>${JSON.stringify(payload)}<|minimax|><|/tool_call|> [blocked]`;
    assert.deepEqual(extractZodiacToolPayload(reply)?.ops, payload.ops);
    assert.equal(stripZodiacToolPayload(reply), "");
});

test("an explicit action edge becomes config -> text slot -> config -> video slot", () => {
    const input = [
        { type: "add_node", id: "write-copy", nodeType: "config", title: "生成分镜文案", position: { x: 100, y: 120 }, metadata: { generationMode: "text", prompt: "写一版分镜" } },
        { type: "add_node", id: "make-video", nodeType: "config", title: "生成视频", position: { x: 500, y: 120 }, metadata: { generationMode: "video", prompt: "生成成片" } },
        { type: "connect_nodes", fromNodeId: "write-copy", toNodeId: "make-video" },
    ] as const;

    const proposal = prepareZodiacToolProposal([...input]);
    const nodeTypes = new Map(
        proposal.ops
            .filter((op) => op.type === "add_node")
            .map((op) => [op.id, op.nodeType]),
    );
    const edges = proposal.ops
        .filter((op) => op.type === "connect_nodes")
        .map((op) => `${op.fromNodeId}->${op.toNodeId}`);

    assert.deepEqual(proposal.bindings, [
        { actionId: "write-copy", mode: "text", outputNodeId: "write-copy--text-result", nextActionIds: ["make-video"] },
        { actionId: "make-video", mode: "video", outputNodeId: "make-video--video-result", nextActionIds: [] },
    ]);
    assert.deepEqual(nodeTypes, new Map([
        ["write-copy", "config"],
        ["write-copy--text-result", "text"],
        ["make-video", "config"],
        ["make-video--video-result", "video"],
    ]));
    const resultSlots = proposal.ops.filter((op) => op.type === "add_node" && op.metadata?.role === "result-slot");
    assert.deepEqual(
        resultSlots.map((op) => [op.id, op.metadata?.resultSlotMode, op.metadata?.resultSlotSourceNodeId, op.metadata?.advanceMode]),
        [
            ["write-copy--text-result", "text", "write-copy", "review"],
            ["make-video--video-result", "video", "make-video", "review"],
        ],
    );
    assert.deepEqual(edges, [
        "write-copy->write-copy--text-result",
        "write-copy--text-result->make-video",
        "make-video->make-video--video-result",
    ]);
    assert.ok(!edges.includes("write-copy->make-video"));
});

test("independent actions stay independent instead of being serialized by array order", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "image-a", nodeType: "config", title: "生成主视觉", metadata: { generationMode: "image" } },
        { type: "add_node", id: "image-b", nodeType: "config", title: "生成封面", metadata: { generationMode: "image" } },
    ]);

    const edges = proposal.ops
        .filter((op) => op.type === "connect_nodes")
        .map((op) => `${op.fromNodeId}->${op.toNodeId}`);
    assert.deepEqual(edges, ["image-a->image-a--image-result", "image-b->image-b--image-result"]);
    assert.deepEqual(proposal.bindings.map((binding) => binding.nextActionIds), [[], []]);
});

test("an adjacent ordinary asset is never guessed to be an action result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "reference", nodeType: "image", title: "参考图", metadata: { content: "reference-content" } },
    ]);
    const reference = proposal.ops.find((op) => op.type === "add_node" && op.id === "reference");

    assert.equal(proposal.bindings[0]?.outputNodeId, "render--image-result");
    assert.equal(reference?.metadata?.content, "reference-content");
    assert.equal(reference?.metadata?.role, undefined);
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "render--image-result"));
});

test("an incompatible explicit id collision is renamed and every node reference follows it", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "result", nodeType: "image", title: "图片结果槽" },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "result" },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        { id: "render", type: "text", title: "已有文本" },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "render-new" && op.nodeType === "config"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render-new" && op.toNodeId === "result"));
    assert.ok(proposal.ops.some((op) => op.type === "run_generation" && op.nodeId === "render-new"));
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render"), false);
});

test("a same-shaped id collision with different prompt is renamed instead of running stale content", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { prompt: "新提示词", generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { prompt: "旧提示词", generationMode: "image" } },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "render-new"));
    assert.ok(proposal.ops.some((op) => op.type === "run_generation" && op.nodeId === "render-new"));
});

test("restore-time id reuse requires an explicit matching action mode", () => {
    const ambiguous = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config" },
        { type: "run_generation", nodeId: "render" },
    ], [
        { id: "render", type: "config", title: "已有视频", metadata: { generationMode: "video" } },
    ], [], true);
    const exact = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "已有视频", metadata: { generationMode: "video", prompt: "同一提示词" } },
    ], [
        { id: "render", type: "config", title: "已有视频", metadata: { generationMode: "video", prompt: "同一提示词" } },
    ], [], true);

    assert.ok(ambiguous.ops.some((op) => op.type === "add_node" && op.id === "render-new"));
    assert.ok(ambiguous.ops.some((op) => op.type === "run_generation" && op.nodeId === "render-new"));
    assert.ok(exact.ops.some((op) => op.type === "add_node" && op.id === "render"));
    assert.equal(exact.ops.some((op) => op.type === "add_node" && op.id === "render-new"), false);
});

test("restore-time reuse compares the complete action meaning instead of keeping stale prompt state", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        {
            id: "render",
            type: "config",
            title: "生成图片",
            metadata: { generationMode: "image", prompt: "旧提示词", composerContent: "旧任务内容", model: "old-model" },
        },
    ], [], true);

    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "render-new"));
    assert.ok(proposal.ops.some((op) => op.type === "run_generation" && op.nodeId === "render-new"));
});

test("restore-time reuse preserves a ready result slot and its version ledger", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "同一任务" } },
        {
            type: "add_node",
            id: "render-result",
            nodeType: "image",
            title: "图片结果槽",
            metadata: {
                role: "result-slot",
                advanceMode: "review",
                slotState: "empty",
                resultSlotMode: "image",
                resultSlotSourceNodeId: "render",
                resultVersions: [],
                status: "idle",
            },
        },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "render-result" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "同一任务" } },
        {
            id: "render-result",
            type: "image",
            title: "图片结果槽",
            metadata: {
                role: "result-slot",
                resultSlotMode: "image",
                resultSlotSourceNodeId: "render",
                status: "success",
                slotState: "ready",
                content: "asset://ready",
                currentResultVersionId: "v1",
                resultVersions: [{
                    id: "v1",
                    status: "success",
                    createdAt: "2026-08-02T10:00:00.000Z",
                    artifacts: [{ id: "asset-1", kind: "image", content: "asset://ready" }],
                    primaryArtifactId: "asset-1",
                }],
            },
        },
    ], [{ id: "ready-edge", fromNodeId: "render", toNodeId: "render-result" }], true);
    const slotUpdate = proposal.ops.find((op) => op.type === "update_node" && op.id === "render-result");

    assert.equal(slotUpdate?.metadata?.status, "success");
    assert.equal(slotUpdate?.metadata?.slotState, "ready");
    assert.equal(slotUpdate?.metadata?.content, "asset://ready");
    assert.equal(slotUpdate?.metadata?.currentResultVersionId, "v1");
    assert.equal(slotUpdate?.metadata?.resultVersions?.length, 1);
});

test("restore-time result-slot reuse never claims a same-titled ordinary user asset", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "同一任务" } },
        {
            type: "add_node",
            id: "render-result",
            nodeType: "image",
            title: "图片结果槽",
            metadata: {
                role: "result-slot",
                advanceMode: "review",
                slotState: "empty",
                resultSlotMode: "image",
                resultSlotSourceNodeId: "render",
                resultVersions: [],
            },
        },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "render-result" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "同一任务" } },
        { id: "render-result", type: "image", title: "图片结果槽", metadata: { content: "asset://user-image", status: "success" } },
    ], [], true);

    assert.equal(proposal.bindings[0]?.outputNodeId, "render-result-new");
    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "render-result-new" && op.metadata?.role === "result-slot"));
    assert.equal(proposal.ops.some((op) => op.type === "update_node" && op.id === "render-result" && op.metadata?.role === "result-slot"), false);
});

test("restore-time reuse treats an omitted title as the node type's real default title", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "untitled", nodeType: "config", metadata: { generationMode: "image", prompt: "同一任务" } },
        { type: "run_generation", nodeId: "untitled", mode: "image" },
    ], [
        { id: "untitled", type: "config", title: "生成配置", metadata: { generationMode: "image", prompt: "同一任务" } },
    ], [], true);

    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "untitled-new"), false);
    assert.ok(proposal.bindings.some((binding) => binding.actionId === "untitled"));
});

test("stable node tokens follow an id remap without rewriting unrelated text", () => {
    const proposal = prepareZodiacToolProposal([
        {
            type: "add_node",
            id: "render",
            nodeType: "config",
            title: "生成图片",
            metadata: { generationMode: "image", prompt: "使用 @[node:render]，保留 render 普通文字", composerContent: "来自 @[node:render]" },
        },
        { type: "run_generation", nodeId: "render", mode: "image", prompt: "继续 @[node:render]" },
    ], [{ id: "render", type: "text", title: "已有文本" }]);
    const addition = proposal.ops.find((op) => op.type === "add_node" && op.id === "render-new");
    const run = proposal.ops.find((op) => op.type === "run_generation");

    assert.equal(addition?.metadata?.prompt, "使用 @[node:render-new]，保留 render 普通文字");
    assert.equal(addition?.metadata?.composerContent, "来自 @[node:render-new]");
    assert.equal(run?.prompt, "继续 @[node:render-new]");
});

test("forward node references follow a later declaration that collides with live canvas", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "writer", nodeType: "config", title: "写说明", metadata: { generationMode: "text", prompt: "分析 @[node:asset]", composerContent: "读取 @[node:asset]" } },
        { type: "connect_nodes", fromNodeId: "asset", toNodeId: "writer" },
        { type: "add_node", id: "asset", nodeType: "image", title: "新素材" },
    ], [{ id: "asset", type: "text", title: "已有同名节点" }]);
    const writer = proposal.ops.find((op) => op.type === "add_node" && op.id === "writer");

    assert.equal(writer?.metadata?.prompt, "分析 @[node:asset-new]");
    assert.equal(writer?.metadata?.composerContent, "读取 @[node:asset-new]");
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "asset-new" && op.toNodeId === "writer"));
});

test("generated result-slot aliases keep downstream stable references on the actual slot id", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "使用 @[node:story--text-result]" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "render" },
    ], [{ id: "story--text-result", type: "text", title: "已有普通文本" }]);
    const render = proposal.ops.find((op) => op.type === "add_node" && op.id === "render");

    assert.equal(proposal.bindings.find((binding) => binding.actionId === "story")?.outputNodeId, "story--text-result-2");
    assert.equal(render?.metadata?.prompt, "使用 @[node:story--text-result-2]");
});

test("result-slot aliases also follow an action id remap", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "使用 @[node:story--text-result]" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "render" },
    ], [{ id: "story", type: "text", title: "已有同名文本" }]);
    const render = proposal.ops.find((op) => op.type === "add_node" && op.id === "render");

    assert.equal(proposal.bindings.find((binding) => binding.actionId === "story-new")?.outputNodeId, "story-new--text-result");
    assert.equal(render?.metadata?.prompt, "使用 @[node:story-new--text-result]");
});

test("live revalidation remaps a prepared result slot owner without creating a second output", () => {
    const prepared = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
    ]);
    const live = prepareZodiacToolProposal(prepared.ops, [
        { id: "render", type: "text", title: "确认期间出现的节点" },
    ]);
    const resultSlots = live.ops.filter((op) => op.type === "add_node" && op.metadata?.role === "result-slot");

    assert.deepEqual(live.bindings, [{ actionId: "render-new", mode: "image", outputNodeId: "render--image-result", nextActionIds: [] }]);
    assert.equal(resultSlots.length, 1);
    assert.equal(resultSlots[0]?.metadata?.resultSlotSourceNodeId, "render-new");
    assert.ok(live.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render-new" && op.toNodeId === "render--image-result"));
    assert.equal(live.ops.some((op) => op.type === "add_node" && op.id === "render-new--image-result"), false);
});

test("delete then add with the same id deletes the old node and remaps only the replacement", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "delete_node", id: "render" },
        { type: "add_node", id: "render", nodeType: "config", title: "新图片任务", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [{ id: "render", type: "text", title: "旧节点" }]);

    assert.ok(proposal.ops.some((op) => op.type === "delete_node" && op.id === "render"));
    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "render-new"));
    assert.ok(proposal.ops.some((op) => op.type === "run_generation" && op.nodeId === "render-new"));
    assert.equal(proposal.ops.some((op) => op.type === "delete_node" && op.id === "render-new"), false);
});

test("an action deleted later in the proposal never leaves an orphan result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "temporary", nodeType: "config", title: "临时图片", metadata: { generationMode: "image" } },
        { type: "delete_node", id: "temporary" },
    ]);

    assert.deepEqual(proposal.bindings, []);
    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "temporary--image-result"), false);
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "temporary"), false);
});

test("duplicate action declarations are rejected instead of creating ambiguous generations", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "draft", nodeType: "config", title: "旧图片", metadata: { generationMode: "image" } },
        { type: "delete_node", id: "draft" },
        { type: "add_node", id: "draft", nodeType: "config", title: "新视频", metadata: { generationMode: "video" } },
    ]);

    assert.deepEqual(proposal, { ops: [], bindings: [] });
});

test("delete_node by type removes newly-added actions from derived topology", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "temporary", nodeType: "config", title: "临时图片", metadata: { generationMode: "image" } },
        { type: "delete_node", nodeType: "config" },
    ]);

    assert.deepEqual(proposal.bindings, []);
    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id?.includes("result")), false);
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes"), false);
});

test("a connection deleted later in the proposal is not revived by topology normalization", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "note-a", nodeType: "text", title: "说明 A", metadata: { content: "A" } },
        { type: "add_node", id: "note-b", nodeType: "text", title: "说明 B", metadata: { content: "B" } },
        { type: "connect_nodes", id: "temporary-edge", fromNodeId: "note-a", toNodeId: "note-b" },
        { type: "delete_connections", all: true },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.ids?.includes("temporary-edge")));
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes"), false);
});

test("connection lifecycle follows updated node types when deleting by type", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "a", nodeType: "config", title: "临时动作", metadata: { generationMode: "text" } },
        { type: "add_node", id: "b", nodeType: "text", title: "文本 B" },
        { type: "connect_nodes", id: "keep", fromNodeId: "a", toNodeId: "b" },
        { type: "update_node", id: "a", patch: { type: "text" }, metadata: { content: "文本 A" } },
        { type: "delete_node", nodeType: "config" },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.id === "keep" && op.fromNodeId === "a" && op.toNodeId === "b"));
});

test("derived result slots are reconciled after user-authored type deletes", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "delete_node", nodeType: "image" },
    ]);
    const deleteIndex = proposal.ops.findIndex((op) => op.type === "delete_node" && Array.isArray(op.ids));
    const slotIndex = proposal.ops.findIndex((op) => op.type === "add_node" && op.id === "render--image-result");

    assert.ok(deleteIndex >= 0 && slotIndex > deleteIndex);
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "render--image-result"));
});

test("the final updated generation mode determines the output slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "update_node", id: "render", metadata: { generationMode: "video" } },
        { type: "run_generation", nodeId: "render", mode: "video" },
    ], [
        { id: "render", type: "config", title: "生成内容", metadata: { generationMode: "image" } },
    ]);

    assert.deepEqual(proposal.bindings, [{ actionId: "render", mode: "video", outputNodeId: "render--video-result", nextActionIds: [] }]);
});

test("an update that turns a known resource into an action receives a result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "update_node", id: "draft", patch: { type: "config", title: "生成视频" }, metadata: { generationMode: "video" } },
        { type: "run_generation", nodeId: "draft", mode: "video" },
    ], [
        { id: "draft", type: "text", title: "文案", metadata: { content: "旧文本" } },
    ]);

    assert.deepEqual(proposal.bindings, [{ actionId: "draft", mode: "video", outputNodeId: "draft--video-result", nextActionIds: [] }]);
});

test("updates and type deletes are materialized before deriving action topology", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "draft", nodeType: "config", title: "临时图片", metadata: { generationMode: "image" } },
        { type: "update_node", id: "draft", patch: { type: "text" }, metadata: { content: "普通文本" } },
        { type: "delete_node", nodeType: "text" },
    ]);

    assert.deepEqual(proposal.bindings, []);
    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id?.includes("result")), false);
});

test("run_generation mode is the final config mode used by both bridge and topology", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成内容", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "video" },
    ]);

    assert.deepEqual(proposal.bindings, [{ actionId: "render", mode: "video", outputNodeId: "render--video-result", nextActionIds: [] }]);
});

test("cyclic action proposals are rejected before any structure reaches the canvas", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "a", nodeType: "config", title: "A", metadata: { generationMode: "text" } },
        { type: "add_node", id: "b", nodeType: "config", title: "B", metadata: { generationMode: "text" } },
        { type: "connect_nodes", fromNodeId: "a", toNodeId: "b" },
        { type: "connect_nodes", fromNodeId: "b", toNodeId: "a" },
    ]);

    assert.deepEqual(proposal, { ops: [], bindings: [] });
});

test("a new action routes through its result slot before an existing downstream action", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "existing-video" },
    ], [
        { id: "existing-video", type: "config", title: "生成视频", metadata: { generationMode: "video" } },
    ]);
    const edges = proposal.ops.filter((op) => op.type === "connect_nodes").map((op) => `${op.fromNodeId}->${op.toNodeId}`);

    assert.deepEqual(proposal.bindings[0]?.nextActionIds, ["existing-video"]);
    assert.ok(edges.includes("story->story--text-result"));
    assert.ok(edges.includes("story--text-result->existing-video"));
    assert.equal(edges.includes("story->existing-video"), false);
});

test("an existing upstream action routes through a result slot before a new downstream action", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "new-video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "existing-story", toNodeId: "new-video" },
    ], [
        { id: "existing-story", type: "config", title: "生成分镜", position: { x: 700, y: 800 }, width: 520, height: 280, metadata: { generationMode: "text" } },
    ]);
    const edges = proposal.ops.filter((op) => op.type === "connect_nodes").map((op) => `${op.fromNodeId}->${op.toNodeId}`);
    const generatedResult = proposal.ops.find((op) => op.type === "add_node" && op.id === "existing-story--text-result");

    assert.deepEqual(generatedResult?.position, { x: 1316, y: 800 });
    assert.ok(edges.includes("existing-story->existing-story--text-result"));
    assert.ok(edges.includes("existing-story--text-result->new-video"));
    assert.equal(edges.includes("existing-story->new-video"), false);
});

test("an existing upstream action reuses its connected result slot before a new action", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "new-video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "existing-story", toNodeId: "new-video" },
    ], [
        { id: "existing-story", type: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { id: "existing-story-result", type: "text", title: "分镜结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "existing-story" } },
    ], [
        { fromNodeId: "existing-story", toNodeId: "existing-story-result" },
    ]);
    const edges = proposal.ops.filter((op) => op.type === "connect_nodes").map((op) => `${op.fromNodeId}->${op.toNodeId}`);

    assert.equal(proposal.bindings.find((binding) => binding.actionId === "existing-story")?.outputNodeId, "existing-story-result");
    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "existing-story--text-result"), false);
    assert.ok(edges.includes("existing-story-result->new-video"));
    assert.equal(edges.includes("existing-story->new-video"), false);
});

test("an existing downstream or directly-run action also receives its own result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "existing-video" },
        { type: "run_generation", nodeId: "existing-video", mode: "video" },
    ], [
        { id: "existing-video", type: "config", title: "现有视频任务", metadata: { generationMode: "video" } },
    ]);

    assert.ok(proposal.bindings.some((binding) => binding.actionId === "story" && binding.nextActionIds.includes("existing-video")));
    assert.ok(proposal.bindings.some((binding) => binding.actionId === "existing-video" && binding.outputNodeId === "existing-video--video-result"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "existing-video" && op.toNodeId === "existing-video--video-result"));
});

test("run_generation on one existing action repairs a missing result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "existing-image", mode: "image" },
    ], [
        { id: "existing-image", type: "config", title: "现有图片任务", metadata: { generationMode: "image" } },
    ]);

    assert.deepEqual(proposal.bindings, [{ actionId: "existing-image", mode: "image", outputNodeId: "existing-image--image-result", nextActionIds: [] }]);
    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "existing-image--image-result"));
});

test("running an upstream known action closes the reachable DAG with downstream result slots", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "a", mode: "text" },
    ], [
        { id: "a", type: "config", title: "A", metadata: { generationMode: "text" } },
        { id: "a-result", type: "text", title: "A 结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "a" } },
        { id: "b", type: "config", title: "B", metadata: { generationMode: "video" } },
    ], [
        { id: "a-output", fromNodeId: "a", toNodeId: "a-result" },
        { id: "a-to-b", fromNodeId: "a-result", toNodeId: "b" },
    ]);

    assert.ok(proposal.bindings.some((binding) => binding.actionId === "a" && binding.nextActionIds.includes("b")));
    assert.ok(proposal.bindings.some((binding) => binding.actionId === "b" && binding.outputNodeId === "b--video-result"));
    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "b--video-result"));
});

test("an owned result slot wins over an ordinary connected asset", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { id: "ordinary", type: "image", title: "普通素材", metadata: { content: "keep-me" } },
        { id: "owned", type: "image", title: "图片结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "render" } },
    ], [
        { id: "edge-ordinary", fromNodeId: "render", toNodeId: "ordinary" },
        { id: "edge-owned", fromNodeId: "render", toNodeId: "owned" },
    ]);

    assert.equal(proposal.bindings[0]?.outputNodeId, "owned");
    assert.equal(proposal.ops.some((op) => op.type === "update_node" && op.id === "ordinary"), false);
});

test("the best ready owned slot is kept and redundant slot edges are disconnected", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { id: "empty", type: "image", title: "空结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "render", slotState: "empty" } },
        { id: "ready", type: "image", title: "可用结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "render", slotState: "ready", currentResultVersionId: "v1" } },
    ], [
        { id: "edge-empty", fromNodeId: "render", toNodeId: "empty" },
        { id: "edge-ready", fromNodeId: "render", toNodeId: "ready" },
    ]);

    assert.equal(proposal.bindings[0]?.outputNodeId, "ready");
    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "edge-empty"));
    assert.equal(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "edge-ready"), false);
});

test("foreign result-slot edges are disconnected while preserving the foreign asset", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { id: "foreign", type: "image", title: "其他任务结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "other" } },
    ], [{ id: "foreign-edge", fromNodeId: "render", toNodeId: "foreign" }]);

    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "foreign-edge"));
    assert.equal(proposal.ops.some((op) => op.type === "delete_node" && (op.id === "foreign" || op.ids?.includes("foreign"))), false);
});

test("known direct action bypasses and cross-writers into owned slots are repaired", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "a", mode: "text" },
    ], [
        { id: "a", type: "config", title: "A", metadata: { generationMode: "text" } },
        { id: "a-result", type: "text", title: "A 结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "a" } },
        { id: "b", type: "config", title: "B", metadata: { generationMode: "video" } },
        { id: "other", type: "config", title: "Other", metadata: { generationMode: "text" } },
    ], [
        { id: "a-output", fromNodeId: "a", toNodeId: "a-result" },
        { id: "direct-bypass", fromNodeId: "a", toNodeId: "b" },
        { id: "cross-writer", fromNodeId: "other", toNodeId: "a-result" },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "direct-bypass"));
    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "cross-writer"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "a-result" && op.toNodeId === "b"));
});

test("live ready slots replace colliding planned empty slots without leaving an orphan", () => {
    const planned = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "render", mode: "image" },
    ], [{ id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } }]);
    const live = prepareZodiacToolProposal(planned.ops, [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { id: "render--image-result", type: "image", title: "图片结果槽", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "render", slotState: "ready", currentResultVersionId: "v1" } },
    ], [{ id: "live-edge", fromNodeId: "render", toNodeId: "render--image-result" }]);

    assert.equal(live.bindings[0]?.outputNodeId, "render--image-result");
    assert.equal(live.ops.some((op) => op.type === "add_node" && op.id === "render--image-result-new"), false);
});

test("generated connection ids never collide with unrelated live connection ids", () => {
    const occupiedId = "zodiac-link--render--render--image-result";
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
    ], [
        { id: "left", type: "text", title: "左" },
        { id: "right", type: "text", title: "右" },
    ], [{ id: occupiedId, fromNodeId: "left", toNodeId: "right" }]);
    const generated = proposal.ops.find((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "render--image-result");

    assert.notEqual(generated?.id, occupiedId);
    assert.ok(generated?.id?.startsWith(`${occupiedId}-`));
});

test("a result slot deleted by the proposal is replaced instead of being reused", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "delete_node", id: "existing-story--text-result" },
        { type: "add_node", id: "new-video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "existing-story", toNodeId: "new-video" },
    ], [
        { id: "existing-story", type: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { id: "existing-story--text-result", type: "text", title: "旧结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "existing-story" } },
    ], [
        { id: "old-result-edge", fromNodeId: "existing-story", toNodeId: "existing-story--text-result" },
    ]);
    const edges = proposal.ops.filter((op) => op.type === "connect_nodes").map((op) => `${op.fromNodeId}->${op.toNodeId}`);

    assert.ok(proposal.ops.some((op) => op.type === "delete_node" && op.id === "existing-story--text-result"));
    assert.ok(proposal.ops.some((op) => op.type === "add_node" && op.id === "existing-story--text-result"));
    assert.equal(proposal.ops.some((op) => op.type === "update_node" && op.id === "existing-story--text-result"), false);
    assert.ok(edges.includes("existing-story->existing-story--text-result"));
    assert.ok(edges.includes("existing-story--text-result->new-video"));
});

test("deleting all connections rebuilds every required result-slot edge", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "delete_connections", all: true },
        { type: "add_node", id: "new-video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "existing-story", toNodeId: "new-video" },
    ], [
        { id: "existing-story", type: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { id: "existing-result", type: "text", title: "分镜结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "existing-story" } },
    ], [
        { id: "old-edge", fromNodeId: "existing-story", toNodeId: "existing-result" },
    ]);
    const edges = proposal.ops.filter((op) => op.type === "connect_nodes").map((op) => `${op.fromNodeId}->${op.toNodeId}`);

    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.ids?.includes("old-edge")));
    assert.ok(edges.includes("existing-story->existing-result"));
    assert.ok(edges.includes("existing-result->new-video"));
});

test("a proposal can claim one compatible existing result slot without creating a duplicate", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成主视觉", metadata: { generationMode: "image" } },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "existing-result" },
    ], [
        { id: "existing-result", type: "image", title: "主视觉结果", metadata: { status: "idle" } },
    ]);

    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "render--image-result"), false);
    assert.deepEqual(proposal.bindings, [{ actionId: "render", mode: "image", outputNodeId: "existing-result", nextActionIds: [] }]);
    assert.ok(proposal.ops.some((op) => op.type === "update_node" && op.id === "existing-result" && op.metadata?.role === "result-slot"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "existing-result"));
});

test("a result slot owned by another action is never reused as a second output", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成主视觉", metadata: { generationMode: "image" } },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "foreign-result" },
    ], [
        { id: "foreign-result", type: "image", title: "其他结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "other-action" } },
    ]);

    assert.equal(proposal.bindings[0]?.outputNodeId, "render--image-result");
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "foreign-result"), false);
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "render--image-result"));
});

test("a selected result slot keeps exactly one proposed writer", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "asset", nodeType: "text", title: "输入", metadata: { content: "参考" } },
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "result", nodeType: "image", title: "图片结果槽" },
        { type: "connect_nodes", id: "render-result", fromNodeId: "render", toNodeId: "result" },
        { type: "connect_nodes", id: "asset-result", fromNodeId: "asset", toNodeId: "result" },
        { type: "run_generation", nodeId: "render" },
    ]);

    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "render" && op.toNodeId === "result"));
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "asset" && op.toNodeId === "result"), false);
});

test("two actions cannot keep writing into one newly claimed result slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "left", nodeType: "config", title: "左图", metadata: { generationMode: "image" } },
        { type: "add_node", id: "right", nodeType: "config", title: "右图", metadata: { generationMode: "image" } },
        { type: "add_node", id: "shared", nodeType: "image", title: "图片结果槽" },
        { type: "connect_nodes", fromNodeId: "left", toNodeId: "shared" },
        { type: "connect_nodes", fromNodeId: "right", toNodeId: "shared" },
        { type: "run_generation", nodeId: "left" },
        { type: "run_generation", nodeId: "right" },
    ]);

    assert.equal(proposal.bindings.find((binding) => binding.actionId === "left")?.outputNodeId, "shared");
    assert.equal(proposal.bindings.find((binding) => binding.actionId === "right")?.outputNodeId, "right--image-result");
    assert.equal(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "right" && op.toNodeId === "shared"), false);
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "right" && op.toNodeId === "right--image-result"));
});

test("choosing a ready canonical slot migrates old consumers and stable references", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "story" },
        { type: "update_node", id: "video", metadata: { prompt: "使用 @[node:story-empty]" } },
    ], [
        { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { id: "story-empty", type: "text", title: "旧文本结果槽", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "empty", status: "idle", resultVersions: [] } },
        { id: "story-ready", type: "text", title: "当前文本结果槽", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "ready", status: "success", content: "成稿", currentResultVersionId: "v1", resultVersions: [{ id: "v1", artifacts: [], createdAt: "2026-08-02T00:00:00.000Z", sourceNodeId: "story" }] } },
        { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "旧提示" } },
    ], [
        { id: "story-empty-edge", fromNodeId: "story", toNodeId: "story-empty" },
        { id: "story-empty-video", fromNodeId: "story-empty", toNodeId: "video" },
        { id: "story-ready-edge", fromNodeId: "story", toNodeId: "story-ready" },
    ]);
    const update = proposal.ops.find((op) => op.type === "update_node" && op.id === "video");

    assert.equal(proposal.bindings.find((binding) => binding.actionId === "story")?.outputNodeId, "story-ready");
    assert.deepEqual(proposal.bindings.find((binding) => binding.actionId === "story")?.nextActionIds, ["video"]);
    assert.ok(proposal.ops.some((op) => op.type === "delete_connections" && op.id === "story-empty-video"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "story-ready" && op.toNodeId === "video"));
    assert.equal(update?.metadata?.prompt, "使用 @[node:story-ready]");
});

test("discarded planned slots migrate their consumers and prompt tokens to the live ready slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "story" },
        { type: "add_node", id: "planned", nodeType: "text", title: "文本结果槽" },
        { type: "add_node", id: "video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "使用 @[node:planned]" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "planned" },
        { type: "connect_nodes", fromNodeId: "planned", toNodeId: "video" },
    ], [
        { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { id: "ready", type: "text", title: "当前文本结果槽", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "ready", status: "success", content: "成稿", currentResultVersionId: "v1", resultVersions: [{ id: "v1", artifacts: [], createdAt: "2026-08-02T00:00:00.000Z", sourceNodeId: "story" }] } },
    ], [{ id: "story-ready", fromNodeId: "story", toNodeId: "ready" }]);
    const video = proposal.ops.find((op) => op.type === "add_node" && op.id === "video");

    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "planned"), false);
    assert.equal(video?.metadata?.prompt, "使用 @[node:ready]");
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "ready" && op.toNodeId === "video"));
});

test("running a downstream action also starts every unresolved upstream action", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { type: "add_node", id: "video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "video" },
        { type: "run_generation", nodeId: "video" },
    ]);
    const runIds = proposal.ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId);

    assert.ok(runIds.includes("video"));
    assert.ok(runIds.includes("story"));
});

test("a ready upstream slot is repaired without rerunning its source action", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "video" },
    ], [
        { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { id: "story-result", type: "text", title: "文本结果槽", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "ready", status: "success", content: "成稿", currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text", content: "成稿" }], createdAt: "2026-08-02T00:00:00.000Z", sourceNodeId: "story" }] } },
        { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video" } },
    ], [{ id: "story-video", fromNodeId: "story-result", toNodeId: "video" }]);
    const runIds = proposal.ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId);

    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "story" && op.toNodeId === "story-result"));
    assert.deepEqual(runIds, ["video"]);
});

test("foreign slot routes are excluded before action reachability is derived", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "render" },
    ], [
        { id: "render", type: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { id: "foreign", type: "image", title: "其他结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "other" } },
        { id: "unrelated", type: "config", title: "无关视频", metadata: { generationMode: "video" } },
    ], [
        { id: "bad-writer", fromNodeId: "render", toNodeId: "foreign" },
        { id: "foreign-consumer", fromNodeId: "foreign", toNodeId: "unrelated" },
    ]);

    assert.equal(proposal.bindings.some((binding) => binding.actionId === "unrelated"), false);
    assert.equal(proposal.ops.some((op) => op.type === "add_node" && op.id === "unrelated--video-result"), false);
});

test("terminal run modes are materialized as terminal output modes", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "terminal", mode: "video" },
    ], [{ id: "terminal", type: "terminal", title: "处理步骤", metadata: {} }]);

    assert.deepEqual(proposal.bindings, [{ actionId: "terminal", mode: "video", outputNodeId: "terminal--video-result", nextActionIds: [] }]);
    assert.ok(proposal.ops.some((op) => op.type === "update_node" && op.id === "terminal" && op.metadata?.terminalOutputMode === "video"));
});

test("turning a node into a terminal preserves explicit patch input and output modes", () => {
    const normalized = normalizeZodiacCanvasOps([
        { type: "update_node", id: "step", patch: { type: "terminal", title: "处理步骤", metadata: { terminalInputMode: "image", terminalOutputMode: "video" } } },
        { type: "run_generation", nodeId: "step" },
    ]);
    const proposal = prepareZodiacToolProposal(normalized, [{ id: "step", type: "text", title: "旧文本" }]);
    const update = proposal.ops.find((op) => op.type === "update_node" && op.id === "step");

    assert.equal(update?.metadata?.terminalInputMode, "image");
    assert.equal(update?.metadata?.terminalOutputMode, "video");
    assert.equal(proposal.bindings[0]?.mode, "video");
});

test("every explicit branch is routed through the source result slot without inventing sibling edges", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "生成分镜", metadata: { generationMode: "text" } },
        { type: "add_node", id: "still", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "motion", nodeType: "config", title: "生成视频", metadata: { generationMode: "video" } },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "still" },
        { type: "connect_nodes", fromNodeId: "story", toNodeId: "motion" },
    ]);

    const edges = new Set(
        proposal.ops
            .filter((op) => op.type === "connect_nodes")
            .map((op) => `${op.fromNodeId}->${op.toNodeId}`),
    );
    assert.ok(edges.has("story->story--text-result"));
    assert.ok(edges.has("story--text-result->still"));
    assert.ok(edges.has("story--text-result->motion"));
    assert.ok(!edges.has("still--image-result->motion"));
    assert.deepEqual(proposal.bindings.find((binding) => binding.actionId === "story")?.nextActionIds, ["still", "motion"]);
});

test("misclassified result-slot labels are restored to typed data nodes", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "text-result", nodeType: "config", title: "文本结果槽", metadata: { generationMode: "text", prompt: "不应保留" } },
        { type: "add_node", id: "video-result", nodeType: "config", title: "视频结果槽", metadata: { generationMode: "video", prompt: "不应保留" } },
    ]);
    const additions = proposal.ops.filter((op) => op.type === "add_node");

    assert.deepEqual(additions.map((op) => op.nodeType), ["text", "video"]);
    assert.deepEqual(additions.map((op) => op.metadata), [{ status: "idle" }, { status: "idle" }]);
    assert.deepEqual(proposal.bindings, []);
});

test("generated node and connection ids stay stable for the same proposal", () => {
    const input = [
        { type: "add_node", nodeType: "config", title: "文本创作", metadata: { generationMode: "text" } },
        { type: "add_node", nodeType: "config", title: "视频创作", metadata: { generationMode: "video" } },
    ] as const;

    assert.deepEqual(prepareZodiacToolProposal([...input]), prepareZodiacToolProposal([...input]));
});

test("automatic workflow execution stays separate from a result slot's own advance mode", () => {
    const proposal = prepareZodiacExecutableToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "render-result", nodeType: "image", title: "图片结果槽", metadata: { advanceMode: "auto" } },
        { type: "connect_nodes", fromNodeId: "render", toNodeId: "render-result" },
    ], "无需确认，直接跑完", "automatic");
    const resultSlot = proposal.ops.find((op) => op.type === "add_node" && op.id === "render-result");

    assert.equal(proposal.executionMode, "automatic");
    assert.equal(resultSlot?.metadata?.advanceMode, "review");
});

test("slot migration rewrites stable references already stored on an existing consumer", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "story", mode: "text" },
    ], [
        { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { id: "old", type: "text", title: "旧结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "empty", resultVersions: [] } },
        { id: "ready", type: "text", title: "当前结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "ready", status: "success", content: "成稿", currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text", content: "成稿" }] }] } },
        { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "使用 @[node:old]，保留 @[node:other]", composerContent: "使用 @[node:old]" } },
    ], [
        { id: "story-old", fromNodeId: "story", toNodeId: "old" },
        { id: "old-video", fromNodeId: "old", toNodeId: "video" },
        { id: "story-ready", fromNodeId: "story", toNodeId: "ready" },
    ]);
    const consumerUpdate = proposal.ops.find((op) => op.type === "update_node" && op.id === "video" && op.metadata?.prompt);

    assert.equal(consumerUpdate?.metadata?.prompt, "使用 @[node:ready]，保留 @[node:other]");
    assert.equal(consumerUpdate?.metadata?.composerContent, "使用 @[node:ready]");
    assert.deepEqual(resolveCanvasInputBindings([{ nodeId: "ready", ready: true }], consumerUpdate?.metadata?.composerContent || "").selectedInputs, [{ nodeId: "ready", ready: true }]);
});

test("deleting a custom owned slot migrates its consumers and stable references to the replacement", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "delete_node", id: "custom-story-result" },
        { type: "run_generation", nodeId: "story", mode: "text" },
    ], [
        { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
        { id: "custom-story-result", type: "text", title: "旧结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "empty", resultVersions: [] } },
        { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "使用 @[node:custom-story-result]", composerContent: "使用 @[node:custom-story-result]" } },
    ], [
        { id: "story-custom", fromNodeId: "story", toNodeId: "custom-story-result" },
        { id: "custom-video", fromNodeId: "custom-story-result", toNodeId: "video" },
    ]);
    const storyBinding = proposal.bindings.find((binding) => binding.actionId === "story");
    const consumerUpdate = proposal.ops.find((op) => op.type === "update_node" && op.id === "video" && op.metadata?.prompt);

    assert.equal(storyBinding?.outputNodeId, "story--text-result");
    assert.ok(storyBinding?.nextActionIds.includes("video"));
    assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "story--text-result" && op.toNodeId === "video"));
    assert.equal(consumerUpdate?.metadata?.prompt, "使用 @[node:story--text-result]");
    assert.equal(consumerUpdate?.metadata?.composerContent, "使用 @[node:story--text-result]");
});

test("only a selected successful result version counts as a durable ready upstream", () => {
    const cases = [
        { name: "legacy content", metadata: { slotState: "ready", status: "success", content: "旧内容", resultVersions: [] }, reruns: true },
        { name: "storage only", metadata: { slotState: "ready", status: "success", storageKey: "old/key", resultVersions: [] }, reruns: true },
        { name: "unselected success", metadata: { slotState: "ready", status: "success", resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text", content: "成稿" }] }] }, reruns: true },
        { name: "selected failure", metadata: { slotState: "ready", status: "error", currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "error", artifacts: [], errorDetails: "失败" }] }, reruns: true },
        { name: "selected success", metadata: { slotState: "ready", status: "success", currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text", content: "成稿" }] }] }, reruns: false },
    ] as const;

    cases.forEach(({ name, metadata, reruns }) => {
        const proposal = prepareZodiacToolProposal([
            { type: "run_generation", nodeId: "video", mode: "video" },
        ], [
            { id: "story", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
            { id: "slot", type: "text", title: "文本结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", ...metadata } },
            { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video" } },
        ], [
            { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
            { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
        ]);
        const runIds = proposal.ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId);
        assert.equal(runIds.includes("story"), reruns, name);
    });
});

test("retiring an action freezes its durable result as an ordinary downstream asset", () => {
    const knownNodes = [
        { id: "story", type: "config" as const, title: "生成文案", metadata: { generationMode: "text" as const } },
        { id: "slot", type: "text" as const, title: "文本结果槽", position: { x: 320, y: 20 }, metadata: { role: "result-slot" as const, resultSlotMode: "text" as const, resultSlotSourceNodeId: "story", slotState: "ready" as const, status: "success" as const, content: "成稿", currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "success" as const, primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text" as const, content: "成稿" }] }] } },
        { id: "video", type: "config" as const, title: "生成视频", metadata: { generationMode: "video" as const, prompt: "使用 @[node:slot]" } },
    ];
    const connections = [
        { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
        { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
    ];

    for (const retireOp of [
        { type: "delete_node", id: "story" } as const,
        { type: "update_node", id: "story", patch: { type: "text" as const }, metadata: { content: "普通文本" } } as const,
    ]) {
        const proposal = prepareZodiacToolProposal([retireOp, { type: "run_generation", nodeId: "video", mode: "video" }], knownNodes, connections);
        const frozen = proposal.ops.find((op) => op.type === "add_node" && op.id?.startsWith("slot--frozen"));
        const consumerUpdate = proposal.ops.find((op) => op.type === "update_node" && op.id === "video" && op.metadata?.prompt);

        assert.ok(frozen);
        assert.equal(frozen?.metadata?.role, undefined);
        assert.equal(frozen?.metadata?.content, "成稿");
        assert.ok(proposal.ops.some((op) => op.type === "delete_node" && op.id === "slot"));
        assert.ok(proposal.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === frozen?.id && op.toNodeId === "video"));
        assert.equal(consumerUpdate?.metadata?.prompt, `使用 @[node:${frozen?.id}]`);
        assert.deepEqual(prepareZodiacToolProposal(proposal.ops, knownNodes, connections), proposal);
    }
});

test("retiring an action with an empty owned slot and a live consumer fails closed", () => {
    const nodes = [
        { id: "story", type: "config" as const, title: "生成文案", metadata: { generationMode: "text" as const } },
        { id: "slot", type: "text" as const, title: "文本结果槽", metadata: { role: "result-slot" as const, resultSlotMode: "text" as const, resultSlotSourceNodeId: "story", slotState: "empty" as const, resultVersions: [] } },
        { id: "video", type: "config" as const, title: "生成视频", metadata: { generationMode: "video" as const } },
    ];
    const connections = [
        { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
        { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
    ];

    assert.deepEqual(prepareZodiacToolProposal([
        { type: "delete_node", id: "story" },
        { type: "run_generation", nodeId: "video" },
    ], nodes, connections), { ops: [], bindings: [] });
    assert.deepEqual(prepareZodiacToolProposal([
        { type: "update_node", id: "story", patch: { type: "text" }, metadata: { content: "普通文本" } },
        { type: "run_generation", nodeId: "video" },
    ], nodes, connections), { ops: [], bindings: [] });
});

test("deleting an owner and its slot together cannot bypass retirement safety", () => {
    const connections = [
        { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
        { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
    ];
    const emptyNodes = [
        { id: "story", type: "config" as const, title: "生成文案", metadata: { generationMode: "text" as const } },
        { id: "slot", type: "text" as const, title: "文本结果槽", metadata: { role: "result-slot" as const, resultSlotMode: "text" as const, resultSlotSourceNodeId: "story", slotState: "empty" as const, resultVersions: [] } },
        { id: "video", type: "config" as const, title: "生成视频", metadata: { generationMode: "video" as const, prompt: "使用 @[node:slot]" } },
    ];

    assert.deepEqual(prepareZodiacToolProposal([
        { type: "delete_node", id: "story" },
        { type: "delete_node", id: "slot" },
        { type: "run_generation", nodeId: "video" },
    ], emptyNodes, connections), { ops: [], bindings: [] });

    const durableNodes = emptyNodes.map((node) => node.id !== "slot" ? node : {
        ...node,
        metadata: {
            ...node.metadata,
            slotState: "ready" as const,
            status: "success" as const,
            content: "成稿",
            currentResultVersionId: "v1",
            resultVersions: [{ id: "v1", status: "success" as const, primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text" as const, content: "成稿" }] }],
        },
    });
    const durable = prepareZodiacToolProposal([
        { type: "delete_node", id: "story" },
        { type: "delete_node", id: "slot" },
        { type: "run_generation", nodeId: "video" },
    ], durableNodes, connections);
    const frozen = durable.ops.find((op) => op.type === "add_node" && op.id?.startsWith("slot--frozen"));

    assert.ok(frozen);
    assert.ok(durable.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === frozen?.id && op.toNodeId === "video"));
    assert.ok(durable.ops.some((op) => op.type === "update_node" && op.id === "video" && op.metadata?.prompt === `使用 @[node:${frozen?.id}]`));
    assert.deepEqual(prepareZodiacToolProposal(durable.ops, durableNodes, connections), durable);
});

test("a fresh id collision never takes ownership of a deleted known slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "story", nodeType: "config", title: "新文案任务", metadata: { generationMode: "text" } },
        { type: "delete_node", id: "slot" },
        { type: "run_generation", nodeId: "video", mode: "video" },
    ], [
        { id: "story", type: "config", title: "原文案任务", metadata: { generationMode: "text" } },
        { id: "slot", type: "text", title: "原结果槽", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "empty", resultVersions: [] } },
        { id: "video", type: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "使用 @[node:slot]" } },
    ], [
        { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
        { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
    ]);
    const oldStory = proposal.bindings.find((binding) => binding.actionId === "story");
    const newStory = proposal.bindings.find((binding) => binding.actionId !== "story" && binding.actionId.startsWith("story-new"));
    const consumerUpdate = proposal.ops.find((op) => op.type === "update_node" && op.id === "video" && op.metadata?.prompt);

    assert.ok(oldStory?.nextActionIds.includes("video"));
    assert.equal(newStory?.nextActionIds.includes("video"), false);
    assert.equal(consumerUpdate?.metadata?.prompt, `使用 @[node:${oldStory?.outputNodeId}]`);
});

test("collision aliases never cascade through another declared raw id", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "a", nodeType: "config", title: "第一步", metadata: { generationMode: "text", prompt: "自用 @[node:a]" } },
        { type: "add_node", id: "a-new", nodeType: "config", title: "第二步", metadata: { generationMode: "video", prompt: "使用 @[node:a]" } },
        { type: "connect_nodes", fromNodeId: "a", toNodeId: "a-new" },
        { type: "run_generation", nodeId: "a", mode: "text" },
    ], [{ id: "a", type: "text", title: "已有节点" }]);
    const first = proposal.ops.find((op) => op.type === "add_node" && op.nodeType === "config" && op.title === "第一步");
    const second = proposal.ops.find((op) => op.type === "add_node" && op.nodeType === "config" && op.title === "第二步");
    const run = proposal.ops.find((op) => op.type === "run_generation");

    assert.notEqual(first?.id, second?.id);
    assert.notEqual(first?.id, "a-new");
    assert.equal(first?.metadata?.prompt, `自用 @[node:${first?.id}]`);
    assert.equal(second?.metadata?.prompt, `使用 @[node:${first?.id}]`);
    assert.equal(run?.nodeId, first?.id);
    assert.equal(proposal.bindings.find((binding) => binding.actionId === first?.id)?.nextActionIds[0], second?.id);
    assert.equal(proposal.bindings.find((binding) => binding.actionId === second?.id)?.mode, "video");
});

test("layout-only updates do not rerun a durable upstream while semantic updates do", () => {
    const nodes = [
        { id: "story", type: "config" as const, title: "生成文案", position: { x: 0, y: 0 }, metadata: { generationMode: "text" as const, prompt: "旧提示" } },
        { id: "slot", type: "text" as const, title: "文本结果", metadata: { role: "result-slot" as const, resultSlotMode: "text" as const, resultSlotSourceNodeId: "story", slotState: "ready" as const, status: "success" as const, currentResultVersionId: "v1", resultVersions: [{ id: "v1", status: "success" as const, primaryArtifactId: "text-1", artifacts: [{ id: "text-1", kind: "text" as const, content: "成稿" }] }] } },
        { id: "video", type: "config" as const, title: "生成视频", metadata: { generationMode: "video" as const } },
    ];
    const connections = [
        { id: "story-slot", fromNodeId: "story", toNodeId: "slot" },
        { id: "slot-video", fromNodeId: "slot", toNodeId: "video" },
    ];
    const layout = prepareZodiacToolProposal([
        { type: "update_node", id: "story", patch: { position: { x: 40, y: 80 } } },
        { type: "run_generation", nodeId: "video" },
    ], nodes, connections);
    const semantic = prepareZodiacToolProposal([
        { type: "update_node", id: "story", metadata: { prompt: "新提示" } },
        { type: "run_generation", nodeId: "video" },
    ], nodes, connections);

    assert.deepEqual(layout.ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId), ["video"]);
    assert.deepEqual(semantic.ops.filter((op) => op.type === "run_generation").map((op) => op.nodeId), ["video", "story"]);
});

test("repeated runs for one action merge once with field-level last-specified values", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "render", nodeType: "config", title: "生成内容", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image", prompt: "第一版" },
        { type: "run_generation", nodeId: "render", mode: "video" },
        { type: "run_generation", nodeId: "render", prompt: "第二版" },
    ]);
    const runs = proposal.ops.filter((op) => op.type === "run_generation");

    assert.deepEqual(runs, [{ type: "run_generation", nodeId: "render", mode: "video", prompt: "第二版" }]);
    assert.equal(proposal.bindings[0]?.mode, "video");
    assert.equal(proposal.bindings[0]?.outputNodeId, "render--video-result");

    const terminal = prepareZodiacToolProposal([
        { type: "add_node", id: "terminal", nodeType: "terminal", title: "处理", metadata: { terminalOutputMode: "text" } },
        { type: "run_generation", nodeId: "terminal", mode: "image" },
        { type: "run_generation", nodeId: "terminal", mode: "video" },
    ]);
    assert.equal(terminal.ops.filter((op) => op.type === "run_generation").length, 1);
    assert.ok(terminal.ops.some((op) => op.type === "update_node" && op.id === "terminal" && op.metadata?.terminalOutputMode === "video"));
});

test("duplicate ids already present on the canvas are rejected before map materialization", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "run_generation", nodeId: "same", mode: "text" },
    ], [
        { id: "same", type: "config", title: "第一份", metadata: { generationMode: "text" } },
        { id: "same", type: "config", title: "第二份", metadata: { generationMode: "text" } },
    ]);

    assert.deepEqual(proposal, { ops: [], bindings: [] });
});
