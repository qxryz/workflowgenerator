import { App, AutoComplete, Input, InputNumber, Select } from "antd";
import { Loader2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { CAMERA_MOVES, ENTITY_KIND_LABELS, SHOT_SIZES } from "@/lib/drama/labels";
import { sameDraft, toDraft, type ShotDraft } from "@/lib/drama/shot-draft";
import type { DramaShot } from "@/lib/drama/types";
import { DramaApiError, updateShot } from "@/services/drama-api";
import { ConflictNotice } from "./conflict-notice";
import type { EpisodeCtx } from "./context";
import { ContinuityEditor } from "./shot-continuity";
import { DialogueEditor } from "./shot-dialogue";
import { Field, entityOptions } from "./shot-field";

type Props = { ctx: EpisodeCtx; shot: DramaShot; index: number; onDirty: (dirty: boolean) => void };


/** The whole shot, edited in place under its row. One save writes every field. */
export function ShotEditor({ ctx, shot, index, onDirty }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const terms = (list: readonly { name: string }[]) => list.map((item) => ({ value: item.name, label: t(item.name) }));
    const entities = ctx.snapshot.entities;
    const [draft, setDraft] = useState<ShotDraft>(() => toDraft(shot));
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const saved = useMemo(() => toDraft(shot), [shot]);
    const dirty = !sameDraft(draft, saved);

    // Follow the saved shot (a run, another tab) while the form is untouched; keep the user's edits otherwise.
    const lastSaved = useRef(saved);
    useEffect(() => {
        setDraft((current) => (sameDraft(current, lastSaved.current) ? saved : current));
        lastSaved.current = saved;
    }, [saved]);

    useEffect(() => onDirty(dirty), [dirty, onDirty]);
    useEffect(() => () => onDirty(false), [onDirty]);

    const patch = (next: Partial<ShotDraft>) => setDraft((current) => ({ ...current, ...next }));
    const cast = entities.filter((entity) => entity.kind === "character" && draft.entityIds.includes(entity.id));
    const cleared = (ids: string[]): Partial<ShotDraft> => {
        // A character who leaves the shot can no longer be holding anything in it.
        const gone = (id: string) => Boolean(id) && !ids.includes(id);
        return { entityIds: ids, props: draft.props.map((state) => ({ ...state, startHolder: gone(state.startHolder) ? "" : state.startHolder, endHolder: gone(state.endHolder) ? "" : state.endHolder })) };
    };

    const save = async () => {
        setSaving(true);
        try {
            await updateShot(shot.id, { rev: shot.rev, ...draft, dialogue: draft.dialogue.filter((line) => line.text.trim()) });
            setConflict(false);
            ctx.refresh();
            message.success(t("已保存"));
        } catch (error) {
            if (error instanceof DramaApiError && error.status === 409) {
                setConflict(true);
                ctx.refresh();
            } else message.error(error instanceof Error ? error.message : t("保存失败，请重试"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <div className="border-t border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-ghost)] px-4 py-4">
            {conflict ? (
                <div className="mb-3">
                    <ConflictNotice message="这一镜刚在别处被修改过" onReload={() => { setDraft(saved); setConflict(false); }} onKeep={() => setConflict(false)} />
                </div>
            ) : null}
            <div className="grid gap-x-6 gap-y-4 lg:grid-cols-2">
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-3 gap-3">
                        <Field label="秒数" hint="1–15">
                            <InputNumber className="w-full" min={1} max={15} precision={0} value={draft.seconds} onChange={(value) => patch({ seconds: value ?? 5 })} />
                        </Field>
                        <Field label="景别">
                            <AutoComplete className="w-full" options={terms(SHOT_SIZES)} maxLength={20} value={draft.size} onChange={(size) => patch({ size })} />
                        </Field>
                        <Field label="运镜">
                            <AutoComplete className="w-full" options={terms(CAMERA_MOVES)} maxLength={40} value={draft.camera} onChange={(camera) => patch({ camera })} />
                        </Field>
                    </div>
                    <Field label="画面描述">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={2000} value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
                    </Field>
                    <Field label="对白">
                        <DialogueEditor
                            lines={draft.dialogue}
                            characters={entities}
                            onChange={(dialogue) => patch({ dialogue })}
                            onSpeaker={(id) => !draft.entityIds.includes(id) && patch({ entityIds: [...draft.entityIds, id] })}
                        />
                    </Field>
                    <Field label="旁白">
                        <Input.TextArea autoSize={{ minRows: 1, maxRows: 4 }} maxLength={1000} value={draft.narration} onChange={(event) => patch({ narration: event.target.value })} />
                    </Field>
                    <Field label="出场设定">
                        <Select
                            mode="multiple"
                            className="w-full"
                            showSearch={{ optionFilterProp: "label" }}
                            value={draft.entityIds}
                            onChange={(ids) => patch(cleared(ids))}
                            options={(["character", "scene", "prop"] as const).map((kind) => ({ label: t(ENTITY_KIND_LABELS[kind]), options: entityOptions(entities, [kind]) })).filter((group) => group.options.length)}
                            placeholder={t("选择出场的人物、场景和道具")}
                        />
                    </Field>
                </div>
                <div className="flex flex-col gap-3">
                    <ContinuityEditor draft={draft} entities={entities} cast={cast} isFirst={index === 0} onChange={(next) => patch(next)} />
                    <Field label="画面提示词" hint="只写开拍这一瞬间">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} value={draft.imagePrompt} onChange={(event) => patch({ imagePrompt: event.target.value })} />
                    </Field>
                    <Field label="视频提示词" hint="开始 → 动作 → 结束">
                        <Input.TextArea autoSize={{ minRows: 2, maxRows: 6 }} maxLength={4000} value={draft.videoPrompt} onChange={(event) => patch({ videoPrompt: event.target.value })} />
                    </Field>
                </div>
            </div>
            <div className="mt-4 flex items-center gap-2">
                <button type="button" className="wg-primary-button !min-h-9" disabled={!dirty || saving} onClick={() => void save()}>
                    {saving ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("保存")}
                </button>
                <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={!dirty || saving} onClick={() => setDraft(saved)}>
                    {t("还原")}
                </button>
                {dirty ? <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("有没保存的修改")}</span> : null}
            </div>
        </div>
    );
}
