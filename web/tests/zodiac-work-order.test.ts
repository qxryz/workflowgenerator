import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { build } from "esbuild";

const previewBundle = await build({
    entryPoints: [path.resolve("src/lib/agent/zodiac-work-order.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": path.resolve("src") },
    // Inspect the private preview without adding a public production API.
    footer: { js: "export { applyWorkOrderOps };" },
});
const { assertZodiacWorkOrderApplied, buildZodiacWorkOrder, applyWorkOrderOps } = await import(`data:text/javascript;base64,${Buffer.from(previewBundle.outputFiles[0].text).toString("base64")}`);
const applyBundle = await build({ entryPoints: [path.resolve("src/lib/canvas/canvas-agent-ops.ts")], bundle: true, write: false, platform: "node", format: "esm", alias: { "@": path.resolve("src") } });
const { applyCanvasAgentOps } = await import(`data:text/javascript;base64,${Buffer.from(applyBundle.outputFiles[0].text).toString("base64")}`);
import { prepareZodiacToolProposal } from "../src/lib/agent/zodiac-tool-proposal.ts";

test("work order exposes the exact prompt, input binding, and owned output slot", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "brief", nodeType: "text", title: "创作要求", metadata: { content: "香港高楼飞行" } },
        { type: "add_node", id: "image", nodeType: "config", title: "生成首帧", metadata: { generationMode: "image", prompt: "黄昏金色时刻，第一视角飞行" } },
        { type: "connect_nodes", fromNodeId: "brief", toNodeId: "image" },
    ]);
    const order = buildZodiacWorkOrder(proposal.ops);
    assert.equal(order.issues.length, 0);
    assert.equal(order.steps.length, 1);
    assert.equal(order.steps[0]?.prompt, "黄昏金色时刻，第一视角飞行");
    assert.deepEqual(order.steps[0]?.inputNodeIds, ["brief"]);
    assert.ok(order.steps[0]?.outputNodeId);
});

test("work order blocks an empty generated action before it reaches the canvas", () => {
    const proposal = prepareZodiacToolProposal([{ type: "add_node", id: "image", nodeType: "config", title: "生成首帧", metadata: { generationMode: "image" } }]);
    const order = buildZodiacWorkOrder(proposal.ops);
    assert.ok(order.issues.some((issue) => issue.code === "missing_prompt"));
});

