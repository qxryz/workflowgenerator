import type { CanvasAgentOp } from "../canvas/canvas-agent-ops";

type KnownNode = {
    id: string;
    type: string;
    title?: string;
    metadata?: Record<string, unknown>;
};

type KnownConnection = { fromNodeId: string; toNodeId: string };

/** Short acknowledgements mean "continue from the canvas", never "start over". */
export function isZodiacContinuationRequest(request: string) {
    const compact = request.trim().replace(/[\s。！!，,？?]+/gu, "");
    return /^(?:好|好的|好了|可以|可以了|可以下一步|可以下一步了|确认|确认了|继续|继续吧|下一步|下一步吧|开始|开始吧|就这样|没问题|按这个来|往下|执行|执行吧)$/u.test(compact);
}

/**
 * Reuses the unique semantic stage already present on the canvas. This runs
 * after protocol normalization, so every result slot has an explicit owner and
 * no title-based guessing is needed for data nodes.
 */
export function reconcileZodiacContinuationOps(
    ops: CanvasAgentOp[],
    request: string,
    knownNodes: KnownNode[] = [],
    knownConnections: KnownConnection[] = [],
) {
    if (!isZodiacContinuationRequest(request) || !knownNodes.length) return ops;
    if (ops.some((op) => op.type === "delete_node" || op.type === "delete_connections")) return ops;

    const aliases = new Map<string, string>();
    const claimedExisting = new Set<string>();
    const additions = ops.filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node" && Boolean(op.id));
    const actionAdditions = additions.filter((op) => op.nodeType === "config" || op.nodeType === "terminal");

    actionAdditions.forEach((addition) => {
        const candidates = knownNodes
            .filter((node) => node.type === addition.nodeType && !claimedExisting.has(node.id))
            .map((node) => ({ node, score: actionReuseScore(addition, node) }))
            .filter((candidate) => candidate.score >= 6)
            .sort((left, right) => right.score - left.score);
        if (!candidates.length || (candidates[1] && candidates[1].score === candidates[0].score)) return;
        aliases.set(addition.id!, candidates[0].node.id);
        claimedExisting.add(candidates[0].node.id);
    });

    additions
        .filter((addition) => addition.metadata?.role === "result-slot" && addition.metadata.resultSlotSourceNodeId)
        .forEach((addition) => {
            const ownerId = aliases.get(addition.metadata!.resultSlotSourceNodeId as string) || addition.metadata!.resultSlotSourceNodeId as string;
            const mode = addition.metadata?.resultSlotMode || addition.nodeType;
            const candidates = knownNodes.filter((node) =>
                !claimedExisting.has(node.id) &&
                node.metadata?.role === "result-slot" &&
                node.metadata?.resultSlotSourceNodeId === ownerId &&
                (node.metadata?.resultSlotMode || node.type) === mode,
            );
            if (candidates.length !== 1) return;
            aliases.set(addition.id!, candidates[0].id);
            claimedExisting.add(candidates[0].id);
        });

    if (!aliases.size) return ops;
    const knownEdges = new Set(knownConnections.map((connection) => edgeKey(connection.fromNodeId, connection.toNodeId)));
    const proposedEdges = new Set<string>();
    const rewritten = ops.flatMap<CanvasAgentOp>((op) => {
        if (op.type === "add_node" && op.id && aliases.has(op.id)) return [];
        const next = rewriteOp(op, aliases);
        if (next.type !== "connect_nodes") return [next];
        if (next.fromNodeId === next.toNodeId) return [];
        const key = edgeKey(next.fromNodeId, next.toNodeId);
        if (knownEdges.has(key) || proposedEdges.has(key)) return [];
        proposedEdges.add(key);
        return [next];
    });
    const hasMeaningfulChange = rewritten.some((op) => op.type !== "set_viewport" && op.type !== "select_nodes");
    return hasMeaningfulChange ? rewritten : [];
}

function actionReuseScore(addition: Extract<CanvasAgentOp, { type: "add_node" }>, known: KnownNode) {
    const proposedMode = stringValue(addition.metadata?.generationMode || addition.metadata?.terminalOutputMode || addition.nodeType);
    const knownMode = stringValue(known.metadata?.generationMode || known.metadata?.terminalOutputMode || known.type);
    if (!proposedMode || proposedMode !== knownMode) return -1;
    const proposedPrompt = normalizedText(addition.metadata?.prompt || addition.metadata?.composerContent);
    const knownPrompt = normalizedText(known.metadata?.prompt || known.metadata?.composerContent);
    if (proposedPrompt && knownPrompt && proposedPrompt !== knownPrompt) return -1;
    const proposedTitle = normalizedText(addition.title);
    const knownTitle = normalizedText(known.title);
    const proposedStage = actionStage(addition.title, proposedPrompt, proposedMode);
    const knownStage = actionStage(known.title, knownPrompt, knownMode);
    let score = proposedStage === knownStage ? 6 : 0;
    if (proposedTitle && proposedTitle === knownTitle) score += 4;
    if (proposedPrompt && proposedPrompt === knownPrompt) score += 6;
    if (!proposedPrompt && knownPrompt) score += 1;
    return score;
}

function actionStage(title: unknown, prompt: string, mode: string) {
    const text = `${stringValue(title) || ""}${prompt}`;
    if (/(?:首帧|第一帧|关键帧|起始帧|封面)/u.test(text)) return `${mode}:first-frame`;
    if (/(?:分镜|镜头表|故事板)/u.test(text)) return `${mode}:storyboard`;
    if (/(?:视频|成片|动画|动态)/u.test(text)) return `${mode}:video`;
    if (/(?:配音|音频|音乐|旁白)/u.test(text)) return `${mode}:audio`;
    if (/(?:脚本|文案|提示词)/u.test(text)) return `${mode}:copy`;
    return `${mode}:generic`;
}

function rewriteOp(op: CanvasAgentOp, aliases: Map<string, string>): CanvasAgentOp {
    const rewrite = (id: string) => aliases.get(id) || id;
    if (op.type === "connect_nodes") return { ...op, fromNodeId: rewrite(op.fromNodeId), toNodeId: rewrite(op.toNodeId) };
    if (op.type === "update_node") return { ...op, id: rewrite(op.id) };
    if (op.type === "run_generation") return { ...op, nodeId: rewrite(op.nodeId) };
    if (op.type === "select_nodes") return { ...op, ids: op.ids.map(rewrite) };
    if (op.type === "delete_node") return { ...op, ...(op.id ? { id: rewrite(op.id) } : {}), ...(op.ids ? { ids: op.ids.map(rewrite) } : {}) };
    return op;
}

function normalizedText(value: unknown) {
    return stringValue(value)?.replace(/[\s\p{P}\p{S}]+/gu, "").toLowerCase() || "";
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function edgeKey(fromNodeId: string, toNodeId: string) {
    return `${fromNodeId}\u0000${toNodeId}`;
}
