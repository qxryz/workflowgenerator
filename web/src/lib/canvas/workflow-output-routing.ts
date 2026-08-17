import type { CanvasConnection, CanvasGenerationMode, CanvasNodeData, CanvasNodeTypeId } from "../../types/canvas";

const OUTPUT_NODE_TYPE: Record<CanvasGenerationMode, CanvasNodeTypeId> = {
    text: "text",
    image: "image",
    video: "video",
    audio: "audio",
};

export type DeclaredOutputNodeResolution =
    | { status: "none"; candidates: readonly [] }
    | { status: "unique"; node: CanvasNodeData; candidates: readonly [CanvasNodeData]; explicit: boolean }
    | { status: "ambiguous"; candidates: readonly CanvasNodeData[]; explicit: boolean };

export class AmbiguousDeclaredOutputError extends Error {
    readonly sourceNodeId: string;
    readonly mode: CanvasGenerationMode;
    readonly candidateNodeIds: readonly string[];

    constructor(sourceNodeId: string, mode: CanvasGenerationMode, candidates: readonly CanvasNodeData[]) {
        super(`节点 ${sourceNodeId} 连接了多个 ${mode} 结果槽：${candidates.map((node) => node.id).join("、")}`);
        this.name = "AmbiguousDeclaredOutputError";
        this.sourceNodeId = sourceNodeId;
        this.mode = mode;
        this.candidateNodeIds = candidates.map((node) => node.id);
    }
}

/**
 * Resolves an action's declared output without relying on array order.
 * Explicit result slots take precedence over one legacy compatible node.
 */
export function resolveDeclaredOutputNode(sourceNodeId: string, mode: CanvasGenerationMode, nodes: CanvasNodeData[], connections: CanvasConnection[]): DeclaredOutputNodeResolution {
    const expectedType: CanvasNodeTypeId = OUTPUT_NODE_TYPE[mode];
    const targetIds = new Set(connections.filter((connection) => connection.fromNodeId === sourceNodeId).map((connection) => connection.toNodeId));
    const compatible = nodes.filter((node) => targetIds.has(node.id) && node.type === expectedType);
    const explicit = compatible.filter((node) => node.metadata?.role === "result-slot" && (node.metadata.resultSlotMode === undefined || node.metadata.resultSlotMode === mode));

    if (explicit.length === 1) return { status: "unique", node: explicit[0], candidates: [explicit[0]], explicit: true };
    if (explicit.length > 1) return { status: "ambiguous", candidates: explicit, explicit: true };

    // One pre-result-slot compatible node remains supported while persisted
    // projects migrate. Multiple legacy candidates are still ambiguous.
    const legacy = compatible.filter((node) => node.metadata?.role !== "result-slot");
    if (legacy.length === 1) return { status: "unique", node: legacy[0], candidates: [legacy[0]], explicit: false };
    if (legacy.length > 1) return { status: "ambiguous", candidates: legacy, explicit: false };
    return { status: "none", candidates: [] };
}

/**
 * A compatible node already connected after an action node is a declared
 * output slot. Reusing it keeps a prepared workflow stable; without one the
 * caller may create a new exploratory result node.
 */
export function findDeclaredOutputNode(sourceNodeId: string, mode: CanvasGenerationMode, nodes: CanvasNodeData[], connections: CanvasConnection[]): CanvasNodeData | undefined {
    const resolution = resolveDeclaredOutputNode(sourceNodeId, mode, nodes, connections);
    if (resolution.status === "ambiguous") throw new AmbiguousDeclaredOutputError(sourceNodeId, mode, resolution.candidates);
    return resolution.status === "unique" ? resolution.node : undefined;
}

export function isDeclaredOutputConnection(sourceNodeId: string, targetNodeId: string, connections: CanvasConnection[]) {
    return connections.some((connection) => connection.fromNodeId === sourceNodeId && connection.toNodeId === targetNodeId);
}
