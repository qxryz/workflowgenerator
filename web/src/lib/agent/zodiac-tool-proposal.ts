import type { CanvasAgentOp } from "../canvas/canvas-agent-ops";
import { isAgentVisiblePluginNodeType } from "../canvas/node-registry.js";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata, CanvasNodeTypeId, CanvasResultSlotVersion } from "../../types/canvas";
import type { WorkflowExecutionMode } from "../canvas/workflow-execution";
import { scanZodiacProviderToolCalls } from "./zodiac-provider-transport.js";

type AddNodeOp = Extract<CanvasAgentOp, { type: "add_node" }>;
type ConnectNodesOp = Extract<CanvasAgentOp, { type: "connect_nodes" }>;

export type ZodiacWorkflowBinding = {
    actionId: string;
    mode: CanvasGenerationMode;
    outputNodeId: string;
    /** Only actions explicitly connected by the proposal are downstream. */
    nextActionIds: string[];
};

export type ZodiacToolProposal = {
    ops: CanvasAgentOp[];
    bindings: ZodiacWorkflowBinding[];
};

export type ZodiacExecutableToolProposal = ZodiacToolProposal & {
    executionMode: WorkflowExecutionMode;
};

export type ZodiacKnownCanvasNode = {
    id: string;
    type: CanvasNodeTypeId;
    title?: string;
    position?: { x: number; y: number };
    width?: number;
    height?: number;
    metadata?: CanvasNodeMetadata;
};

export type ZodiacKnownCanvasConnection = {
    id?: string;
    fromNodeId: string;
    toNodeId: string;
};

export type ParsedZodiacToolPayload = {
    text: string;
    summary?: string;
    executionMode?: unknown;
    ops: CanvasAgentOp[];
};

const CANVAS_AGENT_OP_TYPES = new Set([
    "add_node",
    "update_node",
    "delete_node",
    "delete_connections",
    "connect_nodes",
    "set_viewport",
    "select_nodes",
    "run_generation",
]);

const ZODIAC_NODE_TYPES = new Set(["text", "config", "image", "video", "audio", "terminal", "group"]);
const MAX_RAW_TOOL_BYTES = 96 * 1024;

const OUTPUT_NODE_TYPE: Record<CanvasGenerationMode, CanvasNodeTypeId> = {
    text: "text",
    image: "image",
    video: "video",
    audio: "audio",
};

const OUTPUT_NODE_TITLE: Record<CanvasGenerationMode, string> = {
    text: "文本结果槽",
    image: "图片结果槽",
    video: "视频结果槽",
    audio: "音频结果槽",
};

const ACTION_SEMANTIC_METADATA_KEYS = [
    "generationMode",
    "prompt",
    "composerContent",
    "model",
    "reasoningEffort",
    "generationType",
    "size",
    "quality",
    "background",
    "imageWatermark",
    "imageOptimizePrompt",
    "count",
    "seconds",
    "vquality",
    "generateAudio",
    "watermark",
    "audioVoice",
    "audioFormat",
    "audioSpeed",
    "audioInstructions",
    "terminalInputMode",
    "terminalOutputMode",
] as const satisfies readonly (keyof CanvasNodeMetadata)[];

/**
 * Provider responses are untrusted and older Zodiac sessions used `op`,
 * `source` and `target`. Normalize those aliases at the protocol boundary so
 * every downstream canvas operation still follows the current typed contract.
 */
export function normalizeZodiacCanvasOps(value: unknown): CanvasAgentOp[] {
    if (!Array.isArray(value)) return [];
    let rejectedNodeType = false;
    const normalized = value.flatMap<CanvasAgentOp>((candidate): CanvasAgentOp[] => {
        const raw = asUnknownRecord(candidate);
        if (!raw) return [];
        const currentType = stringValue(raw.type);
        const legacyType = stringValue(raw.op);
        const type = currentType && CANVAS_AGENT_OP_TYPES.has(currentType) ? currentType : legacyType;
        if (!type || !CANVAS_AGENT_OP_TYPES.has(type)) return [];

        if (type === "add_node") {
            const id = stringValue(raw.id);
            const legacyNodeType = legacyType && type === legacyType ? raw.type : undefined;
            const requestedNodeType = raw.nodeType !== undefined ? raw.nodeType : legacyNodeType;
            const nodeType = canvasNodeType(requestedNodeType);
            // An explicit unknown type must never fall through to the canvas
            // layer, where an absent nodeType would otherwise become `text`.
            if (requestedNodeType !== undefined && !nodeType) {
                rejectedNodeType = true;
                return [];
            }
            const title = stringValue(raw.title);
            const position = normalizePosition(raw.position);
            const x = canvasCoordinate(raw.x);
            const y = canvasCoordinate(raw.y);
            const width = canvasDimension(raw.width);
            const height = canvasDimension(raw.height);
            const metadata = normalizeOperationMetadata(raw);
            return [{
                type,
                ...(id ? { id } : {}),
                ...(nodeType ? { nodeType } : {}),
                ...(title ? { title } : {}),
                ...(position ? { position } : {}),
                ...(x !== undefined ? { x } : {}),
                ...(y !== undefined ? { y } : {}),
                ...(width !== undefined ? { width } : {}),
                ...(height !== undefined ? { height } : {}),
                ...(metadata ? { metadata } : {}),
            }];
        }
        if (type === "update_node") {
            const id = firstString(raw.id, raw.nodeId);
            if (!id) return [];
            const rawPatch = asUnknownRecord(raw.patch);
            if (rawPatch?.type !== undefined && !canvasNodeType(rawPatch.type)) {
                rejectedNodeType = true;
                return [];
            }
            const patch = normalizeNodePatch(raw.patch);
            const metadata = normalizeOperationMetadata(raw);
            return [{ type, id, ...(patch ? { patch } : {}), ...(metadata ? { metadata } : {}) }];
        }
        if (type === "delete_node") {
            const id = firstString(raw.id, raw.nodeId);
            const ids = stringArray(raw.ids ?? raw.nodeIds);
            const nodeType = canvasNodeType(raw.nodeType);
            if (raw.nodeType !== undefined && !nodeType) {
                rejectedNodeType = true;
                return [];
            }
            return id || ids.length || nodeType
                ? [{ type, ...(id ? { id } : {}), ...(ids.length ? { ids } : {}), ...(nodeType ? { nodeType } : {}) }]
                : [];
        }
        if (type === "delete_connections") {
            const id = firstString(raw.id, raw.connectionId);
            const ids = stringArray(raw.ids ?? raw.connectionIds);
            const all = raw.all === true;
            return id || ids.length || all
                ? [{ type, ...(id ? { id } : {}), ...(ids.length ? { ids } : {}), ...(all ? { all: true } : {}) }]
                : [];
        }
        if (type === "connect_nodes") {
            const fromNodeId = firstString(raw.fromNodeId, raw.sourceNodeId, raw.source, raw.from);
            const toNodeId = firstString(raw.toNodeId, raw.targetNodeId, raw.target, raw.to);
            if (!fromNodeId || !toNodeId) return [];
            const id = firstString(raw.id, raw.connectionId);
            return [{ type, ...(id ? { id } : {}), fromNodeId, toNodeId }];
        }
        if (type === "set_viewport") {
            const viewport = asUnknownRecord(raw.viewport);
            return viewport && isSafeViewportOffset(viewport.x) && isSafeViewportOffset(viewport.y) && isFiniteNumber(viewport.k) && viewport.k >= 0.05 && viewport.k <= 5
                ? [{ type, viewport: { x: viewport.x, y: viewport.y, k: viewport.k } }]
                : [];
        }
        if (type === "select_nodes") {
            const ids = stringArray(raw.ids ?? raw.nodeIds);
            return [{ type, ids }];
        }
        const nodeId = firstString(raw.nodeId, raw.id);
        if (!nodeId) return [];
        const mode = isGenerationMode(raw.mode) ? raw.mode : undefined;
        const prompt = stringValue(raw.prompt);
        return [{ type: "run_generation", nodeId, ...(mode ? { mode } : {}), ...(prompt ? { prompt } : {}) }];
    });
    if (rejectedNodeType) return [];
    const declaredIds = normalized
        .filter((op): op is AddNodeOp => op.type === "add_node" && Boolean(op.id))
        .map((op) => op.id as string);
    if (new Set(declaredIds).size !== declaredIds.length) return [];
    const proposedNodeTypes = new Map<string, CanvasNodeTypeId>();
    const proposedPluginNodeIds = new Set<string>();
    normalized.forEach((op) => {
        if (op.type === "add_node" && op.id) {
            proposedNodeTypes.set(op.id, op.nodeType || "text");
            if (isPluginNodeType(op.nodeType)) proposedPluginNodeIds.add(op.id);
        }
        if (op.type === "update_node" && op.patch?.type) {
            proposedNodeTypes.set(op.id, op.patch.type);
            if (isPluginNodeType(op.patch.type)) proposedPluginNodeIds.add(op.id);
        }
    });
    if (normalized.some((op) => (
        op.type === "run_generation"
        && (proposedPluginNodeIds.has(op.nodeId) || (proposedNodeTypes.has(op.nodeId) && !isActionNodeType(proposedNodeTypes.get(op.nodeId))))
    ))) return [];
    return normalized;
}

/** Extract the first valid proposal and remove only that protocol block from user-visible copy. */
export function extractZodiacToolPayload(reply: string): ParsedZodiacToolPayload | undefined {
    const scan = scanZodiacToolPayloads(reply);
    for (const block of scan.blocks) {
        const payload = parseZodiacToolFence(block.label, block.body);
        if (payload) return { ...payload, text: stripZodiacToolPayload(reply) };
    }
    return undefined;
}

/**
 * Providers do not always preserve the requested `zodic-ops` fence label.
 * Keep protocol detection separate from successful parsing so a malformed
 * proposal becomes a recoverable canvas step instead of leaking raw JSON into
 * the conversation.
 */
export function hasZodiacToolPayloadProtocol(reply: string) {
    const fenced = scanZodiacToolFences(reply);
    const raw = scanRawZodiacToolPayloads(reply, fenced);
    return fenced.blocks.some((block) => (
        block.label === "zodic-ops" || looksLikeZodiacProtocolBody(block.body)
    )) || Boolean(fenced.unfinished && (
        fenced.unfinished.label === "zodic-ops" || looksLikeZodiacProtocolBody(fenced.unfinished.body)
    )) || raw.ranges.length > 0;
}

export function stripZodiacToolPayload(reply: string) {
    const fenced = scanZodiacToolFences(reply);
    const raw = scanRawZodiacToolPayloads(reply, fenced);
    const ranges = fenced.blocks
        .filter((block) => (
            block.label === "zodic-ops"
            || Boolean(parseZodiacToolFence(block.label, block.body))
            || looksLikeZodiacProtocolBody(block.body)
        ))
        .map((block) => ({ start: block.start, end: block.end }));
    ranges.push(...raw.ranges);
    if (fenced.unfinished && (
        fenced.unfinished.label === "zodic-ops" || looksLikeZodiacProtocolBody(fenced.unfinished.body)
    )) {
        ranges.push({ start: fenced.unfinished.start, end: reply.length });
    }
    return removeTextRanges(reply, ranges).trim();
}

/**
 * Turns a model-authored proposal into an explicit action -> result slot graph.
 * Every generated id and edge is stable inside the proposal, so consumers can
 * render, approve and apply the same structured binding without guessing from
 * the flattened op order.
 */
