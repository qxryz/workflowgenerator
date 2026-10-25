import { ListPlus, Plus } from "lucide-react";
import { useMemo, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory, useStageRuns } from "@/components/drama/run-history";
import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaSnapshot, EpisodesProposal } from "@/lib/drama/types";
import { EpisodeCard } from "./episode-card";
import { EpisodeForm } from "./episode-form";
import { EpisodesResult } from "./proposal-list";

const UNSETTLED = ["running", "review", "failed"];

/** 分集: episode cards on the left, the plan being reviewed on the right. */
export function EpisodesSection({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const episodes = useMemo(() => [...snapshot.episodes].sort((a, b) => a.ord - b.ord), [snapshot.episodes]);
    const { current, history } = useStageRuns(snapshot.runs, "episodes");
    const [picked, setPicked] = useState<string>();
    const [editing, setEditing] = useState<string | "new" | null>(null);
    const shown = history.find((run) => run.id === picked) ?? (current && UNSETTLED.includes(current.status) ? current : undefined);
    const empty = !episodes.length && !shown && editing !== "new";
    const noChapters = snapshot.chapters.length === 0;
    const plan = (
        <StartTaskButton snapshot={snapshot} stage="episodes" label="规划分集" icon={ListPlus} variant="primary" disabled={noChapters} disabledReason="先写或导入章节，才能规划分集" onStarted={() => setPicked(undefined)} />
    );
    const create = (
        <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={editing === "new"} onClick={() => setEditing("new")}>
            <Plus className="size-4" strokeWidth={1.6} />
            {t("新建分集")}
        </button>
    );

    return (
        <div className="flex h-full min-h-0 flex-col">
            <header className="flex h-14 shrink-0 items-center gap-3 border-b border-[color:var(--wg-home-line)] px-6">
                <h2 className="text-[14px] font-semibold">{t("分集")}</h2>
                {episodes.length ? <span className="text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("{count} 集", { count: episodes.length })}</span> : null}
                <div className="ml-auto flex items-center gap-2">
                    {history.length > 1 || shown ? <RunHistory runs={history} selectedId={shown?.id} onSelect={setPicked} /> : null}
                    {empty ? null : (
                        <>
                            {create}
                            {plan}
                        </>
                    )}
                </div>
            </header>
            <div className="flex min-h-0 flex-1">
                <div className="thin-scrollbar min-w-0 flex-1 overflow-auto px-6 py-5">
                    {empty ? (
                        <div className="flex flex-col items-center gap-5 py-24 text-center">
                            <p className="mb-0 text-sm text-[color:var(--wg-home-muted)]">{t(noChapters ? "有了章节，就能规划分集。" : "还没有分集，先根据章节规划一版。")}</p>
                            <div className="flex items-center gap-2">
                                {plan}
                                {create}
                            </div>
                        </div>
                    ) : (
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3">
                            {episodes.map((episode) =>
                                editing === episode.id ? <EpisodeForm key={episode.id} snapshot={snapshot} episode={episode} onClose={() => setEditing(null)} /> : <EpisodeCard key={episode.id} snapshot={snapshot} episode={episode} onEdit={() => setEditing(episode.id)} />,
                            )}
                            {editing === "new" ? <EpisodeForm snapshot={snapshot} onClose={() => setEditing(null)} /> : null}
                        </div>
                    )}
                </div>
                {shown ? (
                    <aside className="flex w-[380px] shrink-0 flex-col border-l border-[color:var(--wg-home-line)] p-4 min-[1280px]:w-[420px]">
                        <ProposalShell run={shown} title={t("分集规划草稿")}>{(proposal) => <EpisodesResult proposal={proposal as EpisodesProposal} snapshot={snapshot} />}</ProposalShell>
                    </aside>
                ) : null}
            </div>
        </div>
    );
}
