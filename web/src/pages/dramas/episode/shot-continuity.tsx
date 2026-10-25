import { Input, InputNumber, Segmented, Select, Switch } from "antd";
import { Plus, X } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { TRANSITION_LABELS } from "@/lib/drama/labels";
import type { DramaEntity, PropState, ShotTransition } from "@/lib/drama/types";
import { Field, entityOptions, type ShotDraft } from "./shot-field";

type Props = {
    draft: ShotDraft;
    entities: readonly DramaEntity[];
    /** Characters in this shot's cast; only they can hold things. */
    cast: readonly DramaEntity[];
    isFirst: boolean;
    onChange: (patch: Partial<ShotDraft>) => void;
};

/** How this shot joins the previous one: transition, start and end state, and each prop's state. */
export function ContinuityEditor({ draft, entities, cast, isFirst, onChange }: Props) {
    const { t } = useAppTranslation();
    const props = entities.filter((entity) => entity.kind === "prop");
    const used = new Set(draft.props.map((state) => state.entityId));
    const holders = (current: string) => [{ value: "", label: t("无人") }, ...entityOptions(cast, ["character"]), ...(current && !cast.some((entity) => entity.id === current) ? [{ value: current, label: entities.find((entity) => entity.id === current)?.name ?? current }] : [])];

    const setProp = (index: number, patch: Partial<PropState>) => onChange({ props: draft.props.map((state, at) => (at === index ? { ...state, ...patch } : state)) });
    const addProp = () => {
        const next = props.find((entity) => !used.has(entity.id));
        if (!next) return;
        onChange({
            props: [...draft.props, { entityId: next.id, quantity: 1, startVisible: true, endVisible: true, startHolder: "", endHolder: "", note: "" }],
            entityIds: draft.entityIds.includes(next.id) ? draft.entityIds : [...draft.entityIds, next.id],
        });
    };

    return (
        <div className="flex flex-col gap-3">
            <Field label="与上一镜的衔接">
                <Segmented
                    size="small"
                    value={draft.transition}
                    onChange={(value) => onChange({ transition: value as ShotTransition })}
                    options={(Object.keys(TRANSITION_LABELS) as ShotTransition[]).map((value) => ({ value, label: t(TRANSITION_LABELS[value]), disabled: isFirst && value === "continuous" }))}
                />
            </Field>
            <div className="grid grid-cols-2 gap-3">
                <Field label="开拍状态">
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} value={draft.startState} onChange={(event) => onChange({ startState: event.target.value })} placeholder={t("人物站位、姿态、手里拿着什么")} />
                </Field>
                <Field label="结束状态">
                    <Input.TextArea autoSize={{ minRows: 2, maxRows: 5 }} maxLength={1000} value={draft.endState} onChange={(event) => onChange({ endState: event.target.value })} placeholder={t("镜头结束时的同类状态")} />
                </Field>
            </div>
            <Field label="道具状态">
                <div className="flex flex-col gap-2">
                    {draft.props.map((state, index) => (
                        <div key={index} className="flex flex-col gap-2 rounded-lg border border-[color:var(--wg-home-line)] p-2">
                            <div className="flex items-center gap-2">
                                <Select
                                    className="min-w-0 flex-1"
                                    size="small"
                                    value={state.entityId}
                                    options={entityOptions(props, ["prop"]).map((option) => ({ ...option, disabled: option.value !== state.entityId && used.has(option.value) }))}
                                    onChange={(entityId) => setProp(index, { entityId })}
                                    aria-label={t("道具")}
                                />
                                <InputNumber className="w-16" size="small" min={0} max={99} precision={0} value={state.quantity} onChange={(value) => setProp(index, { quantity: value ?? 1 })} aria-label={t("数量")} />
                                <label className="flex items-center gap-1 text-[11px] text-[color:var(--wg-home-muted)]">
                                    <Switch size="small" checked={state.startVisible} onChange={(startVisible) => setProp(index, { startVisible })} />
                                    {t("开拍可见")}
                                </label>
                                <label className="flex items-center gap-1 text-[11px] text-[color:var(--wg-home-muted)]">
                                    <Switch size="small" checked={state.endVisible} onChange={(endVisible) => setProp(index, { endVisible })} />
                                    {t("结束可见")}
                                </label>
                                <button type="button" className="wg-icon-button !size-7 shrink-0" title={t("删除这项")} aria-label={t("删除这项")} onClick={() => onChange({ props: draft.props.filter((_, at) => at !== index) })}>
                                    <X strokeWidth={1.6} />
                                </button>
                            </div>
                            <div className="flex items-center gap-2">
                                <Select className="w-28 shrink-0" size="small" value={state.startHolder} options={holders(state.startHolder)} onChange={(startHolder) => setProp(index, { startHolder })} aria-label={t("开拍时谁拿着")} prefix={<span className="text-[11px] text-[color:var(--wg-home-muted)]">{t("开拍")}</span>} />
                                <Select className="w-28 shrink-0" size="small" value={state.endHolder} options={holders(state.endHolder)} onChange={(endHolder) => setProp(index, { endHolder })} aria-label={t("结束时谁拿着")} prefix={<span className="text-[11px] text-[color:var(--wg-home-muted)]">{t("结束")}</span>} />
                                <Input className="min-w-0 flex-1" size="small" maxLength={300} value={state.note} onChange={(event) => setProp(index, { note: event.target.value })} placeholder={t("备注，如“从桌上被拿起”")} aria-label={t("备注")} />
                            </div>
                        </div>
                    ))}
                    <button type="button" className="wg-text-button !h-7 self-start" disabled={!props.some((entity) => !used.has(entity.id))} onClick={addProp}>
                        <Plus className="size-3.5" strokeWidth={1.6} />
                        {t("添加道具")}
                    </button>
                </div>
            </Field>
        </div>
    );
}
