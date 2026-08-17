import assert from "node:assert/strict";
import test from "node:test";

import { buildCanvasWorkflowGraph } from "../src/lib/canvas/canvas-workflow-graph.ts";
import { createCanvasResultSlot } from "../src/lib/canvas/canvas-result-slots.ts";

const actionA = {
    id: "write",
    type: "config",
    title: "写分镜",
    position: { x: 0, y: 0 },
    width: 340,
    height: 240,
    metadata: { generationMode: "text", composerContent: "写三个镜头" },
} as const;
const actionB = {
    id: "video",
    type: "config",
    title: "生成视频",
    position: { x: 800, y: 0 },
    width: 340,
    height: 240,
    metadata: { generationMode: "video", composerContent: "使用分镜生成视频" },
} as const;

function fixture(ready = false) {
    let textSlot = createCanvasResultSlot({ id: "text-slot", mode: "text", sourceNodeId: "write", position: { x: 400, y: 0 } });
    if (ready) {
        textSlot = {
            ...textSlot,
            metadata: {
                ...textSlot.metadata,
                content: "分镜内容",
                status: "success",
                slotState: "ready",
                currentResultVersionId: "v1",
                resultVersions: [{ id: "v1", status: "success", artifacts: [{ id: "text-1", kind: "text", content: "分镜内容" }], primaryArtifactId: "text-1" }],
            },
        };
    }
    const videoSlot = createCanvasResultSlot({ id: "video-slot", mode: "video", sourceNodeId: "video", position: { x: 1200, y: 0 } });
    return {
        nodes: [actionA, textSlot, actionB, videoSlot],
        connections: [
            { id: "a-out", fromNodeId: "write", toNodeId: "text-slot" },
            { id: "a-b", fromNodeId: "text-slot", toNodeId: "video" },
            { id: "b-out", fromNodeId: "video", toNodeId: "video-slot" },
        ],
    };
}

test("compiles action-slot-action topology into one action DAG", () => {
    const result = buildCanvasWorkflowGraph(fixture());
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.nodes.map((node) => [node.id, node.data?.outputSlotId, node.checkpoint]), [
        ["write", "text-slot", true],
        ["video", "video-slot", true],
    ]);
    assert.deepEqual(result.graph.edges, [{ fromNodeId: "write", toNodeId: "video" }]);
});

test("starting from a middle action reuses a frozen ready upstream version", () => {
    const result = buildCanvasWorkflowGraph({ ...fixture(true), startNodeIds: ["video"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.nodes.map((node) => node.id), ["video"]);
    assert.deepEqual(result.graph.edges, []);
    assert.deepEqual(result.graph.nodes[0].data?.sourceSnapshot, [
        { sourceNodeId: "text-slot", sourceNodeType: "text", sourceActionNodeId: "write", versionId: "v1", resolution: "frozen" },
    ]);
});

test("starting from a middle action refuses an upstream slot that is not ready", () => {
    const result = buildCanvasWorkflowGraph({ ...fixture(false), startNodeIds: ["video"] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "pending_input" && issue.slotId === "text-slot"));
});
