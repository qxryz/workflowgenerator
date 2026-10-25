/**
 * CreateDramaModal — "新建剧目".
 *
 * Props: `CreateDramaModal({ open, onClose, onCreated })`; `onCreated(project)` fires after the server created the drama
 * (the library navigates to it). Novel / script sources are split into chapters locally, no model call.
 */
import { App, Input, Modal, Segmented } from "antd";
import { FileUp } from "lucide-react";
import { useMemo, useRef, useState, type ReactNode } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { splitChapters } from "@/lib/drama/import-text";
import type { DramaAspect, DramaProject, DramaSourceType } from "@/lib/drama/types";
import { createDrama } from "@/services/drama-api";

const MAX_IMPORT_BYTES = 8 * 1024 * 1024;
const SOURCES: Array<{ value: DramaSourceType; label: string }> = [
    { value: "original", label: "原创" },
    { value: "novel", label: "小说改编" },
    { value: "script", label: "已有剧本" },
];
const ASPECTS: DramaAspect[] = ["16:9", "9:16", "1:1"];

type Props = { open: boolean; onClose: () => void; onCreated: (project: DramaProject) => void };

export function CreateDramaModal({ open, onClose, onCreated }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const file = useRef<HTMLInputElement>(null);
    const [title, setTitle] = useState("");
    const [sourceType, setSourceType] = useState<DramaSourceType>("original");
    const [brief, setBrief] = useState("");
    const [text, setText] = useState("");
    const [aspect, setAspect] = useState<DramaAspect>("16:9");
    const [saving, setSaving] = useState(false);

    const imported = sourceType !== "original";
    const chapters = useMemo(() => (imported && text.trim() ? splitChapters(text, sourceType) : []), [imported, sourceType, text]);
    const ready = Boolean(title.trim()) && (!imported || chapters.length > 0);

    const reset = () => {
        setTitle("");
        setSourceType("original");
        setBrief("");
        setText("");
        setAspect("16:9");
    };
    const readFile = (selected: File | undefined) => {
        if (!selected) return;
        if (selected.size > MAX_IMPORT_BYTES) return void message.error(t("文件太大，请控制在 8 MB 以内"));
        const reader = new FileReader();
        reader.onload = () => {
            setText(String(reader.result ?? ""));
            if (!title.trim()) setTitle(selected.name.replace(/\.[^.]+$/, ""));
        };
        reader.onerror = () => message.error(t("文件读取失败"));
        reader.readAsText(selected);
    };
    const submit = async () => {
        setSaving(true);
        try {
            const project = await createDrama({ title: title.trim(), sourceType, brief: brief.trim(), aspect, ...(imported ? { chapters } : {}) });
            reset();
            onCreated(project);
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("创建失败，请重试"));
        } finally {
            setSaving(false);
        }
    };

    return (
        <Modal open={open} onCancel={onClose} title={t("新建剧目")} okText={t("创建")} cancelText={t("取消")} onOk={() => void submit()} okButtonProps={{ disabled: !ready, loading: saving }} width={560} destroyOnHidden={false}>
            <div className="flex flex-col gap-5 pt-3">
                <Field label="名称">
                    <Input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={60} placeholder={t("给剧目起个名字")} autoFocus />
                </Field>
                <Field label="来源">
                    <Segmented value={sourceType} onChange={setSourceType} options={SOURCES.map((item) => ({ value: item.value, label: t(item.label) }))} />
                </Field>
                <Field label={imported ? "简介" : "简介或创意"}>
                    <Input.TextArea value={brief} onChange={(event) => setBrief(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder={t(imported ? "一两句话说明这部剧讲什么（可留空）" : "写下你的故事构想：题材、主角、想要的氛围")} />
                </Field>
                {imported ? (
                    <Field label={sourceType === "novel" ? "小说正文" : "剧本正文"}>
                        <Input.TextArea value={text} onChange={(event) => setText(event.target.value)} autoSize={{ minRows: 5, maxRows: 8 }} placeholder={t("粘贴正文，或导入文件；会按章节标题自动切分")} />
                        <div className="mt-2 flex items-center justify-between text-[12px] text-[color:var(--wg-home-muted)]">
                            <button type="button" className="wg-text-button !h-7 !border !border-[color:var(--wg-home-line)]" onClick={() => file.current?.click()}>
                                <FileUp className="size-3.5" strokeWidth={1.6} />
                                {t("导入 .txt/.md 文件")}
                            </button>
                            <span aria-live="polite">{chapters.length ? t("已识别 {count} 章", { count: chapters.length }) : t("还没有正文")}</span>
                        </div>
                        <input ref={file} type="file" accept=".txt,.md,text/plain,text/markdown" className="hidden" onChange={(event) => { readFile(event.target.files?.[0]); event.target.value = ""; }} />
                    </Field>
                ) : null}
                <Field label="画幅">
                    <Segmented value={aspect} onChange={setAspect} options={ASPECTS} />
                </Field>
            </div>
        </Modal>
    );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
    const { t } = useAppTranslation();
    return (
        <div>
            <div className="mb-2 text-[13px] font-medium">{t(label)}</div>
            {children}
        </div>
    );
}
