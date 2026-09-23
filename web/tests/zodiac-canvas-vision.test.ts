import assert from "node:assert/strict";
import test from "node:test";
import { prepareZodiacCanvasVision, textOnlyZodiacVisionSnapshot, zodiacVisionConfig } from "../src/lib/agent/zodiac-canvas-vision.ts";

test("canvas pixels are attached with stable identities; failed reads never claim visual access", async () => {
    const nodes = ["a", "b", "bad"].map((id) => ({ id, type: "image", title: id, position: { x: 0, y: 0 }, metadata: { storageKey: `image:${id}` } }));
    const input = { title: "人物", nodes, connections: [], selectedNodeIds: [] };
    const calls: string[] = [];
    const result = await prepareZodiacCanvasVision(input, "查看人物", async ({ storageKey }) => {
        calls.push(storageKey!);
        if (storageKey === "image:bad") throw new Error("local read failed");
        return "data:image/png;base64,aW1hZ2U=";
    });
    assert.deepEqual(calls, ["image:a", "image:b", "image:bad"]);
    assert.deepEqual(result.snapshot.visualContext.attachedNodeIds, ["a", "b"]);
    assert.deepEqual(result.snapshot.visualContext.unavailableNodeIds, ["bad"]);
    assert.equal(result.parts.filter((part) => part.type === "image_url").length, 2);
    assert.match(JSON.stringify(result.parts), /nodeId/);
    assert.equal("visualContext" in input, false);
    assert.doesNotMatch(JSON.stringify(result.snapshot), /base64/);
});

test("HTML and app-local URLs are never forwarded as visible model images", async () => {
    for (const payload of ["", "<html>error</html>", "wg-media://image/a", "blob:unreadable"]) {
        const result = await prepareZodiacCanvasVision(
            { title: "素材", nodes: [{ id: "a", title: "图", type: "image", position: { x: 0, y: 0 }, metadata: { content: "wg-media://image/a" } }], connections: [], selectedNodeIds: [] },
            "查看",
            async () => payload,
        );
        assert.deepEqual(result.parts, []);
        assert.deepEqual(result.snapshot.visualContext.unavailableNodeIds, ["a"]);
    }
});

test("the text-only pi transport preserves truthful attached-image metadata", async () => {
    const result = await prepareZodiacCanvasVision(
        { title: "人物", nodes: [{ id: "a", title: "主视觉", type: "image", position: { x: 0, y: 0 }, metadata: { content: "data:image/png;base64,aW1hZ2U=" } }], connections: [], selectedNodeIds: [] },
        "查看人物",
        async () => "data:image/png;base64,aW1hZ2U=",
    );
    const textOnly = textOnlyZodiacVisionSnapshot(result.snapshot);
    assert.deepEqual(textOnly.visualContext?.attachedNodeIds, ["a"]);
    assert.deepEqual(textOnly.visualContext?.unavailableNodeIds, []);
    assert.deepEqual(result.snapshot.visualContext?.attachedNodeIds, ["a"], "原快照保持不变");
});


test("vision uses the user's chat model instead of the canvas image generator", () => {
    const config = { model: "images::doubao-seedream-4-5-251128", textModel: "chat::MiniMax-M3", imageModel: "images::doubao-seedream-4-5-251128" } as any;
    assert.equal(zodiacVisionConfig(config).model, "chat::MiniMax-M3");
    assert.equal(config.model, "images::doubao-seedream-4-5-251128");
    assert.throws(() => zodiacVisionConfig({ ...config, textModel: "" }), /选择聊天模型/);
});
