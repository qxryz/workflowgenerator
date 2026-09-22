import test from "node:test";
import assert from "node:assert/strict";
import { registerNodeDefinitions, unregisterPluginNodes } from "../src/lib/canvas/node-registry.ts";
import { executeZodiacPluginTool, pluginNodeRevision } from "../src/lib/agent/zodiac-plugin-tools.ts";
import { markdownAgentSurface } from "../../plugins/canvas/markdown/src/agent-surface.ts";
import type { CanvasPluginAgentSurface } from "../src/types/canvas-plugin.ts";
import type { PluginExecutorContext } from "../src/lib/agent/zodiac-plugin-tools.ts";
import type { CanvasAgentSnapshot } from "../src/lib/canvas/canvas-agent-ops.ts";

function setup(t: test.TestContext, surface = markdownAgentSurface) {
    registerNodeDefinitions([{ type: "markdown:doc", title: "Markdown", icon: "", defaultSize: { width: 360, height: 300 }, agent: surface }], "markdown");
    t.after(() => unregisterPluginNodes("markdown"));
    let snapshot: CanvasAgentSnapshot = { projectId: "canvas", title: "Canvas", nodes: [{ id: "doc", type: "markdown:doc", title: "Draft", position: { x: 0, y: 0 }, width: 360, height: 300, metadata: { content: "# Before", status: "success" } }, { id: "other", type: "text", title: "Other", position: { x: 0, y: 0 }, width: 100, height: 100, metadata: { content: "Untouched" } }], connections: [], selectedNodeIds: [], viewport: { x: 0, y: 0, scale: 1 } };
    let writes = 0;
    const context: PluginExecutorContext = {
        getSnapshot: () => snapshot,
        commitNodeMetadata: async ({ nodeId, expectedNode, metadataPatch, signal }) => {
            signal.throwIfAborted();
            const node = snapshot.nodes.find(item => item.id === nodeId)!;
            assert.deepEqual(node.metadata, expectedNode.metadata);
            writes++;
            snapshot = { ...snapshot, nodes: snapshot.nodes.map(item => item.id === nodeId ? { ...item, metadata: { ...item.metadata, ...metadataPatch } } : item) };
            return { node: structuredClone(snapshot.nodes.find(item => item.id === nodeId)!), persisted: true };
        },
    };
    return { context, writes: () => writes };
}
const invoke = (method: string, args = {}, expectedRevision?: string) => ({ name: "hub_plugin_agent_invoke", args: { nodeId: "doc", method, args, ...(expectedRevision ? { expectedRevision } : {}) } });

test("describe lists only declared methods and document read/replace returns a verified persisted receipt", async (t) => {
    const { context, writes } = setup(t);
    const description = await executeZodiacPluginTool({ name: "hub_plugin_agent_describe", args: { nodeId: "doc" } }, context);
    assert.equal(description.ok, true);
    assert.ok(!JSON.stringify(description).includes('"invoke":'));
    const read = await executeZodiacPluginTool(invoke("document.read"), context);
    assert.equal(read.ok, true); if (!read.ok) return;
    const value = read.result as { revision: string; result: { content: string } };
    assert.equal(value.result.content, "# Before");
    const write = await executeZodiacPluginTool(invoke("document.replace", { content: "# After\n\nActual body" }, value.revision), context);
    assert.equal(write.ok, true); if (!write.ok) return;
    assert.equal((write.result as { persisted: boolean }).persisted, true);
    assert.equal(context.getSnapshot().nodes[0].metadata?.content, "# After\n\nActual body");
    assert.equal(context.getSnapshot().nodes[1].metadata?.content, "Untouched"); assert.equal(writes(), 1);
    assert.equal((await executeZodiacPluginTool(invoke("document.replace", { content: "stale" }, value.revision), context)).ok, false);
});

test("wrong node, unknown method, extra args, missing revisions and undeclared plugins cannot write", async (t) => {
    const { context, writes } = setup(t);
    for (const request of [invoke("shell.run"), invoke("document.read", { script: "ignored" }), invoke("document.replace", { content: 42 }), invoke("document.replace", { content: "overwrite" }), { name: "hub_plugin_agent_invoke", args: { nodeId: "other", method: "document.replace", args: { content: "wrong" } } }]) {
        assert.equal((await executeZodiacPluginTool(request, context)).ok, false);
    }
    unregisterPluginNodes("markdown");
    const missing = await executeZodiacPluginTool(invoke("document.read"), context);
    assert.equal(missing.ok, false); if (!missing.ok) assert.match(missing.error, /no_agent_surface/);
    assert.equal(writes(), 0);
});

