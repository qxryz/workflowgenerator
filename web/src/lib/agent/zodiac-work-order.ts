import type { CanvasAgentOp, CanvasAgentSnapshot } from "../canvas/canvas-agent-ops";
import type { CanvasGenerationMode, CanvasNodeData } from "../../types/canvas";

export type ZodiacWorkOrderStep = {
    nodeId: string;
    title: string;
    kind: "generation" | "terminal";
    mode: CanvasGenerationMode;
    prompt: string;
    model?: string;
    inputNodeIds: string[];
    outputNodeId?: string;
};

export type ZodiacWorkOrderIssue = {
    code: "missing_prompt" | "missing_output";
    nodeId: string;
    title: string;
    message: string;
};

export type ZodiacWorkOrder = {
    version: 1;
    summary: string;
    steps: ZodiacWorkOrderStep[];
    issues: ZodiacWorkOrderIssue[];
};

export type ZodiacWorkOrderSnapshot = {
    projectId?: string;
    title?: string;
    nodes: Array<Pick<CanvasNodeData, "id" | "type" | "title" | "position" | "metadata"> & Partial<Pick<CanvasNodeData, "width" | "height">>>;
    connections: Array<{ id?: string; fromNodeId: string; toNodeId: string }>;
    selectedNodeIds?: string[];
    viewport?: CanvasAgentSnapshot["viewport"];
};

/**
 * A work order is the durable contract between provider output and the canvas.
 * It is intentionally derived from normalized operations rather than prose, so
 * the approval UI and the apply boundary inspect the exact same configuration.
 */
export function buildZodiacWorkOrder(
    ops: readonly CanvasAgentOp[],
    snapshot?: ZodiacWorkOrderSnapshot,
    summary = "画布方案",
): ZodiacWorkOrder {
    const base = normalizeSnapshot(snapshot);
    const preview = applyWorkOrderOps(base, materializeWorkOrderOps(ops));
    const nodeById = new Map(preview.nodes.map((node) => [node.id, node]));
    const affectedActionIds = collectAffectedActionIds(ops, nodeById);
    const addedOrRunActionIds = new Set(ops.flatMap((op) => {
        if (op.type === "add_node" && op.id && isActionType(op.nodeType)) return [op.id];
        if (op.type === "run_generation") return [op.nodeId];
        return [];
    }));

    const steps = [...affectedActionIds]
        .map((nodeId) => nodeById.get(nodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isActionType(node.type)))
        .map((node): ZodiacWorkOrderStep => {
            const prompt = workOrderPrompt(node);
            const output = preview.nodes.find((candidate) =>
                candidate.metadata?.role === "result-slot" && candidate.metadata.resultSlotSourceNodeId === node.id,
            ) || preview.connections
                .filter((connection) => connection.fromNodeId === node.id)
                .map((connection) => nodeById.get(connection.toNodeId))
                .find((candidate) => candidate?.metadata?.role === "result-slot");
            const inputNodeIds = preview.connections
                .filter((connection) => connection.toNodeId === node.id)
                .map((connection) => connection.fromNodeId)
                .filter((id, index, values) => values.indexOf(id) === index);
            return {
                nodeId: node.id,
                title: node.title,
                kind: node.type === "terminal" ? "terminal" : "generation",
                mode: actionMode(node),
                prompt,
                ...(node.metadata?.model?.trim() ? { model: node.metadata.model.trim() } : {}),
                inputNodeIds,
                ...(output ? { outputNodeId: output.id } : {}),
            };
        });

    const issues: ZodiacWorkOrderIssue[] = [];
    steps.forEach((step) => {
        if (addedOrRunActionIds.has(step.nodeId) && !step.prompt) {
            issues.push({
                code: "missing_prompt",
                nodeId: step.nodeId,
                title: step.title,
                message: `「${step.title}」还没有装配创作内容`,
            });
        }
        if (addedOrRunActionIds.has(step.nodeId) && !step.outputNodeId) {
            issues.push({
                code: "missing_output",
                nodeId: step.nodeId,
                title: step.title,
                message: `「${step.title}」还没有绑定结果槽`,
            });
        }
    });

    return { version: 1, summary, steps, issues };
}

export function assertZodiacWorkOrderReady(order: ZodiacWorkOrder) {
    if (!order.issues.length) return;
    throw new Error(order.issues.map((issue) => issue.message).join("；"));
}

