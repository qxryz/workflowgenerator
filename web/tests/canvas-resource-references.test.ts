import assert from "node:assert/strict";
import test from "node:test";

import { builtinCanvasResourceKind, directUpstreamNodeIds, isReadyCanvasResourceValue } from "../src/lib/canvas/canvas-input-bindings.ts";

test("resource candidates come only from direct upstream edges", () => {
    const connections = [
        { fromNodeId: "image-slot", toNodeId: "current-action" },
        { fromNodeId: "text-input", toNodeId: "current-action" },
        { fromNodeId: "sibling-input", toNodeId: "other-action" },
        { fromNodeId: "text-input", toNodeId: "current-action" },
        { fromNodeId: "current-action", toNodeId: "downstream-slot" },
    ];

    assert.deepEqual(directUpstreamNodeIds("current-action", connections), ["image-slot", "text-input"]);
});

test("empty built-in result slots keep their declared kind while waiting", () => {
    assert.equal(builtinCanvasResourceKind("image"), "image");
    assert.equal(builtinCanvasResourceKind("video"), "video");
    assert.equal(builtinCanvasResourceKind("terminal", "audio"), "audio");
    assert.equal(isReadyCanvasResourceValue("idle", ""), false);
    assert.equal(isReadyCanvasResourceValue("loading", "image:old-result"), false);
    assert.equal(isReadyCanvasResourceValue("error", "image:old-result"), false);
    assert.equal(isReadyCanvasResourceValue("success", "image:ready-result"), true);
    assert.equal(isReadyCanvasResourceValue("success", "image:last-usable-result", "error"), false);
    assert.equal(isReadyCanvasResourceValue("success", "image:ready-result", "ready"), true);
});
