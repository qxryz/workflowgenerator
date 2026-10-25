/**
 * LiveText — streamed model output of a run started in this tab.
 *
 * Props: `LiveText({ runId, collapsible?, defaultOpen?, className? })`. Renders nothing about the run itself,
 * only the phase line and the text. A run no tab streams (a reload cut it off) shows a short notice until it is marked stopped.
 */
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";
import { useDramaRuns } from "@/stores/use-drama-runs";

const PHASES = { requesting: "正在写作", correcting: "按问题修正中", saving: "正在检查结果" } as const;

type Props = { runId: string; collapsible?: boolean; defaultOpen?: boolean; className?: string };

export function LiveText({ runId, collapsible = false, defaultOpen = true, className }: Props) {
    const { t } = useAppTranslation();
    const live = useDramaRuns((state) => state.runs[runId]);
    const [open, setOpen] = useState(defaultOpen);
    const box = useRef<HTMLDivElement>(null);
    useEffect(() => {
        if (box.current) box.current.scrollTop = box.current.scrollHeight;
    }, [live?.text, open]);

    const phase = live ? t(PHASES[live.phase]) : t("正在确认任务状态…");
    return (
        <div className={className}>
            {collapsible ? (
                <button type="button" className="flex items-center gap-1 text-[12px] text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]" onClick={() => setOpen((value) => !value)} aria-expanded={open}>
                    <ChevronDown className={cn("size-3.5 transition-transform", !open && "-rotate-90")} strokeWidth={1.8} />
                    {open ? t("收起输出") : t("查看输出")}
                </button>
            ) : live ? (
                <p className="mb-2 text-[12px] text-[color:var(--wg-home-muted)]">{phase}…</p>
            ) : null}
            {open ? (
                <div ref={box} className="thin-scrollbar mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-[color:var(--wg-home-ghost)] px-3.5 py-3 text-[13px] leading-7 text-[color:var(--wg-home-text)]">
                    {live?.text || <span className="text-[color:var(--wg-home-muted)]">{live ? t("等待模型开始输出") : phase}</span>}
                </div>
            ) : null}
        </div>
    );
}
