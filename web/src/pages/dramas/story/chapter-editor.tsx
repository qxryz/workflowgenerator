import { useQueryClient } from "@tanstack/react-query";
import { App, Alert } from "antd";
import { Loader2 } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";

import { AutoTextarea } from "@/components/drama/auto-textarea";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, useDramaMutation } from "@/hooks/use-drama";
import { countChars, isConflict } from "@/lib/drama/story";
import type { DramaChapter } from "@/lib/drama/types";
import { updateChapter } from "@/services/drama-api";
import { ChapterFrame } from "./chapter-frame";
import { ChapterInfo } from "./chapter-info";
import { PROSE_BODY, PROSE_FIELD_STYLE, PROSE_TITLE_STYLE, READING_COLUMN } from "./prose";

type Props = { dramaId: string; chapter: DramaChapter; meta: ReactNode; onDone: () => void };

export function ChapterEditor({ dramaId, chapter, meta, onDone }: Props) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const client = useQueryClient();
    const [draft, setDraft] = useState({ title: chapter.title, body: chapter.body, summary: chapter.summary, endState: chapter.endState });
    const [conflict, setConflict] = useState(false);
    const dirty = draft.title !== chapter.title || draft.body !== chapter.body || draft.summary !== chapter.summary || draft.endState !== chapter.endState;
    const save = useDramaMutation(() => updateChapter(chapter.id, { rev: chapter.rev, ...draft, title: draft.title.trim() }), [dramaKey(dramaId)]);

    const submit = () => {
        if (!draft.title.trim()) return void message.warning(t("章节需要一个标题"));
        save.mutate(undefined, {
            onSuccess: onDone,
            onError: (error) => (isConflict(error) ? setConflict(true) : void message.error(error instanceof Error ? error.message : t("保存失败，请重试"))),
        });
    };
    const cancel = () => (dirty ? modal.confirm({ title: t("放弃还没保存的修改？"), okText: t("放弃修改"), cancelText: t("继续编辑"), okButtonProps: { danger: true }, onOk: onDone }) : onDone());
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
                event.preventDefault();
                if (dirty && !save.isPending && !conflict) submit();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    });

    const actions = (
        <>
            <span className="mr-1 text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("{count} 字", { count: countChars(draft.body) })}</span>
            <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line)]" disabled={save.isPending} onClick={cancel}>
                {t("取消")}
            </button>
            <button type="button" className="wg-primary-button !min-h-8 !px-3.5" disabled={!dirty || save.isPending || conflict} onClick={submit}>
                {save.isPending ? <Loader2 className="size-4 animate-spin" /> : null}
                {t("保存")}
            </button>
        </>
    );
    return (
        <ChapterFrame meta={meta} actions={actions}>
            <div className={`${READING_COLUMN} pb-24 pt-8`}>
                {conflict ? (
                    <div className="mb-5">
                        <Alert
                            type="warning"
                            showIcon
                            title={t("内容已在别处修改")}
                            description={t("为避免覆盖，这次修改没有保存。重新载入后可以接着编辑。")}
                            action={
                                <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" onClick={() => void client.invalidateQueries({ queryKey: dramaKey(dramaId) }).then(onDone)}>
                                    {t("重新载入")}
                                </button>
                            }
                        />
                    </div>
                ) : null}
                <input
                    value={draft.title}
                    maxLength={120}
                    placeholder={t("章节标题")}
                    aria-label={t("章节标题")}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    className="w-full border-0 border-b border-transparent bg-transparent pb-1 text-[26px] font-semibold leading-snug tracking-tight outline-none transition-colors focus:border-[color:var(--wg-home-line-strong)]"
                    style={PROSE_TITLE_STYLE}
                />
                <ChapterInfo summary={draft.summary} endState={draft.endState} editing onChange={(patch) => setDraft({ ...draft, ...patch })} />
                <AutoTextarea
                    minRows={12}
                    autoFocus
                    value={draft.body}
                    placeholder={t("在这里写正文，段落之间空一行")}
                    aria-label={t("正文")}
                    onChange={(event) => setDraft({ ...draft, body: event.target.value })}
                    className={`${PROSE_BODY} block w-full border-0 bg-transparent p-0 outline-none`}
                    style={PROSE_FIELD_STYLE}
                />
            </div>
        </ChapterFrame>
    );
}
