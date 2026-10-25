import { create } from "zustand";

import type { RunStage } from "@/lib/drama/types";

export type LiveRun = {
    runId: string;
    dramaId: string;
    episodeId: string | null;
    stage: RunStage;
    /** Streamed model output so far. */
    text: string;
    phase: "requesting" | "correcting" | "saving";
    startedAt: number;
    abort: () => void;
};

type DramaRunsStore = {
    runs: Record<string, LiveRun>;
    start: (run: LiveRun) => void;
    update: (runId: string, patch: Partial<Pick<LiveRun, "text" | "phase">>) => void;
    finish: (runId: string) => void;
};

/** Runs this tab is streaming right now; everything persisted lives on the server. */
export const useDramaRuns = create<DramaRunsStore>((set) => ({
    runs: {},
    start: (run) => set((state) => ({ runs: { ...state.runs, [run.runId]: run } })),
    update: (runId, patch) => set((state) => (state.runs[runId] ? { runs: { ...state.runs, [runId]: { ...state.runs[runId], ...patch } } } : state)),
    finish: (runId) =>
        set((state) => {
            const { [runId]: _done, ...runs } = state.runs;
            return { runs };
        }),
}));
