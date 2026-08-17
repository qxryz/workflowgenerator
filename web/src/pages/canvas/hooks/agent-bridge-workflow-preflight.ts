import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import { buildCanvasWorkflowGraph, type CanvasWorkflowGraphIssueCode, type CanvasWorkflowGraphValidationIssue } from "@/lib/canvas/canvas-workflow-graph";
import type { CanvasConnection, CanvasNodeData } from "@/types/canvas";

export type AgentWorkflowPreflightResult = {
    preview: CanvasAgentSnapshot;
    generationNodeIds: string[];
};

export type AgentWorkflowPreflightOptions = {
    /** A persisted receipt must not silently overwrite edits made since its first commit. */
    structureAlreadyApplied?: boolean;
    /** Destructive receipt targets must stay absent; a reused ID may now belong to new user content. */
    receiptRetry?: boolean;
};

/**
 * `run_generation` is an instruction for the executor, but its optional mode
 * and prompt are also persisted on the action node before execution. Keep this
 * materialization shared by the real apply path and its preflight preview.
 */
export function materializeAgentApplyOps(ops?: readonly CanvasAgentOp[]): CanvasAgentOp[] {
    const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
    const generationPatches: CanvasAgentOp[] = safeOps
        .filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId))
        .map((op) => ({
            type: "update_node",
            id: op.nodeId,
            metadata: {
                ...(op.mode ? { generationMode: op.mode } : {}),
                ...(op.prompt?.trim() ? { prompt: op.prompt, composerContent: op.prompt } : {}),
            },
        }));
    return [...safeOps.filter((op) => op.type !== "run_generation"), ...generationPatches];
}

/**
 * Builds the exact post-apply canvas in memory and compiles the workflow that
 * Zodiac is about to run. Nothing is committed until this function succeeds.
 */
