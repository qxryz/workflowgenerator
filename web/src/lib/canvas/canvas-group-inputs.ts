type GroupInputNode = { id: string; type: string; title?: string; metadata?: { groupId?: unknown; groupPrompt?: unknown; assetCollectionVersion?: unknown; content?: unknown; status?: unknown } };
type InputConnection = { fromNodeId: string; toNodeId: string };

/** Membership is explicit; spatial overlap and downstream links never add inputs. */
export function getCanvasGroupMembers<T extends GroupInputNode>(groupId: string, nodes: readonly T[]): T[] {
    const visited = new Set<string>([groupId]);
    const members: T[] = [];
    const visit = (parentId: string) => {
        for (const node of nodes) {
            if (node.metadata?.groupId !== parentId || visited.has(node.id)) continue;
            visited.add(node.id);
            if (node.type === "group") visit(node.id);
            else if (node.type !== "config") members.push(node);
        }
    };
    visit(groupId);
    return members;
}

export type CanvasInputSource<T extends GroupInputNode = GroupInputNode> = { node: T; bindingNodeIds: string[] };

/** Keep the visible group edge while resolving unique leaves for every execution path. */
export function getCanvasInputSources<T extends GroupInputNode>(nodeId: string, nodes: readonly T[], connections: readonly InputConnection[]): CanvasInputSource<T>[] {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const sources = new Map<string, CanvasInputSource<T>>();
    const resolve = (node: T, ancestors: string[]): CanvasInputSource<T>[] => {
        if (node.type !== "group") return [{ node, bindingNodeIds: ancestors }];
        const aliases = [...ancestors, node.id];
        const unresolved = () => [{ node: { ...node, metadata: { ...node.metadata, status: "error" } }, bindingNodeIds: aliases }];
        if (ancestors.includes(node.id)) return unresolved();
        const prompt = typeof node.metadata?.groupPrompt === "string" ? node.metadata.groupPrompt.trim() : "";
        const tokens = [...prompt.matchAll(/@\[node:([^\]]+)\]/g)].map((match) => match[1]);
        const descendants = expandCanvasGroupSelection(new Set([node.id]), nodes);
        let children: T[];
        if (tokens.length) {
            if (tokens.some((id) => id === node.id || !descendants.has(id) || !nodeById.has(id) || nodeById.get(id)?.type === "config")) return unresolved();
            children = [...new Set(tokens)].map((id) => nodeById.get(id)!);
        } else children = node.metadata?.assetCollectionVersion === 1 ? [] : nodes.filter((child) => child.metadata?.groupId === node.id && child.type !== "config");
        const result = children.flatMap((child) => resolve(child, aliases));
        if (prompt) result.unshift({ node: { ...node, type: "text", metadata: { ...node.metadata, content: prompt, status: "success" } }, bindingNodeIds: aliases });
        return result.length ? result : unresolved();
    };
    for (const connection of connections) {
        if (connection.toNodeId !== nodeId) continue;
        const upstream = nodeById.get(connection.fromNodeId);
        if (!upstream) continue;
        for (const input of resolve(upstream, [])) {
            const source = sources.get(input.node.id) || { node: input.node, bindingNodeIds: [] };
            for (const id of input.bindingNodeIds) if (!source.bindingNodeIds.includes(id)) source.bindingNodeIds.push(id);
            sources.set(input.node.id, source);
        }
    }
    return [...sources.values()];
}

/** Group selection includes hidden descendants for clipboard, deletion and export. */
export function expandCanvasGroupSelection<T extends GroupInputNode>(ids: ReadonlySet<string>, nodes: readonly T[]) {
    const expanded = new Set(ids);
    const visit = (id: string) => {
        for (const node of nodes) {
            if (node.metadata?.groupId !== id || expanded.has(node.id)) continue;
            expanded.add(node.id);
            if (node.type === "group") visit(node.id);
        }
    };
    for (const node of nodes) if (ids.has(node.id) && node.type === "group") visit(node.id);
    return expanded;
}
