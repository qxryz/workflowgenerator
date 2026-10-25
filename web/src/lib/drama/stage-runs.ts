import type { DramaRun, RunStage, RunStatus } from "./types.ts";

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

/** The server locks per exact scope, so a button is busy only when a run has the same chapter, review target and chapter list. An empty scope matches any run of the stage. */
export function sameScope(run: Pick<DramaRun, "scope" | "episodeId">, scope: DramaRun["scope"] | undefined, episodeId?: string): boolean {
    if ((run.episodeId ?? undefined) !== episodeId) return false;
    if (!scope || (scope.ord === undefined && scope.target === undefined)) return true;
    const ords = (value: DramaRun["scope"]) => (value.chapterOrds ?? []).join();
    return run.scope.ord === scope.ord && run.scope.target === scope.target && ords(run.scope) === ords(scope);
}

const UNSETTLED: ReadonlySet<RunStatus> = new Set(["running", "review", "failed", "stopped"]);

/** Not yet adopted or dropped: still running, waiting for the user, or ended without a result. */
export const isUnsettled = (run: Pick<DramaRun, "status">): boolean => UNSETTLED.has(run.status);
