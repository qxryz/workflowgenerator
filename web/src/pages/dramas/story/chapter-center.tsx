import { Segmented } from "antd";
import { useCallback, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory, useStageRuns } from "@/components/drama/run-history";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { isUnsettled } from "@/lib/drama/stage-runs";
import { ORIGIN_LABELS, type ChapterRow } from "@/lib/drama/story";
import type { ChapterProposal, DramaRun, DramaSnapshot } from "@/lib/drama/types";
import { ChapterEditor } from "./chapter-editor";
import { ChapterFrame } from "./chapter-frame";
import { ChapterReader } from "./chapter-reader";
import { ChapterResult } from "./chapter-result";

type Props = { snapshot: DramaSnapshot; row: ChapterRow; onDeleted: () => void };

/** One chapter: its text, the result a run is producing for it, or the editor. Remount per chapter. */
export function ChapterCenter({ snapshot, row, onDeleted }: Props) {
    const { t } = useAppTranslation();
    const { ord, chapter } = row;
    const match = useCallback((run: DramaRun) => run.scope.ord === ord, [ord]);
    const { history } = useStageRuns(snapshot.runs, "chapter", match);
    const [picked, setPicked] = useState<string>();
    const [editing, setEditing] = useState(false);
    const [onChapter, setOnChapter] = useState(Boolean(chapter) && row.run?.status === "failed");

    const shown = history.find((run) => run.id === picked) ?? row.run;
    const unsettled = shown !== undefined && isUnsettled(shown);
    const meta = (
        <>
            <span className="shrink-0 rounded-md border border-[color:var(--wg-home-line)] px-1.5 py-0.5 text-[11px] tabular-nums">{t("第 {count} 章", { count: ord })}</span>
            <span className="truncate">{chapter ? `${t(ORIGIN_LABELS[chapter.origin])} · ${t("{count} 字", { count: chapter.chars.toLocaleString() })}` : t("新章节")}</span>
        </>
    );
    const toggle = unsettled && chapter ? (
        <Segmented size="small" value={onChapter ? "chapter" : "result"} onChange={(value) => setOnChapter(value === "chapter")} options={[{ value: "result", label: t("这次的结果") }, { value: "chapter", label: t("现有章节") }]} />
    ) : null;
    const historySelect = history.length > 1 || unsettled ? <RunHistory runs={history} selectedId={shown?.id} onSelect={(id) => { setPicked(id); setOnChapter(false); }} /> : null;
    const shell = shown ? (
        <ProposalShell key={shown.id} run={shown} title={t("第 {ord} 章草稿", { ord })} onAdopted={() => { setPicked(undefined); setOnChapter(true); }}>
            {(proposal) => <ChapterResult proposal={proposal as ChapterProposal} />}
        </ProposalShell>
    ) : null;

    if (editing && chapter) return <ChapterEditor dramaId={snapshot.project.id} chapter={chapter} meta={meta} onDone={() => setEditing(false)} />;
    if (!chapter || (unsettled && !onChapter)) {
        return (
            <ChapterFrame meta={meta} scroll={false} actions={<>{historySelect}{toggle}</>}>
                {shell ?? <p className="mb-0 p-4 text-sm text-[color:var(--wg-home-muted)]">{t("这一章还没有内容。")}</p>}
            </ChapterFrame>
        );
    }
    return (
        <ChapterReader
            snapshot={snapshot}
            chapter={chapter}
            meta={meta}
            extra={unsettled ? undefined : historySelect}
            bar={unsettled ? <>{toggle}{historySelect}</> : undefined}
            strip={shown && !unsettled ? <div className="mb-6 flex flex-col">{shell}</div> : null}
            onEdit={() => setEditing(true)}
            onRewrite={() => { setPicked(undefined); setOnChapter(false); }}
            onDeleted={onDeleted}
        />
    );
}