export function prepareZodiacToolProposal(
    rawOps: CanvasAgentOp[],
    knownNodes: ZodiacKnownCanvasNode[] = [],
    knownConnections: ZodiacKnownCanvasConnection[] = [],
    allowCompatibleKnownIdReuse = false,
): ZodiacToolProposal {
    if (proposalReferencesUnavailablePluginNodes(rawOps, knownNodes, knownConnections) || proposalRunsPluginNode(rawOps, knownNodes)) {
        return { ops: [], bindings: [] };
    }
    const suppliedKnownNodeIds = knownNodes.map((node) => node.id);
    if (new Set(suppliedKnownNodeIds).size !== suppliedKnownNodeIds.length) return { ops: [], bindings: [] };
    const declaredRawIds = rawOps
        .filter((op): op is AddNodeOp => op.type === "add_node" && Boolean(op.id))
        .map((op) => op.id as string);
    if (new Set(declaredRawIds).size !== declaredRawIds.length) return { ops: [], bindings: [] };
    const knownNodeIdsInput = new Set(knownNodes.map((node) => node.id));
    const collisionResolution = resolveKnownNodeIdCollisions(rawOps, knownNodes, allowCompatibleKnownIdReuse);
    // Collision aliases are deterministic and may already be referenced by later
    // operations in the same proposal. Recheck plugin provenance after remapping.
    if (proposalRunsPluginNode(collisionResolution.ops, knownNodes)) return { ops: [], bindings: [] };
    const normalized = freezeDestructiveTargets(
        normalizeAddedNodes(mergeRepeatedRunOps(collisionResolution.ops), knownNodeIdsInput, collisionResolution.reusableKnownIds),
        knownNodes,
        knownConnections,
    );
    const deletions = collectProposalDeletions(normalized, knownNodes);
    const initialMaterializedNodes = materializeProposalNodes(normalized, knownNodes, collisionResolution.reusableKnownIds);
    const retiredSlots = reconcileRetiredActionSlots(initialMaterializedNodes, knownNodes, knownConnections, normalized, deletions);
    if (!retiredSlots.valid) return { ops: [], bindings: [] };
    const materializedNodes = retiredSlots.nodes;
    const additions = [...materializedNodes.values()]
        .filter((entry) => entry.origin === "addition")
        .map((entry) => entry.node);
    const knownAdditions = [...materializedNodes.values()]
        .filter((entry) => entry.origin === "known")
        .map((entry) => entry.node);
    const additionIds = new Set(additions.map((op) => op.id as string));
    const knownNodeIds = new Set(knownAdditions.map((op) => op.id as string));
    const activeNodeIds = new Set(materializedNodes.keys());
    const activeActionNodeIds = new Set(
        [...materializedNodes.entries()].filter(([, entry]) => isActionNode(entry.node)).map(([id]) => id),
    );
    const availableKnownConnections = deletions.allConnections
        ? []
        : knownConnections.filter(
            (connection) =>
                (!connection.id || !deletions.connectionIds.has(connection.id)) &&
                activeNodeIds.has(connection.fromNodeId) &&
                activeNodeIds.has(connection.toNodeId),
        );
    const activeNormalized = normalized.filter(
        (op) =>
            op.type !== "run_generation" || activeActionNodeIds.has(op.nodeId),
    );
    const nodeById = new Map([...knownAdditions, ...additions].map((op) => [op.id as string, op]));
    const proposedActions = additions.filter(isActionNode);
    const proposedConnections = ensureUniqueConnectionIds(
        [
            ...collectLiveProposedConnections(normalized, knownNodes)
                .filter((connection) => activeNodeIds.has(connection.fromNodeId) && activeNodeIds.has(connection.toNodeId)),
            ...retiredSlots.connections,
        ],
        knownConnections,
    );
    const knownConnectionOps: ConnectNodesOp[] = availableKnownConnections.map((connection) => ({ type: "connect_nodes", ...connection }));
    const deletedSlotRoutes = collectDeletedOwnedSlotRoutes(
        knownNodes,
        knownConnections,
        activeNodeIds,
        activeActionNodeIds,
        deletions,
    );
    const routingConnections = [...proposedConnections, ...knownConnectionOps, ...deletedSlotRoutes];
    const actionIds = new Set(
        [...nodeById.values()].filter(isActionNode).map((node) => node.id as string),
    );
    const seedActionIds = new Set(proposedActions.map((action) => action.id as string));
    proposedConnections.forEach((connection) => {
        if (actionIds.has(connection.fromNodeId)) seedActionIds.add(connection.fromNodeId);
        if (actionIds.has(connection.toNodeId)) seedActionIds.add(connection.toNodeId);
    });
    activeNormalized.forEach((op) => {
        if (op.type === "run_generation") seedActionIds.add(op.nodeId);
        if (op.type === "update_node" && actionIds.has(op.id)) seedActionIds.add(op.id);
    });
    const participatingActionIds = collectParticipatingActionIds(seedActionIds, nodeById, routingConnections);
    const participatingKnownActions = knownAdditions.filter(
        (node) => isActionNode(node) && participatingActionIds.has(node.id as string),
    );
    const actions = [...proposedActions, ...participatingKnownActions];
    const outputDiscoveryConnections = [...proposedConnections, ...knownConnectionOps];
    const claimedSlotIds = new Set<string>();
    const usedIds = new Set([...knownNodeIds, ...additionIds]);
    const generatedSlots = new Map<string, AddNodeOp>();
    const explicitSlots = new Map<string, AddNodeOp>();
    const existingSlotUpdates = new Map<string, CanvasAgentOp>();

    const preliminaryBindings = actions.map((action): ZodiacWorkflowBinding => {
        const actionId = action.id as string;
        const mode = actionOutputMode(action);
        const connectedCandidates = outputDiscoveryConnections
            .filter((connection) => connection.fromNodeId === actionId)
            .map((connection) => nodeById.get(connection.toNodeId))
            .filter((node): node is AddNodeOp => node !== undefined && !claimedSlotIds.has(node.id as string));
        const connectedCandidateIds = new Set(connectedCandidates.map((node) => node.id as string));
        const ownedSlot = bestResultSlot(
            [...nodeById.values()].filter(
                (node) => !claimedSlotIds.has(node.id as string) && isOwnedResultSlot(node, mode, actionId),
            ),
            connectedCandidateIds,
        );
        const connectedSlot = ownedSlot || connectedCandidates.find(
            (node) => isClaimableOutputNode(node, mode, actionId),
        );
        const output = connectedSlot || createOutputSlot(action, mode, usedIds);
        const outputNodeId = output.id as string;
        const existingOutput = knownNodeIds.has(outputNodeId);
        const explicitOutput = existingOutput ? asExistingResultSlot(output, mode, actionId) : asExplicitResultSlot(output, mode, actionId);
        explicitSlots.set(outputNodeId, explicitOutput);
        claimedSlotIds.add(outputNodeId);
        if (existingOutput) existingSlotUpdates.set(outputNodeId, { type: "update_node", id: outputNodeId, metadata: explicitOutput.metadata });
        if (!nodeById.has(outputNodeId)) generatedSlots.set(actionId, explicitOutput);
        nodeById.set(outputNodeId, explicitOutput);
        return { actionId, mode, outputNodeId, nextActionIds: [] };
    });
    const preliminaryBindingByActionId = new Map(preliminaryBindings.map((binding) => [binding.actionId, binding]));
    const preliminaryBindingByOutputId = new Map(preliminaryBindings.map((binding) => [binding.outputNodeId, binding]));
    const slotAliases = new Map(retiredSlots.aliases);
    collectResultSlotAliases(preliminaryBindings, nodeById, outputDiscoveryConnections, preliminaryBindingByOutputId)
        .forEach((targetId, sourceId) => slotAliases.set(sourceId, targetId));
    collectDeletedResultSlotAliases(preliminaryBindings, knownNodes, activeNodeIds)
        .forEach((targetId, sourceId) => slotAliases.set(sourceId, targetId));
    const downstreamByActionId = new Map(preliminaryBindings.map((binding) => [binding.actionId, new Set<string>()]));
    routingConnections.forEach((connection) => {
        if (!actionIds.has(connection.toNodeId)) return;
        const canonicalSourceId = slotAliases.get(connection.fromNodeId) || connection.fromNodeId;
        const sourceBinding = preliminaryBindingByActionId.get(canonicalSourceId) || preliminaryBindingByOutputId.get(canonicalSourceId);
        if (sourceBinding && sourceBinding.actionId !== connection.toNodeId) {
            downstreamByActionId.get(sourceBinding.actionId)?.add(connection.toNodeId);
        }
    });
    const bindings = preliminaryBindings.map((binding) => ({
        ...binding,
        nextActionIds: [...(downstreamByActionId.get(binding.actionId) || [])],
    }));
    if (hasWorkflowCycle(bindings)) return { ops: [], bindings: [] };

    const bindingByActionId = new Map(bindings.map((binding) => [binding.actionId, binding]));
    const bindingByOutputId = new Map(bindings.map((binding) => [binding.outputNodeId, binding]));
    const unusedSlotAdditionIds = new Set(
        additions
            .map((addition) => addition.id as string)
            .filter((id) => slotAliases.has(id)),
    );
    const retainedConnections = dedupeConnections(proposedConnections.flatMap((connection): ConnectNodesOp[] => {
        if (unusedSlotAdditionIds.has(connection.toNodeId)) return [];
        const canonicalSourceId = slotAliases.get(connection.fromNodeId) || connection.fromNodeId;
        const outputBinding = bindingByOutputId.get(connection.toNodeId);
        if (outputBinding && canonicalSourceId !== outputBinding.actionId) return [];
        const sourceBinding = bindingByActionId.get(canonicalSourceId);
        const target = nodeById.get(connection.toNodeId);
        if (sourceBinding && actionIds.has(connection.toNodeId)) return [];
        if (sourceBinding && target?.metadata?.role === "result-slot" && sourceBinding.outputNodeId !== connection.toNodeId) return [];
        if (sourceBinding && target && knownNodeIds.has(connection.toNodeId) && isCompatibleOutputNode(target, sourceBinding.mode) && sourceBinding.outputNodeId !== connection.toNodeId) return [];
        return [{ ...connection, fromNodeId: canonicalSourceId }];
    }));
    const cleanupConnectionIds = new Set<string>();
    knownConnectionOps.forEach((connection) => {
        if (!connection.id) return;
        const canonicalSourceId = slotAliases.get(connection.fromNodeId);
        if (canonicalSourceId && actionIds.has(connection.toNodeId)) {
            cleanupConnectionIds.add(connection.id);
            return;
        }
        const outputBinding = bindingByOutputId.get(connection.toNodeId);
        if (outputBinding && connection.fromNodeId !== outputBinding.actionId) {
            cleanupConnectionIds.add(connection.id);
            return;
        }
        const binding = bindingByActionId.get(connection.fromNodeId);
        if (!binding) return;
        const target = nodeById.get(connection.toNodeId);
        const redundantOwnedSlot = target?.metadata?.role === "result-slot" && connection.toNodeId !== binding.outputNodeId;
        const redundantCompatibleOutput = target && isCompatibleOutputNode(target, binding.mode) && connection.toNodeId !== binding.outputNodeId;
        const bypassesResultSlot = binding.nextActionIds.includes(connection.toNodeId);
        if (redundantOwnedSlot || redundantCompatibleOutput || bypassesResultSlot) cleanupConnectionIds.add(connection.id);
    });
    const cleanupConnectionOps: CanvasAgentOp[] = [...cleanupConnectionIds].map((id) => ({ type: "delete_connections", id }));
    const connectionIds = new Set([
        ...knownConnectionOps.map((connection) => connection.id).filter(Boolean) as string[],
        ...retainedConnections.map((connection) => connection.id).filter(Boolean) as string[],
    ]);
    const topologyConnections: ConnectNodesOp[] = [];
    const keptKnownConnections = knownConnectionOps.filter((connection) => !connection.id || !cleanupConnectionIds.has(connection.id));
    bindings.forEach((binding) => {
        const existingConnections = [...retainedConnections, ...keptKnownConnections];
        addConnection(binding.actionId, binding.outputNodeId, existingConnections, topologyConnections, connectionIds);
        binding.nextActionIds.forEach((nextActionId) => addConnection(binding.outputNodeId, nextActionId, existingConnections, topologyConnections, connectionIds));
    });
    const explicitlyRunIds = new Set(activeNormalized
        .filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation")
        .map((op) => op.nodeId));
    const originalKnownNodeById = new Map(knownNodes.map((node) => [node.id, node]));
    const updatedActionIds = activeNormalized
        .filter((op): op is Extract<CanvasAgentOp, { type: "update_node" }> =>
            op.type === "update_node" &&
            bindingByActionId.has(op.id) &&
            actionMeaningChanged(originalKnownNodeById.get(op.id), nodeById.get(op.id)))
        .map((op) => op.id);
    const mutatedActionIds = new Set([
        ...proposedActions.map((action) => action.id as string),
        ...updatedActionIds,
    ]);
    const requiredRunIds = collectRequiredRunActionIds(explicitlyRunIds, bindings, nodeById, mutatedActionIds);
    const additionalRunOps: CanvasAgentOp[] = [...requiredRunIds]
        .filter((id) => !explicitlyRunIds.has(id))
        .map((nodeId) => ({ type: "run_generation", nodeId }));
    const terminalModeOps: CanvasAgentOp[] = bindings.flatMap((binding) => nodeById.get(binding.actionId)?.nodeType === "terminal"
        ? [{ type: "update_node", id: binding.actionId, metadata: { terminalOutputMode: binding.mode } }]
        : []);
    const resultSlotAliases = new Map(slotAliases);
    bindings.forEach((binding) => {
        const expectedCurrentId = `${binding.actionId}--${binding.mode}-result`;
        if (expectedCurrentId !== binding.outputNodeId) resultSlotAliases.set(expectedCurrentId, binding.outputNodeId);
        collisionResolution.nodeIdAliases.forEach((resolvedId, originalId) => {
            if (resolvedId !== binding.actionId) return;
            const expectedOriginalId = `${originalId}--${binding.mode}-result`;
            if (expectedOriginalId !== binding.outputNodeId && !bindingByOutputId.has(expectedOriginalId)) {
                resultSlotAliases.set(expectedOriginalId, binding.outputNodeId);
            }
        });
    });
    const knownAliasConsumerIds = new Set(participatingKnownActions.map((action) => action.id as string));
    routingConnections.forEach((connection) => {
        if (resultSlotAliases.has(connection.fromNodeId) && knownNodeIds.has(connection.toNodeId)) knownAliasConsumerIds.add(connection.toNodeId);
    });
    retiredSlots.consumerIds.forEach((id) => {
        if (knownNodeIds.has(id)) knownAliasConsumerIds.add(id);
    });
    const existingAliasMetadataOps = collectStableReferenceMetadataUpdates(knownAliasConsumerIds, nodeById, resultSlotAliases);
    const graphOps: CanvasAgentOp[] = [];
    activeNormalized.forEach((op) => {
        if (op.type === "connect_nodes") return;
        if (op.type === "add_node" && op.id && unusedSlotAdditionIds.has(op.id)) return;
        graphOps.push(op.type === "add_node" && op.id && explicitSlots.has(op.id) ? (explicitSlots.get(op.id) as AddNodeOp) : op);
    });
    graphOps.push(...additionalRunOps, ...terminalModeOps);
    graphOps.push(...retiredSlots.ops, ...existingAliasMetadataOps);
    graphOps.push(...cleanupConnectionOps);
    generatedSlots.forEach((slot) => graphOps.push(slot));
    graphOps.push(...existingSlotUpdates.values());
    graphOps.push(...retainedConnections, ...topologyConnections);
    const finalOps = resultSlotAliases.size
        ? graphOps.map((op) => rewriteCanvasAgentOpPromptTokens(op, resultSlotAliases))
        : graphOps;
    return { ops: finalOps, bindings };
}

