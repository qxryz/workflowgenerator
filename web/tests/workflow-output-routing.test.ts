import assert from "node:assert/strict";
import test from "node:test";

import { AmbiguousDeclaredOutputError, findDeclaredOutputNode, resolveDeclaredOutputNode } from "../src/lib/canvas/workflow-output-routing.ts";
import type { CanvasNodeData } from "../src/types/canvas.ts";

const nodes: CanvasNodeData[] = [
    { id: "generate", type: "config", title: "生图", position: { x: 0, y: 0 }, width: 320, height: 220 },
    { id: "image-slot", type: "image", title: "主视觉", position: { x: 400, y: 0 }, width: 320, height: 320 },
    { id: "notes", type: "text", title: "说明", position: { x: 400, y: 360 }, width: 320, height: 220 },
];

test("a connected compatible asset node is the declared output slot", () => {
    const result = findDeclaredOutputNode("generate", "image", nodes, [
        { id: "a", fromNodeId: "generate", toNodeId: "image-slot" },
        { id: "b", fromNodeId: "generate", toNodeId: "notes" },
    ]);
    assert.equal(result?.id, "image-slot");
});

test("an incompatible downstream node does not reserve an output", () => {
    const result = findDeclaredOutputNode("generate", "video", nodes, [{ id: "a", fromNodeId: "generate", toNodeId: "image-slot" }]);
    assert.equal(result, undefined);
});

test("one explicit result slot wins over a legacy compatible resource node", () => {
    const explicit: CanvasNodeData = {
        id: "explicit",
        type: "image",
        title: "结果槽",
        position: { x: 800, y: 0 },
        width: 320,
        height: 320,
        metadata: { role: "result-slot", resultSlotMode: "image" },
    };
    const result = resolveDeclaredOutputNode(
        "generate",
        "image",
        [...nodes, explicit],
        [
            { id: "legacy", fromNodeId: "generate", toNodeId: "image-slot" },
            { id: "declared", fromNodeId: "generate", toNodeId: "explicit" },
        ],
    );

    assert.equal(result.status, "unique");
    assert.equal(result.status === "unique" ? result.node.id : undefined, "explicit");
    assert.equal(result.status === "unique" ? result.explicit : undefined, true);
});

test("multiple compatible result slots are reported as ambiguous instead of choosing by array order", () => {
    const slots: CanvasNodeData[] = ["slot-a", "slot-b"].map((id, index) => ({
        id,
        type: "image",
        title: id,
        position: { x: 400, y: index * 300 },
        width: 320,
        height: 240,
        metadata: { role: "result-slot", resultSlotMode: "image" },
    }));
    const connections = slots.map((slot, index) => ({ id: `connection-${index}`, fromNodeId: "generate", toNodeId: slot.id }));
    const resolution = resolveDeclaredOutputNode("generate", "image", [nodes[0], ...slots], connections);

    assert.equal(resolution.status, "ambiguous");
    assert.deepEqual(
        resolution.candidates.map((candidate) => candidate.id),
        ["slot-a", "slot-b"],
    );
    assert.throws(() => findDeclaredOutputNode("generate", "image", [nodes[0], ...slots], connections), AmbiguousDeclaredOutputError);
});
