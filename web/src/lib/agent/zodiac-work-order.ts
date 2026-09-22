import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "../canvas/canvas-agent-ops.ts";
import type { CanvasGenerationMode, CanvasNodeData } from "../../types/canvas";
import { resolveCanvasInputBindings } from "../canvas/canvas-input-bindings.ts";
import { getCanvasInputSources } from "../canvas/canvas-group-inputs.ts";
import { findCanvasResultSlotSourceAction } from "../canvas/canvas-workflow-graph.ts";

export type ZodiacWorkOrderStep = {
    nodeId: string;
    title: string;
    kind: "generation";
    mode: CanvasGenerationMode;
    prompt: string;
    model?: string;
    inputNodeIds: string[];
    inputs?: Array<{
        nodeId: string;
        title: string;
        type: string;
        groupTitle?: string;
        assetKind?: "character" | "scene";
        groupPrompt?: string;
        members?: Array<{ nodeId: string; title: string; type: string; selected: boolean }>;
        selected: boolean;
    }>;
    outputNodeId?: string;
};

export type ZodiacWorkOrderIssue = {
    code: "missing_prompt" | "missing_output" | "missing_input" | "missing_content";
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
export function buildZodiacWorkOrder(ops: readonly CanvasAgentOp[], snapshot?: ZodiacWorkOrderSnapshot, summary = "画布方案"): ZodiacWorkOrder {
    const base = normalizeSnapshot(snapshot);
    const preview = applyWorkOrderOps(base, materializeWorkOrderOps(ops));
    const nodeById = new Map(preview.nodes.map((node) => [node.id, node]));
    const affectedActionIds = collectAffectedActionIds(ops, nodeById);
    const addedOrRunActionIds = new Set(
        ops.flatMap((op) => {
            if (op.type === "add_node" && op.id && isActionType(op.nodeType)) return [op.id];
            if (op.type === "run_generation") return [op.nodeId];
            return [];
        }),
    );

    const steps = [...affectedActionIds]
        .map((nodeId) => nodeById.get(nodeId))
        .filter((node): node is CanvasNodeData => Boolean(node && isActionType(node.type)))
        .map((node): ZodiacWorkOrderStep => {
            const prompt = workOrderPrompt(node);
            const output =
                preview.nodes.find((candidate) => candidate.metadata?.role === "result-slot" && candidate.metadata.resultSlotSourceNodeId === node.id) ||
                preview.connections
                    .filter((connection) => connection.fromNodeId === node.id)
                    .map((connection) => nodeById.get(connection.toNodeId))
                    .find((candidate) => candidate?.metadata?.role === "result-slot");
            const inputNodeIds = preview.connections
                .filter((connection) => connection.toNodeId === node.id)
                .map((connection) => connection.fromNodeId)
                .filter((id, index, values) => values.indexOf(id) === index);
            const bindings = resolveCanvasInputBindings(workOrderInputs(node.id, preview), prompt);
            const selectedIds = new Set(bindings.selectedInputs.map((input) => input.nodeId));
            const inputs = inputNodeIds.map((nodeId) => {
                const input = nodeById.get(nodeId);
                const group = input?.metadata?.groupId ? nodeById.get(input.metadata.groupId) : undefined;
                const members =
                    input?.type === "group"
                        ? getCanvasInputSources(node.id, preview.nodes, [{ fromNodeId: nodeId, toNodeId: node.id }])
                              .filter((source) => source.node.id !== nodeId && source.node.type !== "group")
                              .map(({ node: member }) => ({ nodeId: member.id, title: member.title, type: member.type, selected: selectedIds.has(member.id) }))
                        : undefined;
                return {
                    nodeId,
                    title: input?.title || "素材已移除",
                    type: input?.type || "unknown",
                    ...(group ? { groupTitle: group.title } : {}),
                    ...(input?.type === "group" ? { members, assetKind: input.metadata?.assetKind, groupPrompt: input.metadata?.groupPrompt } : {}),
                    selected: selectedIds.has(nodeId) || Boolean(members?.some((member) => member.selected)),
                };
            });
            return {
                nodeId: node.id,
                title: node.title,
                kind: "generation",
                mode: actionMode(node),
                prompt,
                ...(node.metadata?.model?.trim() ? { model: node.metadata.model.trim() } : {}),
                inputNodeIds,
                inputs,
                ...(output ? { outputNodeId: output.id } : {}),
            };
        });

    const issues: ZodiacWorkOrderIssue[] = [];
    const addedNodeIds = new Set(ops.flatMap((op, index) => (op.type === "add_node" ? [op.id || `zodiac-work-order-node-${index}`] : [])));
    for (const node of preview.nodes) {
        if (addedNodeIds.has(node.id) && node.type === "text" && !hasWorkOrderTextSource(node, preview)) {
            issues.push({ code: "missing_content", nodeId: node.id, title: node.title, message: `「${node.title}」还没有写入正文，请补全内容` });
        }
    }
    steps.forEach((step) => {
        const available = workOrderInputs(step.nodeId, preview);
        const bindings = resolveCanvasInputBindings(available, step.prompt);
        const unresolved = bindings.tokens.filter((token) => !token.input);
        if (unresolved.length || (!bindings.hasTokens && available.some((input) => !input.ready))) issues.push({ code: "missing_input", nodeId: step.nodeId, title: step.title, message: `「${step.title}」引用的素材尚未连接或组内容无效，请重新选择素材` });
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

function workOrderInputs(nodeId: string, snapshot: CanvasAgentSnapshot) {
    const inputs = getCanvasInputSources(nodeId, snapshot.nodes, snapshot.connections).map(({ node, bindingNodeIds }) => ({
        nodeId: node.id,
        bindingNodeIds,
        ready: node.type !== "group" && (node.type !== "text" || hasWorkOrderTextSource(node, snapshot)),
    }));
    const knownIds = new Set(snapshot.nodes.map((node) => node.id));
    for (const edge of snapshot.connections) {
        if (edge.toNodeId === nodeId && !knownIds.has(edge.fromNodeId)) inputs.push({ nodeId: edge.fromNodeId, bindingNodeIds: [], ready: false });
    }
    return inputs;
}

/** Authored text needs a body; an owned text result may still be waiting for its writer. */
function hasWorkOrderTextSource(node: CanvasNodeData, snapshot: CanvasAgentSnapshot) {
    if (firstText(node.metadata?.content)) return true;
    if (node.metadata?.role !== "result-slot") return false;
    const source = findCanvasResultSlotSourceAction(node.id, snapshot.nodes, snapshot.connections);
    return source.status === "unique" && source.action.id === node.metadata.resultSlotSourceNodeId && actionMode(source.action) === "text";
}

function collectAffectedActionIds(ops: readonly CanvasAgentOp[], nodeById: Map<string, CanvasNodeData>) {
    const ids = new Set<string>();
    ops.forEach((op) => {
        if (op.type === "add_node" && op.id && isActionType(op.nodeType)) ids.add(op.id);
        if (op.type === "update_node" && isActionType(nodeById.get(op.id)?.type)) ids.add(op.id);
        if (op.type === "run_generation") ids.add(op.nodeId);
        if (op.type === "connect_nodes" && isActionType(nodeById.get(op.toNodeId)?.type)) ids.add(op.toNodeId);
    });
    return ids;
}

function materializeWorkOrderOps(ops: readonly CanvasAgentOp[]): CanvasAgentOp[] {
    const patches: CanvasAgentOp[] = ops.flatMap((op) =>
        op.type === "run_generation"
            ? [
                  {
                      type: "update_node" as const,
                      id: op.nodeId,
                      metadata: {
                          ...(op.mode ? { generationMode: op.mode } : {}),
                          ...(op.prompt?.trim() ? { prompt: op.prompt.trim(), composerContent: op.prompt.trim() } : {}),
                      },
                  },
              ]
            : [op],
    );
    return patches;
}

function applyWorkOrderOps(snapshot: CanvasAgentSnapshot, ops: readonly CanvasAgentOp[]): CanvasAgentSnapshot {
    let nodes = snapshot.nodes;
    let connections = snapshot.connections;
    let selectedNodeIds = snapshot.selectedNodeIds;
    ops.forEach((op, index) => {
        if (op.type === "add_node") {
            const id = op.id || `zodiac-work-order-node-${index}`;
            if (nodes.some((node) => node.id === id)) return;
            nodes = [
                ...nodes,
                {
                    id,
                    type: op.nodeType || "text",
                    title: op.title || "未命名步骤",
                    position: op.position || { x: op.x || 0, y: op.y || 0 },
                    width: op.width || 360,
                    height: op.height || 240,
                    metadata: op.metadata,
                },
            ];
        } else if (op.type === "update_node" || op.type === "delete_node") {
            // Group geometry and descendant deletion must match the apply
            // boundary; keep one implementation for preview and execution.
            ({ nodes, connections, selectedNodeIds } = applyCanvasAgentOps({ ...snapshot, nodes, connections, selectedNodeIds }, [op]));
        } else if (op.type === "delete_connections") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            connections = op.all ? [] : connections.filter((connection) => !ids.has(connection.id));
        } else if (op.type === "connect_nodes") {
            if (!connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId)) {
                connections = [...connections, { id: op.id || `zodiac-work-order-link-${index}`, fromNodeId: op.fromNodeId, toNodeId: op.toNodeId }];
            }
        }
    });
    return { ...snapshot, nodes, connections, selectedNodeIds };
}

function workOrderPrompt(node: CanvasNodeData) {
    return firstText(node.metadata?.prompt, node.metadata?.composerContent);
}

function actionMode(node: CanvasNodeData): CanvasGenerationMode {
    const value = node.metadata?.generationMode;
    return isGenerationMode(value) ? value : "text";
}

function isActionType(value: unknown) {
    return value === "config";
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
