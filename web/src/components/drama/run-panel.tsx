/**
 * RunPanelButton — 智能体进度: the header button (with a running-count badge) and its right-hand Drawer (440px).
 *
 * Props: `RunPanelButton({ snapshot }: { snapshot: DramaSnapshot })`
 * Lists every run of the drama grouped by stage (章节 / 设定 / 分集 / 剧本与分镜 / 复核), merged with streams running in this tab.
 * Row actions: 停止 (running), 去查看 (navigates to the matching tab / episode step / review view), 删除记录 (not running).
 * The drama query polls every 2s while a run is live (see useDrama), so statuses update on their own.
 */
import { Drawer } from "antd";
import { ArrowUpRight, ListChecks, Square, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { LiveText } from "@/components/drama/live-text";
import { StatusTag } from "@/components/drama/status-tag";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDramaRunActions } from "@/hooks/use-drama-run-actions";
import { useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/drama/format";
import { RUN_STAGE_LABELS } from "@/lib/drama/labels";
import type { DramaRun, DramaSnapshot, RunStage } from "@/lib/drama/types";
import { useDramaRuns } from "@/stores/use-drama-runs";

const GROUPS: Array<{ label: string; stages: RunStage[] }> = [
    { label: "章节", stages: ["chapter"] },
    { label: "设定", stages: ["settings"] },
    { label: "分集", stages: ["episodes"] },
    { label: "剧本与分镜", stages: ["script", "shots"] },
    { label: "复核", stages: ["review"] },
];

/** Snapshot runs plus streams started in this tab that the snapshot has not caught up with yet. */
function useDramaRunList(snapshot: DramaSnapshot): DramaRun[] {
    const live = useDramaRuns((state) => state.runs);
    const dramaId = snapshot.project.id;
    return useMemo(() => {
        const known = new Set(snapshot.runs.map((run) => run.id));
        const extra = Object.values(live)
            .filter((item) => item.dramaId === dramaId && !known.has(item.runId))
            .map<DramaRun>((item) => ({ id: item.runId, episodeId: item.episodeId, stage: item.stage, scope: {}, instruction: "", model: "", status: "running", parentId: null, error: "", createdAt: item.startedAt, finishedAt: null }));
        return [...extra, ...snapshot.runs].sort((a, b) => b.createdAt - a.createdAt);
    }, [dramaId, live, snapshot.runs]);
}

export function RunPanelButton({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const [open, setOpen] = useState(false);
    const runs = useDramaRunList(snapshot);
    const running = runs.filter((run) => run.status === "running").length;
    return (
        <>
            <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" onClick={() => setOpen(true)} aria-haspopup="dialog">
                <ListChecks className="size-4" strokeWidth={1.6} />
                {t("智能体进度")}
                {running ? <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--wg-home-accent)] px-1 text-[10px] font-semibold tabular-nums text-[color:var(--wg-home-accent-text)]">{running}</span> : null}
            </button>
            <Drawer open={open} onClose={() => setOpen(false)} size={440} title={t("智能体进度")} destroyOnHidden>
                <RunList snapshot={snapshot} runs={runs} onNavigate={() => setOpen(false)} />
            </Drawer>
        </>
    );
}

function RunList({ snapshot, runs, onNavigate }: { snapshot: DramaSnapshot; runs: DramaRun[]; onNavigate: () => void }) {
    const { t } = useAppTranslation();
    const now = useNow(runs.some((run) => run.status === "running"));
    if (!runs.length) return <p className="py-16 text-center text-[13px] text-[color:var(--wg-home-muted)]">{t("还没有任务。在各个板块里点开始，进度会出现在这里。")}</p>;
    return (
        <div className="flex flex-col gap-7">
            {GROUPS.map((group) => {
                const items = runs.filter((run) => group.stages.includes(run.stage));
                if (!items.length) return null;
                return (
                    <section key={group.label}>
                        <h3 className="mb-2 text-[12px] font-semibold text-[color:var(--wg-home-muted)]">{t(group.label)}</h3>
                        <ul className="divide-y divide-[color:var(--wg-home-line)] rounded-xl border border-[color:var(--wg-home-line)]">
                            {items.map((run) => (
                                <RunRow key={run.id} run={run} snapshot={snapshot} now={now} onNavigate={onNavigate} showStage={group.stages.length > 1} />
                            ))}
                        </ul>
                    </section>
                );
            })}
        </div>
    );
}

function RunRow({ run, snapshot, now, onNavigate, showStage }: { run: DramaRun; snapshot: DramaSnapshot; now: number; onNavigate: () => void; showStage: boolean }) {
    const { t } = useAppTranslation();
    const navigate = useNavigate();
    const { stop, remove } = useDramaRunActions(snapshot.project.id);
    const scope = scopeLabel(run, snapshot, t);
    const base = `/dramas/${snapshot.project.id}`;
    const target = {
        chapter: `${base}?tab=story`,
        settings: `${base}?tab=settings`,
        episodes: `${base}?tab=episodes`,
        review: `${base}?view=review`,
        script: `${base}/episodes/${run.episodeId}?step=script`,
        shots: `${base}/episodes/${run.episodeId}?step=shots`,
    }[run.stage];
    const canOpen = (run.stage !== "script" && run.stage !== "shots") || Boolean(run.episodeId);
    return (
        <li className="px-3.5 py-3">
            <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                    {showStage || !scope ? t(RUN_STAGE_LABELS[run.stage]) : null}
                    {scope ? <span className={showStage || !scope ? "ml-1.5 font-normal text-[color:var(--wg-home-muted)]" : undefined}>{scope}</span> : null}
                </span>
                <StatusTag status={run.status} />
            </div>
            <div className="mt-1.5 flex items-center gap-2 text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">
                <span>{run.status === "running" ? t("已用时 {time}", { time: formatElapsed(now - run.createdAt) }) : formatClock(run.finishedAt ?? run.createdAt)}</span>
                <span className="ml-auto flex items-center gap-1">
                    {run.status === "running" ? (
                        <button type="button" className="wg-text-button !h-7" onClick={() => void stop(run)}>
                            <Square className="size-3" fill="currentColor" strokeWidth={0} />
                            {t("停止")}
                        </button>
                    ) : (
                        <button type="button" className="wg-icon-button !size-7" title={t("删除记录")} aria-label={t("删除记录")} onClick={() => remove(run)}>
                            <Trash2 className="!size-4" strokeWidth={1.6} />
                        </button>
                    )}
                    {canOpen ? (
                        <button
                            type="button"
                            className="wg-text-button !h-7"
                            onClick={() => {
                                onNavigate();
                                navigate(target);
                            }}
                        >
                            {t("去查看")}
                            <ArrowUpRight className="size-3.5" strokeWidth={1.6} />
                        </button>
                    ) : null}
                </span>
            </div>
            {run.status === "running" ? <LiveText runId={run.id} collapsible defaultOpen={false} className="mt-2" /> : null}
            {run.status === "failed" && run.error ? <p className="mt-2 text-[12px] leading-5 text-destructive">{run.error}</p> : null}
        </li>
    );
}

function scopeLabel(run: DramaRun, snapshot: DramaSnapshot, t: (message: string, values?: Record<string, string | number>) => string) {
    if (run.stage === "chapter" && run.scope.ord) return t("第 {count} 章", { count: run.scope.ord });
    if (run.stage === "review" && run.scope.target) return t(run.scope.target === "chapters" ? "章节" : "设定");
    const episode = run.episodeId ? snapshot.episodes.find((item) => item.id === run.episodeId) : undefined;
    return episode ? episode.title || t("第 {count} 集", { count: episode.ord }) : "";
}
