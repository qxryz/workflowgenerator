import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from "react";

import { useAgentStore, type AgentApplyOptions } from "@/stores/use-agent-store";
import { runZodiacProposalGeneration } from "@/lib/agent/zodiac-execution-mode";
import { applyCanvasAgentOps, type CanvasAgentOp, type CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { WorkflowExecutionMode, WorkflowRunSnapshot } from "@/lib/canvas/workflow-execution";
import type { CanvasConnection, CanvasNodeData, ContextMenuState, ViewportTransform } from "@/types/canvas";
import { assertAgentProjectMutation, resolveAgentApplyPlan, resolveAgentReadableSnapshot } from "./agent-bridge-apply-boundary";
import { assertAgentWorkflowPreviewCurrent, materializeAgentApplyOps, preflightAgentWorkflowApply } from "./agent-bridge-workflow-preflight";

type RunWorkflowRef = MutableRefObject<((startNodeIds: string[] | undefined, mode: WorkflowExecutionMode) => Promise<WorkflowRunSnapshot<unknown>>) | null>;

type AgentBridgeParams = {
    projectId: string;
    projectEpoch: number;
    ready: boolean;
    title: string | undefined;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    selectedNodeIds: Set<string>;
    viewport: ViewportTransform;
    nodesRef: MutableRefObject<CanvasNodeData[]>;
    connectionsRef: MutableRefObject<CanvasConnection[]>;
    selectedNodeIdsRef: MutableRefObject<Set<string>>;
    viewportRef: MutableRefObject<ViewportTransform>;
    runWorkflowRef: RunWorkflowRef;
    continueWorkflowRef: MutableRefObject<((nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>) | null>;
    retryWorkflowRef: MutableRefObject<((nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>) | null>;
    stopWorkflowRef: MutableRefObject<(() => Promise<WorkflowRunSnapshot<unknown> | undefined>) | null>;
    resumeWorkflowRef: MutableRefObject<(() => Promise<WorkflowRunSnapshot<unknown> | undefined>) | null>;
    inspectWorkflowResultRef: MutableRefObject<((nodeId: string) => void) | null>;
    setNodes: Dispatch<SetStateAction<CanvasNodeData[]>>;
    setConnections: Dispatch<SetStateAction<CanvasConnection[]>>;
    setSelectedNodeIds: Dispatch<SetStateAction<Set<string>>>;
    setSelectedConnectionId: Dispatch<SetStateAction<string | null>>;
    setViewport: Dispatch<SetStateAction<ViewportTransform>>;
    setContextMenu: Dispatch<SetStateAction<ContextMenuState | null>>;
    setDialogNodeId: Dispatch<SetStateAction<string | null>>;
};

/**
 * 将当前画布快照与 apply/undo 能力发布给 Zodic；除 applyAgentOps
 * （配置节点插件宿主会用到）外均为内部实现。
 */
export function useAgentBridge(params: AgentBridgeParams) {
    const { projectId, projectEpoch, ready, title, nodes, connections, selectedNodeIds, viewport, nodesRef, connectionsRef, selectedNodeIdsRef, viewportRef, runWorkflowRef, continueWorkflowRef, retryWorkflowRef, stopWorkflowRef, resumeWorkflowRef, inspectWorkflowResultRef, setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setViewport, setContextMenu, setDialogNodeId } =
        params;
    const setAgentCanvasContext = useAgentStore((state) => state.setCanvasContext);
    const agentUndoSnapshotRef = useRef<CanvasAgentSnapshot | null>(null);
    const appliedOperationOpsRef = useRef(new Map<string, CanvasAgentOp[]>());
    const projectIdentityRef = useRef({ projectId, projectEpoch, ready, title: title || "未命名画布" });
    const readableSnapshotRef = useRef<CanvasAgentSnapshot>({
        projectId,
        title: title || "未命名画布",
        nodes,
        connections,
        selectedNodeIds: Array.from(selectedNodeIds),
        viewport,
    });
    const [canUndo, setCanUndo] = useState(false);
    projectIdentityRef.current = { projectId, projectEpoch, ready, title: title || "未命名画布" };
    readableSnapshotRef.current = resolveAgentReadableSnapshot(
        readableSnapshotRef.current,
        {
            projectId,
            title: title || "未命名画布",
            nodes,
            connections,
            selectedNodeIds: Array.from(selectedNodeIds),
            viewport,
        },
        ready,
    );
    const assertActiveProject = useCallback((expected?: { projectId: string; projectEpoch: number }) => {
        return assertAgentProjectMutation(projectIdentityRef.current, expected);
    }, []);

    const getAgentSnapshot = useCallback<() => CanvasAgentSnapshot>(() => readableSnapshotRef.current, []);
    const getActiveAgentSnapshot = useCallback<() => CanvasAgentSnapshot>(() => {
        const identity = assertActiveProject();
        return {
            projectId: identity.projectId,
            title: identity.title,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            selectedNodeIds: Array.from(selectedNodeIdsRef.current),
            viewport: viewportRef.current,
        };
    }, [assertActiveProject, connectionsRef, nodesRef, selectedNodeIdsRef, viewportRef]);
    const applyAgentOps = useCallback(
        (ops?: CanvasAgentOp[]) => {
            assertActiveProject();
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const identity = projectIdentityRef.current;
            const before = { ...identity, nodes: nodesRef.current, connections: connectionsRef.current, selectedNodeIds: Array.from(selectedNodeIdsRef.current), viewport: viewportRef.current };
            const next = applyCanvasAgentOps(before, materializeAgentApplyOps(safeOps));
            nodesRef.current = next.nodes;
            connectionsRef.current = next.connections;
            selectedNodeIdsRef.current = new Set(next.selectedNodeIds);
            viewportRef.current = next.viewport;
            readableSnapshotRef.current = {
                projectId: identity.projectId,
                title: identity.title,
                nodes: next.nodes,
                connections: next.connections,
                selectedNodeIds: next.selectedNodeIds,
                viewport: next.viewport,
            };
            agentUndoSnapshotRef.current = before;
            setCanUndo(true);
            setNodes(next.nodes);
            setConnections(next.connections);
            setSelectedNodeIds(new Set(next.selectedNodeIds));
            setSelectedConnectionId(null);
            setViewport(next.viewport);
            setContextMenu(null);
            const terminalToConfigure = next.nodes.find((node) => node.type === "terminal" && node.metadata?.terminalConfigured === false && !before.nodes.some((previous) => previous.id === node.id));
            if (terminalToConfigure) setDialogNodeId(terminalToConfigure.id);
            return { ...next, ...identity };
        },
        [assertActiveProject, connectionsRef, nodesRef, selectedNodeIdsRef, setConnections, setContextMenu, setDialogNodeId, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, viewportRef],
    );
    const applyAgentOpsAndRun = useCallback(
        async (ops?: CanvasAgentOp[], operationId?: string, executionMode: WorkflowExecutionMode = "guided", options?: AgentApplyOptions) => {
            const expectedProject = assertActiveProject();
            const safeOps = Array.isArray(ops) ? ops.filter((op) => op?.type) : [];
            const currentSnapshot = getActiveAgentSnapshot();
            const previousOps = operationId ? appliedOperationOpsRef.current.get(operationId) : undefined;
            const plan = resolveAgentApplyPlan(safeOps, currentSnapshot, previousOps, options?.resumeExistingStructure);
            const { generationNodeIds, preview } = preflightAgentWorkflowApply(currentSnapshot, plan.ops, {
                structureAlreadyApplied: plan.structureAlreadyApplied,
                receiptRetry: Boolean(previousOps) || Boolean(options?.resumeExistingStructure),
            });
            assertActiveProject(expectedProject);
            const next = plan.structureAlreadyApplied ? currentSnapshot : applyAgentOps(plan.ops);
            if (operationId) appliedOperationOpsRef.current.set(operationId, plan.ops);
            await options?.onStructureCommitted?.(plan.ops);
            assertActiveProject(expectedProject);
            if (generationNodeIds.length) {
                assertAgentWorkflowPreviewCurrent(preview, getActiveAgentSnapshot(), generationNodeIds);
                const runWorkflow = runWorkflowRef.current;
                if (!runWorkflow) throw new Error("画布运行器还没有准备好");
                await runZodiacProposalGeneration(runWorkflow, generationNodeIds, executionMode);
            }
            assertActiveProject(expectedProject);
            return next;
        },
        [applyAgentOps, assertActiveProject, getActiveAgentSnapshot, runWorkflowRef],
    );
    const undoAgentOps = useCallback(() => {
        assertActiveProject();
        const agentUndoSnapshot = agentUndoSnapshotRef.current;
        if (!agentUndoSnapshot) return null;
        nodesRef.current = agentUndoSnapshot.nodes;
        connectionsRef.current = agentUndoSnapshot.connections;
        selectedNodeIdsRef.current = new Set(agentUndoSnapshot.selectedNodeIds);
        viewportRef.current = agentUndoSnapshot.viewport;
        readableSnapshotRef.current = agentUndoSnapshot;
        setNodes(agentUndoSnapshot.nodes);
        setConnections(agentUndoSnapshot.connections);
        setSelectedNodeIds(new Set(agentUndoSnapshot.selectedNodeIds));
        setSelectedConnectionId(null);
        setViewport(agentUndoSnapshot.viewport);
        setContextMenu(null);
        agentUndoSnapshotRef.current = null;
        appliedOperationOpsRef.current.clear();
        setCanUndo(false);
        return { ...agentUndoSnapshot, ...projectIdentityRef.current };
    }, [assertActiveProject, connectionsRef, nodesRef, selectedNodeIdsRef, setConnections, setContextMenu, setNodes, setSelectedConnectionId, setSelectedNodeIds, setViewport, viewportRef]);

    useEffect(() => {
        agentUndoSnapshotRef.current = null;
        appliedOperationOpsRef.current.clear();
        setCanUndo(false);
    }, [projectEpoch, projectId]);

    useEffect(() => {
        if (!ready) {
            setAgentCanvasContext(null);
            return;
        }
        setAgentCanvasContext({
            projectId,
            getSnapshot: getAgentSnapshot,
            applyOps: applyAgentOpsAndRun,
            undoOps: undoAgentOps,
            canUndo,
            runWorkflow: async (startNodeIds, mode) => {
                const expectedProject = assertActiveProject();
                const runWorkflow = runWorkflowRef.current;
                if (!runWorkflow) throw new Error("画布运行器还没有准备好");
                const result = await runWorkflow(startNodeIds, mode);
                assertActiveProject(expectedProject);
                return result;
            },
            continueWorkflow: async (nodeId) => {
                const expectedProject = assertActiveProject();
                if (!continueWorkflowRef.current) throw new Error("当前没有可继续的工作流");
                const result = await continueWorkflowRef.current(nodeId);
                assertActiveProject(expectedProject);
                return result;
            },
            retryWorkflow: async (nodeId) => {
                const expectedProject = assertActiveProject();
                if (!retryWorkflowRef.current) throw new Error("当前没有可重试的工作流");
                const result = await retryWorkflowRef.current(nodeId);
                assertActiveProject(expectedProject);
                return result;
            },
            stopWorkflow: async () => {
                const expectedProject = assertActiveProject();
                const result = await stopWorkflowRef.current?.();
                assertActiveProject(expectedProject);
                return result;
            },
            resumeWorkflow: async () => {
                const expectedProject = assertActiveProject();
                const result = await resumeWorkflowRef.current?.();
                assertActiveProject(expectedProject);
                return result;
            },
            inspectWorkflowResult: (nodeId) => {
                assertActiveProject();
                inspectWorkflowResultRef.current?.(nodeId);
            },
        });
        return () => setAgentCanvasContext(null);
    }, [applyAgentOpsAndRun, assertActiveProject, canUndo, continueWorkflowRef, getAgentSnapshot, inspectWorkflowResultRef, projectEpoch, projectId, ready, resumeWorkflowRef, retryWorkflowRef, runWorkflowRef, setAgentCanvasContext, stopWorkflowRef, undoAgentOps]);

    return { applyAgentOps };
}
