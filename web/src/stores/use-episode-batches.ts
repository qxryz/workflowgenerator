import { create } from "zustand";

export type EpisodeBatch = { total: number; done: number; failed: number; stopping: boolean; abort: () => void };

type Store = {
    /** Keyed by `${episodeId}:${kind}`; present only while the batch runs. */
    batches: Record<string, EpisodeBatch>;
    start: (key: string, batch: EpisodeBatch) => void;
    advance: (key: string, failed: boolean) => void;
    stopping: (key: string) => void;
    finish: (key: string) => void;
};

/** Batch media runs started in this tab. They outlive the step component, so leaving the step does not lose the progress. */
export const useEpisodeBatches = create<Store>((set) => ({
    batches: {},
    start: (key, batch) => set((state) => ({ batches: { ...state.batches, [key]: batch } })),
    advance: (key, failed) => set((state) => (state.batches[key] ? { batches: { ...state.batches, [key]: { ...state.batches[key], done: state.batches[key].done + 1, failed: state.batches[key].failed + (failed ? 1 : 0) } } } : state)),
    stopping: (key) => set((state) => (state.batches[key] ? { batches: { ...state.batches, [key]: { ...state.batches[key], stopping: true } } } : state)),
    finish: (key) =>
        set((state) => {
            const { [key]: _done, ...batches } = state.batches;
            return { batches };
        }),
}));
