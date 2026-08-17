import type { CanvasConnection, CanvasGenerationMode, CanvasNodeData, CanvasNodeTypeId, CanvasResultSlotVersion } from "../../types/canvas";
import type { WorkflowExecutionEdge, WorkflowExecutionGraph, WorkflowExecutionNode } from "./workflow-execution";

export type CanvasWorkflowSourceSnapshot = Readonly<{
    sourceNodeId: string;
    sourceNodeType: CanvasNodeTypeId;
    sourceActionNodeId?: string;
    /** Present only when the workflow reuses an already persisted result. */
    versionId?: string;
    resolution: "workflow" | "frozen";
}>;

export type CanvasWorkflowNodeData = Readonly<{
    actionNodeId: string;
    mode: CanvasGenerationMode;
    prompt: string;
    outputSlotId: string;
    sourceSnapshot: readonly CanvasWorkflowSourceSnapshot[];
}>;

export type CanvasWorkflowGraphIssueCode =
    | "duplicate_node_id"
    | "unknown_connection_source"
    | "unknown_connection_target"
    | "unknown_start_node"
    | "start_node_not_action"
    | "missing_action_mode"
    | "missing_output_slot"
    | "ambiguous_output_slot"
    | "invalid_result_slot"
    | "result_slot_mode_mismatch"
    | "result_slot_source_missing"
    | "result_slot_source_ambiguous"
    | "result_slot_source_not_action"
    | "result_slot_source_mismatch"
    | "direct_action_connection"
    | "pending_input"
    | "workflow_cycle";

export type CanvasWorkflowGraphValidationIssue = Readonly<{
    code: CanvasWorkflowGraphIssueCode;
    message: string;
    nodeId?: string;
    slotId?: string;
    connectionId?: string;
    relatedNodeIds?: readonly string[];
}>;

export type CanvasWorkflowGraphBuildOptions = {
    nodes: readonly CanvasNodeData[];
    connections: readonly CanvasConnection[];
    /** Runs the selected actions and their reachable downstream actions only. */
    startNodeIds?: readonly string[];
};

export type CanvasWorkflowGraphBuildResult =
    | { ok: true; graph: WorkflowExecutionGraph<CanvasWorkflowNodeData>; issues: readonly [] }
    | { ok: false; graph: null; issues: readonly CanvasWorkflowGraphValidationIssue[] };

export type CanvasResultSlotSourceActionResolution =
    | { status: "unique"; action: CanvasNodeData; issues: readonly [] }
    | { status: "not_found" | "invalid" | "missing" | "ambiguous"; issues: readonly CanvasWorkflowGraphValidationIssue[] };

type GraphIndex = {
    nodeById: Map<string, CanvasNodeData>;
    incomingByNodeId: Map<string, CanvasConnection[]>;
    outgoingByNodeId: Map<string, CanvasConnection[]>;
};

/**
 * Compiles the canvas topology into the action-only DAG consumed by the
 * workflow executor. Result-slot nodes are retained in frozen node data, not
 * as executable nodes.
 */
