import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanvasInputBindings } from "../src/lib/canvas/canvas-input-bindings.ts";

const inputs = [
    { nodeId: "image-a", ready: true, type: "image" },
    { nodeId: "image-waiting", ready: false, type: "image" },
    { nodeId: "text-c", ready: true, type: "text" },
    { nodeId: "video-d", ready: true, type: "video" },
];

test("plain composer content defaults to every connected ready input", () => {
    const result = resolveCanvasInputBindings(inputs, "把这些素材组合成一支短片");

    assert.equal(result.hasTokens, false);
    assert.deepEqual(result.selectedInputs.map((input) => input.nodeId), ["image-a", "text-c", "video-d"]);
});

test("composer tokens select and order ready inputs by stable node id", () => {
    const result = resolveCanvasInputBindings(inputs, "先用 @[node:video-d]，忽略 @[node:missing] 和 @[node:image-waiting]，再参考 @[node:image-a]，最后仍是 @[node:video-d]");

    assert.equal(result.hasTokens, true);
    assert.deepEqual(result.selectedInputs.map((input) => input.nodeId), ["video-d", "image-a"]);
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
