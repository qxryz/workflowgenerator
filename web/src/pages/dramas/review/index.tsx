import { Segmented, Select } from "antd";
import { ClipboardCheck } from "lucide-react";
import { useCallback, useMemo, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory, useStageRuns } from "@/components/drama/run-history";
import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { defaultReviewOrds, formatChapterRefs } from "@/lib/drama/story";
import type { DramaRun, DramaSnapshot, ReviewProposal } from "@/lib/drama/types";
import { ReviewReport } from "./report";

type Target = "chapters" | "settings";

/** 复核: pick what to check, read the seven-point report. Reports never change the story. */
export function ReviewSection({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const [target, setTarget] = useState<Target>("chapters");
    const all = useMemo(() => snapshot.chapters.map((chapter) => chapter.ord).sort((a, b) => a - b), [snapshot.chapters]);
    const [chosen, setChosen] = useState(() => defaultReviewOrds(snapshot.chapters));
    const ords = chosen.filter((ord) => all.includes(ord));
    const match = useCallback((run: DramaRun) => (run.scope.target ?? "chapters") === target, [target]);
    const { current, history } = useStageRuns(snapshot.runs, "review", match);
    const [picked, setPicked] = useState<string>();
    const shown = history.find((run) => run.id === picked) ?? current;

    const disabledReason = target === "chapters" ? (ords.length ? undefined : all.length ? "先选择要复核的章节" : "还没有章节可以复核") : snapshot.entities.length ? undefined : "还没有设定可以复核";
    const title = shown && (shown.scope.target === "settings" ? t("设定复核报告") : `${t("章节复核报告")}${shown.scope.chapterOrds?.length ? ` · ${formatChapterRefs(shown.scope.chapterOrds, t)}` : ""}`);
    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-2 border-b border-[color:var(--wg-home-line)] px-6 py-3">
                <Segmented
                    size="small"
                    value={target}
                    onChange={(value) => { setTarget(value as Target); setPicked(undefined); }}
                    options={[{ value: "chapters", label: t("章节") }, { value: "settings", label: t("设定") }]}
                    aria-label={t("复核范围")}
                />
                {target === "chapters" ? (
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                        <Select
                            mode="multiple"
                            size="small"
                            className="min-w-56 max-w-md flex-1"
                            value={ords}
                            onChange={(value: number[]) => setChosen([...value].sort((a, b) => a - b))}
                            maxTagCount="responsive"
                            placeholder={t("选择章节")}
                            options={snapshot.chapters.map((chapter) => ({ value: chapter.ord, label: `${chapter.label} ${chapter.title}` }))}
                            aria-label={t("复核哪些章节")}
                        />
                        <button type="button" className="wg-text-button !h-7" disabled={ords.length === all.length} onClick={() => setChosen(all)}>{t("全选")}</button>
                        {all.length > 10 ? <button type="button" className="wg-text-button !h-7" onClick={() => setChosen(defaultReviewOrds(snapshot.chapters))}>{t("最近 10 章")}</button> : null}
                    </div>
                ) : <div className="flex-1" />}
                <RunHistory runs={history} selectedId={shown?.id} onSelect={setPicked} />
                <StartTaskButton
                    snapshot={snapshot}
                    stage="review"
                    scope={target === "chapters" ? { target, chapterOrds: ords } : { target }}
                    label="开始复核"
                    icon={ClipboardCheck}
                    variant="primary"
                    disabled={Boolean(disabledReason)}
                    disabledReason={disabledReason}
                    onStarted={() => setPicked(undefined)}
                />
            </div>
            <div className="mx-auto flex min-h-0 w-full max-w-3xl flex-1 flex-col px-6 py-5">
                {shown ? (
                    <ProposalShell run={shown} title={title!}>
                        {(proposal) => <ReviewReport proposal={proposal as ReviewProposal} run={shown} snapshot={snapshot} />}
                    </ProposalShell>
                ) : (
                    <p className="mb-0 py-16 text-center text-sm text-[color:var(--wg-home-muted)]">{t(target === "chapters" ? (all.length ? "选好章节，开始复核。" : "还没有章节可以复核。") : "对照章节和账本，检查设定有没有对不上的地方。")}</p>
                )}
            </div>
        </div>
    );
}
