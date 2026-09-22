import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { build } from "esbuild";

const bundle = await build({
    entryPoints: [path.resolve("src/lib/canvas/canvas-agent-ops.ts")],
    bundle: true,
    write: false,
    platform: "node",
    format: "esm",
    alias: { "@": path.resolve("src") },
});
const { applyCanvasAgentOps } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const node = (id, type, x, y, metadata = {}) => ({ id, type, title: id, position: { x, y }, width: 900, height: 600, metadata });
function fixture() {
    return {
        projectId: "project",
        title: "组操作",
        viewport: { x: 0, y: 0, k: 1 },
        selectedNodeIds: ["group", "nested", "portrait", "outside"],
        nodes: [
            node("group", "group", 100, 200),
            node("nested", "group", 150, 250, { groupId: "group" }),
            node("portrait", "image", 170, 290, { groupId: "nested" }),
            node("writer", "config", 190, 310, { groupId: "group", generationMode: "image" }),
            node("outside", "text", 500, 600),
        ],
        connections: [
            { id: "member-to-outside", fromNodeId: "portrait", toNodeId: "outside" },
            { id: "group-to-writer", fromNodeId: "group", toNodeId: "writer" },
            { id: "outside-loop", fromNodeId: "outside", toNodeId: "outside" },
        ],
    };
}

test("moving a group translates all explicit descendants once and does not follow wires", () => {
    const current = fixture();
    const before = structuredClone(current);
    const next = applyCanvasAgentOps(current, [{ type: "update_node", id: "group", patch: { position: { x: 350, y: 100 } } }]);
    assert.deepEqual(
        next.nodes.map((item) => [item.id, item.position]),
        [
            ["group", { x: 350, y: 100 }],
            ["nested", { x: 400, y: 150 }],
            ["portrait", { x: 420, y: 190 }],
            ["writer", { x: 440, y: 210 }],
            ["outside", { x: 500, y: 600 }],
        ],
    );
    assert.deepEqual(current, before);
    assert.deepEqual(next.connections, current.connections);
    const repeated = applyCanvasAgentOps(next, [{ type: "update_node", id: "group", patch: { position: { x: 350, y: 100 } } }]);
    assert.deepEqual(repeated, next);
});

test("deleting a group removes recursive descendants, their wires and selected ids only", () => {
    const current = fixture();
    const before = structuredClone(current);
    const next = applyCanvasAgentOps(current, [{ type: "delete_node", id: "group" }]);
    assert.deepEqual(
        next.nodes.map((item) => item.id),
        ["outside"],
    );
    assert.deepEqual(
        next.connections.map((edge) => edge.id),
        ["outside-loop"],
    );
    assert.deepEqual(next.selectedNodeIds, ["outside"]);
    assert.deepEqual(current, before);
});

test("type-based group deletion and malformed membership cycles terminate without orphaning descendants", () => {
    const current = fixture();
    current.nodes[0].metadata.groupId = "nested";
    const moved = applyCanvasAgentOps(current, [{ type: "update_node", id: "group", patch: { position: { x: 110, y: 210 } } }]);
    assert.deepEqual(moved.nodes.find((item) => item.id === "portrait").position, { x: 180, y: 300 });
    assert.deepEqual(moved.nodes.find((item) => item.id === "group").position, { x: 110, y: 210 });
    const deleted = applyCanvasAgentOps(current, [{ type: "delete_node", nodeType: "group" }]);
    assert.deepEqual(
        deleted.nodes.map((item) => item.id),
        ["outside"],
    );
});

test("collapsing a group saves expanded dimensions and expansion restores them", () => {
    const current = fixture();
    current.nodes[0].metadata.assetKind = "character";
    const collapsed = applyCanvasAgentOps(current, [{ type: "update_node", id: "group", metadata: { groupCollapsed: true } }]);
    const compactGroup = collapsed.nodes[0];
    assert.equal(compactGroup.width, 320);
    assert.equal(compactGroup.height, 240);
    assert.deepEqual(compactGroup.metadata, { assetKind: "character", groupCollapsed: true, groupExpandedWidth: 900, groupExpandedHeight: 600 });
    assert.deepEqual(collapsed.nodes.slice(1), current.nodes.slice(1));
    const unchanged = applyCanvasAgentOps(collapsed, [{ type: "update_node", id: "group", metadata: { groupCollapsed: true, groupPrompt: "人物设定" } }]);
    assert.equal(unchanged.nodes[0].metadata.groupExpandedWidth, 900);
    const expanded = applyCanvasAgentOps(unchanged, [{ type: "update_node", id: "group", patch: { metadata: { groupCollapsed: false } } }]);
    assert.equal(expanded.nodes[0].width, 900);
    assert.equal(expanded.nodes[0].height, 600);
    assert.equal(expanded.nodes[0].metadata.groupPrompt, "人物设定");
    assert.equal(expanded.nodes[0].metadata.groupCollapsed, false);
});

test("explicit sizes override toggle defaults and combined moves keep member offsets", () => {
    const current = fixture();
    const collapsed = applyCanvasAgentOps(current, [{ type: "update_node", id: "group", patch: { width: 400, position: { x: 130, y: 260 }, metadata: { groupCollapsed: true } } }]);
    assert.equal(collapsed.nodes[0].width, 400);
    assert.equal(collapsed.nodes[0].height, 240);
    assert.equal(collapsed.nodes[0].metadata.groupExpandedWidth, 900);
    assert.deepEqual(collapsed.nodes[2].position, { x: 200, y: 350 });
    const expanded = applyCanvasAgentOps(collapsed, [{ type: "update_node", id: "group", patch: { height: 720 }, metadata: { groupCollapsed: false } }]);
    assert.equal(expanded.nodes[0].width, 900);
    assert.equal(expanded.nodes[0].height, 720);
});

test("ordinary member edits stay local and never collapse or move their group", () => {
    const current = fixture();
    const edited = applyCanvasAgentOps(current, [{ type: "update_node", id: "portrait", patch: { position: { x: 0, y: 0 }, width: 111 }, metadata: { groupCollapsed: true } }]);
    assert.equal(edited.nodes[2].width, 111);
    assert.equal(edited.nodes[2].height, 600);
    assert.deepEqual(edited.nodes[1].position, current.nodes[1].position);
    assert.equal(edited.nodes[0].metadata?.groupCollapsed, undefined);
});
