import { prepareZodiacToolProposal } from "@/lib/agent/zodiac-tool-proposal";
import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";

export type AgentApplyPlan = {
    ops: CanvasAgentOp[];
    structureAlreadyApplied: boolean;
};

const STRUCTURE_DRIFT_ERROR = "工作流结构在上次提交后已被修改。为避免复制或覆盖节点，请先检查画布再重新发起。";

export type AgentProjectIdentity = {
    projectId: string;
    projectEpoch: number;
    ready: boolean;
    title: string;
};

export function assertAgentProjectMutation(
    current: AgentProjectIdentity,
    expected?: Pick<AgentProjectIdentity, "projectId" | "projectEpoch">,
) {
    if (!current.ready || (expected && (current.projectId !== expected.projectId || current.projectEpoch !== expected.projectEpoch))) {
        throw new Error("画布正在切换，请在新画布加载完成后重试");
    }
    return current;
}

/** Keeps render-time reads on the last coherent project while a route switch is loading. */
export function resolveAgentReadableSnapshot(
    previous: CanvasAgentSnapshot | null,
    candidate: CanvasAgentSnapshot,
    ready: boolean,
) {
    return ready || !previous ? candidate : previous;
}

function addedNodeIds(ops: CanvasAgentOp[]) {
    return ops
        .filter((op): op is Extract<CanvasAgentOp, { type: "add_node" }> => op.type === "add_node" && Boolean(op.id))
        .map((op) => op.id as string);
}

/**
 * Revalidates an approved proposal against the live canvas immediately before
 * applying it. The model may have prepared the proposal from an older snapshot;
 * this boundary closes that gap and remaps ids that appeared in the meantime.
 *
 * Retries keep using the exact operations that were applied the first time.
 * Their ids may already have been remapped, so preparing them again would create
 * a second copy instead of rerunning the existing structure.
 */
export function resolveAgentApplyPlan(
    ops: CanvasAgentOp[],
    currentSnapshot: CanvasAgentSnapshot,
    previouslyAppliedOps?: CanvasAgentOp[],
    resumeExistingStructure = false,
): AgentApplyPlan {
    const baseOps = previouslyAppliedOps || ops;
    const currentNodeIds = new Set(currentSnapshot.nodes.map((node) => node.id));
    const existingAddedNodeIds = addedNodeIds(baseOps).filter((nodeId) => currentNodeIds.has(nodeId));
    const mustResume = Boolean(previouslyAppliedOps) || resumeExistingStructure;

    if (mustResume || existingAddedNodeIds.length) {
        const repairProposal = prepareZodiacToolProposal(baseOps, currentSnapshot.nodes, currentSnapshot.connections, true);
        assertProposalIntentPreserved(baseOps, repairProposal, currentSnapshot, mustResume);
        const repairOps = repairProposal.ops;
        const repairedAddIds = new Set(addedNodeIds(repairOps));
        const incompatibleExistingIds = existingAddedNodeIds.filter((nodeId) => !repairedAddIds.has(nodeId));
        if (incompatibleExistingIds.length) {
            if (mustResume) throw new Error(STRUCTURE_DRIFT_ERROR);
            const freshProposal = prepareZodiacToolProposal(ops, currentSnapshot.nodes, currentSnapshot.connections);
            assertProposalIntentPreserved(ops, freshProposal, currentSnapshot, false);
            return {
                ops: freshProposal.ops,
                structureAlreadyApplied: false,
            };
        }
        return {
            ops: repairOps,
            structureAlreadyApplied: structureMatches(repairOps, currentSnapshot),
        };
    }

    const freshProposal = prepareZodiacToolProposal(ops, currentSnapshot.nodes, currentSnapshot.connections);
    assertProposalIntentPreserved(ops, freshProposal, currentSnapshot, false);
    return {
        ops: freshProposal.ops,
        structureAlreadyApplied: false,
    };
}

