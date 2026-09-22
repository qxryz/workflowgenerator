import assert from "node:assert/strict";
import test from "node:test";

import { fitCanvasResultSlotToContent, resolveCanvasResultSlotLayout } from "../src/lib/canvas/canvas-result-slot-layout.ts";
import type { CanvasNodeData, CanvasResultSlotArtifact } from "../src/types/canvas.ts";

function slot(artifacts: CanvasResultSlotArtifact[], columns?: number): CanvasNodeData {
    return {
        id: "slot",
        type: "image",
        title: "图片结果",
        position: { x: 0, y: 0 },
        width: 340,
        height: 240,
        metadata: {
            role: "result-slot",
            resultSlotMode: "image",
            resultSlotSourceNodeId: "maker",
            advanceMode: "review",
            slotState: "ready",
            currentResultVersionId: "v1",
            resultSlotLayoutColumns: columns,
            resultVersions: [{ id: "v1", status: "success", artifacts, primaryArtifactId: artifacts[0].id }],
        },
    };
}

const image = (id: string, width: number, height: number): CanvasResultSlotArtifact => ({ id, kind: "image", content: `asset:${id}`, naturalWidth: width, naturalHeight: height });

test("result slots derive grid dimensions from candidate count", () => {
    const layout = resolveCanvasResultSlotLayout(slot([image("a", 1024, 1024), image("b", 1024, 1024), image("c", 1024, 1024), image("d", 1024, 1024)]));
    assert.equal(layout?.columns, 2);
    assert.equal(layout?.rows, 2);
    assert.ok((layout?.width || 0) > 500);
    assert.ok((layout?.height || 0) > 500);
});

test("portrait and landscape assets produce different fitted proportions", () => {
    const portrait = resolveCanvasResultSlotLayout(slot([image("portrait", 720, 1280)]));
    const landscape = resolveCanvasResultSlotLayout(slot([image("landscape", 1280, 720)]));
    assert.ok((portrait?.height || 0) > (portrait?.width || 0));
    assert.ok((landscape?.width || 0) > (landscape?.height || 0));
});

test("a user-selected column count controls rows and manual resizing pauses auto-fit", () => {
    const node = slot([image("a", 1024, 1024), image("b", 1024, 1024), image("c", 1024, 1024)], 1);
    assert.deepEqual(resolveCanvasResultSlotLayout(node) && [resolveCanvasResultSlotLayout(node)!.rows, resolveCanvasResultSlotLayout(node)!.columns], [3, 1]);
    const manual = { ...node, width: 777, height: 555, metadata: { ...node.metadata, resultSlotAutoSize: false } };
    assert.equal(fitCanvasResultSlotToContent(manual), manual);
});
