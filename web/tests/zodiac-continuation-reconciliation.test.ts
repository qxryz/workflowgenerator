import assert from "node:assert/strict";
import test from "node:test";

import { isZodiacContinuationRequest, reconcileZodiacContinuationOps } from "../src/lib/agent/zodiac-continuation-reconciliation.ts";
import type { CanvasAgentOp } from "../src/lib/canvas/canvas-agent-ops.ts";

const existing = [
    { id: "existing-frame", type: "config", title: "生成首帧", metadata: { generationMode: "image", prompt: "香港夜景高楼间飞行" } },
    { id: "existing-frame-result", type: "image", title: "首帧结果", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "existing-frame" } },
];
const existingConnections = [{ fromNodeId: "existing-frame", toNodeId: "existing-frame-result" }];
const proposed: CanvasAgentOp[] = [
    { type: "add_node", id: "new-frame", nodeType: "config", title: "首帧生成配置节点", metadata: { generationMode: "image" } },
    { type: "add_node", id: "new-frame-result", nodeType: "image", title: "图片结果槽", metadata: { role: "result-slot", resultSlotMode: "image", resultSlotSourceNodeId: "new-frame" } },
    { type: "add_node", id: "new-video", nodeType: "config", title: "生成视频", metadata: { generationMode: "video", prompt: "让首帧动起来" } },
    { type: "add_node", id: "new-video-result", nodeType: "video", title: "视频结果槽", metadata: { role: "result-slot", resultSlotMode: "video", resultSlotSourceNodeId: "new-video" } },
    { type: "connect_nodes", fromNodeId: "new-frame", toNodeId: "new-frame-result" },
    { type: "connect_nodes", fromNodeId: "new-frame-result", toNodeId: "new-video" },
    { type: "connect_nodes", fromNodeId: "new-video", toNodeId: "new-video-result" },
];

test("short acknowledgements are continuation intents", () => {
    assert.equal(isZodiacContinuationRequest("好了"), true);
    assert.equal(isZodiacContinuationRequest("可以下一步了"), true);
    assert.equal(isZodiacContinuationRequest("再做一套相同工作流"), false);
});

test("continuation reuses a populated existing stage and adds only the missing stage", () => {
    const result = reconcileZodiacContinuationOps(proposed, "好了", existing, existingConnections);
    assert.equal(result.some((op) => op.type === "add_node" && op.id === "new-frame"), false);
    assert.equal(result.some((op) => op.type === "add_node" && op.id === "new-frame-result"), false);
    assert.equal(result.some((op) => op.type === "add_node" && op.id === "new-video"), true);
    assert.equal(result.some((op) => op.type === "connect_nodes" && op.fromNodeId === "existing-frame-result" && op.toNodeId === "new-video"), true);
});

test("a fully duplicated continuation becomes a no-op instead of another workflow", () => {
    const first = reconcileZodiacContinuationOps(proposed, "下一步", existing, existingConnections);
    const addedNodes = first.filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node");
    const allNodes = [...existing, ...addedNodes.map((op) => ({ id: op.id!, type: op.nodeType!, title: op.title, metadata: op.metadata as Record<string, unknown> }))];
    const allConnections = [...existingConnections, ...first.filter((op): op is Extract<CanvasAgentOp, { type: "connect_nodes" }> => op.type === "connect_nodes")];
    assert.deepEqual(reconcileZodiacContinuationOps(proposed, "可以下一步了", allNodes, allConnections), []);
});
