import { useMutation, useQuery, useQueryClient, type QueryKey } from "@tanstack/react-query";

import { startRun, type StartRunOptions } from "@/lib/drama/authoring/run";
import * as api from "@/services/drama-api";
import { useDramaRuns } from "@/stores/use-drama-runs";

export const dramaListKey = ["dramas"] as const;
export const dramaKey = (id: string) => ["drama", id] as const;
export const episodeKey = (eid: string) => ["drama-episode", eid] as const;
export const chaptersKey = ["drama-chapter"] as const;
export const chapterKey = (cid: string) => [...chaptersKey, cid] as const;

export const useDramaList = () => useQuery({ queryKey: dramaListKey, queryFn: api.listDramas });
/** Polls every 3s while a run of the drama is live somewhere this tab does not stream; streams in this tab refresh the snapshot when they settle. */
export const useDrama = (id: string | undefined) =>
    useQuery({
        queryKey: dramaKey(id ?? ""),
        queryFn: () => api.getDrama(id!),
        enabled: Boolean(id),
        refetchInterval: (query) => {
            const streaming = useDramaRuns.getState().runs;
            return query.state.data?.runs.some((run) => run.status === "running" && !streaming[run.id]) ? 3000 : false;
        },
    });
export const useEpisode = (eid: string | undefined) => useQuery({ queryKey: episodeKey(eid ?? ""), queryFn: () => api.getEpisode(eid!), enabled: Boolean(eid) });
/** One chapter with its body; the drama snapshot lists chapters without. */
export const useChapter = (cid: string | undefined) => useQuery({ queryKey: chapterKey(cid ?? ""), queryFn: () => api.getChapter(cid!), enabled: Boolean(cid) });

/** Runs `mutate` and, on success, refetches exactly the given queries (e.g. `[dramaKey(id)]`). */
export function useDramaMutation<Vars, Result>(mutate: (vars: Vars) => Promise<Result>, invalidate: QueryKey[]) {
    const client = useQueryClient();
    return useMutation({ mutationFn: mutate, onSuccess: () => Promise.all(invalidate.map((queryKey) => client.invalidateQueries({ queryKey }))) });
}

/** Starts an AI text run for a drama; its snapshot (and the episode's, if any) refreshes when the run starts and settles. */
export function useStartRun() {
    const client = useQueryClient();
    return async (options: Omit<StartRunOptions, "onChange">) => {
        const dramaId = options.snapshot.project.id;
        const refresh = () => {
            void client.invalidateQueries({ queryKey: dramaKey(dramaId) });
            if (options.episodeId) void client.invalidateQueries({ queryKey: episodeKey(options.episodeId) });
        };
        const started = await startRun({ ...options, onChange: refresh });
        started.done.catch(() => undefined);
        return started;
    };
}
