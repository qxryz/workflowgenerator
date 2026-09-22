import assert from "node:assert/strict";
import test from "node:test";

import { getCanvasPromptInputs, resolveCanvasInputBindings } from "../src/lib/canvas/canvas-input-bindings.ts";

const inputs = [
    { nodeId: "image-a", ready: true, type: "image" },
    { nodeId: "image-waiting", ready: false, type: "image" },
    { nodeId: "text-c", ready: true, type: "text" },
    { nodeId: "video-d", ready: true, type: "video" },
];

test("plain composer content defaults to every connected ready input", () => {
    const result = resolveCanvasInputBindings(inputs, "把这些素材组合成一支短片");

    assert.equal(result.hasTokens, false);
    assert.deepEqual(
        result.selectedInputs.map((input) => input.nodeId),
        ["image-a", "text-c", "video-d"],
    );
});

test("composer tokens select and order ready inputs by stable node id", () => {
    const result = resolveCanvasInputBindings(inputs, "先用 @[node:video-d]，忽略 @[node:missing] 和 @[node:image-waiting]，再参考 @[node:image-a]，最后仍是 @[node:video-d]");

    assert.equal(result.hasTokens, true);
    assert.deepEqual(
        result.selectedInputs.map((input) => input.nodeId),
        ["video-d", "image-a"],
    );
    assert.deepEqual(
        result.tokens.map((token) => [token.nodeId, token.input?.nodeId || null]),
        [
            ["video-d", "video-d"],
            ["missing", null],
            ["image-waiting", null],
            ["image-a", "image-a"],
            ["video-d", "video-d"],
        ],
    );
});

test("one group token selects every member and overlapping group or leaf tokens send each leaf once", () => {
    const grouped = [
        { nodeId: "portrait", ready: true, bindingNodeIds: ["character", "cast"] },
        { nodeId: "identity", ready: true, bindingNodeIds: ["character", "cast"] },
        { nodeId: "backdrop", ready: true, bindingNodeIds: ["cast"] },
    ];
    const result = resolveCanvasInputBindings(grouped, "@[node:portrait] 与 @[node:character]，再用 @[node:cast]");
    assert.deepEqual(
        result.selectedInputs.map((input) => input.nodeId),
        ["portrait", "identity", "backdrop"],
    );
    assert.deepEqual(
        result.tokens[1].inputs?.map((input) => input.nodeId),
        ["portrait", "identity"],
    );
    assert.equal(result.tokens[1].input, grouped[0], "the first member remains available for legacy token consumers");
});

test("an alias is unresolved when any member is pending while direct ready leaf references remain usable", () => {
    const grouped = [
        { nodeId: "portrait", ready: true, bindingNodeIds: ["character"] },
        { nodeId: "identity", ready: false, bindingNodeIds: ["character"] },
    ];
    const result = resolveCanvasInputBindings(grouped, "@[node:character] 和 @[node:portrait]");
    assert.equal(result.tokens[0].input, undefined);
    assert.equal(result.tokens[0].inputs, undefined);
    assert.deepEqual(
        result.selectedInputs.map((input) => input.nodeId),
        ["portrait"],
    );
});

test("prompt input preview ignores an unselected empty upstream while retaining a selected pending input", () => {
    const selected = getCanvasPromptInputs(inputs, "参考 @[node:image-a]");
    assert.deepEqual(
        selected.map((input) => input.nodeId),
        ["image-a"],
    );
    assert.deepEqual(
        selected.filter((input) => !input.ready),
        [],
    );

    const pending = getCanvasPromptInputs(inputs, "参考 @[node:image-waiting]");
    assert.deepEqual(
        pending.map((input) => input.nodeId),
        ["image-waiting"],
    );
    assert.equal(pending.filter((input) => !input.ready).length, 1);
});

test("group previews include pending members once across overlapping group and leaf references", () => {
    const grouped = [
        { nodeId: "portrait", ready: true, bindingNodeIds: ["character", "cast"] },
        { nodeId: "identity", ready: false, bindingNodeIds: ["character", "cast"] },
        { nodeId: "empty-script", ready: false },
    ];
    const selected = getCanvasPromptInputs(grouped, "@[node:portrait] 与 @[node:character] 和 @[node:cast]");
    assert.deepEqual(
        selected.map((input) => input.nodeId),
        ["portrait", "identity"],
    );
    assert.deepEqual(
        selected.filter((input) => !input.ready).map((input) => input.nodeId),
        ["identity"],
    );
});

test("plain prompt preview retains every physical input and its existing waiting behavior", () => {
    assert.equal(getCanvasPromptInputs(inputs, "让两个人物互动"), inputs);
    assert.deepEqual(
        getCanvasPromptInputs(inputs, "")
            .filter((input) => !input.ready)
            .map((input) => input.nodeId),
        ["image-waiting"],
    );
});

test("an unknown token never falls back to unrelated physical inputs in the preview", () => {
    assert.deepEqual(getCanvasPromptInputs(inputs, "参考 @[node:deleted]"), []);
});