export function buildCanvasWorkflowGraph(options: CanvasWorkflowGraphBuildOptions): CanvasWorkflowGraphBuildResult {
    const issues: CanvasWorkflowGraphValidationIssue[] = [];
    const index = createGraphIndex(options.nodes, options.connections, issues);
    const actions = options.nodes.filter(isActionNode);
    const actionIds = new Set(actions.map((node) => node.id));
    const actionEdges = collectActionEdges(options.nodes, index);
    const selectedActionIds = selectActionIds(options.startNodeIds, actionIds, actionEdges, index, issues);

    const executionNodes: WorkflowExecutionNode<CanvasWorkflowNodeData>[] = [];
    const executionEdges: WorkflowExecutionEdge[] = [];
    const edgeKeys = new Set<string>();

    for (const action of actions) {
        if (!selectedActionIds.has(action.id)) continue;
        const mode = actionMode(action);
        if (!mode) {
            issues.push(issue("missing_action_mode", `Action node ${action.id} does not declare an execution output mode`, { nodeId: action.id }));
        }

        const outputCandidates = (index.outgoingByNodeId.get(action.id) || [])
            .map((connection) => index.nodeById.get(connection.toNodeId))
            .filter((node): node is CanvasNodeData => node?.metadata?.role === "result-slot");
        const uniqueOutputCandidates = uniqueNodes(outputCandidates);
        if (uniqueOutputCandidates.length === 0) {
            issues.push(issue("missing_output_slot", `Action node ${action.id} requires one explicit result slot`, { nodeId: action.id }));
            continue;
        }
        if (uniqueOutputCandidates.length > 1) {
            issues.push(
                issue("ambiguous_output_slot", `Action node ${action.id} has multiple explicit result slots`, {
                    nodeId: action.id,
                    relatedNodeIds: uniqueOutputCandidates.map((node) => node.id),
                }),
            );
            continue;
        }

        const outputSlot = uniqueOutputCandidates[0];
        const outputSlotIssues = validateResultSlot(outputSlot, mode);
        issues.push(...outputSlotIssues);
        const outputSource = findCanvasResultSlotSourceAction(outputSlot.id, options.nodes, options.connections);
        issues.push(...outputSource.issues);
        if (outputSource.status === "unique" && outputSource.action.id !== action.id) {
            issues.push(
                issue("result_slot_source_mismatch", `Result slot ${outputSlot.id} is connected to ${outputSource.action.id}, not its declared action ${action.id}`, {
                    nodeId: action.id,
                    slotId: outputSlot.id,
                    relatedNodeIds: [outputSource.action.id],
                }),
            );
        }
        if (outputSlot.metadata?.resultSlotSourceNodeId && outputSlot.metadata.resultSlotSourceNodeId !== action.id) {
            issues.push(
                issue("result_slot_source_mismatch", `Result slot ${outputSlot.id} declares source ${outputSlot.metadata.resultSlotSourceNodeId}, not ${action.id}`, {
                    nodeId: action.id,
                    slotId: outputSlot.id,
                    relatedNodeIds: [outputSlot.metadata.resultSlotSourceNodeId],
                }),
            );
        }

        const sourceSnapshot = buildSourceSnapshot(action, selectedActionIds, index, options.nodes, options.connections, issues, executionEdges, edgeKeys);
        if (!mode || outputSlotIssues.length > 0 || outputSource.status !== "unique" || outputSource.action.id !== action.id) continue;

        const data: CanvasWorkflowNodeData = Object.freeze({
            actionNodeId: action.id,
            mode,
            prompt: actionPrompt(action),
            outputSlotId: outputSlot.id,
            sourceSnapshot: Object.freeze(sourceSnapshot),
        });
        executionNodes.push(
            Object.freeze({
                id: action.id,
                data,
                checkpoint: outputSlot.metadata?.advanceMode === "review",
            }),
        );
    }

    for (const connection of options.connections) {
        const from = index.nodeById.get(connection.fromNodeId);
        const to = index.nodeById.get(connection.toNodeId);
        if (!from || !to || !isActionNode(from) || !isActionNode(to)) continue;
        if (!selectedActionIds.has(from.id) && !selectedActionIds.has(to.id)) continue;
        issues.push(
            issue("direct_action_connection", `Action nodes ${from.id} and ${to.id} must be connected through an explicit result slot`, {
                connectionId: connection.id,
                relatedNodeIds: [from.id, to.id],
            }),
        );
    }

    const selectedNodeIds = new Set(executionNodes.map((node) => node.id));
    const finalEdges = executionEdges.filter((edge) => selectedNodeIds.has(edge.fromNodeId) && selectedNodeIds.has(edge.toNodeId));
    if (hasCycle(selectedNodeIds, finalEdges)) {
        issues.push(issue("workflow_cycle", "The selected canvas workflow contains an action cycle"));
    }

    const deduplicatedIssues = dedupeIssues(issues);
    if (deduplicatedIssues.length > 0) return { ok: false, graph: null, issues: Object.freeze(deduplicatedIssues) };
    return {
        ok: true,
        graph: Object.freeze({ nodes: Object.freeze(executionNodes), edges: Object.freeze(finalEdges.map((edge) => Object.freeze(edge))) }),
        issues: [],
    };
}

