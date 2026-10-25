import { App } from "antd";
import { FileUp, Loader2 } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { AutoTextarea } from "@/components/drama/auto-textarea";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey } from "@/hooks/use-drama";
import { useQueryClient } from "@tanstack/react-query";
import { splitChapters } from "@/lib/drama/import-text";
import { nextChapterOrd } from "@/lib/drama/story";
import type { DramaSnapshot } from "@/lib/drama/types";
import { createChapter } from "@/services/drama-api";
import { ChapterFrame } from "./chapter-frame";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const PREVIEW_ROWS = 6;

type Props = { snapshot: DramaSnapshot; /** Cancel is offered only when there is something to go back to. */ onCancel?: () => void; onDone: (firstOrd: number) => void };

/** Paste or open more text; it is split by chapter headings and appended after the existing chapters. */
export function ImportPanel({ snapshot, onCancel, onDone }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const client = useQueryClient();
    const file = useRef<HTMLInputElement>(null);
    const [text, setText] = useState("");
    const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
    const chapters = useMemo(() => (text.trim() ? splitChapters(text, snapshot.project.sourceType) : []), [text, snapshot.project.sourceType]);

    const readFile = (selected: File | undefined) => {
        if (!selected) return;
        if (selected.size > MAX_IMPORT_BYTES) return void message.error(t("文件太大，请控制在 8 MB 以内"));
        const reader = new FileReader();
        reader.onload = () => setText(String(reader.result ?? ""));
        reader.onerror = () => message.error(t("文件读取失败"));
        reader.readAsText(selected);
    };
    const submit = async () => {
        const first = nextChapterOrd(snapshot.chapters);
        setProgress({ done: 0, total: chapters.length });
        try {
            for (const [index, chapter] of chapters.entries()) {
                await createChapter(snapshot.project.id, { title: chapter.title.slice(0, 120), body: chapter.body });
                setProgress({ done: index + 1, total: chapters.length });
            }
            await client.invalidateQueries({ queryKey: dramaKey(snapshot.project.id) });
            setText("");
            onDone(first);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("添加失败，请重试"));
            await client.invalidateQueries({ queryKey: dramaKey(snapshot.project.id) });
        } finally {
            setProgress(null);
        }
    };

    const busy = progress !== null;
    return (
        <ChapterFrame meta={<span className="font-medium text-[color:var(--wg-home-text)]">{t(snapshot.chapters.length ? "追加章节" : "导入章节")}</span>}>
            <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 px-8 py-8">
                <p className="mb-0 text-[13px] leading-6 text-[color:var(--wg-home-muted)]">{t("粘贴正文，或打开文件；会按章节标题自动切分，加在现有章节之后。")}</p>
                <AutoTextarea
                    minRows={10}
                    value={text}
                    disabled={busy}
                    onChange={(event) => setText(event.target.value)}
                    placeholder={t("在这里粘贴正文")}
                    aria-label={t("章节正文")}
                    className="block max-h-[50vh] min-h-56 w-full overflow-auto rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-4 py-3 text-[14px] leading-7 outline-none focus:border-[color:var(--wg-home-accent)]"
                    style={{ overflow: "auto" }}
                />
                {chapters.length ? (
                    <div className="rounded-xl border border-[color:var(--wg-home-line)] px-4 py-3 text-[13px]">
                        <p className="mb-0 font-medium">{t("已识别 {count} 章", { count: chapters.length })}</p>
                        <ul className="mt-1.5 space-y-0.5 text-[color:var(--wg-home-muted)]">
                            {chapters.slice(0, PREVIEW_ROWS).map((chapter, index) => (
                                <li key={index} className="truncate">{chapter.title}</li>
                            ))}
                            {chapters.length > PREVIEW_ROWS ? <li>…</li> : null}
                        </ul>
                    </div>
                ) : null}
                <div className="flex items-center gap-2">
                    <button type="button" className="wg-primary-button" disabled={!chapters.length || busy} onClick={() => void submit()}>
                        {busy ? <Loader2 className="size-4 animate-spin" /> : null}
                        {progress ? t("正在添加 {done}/{total}", progress) : chapters.length ? t("添加 {count} 章", { count: chapters.length }) : t("添加")}
                    </button>
                    <button type="button" className="wg-text-button !h-10 !border !border-[color:var(--wg-home-line)]" disabled={busy} onClick={() => file.current?.click()}>
                        <FileUp className="size-4" strokeWidth={1.6} />
                        {t("打开文件")}
                    </button>
                    {onCancel ? <button type="button" className="wg-text-button !h-10" disabled={busy} onClick={onCancel}>{t("取消")}</button> : null}
                    <input ref={file} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = ""; }} />
                </div>
            </div>
        </ChapterFrame>
    );
}
