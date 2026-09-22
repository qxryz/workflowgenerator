import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

async function loadApplyBoundary() {
    const root = process.cwd();
    const bundle = await build({
        entryPoints: [path.join(root, "src/pages/canvas/hooks/agent-bridge-apply-boundary.ts")],
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

function canvasNodeFromAdd(op) {
    return {
        id: op.id,
        type: op.nodeType,
        title: op.title || "节点",
        position: op.position || { x: op.x || 0, y: op.y || 0 },
        width: op.width || 340,
        height: op.height || 240,
        metadata: op.metadata || {},
    };
}

test("apply boundary remaps a node id that appeared after proposal preparation", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const approvedOps = [
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image", prompt: "海边" } },
        { type: "add_node", id: "render-result", nodeType: "image", title: "图片结果槽" },
        { type: "connect_nodes", id: "render-edge", fromNodeId: "render", toNodeId: "render-result" },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ];
    const nodeAddedDuringConfirmation = {
        id: "render",
        type: "config",
        title: "已有节点",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: "image", prompt: "旧提示词" },
    };

    const plan = resolveAgentApplyPlan(approvedOps, snapshot([nodeAddedDuringConfirmation]));
    const actionAdd = plan.ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const run = plan.ops.find((op) => op.type === "run_generation");
    const actionEdge = plan.ops.find((op) => op.type === "connect_nodes" && op.fromNodeId === actionAdd.id);

    assert.equal(plan.structureAlreadyApplied, false);
    assert.notEqual(actionAdd.id, "render");
    assert.equal(run.nodeId, actionAdd.id);
    assert.ok(actionEdge, "rewritten action should retain its output connection");
});

test("retry reuses the exact remapped operations when their structure is still present", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const approvedOps = [
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ];
    const existing = {
        id: "render",
        type: "config",
        title: "已有节点",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: "image" },
    };
    const firstPlan = resolveAgentApplyPlan(approvedOps, snapshot([existing]));
    const appliedNodes = firstPlan.ops.filter((op) => op.type === "add_node").map(canvasNodeFromAdd);
    const appliedConnections = firstPlan.ops
        .filter((op) => op.type === "connect_nodes")
        .map((op) => ({ id: op.id, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }));

    const retryPlan = resolveAgentApplyPlan(approvedOps, snapshot([existing, ...appliedNodes], appliedConnections), firstPlan.ops);

    assert.equal(retryPlan.structureAlreadyApplied, true);
    const firstRunNodeId = firstPlan.ops.find((op) => op.type === "run_generation").nodeId;
    assert.equal(retryPlan.ops.find((op) => op.type === "run_generation").nodeId, firstRunNodeId);
    assert.deepEqual(
        retryPlan.ops.filter((op) => op.type === "add_node" && op.nodeType === "config").map((op) => op.id),
        [firstRunNodeId],
    );
    assert.notEqual(firstRunNodeId, "render");
});

test("a read snapshot stays on the last coherent project while the next project is loading", async () => {
    const { assertAgentProjectMutation, resolveAgentReadableSnapshot } = await loadApplyBoundary();
    const projectA = snapshot([{ id: "a", type: "text", title: "A", position: { x: 0, y: 0 }, width: 320, height: 220, metadata: {} }]);
    const mixedLoadingFrame = {
        ...snapshot(projectA.nodes),
        projectId: "project-b",
        title: "B",
    };

    const duringSwitch = resolveAgentReadableSnapshot(projectA, mixedLoadingFrame, false);
    const projectB = resolveAgentReadableSnapshot(duringSwitch, { ...snapshot([], []), projectId: "project-b", title: "B" }, true);

    assert.equal(duringSwitch, projectA);
    assert.equal(duringSwitch.projectId, "project");
    assert.deepEqual(duringSwitch.nodes.map((node) => node.id), ["a"]);
    assert.equal(projectB.projectId, "project-b");
    assert.deepEqual(projectB.nodes, []);

    const loadingIdentity = { projectId: "project-b", projectEpoch: 2, ready: false, title: "B" };
    assert.throws(() => assertAgentProjectMutation(loadingIdentity), /画布正在切换/);
    const readyIdentity = { ...loadingIdentity, ready: true };
    assert.equal(assertAgentProjectMutation(readyIdentity), readyIdentity);
    assert.throws(
        () => assertAgentProjectMutation(readyIdentity, { projectId: "project", projectEpoch: 1 }),
        /画布正在切换/,
    );
});

