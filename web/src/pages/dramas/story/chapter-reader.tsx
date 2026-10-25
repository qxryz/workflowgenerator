import { Alert, App, Dropdown } from "antd";
import { Loader2, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import type { ReactNode } from "react";

import { StartTaskButton } from "@/components/drama/start-task-button";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, useChapter, useDramaMutation } from "@/hooks/use-drama";
import type { DramaChapter, DramaSnapshot } from "@/lib/drama/types";
import { deleteChapter } from "@/services/drama-api";
import { ChapterFrame } from "./chapter-frame";
import { ChapterInfo } from "./chapter-info";
import { Prose, ProseTitle, READING_COLUMN } from "./prose";

type Props = { snapshot: DramaSnapshot; chapter: DramaChapter; meta: ReactNode; extra?: ReactNode; bar?: ReactNode; strip?: ReactNode; onEdit: () => void; onRewrite: () => void; onDeleted: () => void };

export function ChapterReader({ snapshot, chapter, meta, extra, bar, strip, onEdit, onRewrite, onDeleted }: Props) {
    const { t } = useAppTranslation();
    const { modal } = App.useApp();
    const full = useChapter(chapter.id);
    const remove = useDramaMutation(() => deleteChapter(chapter.id), [dramaKey(snapshot.project.id)]);
    const confirmDelete = () =>
        modal.confirm({
            title: t("删除「{title}」？", { title: chapter.title }),
            content: t("后面的章节会自动前移，无法恢复。"),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: () => remove.mutateAsync(undefined).then(onDeleted),
        });

    const actions = (
        <>
            {extra}
            <StartTaskButton snapshot={snapshot} stage="chapter" scope={{ ord: chapter.ord }} label="重写本章" onStarted={onRewrite} />
            <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" onClick={onEdit}>
                <Pencil className="size-3.5" strokeWidth={1.6} />
                {t("编辑")}
            </button>
            <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: [{ key: "delete", danger: true, icon: <Trash2 className="size-4" strokeWidth={1.6} />, label: t("删除本章"), onClick: confirmDelete }] }}>
                <button type="button" className="wg-icon-button !size-8" aria-label={t("更多操作")}>
                    <MoreHorizontal strokeWidth={1.6} />
                </button>
            </Dropdown>
        </>
    );
    return (
        <ChapterFrame meta={meta} actions={actions} bar={bar}>
            <article className={`${READING_COLUMN} pb-24 pt-8`}>
                {strip}
                <ProseTitle>{chapter.title}</ProseTitle>
                <ChapterInfo summary={chapter.summary} endState={chapter.endState} />
                {full.isError ? (
                    <Alert type="error" showIcon title={t("正文没能加载")} action={<button type="button" className="wg-text-button" onClick={() => void full.refetch()}>{t("重试")}</button>} />
                ) : !full.data ? (
                    <Loader2 className="mx-auto mt-10 size-5 animate-spin text-[color:var(--wg-home-muted)]" />
                ) : full.data.body.trim() ? (
                    <Prose body={full.data.body} />
                ) : (
                    <p className="mb-0 text-sm text-[color:var(--wg-home-muted)]">{t("这一章还没有正文，点「编辑」开始写。")}</p>
                )}
            </article>
        </ChapterFrame>
    );
}
