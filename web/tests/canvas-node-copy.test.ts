import assert from "node:assert/strict";
import test from "node:test";
import { remapCanvasNodeReferences } from "../src/lib/canvas/canvas-node-copy.ts";

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
