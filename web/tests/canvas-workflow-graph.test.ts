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
    assert.deepEqual(
        result.graph.nodes.map((node) => [node.id, node.data?.outputSlotId, node.checkpoint]),
        [
            ["write", "text-slot", true],
            ["video", "video-slot", true],
        ],
    );
    assert.deepEqual(result.graph.edges, [{ fromNodeId: "write", toNodeId: "video" }]);
});

test("starting from a middle action reuses a frozen ready upstream version", () => {
    const result = buildCanvasWorkflowGraph({ ...fixture(true), startNodeIds: ["video"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
        result.graph.nodes.map((node) => node.id),
        ["video"],
    );
    assert.deepEqual(result.graph.edges, []);
    assert.deepEqual(result.graph.nodes[0].data?.sourceSnapshot, [{ sourceNodeId: "text-slot", sourceNodeType: "text", sourceActionNodeId: "write", versionId: "v1", resolution: "frozen" }]);
});

test("starting from a middle action refuses an upstream slot that is not ready", () => {
    const result = buildCanvasWorkflowGraph({ ...fixture(false), startNodeIds: ["video"] });
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "pending_input" && issue.slotId === "text-slot"));
});

function groupedFixture(ready = false) {
    const base = fixture(ready);
    const group = { id: "character", type: "group", title: "人物", position: { x: 0, y: 0 }, width: 600, height: 400 };
    const nested = { ...group, id: "character-views", metadata: { groupId: group.id } };
    const portrait = { ...group, id: "portrait", type: "image", metadata: { groupId: nested.id, content: "data:image/png;base64,YQ==", status: "success" } };
    return {
        nodes: [...base.nodes.map((node) => (node.id === "text-slot" ? { ...node, metadata: { ...node.metadata, groupId: group.id } } : node)), group, nested, portrait],
        connections: [...base.connections.filter((edge) => edge.id !== "a-b"), { id: "character-video", fromNodeId: group.id, toNodeId: "video" }],
    };
}

test("group-only result-slot inputs schedule the producer and retain every leaf binding", () => {
    const result = buildCanvasWorkflowGraph({ ...groupedFixture(), startNodeIds: ["write"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(
        result.graph.nodes.map((node) => node.id),
        ["write", "video"],
    );
    assert.deepEqual(result.graph.edges, [{ fromNodeId: "write", toNodeId: "video" }]);
    const sources = result.graph.nodes.find((node) => node.id === "video")?.data?.sourceSnapshot;
    assert.deepEqual(
        sources?.map((source) => source.sourceNodeId),
        ["text-slot", "portrait"],
    );
    assert.ok(sources?.every((source) => source.bindingNodeIds?.includes("character")));
    assert.equal(sources?.find((source) => source.sourceNodeId === "text-slot")?.resolution, "workflow");
});

test("a group and a direct member edge do not duplicate workflow dependencies or frozen sources", () => {
    const canvas = groupedFixture(true);
    canvas.connections.push({ id: "also-direct", fromNodeId: "text-slot", toNodeId: "video" });
    const result = buildCanvasWorkflowGraph(canvas);
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.equal(result.graph.edges.length, 1);
    assert.equal(result.graph.nodes.find((node) => node.id === "video")?.data?.sourceSnapshot.length, 2);
});

test("an empty input group cannot compile as an unresolvable frozen group id", () => {
    const canvas = fixture();
    canvas.nodes.push({ ...actionA, id: "empty", type: "group", metadata: {} });
    canvas.connections.push({ id: "empty-input", fromNodeId: "empty", toNodeId: "video" });
    const result = buildCanvasWorkflowGraph(canvas);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "pending_input" && issue.relatedNodeIds?.includes("empty")));
});

test("a group containing the target's own output is detected as a workflow cycle", () => {
    const canvas = groupedFixture(true);
    canvas.nodes = canvas.nodes.map((node) => (node.id === "video-slot" ? { ...node, metadata: { ...node.metadata, groupId: "character" } } : node));
    const result = buildCanvasWorkflowGraph(canvas);
    assert.equal(result.ok, false);
    if (result.ok) return;
    assert.ok(result.issues.some((issue) => issue.code === "workflow_cycle"));
});

test("group prompts freeze as virtual text and unselected result members add no dependency", () => {
    const canvas = groupedFixture(true);
    canvas.nodes = canvas.nodes.map((node) => (node.id === "character" ? { ...node, metadata: { groupPrompt: "使用 @[node:portrait]" } } : node));
    const result = buildCanvasWorkflowGraph({ ...canvas, startNodeIds: ["video"] });
    assert.equal(result.ok, true);
    if (!result.ok) return;
    assert.deepEqual(result.graph.edges, []);
    assert.deepEqual(
        result.graph.nodes[0].data?.sourceSnapshot.map((source) => [source.sourceNodeId, source.sourceNodeType]),
        [
            ["character", "text"],
            ["portrait", "image"],
        ],
    );
});
