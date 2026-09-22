export type CanvasInputBindingConnection = {
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasBoundInput = {
    nodeId: string;
    ready: boolean;
    bindingNodeIds?: string[];
};

export type CanvasInputResourceKind = "image" | "video" | "audio" | "text" | "file";

export type ResolvedCanvasInputToken<T extends CanvasBoundInput> = {
    start: number;
    end: number;
    nodeId: string;
    input?: T;
    inputs?: T[];
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

export function builtinCanvasResourceKind(type: string): CanvasInputResourceKind | null {
    if (type === "image" || type === "video" || type === "audio" || type === "text" || type === "file") return type;
    return null;
}

export function isReadyCanvasResourceValue(status: string | undefined, value: string | undefined, resultSlotState?: string) {
    if (resultSlotState !== undefined && resultSlotState !== "ready") return false;
    return status !== "loading" && status !== "error" && Boolean(value?.trim());
}

/** Inputs involved in the prompt, including pending members needed for the UI's waiting state. */
export function getCanvasPromptInputs<T extends CanvasBoundInput>(inputs: T[], prompt: string): T[] {
    const { hasTokens, tokens } = resolveCanvasInputBindings(inputs, prompt);
    if (!hasTokens) return inputs;
    const referencedIds = new Set(tokens.map((token) => token.nodeId));
    return inputs.filter((input) => referencedIds.has(input.nodeId) || input.bindingNodeIds?.some((id) => referencedIds.has(id)));
}

/**
 * Without tokens every ready connected input is selected. With tokens, node ids
 * are resolved in prompt order; missing and pending nodes stay unresolved.
 */
export function resolveCanvasInputBindings<T extends CanvasBoundInput>(inputs: T[], prompt: string) {
    const readyByNodeId = new Map<string, T>();
    const inputsByBindingId = new Map<string, Map<string, T>>();
    for (const input of inputs) {
        if (input.ready && !readyByNodeId.has(input.nodeId)) readyByNodeId.set(input.nodeId, input);
        for (const bindingId of new Set([input.nodeId, ...(input.bindingNodeIds || [])])) {
            const members = inputsByBindingId.get(bindingId) || new Map<string, T>();
            if (!members.has(input.nodeId) || !input.ready) members.set(input.nodeId, input);
            inputsByBindingId.set(bindingId, members);
        }
    }

    const tokens: ResolvedCanvasInputToken<T>[] = [];
    for (const match of prompt.matchAll(/@\[node:([^\]]+)\]/g)) {
        if (match.index === undefined) continue;
        const members = Array.from(inputsByBindingId.get(match[1])?.values() || []);
        const resolved = members.length && members.every((input) => input.ready) ? members : undefined;
        tokens.push({
            start: match.index,
            end: match.index + match[0].length,
            nodeId: match[1],
            input: resolved?.[0],
            inputs: resolved,
        });
    }

    if (!tokens.length) return { hasTokens: false, selectedInputs: Array.from(readyByNodeId.values()), tokens };

    const selectedInputs: T[] = [];
    const selectedNodeIds = new Set<string>();
    for (const token of tokens) {
        for (const input of token.inputs || []) {
            if (selectedNodeIds.has(input.nodeId)) continue;
            selectedNodeIds.add(input.nodeId);
            selectedInputs.push(input);
        }
    }
    return { hasTokens: true, selectedInputs, tokens };
}
