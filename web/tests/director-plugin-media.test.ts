import assert from "node:assert/strict";
import test from "node:test";

import { buildDirectorCaptureOps, normalizeDirectorCaptures, persistDirectorCaptureBatch, type DirectorStoredCapture } from "../../plugins/canvas/director-desk/src/capture-media.ts";
import type { CanvasAgentOp, CanvasNodeData, CanvasPluginMedia } from "../../plugins/canvas/sdk/src/types.ts";

const node: CanvasNodeData = {
    id: "director-1",
    type: "director-desk:project",
    title: "导演台",
    position: { x: 120, y: 80 },
    width: 520,
    height: 320,
    metadata: {},
};

function storedCapture(index: number): DirectorStoredCapture {
    return {
        fileName: `shot-${index}.png`,
        image: {
            url: `blob:stored-${index}`,
            storageKey: `image:stored-${index}`,
            width: 1920,
            height: 1080,
            bytes: 2048 + index,
            mimeType: "image/png",
        },
    };
}

test("director capture ops reference host-stored images instead of raw data URLs", () => {
    const captures = [storedCapture(1), storedCapture(2)];
    const result = buildDirectorCaptureOps(node, captures, "batch-a");
    assert.equal(result.lastCapture?.image.storageKey, "image:stored-2");
    assert.equal(result.ops.length, 5);

    const update = result.ops[0];
    assert.equal(update.type, "update_node");
    if (update.type !== "update_node") return;
    assert.equal(update.metadata?.content, "blob:stored-2");
    assert.equal(update.metadata?.storageKey, "image:stored-2");
    assert.equal(update.metadata?.naturalWidth, 1920);
    assert.equal(update.metadata?.naturalHeight, 1080);

    const added = result.ops.filter((op) => op.type === "add_node");
    assert.deepEqual(
        added.map((op) => op.type === "add_node" && op.metadata?.storageKey),
        ["image:stored-1", "image:stored-2"],
    );
    assert.equal(JSON.stringify(result.ops).includes("data:image/"), false);
});

test("director capture persistence finishes every native-store write before applying nodes", async () => {
    const events: string[] = [];
    const applied: CanvasAgentOp[][] = [];
    let index = 0;
    const media: CanvasPluginMedia = {
        storeImage: async () => {
            index += 1;
            events.push(`store:${index}`);
            return storedCapture(index).image;
        },
        discardImage: async (image) => {
            events.push(`discard:${image.storageKey}`);
        },
        resolveImage: async (_storageKey, fallback = "") => fallback,
    };
    const count = await persistDirectorCaptureBatch(
        {
            node,
            media,
            applyOps: (ops) => {
                events.push("apply");
                applied.push(ops);
            },
        },
        [
            { dataUrl: "data:image/png;base64,AAAA", fileName: "one.png" },
            { dataUrl: "data:image/png;base64,BBBB", fileName: "two.png" },
        ],
        "batch-b",
    );

    assert.equal(count, 2);
    assert.deepEqual(events, ["store:1", "store:2", "apply"]);
    assert.equal(applied.length, 1);
    assert.equal(JSON.stringify(applied[0]).includes("base64"), false);
});

test("director capture persistence rolls back stored images when the batch cannot complete", async () => {
    const discarded: string[] = [];
    let index = 0;
    const media: CanvasPluginMedia = {
        storeImage: async () => {
            index += 1;
            if (index === 2) throw new Error("storage unavailable");
            return storedCapture(index).image;
        },
        discardImage: async (image) => {
            discarded.push(image.storageKey);
        },
        resolveImage: async (_storageKey, fallback = "") => fallback,
    };

    await assert.rejects(
        persistDirectorCaptureBatch(
            { node, media, applyOps: () => assert.fail("nodes must not be created after a failed upload") },
            [
                { dataUrl: "data:image/png;base64,AAAA", fileName: "one.png" },
                { dataUrl: "data:image/png;base64,BBBB", fileName: "two.png" },
            ],
            "batch-c",
        ),
        /storage unavailable/,
    );
    assert.deepEqual(discarded, ["image:stored-1"]);
});

test("director capture persistence rolls back the full batch when node creation fails", async () => {
    const discarded: string[] = [];
    let index = 0;
    const media: CanvasPluginMedia = {
        storeImage: async () => storedCapture(++index).image,
        discardImage: async (image) => {
            discarded.push(image.storageKey);
        },
        resolveImage: async (_storageKey, fallback = "") => fallback,
    };

    await assert.rejects(
        persistDirectorCaptureBatch(
            {
                node,
                media,
                applyOps: () => {
                    throw new Error("canvas changed");
                },
            },
            [
                { dataUrl: "data:image/png;base64,AAAA", fileName: "one.png" },
                { dataUrl: "data:image/png;base64,BBBB", fileName: "two.png" },
            ],
            "batch-d",
        ),
        /canvas changed/,
    );
    assert.deepEqual(discarded, ["image:stored-1", "image:stored-2"]);
});

test("director capture input rejects remote URLs and caps one batch", () => {
    const captures = Array.from({ length: 14 }, (_, index) => ({ dataUrl: `data:image/png;base64,${index}`, fileName: `shot-${index}.png` }));
    captures.splice(2, 0, { dataUrl: "https://example.test/shot.png", fileName: "remote.png" });
    const normalized = normalizeDirectorCaptures(captures);
    assert.equal(normalized.length, 11);
    assert.equal(
        normalized.some((capture) => capture.fileName === "remote.png"),
        false,
    );
});
