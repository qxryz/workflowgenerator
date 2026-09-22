import assert from "node:assert/strict";
import test from "node:test";
import { getCanvasGroupMembers, getCanvasInputSources, expandCanvasGroupSelection } from "../src/lib/canvas/canvas-group-inputs.ts";

const node = (id: string, type = "image", groupId?: string) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { groupId } });
test("groups resolve nested resources once, including audio/files, but no executable config", () => {
    const nodes = [node("role", "group"), node("text", "text", "role"), node("sub", "group", "role"), node("photo", "image", "sub"), node("voice", "audio", "role"), node("doc", "file", "role"), node("action", "config", "role")];
    assert.deepEqual(
        getCanvasGroupMembers("role", nodes).map((n) => n.id),
        ["text", "photo", "voice", "doc"],
    );
    const inputs = getCanvasInputSources("next", nodes, [
        { fromNodeId: "role", toNodeId: "next" },
        { fromNodeId: "photo", toNodeId: "next" },
    ]);
    assert.equal(inputs.length, 4);
    assert.deepEqual(inputs[1].bindingNodeIds, ["role", "sub"]);
    assert.deepEqual([...expandCanvasGroupSelection(new Set(["role"]), nodes)], ["role", "text", "sub", "photo", "voice", "doc", "action"]);
});
test("empty or cyclic membership is bounded and leaves an unresolved group", () => {
    const nodes = [node("a", "group", "b"), node("b", "group", "a")];
    assert.deepEqual(getCanvasGroupMembers("a", nodes), []);
    assert.equal(getCanvasInputSources("next", nodes, [{ fromNodeId: "a", toNodeId: "next" }])[0].node.id, "a");
});
test("spatial overlap and upstream siblings do not join a group input", () => {
    const nodes = [node("group", "group"), node("photo", "image", "group"), node("stranger")];
    const inputs = getCanvasInputSources("next", nodes, [
        { fromNodeId: "group", toNodeId: "next" },
        { fromNodeId: "stranger", toNodeId: "photo" },
    ]);
    assert.deepEqual(
        inputs.map(({ node }) => node.id),
        ["photo"],
    );
});

test("ordinary groups retain their empty-prompt aggregation contract", () => {
    const group = { ...node("group", "group"), metadata: { groupPrompt: "" } };
    const inputs = getCanvasInputSources("next", [group, node("photo", "image", "group")], [{ fromNodeId: "group", toNodeId: "next" }]);
    assert.deepEqual(
        inputs.map(({ node }) => node.id),
        ["photo"],
    );
});