function assertProposalIntentPreserved(
    approvedOps: CanvasAgentOp[],
    proposal: ReturnType<typeof prepareZodiacToolProposal>,
    snapshot: CanvasAgentSnapshot,
    resumeExistingStructure: boolean,
) {
    const resolvedOps = proposal.ops;
    if (approvedOps.length && !resolvedOps.length) throw new Error(STRUCTURE_DRIFT_ERROR);

    const approvedRunCount = approvedOps.filter((op) => op.type === "run_generation").length;
    const resolvedRuns = resolvedOps.filter((op): op is Extract<CanvasAgentOp, { type: "run_generation" }> => op.type === "run_generation");
    if (resolvedRuns.length !== approvedRunCount) throw new Error(STRUCTURE_DRIFT_ERROR);

    const currentNodeIds = new Set(snapshot.nodes.map((node) => node.id));
    const currentConnectionIds = new Set(snapshot.connections.map((connection) => connection.id));
    const addedNodeIds = new Set(resolvedOps.flatMap((op) => op.type === "add_node" && op.id ? [op.id] : []));
    const addedConnectionIds = new Set(resolvedOps.flatMap((op) => op.type === "connect_nodes" && op.id ? [op.id] : []));
    const deletedNodeIds = new Set(resolvedOps.flatMap((op) => op.type === "delete_node" ? [...(op.ids || []), ...(op.id ? [op.id] : [])] : []));
    const bindingActionIds = new Set(proposal.bindings.map((binding) => binding.actionId));

    resolvedOps.forEach((op) => {
        if (op.type === "run_generation") {
            if ((!currentNodeIds.has(op.nodeId) && !addedNodeIds.has(op.nodeId)) || !bindingActionIds.has(op.nodeId)) {
                throw new Error(STRUCTURE_DRIFT_ERROR);
            }
        }
        if (op.type === "update_node") {
            const targetWillExist = currentNodeIds.has(op.id) || addedNodeIds.has(op.id);
            if (!targetWillExist && !deletedNodeIds.has(op.id)) throw new Error(STRUCTURE_DRIFT_ERROR);
        }
        if (!resumeExistingStructure && op.type === "delete_node") {
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            if (ids.some((id) => !currentNodeIds.has(id) && !addedNodeIds.has(id))) throw new Error(STRUCTURE_DRIFT_ERROR);
        }
        if (!resumeExistingStructure && op.type === "delete_connections") {
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            if (ids.some((id) => !currentConnectionIds.has(id) && !addedConnectionIds.has(id))) throw new Error(STRUCTURE_DRIFT_ERROR);
        }
    });
}

function structureMatches(ops: CanvasAgentOp[], snapshot: CanvasAgentSnapshot) {
    const nodeById = new Map(snapshot.nodes.map((node) => [node.id, node]));
    const connectionById = new Map(snapshot.connections.map((connection) => [connection.id, connection]));
    return ops.every((op) => {
        if (op.type === "add_node") return !op.id || nodeById.has(op.id);
        if (op.type === "connect_nodes") {
            return snapshot.connections.some((connection) => connection.fromNodeId === op.fromNodeId && connection.toNodeId === op.toNodeId);
        }
        if (op.type === "delete_node") {
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            return ids.every((id) => !nodeById.has(id));
        }
        if (op.type === "delete_connections") {
            if (op.all) return snapshot.connections.length === 0;
            const ids = [...(op.ids || []), ...(op.id ? [op.id] : [])];
            return ids.every((id) => !connectionById.has(id));
        }
        if (op.type === "update_node") {
            const node = nodeById.get(op.id);
            if (!node) return false;
            const patch = op.patch || {};
            if (patch.type !== undefined && patch.type !== node.type) return false;
            if (patch.title !== undefined && patch.title !== node.title) return false;
            if (patch.position !== undefined && (patch.position.x !== node.position.x || patch.position.y !== node.position.y)) return false;
            if (patch.width !== undefined && patch.width !== node.width) return false;
            if (patch.height !== undefined && patch.height !== node.height) return false;
            const expectedMetadata = { ...patch.metadata, ...op.metadata };
            return Object.entries(expectedMetadata).every(([key, value]) => sameValue(value, node.metadata?.[key as keyof typeof node.metadata]));
        }
        return true;
    });
}

function sameValue(left: unknown, right: unknown): boolean {
    if (Array.isArray(left)) return Array.isArray(right) && left.length === right.length && left.every((value, index) => sameValue(value, right[index]));
    if (left && typeof left === "object") {
        if (!right || typeof right !== "object" || Array.isArray(right)) return false;
        const entries = Object.entries(left as Record<string, unknown>);
        const rightRecord = right as Record<string, unknown>;
        return entries.length === Object.keys(rightRecord).length && entries.every(([key, value]) => sameValue(value, rightRecord[key]));
    }
    return left === right;
}
