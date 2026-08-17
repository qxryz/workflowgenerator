import { create } from "zustand";

import type { CanvasAgentOp, CanvasAgentSnapshot } from "@/lib/canvas/canvas-agent-ops";
import type { WorkflowExecutionMode, WorkflowRunSnapshot } from "@/lib/canvas/workflow-execution";
import { readMigratedUserPreference, readUserPreference, saveUserPreference } from "@/lib/user-preference-storage";

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
    runWorkflow: (startNodeIds: string[] | undefined, mode: WorkflowExecutionMode) => Promise<WorkflowRunSnapshot<unknown>>;
    continueWorkflow: (nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>;
    retryWorkflow: (nodeId: string) => Promise<WorkflowRunSnapshot<unknown>>;
    stopWorkflow: () => Promise<WorkflowRunSnapshot<unknown> | undefined>;
    resumeWorkflow: () => Promise<WorkflowRunSnapshot<unknown> | undefined>;
    inspectWorkflowResult: (nodeId: string) => void;
};

const AGENT_PANEL_WIDTH_KEY = "zodiac-panel-width-v1";
const LEGACY_AGENT_PANEL_WIDTH_KEY = "zodic-panel-width";
const AGENT_CONFIRM_TOOLS_KEY = "zodiac-confirm-tools-v1";
const AGENT_SHOW_REASONING_KEY = "zodiac-show-reasoning-v1";
const AGENT_PANEL_DEFAULT_WIDTH = 440;
const AGENT_PANEL_MIN_WIDTH = 360;
const AGENT_PANEL_MAX_WIDTH = 760;

type AgentStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    canvasContext: AgentCanvasContext | null;
    confirmTools: boolean;
    showReasoning: boolean;
    preferencesHydrated: boolean;
    setAgentState: (patch: Partial<Omit<AgentStore, "setAgentState" | "openPanel" | "closePanel" | "togglePanel" | "setCanvasContext">>) => void;
    setWidth: (width: number) => void;
    commitWidth: (width: number) => void;
    setConfirmTools: (confirmTools: boolean) => void;
    setShowReasoning: (showReasoning: boolean) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
    setCanvasContext: (context: AgentCanvasContext | null) => void;
};

export const CANVAS_AGENT_PANEL_MOTION_MS = 500;

let widthTouched = false;
let confirmToolsTouched = false;
let showReasoningTouched = false;
let hydrationPromise: Promise<void> | null = null;

export const useAgentStore = create<AgentStore>((set, get) => ({
    width: AGENT_PANEL_DEFAULT_WIDTH,
    panelOpen: false,
    panelMounted: false,
    panelClosing: false,
    canvasContext: null,
    confirmTools: true,
    showReasoning: false,
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
    setConfirmTools: (confirmTools) => {
        confirmToolsTouched = true;
        set({ confirmTools });
        void saveUserPreference(AGENT_CONFIRM_TOOLS_KEY, confirmTools);
    },
    setShowReasoning: (showReasoning) => {
        showReasoningTouched = true;
        set({ showReasoning });
        void saveUserPreference(AGENT_SHOW_REASONING_KEY, showReasoning);
    },
    openPanel: () => set({ panelOpen: true, panelMounted: true, panelClosing: false }),
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_AGENT_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
    setCanvasContext: (canvasContext) => set({ canvasContext }),
}));

export function hydrateAgentPreferences() {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = Promise.all([
        readMigratedUserPreference(AGENT_PANEL_WIDTH_KEY, [LEGACY_AGENT_PANEL_WIDTH_KEY]),
        readUserPreference(AGENT_CONFIRM_TOOLS_KEY),
        readUserPreference(AGENT_SHOW_REASONING_KEY),
    ]).then(([storedWidth, storedConfirmTools, storedShowReasoning]) => {
        const patch: Partial<AgentStore> = { preferencesHydrated: true };
        if (!widthTouched) patch.width = normalizeWidth(storedWidth);
        if (!confirmToolsTouched) patch.confirmTools = normalizeBoolean(storedConfirmTools, true);
        if (!showReasoningTouched) patch.showReasoning = normalizeBoolean(storedShowReasoning, false);
        useAgentStore.setState(patch);
    });
    return hydrationPromise;
}

function normalizeWidth(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return AGENT_PANEL_DEFAULT_WIDTH;
    return Math.min(AGENT_PANEL_MAX_WIDTH, Math.max(AGENT_PANEL_MIN_WIDTH, parsed));
}

function normalizeBoolean(value: unknown, fallback: boolean) {
    if (value === true || value === 1 || value === "1" || value === "true") return true;
    if (value === false || value === 0 || value === "0" || value === "false") return false;
    return fallback;
}

if (typeof window !== "undefined") queueMicrotask(() => void hydrateAgentPreferences());
