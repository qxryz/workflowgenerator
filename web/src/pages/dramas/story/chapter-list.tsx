import { StatusTag } from "@/components/drama/status-tag";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { countChars, ORIGIN_LABELS, type ChapterRow } from "@/lib/drama/story";
import { cn } from "@/lib/utils";

type Props = { rows: ChapterRow[]; selected: number | undefined; onSelect: (ord: number) => void };

export function ChapterList({ rows, selected, onSelect }: Props) {
    const { t } = useAppTranslation();
    return (
        <ul className="thin-scrollbar min-h-0 flex-1 space-y-0.5 overflow-auto px-2 pb-6" aria-label={t("章节")}>
            {rows.map((row) => {
                const active = row.ord === selected;
                const { chapter, run } = row;
                return (
                    <li key={row.ord}>
                        <button
                            type="button"
                            aria-current={active ? "true" : undefined}
                            className={cn("flex w-full items-start gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors", active ? "bg-[color:var(--wg-home-hover)]" : "hover:bg-[color:var(--wg-home-ghost)]")}
                            onClick={() => onSelect(row.ord)}
                        >
                            <span className="mt-0.5 w-7 shrink-0 text-[11px] tabular-nums text-[color:var(--wg-home-muted)]">{chapter?.label ?? `C${row.ord}`}</span>
                            <span className="min-w-0 flex-1">
                                <span className={cn("block truncate text-[13px] leading-5", active && "font-semibold")}>{chapter?.title ?? t("新章节")}</span>
                                <span className="mt-0.5 block truncate text-[11px] text-[color:var(--wg-home-muted)]">
                                    {chapter ? `${t(ORIGIN_LABELS[chapter.origin])} · ${t("{count} 字", { count: countChars(chapter.body).toLocaleString() })}` : t("还没有内容")}
                                </span>
                            </span>
                            {run ? <StatusTag status={run.status} className="mt-0.5" /> : null}
                        </button>
                    </li>
                );
            })}
        </ul>
    );
}