test("retry repairs a partially committed structure without remapping its stable ids", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const approvedOps = [
        { type: "add_node", id: "render", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "run_generation", nodeId: "render", mode: "image" },
    ];
    const occupied = {
        id: "render",
        type: "config",
        title: "已有节点",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: "image" },
    };
    const firstPlan = resolveAgentApplyPlan(approvedOps, snapshot([occupied]));
    const committedAction = firstPlan.ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const partialSnapshot = snapshot([occupied, canvasNodeFromAdd(committedAction)]);

    const retryPlan = resolveAgentApplyPlan(approvedOps, partialSnapshot, firstPlan.ops);

    assert.equal(retryPlan.structureAlreadyApplied, false);
    assert.equal(
        retryPlan.ops.find((op) => op.type === "run_generation").nodeId,
        committedAction.id,
    );
    assert.ok(
        retryPlan.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === committedAction.id),
        "retry should repair the missing result-slot connection",
    );
    const firstAddIds = new Set(firstPlan.ops.filter((op) => op.type === "add_node").map((op) => op.id));
    assert.ok(
        retryPlan.ops.filter((op) => op.type === "add_node").every((op) => firstAddIds.has(op.id)),
        "stable receipt ids must not be remapped again",
    );
});

test("live revalidation rejects an update whose approved target disappeared", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();

    assert.throws(
        () => resolveAgentApplyPlan([{ type: "update_node", id: "gone", metadata: { prompt: "保留这个修改" } }], snapshot()),
        /工作流结构在上次提交后已被修改/,
    );
});

test("live revalidation rejects a generation whose approved action disappeared", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();

    assert.throws(
        () => resolveAgentApplyPlan([{ type: "run_generation", nodeId: "gone", mode: "image" }], snapshot()),
        /工作流结构在上次提交后已被修改/,
    );
});

test("live revalidation rejects delete-then-run when normalization drops the approved run", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const action = {
        id: "render",
        type: "config",
        title: "生成图片",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: "image" },
    };

    assert.throws(
        () => resolveAgentApplyPlan([
            { type: "delete_node", id: "render" },
            { type: "run_generation", nodeId: "render", mode: "image" },
        ], snapshot([action])),
        /工作流结构在上次提交后已被修改/,
    );
});

test("live revalidation rejects a cycle instead of treating an empty prepared plan as success", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const actionA = {
        id: "a",
        type: "config",
        title: "A",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: { generationMode: "text" },
    };
    const actionB = {
        ...actionA,
        id: "b",
        title: "B",
        position: { x: 500, y: 0 },
    };

    assert.throws(
        () => resolveAgentApplyPlan([
            { type: "connect_nodes", id: "a-to-b", fromNodeId: "a", toNodeId: "b" },
            { type: "run_generation", nodeId: "a", mode: "text" },
        ], snapshot([actionA, actionB], [{ id: "b-to-a", fromNodeId: "b", toNodeId: "a" }])),
        /工作流结构在上次提交后已被修改/,
    );
});

test("a fresh delete cannot silently succeed after its approved target vanished, but a receipt retry is idempotent", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const deleteOps = [{ type: "delete_node", id: "gone" }];

    assert.throws(
        () => resolveAgentApplyPlan(deleteOps, snapshot()),
        /工作流结构在上次提交后已被修改/,
    );
    const retryPlan = resolveAgentApplyPlan(deleteOps, snapshot(), deleteOps, true);
    assert.equal(retryPlan.structureAlreadyApplied, true);
    assert.deepEqual(retryPlan.ops, deleteOps);
});

test("a receipt for a disabled plugin node fails before canvas apply can downgrade it to text", async () => {
    const { resolveAgentApplyPlan } = await loadApplyBoundary();
    const receiptOps = [
        {
            type: "add_node",
            id: "director",
            nodeType: "director-desk:project",
            title: "导演台",
            metadata: { content: "三镜头分镜" },
        },
    ];
    const existingDirector = {
        id: "director",
        type: "director-desk:project",
        title: "导演台",
        position: { x: 0, y: 0 },
        width: 480,
        height: 320,
        metadata: { content: "三镜头分镜" },
    };

    assert.throws(() => resolveAgentApplyPlan(receiptOps, snapshot([existingDirector]), receiptOps, true), /工作流结构在上次提交后已被修改/);
});
