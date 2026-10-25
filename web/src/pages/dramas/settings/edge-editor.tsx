import { Input, Select } from "antd";
import { ArrowRight, ArrowLeftRight, Trash2, X } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { RELATION_KIND_LABELS } from "@/lib/drama/labels";
import type { DramaRelation, RelationKind } from "@/lib/drama/types";

type Patch = Partial<Pick<DramaRelation, "kind" | "label" | "note" | "fromId" | "toId">>;
type Props = { relation: DramaRelation; fromName: string; toName: string; busy: boolean; onSave: (patch: Patch) => void; onDelete: () => void; onClose: () => void };

/** Small card next to a selected line: what kind of relation it is, its name, a note. */
export function EdgeEditor({ relation, fromName, toName, busy, onSave, onDelete, onClose }: Props) {
    const { t } = useAppTranslation();
    const [kind, setKind] = useState<RelationKind>(relation.kind);
    const [label, setLabel] = useState(relation.label);
    const [note, setNote] = useState(relation.note);
    const dirty = kind !== relation.kind || label !== relation.label || note !== relation.note;
    const submit = () => onSave({ kind, label: label.trim(), note: note.trim() });
    return (
        <form
            className="flex w-72 flex-col gap-2.5 rounded-xl border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-panel)] p-3 shadow-[0_8px_28px_rgba(0,0,0,0.16)]"
            onPointerDown={(event) => event.stopPropagation()}
            onSubmit={(event) => {
                event.preventDefault();
                submit();
            }}
        >
            <div className="flex items-center gap-1.5 text-[13px] font-semibold">
                <span className="min-w-0 truncate">{fromName}</span>
                <ArrowRight className="size-3.5 shrink-0 text-[color:var(--wg-home-muted)]" strokeWidth={1.8} />
                <span className="min-w-0 flex-1 truncate">{toName}</span>
                <button type="button" className="wg-icon-button !size-6 shrink-0" aria-label={t("关闭")} onClick={onClose}>
                    <X className="!size-3.5" strokeWidth={1.8} />
                </button>
            </div>
            <Select size="small" value={kind} onChange={setKind} options={(Object.keys(RELATION_KIND_LABELS) as RelationKind[]).map((value) => ({ value, label: t(RELATION_KIND_LABELS[value]) }))} />
            <Input size="small" autoFocus value={label} maxLength={40} placeholder={t("关系名称，如「结义兄妹」")} onChange={(event) => setLabel(event.target.value)} />
            <Input.TextArea size="small" value={note} maxLength={1000} autoSize={{ minRows: 2, maxRows: 4 }} placeholder={t("备注（可选）")} onChange={(event) => setNote(event.target.value)} />
            <div className="flex items-center gap-1">
                <button type="button" className="wg-icon-button !size-7" disabled={busy} title={t("调换方向")} aria-label={t("调换方向")} onClick={() => onSave({ fromId: relation.toId, toId: relation.fromId })}>
                    <ArrowLeftRight className="!size-4" strokeWidth={1.6} />
                </button>
                <button type="button" className="wg-icon-button !size-7 hover:!text-destructive" disabled={busy} title={t("删除这条关系")} aria-label={t("删除这条关系")} onClick={onDelete}>
                    <Trash2 className="!size-4" strokeWidth={1.6} />
                </button>
                <button type="submit" className="wg-primary-button ml-auto !min-h-7 !px-3" disabled={busy || !dirty}>
                    {t("保存")}
                </button>
            </div>
        </form>
    );
}