function proposalReferencesUnavailablePluginNodes(
    rawOps: readonly CanvasAgentOp[],
    knownNodes: readonly ZodiacKnownCanvasNode[],
    knownConnections: readonly ZodiacKnownCanvasConnection[],
) {
    const knownTypes = new Map(knownNodes.map((node) => [node.id, node.type]));
    const finalTypes = proposalNodeTypes(rawOps, knownNodes);
    const unavailableType = (type: unknown) => isPluginNodeType(type) && !isAgentVisiblePluginNodeType(type as string);
    const unavailableTarget = (id: string) => unavailableType(knownTypes.get(id)) || unavailableType(finalTypes.get(id));
    const connectionTouchesUnavailablePlugin = (connection: ZodiacKnownCanvasConnection) => (
        unavailableTarget(connection.fromNodeId) || unavailableTarget(connection.toNodeId)
    );
    const unavailableConnectionIds = new Set(
        knownConnections
            .filter((connection) => connection.id && connectionTouchesUnavailablePlugin(connection))
            .map((connection) => connection.id as string),
    );
    const hasUnavailablePluginConnection = knownConnections.some(connectionTouchesUnavailablePlugin);

    for (const op of rawOps) {
        if (op.type === "add_node" && unavailableType(op.nodeType)) return true;
        if (op.type === "update_node" && (unavailableType(op.patch?.type) || unavailableTarget(op.id))) return true;
        if (op.type === "delete_node") {
            if (unavailableType(op.nodeType)) return true;
            const deletionTargets = new Set([
                ...(op.ids || []),
                ...(op.id ? [op.id] : []),
                ...(op.nodeType ? [...finalTypes].filter(([, type]) => type === op.nodeType).map(([id]) => id) : []),
            ]);
            if ([...deletionTargets].some(unavailableTarget)) return true;
            if (knownConnections.some((connection) => (
                (deletionTargets.has(connection.fromNodeId) || deletionTargets.has(connection.toNodeId))
                && connectionTouchesUnavailablePlugin(connection)
            ))) return true;
        }
        if (op.type === "delete_connections") {
            if (op.all && hasUnavailablePluginConnection) return true;
            if ([...(op.ids || []), ...(op.id ? [op.id] : [])].some((id) => unavailableConnectionIds.has(id))) return true;
        }
        if (op.type === "connect_nodes" && (unavailableTarget(op.fromNodeId) || unavailableTarget(op.toNodeId))) return true;
        if (op.type === "select_nodes" && op.ids.some(unavailableTarget)) return true;
        if (op.type === "run_generation" && unavailableTarget(op.nodeId)) return true;
    }
    return false;
}

function proposalRunsPluginNode(rawOps: readonly CanvasAgentOp[], knownNodes: readonly ZodiacKnownCanvasNode[]) {
    const pluginNodeIds = new Set(
        knownNodes.filter((node) => isPluginNodeType(node.type)).map((node) => node.id),
    );
    const finalTypes = proposalNodeTypes(rawOps, knownNodes);
    rawOps.forEach((op) => {
        if (op.type === "add_node" && op.id && isPluginNodeType(op.nodeType)) pluginNodeIds.add(op.id);
        if (op.type === "update_node" && isPluginNodeType(op.patch?.type)) pluginNodeIds.add(op.id);
    });
    return rawOps.some((op) => (
        op.type === "run_generation"
        && (pluginNodeIds.has(op.nodeId) || isPluginNodeType(finalTypes.get(op.nodeId)))
    ));
}

function proposalNodeTypes(rawOps: readonly CanvasAgentOp[], knownNodes: readonly ZodiacKnownCanvasNode[]) {
    const types = new Map<string, CanvasNodeTypeId>(knownNodes.map((node) => [node.id, node.type]));
    rawOps.forEach((op) => {
        if (op.type === "add_node" && op.id) types.set(op.id, op.nodeType || "text");
        if (op.type === "update_node" && op.patch?.type) types.set(op.id, op.patch.type);
    });
    return types;
}

function isPluginNodeType(type: unknown): type is string {
    return typeof type === "string" && !ZODIAC_NODE_TYPES.has(type);
}

export function normalizeZodiacToolProposal(rawOps: CanvasAgentOp[]) {
    return prepareZodiacToolProposal(rawOps).ops;
}

export function prepareZodiacExecutableToolProposal(
    rawOps: CanvasAgentOp[],
    request: string,
    proposedMode?: unknown,
    knownNodes: ZodiacKnownCanvasNode[] = [],
    knownConnections: ZodiacKnownCanvasConnection[] = [],
): ZodiacExecutableToolProposal {
    return {
        ...prepareZodiacToolProposal(rawOps, knownNodes, knownConnections),
        executionMode: resolveZodiacExecutionMode(request, proposedMode),
    };
}

/** The protocol may describe a mode, but only the user's words may enable automatic execution. */
export function resolveZodiacExecutionMode(request: string, proposedMode?: unknown): WorkflowExecutionMode {
    if (/(?:逐步确认|每(?:一)?步确认|一步一步|先确认再继续|不要全自动|别自动运行|不(?:要|用)自动完成)/u.test(request)) return "guided";
    const explicitlyAutomatic = /(?:全自动|自动(?:运行|执行|完成|跑完)|直接(?:运行|执行|跑)(?:到最后|到底|完|完整流程)|一键跑完|无[需须](?:我|中途|逐步)?确认|不(?:用|需要)(?:我|中途|逐步)?确认|跳过确认|不必逐步确认)/u.test(request);
    if (proposedMode === "automatic" && !explicitlyAutomatic) return "guided";
    return explicitlyAutomatic ? "automatic" : "guided";
}

function resolveKnownNodeIdCollisions(rawOps: CanvasAgentOp[], knownNodes: ZodiacKnownCanvasNode[], allowCompatibleKnownIdReuse: boolean) {
    const knownById = new Map(knownNodes.map((node) => [node.id, node]));
    const usedIds = new Set(knownById.keys());
    const reservedDeclaredIds = new Set(rawOps.flatMap((op) => op.type === "add_node" && op.id ? [op.id] : []));
    const activeIdMap = new Map<string, string>();
    const reusableKnownIds = new Set<string>();
    const declaredIds = new Set<string>();
    const duplicateIds = new Set<string>();
    const activeMappedTypes = new Map<string, CanvasNodeTypeId | undefined>();
    const ops = rawOps.map((op) => {
        if (op.type !== "add_node" || !op.id) {
            const rewritten = rewriteCanvasAgentOpNodeIds(op, activeIdMap);
            if (op.type === "update_node" && op.patch?.type && activeIdMap.has(op.id)) activeMappedTypes.set(op.id, op.patch.type);
            if (op.type === "delete_node") {
                const requestedIds = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
                activeIdMap.forEach((resolvedId, originalId) => {
                    if (requestedIds.has(originalId) || requestedIds.has(resolvedId) || (op.nodeType && activeMappedTypes.get(originalId) === op.nodeType)) {
                        activeIdMap.delete(originalId);
                        activeMappedTypes.delete(originalId);
                    }
                });
            }
            return rewritten;
        }

        const originalId = op.id;
        if (declaredIds.has(originalId)) duplicateIds.add(originalId);
        const known = knownById.get(originalId);
        const mayReuseKnown = Boolean(
            known &&
            !declaredIds.has(originalId) &&
            allowCompatibleKnownIdReuse &&
            knownNodeMatchesAddition(known, op),
        );
        if (mayReuseKnown) {
            activeIdMap.delete(originalId);
            reusableKnownIds.add(originalId);
            declaredIds.add(originalId);
            return rewriteCanvasAgentOpNodeIds(op, activeIdMap);
        }

        if (usedIds.has(originalId) || declaredIds.has(originalId)) {
            const unavailableIds = new Set([...usedIds, ...reservedDeclaredIds]);
            const resolvedId = uniqueId(`${originalId}-new`, unavailableIds);
            usedIds.add(resolvedId);
            activeIdMap.set(originalId, resolvedId);
            activeMappedTypes.set(originalId, op.nodeType);
        } else {
            activeIdMap.delete(originalId);
            activeMappedTypes.delete(originalId);
            usedIds.add(originalId);
        }
        declaredIds.add(originalId);
        return rewriteCanvasAgentOpNodeIds(op, activeIdMap);
    });
    const forwardAliases = new Map([...activeIdMap].filter(([id]) => !duplicateIds.has(id)));
    return {
        ops: forwardAliases.size ? ops.map((op) => rewriteForwardNodeReferences(op, forwardAliases)) : ops,
        reusableKnownIds,
        nodeIdAliases: forwardAliases,
    };
}

