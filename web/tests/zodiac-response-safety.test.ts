import assert from "node:assert/strict";
import test from "node:test";

import { claimsUnexecutedCanvasAction } from "../src/lib/agent/zodiac-response-safety.ts";

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
