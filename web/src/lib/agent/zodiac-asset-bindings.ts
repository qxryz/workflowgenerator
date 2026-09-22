import { getCanvasGroupMembers, getCanvasInputSources } from "../canvas/canvas-group-inputs.ts";
import type { CanvasAgentOp } from "../canvas/canvas-agent-ops";
import type { ZodiacKnownCanvasConnection, ZodiacKnownCanvasNode } from "./zodiac-tool-proposal";

/**
 * Materialize explicit asset references before a proposal is displayed or executed.
 *
 * 失败时返回 `{ ok: false, reason }` 而不是裸 undefined：这条链路会把整套 ops 清空，
 * 模型必须知道是哪条引用越界、哪个组没有内容，否则它只能整段重写再撞同一个错。
 */
export type ZodiacAssetBindingResult = { ok: true; ops: CanvasAgentOp[] } | { ok: false; reason: string };

export function bindZodiacAssetReferences(ops: CanvasAgentOp[], knownNodes: ZodiacKnownCanvasNode[], knownConnections: ZodiacKnownCanvasConnection[]): ZodiacAssetBindingResult {
    const nodes = new Map(knownNodes.map((node) => [node.id, { ...node }]));
    const affected = new Set<string>();
    let connections = [...knownConnections];
    for (const op of ops) {
        if (op.type === "add_node" && op.id) {
            nodes.set(op.id, { id: op.id, type: op.nodeType || "text", title: op.title, metadata: op.metadata });
            affected.add(op.id);
        } else if (op.type === "update_node") {
            const node = nodes.get(op.id);
            if (node) nodes.set(op.id, { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } });
            affected.add(op.id);
        } else if (op.type === "run_generation") {
            affected.add(op.nodeId);
        } else if (op.type === "delete_node") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            for (const node of nodes.values()) if (ids.has(node.id) || node.type === op.nodeType) nodes.delete(node.id);
            connections = connections.filter((edge) => nodes.has(edge.fromNodeId) && nodes.has(edge.toNodeId));
        } else if (op.type === "delete_connections") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            connections = op.all ? [] : connections.filter((edge) => !edge.id || !ids.has(edge.id));
        } else if (op.type === "connect_nodes") {
            connections.push(op);
            affected.add(op.toNodeId);
        }
    }
    // The apply boundary persists run overrides after all structural edits.
    for (const op of ops) {
        if (op.type !== "run_generation" || !op.prompt) continue;
        const node = nodes.get(op.nodeId);
        if (node) nodes.set(node.id, { ...node, metadata: { ...node.metadata, prompt: op.prompt, composerContent: op.prompt } });
    }
    const changedMembershipIds = ops.flatMap((op) => (op.type === "add_node" && op.id ? [op.id] : op.type === "update_node" && (op.metadata?.groupId !== undefined || op.patch?.metadata?.groupId !== undefined) ? [op.id] : []));
    for (const id of changedMembershipIds) {
        const seen = new Set([id]);
        let parentId = nodes.get(id)?.metadata?.groupId;
        while (parentId) {
            if (seen.has(parentId) || nodes.get(parentId)?.type !== "group") {
                return { ok: false, reason: `节点「${id}」的归属组不成立：groupId 为「${parentId}」的节点不在本轮画布快照里，或它不是组、或组归属成环。请读取当前画布后只用真实存在的组 id。` };
            }
            seen.add(parentId);
            parentId = nodes.get(parentId)?.metadata?.groupId;
        }
    }
    const allNodes = [...nodes.values()];
    const members = (id: string) => getCanvasGroupMembers(id, allNodes);
    const groupHasInputs = (id: string) => getCanvasInputSources("", allNodes, [{ fromNodeId: id, toNodeId: "" }]).every((input) => input.node.type !== "group");
    const patches = new Map<string, string>();
    const extraEdges: CanvasAgentOp[] = [];
    const key = (from: string, to: string) => `${from}\u0000${to}`;
    const edgeKeys = new Set(connections.map((edge) => key(edge.fromNodeId, edge.toNodeId)));
    const explicitEdges = new Set(ops.flatMap((op) => (op.type === "connect_nodes" ? [key(op.fromNodeId, op.toNodeId)] : [])));
    const edgeIds = new Set(connections.flatMap((edge) => (edge.id ? [edge.id] : [])));
    const connect = (from: string, to: string) => {
        if (from === to || edgeKeys.has(key(from, to))) return;
        edgeKeys.add(key(from, to));
        const baseId = `zodiac-asset-link--${from}--${to}`;
        let id = baseId;
        for (let index = 2; edgeIds.has(id); index++) id = `${baseId}-${index}`;
        edgeIds.add(id);
        extraEdges.push({ type: "connect_nodes", id, fromNodeId: from, toNodeId: to });
    };
    for (const id of affected) {
        const node = nodes.get(id);
        if (!node || node.type !== "config") continue;
        const original = node.metadata?.composerContent?.trim() || node.metadata?.prompt || "";
        const references = new Set<string>();
        // 只记第一条失败原因：模型改一处总比收到一串去重后的报错容易。
        let failure: string | undefined;
        const fail = (reason: string) => {
            failure ??= reason;
        };
        let prompt = original.replace(/@\[node:([^\]]+)\]/gu, (token, sourceId: string) => {
            const source = nodes.get(sourceId);
            // Registered plugin resource references keep their native contract.
            if (!source) {
                fail(`「${node.title || id}」的提示词引用了 @[node:${sourceId}]，但这个节点不在本轮画布快照里。请先读取当前画布，只引用快照里真实存在的节点 id。`);
                return token;
            }
            if (sourceId === id) return token;
            const resolved = source.type === "config" ? [...nodes.values()].filter((item) => item.metadata?.role === "result-slot" && item.metadata.resultSlotSourceNodeId === sourceId) : [source];
            if (!resolved.length) {
                fail(`「${node.title || id}」引用了生成动作 ${sourceId}，但它没有配套的结果槽。请先为这个动作绑定一个同类型结果槽，再引用它的结果槽 id。`);
            } else if (source.type === "group" && !groupHasInputs(sourceId)) {
                fail(`「${node.title || id}」整体引用了组 ${sourceId}，但这个组里没有可用成员（或成员内容无效）。请先在组里放入真实的资料与图片，或改为引用具体的成员节点。`);
            }
            resolved.forEach((item) => references.add(item.id));
            return resolved.map((item) => `@[node:${item.id}]`).join(" ");
        });
        if (failure) return { ok: false, reason: failure };
        const hasTokens = /@\[node:/u.test(prompt);
        for (const edge of connections.filter((edge) => edge.toNodeId === id)) {
            if (nodes.get(edge.fromNodeId)?.type === "group") {
                if (!groupHasInputs(edge.fromNodeId)) {
                    return { ok: false, reason: `「${node.title || id}」连入了组 ${edge.fromNodeId}，但这个组里没有可用成员（或成员内容无效）。请先在组里放入真实的资料与图片，或改为连接具体成员。` };
                }
                if (!hasTokens || references.has(edge.fromNodeId) || explicitEdges.has(key(edge.fromNodeId, id))) references.add(edge.fromNodeId);
            } else if (!hasTokens || (explicitEdges.has(key(edge.fromNodeId, id)) && nodes.get(edge.fromNodeId)?.type !== "text" && nodes.get(edge.fromNodeId)?.metadata?.role !== "result-slot")) references.add(edge.fromNodeId);
        }
        // An individual view still carries its character's written identity,
        // including profiles stored above a nested view group.
        for (const sourceId of [...references]) {
            let groupId = nodes.get(sourceId)?.metadata?.groupId;
            const visited = new Set<string>();
            while (groupId && !visited.has(groupId) && nodes.get(groupId)?.type === "group") {
                visited.add(groupId);
                if (!references.has(groupId)) {
                    for (const sibling of members(groupId)) {
                        if (sibling.type === "text" && sibling.metadata?.content?.trim()) references.add(sibling.id);
                    }
                }
                groupId = nodes.get(groupId)?.metadata?.groupId;
            }
        }
        const connectedInputs = new Set(
            getCanvasInputSources(id, allNodes, connections)
                .filter((input) => input.node.type !== "group")
                .map((input) => input.node.id),
        );
        references.forEach((sourceId) => {
            if (!connectedInputs.has(sourceId)) connect(sourceId, id);
        });
        if (hasTokens) {
            const mentioned = new Set([...prompt.matchAll(/@\[node:([^\]]+)\]/gu)].map((match) => match[1]));
            const added = [...references].filter((sourceId) => !mentioned.has(sourceId));
            if (added.length) prompt += `\n\n${added.map((sourceId) => `@[node:${sourceId}]`).join(" ")}`;
        }
        if (prompt !== original) patches.set(id, prompt);
    }
    const result = ops.map((op): CanvasAgentOp => {
        const id = op.type === "run_generation" ? op.nodeId : op.type === "add_node" || op.type === "update_node" ? op.id : undefined;
        const prompt = id ? patches.get(id) : undefined;
        if (prompt === undefined) return op;
        if (op.type === "run_generation") return { ...op, prompt };
        if (op.type === "add_node" || op.type === "update_node") return { ...op, metadata: { ...op.metadata, prompt, composerContent: prompt } };
        return op;
    });
    for (const [id, prompt] of patches) {
        if (!result.some((op) => ((op.type === "add_node" || op.type === "update_node") && op.id === id) || (op.type === "run_generation" && op.nodeId === id))) {
            result.push({ type: "update_node", id, metadata: { prompt, composerContent: prompt } });
        }
    }
    return { ok: true, ops: [...result, ...extraEdges] };
}
