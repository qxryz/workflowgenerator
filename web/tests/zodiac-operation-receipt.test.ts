import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

async function loadOperationReceipt() {
    const root = process.cwd();
    const bundle = await build({
        entryPoints: [path.join(root, "src/lib/agent/zodiac-operation-receipt.ts")],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
    });
    return import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
}

const liveRender = {
    id: "render",
    type: "config" as const,
    title: "生成图片",
    position: { x: 0, y: 0 },
    width: 360,
    height: 260,
    metadata: { generationMode: "image" as const, prompt: "森林", composerContent: "森林" },
};

test("a durable resolved receipt keeps its exact ids and meaning across restart", async () => {
    const { restoreZodiacOperationOps } = await loadOperationReceipt();
    const resolvedOps = [
        { type: "add_node" as const, id: "render", nodeType: "config" as const, title: "生成图片", metadata: { generationMode: "image" as const, prompt: "海边", composerContent: "海边" } },
        { type: "run_generation" as const, nodeId: "render", mode: "image" as const },
    ];

    const restored = restoreZodiacOperationOps([], resolvedOps, [liveRender], []);

    assert.equal(restored.valid, true);
    assert.equal(restored.hasResolvedReceipt, true);
    assert.deepEqual(restored.ops, resolvedOps);
    assert.equal(restored.ops.some((op) => op.type === "add_node" && op.id !== "render"), false);
});

test("a proposal without a receipt is still prepared against the live canvas", async () => {
    const { restoreZodiacOperationOps } = await loadOperationReceipt();
    const storedOps = [
        { type: "add_node" as const, id: "render", nodeType: "config" as const, title: "生成图片", metadata: { generationMode: "image" as const, prompt: "海边", composerContent: "海边" } },
        { type: "run_generation" as const, nodeId: "render", mode: "image" as const },
    ];

    const restored = restoreZodiacOperationOps(storedOps, undefined, [liveRender], []);
    const action = restored.ops.find((op) => op.type === "add_node" && op.nodeType === "config");
    const run = restored.ops.find((op) => op.type === "run_generation");

    assert.equal(restored.valid, true);
    assert.equal(restored.hasResolvedReceipt, false);
    assert.notEqual(action?.id, "render");
    assert.equal(run?.nodeId, action?.id);
});
