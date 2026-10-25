import type { DramaRun, RunStage } from "./types.ts";

const byNewest = (a: DramaRun, b: DramaRun) => b.createdAt - a.createdAt;

/**
 * Which run a section should show for a stage (and optional scope filter):
 * the live one, else the newest awaiting review, else the newest of any status.
 * `history` is every matching run, newest first (it includes `current`).
 */
export function pickStageRuns(runs: readonly DramaRun[], stage: RunStage, match?: (run: DramaRun) => boolean): { current?: DramaRun; history: DramaRun[] } {
    const history = runs.filter((run) => run.stage === stage && (!match || match(run))).sort(byNewest);
    const current = history.find((run) => run.status === "running") ?? history.find((run) => run.status === "review") ?? history[0];
    return { current, history };
}

/** True when `run` covers the scope a button/section is asking about; an empty scope matches any run of the stage. */
export function sameScope(run: Pick<DramaRun, "scope" | "episodeId">, scope: DramaRun["scope"] | undefined, episodeId?: string): boolean {
    if ((run.episodeId ?? undefined) !== episodeId) return false;
    if (!scope || (scope.ord === undefined && scope.target === undefined)) return true;
    return run.scope.ord === scope.ord && run.scope.target === scope.target;
}
