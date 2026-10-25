import { Input, Segmented, Select } from "antd";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { LEDGER_KIND_LABELS } from "@/lib/drama/labels";
import { LEDGER_ORDER, type LedgerDraft } from "@/lib/drama/story";

type Props = { initial?: LedgerDraft; chapterOrds: number[]; busy: boolean; onSubmit: (entry: LedgerDraft) => void; onCancel: () => void };

const BLANK: LedgerDraft = { kind: "character", name: "", note: "", chapterOrds: [], status: "open" };

/** Add or edit one entry in place; the same form for every kind. */
export function LedgerForm({ initial, chapterOrds, busy, onSubmit, onCancel }: Props) {
    const { t } = useAppTranslation();
    const [draft, setDraft] = useState<LedgerDraft>(initial ?? BLANK);
    const set = (patch: Partial<LedgerDraft>) => setDraft((current) => ({ ...current, ...patch }));
    const ready = draft.name.trim().length > 0;
    const submit = () => ready && !busy && onSubmit({ ...draft, name: draft.name.trim(), note: draft.note.trim() });
    return (
        <form className="space-y-2.5 rounded-xl border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-panel)] p-3" onSubmit={(event) => { event.preventDefault(); submit(); }}>
            <div className="flex gap-2">
                <Select size="small" className="w-24 shrink-0" value={draft.kind} onChange={(kind) => set({ kind })} options={LEDGER_ORDER.map((kind) => ({ value: kind, label: t(LEDGER_KIND_LABELS[kind]) }))} aria-label={t("类别")} />
                <Input size="small" autoFocus maxLength={80} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder={t("名称")} aria-label={t("名称")} />
            </div>
            <Input.TextArea size="small" maxLength={2000} value={draft.note} onChange={(event) => set({ note: event.target.value })} autoSize={{ minRows: 2, maxRows: 6 }} placeholder={t("一句话说明")} aria-label={t("说明")} />
            <Select
                size="small"
                mode="multiple"
                className="w-full"
                value={draft.chapterOrds}
                onChange={(ords: number[]) => set({ chapterOrds: [...ords].sort((a, b) => a - b) })}
                options={chapterOrds.map((ord) => ({ value: ord, label: t("第{ords}章", { ords: ord }) }))}
                placeholder={t("出现在哪些章节")}
                maxTagCount="responsive"
                aria-label={t("出现章节")}
            />
            {draft.kind === "thread" ? <Segmented size="small" value={draft.status} onChange={(status) => set({ status: status as LedgerDraft["status"] })} options={[{ value: "open", label: t("未回收") }, { value: "resolved", label: t("已回收") }]} /> : null}
            <div className="flex justify-end gap-2">
                <button type="button" className="wg-text-button !h-7 !border !border-[color:var(--wg-home-line)]" onClick={onCancel}>{t("取消")}</button>
                <button type="submit" className="wg-primary-button !min-h-7 !px-3" disabled={!ready || busy}>
                    {busy ? <Loader2 className="size-3.5 animate-spin" /> : null}
                    {t("保存")}
                </button>
            </div>
        </form>
    );
}
