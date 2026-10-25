/**
 * StatusTag — the one status pill for runs and media.
 *
 * Props: `StatusTag({ status, stage? })` where status is a RunStatus ("running" | "review" | "accepted" | "rejected" | "failed" | "stopped")
 * or a media state ("generating" | "ready" | "adopted" | "stale" | "failed" | "none"). Labels come from lib/drama/labels.ts.
 * Pass the run's `stage` so a finished review report reads 已完成 instead of 已采用.
 */
import { useAppTranslation } from "@/hooks/use-app-translation";
import { MEDIA_STATE_LABELS, RUN_STATUS_LABELS, runStatusLabel } from "@/lib/drama/labels";
import type { RunStage, RunStatus } from "@/lib/drama/types";
import { cn } from "@/lib/utils";

export type StatusTagValue = RunStatus | "generating" | "ready" | "adopted" | "stale" | "none";
type Tone = "live" | "attention" | "done" | "quiet" | "danger";

const TONES: Record<StatusTagValue, [Tone, string]> = {
    running: ["live", RUN_STATUS_LABELS.running],
    review: ["attention", RUN_STATUS_LABELS.review],
    accepted: ["done", RUN_STATUS_LABELS.accepted],
    rejected: ["quiet", RUN_STATUS_LABELS.rejected],
    failed: ["danger", RUN_STATUS_LABELS.failed],
    stopped: ["quiet", RUN_STATUS_LABELS.stopped],
    generating: ["live", MEDIA_STATE_LABELS.pending],
    ready: ["attention", MEDIA_STATE_LABELS.ready],
    adopted: ["done", MEDIA_STATE_LABELS.adopted],
    stale: ["quiet", MEDIA_STATE_LABELS.stale],
    none: ["quiet", MEDIA_STATE_LABELS.none],
};

const TONE_CLASS: Record<Tone, string> = {
    live: "border-[color:var(--wg-home-accent)]/40 bg-[color:var(--wg-home-accent)]/10 text-[color:var(--wg-home-accent)]",
    attention: "border-[color:var(--wg-home-accent)] bg-[color:var(--wg-home-accent)] text-[color:var(--wg-home-accent-text)]",
    done: "border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-home-hover)] text-[color:var(--wg-home-text)]",
    quiet: "border-[color:var(--wg-home-line)] text-[color:var(--wg-home-muted)]",
    danger: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function StatusTag({ status, stage, className }: { status: StatusTagValue; stage?: RunStage; className?: string }) {
    const { t } = useAppTranslation();
    const [tone, fixed] = TONES[status];
    const label = status in RUN_STATUS_LABELS ? runStatusLabel(status as RunStatus, stage) : fixed;
    return (
        <span className={cn("inline-flex h-5 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-2 text-[11px] font-medium leading-none", TONE_CLASS[tone], status === "stale" && "border-dashed", className)}>
            {tone === "live" ? <span className="size-1.5 animate-pulse rounded-full bg-current" /> : null}
            {t(label)}
        </span>
    );
}
