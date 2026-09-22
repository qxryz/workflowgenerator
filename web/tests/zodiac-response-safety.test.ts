import assert from "node:assert/strict";
import test from "node:test";

import { claimsUnexecutedCanvasAction, isCanvasRecapConfirmation } from "../src/lib/agent/zodiac-response-safety.ts";

test("detects promises and claims that require a real canvas proposal", () => {
    assert.equal(claimsUnexecutedCanvasAction("我现在把第一步的两个节点添加到画布上。"), true);
    assert.equal(claimsUnexecutedCanvasAction("已经为你创建了 3 个工作流节点。"), true);
    assert.equal(claimsUnexecutedCanvasAction("操作指令：↓"), true);
});

test("keeps ordinary guidance and capability explanations", () => {
    assert.equal(claimsUnexecutedCanvasAction("你可以在确认后把方案加入画布。"), false);
    assert.equal(claimsUnexecutedCanvasAction("画布节点支持图片、视频和文本。"), false);
    assert.equal(claimsUnexecutedCanvasAction("先选一个视觉方向。"), false);
});


const recapHistory: Parameters<typeof isCanvasRecapConfirmation>[0] = [
    { id: "original", role: "user", text: "创建介绍节点" },
    { id: "receipt", role: "tool", text: "", tool: { status: "applied", resolvedOps: [{ type: "add_node", id: "intro" }] } },
    { id: "read-only", role: "user", text: "不要再修改画布，只给我一个连接检查确认。" },
    { id: "confirmation", role: "assistant", text: "", decision: { ui: { id: "check", type: "confirm_summary", question: "连接是否正常？", summary: ["连接检查完成"] } } },
];

test("native read-only acknowledgement can recap a previously applied receipt still on the canvas", () => {
    const allowAppliedRecap = isCanvasRecapConfirmation(recapHistory, "confirmation", [{ id: "intro" }]);
    assert.equal(allowAppliedRecap, true);
    assert.equal(claimsUnexecutedCanvasAction("之前已经创建了介绍节点。", { allowAppliedRecap }), false);
    assert.equal(claimsUnexecutedCanvasAction("已经为你创建了介绍节点。", { allowAppliedRecap }), false);
    assert.equal(claimsUnexecutedCanvasAction("我现在把新节点加入画布。", { allowAppliedRecap }), true);
    assert.equal(claimsUnexecutedCanvasAction("这次已经额外创建了一个节点。", { allowAppliedRecap }), true);
    assert.equal(claimsUnexecutedCanvasAction("已经创建了另一个节点。", { allowAppliedRecap }), true);
});

test("a historical receipt alone cannot authorize a recap exemption", () => {
    assert.equal(isCanvasRecapConfirmation(recapHistory, undefined, [{ id: "intro" }]), false);
    assert.equal(isCanvasRecapConfirmation(recapHistory, "confirmation", []), false);
    assert.equal(isCanvasRecapConfirmation(recapHistory.filter((item) => item.id !== "receipt"), "confirmation", [{ id: "intro" }]), false);
    assert.equal(isCanvasRecapConfirmation(recapHistory.map((item) => item.id === "receipt" ? { ...item, tool: { ...item.tool!, status: "failed" } } : item), "confirmation", [{ id: "intro" }]), false);
    assert.equal(isCanvasRecapConfirmation(recapHistory.map((item) => item.id === "read-only" ? { ...item, text: "继续搭建工作流" } : item), "confirmation", [{ id: "intro" }]), false);
    assert.equal(claimsUnexecutedCanvasAction("已经创建了介绍节点。"), true);
});

test("confirmations authorizing a new mutation retain missing-proposal protection", () => {
    const newWork = recapHistory.map((item) => item.id === "confirmation" ? { ...item, decision: { ui: { id: "new", type: "confirm_summary" as const, question: "是否创建节点？", summary: ["添加新的介绍节点"] } } } : item);
    const allowAppliedRecap = isCanvasRecapConfirmation(newWork, "confirmation", [{ id: "intro" }]);
    assert.equal(allowAppliedRecap, false);
    assert.equal(claimsUnexecutedCanvasAction("已经创建了介绍节点。", { allowAppliedRecap }), true);
});