test("read methods cannot mutate their node or return metadata patches", async (t) => {
    const surface: CanvasPluginAgentSurface = { instructions: "read", methods: [{ name: "read", description: "Read", effect: "read", inputSchema: { type: "object", properties: {}, additionalProperties: false }, invoke: ({ node }) => { (node.metadata as { content: string }).content = "illegal"; return { result: {} }; } }] };
    const { context, writes } = setup(t, surface);
    assert.equal((await executeZodiacPluginTool(invoke("read"), context)).ok, false);
    assert.equal(context.getSnapshot().nodes[0].metadata?.content, "# Before");
    surface.methods[0].invoke = () => ({ result: {}, metadataPatch: { content: "illegal" } });
    assert.equal((await executeZodiacPluginTool(invoke("read"), context)).ok, false); assert.equal(writes(), 0);
});

test("write methods cannot patch undeclared fields and aborted invocations never commit", async (t) => {
    const surface = structuredClone({ instructions: markdownAgentSurface.instructions });
    const methods = markdownAgentSurface.methods.map(method => ({ ...method }));
    const { context, writes } = setup(t, { ...surface, methods });
    const revision = await pluginNodeRevision(context.getSnapshot().nodes[0]);
    methods[1].invoke = () => ({ result: {}, metadataPatch: { prompt: "undeclared" } });
    assert.equal((await executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context)).ok, false);
    const abort = new AbortController(); context.signal = abort.signal;
    methods[1].invoke = () => { abort.abort(); return { result: {}, metadataPatch: { content: "too late" } }; };
    assert.equal((await executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context)).ok, false);
    assert.equal(writes(), 0);
});

test("failed persistence or readback mismatches cannot produce successful plugin receipts", async (t) => {
    const { context } = setup(t);
    const revision = await pluginNodeRevision(context.getSnapshot().nodes[0]);
    context.commitNodeMetadata = async () => { throw new Error("disk unavailable"); };
    assert.equal((await executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context)).ok, false);
    context.commitNodeMetadata = async () => ({ node: context.getSnapshot().nodes[0], persisted: true });
    assert.equal((await executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context)).ok, false);
});

test("registry refuses agent surfaces without strict schemas before exposing methods", () => {
    assert.throws(() => registerNodeDefinitions([{ type: "bad:doc", title: "Bad", icon: "", defaultSize: { width: 100, height: 100 }, agent: { instructions: "bad", methods: [{ name: "edit", description: "edit", effect: "write", inputSchema: { type: "object" }, invoke: () => ({ result: {} }) }] } }], "bad"), /schema/);
});


test("abort stops an uncooperative pending method without applying its later patch", async (t) => {
    let finish: (value: { result: unknown; metadataPatch: { content: string } }) => void = () => {};
    let entered: () => void = () => {};
    const started = new Promise<void>(resolve => { entered = resolve; });
    const methods = markdownAgentSurface.methods.map(method => ({ ...method }));
    methods[1].invoke = () => { entered(); return new Promise(resolve => { finish = resolve; }); };
    const { context, writes } = setup(t, { ...markdownAgentSurface, methods });
    const abort = new AbortController(); context.signal = abort.signal;
    const revision = await pluginNodeRevision(context.getSnapshot().nodes[0]);
    const pending = executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context);
    await started; abort.abort();
    assert.equal((await pending).ok, false);
    finish({ result: {}, metadataPatch: { content: "too late" } });
    await Promise.resolve(); assert.equal(writes(), 0);
});

test("a node changed during plugin work conflicts before persistence", async (t) => {
    const methods = markdownAgentSurface.methods.map(method => ({ ...method }));
    const { context, writes } = setup(t, { ...markdownAgentSurface, methods });
    const revision = await pluginNodeRevision(context.getSnapshot().nodes[0]);
    methods[1].invoke = () => { context.getSnapshot().nodes[0].metadata!.content = "user edit"; return { result: {}, metadataPatch: { content: "stale agent edit" } }; };
    const result = await executeZodiacPluginTool(invoke("document.replace", { content: "new" }, revision), context);
    assert.equal(result.ok, false); if (!result.ok) assert.match(result.error, /conflict/);
    assert.equal(writes(), 0);
});