function knownNodeMatchesAddition(known: ZodiacKnownCanvasNode, addition: AddNodeOp) {
    if (!addition.nodeType || addition.nodeType !== known.type) return false;
    if (normalizeSemanticValue(addition.title || defaultNodeTitle(addition.nodeType)) !== normalizeSemanticValue(known.title || defaultNodeTitle(known.type))) return false;
    if (addition.position && (!known.position || addition.position.x !== known.position.x || addition.position.y !== known.position.y)) return false;
    if (addition.width !== undefined && addition.width !== known.width) return false;
    if (addition.height !== undefined && addition.height !== known.height) return false;
    const knownMetadata = known.metadata || {};
    if (addition.nodeType === "config") {
        if (!isGenerationMode(addition.metadata?.generationMode) || addition.metadata.generationMode !== knownMetadata.generationMode) return false;
    }
    if (addition.nodeType === "terminal") {
        if (!isGenerationMode(addition.metadata?.terminalOutputMode) || addition.metadata.terminalOutputMode !== knownMetadata.terminalOutputMode) return false;
    }
    const additionMetadata = addition.metadata || {};
    if (addition.nodeType !== "config" && addition.nodeType !== "terminal") {
        const additionIsResultSlot = additionMetadata.role === "result-slot";
        const knownIsResultSlot = knownMetadata.role === "result-slot";
        if (additionIsResultSlot || knownIsResultSlot) {
            if (!additionIsResultSlot || !knownIsResultSlot) return false;
            if (!isGenerationMode(additionMetadata.resultSlotMode) || additionMetadata.resultSlotMode !== knownMetadata.resultSlotMode) return false;
            if (!additionMetadata.resultSlotSourceNodeId || additionMetadata.resultSlotSourceNodeId !== knownMetadata.resultSlotSourceNodeId) return false;
        } else if (!sameProtocolValue(normalizeSemanticValue(additionMetadata.content), normalizeSemanticValue(knownMetadata.content))) {
            return false;
        }
    }
    return ACTION_SEMANTIC_METADATA_KEYS.every((key) =>
        sameProtocolValue(normalizeSemanticValue(additionMetadata[key]), normalizeSemanticValue(knownMetadata[key])),
    );
}

function defaultNodeTitle(nodeType: CanvasNodeTypeId) {
    if (nodeType === "config") return "生成配置";
    if (nodeType === "terminal") return "终端 Agent";
    if (nodeType === "image") return "图片";
    if (nodeType === "video") return "视频";
    if (nodeType === "audio") return "音频";
    if (nodeType === "group") return "组";
    return "文本";
}

function normalizeSemanticValue(value: unknown): unknown {
    if (typeof value === "string") return value.trim() || undefined;
    if (Array.isArray(value)) return value.map(normalizeSemanticValue);
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value as Record<string, unknown>)
                .map(([key, nested]) => [key, normalizeSemanticValue(nested)])
                .filter(([, nested]) => nested !== undefined),
        );
    }
    return value;
}

function sameProtocolValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameProtocolValue(value, right[index]));
    if (left && typeof left === "object") {
        if (!right || typeof right !== "object" || Array.isArray(right)) return false;
        const leftEntries = Object.entries(left as Record<string, unknown>);
        const rightRecord = right as Record<string, unknown>;
        return leftEntries.length === Object.keys(rightRecord).length &&
            leftEntries.every(([key, value]) => sameProtocolValue(value, rightRecord[key]));
    }
    return left === right;
}

function rewriteCanvasAgentOpNodeIds(op: CanvasAgentOp, idMap: Map<string, string>): CanvasAgentOp {
    const rewrite = (id: string) => idMap.get(id) || id;
    const rewriteMetadata = (metadata: CanvasNodeMetadata | undefined) => metadata ? {
        ...metadata,
        ...(metadata.content !== undefined ? { content: rewriteStableNodeReferences(metadata.content, idMap) } : {}),
        ...(metadata.prompt !== undefined ? { prompt: rewriteStableNodeReferences(metadata.prompt, idMap) } : {}),
        ...(metadata.composerContent !== undefined ? { composerContent: rewriteStableNodeReferences(metadata.composerContent, idMap) } : {}),
        ...(metadata.audioInstructions !== undefined ? { audioInstructions: rewriteStableNodeReferences(metadata.audioInstructions, idMap) } : {}),
        ...(metadata.resultSlotSourceNodeId ? { resultSlotSourceNodeId: rewrite(metadata.resultSlotSourceNodeId) } : {}),
        ...(metadata.batchRootId ? { batchRootId: rewrite(metadata.batchRootId) } : {}),
        ...(metadata.batchChildIds ? { batchChildIds: metadata.batchChildIds.map(rewrite) } : {}),
        ...(metadata.primaryImageId ? { primaryImageId: rewrite(metadata.primaryImageId) } : {}),
        ...(metadata.groupId ? { groupId: rewrite(metadata.groupId) } : {}),
    } : undefined;
    if (op.type === "add_node") return {
        ...op,
        ...(op.id ? { id: rewrite(op.id) } : {}),
        ...(op.metadata ? { metadata: rewriteMetadata(op.metadata) } : {}),
    };
    if (op.type === "update_node") return {
        ...op,
        id: rewrite(op.id),
        ...(op.patch?.metadata ? { patch: { ...op.patch, metadata: rewriteMetadata(op.patch.metadata) } } : {}),
        ...(op.metadata ? { metadata: rewriteMetadata(op.metadata) } : {}),
    };
    if (op.type === "delete_node") return { ...op, ...(op.id ? { id: rewrite(op.id) } : {}), ...(op.ids ? { ids: op.ids.map(rewrite) } : {}) };
    if (op.type === "connect_nodes") return { ...op, fromNodeId: rewrite(op.fromNodeId), toNodeId: rewrite(op.toNodeId) };
    if (op.type === "select_nodes") return { ...op, ids: op.ids.map(rewrite) };
    if (op.type === "run_generation") return {
        ...op,
        nodeId: rewrite(op.nodeId),
        ...(op.prompt !== undefined ? { prompt: rewriteStableNodeReferences(op.prompt, idMap) } : {}),
    };
    return op;
}

function rewriteStableNodeReferences(value: string, idMap: Map<string, string>) {
    return value.replace(/@\[node:([^\]]+)\]/gu, (token, id: string) => {
        const rewritten = idMap.get(id);
        return rewritten ? `@[node:${rewritten}]` : token;
    });
}

function rewriteForwardNodeReferences(op: CanvasAgentOp, idMap: Map<string, string>): CanvasAgentOp {
    const rewrite = (id: string) => idMap.get(id) || id;
    const rewriteMetadataTokens = (metadata: CanvasNodeMetadata | undefined) => metadata ? {
        ...metadata,
        ...(metadata.content !== undefined ? { content: rewriteStableNodeReferences(metadata.content, idMap) } : {}),
        ...(metadata.prompt !== undefined ? { prompt: rewriteStableNodeReferences(metadata.prompt, idMap) } : {}),
        ...(metadata.composerContent !== undefined ? { composerContent: rewriteStableNodeReferences(metadata.composerContent, idMap) } : {}),
        ...(metadata.audioInstructions !== undefined ? { audioInstructions: rewriteStableNodeReferences(metadata.audioInstructions, idMap) } : {}),
    } : undefined;
    if (op.type === "add_node") return op.metadata ? { ...op, metadata: rewriteMetadataTokens(op.metadata) } : op;
    if (op.type === "update_node") return {
        ...op,
        ...(op.patch?.metadata ? { patch: { ...op.patch, metadata: rewriteMetadataTokens(op.patch.metadata) } } : {}),
        ...(op.metadata ? { metadata: rewriteMetadataTokens(op.metadata) } : {}),
    };
    if (op.type === "connect_nodes") return { ...op, fromNodeId: rewrite(op.fromNodeId), toNodeId: rewrite(op.toNodeId) };
    if (op.type === "select_nodes") return { ...op, ids: op.ids.map(rewrite) };
    if (op.type === "run_generation") return {
        ...op,
        nodeId: rewrite(op.nodeId),
        ...(op.prompt !== undefined ? { prompt: rewriteStableNodeReferences(op.prompt, idMap) } : {}),
    };
    return op;
}

function rewriteCanvasAgentOpPromptTokens(op: CanvasAgentOp, aliases: Map<string, string>): CanvasAgentOp {
    const rewriteMetadata = (metadata: CanvasNodeMetadata | undefined) => metadata ? {
        ...metadata,
        ...(metadata.content !== undefined ? { content: rewriteStableNodeReferences(metadata.content, aliases) } : {}),
        ...(metadata.prompt !== undefined ? { prompt: rewriteStableNodeReferences(metadata.prompt, aliases) } : {}),
        ...(metadata.composerContent !== undefined ? { composerContent: rewriteStableNodeReferences(metadata.composerContent, aliases) } : {}),
        ...(metadata.audioInstructions !== undefined ? { audioInstructions: rewriteStableNodeReferences(metadata.audioInstructions, aliases) } : {}),
    } : undefined;
    if (op.type === "add_node") return op.metadata ? { ...op, metadata: rewriteMetadata(op.metadata) } : op;
    if (op.type === "update_node") return {
        ...op,
        ...(op.patch?.metadata ? { patch: { ...op.patch, metadata: rewriteMetadata(op.patch.metadata) } } : {}),
        ...(op.metadata ? { metadata: rewriteMetadata(op.metadata) } : {}),
    };
    if (op.type === "run_generation" && op.prompt !== undefined) {
        return { ...op, prompt: rewriteStableNodeReferences(op.prompt, aliases) };
    }
    return op;
}

function mergeRepeatedRunOps(ops: CanvasAgentOp[]) {
    const mergedByNodeId = new Map<string, Extract<CanvasAgentOp, { type: "run_generation" }>>();
    const firstIndexByNodeId = new Map<string, number>();
    ops.forEach((op, index) => {
        if (op.type !== "run_generation") return;
        const current = mergedByNodeId.get(op.nodeId) || { type: "run_generation", nodeId: op.nodeId };
        mergedByNodeId.set(op.nodeId, {
            ...current,
            ...(op.mode ? { mode: op.mode } : {}),
            ...(op.prompt?.trim() ? { prompt: op.prompt } : {}),
        });
        if (!firstIndexByNodeId.has(op.nodeId)) firstIndexByNodeId.set(op.nodeId, index);
    });
    return ops.flatMap((op, index): CanvasAgentOp[] => {
        if (op.type !== "run_generation") return [op];
        return firstIndexByNodeId.get(op.nodeId) === index ? [mergedByNodeId.get(op.nodeId) as CanvasAgentOp] : [];
    });
}

function normalizeAddedNodes(ops: CanvasAgentOp[], reservedIds = new Set<string>(), reusableKnownIds = new Set<string>()) {
    const usedIds = new Set(reservedIds);
    const proposalIds = new Set<string>();
    return ops.map((op, index): CanvasAgentOp => {
        if (op.type === "update_node" && op.patch?.type === "terminal") {
            const metadata = { ...op.patch.metadata, ...op.metadata };
            const inferredMode = generationModeFrom(`${op.patch.title || ""} ${metadata.prompt || ""}`);
            return {
                ...op,
                metadata: {
                    ...metadata,
                    terminalInputMode: metadata.terminalInputMode === "auto" || isGenerationMode(metadata.terminalInputMode) ? metadata.terminalInputMode : "auto",
                    terminalOutputMode: isGenerationMode(metadata.terminalOutputMode) ? metadata.terminalOutputMode : inferredMode,
                    terminalConfigured: false,
                },
            };
        }
        if (op.type !== "add_node") return op;
        const metadata = op.metadata || {};
        const inferredMode = generationModeFrom(`${op.title || ""} ${metadata.prompt || ""} ${metadata.composerContent || ""}`);
        const resultSlotMode = resultSlotModeFrom(op.title || "");
        const nodeType = resultSlotMode ? OUTPUT_NODE_TYPE[resultSlotMode] : op.nodeType;
        const requestedId = op.id || stableNodeId(nodeType || "text", op.title, index);
        const mayReuseKnownId = Boolean(op.id && reusableKnownIds.has(op.id) && !proposalIds.has(op.id));
        const id = mayReuseKnownId ? requestedId : uniqueId(requestedId, usedIds);
        proposalIds.add(id);

        if (resultSlotMode) {
            const { generationMode: _generationMode, composerContent: _composerContent, prompt: _prompt, ...slotMetadata } = metadata;
            return { ...op, id, nodeType, metadata: { ...slotMetadata, status: metadata.status || "idle" } };
        }
        if (nodeType === "config") {
            return { ...op, id, nodeType, metadata: { ...metadata, generationMode: isGenerationMode(metadata.generationMode) ? metadata.generationMode : inferredMode } };
        }
        if (nodeType === "terminal") {
            return {
                ...op,
                id,
                nodeType,
                metadata: {
                    ...metadata,
                    terminalInputMode: metadata.terminalInputMode === "auto" || isGenerationMode(metadata.terminalInputMode) ? metadata.terminalInputMode : "auto",
                    terminalOutputMode: isGenerationMode(metadata.terminalOutputMode) ? metadata.terminalOutputMode : inferredMode,
                    terminalConfigured: false,
                },
            };
        }
        return { ...op, id, nodeType };
    });
}