/** Verifies semantic configuration after the canvas has committed the plan. */
export function assertZodiacWorkOrderApplied(order: ZodiacWorkOrder, snapshot: Pick<CanvasAgentSnapshot, "nodes" | "connections">) {
    assertZodiacWorkOrderReady(order);
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    order.steps.forEach((step) => {
        const node = nodeById.get(step.nodeId);
        if (!node || !isActionType(node.type)) throw new Error(`「${step.title}」没有写入画布`);
        if (normalizeText(workOrderPrompt(node)) !== normalizeText(step.prompt)) throw new Error(`「${step.title}」的创作内容没有完整写入`);
        if (step.model && normalizeText(node.metadata?.model) !== normalizeText(step.model)) throw new Error(`「${step.title}」的模型设置没有完整写入`);
        if (step.outputNodeId) {
            const output = nodeById.get(step.outputNodeId);
            const connected = snapshot.connections.some((connection) => connection.fromNodeId === step.nodeId && connection.toNodeId === step.outputNodeId);
            if (!output || output.metadata?.role !== "result-slot" || output.metadata.resultSlotSourceNodeId !== step.nodeId || !connected) {
                throw new Error(`「${step.title}」的结果槽没有完整装配`);
            }
        }
        step.inputNodeIds.forEach((inputNodeId) => {
            if (!snapshot.connections.some((connection) => connection.fromNodeId === inputNodeId && connection.toNodeId === step.nodeId)) {
                throw new Error(`「${step.title}」的输入连接没有完整装配`);
            }
        });
    });
}

function collectAffectedActionIds(ops: readonly CanvasAgentOp[], nodeById: Map<string, CanvasNodeData>) {
    const ids = new Set<string>();
    ops.forEach((op) => {
        if (op.type === "add_node" && op.id && isActionType(op.nodeType)) ids.add(op.id);
        if (op.type === "update_node" && isActionType(nodeById.get(op.id)?.type)) ids.add(op.id);
        if (op.type === "run_generation") ids.add(op.nodeId);
    });
    return ids;
}

function materializeWorkOrderOps(ops: readonly CanvasAgentOp[]): CanvasAgentOp[] {
    const patches: CanvasAgentOp[] = ops.flatMap((op) => op.type === "run_generation"
        ? [{
            type: "update_node" as const,
            id: op.nodeId,
            metadata: {
                ...(op.mode ? { generationMode: op.mode } : {}),
                ...(op.prompt?.trim() ? { prompt: op.prompt.trim(), composerContent: op.prompt.trim() } : {}),
            },
        }]
        : [op]);
    return patches;
}

function applyWorkOrderOps(snapshot: CanvasAgentSnapshot, ops: readonly CanvasAgentOp[]): CanvasAgentSnapshot {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    ops.forEach((op, index) => {
        if (op.type === "add_node") {
            const id = op.id || `zodiac-work-order-node-${index}`;
            if (nodes.some((node) => node.id === id)) return;
            nodes = [...nodes, {
                id,
                type: op.nodeType || "text",
                title: op.title || "未命名步骤",
                position: op.position || { x: op.x || 0, y: op.y || 0 },
                width: op.width || 360,
                height: op.height || 240,
                metadata: op.metadata,
            }];
        } else if (op.type === "update_node") {
            nodes = nodes.map((node) => node.id === op.id
                ? { ...node, ...op.patch, metadata: { ...node.metadata, ...op.patch?.metadata, ...op.metadata } }
                : node);
        } else if (op.type === "delete_node") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            if (op.nodeType) nodes.filter((node) => node.type === op.nodeType).forEach((node) => ids.add(node.id));
            nodes = nodes.filter((node) => !ids.has(node.id));
            connections = connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId));
        } else if (op.type === "delete_connections") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            connections = op.all ? [] : connections.filter((connection) => !ids.has(connection.id));
        } else if (op.type === "connect_nodes") {
            if (!connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId)) {
                connections = [...connections, { id: op.id || `zodiac-work-order-link-${index}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
            }
        }
    });
    return { ...snapshot, nodes, connections };
}

function workOrderPrompt(node: CanvasNodeData) {
    return firstText(node.metadata?.prompt, node.metadata?.composerContent, node.metadata?.terminalCommand);
}

function actionMode(node: CanvasNodeData): CanvasGenerationMode {
    const value = node.type === "terminal" ? node.metadata?.terminalOutputMode : node.metadata?.generationMode;
    return isGenerationMode(value) ? value : "text";
}

function isActionType(value: unknown) {
    return value === "config" || value === "terminal";
}

function isGenerationMode(value: unknown): value is CanvasGenerationMode {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function firstText(...values: unknown[]) {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) return value.trim();
    }
    return "";
}

function normalizeText(value: unknown) {
    return typeof value === "string" ? value.trim().replace(/\s+/gu, " ") : "";
}

function emptySnapshot(): CanvasAgentSnapshot {
    return {
        projectId: "zodiac-work-order",
        title: "画布方案",
        nodes: [],
        connections: [],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

function normalizeSnapshot(snapshot?: ZodiacWorkOrderSnapshot): CanvasAgentSnapshot {
    if (!snapshot) return emptySnapshot();
    return {
        projectId: snapshot.projectId || "zodiac-work-order",
        title: snapshot.title || "画布方案",
        nodes: snapshot.nodes.map((node) => ({ ...node, width: node.width || 360, height: node.height || 240 })),
        connections: snapshot.connections.map((connection, index) => ({ ...connection, id: connection.id || `zodiac-work-order-link-${index}` })),
        selectedNodeIds: snapshot.selectedNodeIds || [],
        viewport: snapshot.viewport || { x: 0, y: 0, k: 1 },
    };
}