/** Resolves a slot writer from its physical inbound connection without guessing from array order or metadata. */
export function findCanvasResultSlotSourceAction(
    slotId: string,
    nodes: readonly CanvasNodeData[],
    connections: readonly CanvasConnection[],
): CanvasResultSlotSourceActionResolution {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const slot = nodeById.get(slotId);
    if (!slot) {
        return { status: "not_found", issues: [issue("invalid_result_slot", `Result slot ${slotId} does not exist`, { slotId })] };
    }
    if (slot.metadata?.role !== "result-slot") {
        return { status: "invalid", issues: [issue("invalid_result_slot", `Node ${slotId} is not an explicit result slot`, { slotId })] };
    }

    const inboundSources = uniqueNodes(
        connections
            .filter((connection) => connection.toNodeId === slotId)
            .map((connection) => nodeById.get(connection.fromNodeId))
            .filter((node): node is CanvasNodeData => Boolean(node)),
    );
    if (inboundSources.length === 0) {
        return { status: "missing", issues: [issue("result_slot_source_missing", `Result slot ${slotId} has no connected source action`, { slotId })] };
    }

    const actionSources = inboundSources.filter(isActionNode);
    if (inboundSources.length === 1 && actionSources.length === 0) {
        return {
            status: "invalid",
            issues: [
                issue("result_slot_source_not_action", `Result slot ${slotId} is written by non-action node ${inboundSources[0].id}`, {
                    slotId,
                    relatedNodeIds: [inboundSources[0].id],
                }),
            ],
        };
    }
    if (inboundSources.length > 1 || actionSources.length > 1) {
        return {
            status: "ambiguous",
            issues: [
                issue("result_slot_source_ambiguous", `Result slot ${slotId} has multiple inbound writers`, {
                    slotId,
                    relatedNodeIds: inboundSources.map((node) => node.id),
                }),
            ],
        };
    }
    return { status: "unique", action: actionSources[0], issues: [] };
}

function createGraphIndex(nodes: readonly CanvasNodeData[], connections: readonly CanvasConnection[], issues: CanvasWorkflowGraphValidationIssue[]): GraphIndex {
    const nodeById = new Map<string, CanvasNodeData>();
    for (const node of nodes) {
        if (nodeById.has(node.id)) {
            issues.push(issue("duplicate_node_id", `Canvas node ID is duplicated: ${node.id}`, { nodeId: node.id }));
            continue;
        }
        nodeById.set(node.id, node);
    }
    const incomingByNodeId = new Map<string, CanvasConnection[]>();
    const outgoingByNodeId = new Map<string, CanvasConnection[]>();
    for (const connection of connections) {
        if (!nodeById.has(connection.fromNodeId)) {
            issues.push(
                issue("unknown_connection_source", `Connection ${connection.id} references unknown source ${connection.fromNodeId}`, {
                    connectionId: connection.id,
                    relatedNodeIds: [connection.fromNodeId],
                }),
            );
            continue;
        }
        if (!nodeById.has(connection.toNodeId)) {
            issues.push(
                issue("unknown_connection_target", `Connection ${connection.id} references unknown target ${connection.toNodeId}`, {
                    connectionId: connection.id,
                    relatedNodeIds: [connection.toNodeId],
                }),
            );
            continue;
        }
        const incoming = incomingByNodeId.get(connection.toNodeId) || [];
        incoming.push(connection);
        incomingByNodeId.set(connection.toNodeId, incoming);
        const outgoing = outgoingByNodeId.get(connection.fromNodeId) || [];
        outgoing.push(connection);
        outgoingByNodeId.set(connection.fromNodeId, outgoing);
    }
    return { nodeById, incomingByNodeId, outgoingByNodeId };
}

