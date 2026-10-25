import { ChevronRight } from "lucide-react";
import { useState } from "react";

import { AutoTextarea } from "@/components/drama/auto-textarea";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";

type Props = { summary: string; endState: string; editing?: boolean; onChange?: (patch: { summary?: string; endState?: string }) => void };

const FIELD = "w-full rounded-lg border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-3 py-2 text-[13px] leading-6 outline-none focus:border-[color:var(--wg-home-accent)]";

/** 章节信息: the summary and end state the next chapter continues from. Collapsed by default. */
export function ChapterInfo({ summary, endState, editing = false, onChange }: Props) {
    const { t } = useAppTranslation();
    const [open, setOpen] = useState(false);
    const fields: Array<[string, "summary" | "endState", string, string]> = [
        ["摘要", "summary", summary, "这一章发生了什么（150 字内）"],
        ["章末状态", "endState", endState, "章末的时间、地点、人物位置与手里的东西，下一章从这里接着写"],
    ];
    return (
        <div className="my-5 border-y border-[color:var(--wg-home-line)] py-2.5">
            <button type="button" className="flex items-center gap-1.5 text-[12px] font-medium text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <ChevronRight className={cn("size-3.5 transition-transform", open && "rotate-90")} strokeWidth={1.8} />
                {t("章节信息")}
            </button>
            {open ? (
                <dl className="mt-3 space-y-4 pl-5">
                    {fields.map(([label, key, value, placeholder]) => (
                        <div key={key}>
                            <dt className="mb-1.5 text-[12px] text-[color:var(--wg-home-muted)]">{t(label)}</dt>
                            <dd>
                                {editing ? (
                                    <AutoTextarea minRows={2} value={value} className={FIELD} placeholder={t(placeholder)} onChange={(event) => onChange?.({ [key]: event.target.value })} />
                                ) : value ? (
                                    <p className="mb-0 whitespace-pre-wrap text-[13px] leading-6">{value}</p>
                                ) : (
                                    <p className="mb-0 text-[13px] text-[color:var(--wg-home-muted-strong)]">{t("还没有填写")}</p>
                                )}
                            </dd>
                        </div>
                    ))}
                </dl>
            ) : null}
        </div>
    );
}