test("post-apply verification catches a prompt that was not assembled", () => {
    const proposal = prepareZodiacToolProposal([{ type: "add_node", id: "image", nodeType: "config", title: "生成首帧", metadata: { generationMode: "image", prompt: "完整提示词" } }]);
    const order = buildZodiacWorkOrder(proposal.ops);
    const nodes = proposal.ops.flatMap((op) =>
        op.type === "add_node" && op.id
            ? [
                  {
                      id: op.id,
                      type: op.nodeType || "text",
                      title: op.title || "",
                      position: op.position || { x: 0, y: 0 },
                      width: op.width || 360,
                      height: op.height || 240,
                      metadata: op.metadata?.role === "result-slot" ? op.metadata : { ...op.metadata, prompt: "" },
                  },
              ]
            : [],
    );
    const connections = proposal.ops.flatMap((op, index) => (op.type === "connect_nodes" ? [{ id: op.id || `link-${index}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }] : []));
    assert.throws(() => assertZodiacWorkOrderApplied(order, { nodes, connections }), /创作内容没有完整写入/);
});

function groupedOrder(prompt: string, groupEdge = true, empty = false) {
    const nodes = [
        { id: "cast", type: "group", title: "橘子", metadata: { assetKind: "character" as const } },
        ...(!empty
            ? [
                  { id: "profile", type: "text", title: "人物资料", metadata: { groupId: "cast", content: "橘子头，白帽" } },
                  { id: "portrait", type: "image", title: "正面", metadata: { groupId: "cast", content: "image" } },
              ]
            : []),
        { id: "shot", type: "config", title: "分镜", metadata: { generationMode: "image" as const, prompt } },
        { id: "output", type: "image", title: "结果", metadata: { role: "result-slot" as const, resultSlotSourceNodeId: "shot" } },
    ].map((node) => ({ ...node, position: { x: 0, y: 0 }, width: 320, height: 240 }));
    const connections = [{ id: "output-edge", fromNodeId: "shot", toNodeId: "output" }, ...(groupEdge ? [{ id: "input-edge", fromNodeId: "cast", toNodeId: "shot" }] : [])];
    return buildZodiacWorkOrder([{ type: "run_generation", nodeId: "shot" }], { nodes, connections });
}

test("a work order keeps one group input while disclosing its selected members", () => {
    const order = groupedOrder("参考 @[node:cast]");
    assert.deepEqual(order.issues, []);
    assert.deepEqual(order.steps[0].inputNodeIds, ["cast"]);
    assert.equal(order.steps[0].inputs?.length, 1);
    const input = order.steps[0].inputs?.[0];
    assert.equal(input?.selected, true);
    assert.equal(input?.assetKind, "character");
    assert.deepEqual(
        input?.members?.map((member) => [member.nodeId, member.selected]),
        [
            ["profile", true],
            ["portrait", true],
        ],
    );
});

test("member aliases resolve through an actual group edge without selecting siblings", () => {
    const order = groupedOrder("参考 @[node:portrait]");
    assert.deepEqual(order.issues, []);
    assert.equal(order.steps[0].inputs?.[0].selected, true);
    assert.deepEqual(
        order.steps[0].inputs?.[0].members?.map((member) => [member.nodeId, member.selected]),
        [
            ["profile", false],
            ["portrait", true],
        ],
    );
});

test("group connections without tokens select members but missing and empty groups stay invalid", () => {
    assert.equal(groupedOrder("保持人物设定").steps[0].inputs?.[0].selected, true);
    assert.ok(groupedOrder("参考 @[node:cast]", false).issues.some((issue) => issue.code === "missing_input"));
    assert.ok(groupedOrder("参考 @[node:cast]", true, true).issues.some((issue) => issue.code === "missing_input"));
});

test("work orders disclose effective group members and the group's own reference instruction", () => {
    const nodes = [
        { id: "cast", type: "group", title: "角色", metadata: { groupPrompt: "保持等高 @[node:portrait]" } },
        { id: "profile", type: "text", title: "资料", metadata: { groupId: "cast", content: "资料" } },
        { id: "portrait", type: "image", title: "主视觉", metadata: { groupId: "cast", content: "image" } },
        { id: "shot", type: "config", title: "分镜", metadata: { generationMode: "image" as const, prompt: "@[node:cast]" } },
    ].map((node) => ({ ...node, position: { x: 0, y: 0 } }));
    const order = buildZodiacWorkOrder([{ type: "update_node", id: "shot", metadata: { prompt: "@[node:cast]" } }], { nodes, connections: [{ fromNodeId: "cast", toNodeId: "shot" }] });
    assert.deepEqual(order.issues, []);
    assert.equal(order.steps[0].inputs?.[0].groupPrompt, "保持等高 @[node:portrait]");
    assert.deepEqual(
        order.steps[0].inputs?.[0].members?.map((member) => member.nodeId),
        ["portrait"],
    );
    assert.equal(order.steps[0].inputs?.[0].selected, true);
});

function groupedPreviewSnapshot() {
    return {
        projectId: "project",
        title: "角色预览",
        viewport: { x: 0, y: 0, k: 1 },
        selectedNodeIds: ["group", "nested", "portrait", "outside"],
        nodes: [
            { id: "group", type: "group", title: "角色", position: { x: 100, y: 200 }, width: 900, height: 600, metadata: {} },
            { id: "nested", type: "group", title: "视图", position: { x: 120, y: 240 }, width: 700, height: 500, metadata: { groupId: "group" } },
            { id: "portrait", type: "image", title: "主视觉", position: { x: 150, y: 280 }, width: 300, height: 400, metadata: { groupId: "nested", content: "image" } },
            { id: "outside", type: "text", title: "备注", position: { x: 1000, y: 200 }, width: 300, height: 240, metadata: { content: "备注" } },
        ],
        connections: [{ id: "output", fromNodeId: "portrait", toNodeId: "outside" }],
    };
}

test("work-order previews translate group descendants exactly like canvas apply", () => {
    const snapshot = groupedPreviewSnapshot();
    const before = structuredClone(snapshot);
    const ops = [{ type: "update_node", id: "group", patch: { position: { x: 300, y: 500 } } }];
    assert.deepEqual(applyWorkOrderOps(snapshot, ops), applyCanvasAgentOps(snapshot, ops));
    assert.deepEqual(snapshot, before);
});

test("work-order previews cascade group deletion through members, connections and selection", () => {
    const snapshot = groupedPreviewSnapshot();
    const ops = [{ type: "delete_node", id: "group" }];
    assert.deepEqual(applyWorkOrderOps(snapshot, ops), applyCanvasAgentOps(snapshot, ops));
    assert.deepEqual(
        applyWorkOrderOps(snapshot, ops).nodes.map((node: { id: string }) => node.id),
        ["outside"],
    );
});

test("work-order previews share group collapse defaults, explicit sizes and restored dimensions", () => {
    const snapshot = groupedPreviewSnapshot();
    const collapse = [{ type: "update_node", id: "group", patch: { width: 400 }, metadata: { groupCollapsed: true } }];
    const preview = applyWorkOrderOps(snapshot, collapse);
    const actual = applyCanvasAgentOps(snapshot, collapse);
    assert.deepEqual(preview, actual);
    assert.equal(preview.nodes[0].height, 240);
    const expand = [{ type: "update_node", id: "group", patch: { metadata: { groupCollapsed: false } } }];
    assert.deepEqual(applyWorkOrderOps(preview, expand), applyCanvasAgentOps(actual, expand));
    assert.equal(applyWorkOrderOps(preview, expand).nodes[0].width, 900);
});

test("new script and storyboard text nodes require authored body even without generation actions", () => {
    for (const metadata of [undefined, { prompt: "写一个 15 秒恋爱故事" }, { content: " \n\t", prompt: "已有创作指令" }]) {
        const order = buildZodiacWorkOrder([
            { type: "add_node", id: "script", nodeType: "text", title: "剧本", metadata },
            { type: "add_node", id: "storyboard", nodeType: "text", title: "分镜" },
        ]);
        assert.deepEqual(
            order.issues.filter((issue: { code: string }) => issue.code === "missing_content").map((issue: { nodeId: string }) => issue.nodeId),
            ["script", "storyboard"],
        );
        assert.ok(order.issues.every((issue: { message: string }) => /正文/.test(issue.message)));
    }
});

test("ordinary empty text references are unselected and block downstream assembly", () => {
    for (const prompt of ["按输入制作首帧", "参考 @[node:script]"]) {
        const nodes = [
            { id: "script", type: "text", title: "剧本", metadata: { prompt: "故事创作指令" } },
            { id: "shot", type: "config", title: "首帧", metadata: { generationMode: "image", prompt } },
        ].map((node) => ({ ...node, position: { x: 0, y: 0 } }));
        const order = buildZodiacWorkOrder([{ type: "update_node", id: "shot", metadata: { prompt } }], { nodes, connections: [{ fromNodeId: "script", toNodeId: "shot" }] });
        assert.ok(order.issues.some((issue: { code: string }) => issue.code === "missing_input"));
        assert.equal(order.steps[0].inputs[0].selected, false);
    }
});

test("a text result slot can wait only when its declared text writer is actually connected", () => {
    const ops = [
        { type: "add_node", id: "writer", nodeType: "config", title: "写剧本", metadata: { generationMode: "text", prompt: "写出完整剧本" } },
        { type: "add_node", id: "script", nodeType: "text", title: "剧本结果", metadata: { role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "writer", slotState: "empty" } },
        { type: "add_node", id: "shot", nodeType: "config", title: "首帧", metadata: { generationMode: "image", prompt: "@[node:script]" } },
        { type: "add_node", id: "frame", nodeType: "image", title: "首帧结果", metadata: { role: "result-slot", resultSlotSourceNodeId: "shot" } },
        { type: "connect_nodes", fromNodeId: "script", toNodeId: "shot" },
        { type: "connect_nodes", fromNodeId: "shot", toNodeId: "frame" },
    ];
    const connected = buildZodiacWorkOrder([...ops, { type: "connect_nodes", fromNodeId: "writer", toNodeId: "script" }]);
    assert.deepEqual(connected.issues, []);
    assert.equal(connected.steps.find((step: { nodeId: string }) => step.nodeId === "shot").inputs[0].selected, true);
    const disconnected = buildZodiacWorkOrder(ops);
    assert.ok(disconnected.issues.some((issue: { code: string; nodeId: string }) => issue.code === "missing_content" && issue.nodeId === "script"));
    assert.ok(disconnected.issues.some((issue: { code: string }) => issue.code === "missing_input"));
    const wrongMode = buildZodiacWorkOrder([...ops, { type: "update_node", id: "writer", metadata: { generationMode: "image" } }, { type: "connect_nodes", fromNodeId: "writer", toNodeId: "script" }]);
    assert.ok(wrongMode.issues.some((issue: { code: string; nodeId: string }) => issue.code === "missing_content" && issue.nodeId === "script"));
});

test("content checks inspect final proposal text and do not block unrelated old blank notes", () => {
    const snapshot = { nodes: [{ id: "old-note", type: "text", title: "空白笔记", position: { x: 0, y: 0 } }], connections: [] };
    const order = buildZodiacWorkOrder(
        [
            { type: "add_node", id: "script", nodeType: "text", title: "剧本", metadata: { prompt: "写剧本" } },
            { type: "update_node", id: "script", metadata: { content: "两位角色在公园相遇，交换点心并牵手离开。" } },
            { type: "add_node", id: "discarded", nodeType: "text", title: "空草稿" },
            { type: "delete_node", id: "discarded" },
        ],
        snapshot,
    );
    assert.deepEqual(order.issues, []);
});

test("whole-group input selection does not disguise an empty written character profile", () => {
    const nodes = [
        { id: "cast", type: "group", title: "角色", metadata: {} },
        { id: "profile", type: "text", title: "人物资料", metadata: { groupId: "cast", prompt: "定义人物性格" } },
        { id: "portrait", type: "image", title: "主视觉", metadata: { groupId: "cast", content: "image" } },
        { id: "shot", type: "config", title: "首帧", metadata: { generationMode: "image", prompt: "@[node:cast]" } },
    ].map((node) => ({ ...node, position: { x: 0, y: 0 } }));
    const order = buildZodiacWorkOrder([{ type: "update_node", id: "shot", metadata: { prompt: "@[node:cast]" } }], { nodes, connections: [{ fromNodeId: "cast", toNodeId: "shot" }] });
    assert.ok(order.issues.some((issue: { code: string }) => issue.code === "missing_input"));
    assert.equal(order.steps[0].inputs[0].selected, false);
});