function collectActionEdges(nodes: readonly CanvasNodeData[], index: GraphIndex) {
    const edges = new Map<string, Set<string>>();
    for (const slot of nodes) {
        if (slot.metadata?.role !== "result-slot") continue;
        const sources = uniqueNodes(
            (index.incomingByNodeId.get(slot.id) || [])
                .map((connection) => index.nodeById.get(connection.fromNodeId))
                .filter((node): node is CanvasNodeData => Boolean(node && isActionNode(node))),
        );
        if (sources.length !== 1) continue;
        for (const connection of index.outgoingByNodeId.get(slot.id) || []) {
            const target = index.nodeById.get(connection.toNodeId);
            if (!target || !isActionNode(target)) continue;
            const targets = edges.get(sources[0].id) || new Set<string>();
            targets.add(target.id);
            edges.set(sources[0].id, targets);
        }
    }
    return edges;
}

function selectActionIds(
    startNodeIds: readonly string[] | undefined,
    actionIds: Set<string>,
    actionEdges: Map<string, Set<string>>,
    index: GraphIndex,
    issues: CanvasWorkflowGraphValidationIssue[],
) {
    if (startNodeIds === undefined) return new Set(actionIds);
    const selected = new Set<string>();
    const queue: string[] = [];
    for (const nodeId of new Set(startNodeIds)) {
        const node = index.nodeById.get(nodeId);
        if (!node) {
            issues.push(issue("unknown_start_node", `Workflow start node does not exist: ${nodeId}`, { nodeId }));
        } else if (!actionIds.has(nodeId)) {
            issues.push(issue("start_node_not_action", `Workflow start node is not executable: ${nodeId}`, { nodeId }));
        } else {
            selected.add(nodeId);
            queue.push(nodeId);
        }
    }
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        for (const targetId of actionEdges.get(nodeId) || []) {
            if (selected.has(targetId)) continue;
            selected.add(targetId);
            queue.push(targetId);
        }
    }
    return selected;
}

function buildSourceSnapshot(
    action: CanvasNodeData,
    selectedActionIds: Set<string>,
    index: GraphIndex,
    nodes: readonly CanvasNodeData[],
    connections: readonly CanvasConnection[],
    issues: CanvasWorkflowGraphValidationIssue[],
    executionEdges: WorkflowExecutionEdge[],
    edgeKeys: Set<string>,
) {
    const snapshots: CanvasWorkflowSourceSnapshot[] = [];
    const seenSourceIds = new Set<string>();
    for (const connection of index.incomingByNodeId.get(action.id) || []) {
        const source = index.nodeById.get(connection.fromNodeId);
        if (!source || seenSourceIds.has(source.id)) continue;
        seenSourceIds.add(source.id);

        if (isActionNode(source)) continue;
        if (source.metadata?.role !== "result-slot") {
            snapshots.push(
                Object.freeze({
                    sourceNodeId: source.id,
                    sourceNodeType: source.type,
                    resolution: "frozen" as const,
                }),
            );
            continue;
        }

        const sourceResolution = findCanvasResultSlotSourceAction(source.id, nodes, connections);
        issues.push(...sourceResolution.issues);
        if (sourceResolution.status !== "unique") continue;
        const sourceActionId = sourceResolution.action.id;
        if (selectedActionIds.has(sourceActionId)) {
            const key = `${sourceActionId}\u0000${action.id}`;
            if (!edgeKeys.has(key)) {
                edgeKeys.add(key);
                executionEdges.push({ fromNodeId: sourceActionId, toNodeId: action.id });
            }
            snapshots.push(
                Object.freeze({
                    sourceNodeId: source.id,
                    sourceNodeType: source.type,
                    sourceActionNodeId: sourceActionId,
                    resolution: "workflow" as const,
                }),
            );
            continue;
        }

        const currentVersion = lastSuccessfulVersion(source);
        if (source.metadata.slotState !== "ready" || !currentVersion) {
            issues.push(
                issue("pending_input", `Action node ${action.id} requires ready result slot ${source.id} from outside the selected run`, {
                    nodeId: action.id,
                    slotId: source.id,
                    relatedNodeIds: [sourceActionId],
                }),
            );
            continue;
        }
        snapshots.push(
            Object.freeze({
                sourceNodeId: source.id,
                sourceNodeType: source.type,
                sourceActionNodeId: sourceActionId,
                versionId: currentVersion.id,
                resolution: "frozen" as const,
            }),
        );
    }
    return snapshots;
}