export function preflightAgentWorkflowApply(snapshot: CanvasAgentSnapshot, ops?: readonly CanvasAgentOp[], options?: AgentWorkflowPreflightOptions): AgentWorkflowPreflightResult {
    const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
    const generationNodeIds = Array.from(new Set(safeOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation" && Boolean(op.nodeId)).map((op) => op.nodeId)));
    if (options?.receiptRetry) assertDestructiveReceiptTargetsAbsent(snapshot, safeOps);
    const preview = applyCanvasAgentOps(cloneAgentSnapshot(snapshot), materializeAgentApplyOps(safeOps));
    if (options?.structureAlreadyApplied) {
        assertRunConfigurationUnchanged(snapshot, preview, safeOps);
        assertAgentWorkflowPreviewCurrent(preview, snapshot, generationNodeIds);
    }
    if (!generationNodeIds.length) return { preview, generationNodeIds };

    // Compile the selected subgraph first so proposal-local problems get a
    // precise message even if another canvas area is also unfinished.
    const scopedPreview = scopeWorkflowPreview(preview, generationNodeIds);
    const selectedWorkflow = buildCanvasWorkflowGraph({
        nodes: scopedPreview.nodes,
        connections: scopedPreview.connections,
        startNodeIds: generationNodeIds,
    });
    if (!selectedWorkflow.ok) throw new Error(agentWorkflowIssueMessage(selectedWorkflow.issues[0]));
    if (!selectedWorkflow.graph.nodes.length) throw new Error("这套工作流里还没有可运行的步骤");

    // The real canvas runner currently compiles the complete snapshot. Match
    // that boundary as well, otherwise a disconnected corrupt edge would only
    // fail after the proposal had already been committed.
    const fullWorkflow = buildCanvasWorkflowGraph({
        nodes: preview.nodes,
        connections: preview.connections,
        startNodeIds: generationNodeIds,
    });
    if (!fullWorkflow.ok) throw new Error("画布其他区域还有断开的连接，请先整理后再运行");
    return { preview, generationNodeIds };
}

/** Prevents an async receipt save from becoming a gap where a different live graph is executed. */
export function assertAgentWorkflowPreviewCurrent(expected: CanvasAgentSnapshot, current: CanvasAgentSnapshot, generationNodeIds: readonly string[] = []) {
    const expectedScope = generationNodeIds.length ? scopeWorkflowPreview(expected, generationNodeIds) : expected;
    const currentScope = generationNodeIds.length ? scopeWorkflowPreview(current, generationNodeIds) : current;
    const expectedNodes = executionRelevantNodes(expectedScope.nodes);
    const currentNodes = executionRelevantNodes(currentScope.nodes);
    if (!sameValue(expectedNodes, currentNodes) || !sameConnections(expectedScope.connections, currentScope.connections)) {
        throw new Error("画布在提交后发生了变化，请确认当前内容后重新运行");
    }
    if (generationNodeIds.length) {
        const compiled = buildCanvasWorkflowGraph({ nodes: current.nodes, connections: current.connections, startNodeIds: generationNodeIds });
        if (!compiled.ok) throw new Error("画布在提交后发生了变化，请确认当前内容后重新运行");
    }
}

function executionRelevantNodes(nodes: readonly CanvasNodeData[]) {
    return nodes.map((node) => ({ id: node.id, type: node.type, metadata: node.metadata })).sort((left, right) => left.id.localeCompare(right.id) || left.type.localeCompare(right.type));
}

function cloneAgentSnapshot(snapshot: CanvasAgentSnapshot): CanvasAgentSnapshot {
    return cloneValue(snapshot);
}

function assertDestructiveReceiptTargetsAbsent(snapshot: CanvasAgentSnapshot, ops: readonly CanvasAgentOp[]) {
    const nodeById = new Set(snapshot.nodes.map((node) => node.id));
    const connectionById = new Set(snapshot.connections.map((connection) => connection.id));
    const addedNodeIds = new Set(ops.flatMap((op) => (op.type === "add_node" && op.id ? [op.id] : [])));
    const addedNodeTypes = new Set(ops.flatMap((op) => (op.type === "add_node" && op.nodeType ? [op.nodeType] : [])));
    const addedConnectionIds = new Set(ops.flatMap((op) => (op.type === "connect_nodes" && op.id ? [op.id] : [])));
    const addsConnection = ops.some((op) => op.type === "connect_nodes");
    for (const op of ops) {
        if (op.type === "delete_node") {
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            const targetReappeared = ids.some((id) => nodeById.has(id) || addedNodeIds.has(id)) || (op.nodeType ? snapshot.nodes.some((node) => node.type === op.nodeType) || addedNodeTypes.has(op.nodeType) : false);
            if (targetReappeared) throw new Error("删除目标在上次提交后发生了变化，请检查画布后重新发起");
        }
        if (op.type === "delete_connections") {
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            const targetReappeared = ids.some((id) => connectionById.has(id) || addedConnectionIds.has(id)) || (op.all === true && (snapshot.connections.length > 0 || addsConnection));
            if (targetReappeared) throw new Error("要删除的连接在上次提交后发生了变化，请检查画布后重新发起");
        }
    }
}

function assertRunConfigurationUnchanged(snapshot: CanvasAgentSnapshot, preview: CanvasAgentSnapshot, ops: readonly CanvasAgentOp[]) {
    const runNodeIds = new Set(ops.flatMap((op) => (op.type === "run_generation" && op.nodeId ? [op.nodeId] : [])));
    const currentNodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const previewNodeById = new Map(preview.nodes.map((node) => [node.id, node]));
    const runMetadataKeys = ["generationMode", "prompt", "composerContent", "terminalInputMode", "terminalOutputMode"] as const;

    for (const nodeId of runNodeIds) {
        const current = currentNodeById.get(nodeId);
        const expected = previewNodeById.get(nodeId);
        if (!current || !expected) throw new Error("这一步已经不在画布上，请重新发起");
        const changed = runMetadataKeys.some((key) => !sameValue(current.metadata?.[key], expected.metadata?.[key]));
        if (changed) throw new Error("这一步在上次提交后已被修改，请确认当前设置后重新发起");
    }
}

type ScopedWorkflowPreview = Pick<CanvasAgentSnapshot, "nodes" | "connections">;

function scopeWorkflowPreview(snapshot: CanvasAgentSnapshot, startNodeIds: readonly string[]): ScopedWorkflowPreview {
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const incomingByNodeId = indexConnections(snapshot.connections, "toNodeId");
    const outgoingByNodeId = indexConnections(snapshot.connections, "fromNodeId");
    const actionEdges = new Map<string, Set<string>>();

    for (const slot of snapshot.nodes) {
        if (!isResultSlot(slot)) continue;
        const sourceActionIds = new Set(
            (incomingByNodeId.get(slot.id) || [])
                .map((connection) => nodeById.get(connection.fromNodeId))
                .filter((node): node is CanvasNodeData => Boolean(node && isActionNode(node)))
                .map((node) => node.id),
        );
        if (sourceActionIds.size !== 1) continue;
        const sourceActionId = sourceActionIds.values().next().value as string;
        for (const connection of outgoingByNodeId.get(slot.id) || []) {
            const target = nodeById.get(connection.toNodeId);
            if (!target || !isActionNode(target)) continue;
            const targets = actionEdges.get(sourceActionId) || new Set<string>();
            targets.add(target.id);
            actionEdges.set(sourceActionId, targets);
        }
    }

    const selectedActionIds = new Set<string>();
    const queue: string[] = [];
    for (const startNodeId of new Set(startNodeIds)) {
        const node = nodeById.get(startNodeId);
        if (!node || !isActionNode(node)) continue;
        selectedActionIds.add(startNodeId);
        queue.push(startNodeId);
    }
    while (queue.length) {
        const actionId = queue.shift()!;
        for (const targetId of actionEdges.get(actionId) || []) {
            if (selectedActionIds.has(targetId)) continue;
            selectedActionIds.add(targetId);
            queue.push(targetId);
        }
    }

    const relevantNodeIds = new Set(startNodeIds);
    selectedActionIds.forEach((id) => relevantNodeIds.add(id));
    const relevantSlotIds = new Set<string>();
    const selectedOutputSlotIds = new Set<string>();
    const relevantConnectionIds = new Set<string>();

    // First collect every edge touching a selected action. Then expand result
    // slots once more to retain all physical writers and consumers needed by
    // the compiler's explicit slot contract.
    let changed = true;
    while (changed) {
        changed = false;
        for (const connection of snapshot.connections) {
            const touchesSelectedAction = selectedActionIds.has(connection.fromNodeId) || selectedActionIds.has(connection.toNodeId);
            const writesRelevantSlot = relevantSlotIds.has(connection.toNodeId);
            const consumesRelevantSlot = relevantSlotIds.has(connection.fromNodeId) && (selectedOutputSlotIds.has(connection.fromNodeId) || selectedActionIds.has(connection.toNodeId));
            const touchesRelevantSlot = writesRelevantSlot || consumesRelevantSlot;
            if (!touchesSelectedAction && !touchesRelevantSlot) continue;
            if (!relevantConnectionIds.has(connection.id)) {
                relevantConnectionIds.add(connection.id);
                changed = true;
            }
            for (const nodeId of [connection.fromNodeId, connection.toNodeId]) {
                if (!relevantNodeIds.has(nodeId)) {
                    relevantNodeIds.add(nodeId);
                    changed = true;
                }
                const node = nodeById.get(nodeId);
                if (node && isResultSlot(node) && !relevantSlotIds.has(nodeId)) {
                    relevantSlotIds.add(nodeId);
                    changed = true;
                }
                if (node && isResultSlot(node) && connection.toNodeId === nodeId && selectedActionIds.has(connection.fromNodeId) && !selectedOutputSlotIds.has(nodeId)) {
                    selectedOutputSlotIds.add(nodeId);
                    changed = true;
                }
            }
        }
    }

    return {
        // Filter the original array so duplicate relevant IDs remain visible to
        // the compiler instead of being hidden by the lookup map above.
        nodes: snapshot.nodes.filter((node) => relevantNodeIds.has(node.id)),
        connections: snapshot.connections.filter((connection) => relevantConnectionIds.has(connection.id)),
    };
}

function indexConnections(connections: readonly CanvasConnection[], key: "fromNodeId" | "toNodeId") {
    const index = new Map<string, CanvasConnection[]>();
    for (const connection of connections) {
        const list = index.get(connection[key]) || [];
        list.push(connection);
        index.set(connection[key], list);
    }
    return index;
}

function isActionNode(node: CanvasNodeData) {
    return node.type === "config" || node.type === "terminal";
}

function isResultSlot(node: CanvasNodeData) {
    return node.metadata?.role === "result-slot";
}

function agentWorkflowIssueMessage(issue?: CanvasWorkflowGraphValidationIssue) {
    const code: CanvasWorkflowGraphIssueCode | undefined = issue?.code;
    if (code === "missing_output_slot") return "有步骤还没有结果槽，补好后即可运行";
    if (code === "ambiguous_output_slot") return "有步骤连接了多个结果槽，请只保留一个";
    if (code === "pending_input") return "上游结果还没有就绪，请先完成上一步";
    if (code === "direct_action_connection") return "两个生成步骤之间需要一个结果槽";
    if (code === "workflow_cycle") return "工作流中存在循环，请调整步骤顺序";
    if (code === "missing_action_mode" || code === "result_slot_mode_mismatch") return "有步骤的输出类型和结果槽不匹配";
    if (code === "unknown_start_node" || code === "start_node_not_action") return "要运行的步骤已经不在画布上";
    if (code === "result_slot_source_missing" || code === "result_slot_source_ambiguous" || code === "result_slot_source_not_action" || code === "result_slot_source_mismatch") {
        return "有结果槽没有连接到正确的生成步骤";
    }
    return "这套工作流的连接还不完整，请检查后再运行";
}

function sameValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left)) {
        return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
    }
    if (left && typeof left === "object") {
        if (!right || typeof right !== "object" || Array.isArray(right)) return false;
        const leftRecord = left as Record<string, unknown>;
        const rightRecord = right as Record<string, unknown>;
        const keys = Object.keys(leftRecord);
        return keys.length === Object.keys(rightRecord).length && keys.every((key) => sameValue(leftRecord[key], rightRecord[key]));
    }
    return left === right;
}

function sameConnections(left: readonly CanvasConnection[], right: readonly CanvasConnection[]) {
    if (left.length !== right.length) return false;
    const rightKeys = new Map<string, number>();
    for (const connection of right) {
        const key = `${connection.fromNodeId}\u0000${connection.toNodeId}`;
        rightKeys.set(key, (rightKeys.get(key) || 0) + 1);
    }
    for (const connection of left) {
        const key = `${connection.fromNodeId}\u0000${connection.toNodeId}`;
        const count = rightKeys.get(key) || 0;
        if (!count) return false;
        if (count === 1) rightKeys.delete(key);
        else rightKeys.set(key, count - 1);
    }
    return rightKeys.size === 0;
}

function cloneValue<T>(value: T): T {
    if (Array.isArray(value)) return value.map((item) => cloneValue(item)) as T;
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, cloneValue(item)])) as T;
    }
    return value;
}
