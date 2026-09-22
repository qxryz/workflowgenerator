import assert from "node:assert/strict";
import test from "node:test";
import { mergeCanvasValues } from "../src/lib/canvas/canvas-save-merge.ts";
const base = { id: "p", nodes: [{ id: "n", x: 0, metadata: { content: "old", title: "text" } }], connections: [] };
test("stale text cannot overwrite a newer tab; unrelated position survives", () => {
    const local = structuredClone(base); local.nodes[0].x = 50; local.nodes[0].metadata.content = "stale edit";
    const remote = structuredClone(base); remote.nodes[0].metadata.content = "new committed text";
    const result = mergeCanvasValues(base, local, remote);
    assert.equal(result.value.nodes[0].metadata.content, "new committed text");
    assert.equal(result.value.nodes[0].x, 50);
    assert.deepEqual(result.conflicts, ["nodes[n].metadata.content"]);
});
test("a stale normal save merges without restoring old text", () => {
    const local = structuredClone(base); local.nodes[0].x = 50;
    const remote = structuredClone(base); remote.nodes[0].metadata.content = "new committed text";
    const result = mergeCanvasValues(base, local, remote);
    assert.equal(result.value.nodes[0].metadata.content, "new committed text");
    assert.equal(result.value.nodes[0].x, 50);
    assert.deepEqual(result.conflicts, []);
});
test("independent node additions survive and concurrent deletion cannot resurrect content", () => {
    const local = structuredClone(base); local.nodes.push({ id: "l", x: 1, metadata: { content: "local", title: "l" } });
    const remote = structuredClone(base); remote.nodes.push({ id: "r", x: 2, metadata: { content: "remote", title: "r" } });
    assert.deepEqual(mergeCanvasValues(base, local, remote).value.nodes.map((node) => node.id), ["n", "r", "l"]);
    const edited = structuredClone(base); edited.nodes[0].metadata.content = "unsaved";
    const deleted = { ...base, nodes: [] };
    const result = mergeCanvasValues(base, edited, deleted);
    assert.deepEqual(result.value.nodes, []);
    assert.deepEqual(result.conflicts, ["nodes[n]"]);
});