function isActionNode(op: AddNodeOp) {
    return isActionNodeType(op.nodeType);
}

function isActionNodeType(type: unknown) {
    return type === "config" || type === "terminal";
}

function actionOutputMode(op: AddNodeOp): CanvasGenerationMode {
    const metadata = op.metadata || {};
    if (op.nodeType === "terminal" && isGenerationMode(metadata.terminalOutputMode)) return metadata.terminalOutputMode;
    if (isGenerationMode(metadata.generationMode)) return metadata.generationMode;
    return generationModeFrom(`${op.title || ""} ${metadata.prompt || ""} ${metadata.composerContent || ""}`);
}

function isCompatibleOutputNode(op: AddNodeOp, mode: CanvasGenerationMode) {
    return op.nodeType === OUTPUT_NODE_TYPE[mode];
}

function isOwnedResultSlot(op: AddNodeOp, mode: CanvasGenerationMode, actionId: string) {
    return isCompatibleOutputNode(op, mode) &&
        op.metadata?.role === "result-slot" &&
        op.metadata.resultSlotSourceNodeId === actionId;
}

function bestResultSlot(slots: AddNodeOp[], connectedIds = new Set<string>()) {
    return [...slots].sort((left, right) => {
        const scoreDelta = resultSlotScore(right) - resultSlotScore(left);
        if (scoreDelta) return scoreDelta;
        return Number(connectedIds.has(right.id as string)) - Number(connectedIds.has(left.id as string));
    })[0];
}

function resultSlotScore(slot: AddNodeOp) {
    const metadata = slot.metadata || {};
    return (metadata.currentResultVersionId ? 100 : 0) +
        (metadata.slotState === "ready" ? 60 : 0) +
        (metadata.status === "success" ? 30 : 0) +
        (metadata.storageKey || metadata.content ? 20 : 0) +
        Math.min(metadata.resultVersions?.length || 0, 10);
}

function isClaimableOutputNode(op: AddNodeOp, mode: CanvasGenerationMode, actionId: string) {
    if (!isCompatibleOutputNode(op, mode)) return false;
    return op.metadata?.role !== "result-slot" || !op.metadata.resultSlotSourceNodeId || op.metadata.resultSlotSourceNodeId === actionId;
}

function collectParticipatingActionIds(
    seedActionIds: Set<string>,
    nodeById: Map<string, AddNodeOp>,
    connections: ConnectNodesOp[],
) {
    const result = new Set<string>();
    const queue: string[] = [];
    const addAction = (id: string | undefined) => {
        const node = id ? nodeById.get(id) : undefined;
        if (!id || !node || result.has(id) || !isActionNode(node)) return;
        result.add(id);
        queue.push(id);
    };
    seedActionIds.forEach(addAction);

    for (let index = 0; index < queue.length; index += 1) {
        const actionId = queue[index];
        const action = nodeById.get(actionId);
        if (!action) continue;
        const mode = actionOutputMode(action);
        const possibleOutputIds = new Set<string>();

        connections.forEach((connection) => {
            if (connection.fromNodeId !== actionId) return;
            const target = nodeById.get(connection.toNodeId);
            if (!target) return;
            if (isActionNode(target)) {
                addAction(connection.toNodeId);
                return;
            }
            if (isResultSlotOwnedByAction(target, actionId) || isClaimableOutputNode(target, mode, actionId)) {
                possibleOutputIds.add(connection.toNodeId);
            }
        });
        nodeById.forEach((node, id) => {
            if (isResultSlotOwnedByAction(node, actionId)) possibleOutputIds.add(id);
        });
        connections.forEach((connection) => {
            const target = nodeById.get(connection.toNodeId);
            if (possibleOutputIds.has(connection.fromNodeId) && target && isActionNode(target)) {
                addAction(connection.toNodeId);
            }
        });

        connections.forEach((connection) => {
            if (connection.toNodeId !== actionId) return;
            const source = nodeById.get(connection.fromNodeId);
            if (!source) return;
            if (isActionNode(source)) {
                addAction(connection.fromNodeId);
                return;
            }
            const declaredOwnerId = source.metadata?.role === "result-slot" ? source.metadata.resultSlotSourceNodeId : undefined;
            const declaredOwner = declaredOwnerId ? nodeById.get(declaredOwnerId) : undefined;
            if (declaredOwnerId && declaredOwner && isActionNode(declaredOwner)) addAction(declaredOwnerId);
            connections.forEach((writer) => {
                if (writer.toNodeId !== connection.fromNodeId) return;
                const writerNode = nodeById.get(writer.fromNodeId);
                if (!writerNode || !isActionNode(writerNode)) return;
                if (declaredOwnerId) {
                    if (writer.fromNodeId === declaredOwnerId) addAction(writer.fromNodeId);
                    return;
                }
                if (isClaimableOutputNode(source, actionOutputMode(writerNode), writer.fromNodeId)) addAction(writer.fromNodeId);
            });
        });
    }
    return result;
}

function collectResultSlotAliases(
    bindings: ZodiacWorkflowBinding[],
    nodeById: Map<string, AddNodeOp>,
    connections: ConnectNodesOp[],
    bindingByOutputId: Map<string, ZodiacWorkflowBinding>,
) {
    const aliases = new Map<string, string>();
    bindings.forEach((binding) => {
        nodeById.forEach((node, nodeId) => {
            if (nodeId === binding.outputNodeId || bindingByOutputId.has(nodeId)) return;
            const declaredOwnerId = node.metadata?.resultSlotSourceNodeId;
            const connectedFromAction = connections.some(
                (connection) => connection.fromNodeId === binding.actionId && connection.toNodeId === nodeId,
            );
            const looksLikeResultSlot = node.metadata?.role === "result-slot" || Boolean(resultSlotModeFrom(node.title || ""));
            if (declaredOwnerId === binding.actionId || (!declaredOwnerId && looksLikeResultSlot && connectedFromAction)) {
                aliases.set(nodeId, binding.outputNodeId);
            }
        });
    });
    return aliases;
}

function collectDeletedOwnedSlotRoutes(
    knownNodes: ZodiacKnownCanvasNode[],
    knownConnections: ZodiacKnownCanvasConnection[],
    activeNodeIds: Set<string>,
    activeActionIds: Set<string>,
    deletions: ReturnType<typeof collectProposalDeletions>,
) {
    if (deletions.allConnections) return [];
    const ownerByDeletedSlotId = new Map<string, string>();
    knownNodes.forEach((node) => {
        if (activeNodeIds.has(node.id) || node.metadata?.role !== "result-slot" || !node.metadata.resultSlotSourceNodeId) return;
        const ownerId = node.metadata.resultSlotSourceNodeId;
        if (activeActionIds.has(ownerId)) ownerByDeletedSlotId.set(node.id, ownerId);
    });
    return dedupeConnections(knownConnections.flatMap((connection): ConnectNodesOp[] => {
        if (connection.id && deletions.connectionIds.has(connection.id)) return [];
        const ownerId = ownerByDeletedSlotId.get(connection.fromNodeId);
        if (!ownerId || !activeActionIds.has(connection.toNodeId)) return [];
        return [{ type: "connect_nodes", fromNodeId: ownerId, toNodeId: connection.toNodeId }];
    }));
}

function collectDeletedResultSlotAliases(
    bindings: ZodiacWorkflowBinding[],
    knownNodes: ZodiacKnownCanvasNode[],
    activeNodeIds: Set<string>,
) {
    const bindingByActionId = new Map(bindings.map((binding) => [binding.actionId, binding]));
    const aliases = new Map<string, string>();
    knownNodes.forEach((node) => {
        if (activeNodeIds.has(node.id) || node.metadata?.role !== "result-slot" || !node.metadata.resultSlotSourceNodeId) return;
        const ownerId = node.metadata.resultSlotSourceNodeId;
        const binding = bindingByActionId.get(ownerId);
        if (binding && node.id !== binding.outputNodeId) aliases.set(node.id, binding.outputNodeId);
    });
    return aliases;
}

function collectStableReferenceMetadataUpdates(
    nodeIds: Set<string>,
    nodeById: Map<string, AddNodeOp>,
    aliases: Map<string, string>,
) {
    const keys = ["content", "prompt", "composerContent", "audioInstructions"] as const satisfies readonly (keyof CanvasNodeMetadata)[];
    const ops: CanvasAgentOp[] = [];
    nodeIds.forEach((id) => {
        const metadata = nodeById.get(id)?.metadata;
        if (!metadata) return;
        const patch: CanvasNodeMetadata = {};
        keys.forEach((key) => {
            const value = metadata[key];
            if (typeof value !== "string") return;
            const rewritten = rewriteStableNodeReferences(value, aliases);
            if (rewritten !== value) (patch as Record<string, unknown>)[key] = rewritten;
        });
        if (Object.keys(patch).length) ops.push({ type: "update_node", id, metadata: patch });
    });
    return ops;
}

function actionMeaningChanged(original: ZodiacKnownCanvasNode | undefined, current: AddNodeOp | undefined) {
    if (!original || !current || original.type !== current.nodeType) return true;
    if (normalizeSemanticValue(original.title) !== normalizeSemanticValue(current.title)) return true;
    const before = original.metadata || {};
    const after = current.metadata || {};
    return ACTION_SEMANTIC_METADATA_KEYS.some((key) =>
        !sameProtocolValue(normalizeSemanticValue(before[key]), normalizeSemanticValue(after[key])),
    );
}

