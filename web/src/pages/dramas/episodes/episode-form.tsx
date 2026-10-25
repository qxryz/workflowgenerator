import { App, Input, InputNumber, Select } from "antd";
import { Loader2 } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, useDramaMutation } from "@/hooks/use-drama";
import { chapterNo, isConflict } from "@/lib/drama/story";
import type { DramaEpisode, DramaSnapshot } from "@/lib/drama/types";
import { createEpisode, updateEpisode } from "@/services/drama-api";

type Props = { snapshot: DramaSnapshot; /** Absent when creating. */ episode?: DramaEpisode; onClose: () => void };

/** Edit an episode's card in place, or fill in a new one. */
export function EpisodeForm({ snapshot, episode, onClose }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const [draft, setDraft] = useState({ title: episode?.title ?? "", outline: episode?.outline ?? "", targetSeconds: episode?.targetSeconds ?? 90, sourceChapterIds: episode?.sourceChapterIds ?? [] });
    const set = (patch: Partial<typeof draft>) => setDraft((current) => ({ ...current, ...patch }));
    const save = useDramaMutation(
        () => {
            const body = { ...draft, title: draft.title.trim(), outline: draft.outline.trim() };
            return episode ? updateEpisode(episode.id, { rev: episode.rev, ...body }) : createEpisode(snapshot.project.id, body);
        },
        [dramaKey(snapshot.project.id)],
    );
    const submit = () =>
        save.mutate(undefined, {
            onSuccess: onClose,
            onError: (error) => void message.error(isConflict(error) ? t("内容已在别处修改，请刷新后再改") : error instanceof Error ? error.message : t("保存失败，请重试")),
        });

    return (
        <form className="flex flex-col gap-2.5 rounded-xl border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-panel)] p-4" onSubmit={(event) => { event.preventDefault(); if (draft.title.trim()) submit(); }}>
            <Input autoFocus maxLength={80} value={draft.title} onChange={(event) => set({ title: event.target.value })} placeholder={t("分集标题")} aria-label={t("分集标题")} />
            <Input.TextArea maxLength={6000} value={draft.outline} onChange={(event) => set({ outline: event.target.value })} autoSize={{ minRows: 3, maxRows: 8 }} placeholder={t("梗概：开场、冲突、结尾的钩子")} aria-label={t("梗概")} />
            <div className="flex items-center gap-2 text-[12px] text-[color:var(--wg-home-muted)]">
                <span className="shrink-0">{t("目标时长")}</span>
                <InputNumber min={5} max={1800} precision={0} value={draft.targetSeconds} onChange={(value) => set({ targetSeconds: value ?? 90 })} suffix={t("秒")} className="w-28" aria-label={t("目标时长")} />
            </div>
            <Select
                mode="multiple"
                value={draft.sourceChapterIds}
                onChange={(ids: string[]) => set({ sourceChapterIds: ids })}
                optionLabelProp="short"
                maxTagCount="responsive"
                placeholder={t("来源章节")}
                aria-label={t("来源章节")}
                options={snapshot.chapters.map((chapter) => ({ value: chapter.id, label: `${chapterNo(chapter.ord, t)} ${chapter.title}`, short: chapterNo(chapter.ord, t) }))}
            />
            <div className="flex justify-end gap-2 pt-1">
                <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line)]" disabled={save.isPending} onClick={onClose}>{t("取消")}</button>
                <button type="submit" className="wg-primary-button !min-h-8 !px-3.5" disabled={!draft.title.trim() || save.isPending}>
                    {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                    {t("保存")}
                </button>
            </div>
        </form>
    );
}
