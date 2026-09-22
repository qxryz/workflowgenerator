import assert from "node:assert/strict";
import test from "node:test";
import { normalizeZodiacCanvasOps, prepareZodiacToolProposal } from "../src/lib/agent/zodiac-tool-proposal.ts";

test("provider group metadata preserves the reference prompt and compact presentation", () => {
    const metadata = { groupPrompt: "角色设定：\n  @[node:portrait] ", assetKind: "character", groupCollapsed: true, groupExpandedWidth: 920, groupExpandedHeight: 740 };
    const ops = normalizeZodiacCanvasOps([{ type: "add_node", id: "role", nodeType: "group", metadata }]);
    assert.deepEqual(ops[0]?.metadata, metadata);
    const prepared = prepareZodiacToolProposal(ops);
    assert.equal(prepared.ops.find((op) => op.type === "add_node" && op.id === "role")?.metadata?.groupPrompt, metadata.groupPrompt);
});

test("clearing a group prompt is preserved while malformed group settings are discarded", () => {
    const ops = normalizeZodiacCanvasOps([{ type: "update_node", id: "role", metadata: { groupPrompt: "", assetKind: "unknown", groupCollapsed: "true", groupExpandedWidth: -20, groupExpandedHeight: Infinity } }]);
    assert.deepEqual(ops[0]?.metadata, { groupPrompt: "" });
});

test("group prompt member references follow colliding and forward node IDs", () => {
    const proposal = prepareZodiacToolProposal(
        [
            { type: "add_node", id: "role", nodeType: "group", metadata: { groupPrompt: "外观 @[node:portrait]" } },
            { type: "add_node", id: "portrait", nodeType: "image", metadata: { groupId: "role", content: "data:image/png;base64,new" } },
            { type: "update_node", id: "role", metadata: { groupPrompt: "保留 @[node:portrait]" } },
        ],
        [{ id: "portrait", type: "image", metadata: { content: "data:image/png;base64,old" } }],
    );
    const portrait = proposal.ops.find((op) => op.type === "add_node" && op.nodeType === "image");
    assert.notEqual(portrait?.id, "portrait");
    assert.equal(proposal.ops.find((op) => op.type === "add_node" && op.id === "role")?.metadata?.groupPrompt, `外观 @[node:${portrait?.id}]`);
    assert.equal(proposal.ops.find((op) => op.type === "update_node" && op.id === "role")?.metadata?.groupPrompt, `保留 @[node:${portrait?.id}]`);
});

test("result slot migration updates reference prompts already saved on groups", () => {
    const proposal = prepareZodiacToolProposal(
        [{ type: "run_generation", nodeId: "story", mode: "text" }],
        [
            { id: "role", type: "group", metadata: { groupPrompt: "设定 @[node:old]" } },
            { id: "story", type: "config", metadata: { generationMode: "text", groupId: "role" } },
            { id: "old", type: "text", metadata: { groupId: "role", role: "result-slot", resultSlotMode: "text", resultSlotSourceNodeId: "story", slotState: "empty", resultVersions: [] } },
            {
                id: "ready",
                type: "text",
                metadata: {
                    groupId: "role",
                    role: "result-slot",
                    resultSlotMode: "text",
                    resultSlotSourceNodeId: "story",
                    slotState: "ready",
                    status: "success",
                    content: "设定",
                    currentResultVersionId: "v1",
                    resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "t1", artifacts: [{ id: "t1", kind: "text", content: "设定" }] }],
                },
            },
        ],
        [
            { id: "story-old", fromNodeId: "story", toNodeId: "old" },
            { id: "story-ready", fromNodeId: "story", toNodeId: "ready" },
        ],
    );
    assert.equal(proposal.ops.find((op) => op.type === "update_node" && op.id === "role")?.metadata?.groupPrompt, "设定 @[node:ready]");
});

test("deleting a group freezes recursive members and excludes deleted generation actions", () => {
    const proposal = prepareZodiacToolProposal(
        [
            { type: "delete_node", id: "role" },
            { type: "run_generation", nodeId: "inner-render", mode: "image" },
        ],
        [
            { id: "role", type: "group" },
            { id: "nested", type: "group", metadata: { groupId: "role" } },
            { id: "inner-render", type: "config", metadata: { groupId: "nested", generationMode: "image" } },
            { id: "portrait", type: "image", metadata: { groupId: "role" } },
            { id: "outside", type: "config", metadata: { generationMode: "video" } },
        ],
        [{ id: "external", fromNodeId: "portrait", toNodeId: "outside" }],
    );
    const deletion = proposal.ops.find((op) => op.type === "delete_node");
    assert.deepEqual(new Set(deletion?.ids), new Set(["role", "nested", "inner-render", "portrait"]));
    assert.equal(
        proposal.ops.some((op) => op.type === "run_generation"),
        false,
    );
    assert.deepEqual(proposal.bindings, []);
});

