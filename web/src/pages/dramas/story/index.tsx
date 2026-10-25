import { PenLine } from "lucide-react";
import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { chapterRows, defaultRow, nextChapterOrd } from "@/lib/drama/story";
import type { DramaSnapshot } from "@/lib/drama/types";
import { ChapterCenter } from "./chapter-center";
import { ChapterList } from "./chapter-list";
import { ImportPanel } from "./import-panel";
import { LedgerPanel } from "./ledger-panel";
import { TaskEntry } from "./task-entry";

/** Chapter list | reader and editor | story notes. Each column scrolls on its own. */
export function StorySection({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const [params, setParams] = useSearchParams();
    const [importing, setImporting] = useState(false);
    const original = snapshot.project.sourceType === "original";
    const rows = useMemo(() => chapterRows(snapshot.chapters, snapshot.runs), [snapshot.chapters, snapshot.runs]);
    const asked = Number(params.get("ch"));
    const row = rows.find((candidate) => candidate.ord === asked) ?? defaultRow(rows, original);
    const select = (ord: number | null) => {
        setImporting(false);
        setParams((current) => { const next = new URLSearchParams(current); if (ord === null) next.delete("ch"); else next.set("ch", String(ord)); return next; }, { replace: true });
    };
    const next = nextChapterOrd(snapshot.chapters);

    let center;
    if (importing || (!rows.length && !original)) center = <ImportPanel snapshot={snapshot} onCancel={rows.length ? () => setImporting(false) : undefined} onDone={(ord) => select(ord)} />;
    else if (row) center = <ChapterCenter key={`${row.ord}`} snapshot={snapshot} row={row} onDeleted={() => select(null)} />;
    else
        center = (
            <div className="flex h-full flex-col items-center justify-center gap-5 px-8 text-center">
                <p className="mb-0 text-sm text-[color:var(--wg-home-muted)]">{t("还没有章节，从第一章开始。")}</p>
                <StartTaskButton snapshot={snapshot} stage="chapter" scope={{ ord: 1 }} label="写第一章" icon={PenLine} variant="primary" onStarted={() => select(1)} />
            </div>
        );

    const showList = rows.length > 0;
    return (
        <div className={`grid h-full min-h-0 ${showList ? "grid-cols-[248px_minmax(0,1fr)_300px] min-[1280px]:grid-cols-[260px_minmax(0,1fr)_340px]" : "grid-cols-[minmax(0,1fr)_300px] min-[1280px]:grid-cols-[minmax(0,1fr)_340px]"}`}>
            {showList ? (
                <nav className="flex h-full min-h-0 flex-col border-r border-[color:var(--wg-home-line)] pt-3" aria-label={t("章节")}>
                    <TaskEntry snapshot={snapshot} next={next} onStarted={(run) => run.scope.ord && select(run.scope.ord)} onImport={() => setImporting(true)} />
                    <ChapterList rows={rows} selected={importing ? undefined : row?.ord} onSelect={select} />
                </nav>
            ) : null}
            <div className="min-h-0 min-w-0">{center}</div>
            <LedgerPanel snapshot={snapshot} />
        </div>
    );
}
