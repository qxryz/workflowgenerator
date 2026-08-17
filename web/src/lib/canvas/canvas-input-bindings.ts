export type CanvasInputBindingConnection = {
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasBoundInput = {
    nodeId: string;
    ready: boolean;
};

export type CanvasInputResourceKind = "image" | "video" | "audio" | "text";

export type ResolvedCanvasInputToken<T extends CanvasBoundInput> = {
    start: number;
    end: number;
    nodeId: string;
    input?: T;
};

/** Direct edges are the input contract. Never infer inputs through a shared downstream sibling. */
export function directUpstreamNodeIds(nodeId: string, connections: CanvasInputBindingConnection[]) {
    const seen = new Set<string>();
    const result: string[] = [];
    for (const connection of connections) {
        if (connection.toNodeId !== nodeId || seen.has(connection.fromNodeId)) continue;
        seen.add(connection.fromNodeId);
        result.push(connection.fromNodeId);
    }
    return result;
}

export function builtinCanvasResourceKind(type: string, terminalOutputMode?: CanvasInputResourceKind): CanvasInputResourceKind | null {
    if (type === "image" || type === "video" || type === "audio" || type === "text") return type;
    if (type === "terminal") return terminalOutputMode || "text";
    return null;
}

export function isReadyCanvasResourceValue(status: string | undefined, value: string | undefined, resultSlotState?: string) {
    if (resultSlotState !== undefined && resultSlotState !== "ready") return false;
    return status !== "loading" && status !== "error" && Boolean(value?.trim());
}

/**
 * Without tokens every ready connected input is selected. With tokens, node ids
 * are resolved in prompt order; missing and pending nodes stay unresolved.
 */
export function resolveCanvasInputBindings<T extends CanvasBoundInput>(inputs: T[], prompt: string) {
    const readyByNodeId = new Map<string, T>();
    for (const input of inputs) {
        if (input.ready && !readyByNodeId.has(input.nodeId)) readyByNodeId.set(input.nodeId, input);
    }

    const tokens: ResolvedCanvasInputToken<T>[] = [];
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        tokens.push({
            start: match.index,
            end: match.index + match[0].length,
            nodeId: match[1],
            input: readyByNodeId.get(match[1]),
        });
    }

    if (!tokens.length) return { hasTokens: false, selectedInputs: Array.from(readyByNodeId.values()), tokens };

    const selectedInputs: T[] = [];
    const selectedNodeIds = new Set<string>();
    for (const token of tokens) {
        if (!token.input || selectedNodeIds.has(token.nodeId)) continue;
        selectedNodeIds.add(token.nodeId);
        selectedInputs.push(token.input);
    }
    return { hasTokens: true, selectedInputs, tokens };
}
