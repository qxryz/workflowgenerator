import { Input, Select, type InputRef } from "antd";
import { useEffect, useRef, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { ENTITY_KIND_LABELS } from "@/lib/drama/labels";
import type { DramaEntity, EntityKind } from "@/lib/drama/types";
import { updateEntity } from "@/services/drama-api";
import { useGuard, useRefresh } from "./common";

type Draft = { name: string; kind: EntityKind; aliases: string[]; parentId: string | null; description: string; appearance: string };
const draftOf = (entity: DramaEntity): Draft => ({ name: entity.name, kind: entity.kind, aliases: entity.aliases, parentId: entity.parentId, description: entity.description, appearance: entity.appearance });
const same = (a: Draft, b: Draft) => JSON.stringify(a) === JSON.stringify(b);

type Props = { entity: DramaEntity; owners: DramaEntity[]; focusName: boolean; dramaId: string };

export function EntityForm({ entity, owners, focusName, dramaId }: Props) {
    const { t } = useAppTranslation();
    const guard = useGuard(dramaId);
    const refresh = useRefresh(dramaId);
    const [draft, setDraft] = useState(() => draftOf(entity));
    const [saving, setSaving] = useState(false);
    const name = useRef<InputRef>(null);
    const saved = draftOf(entity);
    const dirty = !same(draft, saved);
    const stored = JSON.stringify(saved);

    // Follow the server while nothing was edited (a re-run, another tab); keep the user's edits otherwise.
    const base = useRef(stored);
    useEffect(() => {
        const previous = base.current;
        base.current = stored;
        setDraft((current) => (JSON.stringify(current) === previous ? JSON.parse(stored) : current));
    }, [stored]);
    useEffect(() => {
        if (focusName) name.current?.focus({ cursor: "all" });
    }, [focusName, entity.id]);

    const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((current) => ({ ...current, [key]: value }));
    const save = async () => {
        if (!draft.name.trim()) return;
        setSaving(true);
        const ok = await guard(() =>
            updateEntity(entity.id, {
                rev: entity.rev,
                name: draft.name.trim(),
                kind: draft.kind,
                aliases: draft.aliases.map((alias) => alias.trim()).filter(Boolean),
                description: draft.description,
                appearance: draft.appearance,
                parentId: draft.kind === "prop" ? draft.parentId : null,
            }),
        );
        setSaving(false);
        if (ok) await refresh();
    };
    const field = (label: string, control: React.ReactNode) => (
        <label className="flex flex-col gap-1.5">
            <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t(label)}</span>
            {control}
        </label>
    );

    return (
        <form
            className="flex flex-col gap-3.5"
            onSubmit={(event) => {
                event.preventDefault();
                void save();
            }}
        >
            <div className="grid grid-cols-[minmax(0,1fr)_7.5rem] gap-3">
                {field("名称", <Input ref={name} value={draft.name} maxLength={60} status={draft.name.trim() ? undefined : "error"} onChange={(event) => set("name", event.target.value)} />)}
                {field(
                    "类型",
                    <Select value={draft.kind} onChange={(kind) => set("kind", kind)} options={(Object.keys(ENTITY_KIND_LABELS) as EntityKind[]).map((kind) => ({ value: kind, label: t(kind === "prop" ? "道具陈设" : ENTITY_KIND_LABELS[kind]) }))} />,
                )}
            </div>
            {field("别名", <Select mode="tags" value={draft.aliases} onChange={(aliases) => set("aliases", aliases)} tokenSeparators={[",", "，", "、"]} open={false} suffixIcon={null} placeholder={t("输入后回车")} />)}
            {draft.kind === "prop"
                ? field(
                      "所属",
                      <Select
                          allowClear
                          value={draft.parentId ?? undefined}
                          onChange={(parentId) => set("parentId", parentId ?? null)}
                          placeholder={t("人物的装备，或场景的陈设")}
                          options={owners.filter((owner) => owner.id !== entity.id).map((owner) => ({ value: owner.id, label: `${owner.name} · ${t(ENTITY_KIND_LABELS[owner.kind])}` }))}
                          showSearch={{ optionFilterProp: "label" }}
                      />,
                  )
                : null}
            {field("描述", <Input.TextArea value={draft.description} maxLength={4000} autoSize={{ minRows: 3, maxRows: 9 }} onChange={(event) => set("description", event.target.value)} />)}
            {field("外观", <Input.TextArea value={draft.appearance} maxLength={4000} autoSize={{ minRows: 3, maxRows: 9 }} placeholder={t("只写看得见的外观，设定图会按这段生成")} onChange={(event) => set("appearance", event.target.value)} />)}
            {dirty ? (
                <div className="sticky bottom-0 -mx-1 flex items-center justify-end gap-2 bg-[color:var(--wg-panel)] px-1 py-2">
                    <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" disabled={saving} onClick={() => setDraft(saved)}>
                        {t("还原")}
                    </button>
                    <button type="submit" className="wg-primary-button !min-h-8" disabled={saving || !draft.name.trim()}>
                        {t("保存")}
                    </button>
                </div>
            ) : null}
        </form>
    );
}
