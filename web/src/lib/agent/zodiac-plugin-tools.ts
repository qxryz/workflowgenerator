import { getNodeDefinition, getNodePluginId, isBuiltinNodeType } from "../canvas/node-registry.ts";
import { validatePluginMethodArgs } from "../canvas/plugin-agent-schema.ts";
import { PLUGIN_AGENT_TOOL_DEFINITIONS } from "./zodiac-plugin-tool-definitions.js";
import type { CanvasAgentSnapshot } from "../canvas/canvas-agent-ops";
import type { CanvasNodeData, CanvasNodeMetadata } from "../../types/canvas";

export type PluginToolOutcome = { ok: true; result: unknown } | { ok: false; error: string };
export type PluginExecutorContext = {
    getSnapshot: () => CanvasAgentSnapshot;
    /** Must commit with optimistic concurrency, await server storage, and read back the resulting node. */
    commitNodeMetadata: (input: { projectId: string; nodeId: string; expectedNode: CanvasNodeData; metadataPatch: CanvasNodeMetadata; signal: AbortSignal }) => Promise<{ node: CanvasNodeData; persisted: true }>;
    signal?: AbortSignal;
};

export async function pluginNodeRevision(node: CanvasNodeData) {
    const bytes = new TextEncoder().encode(JSON.stringify({ id: node.id, type: node.type, title: node.title, metadata: node.metadata || {} }));
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

function freezeCopy<T>(value: T): T {
    const copy = structuredClone(value);
    const freeze = (item: unknown) => { if (item && typeof item === "object") { Object.values(item).forEach(freeze); Object.freeze(item); } };
    freeze(copy);
    return copy;
}

async function withAbort<T>(signal: AbortSignal, run: () => T | Promise<T>): Promise<T> {
    signal.throwIfAborted();
    let abort: () => void = () => {};
    const cancelled = new Promise<never>((_, reject) => { abort = () => reject(signal.reason || new DOMException("已取消", "AbortError")); signal.addEventListener("abort", abort, { once: true }); });
    try { return await Promise.race([Promise.resolve().then(run), cancelled]); }
    finally { signal.removeEventListener("abort", abort); }
}

export async function executeZodiacPluginTool(request: { name: string; args: unknown }, context: PluginExecutorContext): Promise<PluginToolOutcome> {
    try {
        const signal = context.signal || new AbortController().signal;
        signal.throwIfAborted();
        const definition = PLUGIN_AGENT_TOOL_DEFINITIONS[request.name as keyof typeof PLUGIN_AGENT_TOOL_DEFINITIONS];
        if (!definition) throw new Error("未知插件工具");
        validatePluginMethodArgs(definition.parameters, request.args);
        const args = request.args as { nodeId: string; method?: string; args?: Record<string, unknown>; expectedRevision?: string };
        const snapshot = context.getSnapshot();
        const node = snapshot.nodes.find(item => item.id === args.nodeId);
        if (!node) throw new Error("node_not_found：插件节点不在当前画布");
        const nodeDefinition = getNodeDefinition(node.type);
        const pluginId = getNodePluginId(node.type);
        if (isBuiltinNodeType(node.type) || pluginId === "builtin" || !nodeDefinition?.agent) throw new Error("no_agent_surface：此插件没有声明可调用方法");
        const surface = nodeDefinition.agent;
        if (request.name === "hub_plugin_agent_describe") return { ok: true, result: {
            nodeId: node.id, pluginId, pluginName: nodeDefinition.title, instructions: surface.instructions,
            methods: surface.methods.map(({ name, description, inputSchema, effect }) => ({ name, description, inputSchema: structuredClone(inputSchema), effect })),
        } };
        const method = surface.methods.find(item => item.name === args.method);
        if (!method) throw new Error("method_not_found：只能调用此节点当前声明的方法");
        const parameters = args.args ?? {};
        validatePluginMethodArgs(method.inputSchema, parameters);
        const original = structuredClone(node);
        const revision = await pluginNodeRevision(original);
        if (method.effect === "write" && args.expectedRevision !== revision) throw new Error("conflict：文档已变化或缺少 expectedRevision，请重新读取");
        signal.throwIfAborted();
        const output = await withAbort(signal, () => method.invoke({ node: freezeCopy(original), signal }, freezeCopy(parameters)));
        signal.throwIfAborted();
        if (!output || typeof output !== "object") throw new Error("插件方法返回了无效结果");
        if (method.effect === "read") {
            if (output.metadataPatch !== undefined) throw new Error("只读插件方法禁止返回写入操作");
            return { ok: true, result: { nodeId: node.id, method: method.name, effect: "read", revision, result: output.result } };
        }
        const patch = output.metadataPatch;
        if (!patch || typeof patch !== "object" || Array.isArray(patch) || ![Object.prototype, null].includes(Object.getPrototypeOf(patch)) || !Object.keys(patch).length || Object.keys(patch).some(key => !method.metadataKeys?.includes(key))) throw new Error("插件写入超出其声明的 metadata 字段");
        const currentSnapshot = context.getSnapshot();
        const currentNode = currentSnapshot.nodes.find(item => item.id === node.id);
        if (currentSnapshot.projectId !== snapshot.projectId || !currentNode || getNodeDefinition(currentNode.type) !== nodeDefinition || await pluginNodeRevision(currentNode) !== revision) throw new Error("conflict：插件或文档已变化，请重新读取");
        signal.throwIfAborted();
        const receipt = await context.commitNodeMetadata({ projectId: snapshot.projectId, nodeId: node.id, expectedNode: original, metadataPatch: structuredClone(patch), signal });
        if (receipt.persisted !== true || receipt.node.id !== node.id || receipt.node.type !== node.type || Object.entries(patch).some(([key, value]) => JSON.stringify((receipt.node.metadata as Record<string, unknown> | undefined)?.[key]) !== JSON.stringify(value))) throw new Error("插件修改未通过持久化读回校验");
        return { ok: true, result: { nodeId: node.id, method: method.name, effect: "write", revision: await pluginNodeRevision(receipt.node), persisted: true, result: output.result } };
    } catch (error) {
        return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
}
