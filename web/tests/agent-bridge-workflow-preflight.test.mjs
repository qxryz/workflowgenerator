import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

async function loadPreflight() {
    const root = process.cwd();
    const bundle = await build({
        entryPoints: [path.join(root, "src/pages/canvas/hooks/agent-bridge-workflow-preflight.ts")],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        alias: { "@": path.join(root, "src") },
    });
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
    return import(moduleUrl);
}

function snapshot(nodes = [], connections = []) {
    return {
        projectId: "project",
        title: "工作流",
        nodes,
        connections,
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function action(id, mode, x = 0) {
    return {
        id,
        type: "config",
        title: `${mode} 步骤`,
        position: { x, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: mode, composerContent: `${mode} prompt` },
    };
}

function slot(id, mode, sourceNodeId, x = 400, state = "empty") {
    return {
        id,
        type: mode,
        title: `${mode} 结果`,
        position: { x, y: 0 },
        width: 320,
        height: 220,
        metadata: {
            role: "result-slot",
            advanceMode: "review",
            slotState: state,
            resultSlotMode: mode,
            resultSlotSourceNodeId: sourceNodeId,
            resultVersions: [],
        },
    };
}

test("preflight materializes the exact post-apply workflow without mutating the live snapshot", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const current = snapshot();
    const before = structuredClone(current);
    const ops = [
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "text" } },
        {
            type: "add_node",
            id: "render-slot",
            nodeType: "image",
            title: "图片结果",
            metadata: {
                role: "result-slot",
                advanceMode: "review",
                slotState: "empty",
                resultSlotMode: "image",
                resultSlotSourceNodeId: "render",
                resultVersions: [],
            },
        },
        { type: "connect_nodes", id: "render-output", fromNodeId: "render", toNodeId: "render-slot" },
        { type: "run_generation", nodeId: "render", mode: "image", prompt: "雨后的海边" },
    ];

    const result = preflightAgentWorkflowApply(current, ops);

    assert.deepEqual(current, before, "preflight must never write the live canvas");
    assert.deepEqual(result.generationNodeIds, ["render"]);
    const previewAction = result.preview.nodes.find((node) => node.id === "render");
    assert.equal(previewAction.metadata.generationMode, "image");
    assert.equal(previewAction.metadata.prompt, "雨后的海边");
    assert.equal(previewAction.metadata.composerContent, "雨后的海边");
    assert.ok(result.preview.connections.some((connection) => connection.fromNodeId === "render" && connection.toNodeId === "render-slot"));
});

test("preflight rejects a missing result slot before changing any structure", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const current = snapshot([action("render", "image")]);
    const before = structuredClone(current);

    assert.throws(() => preflightAgentWorkflowApply(current, [{ type: "run_generation", nodeId: "render", mode: "image" }]), /还没有结果槽/);
    assert.deepEqual(current, before);
});

test("preflight rejects a pending upstream result", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [action("outline", "text"), slot("outline-slot", "text", "outline"), action("render", "image", 800), slot("render-slot", "image", "render", 1200)];
    const connections = [
        { id: "outline-output", fromNodeId: "outline", toNodeId: "outline-slot" },
        { id: "outline-render", fromNodeId: "outline-slot", toNodeId: "render" },
        { id: "render-output", fromNodeId: "render", toNodeId: "render-slot" },
    ];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image" }]), /上游结果还没有就绪/);
});

test("preflight rejects an output mode mismatch", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [action("render", "image"), slot("render-slot", "text", "render")];
    const connections = [{ id: "render-output", fromNodeId: "render", toNodeId: "render-slot" }];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image" }]), /输出类型和结果槽不匹配/);
});

test("preflight rejects a selected workflow cycle", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [action("a", "text"), slot("a-slot", "text", "a"), action("b", "text", 800), slot("b-slot", "text", "b", 1200)];
    const connections = [
        { id: "a-output", fromNodeId: "a", toNodeId: "a-slot" },
        { id: "a-b", fromNodeId: "a-slot", toNodeId: "b" },
        { id: "b-output", fromNodeId: "b", toNodeId: "b-slot" },
        { id: "b-a", fromNodeId: "b-slot", toNodeId: "a" },
    ];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "a", mode: "text" }]), /存在循环/);
});

test("a globally invalid disconnected edge is rejected before the real runner sees it", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [action("render", "image"), slot("render-slot", "image", "render")];
    const connections = [
        { id: "render-output", fromNodeId: "render", toNodeId: "render-slot" },
        { id: "unrelated-broken-edge", fromNodeId: "missing-one", toNodeId: "missing-two" },
    ];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image" }]), /画布其他区域还有断开的连接/);
});

test("a broken sibling branch is rejected before the full canvas runner commits", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const outlineSlot = {
        ...slot("outline-slot", "text", "outline", 400, "ready"),
        metadata: {
            ...slot("outline-slot", "text", "outline", 400, "ready").metadata,
            content: "现成分镜",
            currentResultVersionId: "outline-v1",
            resultVersions: [
                {
                    id: "outline-v1",
                    status: "success",
                    artifacts: [{ id: "outline-text", kind: "text", content: "现成分镜" }],
                    primaryArtifactId: "outline-text",
                },
            ],
        },
    };
    const nodes = [action("outline", "text"), outlineSlot, action("render", "image", 800), slot("render-slot", "image", "render", 1200)];
    const connections = [
        { id: "outline-output", fromNodeId: "outline", toNodeId: "outline-slot" },
        { id: "outline-render", fromNodeId: "outline-slot", toNodeId: "render" },
        { id: "outline-broken-sibling", fromNodeId: "outline-slot", toNodeId: "missing-draft-action" },
        { id: "render-output", fromNodeId: "render", toNodeId: "render-slot" },
    ];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image" }]), /画布其他区域还有断开的连接/);
});