function dedupeConnections(connections: ConnectNodesOp[]) {
    const seen = new Set<string>();
    return connections.filter((connection) => {
        const key = edgeKey(connection.fromNodeId, connection.toNodeId);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function collectRequiredRunActionIds(
    explicitlyRunIds: Set<string>,
    bindings: ZodiacWorkflowBinding[],
    nodeById: Map<string, AddNodeOp>,
    mutatedActionIds: Set<string>,
) {
    const bindingById = new Map(bindings.map((binding) => [binding.actionId, binding]));
    const upstreamByActionId = new Map<string, ZodiacWorkflowBinding[]>();
    bindings.forEach((binding) => binding.nextActionIds.forEach((nextActionId) => {
        const upstream = upstreamByActionId.get(nextActionId) || [];
        upstream.push(binding);
        upstreamByActionId.set(nextActionId, upstream);
    }));
    const required = new Set([...explicitlyRunIds].filter((id) => bindingById.has(id)));
    const queue = [...required];
    for (let index = 0; index < queue.length; index += 1) {
        const targetId = queue[index];
        (upstreamByActionId.get(targetId) || []).forEach((sourceBinding) => {
            if (required.has(sourceBinding.actionId)) return;
            const output = nodeById.get(sourceBinding.outputNodeId);
            if (!mutatedActionIds.has(sourceBinding.actionId) && isReadyResultSlot(output)) return;
            required.add(sourceBinding.actionId);
            queue.push(sourceBinding.actionId);
        });
    }
    return required;
}

function isResultSlotOwnedByAction(node: AddNodeOp, actionId: string) {
    return node.metadata?.role === "result-slot" && node.metadata.resultSlotSourceNodeId === actionId;
}

function isReadyResultSlot(node: AddNodeOp | undefined) {
    return Boolean(node?.metadata?.slotState === "ready" && selectedSuccessfulResultVersion(node));
}

function collectProposalDeletions(ops: CanvasAgentOp[], knownNodes: ZodiacKnownCanvasNode[]) {
    const nodeIds = new Set<string>();
    const connectionIds = new Set<string>();
    let allConnections = false;
    ops.forEach((op) => {
        if (op.type === "delete_node") {
            if (op.id) nodeIds.add(op.id);
            op.ids?.forEach((id) => nodeIds.add(id));
            if (op.nodeType) knownNodes.forEach((node) => {
                if (node.type === op.nodeType) nodeIds.add(node.id);
            });
        }
        if (op.type === "delete_connections") {
            if (op.id) connectionIds.add(op.id);
            op.ids?.forEach((id) => connectionIds.add(id));
            if (op.all) allConnections = true;
        }
    });
    return { nodeIds, connectionIds, allConnections };
}

type MaterializedProposalNode = { node: AddNodeOp; origin: "known" | "addition" };

type RetiredActionSlotReconciliation =
    | {
        valid: true;
        nodes: Map<string, MaterializedProposalNode>;
        ops: CanvasAgentOp[];
        connections: ConnectNodesOp[];
        aliases: Map<string, string>;
        consumerIds: Set<string>;
    }
    | { valid: false };

function reconcileRetiredActionSlots(
    materializedNodes: Map<string, MaterializedProposalNode>,
    knownNodes: ZodiacKnownCanvasNode[],
    knownConnections: ZodiacKnownCanvasConnection[],
    normalizedOps: CanvasAgentOp[],
    deletions: ReturnType<typeof collectProposalDeletions>,
): RetiredActionSlotReconciliation {
    const nodes = new Map(materializedNodes);
    const originalActionIds = new Set(knownNodes.filter((node) => node.type === "config" || node.type === "terminal").map((node) => node.id));
    const finalActionIds = new Set([...nodes.entries()].filter(([, entry]) => isActionNode(entry.node)).map(([id]) => id));
    const retiredActionIds = new Set([...originalActionIds].filter((id) => !finalActionIds.has(id)));
    const ops: CanvasAgentOp[] = [];
    const connections: ConnectNodesOp[] = [];
    const aliases = new Map<string, string>();
    const consumerIds = new Set<string>();
    if (!retiredActionIds.size) return { valid: true, nodes, ops, connections, aliases, consumerIds };

    const liveKnownConnections = deletions.allConnections
        ? []
        : knownConnections.filter((connection) => !connection.id || !deletions.connectionIds.has(connection.id));
    const liveProposedConnections = collectLiveProposedConnections(normalizedOps, knownNodes);
    const candidateConnections = dedupeConnections([
        ...liveKnownConnections.map((connection) => ({ type: "connect_nodes" as const, ...connection })),
        ...liveProposedConnections,
    ]);
    const usedNodeIds = new Set([...knownNodes.map((node) => node.id), ...nodes.keys()]);

    for (const knownSlot of knownNodes) {
        const ownerId = knownSlot.metadata?.role === "result-slot" ? knownSlot.metadata.resultSlotSourceNodeId : undefined;
        if (!ownerId || !retiredActionIds.has(ownerId)) continue;
        const consumers = candidateConnections.filter((connection) =>
            connection.fromNodeId === knownSlot.id && nodes.has(connection.toNodeId),
        );
        const currentEntry = nodes.get(knownSlot.id);
        const alreadyFrozen = currentEntry ? undefined : findAlreadyFrozenResult(nodes, knownSlot);
        if (alreadyFrozen) {
            aliases.set(knownSlot.id, alreadyFrozen.id as string);
            consumers.forEach((connection) => {
                consumerIds.add(connection.toNodeId);
                connections.push({
                    type: "connect_nodes",
                    id: `zodiac-frozen-link--${safeIdPart(alreadyFrozen.id as string)}--${safeIdPart(connection.toNodeId)}`,
                    fromNodeId: alreadyFrozen.id as string,
                    toNodeId: connection.toNodeId,
                });
            });
            continue;
        }
        const current = currentEntry?.node || knownNodeAsAddition(knownSlot);
        const activeActionConsumers = consumers.filter((connection) => finalActionIds.has(connection.toNodeId));
        const durableVersion = selectedSuccessfulResultVersion(current);
        if (!durableVersion && activeActionConsumers.length) return { valid: false };

        nodes.delete(knownSlot.id);
        if (!deletions.nodeIds.has(knownSlot.id)) ops.push({ type: "delete_node", id: knownSlot.id });
        if (!durableVersion) continue;

        const frozenId = uniqueId(`${knownSlot.id}--frozen`, usedNodeIds);
        const frozen = freezeResultSlotAsResource(current, frozenId, durableVersion);
        nodes.set(frozenId, { origin: "addition", node: frozen });
        ops.push(frozen);
        aliases.set(knownSlot.id, frozenId);
        consumers.forEach((connection) => {
            consumerIds.add(connection.toNodeId);
            connections.push({
                type: "connect_nodes",
                id: `zodiac-frozen-link--${safeIdPart(frozenId)}--${safeIdPart(connection.toNodeId)}`,
                fromNodeId: frozenId,
                toNodeId: connection.toNodeId,
            });
        });
    }
    return { valid: true, nodes, ops, connections, aliases, consumerIds };
}

function findAlreadyFrozenResult(
    nodes: Map<string, MaterializedProposalNode>,
    knownSlot: ZodiacKnownCanvasNode,
) {
    const prefix = `${knownSlot.id}--frozen`;
    const selectedId = knownSlot.metadata?.currentResultVersionId;
    if (!selectedId) return undefined;
    return [...nodes.values()]
        .map((entry) => entry.node)
        .find((candidate) =>
            candidate.nodeType === knownSlot.type &&
            candidate.metadata?.role !== "result-slot" &&
            (candidate.id === prefix || candidate.id?.startsWith(`${prefix}-`)) &&
            candidate.metadata?.currentResultVersionId === selectedId &&
            sameProtocolValue(
                normalizeSemanticValue(candidate.metadata?.resultVersions),
                normalizeSemanticValue(knownSlot.metadata?.resultVersions),
            ));
}

function selectedSuccessfulResultVersion(node: AddNodeOp) {
    const selectedId = node.metadata?.currentResultVersionId;
    if (!selectedId) return undefined;
    return node.metadata?.resultVersions?.find(
        (version): version is Extract<CanvasResultSlotVersion, { status: "success" }> => version.id === selectedId && version.status === "success",
    );
}

function freezeResultSlotAsResource(
    slot: AddNodeOp,
    frozenId: string,
    version: NonNullable<ReturnType<typeof selectedSuccessfulResultVersion>>,
): AddNodeOp {
    const {
        role: _role,
        advanceMode: _advanceMode,
        slotState: _slotState,
        resultSlotMode: _resultSlotMode,
        resultSlotSourceNodeId: _resultSlotSourceNodeId,
        ...ordinaryMetadata
    } = slot.metadata || {};
    const primaryArtifact = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId) || version.artifacts[0];
    return {
        ...slot,
        type: "add_node",
        id: frozenId,
        title: (slot.title || "保留结果").replace(/槽/gu, "") || "保留结果",
        metadata: {
            ...ordinaryMetadata,
            ...(ordinaryMetadata.content || !primaryArtifact?.content ? {} : { content: primaryArtifact.content }),
            ...(ordinaryMetadata.storageKey || !primaryArtifact?.storageKey ? {} : { storageKey: primaryArtifact.storageKey }),
            ...(ordinaryMetadata.mimeType || !primaryArtifact?.mimeType ? {} : { mimeType: primaryArtifact.mimeType }),
            ...(ordinaryMetadata.bytes || !primaryArtifact?.bytes ? {} : { bytes: primaryArtifact.bytes }),
        },
    };
}

function freezeDestructiveTargets(
    ops: CanvasAgentOp[],
    knownNodes: ZodiacKnownCanvasNode[],
    knownConnections: ZodiacKnownCanvasConnection[],
) {
    const nodeTypes = new Map(knownNodes.map((node) => [node.id, node.type]));
    const connectionById = new Map(knownConnections.filter((connection) => connection.id).map((connection) => [connection.id as string, connection]));
    const anonymousConnections: ZodiacKnownCanvasConnection[] = knownConnections.filter((connection) => !connection.id);
    const usedConnectionIds = new Set(connectionById.keys());
    const identifiedOps = ops.map((op): CanvasAgentOp => op.type === "connect_nodes" && !op.id
        ? { ...op, id: uniqueId(`zodiac-proposal-link--${safeIdPart(op.fromNodeId)}--${safeIdPart(op.toNodeId)}`, usedConnectionIds) }
        : op);
    return identifiedOps.map((op): CanvasAgentOp => {
        if (op.type === "add_node" && op.id) nodeTypes.set(op.id, op.nodeType || "text");
        if (op.type === "update_node" && op.patch?.type && nodeTypes.has(op.id)) nodeTypes.set(op.id, op.patch.type);
        if (op.type === "connect_nodes") {
            if (op.id) connectionById.set(op.id, op);
            else anonymousConnections.push(op);
        }
        if (op.type === "delete_node") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            if (op.nodeType) nodeTypes.forEach((type, id) => {
                if (type === op.nodeType) ids.add(id);
            });
            ids.forEach((id) => nodeTypes.delete(id));
            connectionById.forEach((connection, id) => {
                if (ids.has(connection.fromNodeId) || ids.has(connection.toNodeId)) connectionById.delete(id);
            });
            for (let index = anonymousConnections.length - 1; index >= 0; index -= 1) {
                const connection = anonymousConnections[index];
                if (ids.has(connection.fromNodeId) || ids.has(connection.toNodeId)) anonymousConnections.splice(index, 1);
            }
            return op.nodeType ? { type: "delete_node", ids: [...ids] } : op;
        }
        if (op.type === "delete_connections") {
            if (op.all) {
                const ids = [...connectionById.keys()];
                connectionById.clear();
                anonymousConnections.splice(0, anonymousConnections.length);
                return { type: "delete_connections", ids };
            }
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            ids.forEach((id) => connectionById.delete(id));
        }
        return op;
    });
}

function materializeProposalNodes(
    ops: CanvasAgentOp[],
    knownNodes: ZodiacKnownCanvasNode[],
    reusableKnownIds: Set<string>,
) {
    const nodes = new Map<string, MaterializedProposalNode>(knownNodes.map((known) => [known.id, {
        origin: "known",
        node: knownNodeAsAddition(known),
    }]));

    ops.filter((op) => op.type !== "run_generation").forEach((op) => {
        if (op.type === "add_node" && op.id) {
            const current = nodes.get(op.id);
            const reusesCurrentKnown = current?.origin === "known" && reusableKnownIds.has(op.id);
            nodes.set(op.id, {
                origin: reusesCurrentKnown ? "known" : "addition",
                node: reusesCurrentKnown ? mergeReusableKnownAddition(op, additionAsKnownNode(current.node)) : op,
            });
        }
        if (op.type === "update_node") {
            const current = nodes.get(op.id);
            if (!current) return;
            const patch = op.patch || {};
            nodes.set(op.id, {
                ...current,
                node: {
                    ...current.node,
                    nodeType: patch.type || current.node.nodeType,
                    title: patch.title ?? current.node.title,
                    position: patch.position ?? current.node.position,
                    width: patch.width ?? current.node.width,
                    height: patch.height ?? current.node.height,
                    metadata: {
                        ...current.node.metadata,
                        ...patch.metadata,
                        ...op.metadata,
                    },
                },
            });
        }
        if (op.type === "delete_node") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            if (op.nodeType) nodes.forEach((entry, id) => {
                if (entry.node.nodeType === op.nodeType) ids.add(id);
            });
            ids.forEach((id) => nodes.delete(id));
        }
    });

    ops.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation").forEach((op) => {
        const current = nodes.get(op.nodeId);
        if (!current) return;
        nodes.set(op.nodeId, {
            ...current,
            node: {
                ...current.node,
                metadata: {
                    ...current.node.metadata,
                    ...(op.mode
                        ? current.node.nodeType === "terminal"
                            ? { terminalOutputMode: op.mode }
                            : { generationMode: op.mode }
                        : {}),
                    ...(op.prompt?.trim() ? { prompt: op.prompt.trim(), composerContent: op.prompt.trim() } : {}),
                },
            },
        });
    });
    return nodes;
}

