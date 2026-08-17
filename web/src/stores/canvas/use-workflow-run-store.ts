import { create } from "zustand";

import type { WorkflowExecution, WorkflowExecutionEvent, WorkflowRunSnapshot } from "../../lib/canvas/workflow-execution";

const MAX_EVENTS_PER_RUN = 400;

type WorkflowRunStore = {
    activeRunId: string | null;
    runs: Record<string, WorkflowRunSnapshot<unknown>>;
    eventsByRunId: Record<string, readonly WorkflowExecutionEvent<unknown>[]>;
    setActiveRun: (runId: string | null) => void;
    removeRun: (runId: string) => void;
    reset: () => void;
};

export const useWorkflowRunStore = create<WorkflowRunStore>((set) => ({
    activeRunId: null,
    runs: {},
    eventsByRunId: {},
    setActiveRun: (activeRunId) => set({ activeRunId }),
    removeRun: (runId) =>
        set((state) => {
            const runs = { ...state.runs };
            const eventsByRunId = { ...state.eventsByRunId };
            delete runs[runId];
            delete eventsByRunId[runId];
            return { runs, eventsByRunId, activeRunId: state.activeRunId === runId ? null : state.activeRunId };
        }),
    reset: () => set({ activeRunId: null, runs: {}, eventsByRunId: {} }),
}));

/**
 * Mirrors one executor into a React-friendly store. Zodiac can either consume
 * this event ledger or subscribe to the executor directly.
 */
export function observeWorkflowExecution<TArtifact, TNodeData>(execution: WorkflowExecution<TArtifact, TNodeData>) {
    const updateSnapshot = () => {
        const snapshot = execution.getSnapshot() as WorkflowRunSnapshot<unknown>;
        useWorkflowRunStore.setState((state) => ({
            activeRunId: execution.runId,
            runs: { ...state.runs, [execution.runId]: snapshot },
        }));
    };

    updateSnapshot();
    return execution.subscribe((event) => {
        const genericEvent = event as WorkflowExecutionEvent<unknown>;
        const snapshot = execution.getSnapshot() as WorkflowRunSnapshot<unknown>;
        useWorkflowRunStore.setState((state) => {
            const previousEvents = state.eventsByRunId[execution.runId] ?? [];
            const events = [...previousEvents, genericEvent].slice(-MAX_EVENTS_PER_RUN);
            return {
                activeRunId: execution.runId,
                runs: { ...state.runs, [execution.runId]: snapshot },
                eventsByRunId: { ...state.eventsByRunId, [execution.runId]: events },
            };
        });
    });
}
