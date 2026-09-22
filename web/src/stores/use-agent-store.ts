import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { WorkflowExecutionMode, WorkflowRunSnapshot } from "@/lib/canvas/workflow-execution";
import { readMigratedUserPreference, saveUserPreference } from "@/lib/user-preference-storage";

export type AgentApplyOptions = {
    resumeExistingStructure?: boolean;
    onStructureCommitted?: (resolvedOps: CanvasAgentOp[]) => void | Promise<void>;
};

export type AgentCanvasContext = {
    projectId: string;
    getSnapshot: () => CanvasAgentSnapshot;
    applyOps: (ops?: CanvasAgentOp[], operationId?: string, executionMode?: WorkflowExecutionMode, options?: AgentApplyOptions) => Promise<CanvasAgentSnapshot>;
    undoOps: () => CanvasAgentSnapshot | null;
    canUndo: boolean;
    runWorkflow: (startNodeIds: string[] | undefined, mode: WorkflowExecutionMode, signal?: AbortSignal) => Promise<WorkflowRunSnapshot<unknown>>;
    continueWorkflow: (nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>;
    retryWorkflow: (nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>;
    stopWorkflow: () => Promise<WorkflowRunSnapshot<unknown> | undefined>;
    resumeWorkflow: () => Promise<WorkflowRunSnapshot<unknown> | undefined>;
    inspectWorkflowResult: (nodeId: string) => void;
};

const AGENT_PANEL_WIDTH_KEY = "zodiac-panel-width-v1";
const LEGACY_AGENT_PANEL_WIDTH_KEY = "zodic-panel-width";
const AGENT_PANEL_DEFAULT_WIDTH = 480;
const AGENT_PANEL_MIN_WIDTH = 360;
const AGENT_PANEL_MAX_WIDTH = 760;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    contexts: Record<string, AgentCanvasContext>;
    selectedProjectId: string | null;
    work: Record<string, Record<string, boolean>>;
    setWork: (projectId: string, kind: string, busy: boolean) => void;
    removeContext: (projectId: string) => void;
    preferencesHydrated: boolean;
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    setWidth: (width: number) => void;
    commitWidth: (width: number) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

let widthTouched = false;
let hydrationPromise: Promise<void> | null = null;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: AGENT_PANEL_DEFAULT_WIDTH,
    panelOpen: false,
    panelMounted: false,
    panelClosing: false,
    canvasContext: null,
    contexts: {},
    selectedProjectId: null,
    work: {},
    setWork: (id, kind, busy) => set((state) => ({ work: { ...state.work, [id]: { ...state.work[id], [kind]: busy } } })),
    removeContext: (id) =>
        set((state) => {
            const contexts = { ...state.contexts };
            delete contexts[id];
            return { contexts };
        }),
    preferencesHydrated: false,
    setAgentState: (patch) => set(patch),
    setWidth: (width) => {
        widthTouched = true;
        set({ width: normalizeWidth(width) });
    },
    commitWidth: (width) => {
        widthTouched = true;
        const normalized = normalizeWidth(width);
        set({ width: normalized });
        void saveUserPreference(AGENT_PANEL_WIDTH_KEY, normalized);
    },
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => {
        if (!canvasContext) return;
        set((state) => ({ contexts: { ...state.contexts, [canvasContext.projectId]: canvasContext }, ...(state.selectedProjectId === canvasContext.projectId ? { canvasContext } : {}) }));
    },
}));

export function hydrateAgentPreferences() {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = Promise.all([readMigratedUserPreference(AGENT_PANEL_WIDTH_KEY, [LEGACY_AGENT_PANEL_WIDTH_KEY])]).then(([storedWidth]) => {
        const patch: Partial<AgentStore> = { preferencesHydrated: true };
        if (!widthTouched) patch.width = normalizeWidth(storedWidth);
        useAgentStore.setState(patch);
    });
    return hydrationPromise;
}

function normalizeWidth(value: unknown) {
    if (value == null || value === "") return AGENT_PANEL_DEFAULT_WIDTH;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return AGENT_PANEL_DEFAULT_WIDTH;
    return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, parsed));
}

if (typeof window !== "undefined") queueMicrotask(() => void hydrateAgentPreferences());