function knownNodeAsAddition(node: ZodiacKnownCanvasNode): AddNodeOp {
    return {
        type: "add_node",
        id: node.id,
        nodeType: node.type,
        title: node.title,
        position: node.position,
        width: node.width,
        height: node.height,
        metadata: node.metadata,
    };
}

function additionAsKnownNode(node: AddNodeOp): ZodiacKnownCanvasNode {
    return {
        id: node.id as string,
        type: node.nodeType as CanvasNodeTypeId,
        title: node.title,
        position: node.position,
        width: node.width,
        height: node.height,
        metadata: node.metadata,
    };
}

function collectLiveProposedConnections(ops: CanvasAgentOp[], knownNodes: ZodiacKnownCanvasNode[]) {
    const nodeTypes = new Map(knownNodes.map((node) => [node.id, node.type]));
    let connections: ConnectNodesOp[] = [];
    const removeNodeConnections = (ids: Set<string>) => {
        connections = connections.filter((connection) => !ids.has(connection.fromNodeId) && !ids.has(connection.toNodeId));
    };
    ops.forEach((op) => {
        if (op.type === "add_node" && op.id) nodeTypes.set(op.id, op.nodeType || "text");
        if (op.type === "update_node" && op.patch?.type && nodeTypes.has(op.id)) nodeTypes.set(op.id, op.patch.type);
        if (op.type === "connect_nodes") {
            if (op.id) connections = connections.filter((connection) => connection.id !== op.id);
            connections.push(op);
        }
        if (op.type === "delete_connections") {
            if (op.all) connections = [];
            else {
                const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
                connections = connections.filter((connection) => !connection.id || !ids.has(connection.id));
            }
        }
        if (op.type === "delete_node") {
            const ids = new Set([...(op.ids || []), ...(op.id ? [op.id] : [])]);
            if (op.nodeType) nodeTypes.forEach((type, id) => {
                if (type === op.nodeType) ids.add(id);
            });
            removeNodeConnections(ids);
            ids.forEach((id) => nodeTypes.delete(id));
        }
    });
    return connections;
}

function ensureUniqueConnectionIds(
    proposed: ConnectNodesOp[],
    knownConnections: ZodiacKnownCanvasConnection[],
) {
    const knownById = new Map(knownConnections.filter((connection) => connection.id).map((connection) => [connection.id as string, connection]));
    const usedIds = new Set(knownById.keys());
    const seenEdges = new Set<string>();
    return proposed.flatMap((connection) => {
        const key = edgeKey(connection.fromNodeId, connection.toNodeId);
        if (seenEdges.has(key)) return [];
        seenEdges.add(key);
        if (!connection.id) return [connection];
        const known = knownById.get(connection.id);
        if (known?.fromNodeId === connection.fromNodeId && known.toNodeId === connection.toNodeId) return [connection];
        if (!usedIds.has(connection.id)) {
            usedIds.add(connection.id);
            return [connection];
        }
        return [{ ...connection, id: uniqueId(`${connection.id}-new`, usedIds) }];
    });
}

function mergeReusableKnownAddition(addition: AddNodeOp, known: ZodiacKnownCanvasNode): AddNodeOp {
    return {
        ...addition,
        title: addition.title || known.title,
        position: addition.position || known.position,
        width: addition.width ?? known.width,
        height: addition.height ?? known.height,
        metadata: { ...addition.metadata, ...known.metadata },
    };
}

function createOutputSlot(action: AddNodeOp, mode: CanvasGenerationMode, usedIds: Set<string>): AddNodeOp {
    const actionId = action.id as string;
    return {
        type: "add_node",
        id: uniqueId(`${actionId}--${mode}-result`, usedIds),
        nodeType: OUTPUT_NODE_TYPE[mode],
        title: OUTPUT_NODE_TITLE[mode],
        position: {
            x: (action.position?.x ?? action.x ?? 0) + (action.width || 340) + 96,
            y: action.position?.y ?? action.y ?? 0,
        },
        metadata: resultSlotMetadata(actionId, mode),
    };
}

function asExplicitResultSlot(slot: AddNodeOp, mode: CanvasGenerationMode, actionId: string): AddNodeOp {
    return {
        ...slot,
        nodeType: OUTPUT_NODE_TYPE[mode],
        title: slot.title || OUTPUT_NODE_TITLE[mode],
        metadata: {
            ...slot.metadata,
            ...resultSlotMetadata(actionId, mode),
        },
    };
}

function asExistingResultSlot(slot: AddNodeOp, mode: CanvasGenerationMode, actionId: string): AddNodeOp {
    const metadata = slot.metadata || {};
    return {
        ...slot,
        nodeType: OUTPUT_NODE_TYPE[mode],
        title: slot.title || OUTPUT_NODE_TITLE[mode],
        metadata: {
            ...metadata,
            role: "result-slot",
            advanceMode: metadata.advanceMode || "review",
            slotState: metadata.slotState || (metadata.currentResultVersionId || metadata.content || metadata.storageKey ? "ready" : "empty"),
            resultSlotMode: mode,
            resultSlotSourceNodeId: actionId,
            resultVersions: metadata.resultVersions || [],
        },
    };
}

function resultSlotMetadata(actionId: string, mode: CanvasGenerationMode) {
    return {
        content: "",
        status: "idle" as const,
        role: "result-slot" as const,
        advanceMode: "review" as const,
        slotState: "empty" as const,
        resultSlotMode: mode,
        resultSlotSourceNodeId: actionId,
        resultVersions: [],
        currentResultVersionId: undefined,
    };
}

function addConnection(
    fromNodeId: string,
    toNodeId: string,
    existing: ConnectNodesOp[],
    additions: ConnectNodesOp[],
    usedIds: Set<string>,
) {
    if (existing.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return;
    if (additions.some((connection) => connection.fromNodeId === fromNodeId && connection.toNodeId === toNodeId)) return;
    additions.push({
        type: "connect_nodes",
        id: uniqueId(`zodiac-link--${safeIdPart(fromNodeId)}--${safeIdPart(toNodeId)}`, usedIds),
        fromNodeId,
        toNodeId,
    });
}

function resultSlotModeFrom(title: string): CanvasGenerationMode | undefined {
    if (!/(?:结果|产物|输出|资产)(?:槽|节点)|(?:槽|节点)(?:结果|产物|输出|资产)/u.test(title)) return undefined;
    return generationModeFrom(title);
}

function generationModeFrom(text: string): CanvasGenerationMode {
    if (/(?:视频|动效|动画|影片)/u.test(text)) return "video";
    if (/(?:音频|音乐|语音|配音)/u.test(text)) return "audio";
    if (/(?:图片|图像|生图|绘图|视觉)/u.test(text)) return "image";
    return "text";
}

function isGenerationMode(value: unknown): value is CanvasGenerationMode {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function stableNodeId(nodeType: CanvasNodeTypeId, title: string | undefined, index: number) {
    const titlePart = safeIdPart(title || "node") || "node";
    return `zodiac-${safeIdPart(nodeType)}-${titlePart}-${index + 1}`;
}

function uniqueId(base: string, usedIds: Set<string>) {
    let id = base;
    let suffix = 2;
    while (usedIds.has(id)) id = `${base}-${suffix++}`;
    usedIds.add(id);
    return id;
}

function safeIdPart(value: string) {
    return value
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9\u4e00-\u9fff_-]+/gu, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 64);
}

function edgeKey(fromNodeId: string, toNodeId: string) {
    return `${fromNodeId}\u0000${toNodeId}`;
}

function hasWorkflowCycle(bindings: ZodiacWorkflowBinding[]) {
    const bindingById = new Map(bindings.map((binding) => [binding.actionId, binding]));
    const visiting = new Set<string>();
    const visited = new Set<string>();
    const visit = (actionId: string): boolean => {
        if (visiting.has(actionId)) return true;
        if (visited.has(actionId)) return false;
        visiting.add(actionId);
        const cyclic = (bindingById.get(actionId)?.nextActionIds || [])
            .filter((nextId) => bindingById.has(nextId))
            .some(visit);
        visiting.delete(actionId);
        visited.add(actionId);
        return cyclic;
    };
    return bindings.some((binding) => visit(binding.actionId));
}

function asUnknownRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function parseZodiacToolFence(label: string, body: string): Omit<ParsedZodiacToolPayload, "text"> | undefined {
    try {
        const record = parseZodiacProtocolObject(body);
        const rawOps = Array.isArray(record?.ops) ? record.ops : [];
        const ops = normalizeZodiacCanvasOps(rawOps);
        if (!record || !ops.length || ops.length !== rawOps.length) return undefined;
        if (label.toLowerCase() === "json") {
            const keys = Object.keys(record);
            const exactProtocolShape = keys.every((key) => key === "summary" || key === "executionMode" || key === "ops");
            const hasLegacyOperationField = rawOps.some((item) => Boolean(stringValue(asUnknownRecord(item)?.op)));
            const legacyMarker = typeof record.summary === "string" && (
                record.executionMode === "guided" || record.executionMode === "automatic" || hasLegacyOperationField
            );
            if (!exactProtocolShape || !legacyMarker) return undefined;
        }
        return {
            summary: stringValue(record.summary),
            executionMode: record.executionMode,
            ops,
        };
    } catch {
        return undefined;
    }
}

type ZodiacFenceBlock = { start: number; end: number; label: "zodic-ops" | "json"; body: string };

type UnfinishedZodiacFence = Pick<ZodiacFenceBlock, "start" | "label" | "body">;

function scanZodiacToolPayloads(text: string) {
    const fenced = scanZodiacToolFences(text);
    const raw = scanRawZodiacToolPayloads(text, fenced);
    return { blocks: [...fenced.blocks, ...raw.blocks].sort((left, right) => left.start - right.start) };
}

