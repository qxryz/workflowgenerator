import { App } from "antd";
import { BookMarked, Pencil, Plus, Trash2 } from "lucide-react";
import { useMemo, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, useDramaMutation } from "@/hooks/use-drama";
import { LEDGER_KIND_LABELS } from "@/lib/drama/labels";
import { formatChapterRefs, groupLedger, removeLedger, upsertLedger, type LedgerDraft } from "@/lib/drama/story";
import type { DramaSnapshot, LedgerEntry } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { putLedger } from "@/services/drama-api";
import { LedgerForm } from "./ledger-form";

/** 创作账本: what the story has established, by kind, each with the chapters it appears in. */
export function LedgerPanel({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const { ledger, chapters, project } = snapshot;
    const [editing, setEditing] = useState<string | "new" | null>(null);
    const groups = useMemo(() => groupLedger(ledger), [ledger]);
    const ords = useMemo(() => chapters.map((chapter) => chapter.ord).sort((a, b) => a - b), [chapters]);
    const save = useDramaMutation((entries: Array<LedgerDraft | LedgerEntry>) => putLedger(project.id, entries), [dramaKey(project.id)]);
    const run = (entries: Array<LedgerDraft | LedgerEntry>, after?: () => void) =>
        save.mutate(entries, { onSuccess: after, onError: (error) => void message.error(error instanceof Error ? error.message : t("保存失败，请重试")) });
    const confirmDelete = (entry: LedgerEntry) =>
        modal.confirm({ title: t("删除「{name}」？", { name: entry.name }), okText: t("删除"), cancelText: t("取消"), okButtonProps: { danger: true }, onOk: () => save.mutateAsync(removeLedger(ledger, entry.id)).then(() => undefined) });
    const form = (initial?: LedgerEntry) => <LedgerForm key={initial?.id ?? "new"} initial={initial} chapterOrds={ords} busy={save.isPending} onCancel={() => setEditing(null)} onSubmit={(entry) => run(upsertLedger(ledger, entry), () => setEditing(null))} />;

    return (
        <aside className="flex h-full min-h-0 flex-col border-l border-[color:var(--wg-home-line)]">
            <header className="flex h-12 shrink-0 items-center justify-between px-4">
                <h3 className="flex items-center gap-2 text-[13px] font-semibold">
                    <BookMarked className="size-4 text-[color:var(--wg-home-muted)]" strokeWidth={1.6} />
                    {t("创作账本")}
                </h3>
                <button type="button" className="wg-text-button !h-7 !border !border-[color:var(--wg-home-line)]" disabled={editing === "new"} onClick={() => setEditing("new")}>
                    <Plus className="size-3.5" strokeWidth={1.8} />
                    {t("添加")}
                </button>
            </header>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-4 overflow-auto px-4 pb-8 pt-1">
                {editing === "new" ? form() : null}
                {!groups.length && editing !== "new" ? <p className="mb-0 py-8 text-center text-[13px] leading-6 text-[color:var(--wg-home-muted)]">{t("人物、地点、物件和伏笔会记在这里，写下一章时都会参考。")}</p> : null}
                {groups.map((group) => (
                    <section key={group.kind}>
                        <h4 className="mb-1 flex items-baseline gap-2 text-[12px] font-medium text-[color:var(--wg-home-muted)]">
                            {t(LEDGER_KIND_LABELS[group.kind])}
                            <span className="tabular-nums text-[11px] text-[color:var(--wg-home-muted-strong)]">{group.entries.length}</span>
                        </h4>
                        <ul>
                            {group.entries.map((entry) =>
                                editing === entry.id ? (
                                    <li key={entry.id} className="my-1.5">{form(entry)}</li>
                                ) : (
                                    <li key={entry.id} className="group relative -mx-2 rounded-lg px-2 py-2 hover:bg-[color:var(--wg-home-hover)]">
                                        <div className={cn("flex items-baseline gap-2", entry.status === "resolved" && "opacity-60")}>
                                            <span className="min-w-0 truncate text-[13px] font-medium">{entry.name}</span>
                                            {entry.chapterOrds.length ? <span className="shrink-0 text-[11px] text-[color:var(--wg-home-muted)]">{formatChapterRefs(entry.chapterOrds, t)}</span> : null}
                                        </div>
                                        {entry.note ? <p className={cn("mb-0 mt-0.5 line-clamp-3 text-[12px] leading-5 text-[color:var(--wg-home-muted)]", entry.status === "resolved" && "opacity-60")}>{entry.note}</p> : null}
                                        {entry.kind === "thread" ? (
                                            <button
                                                type="button"
                                                className={cn("mt-1.5 inline-flex h-5 items-center rounded-full border px-2 text-[11px] transition-colors", entry.status === "open" ? "border-[color:var(--wg-home-accent)]/50 text-[color:var(--wg-home-accent)] hover:bg-[color:var(--wg-home-accent)]/10" : "border-[color:var(--wg-home-line)] text-[color:var(--wg-home-muted)] hover:bg-[color:var(--wg-home-hover)]")}
                                                title={t(entry.status === "open" ? "标记为已回收" : "改回未回收")}
                                                onClick={() => run(upsertLedger(ledger, { ...entry, status: entry.status === "open" ? "resolved" : "open" }))}
                                            >
                                                {t(entry.status === "open" ? "未回收" : "已回收")}
                                            </button>
                                        ) : null}
                                        <div className="absolute right-1.5 top-1.5 flex gap-0.5 rounded-md bg-[color:var(--wg-panel)] opacity-0 shadow-sm ring-1 ring-[color:var(--wg-home-line)] transition-opacity focus-within:opacity-100 group-hover:opacity-100">
                                            <button type="button" className="wg-icon-button !size-6" aria-label={t("编辑")} onClick={() => setEditing(entry.id)}><Pencil className="!size-3.5" strokeWidth={1.6} /></button>
                                            <button type="button" className="wg-icon-button !size-6" aria-label={t("删除")} onClick={() => confirmDelete(entry)}><Trash2 className="!size-3.5" strokeWidth={1.6} /></button>
                                        </div>
                                    </li>
                                ),
                            )}
                        </ul>
                    </section>
                ))}
            </div>
        </aside>
    );
}