test("an unrelated but valid unfinished draft does not block the selected action", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [action("render", "image"), slot("render-slot", "image", "render"), action("unrelated-draft", "video", 1000)];
    const connections = [{ id: "render-output", fromNodeId: "render", toNodeId: "render-slot" }];

    const result = preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image" }]);

    assert.deepEqual(result.generationNodeIds, ["render"]);
});

test("a receipt retry rejects run configuration drift instead of only fixing its preview", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const editedAction = {
        ...action("render", "video"),
        metadata: { generationMode: "video", prompt: "用户后来改的内容", composerContent: "用户后来改的内容" },
    };
    const nodes = [editedAction, slot("render-slot", "image", "render")];
    const connections = [{ id: "render-output", fromNodeId: "render", toNodeId: "render-slot" }];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "run_generation", nodeId: "render", mode: "image", prompt: "回执中的内容" }], { structureAlreadyApplied: true }), /上次提交后已被修改/);
});

test("a destructive receipt refuses a node id that has reappeared", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const replacement = {
        id: "victim",
        type: "text",
        title: "后来新建的笔记",
        position: { x: 0, y: 0 },
        width: 320,
        height: 220,
        metadata: { content: "必须保留" },
    };
    const current = snapshot([replacement]);
    const before = structuredClone(current);

    assert.throws(() => preflightAgentWorkflowApply(current, [{ type: "delete_node", id: "victim" }], { receiptRetry: true }), /删除目标在上次提交后发生了变化/);
    assert.deepEqual(current, before);
});

test("a destructive receipt refuses a connection id that has reappeared", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const nodes = [
        { id: "left", type: "text", title: "左", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: {} },
        { id: "right", type: "text", title: "右", position: { x: 500, y: 0 }, width: 320, height: 220, metadata: {} },
    ];
    const connections = [{ id: "victim-edge", fromNodeId: "left", toNodeId: "right" }];

    assert.throws(() => preflightAgentWorkflowApply(snapshot(nodes, connections), [{ type: "delete_connections", id: "victim-edge" }], { receiptRetry: true }), /要删除的连接在上次提交后发生了变化/);
});

test("an already committed destructive receipt stays idempotent while its targets remain absent", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const current = snapshot();
    const result = preflightAgentWorkflowApply(
        current,
        [
            { type: "delete_node", id: "gone" },
            { type: "delete_connections", id: "gone-edge" },
        ],
        { receiptRetry: true },
    );

    assert.deepEqual(result.preview, current);
});

test("a destructive receipt rejects delete-and-recreate of the same id", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();

    assert.throws(
        () =>
            preflightAgentWorkflowApply(
                snapshot(),
                [
                    { type: "delete_node", id: "same" },
                    { type: "add_node", id: "same", nodeType: "text", title: "新内容" },
                ],
                { receiptRetry: true },
            ),
        /删除目标在上次提交后发生了变化/,
    );
});

test("the receipt persistence window rejects same-project canvas changes before execution", async () => {
    const { assertAgentWorkflowPreviewCurrent } = await loadPreflight();
    const nodes = [action("render", "image"), slot("render-slot", "image", "render")];
    const connections = [{ id: "render-output", fromNodeId: "render", toNodeId: "render-slot" }];
    const expected = snapshot(nodes, connections);
    const harmlessViewChange = { ...structuredClone(expected), selectedNodeIds: ["render"], viewport: { x: 40, y: 20, k: 1.2 } };
    harmlessViewChange.nodes[0].position = { x: 80, y: 60 };
    harmlessViewChange.nodes.push({ id: "note", type: "text", title: "无关笔记", position: { x: 1600, y: 0 }, width: 320, height: 220, metadata: { content: "稍后再处理" } });
    assert.doesNotThrow(() => assertAgentWorkflowPreviewCurrent(expected, harmlessViewChange, ["render"]));

    const edited = structuredClone(expected);
    edited.nodes[0].metadata.composerContent = "等待保存时被修改";
    assert.throws(() => assertAgentWorkflowPreviewCurrent(expected, edited, ["render"]), /画布在提交后发生了变化/);

    const rewired = structuredClone(expected);
    rewired.connections = [];
    assert.throws(() => assertAgentWorkflowPreviewCurrent(expected, rewired, ["render"]), /画布在提交后发生了变化/);
});

test("structure-only plans are previewed without invoking workflow validation", async () => {
    const { preflightAgentWorkflowApply } = await loadPreflight();
    const current = snapshot();
    const result = preflightAgentWorkflowApply(current, [{ type: "add_node", id: "note", nodeType: "text", title: "说明" }]);

    assert.deepEqual(result.generationNodeIds, []);
    assert.deepEqual(current.nodes, []);
    assert.deepEqual(
        result.preview.nodes.map((node) => node.id),
        ["note"],
    );
});