test("deleting a group cannot bypass unavailable plugin boundaries through membership", () => {
    const proposal = prepareZodiacToolProposal(
        [{ type: "delete_node", id: "role" }],
        [
            { id: "role", type: "group" },
            { id: "disabled-plugin", type: "uninstalled:private", metadata: { groupId: "role" } },
        ],
    );
    assert.deepEqual(proposal.ops, []);
});

test("group deletion snapshots the current membership after moves between groups", () => {
    const proposal = prepareZodiacToolProposal(
        [
            { type: "update_node", id: "portrait", metadata: { groupId: "saved" } },
            { type: "delete_node", id: "role" },
        ],
        [
            { id: "role", type: "group" },
            { id: "saved", type: "group" },
            { id: "portrait", type: "image", metadata: { groupId: "role" } },
            { id: "profile", type: "text", metadata: { groupId: "role", content: "设定" } },
        ],
    );
    assert.deepEqual(proposal.ops.find((op) => op.type === "delete_node")?.ids, ["role", "profile"]);
});

test("deleting a whole group does not resurrect its completed results as orphaned assets", () => {
    const proposal = prepareZodiacToolProposal(
        [{ type: "delete_node", id: "role" }],
        [
            { id: "role", type: "group" },
            { id: "render", type: "config", metadata: { groupId: "role", generationMode: "text" } },
            {
                id: "result",
                type: "text",
                metadata: {
                    groupId: "role",
                    role: "result-slot",
                    resultSlotSourceNodeId: "render",
                    resultSlotMode: "text",
                    slotState: "ready",
                    status: "success",
                    content: "设定",
                    currentResultVersionId: "v1",
                    resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "t1", artifacts: [{ id: "t1", kind: "text", content: "设定" }] }],
                },
            },
        ],
        [{ id: "render-result", fromNodeId: "render", toNodeId: "result" }],
    );
    assert.ok(proposal.ops.some((op) => op.type === "delete_node"));
    assert.equal(
        proposal.ops.some((op) => op.type === "add_node"),
        false,
    );
});

test("new result slots remain members of their generation action's group", () => {
    const proposal = prepareZodiacToolProposal(
        [{ type: "run_generation", nodeId: "render", mode: "text" }],
        [
            { id: "role", type: "group" },
            { id: "render", type: "config", metadata: { groupId: "role", generationMode: "text" } },
        ],
    );
    const result = proposal.ops.find((op) => op.type === "add_node" && op.metadata?.role === "result-slot");
    assert.equal(result?.metadata?.groupId, "role");
});

test("forward group ownership follows the new group when its declared ID already exists", () => {
    const proposal = prepareZodiacToolProposal(
        [
            { type: "add_node", id: "portrait", nodeType: "image", metadata: { groupId: "role", content: "data:image/png;base64,new" } },
            { type: "add_node", id: "role", nodeType: "group", metadata: { groupPrompt: "外观 @[node:portrait]" } },
        ],
        [{ id: "role", type: "group" }],
    );
    const group = proposal.ops.find((op) => op.type === "add_node" && op.nodeType === "group");
    const portrait = proposal.ops.find((op) => op.type === "add_node" && op.id === "portrait");
    assert.notEqual(group?.id, "role");
    assert.equal(portrait?.metadata?.groupId, group?.id);
});

test("a completed result moved into a group before deletion is not resurrected", () => {
    const proposal = prepareZodiacToolProposal(
        [
            { type: "update_node", id: "result", metadata: { groupId: "role" } },
            { type: "delete_node", id: "role" },
        ],
        [
            { id: "role", type: "group" },
            { id: "render", type: "config", metadata: { groupId: "role", generationMode: "text" } },
            {
                id: "result",
                type: "text",
                metadata: {
                    role: "result-slot",
                    resultSlotSourceNodeId: "render",
                    resultSlotMode: "text",
                    slotState: "ready",
                    status: "success",
                    content: "设定",
                    currentResultVersionId: "v1",
                    resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "t1", artifacts: [{ id: "t1", kind: "text", content: "设定" }] }],
                },
            },
        ],
        [{ id: "render-result", fromNodeId: "render", toNodeId: "result" }],
    );
    assert.ok(proposal.ops.some((op) => op.type === "delete_node"));
    assert.equal(
        proposal.ops.some((op) => op.type === "add_node"),
        false,
    );
});
