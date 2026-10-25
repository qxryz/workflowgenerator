/**
 * StartTaskButton — starts an AI text run for one stage.
 *
 * Props: `StartTaskButton({ snapshot, stage, scope?, episodeId?, label, icon?, variant?, disabled?, disabledReason?, onStarted? })`
 *   snapshot: DramaSnapshot            current drama (its runs decide whether this stage+scope is already running)
 *   stage: RunStage, scope?: RunScope  empty scope matches any run of the stage (e.g. "写下一章")
 *   episodeId?: string                 for script / shots runs
 *   label: string                      Chinese source text, translated here
 *   icon?: LucideIcon                  default Sparkles
 *   variant?: "primary" | "default"    primary = filled with a soft ring (use for the one main entry of a section)
 *   disabled? / disabledReason?        reason shows as a tooltip (with optional disabledValues for {placeholders})
 *   onStarted?(run: DramaRun)          called once the run exists; the model keeps working in the background
 * Click starts at once with the default text model. The attached chevron opens extra instructions + a model choice.
 * While a run of the same stage and scope is live it shows "运行中 · mm:ss" and 停止 (runs of other scopes do not block it).
 * Failures (409, no model) surface as message.error.
 */
import { ChevronDown, Loader2, Sparkles, Square, type LucideIcon } from "lucide-react";
import { Input, Popover, Tooltip } from "antd";
import { useState } from "react";

import { ModelPicker } from "@/components/model-picker";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDramaRunActions } from "@/hooks/use-drama-run-actions";
import { useStartTask } from "@/hooks/use-start-task";
import { useNow } from "@/hooks/use-now";
import { formatElapsed } from "@/lib/drama/format";
import { sameScope } from "@/lib/drama/stage-runs";
import type { DramaRun, DramaSnapshot, RunScope, RunStage } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { useConfigStore } from "@/stores/use-config-store";

type Props = {
    snapshot: DramaSnapshot;
    stage: RunStage;
    scope?: RunScope;
    episodeId?: string;
    label: string;
    icon?: LucideIcon;
    variant?: "primary" | "default";
    disabled?: boolean;
    /** Chinese source text; {placeholders} are filled from `disabledValues`. */
    disabledReason?: string;
    disabledValues?: Record<string, string | number>;
    onStarted?: (run: DramaRun) => void;
};

const RING = "shadow-[0_0_0_3px_color-mix(in_srgb,var(--wg-home-text)_12%,transparent)]";

export function StartTaskButton({ snapshot, stage, scope, episodeId, label, icon: Icon = Sparkles, variant = "default", disabled, disabledReason, disabledValues, onStarted }: Props) {
    const { t } = useAppTranslation();
    const config = useConfigStore((state) => state.config);
    const { start: startTask, pending } = useStartTask();
    const { stop } = useDramaRunActions(snapshot.project.id);
    const [open, setOpen] = useState(false);
    const [instruction, setInstruction] = useState("");
    const [model, setModel] = useState("");

    const live = snapshot.runs.find((run) => run.stage === stage && run.status === "running" && sameScope(run, scope, episodeId));
    const now = useNow(Boolean(live));
    const primary = variant === "primary";

    const start = async (extra?: { instruction: string; model: string }) => {
        const run = await startTask({ snapshot, stage, scope, episodeId, instruction: extra?.instruction, model: extra?.model || undefined });
        if (!run) return;
        setOpen(false);
        setInstruction("");
        onStarted?.(run);
    };

    const frame = cn("inline-flex h-9 items-center overflow-hidden rounded-lg text-[13px] font-medium", primary ? cn("bg-[color:var(--wg-home-text)] text-[color:var(--wg-panel)]", RING) : "border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-panel)] text-[color:var(--wg-home-text)]");
    const part = "inline-flex h-full items-center justify-center gap-2 transition disabled:cursor-default disabled:opacity-40 " + (primary ? "hover:opacity-85" : "hover:bg-[color:var(--wg-home-hover)]");

    if (live) {
        return (
            <span className={cn(frame, primary && "bg-transparent text-[color:var(--wg-home-text)] shadow-none", "border border-[color:var(--wg-home-accent)]/50")}>
                <span className="inline-flex items-center gap-2 px-3.5 text-[color:var(--wg-home-accent)]">
                    <Loader2 className="size-4 animate-spin" strokeWidth={1.8} />
                    <span className="tabular-nums">{t("运行中 · {time}", { time: formatElapsed(now - live.createdAt) })}</span>
                </span>
                <button type="button" className={cn(part, "border-l border-[color:var(--wg-home-line)] px-3 text-[color:var(--wg-home-text)] hover:bg-[color:var(--wg-home-hover)]")} onClick={() => void stop(live)}>
                    <Square className="size-3" fill="currentColor" strokeWidth={0} />
                    {t("停止")}
                </button>
            </span>
        );
    }

    const blocked = disabled || pending;
    const panel = (
        <div className="flex w-72 flex-col gap-3" onKeyDown={(event) => event.stopPropagation()}>
            <div>
                <label className="mb-1.5 block text-[12px] text-[color:var(--wg-home-muted)]">{t("补充要求")}</label>
                <Input.TextArea value={instruction} onChange={(event) => setInstruction(event.target.value)} autoSize={{ minRows: 3, maxRows: 6 }} placeholder={t("比如：节奏再快一点，多写人物对话")} />
            </div>
            <div>
                <label className="mb-1.5 block text-[12px] text-[color:var(--wg-home-muted)]">{t("文本模型")}</label>
                <ModelPicker config={config} value={model || config.textModel} onChange={setModel} capability="text" fullWidth onMissingConfig={() => useConfigStore.getState().openConfigDialog(true, "channels")} />
            </div>
            <button type="button" className="wg-primary-button !min-h-9 !rounded-lg" disabled={pending} onClick={() => void start({ instruction, model })}>
                {t("开始")}
            </button>
        </div>
    );

    const button = (
        <span className={cn(frame, blocked && "opacity-70")}>
            <button type="button" className={cn(part, "px-3.5")} disabled={blocked} onClick={() => void start()}>
                {pending ? <Loader2 className="size-4 animate-spin" strokeWidth={1.8} /> : <Icon className="size-4" strokeWidth={1.6} />}
                {t(label)}
            </button>
            <Popover trigger="click" placement="bottomRight" open={open && !disabled} onOpenChange={setOpen} content={panel} arrow={false}>
                <button type="button" className={cn(part, "w-8 border-l", primary ? "border-[color:var(--wg-panel)]/25" : "border-[color:var(--wg-home-line)]")} disabled={blocked} aria-label={t("补充要求与模型")}>
                    <ChevronDown className="size-4" strokeWidth={1.6} />
                </button>
            </Popover>
        </span>
    );
    return disabled && disabledReason ? <Tooltip title={t(disabledReason, disabledValues)}>{button}</Tooltip> : button;
}
