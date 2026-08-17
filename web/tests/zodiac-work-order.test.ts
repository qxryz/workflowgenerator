import assert from "node:assert/strict";
import test from "node:test";

import { assertZodiacWorkOrderApplied, buildZodiacWorkOrder } from "../src/lib/agent/zodiac-work-order.ts";
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
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "image", nodeType: "config", title: "生成首帧", metadata: { generationMode: "image" } },
    ]);
    const order = buildZodiacWorkOrder(proposal.ops);
    assert.ok(order.issues.some((issue) => issue.code === "missing_prompt"));
});

test("post-apply verification catches a prompt that was not assembled", () => {
    const proposal = prepareZodiacToolProposal([
        { type: "add_node", id: "image", nodeType: "config", title: "生成首帧", metadata: { generationMode: "image", prompt: "完整提示词" } },
    ]);
    const order = buildZodiacWorkOrder(proposal.ops);
    const nodes = proposal.ops.flatMap((op) => op.type === "add_node" && op.id ? [{
        id: op.id,
        type: op.nodeType || "text",
        title: op.title || "",
        position: op.position || { x: 0, y: 0 },
        width: op.width || 360,
        height: op.height || 240,
        metadata: op.metadata?.role === "result-slot" ? op.metadata : { ...op.metadata, prompt: "" },
    }] : []);
    const connections = proposal.ops.flatMap((op, index) => op.type === "connect_nodes" ? [{ id: op.id || `link-${index}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }] : []);
    assert.throws(() => assertZodiacWorkOrderApplied(order, { nodes, connections }), /创作内容没有完整写入/);
});
