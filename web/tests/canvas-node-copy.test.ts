import assert from "node:assert/strict";
import test from "node:test";
import { isCanvasNodeRunning, remapCanvasNodeReferences, sanitizeCanvasNodeForCopy } from "../src/lib/canvas/canvas-node-copy.ts";

test("copy remaps whole-group prompts, member references and result ownership without changing original", () => {
    const node = {
        id: "copy",
        type: "group",
        title: "role",
        position: { x: 0, y: 0 },
        width: 1,
        height: 1,
        metadata: { groupId: "parent", groupPrompt: "角色 @[node:photo]", composerContent: "@[node:group] 和 @[node:outside]", resultSlotSourceNodeId: "action", batchChildIds: ["photo"] },
    };
    const result = remapCanvasNodeReferences(
        node,
        new Map([
            ["photo", "photo-copy"],
            ["group", "group-copy"],
            ["action", "action-copy"],
        ]),
    );
    assert.equal(result.metadata.groupPrompt, "角色 @[node:photo-copy]");
    assert.equal(result.metadata.composerContent, "@[node:group-copy] 和 @[node:outside]");
    assert.equal(result.metadata.resultSlotSourceNodeId, "action-copy");
    assert.equal(result.metadata.groupId, undefined);
    assert.deepEqual(result.metadata.batchChildIds, ["photo-copy"]);
    assert.equal(node.metadata.groupPrompt, "角色 @[node:photo]");
});

test("running and uncertain video nodes cannot be copied, and their copied state is sanitized", () => {
    const running = { id: "video", type: "video", title: "视频", position: { x: 0, y: 0 }, width: 1, height: 1, metadata: { status: "loading", videoTask: { id: "task", provider: "minimax", model: "MiniMax-H3", state: "unknown", createdAt: "2026-09-26T00:00:00.000Z", updatedAt: "2026-09-26T00:01:00.000Z" }, errorDetails: "查询中断" } };
    assert.equal(isCanvasNodeRunning(running), true);
    const copied = sanitizeCanvasNodeForCopy({ ...running, metadata: { ...running.metadata, status: "success", content: "/media/video" } });
    assert.equal(copied.metadata?.videoTask, undefined);
    assert.equal(copied.metadata?.errorDetails, undefined);
    assert.equal(copied.metadata?.status, "success");
});
