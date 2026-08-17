import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import { build } from "esbuild";

test("agent connections reuse canvas legality rules and reject config-to-config edges", async () => {
    const root = process.cwd();
    const bundle = await build({
        entryPoints: [path.join(root, "src/lib/canvas/canvas-agent-ops.ts")],
        bundle: true,
        write: false,
        platform: "node",
        format: "esm",
        alias: { "@": path.join(root, "src") },
    });
    const moduleUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
    const { applyCanvasAgentOps } = await import(moduleUrl);
    const baseNode = { position: { x: 0, y: 0 }, width: 340, height: 240, metadata: {} };
    const snapshot = {
        projectId: "project",
        title: "工作流",
        nodes: [
            { ...baseNode, id: "text-action", type: "config", title: "生成文案", metadata: { generationMode: "text" } },
            { ...baseNode, id: "video-action", type: "config", title: "生成视频", metadata: { generationMode: "video" } },
            { ...baseNode, id: "text-slot", type: "text", title: "文本结果槽" },
        ],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };

    const next = applyCanvasAgentOps(snapshot, [
        { type: "connect_nodes", id: "invalid", fromNodeId: "text-action", toNodeId: "video-action" },
        { type: "connect_nodes", id: "valid", fromNodeId: "text-action", toNodeId: "text-slot" },
    ]);

    assert.deepEqual(next.connections, [{ id: "valid", fromNodeId: "text-action", toNodeId: "text-slot" }]);

    const proposal = [
        { type: "add_node", id: "stable-action", nodeType: "config", title: "生成图片", metadata: { generationMode: "image" } },
        { type: "add_node", id: "stable-slot", nodeType: "image", title: "图片结果" },
        { type: "connect_nodes", id: "stable-edge", fromNodeId: "stable-action", toNodeId: "stable-slot" },
    ];
    const appliedOnce = applyCanvasAgentOps(snapshot, proposal);
    const appliedTwice = applyCanvasAgentOps(appliedOnce, proposal);

    assert.equal(appliedTwice.nodes.filter((node) => node.id === "stable-action").length, 1);
    assert.equal(appliedTwice.nodes.filter((node) => node.id === "stable-slot").length, 1);
    assert.equal(appliedTwice.connections.filter((connection) => connection.fromNodeId === "stable-action" && connection.toNodeId === "stable-slot").length, 1);
});
