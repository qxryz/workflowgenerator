import { FilePlus2, PenLine } from "lucide-react";

import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaRun, DramaSnapshot } from "@/lib/drama/types";

/** Stretches the task button's frame to the column width. */
const FULL = "[&>span]:flex [&>span]:w-full [&>span>:first-child]:flex-1 [&>span>:first-child]:!px-2.5 [&>span>:first-child]:whitespace-nowrap";

type Props = { snapshot: DramaSnapshot; next: number; onStarted: (run: DramaRun) => void; onImport: () => void };

/** Sits above the chapter list: the one thing to do next. */
export function TaskEntry({ snapshot, next, onStarted, onImport }: Props) {
    const { t } = useAppTranslation();
    const original = snapshot.project.sourceType === "original";
    const first = next === 1;
    if (original) {
        return (
            <div className={`${FULL} px-4 pb-3 pt-1`}>
                <StartTaskButton snapshot={snapshot} stage="chapter" scope={{ ord: next }} label={first ? "写第一章" : "写下一章"} icon={PenLine} variant="primary" onStarted={onStarted} />
                <p className="mb-0 mt-2 text-[11px] leading-4 text-[color:var(--wg-home-muted)]">{first ? t("从开篇写起") : t("将写第 {ord} 章，承接上一章的结尾", { ord: next })}</p>
            </div>
        );
    }
    return (
        <div className={`${FULL} flex flex-col gap-2 px-4 pb-3 pt-1`}>
            <button type="button" className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-panel)] text-[13px] font-medium transition hover:bg-[color:var(--wg-home-hover)]" onClick={onImport}>
                <FilePlus2 className="size-4" strokeWidth={1.6} />
                {t("追加章节")}
            </button>
            <StartTaskButton snapshot={snapshot} stage="chapter" scope={{ ord: next }} label="续写下一章" icon={PenLine} onStarted={onStarted} />
        </div>
    );
}
