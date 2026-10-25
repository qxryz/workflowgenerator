import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";

import { dramaKey, episodeKey } from "@/hooks/use-drama";
import type { DramaRun } from "@/lib/drama/types";
import { updateRun } from "@/services/drama-api";
import { useDramaRuns } from "@/stores/use-drama-runs";

/** A run is streamed by the tab that started it; after a reload nothing streams it, and the server still says running. */
const ORPHAN_AFTER_MS = 20_000;
export const ORPHAN_ERROR = "页面刷新，任务已中断";
const handled = new Set<string>();

/** Marks runs that no tab is streaming as stopped, once per run, then refreshes the drama (and episode). */
export function useOrphanedRuns(dramaId: string | undefined, runs: readonly DramaRun[] | undefined, episodeId?: string) {
    const client = useQueryClient();
    const streaming = useDramaRuns((state) => state.runs);
    useEffect(() => {
        const orphans = (runs ?? []).filter((run) => run.status === "running" && !streaming[run.id] && !handled.has(run.id) && Date.now() - run.createdAt > ORPHAN_AFTER_MS);
        if (!dramaId || !orphans.length) return;
        for (const run of orphans) handled.add(run.id);
        void Promise.allSettled(orphans.map((run) => updateRun(run.id, { status: "stopped", error: ORPHAN_ERROR }))).then(() => {
            void client.invalidateQueries({ queryKey: dramaKey(dramaId) });
            if (episodeId) void client.invalidateQueries({ queryKey: episodeKey(episodeId) });
        });
    }, [client, dramaId, episodeId, runs, streaming]);
}