function validateResultSlot(slot: CanvasNodeData, expectedMode?: CanvasGenerationMode) {
    const issues: CanvasWorkflowGraphValidationIssue[] = [];
    const metadata = slot.metadata;
    const validMode = generationMode(slot.type);
    if (
        metadata?.role !== "result-slot" ||
        !validMode ||
        metadata.resultSlotMode !== validMode ||
        (metadata.advanceMode !== "review" && metadata.advanceMode !== "auto") ||
        !isSlotState(metadata.slotState) ||
        !Array.isArray(metadata.resultVersions)
    ) {
        issues.push(issue("invalid_result_slot", `Result slot ${slot.id} has an invalid explicit slot contract`, { slotId: slot.id }));
    }
    if (expectedMode && validMode && expectedMode !== validMode) {
        issues.push(
            issue("result_slot_mode_mismatch", `Result slot ${slot.id} is ${validMode}, but its action produces ${expectedMode}`, {
                slotId: slot.id,
            }),
        );
    }
    return issues;
}

/** 上游来源存在多个版本资产时，取最后一个有效（成功）版本作为下游输入。 */
function lastSuccessfulVersion(slot: CanvasNodeData) {
    const versions = slot.metadata?.resultVersions || [];
    for (let index = versions.length - 1; index >= 0; index -= 1) {
        const version = versions[index];
        if (version.status === "success") return version;
    }
    return undefined;
}

function actionMode(node: CanvasNodeData): CanvasGenerationMode | undefined {
    if (node.type === "config") return generationMode(node.metadata?.generationMode);
    if (node.type === "terminal") return generationMode(node.metadata?.terminalOutputMode);
    return undefined;
}

function actionPrompt(node: CanvasNodeData) {
    if (node.type === "terminal") return node.metadata?.terminalCommand ?? node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
    return node.metadata?.composerContent ?? node.metadata?.prompt ?? "";
}

function isActionNode(node: CanvasNodeData) {
    return node.type === "config" || node.type === "terminal";
}

function generationMode(value: unknown): CanvasGenerationMode | undefined {
    return value === "text" || value === "image" || value === "video" || value === "audio" ? value : undefined;
}

function isSlotState(value: unknown) {
    return value === "empty" || value === "waiting" || value === "running" || value === "persisting" || value === "ready" || value === "error" || value === "stale";
}

function uniqueNodes(nodes: readonly CanvasNodeData[]) {
    const seen = new Set<string>();
    return nodes.filter((node) => {
        if (seen.has(node.id)) return false;
        seen.add(node.id);
        return true;
    });
}

function hasCycle(nodeIds: Set<string>, edges: readonly WorkflowExecutionEdge[]) {
    const indegree = new Map(Array.from(nodeIds, (id) => [id, 0]));
    const outgoing = new Map(Array.from(nodeIds, (id) => [id, new Set<string>()]));
    for (const edge of edges) {
        const targets = outgoing.get(edge.fromNodeId);
        if (!targets || !indegree.has(edge.toNodeId) || targets.has(edge.toNodeId)) continue;
        targets.add(edge.toNodeId);
        indegree.set(edge.toNodeId, indegree.get(edge.toNodeId)! + 1);
    }
    const queue = Array.from(indegree, ([id, degree]) => (degree === 0 ? id : undefined)).filter((id): id is string => Boolean(id));
    let visited = 0;
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        visited += 1;
        for (const targetId of outgoing.get(nodeId) || []) {
            const degree = indegree.get(targetId)! - 1;
            indegree.set(targetId, degree);
            if (degree === 0) queue.push(targetId);
        }
    }
    return visited !== nodeIds.size;
}

function issue(code: CanvasWorkflowGraphIssueCode, message: string, detail: Omit<CanvasWorkflowGraphValidationIssue, "code" | "message"> = {}) {
    return Object.freeze({ ...detail, code, message });
}

function dedupeIssues(issues: readonly CanvasWorkflowGraphValidationIssue[]) {
    const seen = new Set<string>();
    return issues.filter((item) => {
        const key = [item.code, item.nodeId, item.slotId, item.connectionId, ...(item.relatedNodeIds || [])].join("\u0000");
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}