function scanRawZodiacToolPayloads(text: string, fenced: ReturnType<typeof scanZodiacToolFences>) {
    const fencedRanges = fenced.blocks.map((block) => ({ start: block.start, end: block.end }));
    if (fenced.unfinished) fencedRanges.push({ start: fenced.unfinished.start, end: text.length });
    const blocks: ZodiacFenceBlock[] = [];
    const ranges: Array<{ start: number; end: number }> = [];
    const marker = /^[\t ]*(?:<\|[\w.-]+\|>[\t ]*)?zodic-ops[\t ]*(?=\{|\r?$)/gimu;
    let match: RegExpExecArray | null;
    while ((match = marker.exec(text))) {
        const start = match.index;
        if (fencedRanges.some((range) => start >= range.start && start < range.end)) continue;
        const bodyStart = skipProtocolWhitespace(text, marker.lastIndex);
        if (text[bodyStart] !== "{") {
            const end = protocolLineEnd(text, bodyStart);
            ranges.push({ start, end });
            marker.lastIndex = end;
            continue;
        }
        const jsonEnd = balancedProtocolObjectEnd(text, bodyStart, MAX_RAW_TOOL_BYTES);
        if (jsonEnd === undefined) {
            ranges.push({ start, end: text.length });
            break;
        }
        const end = rawProtocolTransportEnd(text, jsonEnd);
        blocks.push({ start, end, label: "zodic-ops", body: text.slice(bodyStart, jsonEnd) });
        ranges.push({ start, end });
        marker.lastIndex = end;
    }
    scanZodiacProviderToolCalls(text).forEach((call) => {
        const occupied = [...fencedRanges, ...ranges];
        if (occupied.some((range) => call.start >= range.start && call.start < range.end)) return;
        const toolBodies = call.bodies.filter(looksLikeToolBody);
        const recognizablePartial = call.unfinished && /"ops"\s*:\s*\[/u.test(text.slice(call.start, call.end));
        if (!toolBodies.length && !recognizablePartial) return;
        toolBodies.forEach((body) => blocks.push({ start: call.start, end: call.end, label: "zodic-ops", body }));
        ranges.push({ start: call.start, end: call.end });
    });
    scanBareZodiacProtocolObjects(text, [...fencedRanges, ...ranges]).forEach((block) => {
        blocks.push(block);
        ranges.push({ start: block.start, end: block.end });
    });
    return { blocks, ranges };
}

function looksLikeToolBody(body: string) {
    try {
        const record = parseZodiacProtocolObject(body);
        return Boolean(record && Array.isArray(record.ops));
    } catch {
        return false;
    }
}

function scanBareZodiacProtocolObjects(text: string, occupied: Array<{ start: number; end: number }>) {
    const blocks: ZodiacFenceBlock[] = [];
    const opening = /(?:^|\r?\n)[\t ]*(\{)/gu;
    let match: RegExpExecArray | null;
    while ((match = opening.exec(text))) {
        const start = match.index + match[0].lastIndexOf("{");
        if (occupied.some((range) => start >= range.start && start < range.end)) continue;
        const end = balancedProtocolObjectEnd(text, start, MAX_RAW_TOOL_BYTES);
        if (end === undefined) continue;
        const body = text.slice(start, end);
        if (!parseZodiacToolFence("json", body) && !looksLikeZodiacProtocolBody(body)) continue;
        const block = { start, end, label: "json" as const, body };
        blocks.push(block);
        occupied.push({ start, end });
        opening.lastIndex = end;
    }
    return blocks;
}

function parseZodiacProtocolObject(body: string) {
    const source = body.trim().replace(/^\uFEFF/u, "");
    const candidates = [source];
    const withoutTrailingCommas = removeJsonTrailingCommas(source);
    if (withoutTrailingCommas !== source) candidates.push(withoutTrailingCommas);
    for (const candidate of candidates) {
        try {
            const record = asUnknownRecord(JSON.parse(candidate) as unknown);
            if (record) return record;
        } catch {
            // Try only the conservative trailing-comma repair below.
        }
    }
    return undefined;
}

function removeJsonTrailingCommas(source: string) {
    let output = "";
    let inString = false;
    let escaped = false;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (inString) {
            output += character;
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === "\"") inString = false;
            continue;
        }
        if (character === "\"") {
            inString = true;
            output += character;
            continue;
        }
        if (character === ",") {
            let cursor = index + 1;
            while (cursor < source.length && /\s/u.test(source[cursor])) cursor += 1;
            if (source[cursor] === "}" || source[cursor] === "]") continue;
        }
        output += character;
    }
    return output;
}

function looksLikeZodiacProtocolBody(body: string) {
    const hasSummary = /(?:^|[{,])\s*"summary"\s*:/u.test(body);
    const hasOps = /(?:^|[{,])\s*"ops"\s*:\s*\[/u.test(body);
    if (!hasSummary || !hasOps) return false;
    if (/(?:^|[{,])\s*"executionMode"\s*:\s*"(?:guided|automatic)"/u.test(body)) return true;
    const legacyOperationPattern = /(?:^|[{,])\s*"op"\s*:\s*"([^"]+)"/gu;
    return [...body.matchAll(legacyOperationPattern)].some((match) => CANVAS_AGENT_OP_TYPES.has(match[1]));
}

function scanZodiacToolFences(text: string): { blocks: ZodiacFenceBlock[]; unfinished?: UnfinishedZodiacFence } {
    const blocks: ZodiacFenceBlock[] = [];
    const lines = crlfLines(text);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const opening = line.content.match(/^[\t ]*(`{3,})(zodic-ops|json)?[\t ]*$/i);
        if (!opening) continue;
        const label = opening[2]?.toLowerCase() === "zodic-ops" ? "zodic-ops" : "json";
        const ticks = opening[1].length;
        const closingPattern = new RegExp("^[\\t ]*`{" + ticks + ",}[\\t ]*$");
        let closingIndex = -1;
        for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
            if (closingPattern.test(lines[candidate].content)) {
                closingIndex = candidate;
                break;
            }
        }
        if (closingIndex < 0) {
            return { blocks, unfinished: { start: line.start, label, body: text.slice(line.nextStart) } };
        }
        const closing = lines[closingIndex];
        blocks.push({ start: line.start, end: closing.end, label, body: text.slice(line.nextStart, closing.start) });
        index = closingIndex;
    }
    return { blocks };
}

function skipProtocolWhitespace(text: string, start: number) {
    let cursor = start;
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    return cursor;
}

function protocolLineEnd(text: string, start: number) {
    const newline = text.indexOf("\n", start);
    return newline < 0 ? text.length : newline + 1;
}

function balancedProtocolObjectEnd(text: string, start: number, maximumLength: number) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    const limit = Math.min(text.length, start + maximumLength);
    for (let cursor = start; cursor < limit; cursor += 1) {
        const character = text[cursor];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{") depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) return cursor + 1;
            if (depth < 0) return undefined;
        }
    }
    return undefined;
}

function rawProtocolTransportEnd(text: string, jsonEnd: number) {
    let cursor = jsonEnd;
    while (cursor < text.length && /[\t \r\n]/u.test(text[cursor])) cursor += 1;
    const sentinel = text.slice(cursor).match(/^\[(?:blocked|done|complete|completed)\]/iu);
    if (sentinel) {
        cursor += sentinel[0].length;
        while (cursor < text.length && /[\t \r\n]/u.test(text[cursor])) cursor += 1;
    }
    const wrapper = text.slice(cursor).match(/^<\|\/?[\w.-]+\|>/u);
    return wrapper ? cursor + wrapper[0].length : cursor;
}

function crlfLines(text: string) {
    const lines: Array<{ start: number; end: number; nextStart: number; content: string }> = [];
    let start = 0;
    let cursor = 0;
    while (cursor < text.length) {
        if (text[cursor] !== "\r" && text[cursor] !== "\n") {
            cursor += 1;
            continue;
        }
        const nextStart = text[cursor] === "\r" && text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
        lines.push({ start, end: cursor, nextStart, content: text.slice(start, cursor) });
        start = nextStart;
        cursor = nextStart;
    }
    lines.push({ start, end: text.length, nextStart: text.length, content: text.slice(start) });
    return lines;
}

function removeTextRanges(text: string, ranges: Array<{ start: number; end: number }>) {
    if (!ranges.length) return text;
    const sorted = [...ranges].sort((a, b) => a.start - b.start);
    let cursor = 0;
    let visible = "";
    sorted.forEach((range) => {
        if (range.end <= cursor) return;
        visible += text.slice(cursor, Math.max(cursor, range.start));
        cursor = Math.max(cursor, range.end);
    });
    return visible + text.slice(cursor);
}

function canvasNodeType(value: unknown): CanvasNodeTypeId | undefined {
    const candidate = stringValue(value);
    return candidate && (ZODIAC_NODE_TYPES.has(candidate) || isAgentVisiblePluginNodeType(candidate)) ? candidate as CanvasNodeTypeId : undefined;
}

function normalizePosition(value: unknown) {
    const record = asUnknownRecord(value);
    const x = canvasCoordinate(record?.x);
    const y = canvasCoordinate(record?.y);
    return x !== undefined && y !== undefined ? { x, y } : undefined;
}

function normalizeNodePatch(value: unknown): Partial<CanvasNodeData> | undefined {
    const raw = asUnknownRecord(value);
    if (!raw) return undefined;
    const type = canvasNodeType(raw.type);
    const title = stringValue(raw.title);
    const position = normalizePosition(raw.position);
    const width = canvasDimension(raw.width);
    const height = canvasDimension(raw.height);
    const metadata = normalizeCanvasMetadata(raw.metadata);
    const patch: Partial<CanvasNodeData> = {
        ...(type ? { type } : {}),
        ...(title ? { title } : {}),
        ...(position ? { position } : {}),
        ...(width !== undefined ? { width } : {}),
        ...(height !== undefined ? { height } : {}),
        ...(metadata ? { metadata } : {}),
    };
    return Object.keys(patch).length ? patch : undefined;
}

function normalizeCanvasMetadata(value: unknown): CanvasNodeMetadata | undefined {
    const raw = asUnknownRecord(value);
    if (!raw) return undefined;
    const metadata: Record<string, unknown> = {};
    copyMetadataStrings(raw, metadata, [
        "content", "composerContent", "prompt", "errorDetails", "model", "size", "quality", "background",
        "imageWatermark", "imageOptimizePrompt", "seconds", "vquality", "generateAudio", "watermark",
        "audioVoice", "audioFormat", "audioSpeed", "audioInstructions",
    ]);
    const prompt = firstString(raw.prompt, raw.composerContent, raw.instructions, raw.script, raw.promptText, raw.positivePrompt);
    const composerContent = firstString(raw.composerContent, raw.instructions, raw.script, raw.promptText, raw.positivePrompt);
    if (prompt) {
        if (!metadata.prompt) metadata.prompt = prompt;
    }
    if (composerContent && !metadata.composerContent) metadata.composerContent = composerContent;
    const fontSize = finiteNumber(raw.fontSize);
    const count = finiteNumber(raw.count);
    if (fontSize !== undefined && fontSize >= 8 && fontSize <= 256) metadata.fontSize = fontSize;
    if (count !== undefined && Number.isInteger(count) && count >= 1 && count <= 8) metadata.count = count;
    if (isGenerationMode(raw.generationMode)) metadata.generationMode = raw.generationMode;
    if (raw.generationType === "generation" || raw.generationType === "edit") metadata.generationType = raw.generationType;
    if (raw.reasoningEffort === "auto" || raw.reasoningEffort === "low" || raw.reasoningEffort === "medium" || raw.reasoningEffort === "high" || raw.reasoningEffort === "xhigh") metadata.reasoningEffort = raw.reasoningEffort;
    if (raw.terminalInputMode === "auto" || isGenerationMode(raw.terminalInputMode)) metadata.terminalInputMode = raw.terminalInputMode;
    if (isGenerationMode(raw.terminalOutputMode)) metadata.terminalOutputMode = raw.terminalOutputMode;
    return Object.keys(metadata).length ? metadata as CanvasNodeMetadata : undefined;
}

/**
 * Providers do not all preserve nested JSON arguments. Accept the same safe
 * configuration fields from metadata, parameters, settings, or the operation
 * root, then collapse them into the one canvas metadata contract.
 */
function normalizeOperationMetadata(raw: Record<string, unknown>) {
    const parameters = asUnknownRecord(raw.parameters) || {};
    const settings = asUnknownRecord(raw.settings) || {};
    const metadata = asUnknownRecord(raw.metadata) || {};
    return normalizeCanvasMetadata({ ...raw, ...parameters, ...settings, ...metadata });
}

function copyMetadataStrings(source: Record<string, unknown>, target: Record<string, unknown>, keys: string[]) {
    keys.forEach((key) => {
        const value = stringValue(source[key]);
        if (value !== undefined) target[key] = value;
    });
}

function stringValue(value: unknown) {
    return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function firstString(...values: unknown[]) {
    for (const value of values) {
        const candidate = stringValue(value);
        if (candidate) return candidate;
    }
    return undefined;
}

function stringArray(value: unknown) {
    return Array.isArray(value) ? value.map(stringValue).filter((item): item is string => Boolean(item)) : [];
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

function isSafeViewportOffset(value: unknown): value is number {
    return isFiniteNumber(value) && Math.abs(value) <= 1_000_000;
}

function finiteNumber(value: unknown) {
    return isFiniteNumber(value) ? value : undefined;
}

function canvasCoordinate(value: unknown) {
    return isFiniteNumber(value) && Math.abs(value) <= 1_000_000 ? value : undefined;
}

function canvasDimension(value: unknown) {
    return isFiniteNumber(value) && value >= 80 && value <= 20_000 ? value : undefined;
}
