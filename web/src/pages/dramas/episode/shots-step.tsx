import { App } from "antd";
import { LayoutList, Plus } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory, useStageRuns } from "@/components/drama/run-history";
import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { adoptedByShot } from "@/lib/drama/episode-steps";
import { lintEpisode } from "@/lib/drama/lint";
import { isUnsettled } from "@/lib/drama/stage-runs";
import type { DramaRun, ShotsProposal } from "@/lib/drama/types";
import { createShot } from "@/services/drama-api";
import type { EpisodeCtx } from "./context";
import { LintPanel } from "./lint-panel";
import { ShotTable } from "./shot-table";
import { ShotsProposalTable } from "./shots-proposal";

export function ShotsStep({ ctx }: { ctx: EpisodeCtx }) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const { snapshot, episode, shots, artifacts } = ctx;
    const match = useCallback((run: DramaRun) => run.episodeId === episode.id, [episode.id]);
    const { current, history } = useStageRuns(snapshot.runs, "shots", match);
    const [picked, setPicked] = useState<string>();
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const run = history.find((item) => item.id === picked) ?? current;
    const showRun = run && (picked !== undefined || isUnsettled(run));

    const issues = useMemo(() => lintEpisode(shots, ctx.entities, episode.targetSeconds), [shots, ctx.entities, episode.targetSeconds]);
    const total = shots.reduce((sum, shot) => sum + shot.seconds, 0);
    const hasMedia = (["image", "video", "audio"] as const).some((kind) => adoptedByShot(artifacts, kind).size > 0);
    const hasScript = Boolean(episode.script.trim());

    const append = async () => {
        try {
            setExpandedId((await createShot(episode.id)).id);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("操作没有成功，请重试"));
        } finally {
            ctx.refresh();
        }
    };

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto flex max-w-[1400px] flex-col gap-5 px-6 py-6">
                    <div className="flex flex-wrap items-center gap-3">
                        <StartTaskButton
                            snapshot={snapshot}
                            stage="shots"
                            episodeId={episode.id}
                            label={shots.length ? "重新拆分" : "拆分镜头"}
                            icon={LayoutList}
                            variant="primary"
                            disabled={!hasScript}
                            disabledReason="先写好本集剧本"
                            onStarted={(started) => setPicked(started.id)}
                        />
                        {shots.length ? (
                            <>
                                <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" onClick={() => void append()}>
                                    <Plus className="size-4" strokeWidth={1.6} />
                                    {t("添加镜头")}
                                </button>
                                <span className="text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("共 {count} 镜 · {seconds} 秒 · 目标 {target} 秒", { count: shots.length, seconds: total, target: episode.targetSeconds })}</span>
                            </>
                        ) : null}
                        <span className="ml-auto" />
                        <RunHistory runs={history} selectedId={run?.id} onSelect={setPicked} dramaId={snapshot.project.id} />
                    </div>
                    {showRun ? (
                        <div className="flex max-h-[min(55vh,520px)] flex-col">
                            <ProposalShell
                                key={run.id}
                                run={run}
                                title={t("分镜草稿")}
                                confirmAdopt={hasMedia ? "采用后将替换本集全部镜头，已生成的画面、视频和配音会一起删除" : undefined}
                                onAdopted={() => {
                                    setPicked(undefined);
                                    setExpandedId(null);
                                }}
                            >
                                {(proposal) => <ShotsProposalTable proposal={proposal as ShotsProposal} entities={snapshot.entities} targetSeconds={episode.targetSeconds} />}
                            </ProposalShell>
                        </div>
                    ) : null}
                    {shots.length ? (
                        <ShotTable ctx={ctx} issues={issues} expandedId={expandedId} onExpand={setExpandedId} />
                    ) : showRun ? null : (
                        <div className="flex flex-col items-center gap-4 py-16 text-[13px] text-[color:var(--wg-home-muted)]">
                            <p>{hasScript ? t("还没有镜头。点上方「拆分镜头」，把剧本拆成镜头表。") : t("还没有镜头。先在「剧本」里写好剧本，再来拆分。")}</p>
                            {hasScript ? null : (
                                <button type="button" className="wg-primary-button" onClick={() => ctx.go("script")}>
                                    {t("去写剧本")}
                                </button>
                            )}
                        </div>
                    )}
                </div>
            </div>
            {shots.length ? <LintPanel issues={issues} onPick={setExpandedId} /> : null}
        </div>
    );
}
