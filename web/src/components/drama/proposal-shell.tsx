/**
 * ProposalShell — the one review frame for every AI result (chapter, settings, episodes, script, shots, review report).
 *
 * Props: `ProposalShell({ run, title, onAdopted?, children, confirmAdopt? })`
 *   run: DramaRun                    the run to show (a snapshot summary is enough; the full result is loaded here)
 *   title: string                    Chinese source text, e.g. "第 3 章草稿"
 *   children(proposal: RunProposal)  renders the result body; it scrolls inside the frame. Called only when a result exists.
 *   confirmAdopt?: string            if set, 采用 first asks this question (e.g. "会替换已有的 12 个镜头，继续吗？")
 *   onAdopted?()                     after the run was adopted and the drama/episode queries were refreshed
 * States: running (live text + 停止) / review (body + 采用 · 放弃 · 修订) / failed or stopped (message + 重试) / accepted or rejected (read-only, collapsed).
 * Review-stage runs are reports: no 采用 and no 修订 footer. The frame is a flex column; give it a bounded height (h-full / max-h-*) in the parent.
 * Needs the :id route param (drama id) to start revisions and retries.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Alert, Input } from "antd";
import { ChevronDown, Loader2, RotateCcw, Square } from "lucide-react";
import { useState, type ReactNode } from "react";
import { useParams } from "react-router-dom";

import { LiveText } from "@/components/drama/live-text";
import { StatusTag } from "@/components/drama/status-tag";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDrama, useStartRun } from "@/hooks/use-drama";
import { useDramaRunActions } from "@/hooks/use-drama-run-actions";
import { useNow } from "@/hooks/use-now";
import { formatClock, formatElapsed } from "@/lib/drama/format";
import type { DramaRun, RunProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { adoptRun, getRun, rejectRun } from "@/services/drama-api";

type Props = { run: DramaRun; title: string; onAdopted?: () => void; children: (proposal: RunProposal) => ReactNode; confirmAdopt?: string };

export function ProposalShell({ run, title, onAdopted, children, confirmAdopt }: Props) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const { id: dramaId } = useParams();
    const client = useQueryClient();
    const { data: snapshot } = useDrama(dramaId);
    const startRun = useStartRun();
    const { stop, refresh } = useDramaRunActions(dramaId);
    const [busy, setBusy] = useState<"adopt" | "reject" | "revise" | "retry" | null>(null);
    const [feedback, setFeedback] = useState("");
    const [expanded, setExpanded] = useState(false);

    const settled = run.status === "accepted" || run.status === "rejected";
    const wantsBody = run.status === "review" || (settled && expanded);
    const full = useQuery({ queryKey: ["drama-run", run.id], queryFn: () => getRun(run.id), enabled: wantsBody });
    const now = useNow(run.status === "running");
    const isReport = run.stage === "review";

    const guard = async (kind: NonNullable<typeof busy>, action: () => Promise<unknown>) => {
        setBusy(kind);
        try {
            await action();
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("操作没有成功，请重试"));
        } finally {
            setBusy(null);
        }
    };
    const adopt = () =>
        guard("adopt", async () => {
            await adoptRun(run.id);
            refresh(run);
            await client.invalidateQueries({ queryKey: ["drama-run", run.id] });
            onAdopted?.();
        });
    const askAdopt = () => (confirmAdopt ? modal.confirm({ title: t(confirmAdopt), okText: t("采用"), cancelText: t("取消"), onOk: adopt }) : void adopt());
    const reject = () =>
        guard("reject", async () => {
            await rejectRun(run.id);
            refresh(run);
        });
    const rerun = (kind: "revise" | "retry") =>
        guard(kind, async () => {
            if (!snapshot) throw new Error(t("剧目还没有加载完成"));
            await startRun({ snapshot, stage: run.stage, scope: run.scope, episodeId: run.episodeId ?? undefined, model: run.model || undefined, ...(kind === "revise" ? { parentId: run.id, instruction: feedback } : { instruction: run.instruction }) });
            setFeedback("");
        });

    const header = (
        <header className="flex min-h-12 items-center gap-3 border-b border-[color:var(--wg-home-line)] px-4 py-2.5">
            <h3 className="min-w-0 flex-1 truncate text-[14px] font-semibold">{title}</h3>
            <StatusTag status={run.status} />
            <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{run.status === "running" ? t("已用时 {time}", { time: formatElapsed(now - run.createdAt) }) : formatClock(run.finishedAt ?? run.createdAt)}</span>
            {run.status === "running" ? (
                <button type="button" className="wg-text-button" onClick={() => void stop(run)}>
                    <Square className="size-3" fill="currentColor" strokeWidth={0} />
                    {t("停止")}
                </button>
            ) : null}
            {settled ? (
                <button type="button" className="wg-icon-button !size-7" aria-expanded={expanded} aria-label={t(expanded ? "收起内容" : "查看内容")} onClick={() => setExpanded((value) => !value)}>
                    <ChevronDown className={cn("!size-4 transition-transform", expanded && "rotate-180")} strokeWidth={1.6} />
                </button>
            ) : null}
        </header>
    );

    let body: ReactNode = null;
    if (run.status === "running") body = <LiveText runId={run.id} className="p-4" />;
    else if (run.status === "failed" || run.status === "stopped") body = <FailureNotice run={run} busy={busy === "retry"} onRetry={() => void rerun("retry")} />;
    else if (wantsBody) body = full.isError ? <Alert type="error" showIcon className="m-4" title={t("结果没能加载")} action={<button type="button" className="wg-text-button" onClick={() => void full.refetch()}>{t("重试")}</button>} /> : full.data?.proposal ? children(full.data.proposal) : <Loading />;

    const showFooter = run.status === "review" && !isReport;
    return (
        <section className="flex min-h-0 flex-col overflow-hidden rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)]">
            {header}
            {body ? <div className="thin-scrollbar min-h-0 flex-1 overflow-auto">{body}</div> : null}
            {showFooter ? (
                <footer className="flex flex-wrap items-center gap-2 border-t border-[color:var(--wg-home-line)] px-4 py-3">
                    <button type="button" className="wg-primary-button !min-h-9" disabled={busy !== null || !full.data?.proposal} onClick={askAdopt}>
                        {busy === "adopt" ? <Loader2 className="size-4 animate-spin" /> : null}
                        {t("采用")}
                    </button>
                    <button type="button" className="wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]" disabled={busy !== null} onClick={() => void reject()}>
                        {t("放弃")}
                    </button>
                    <div className="ml-auto flex min-w-60 flex-1 items-center gap-2 sm:max-w-md">
                        <Input value={feedback} onChange={(event) => setFeedback(event.target.value)} onPressEnter={() => feedback.trim() && void rerun("revise")} placeholder={t("有什么想修改的？")} disabled={busy !== null} />
                        <button type="button" className="wg-text-button !h-8 shrink-0 !border !border-[color:var(--wg-home-line)]" disabled={busy !== null || !feedback.trim()} onClick={() => void rerun("revise")}>
                            {busy === "revise" ? <Loader2 className="size-4 animate-spin" /> : null}
                            {t("修订")}
                        </button>
                    </div>
                </footer>
            ) : null}
        </section>
    );
}

const Loading = () => (
    <div className="flex items-center justify-center py-10 text-[color:var(--wg-home-muted)]">
        <Loader2 className="size-5 animate-spin" />
    </div>
);

function FailureNotice({ run, busy, onRetry }: { run: DramaRun; busy: boolean; onRetry: () => void }) {
    const { t } = useAppTranslation();
    return (
        <div className="p-4">
            <Alert
                type={run.status === "failed" ? "error" : "info"}
                showIcon
                title={run.status === "failed" ? run.error || t("任务没有完成，请重试") : t("任务已停止")}
                action={
                    <button type="button" className="wg-text-button !border !border-[color:var(--wg-home-line)]" disabled={busy} onClick={onRetry}>
                        {busy ? <Loader2 className="size-3.5 animate-spin" /> : <RotateCcw className="size-3.5" strokeWidth={1.6} />}
                        {t("重试")}
                    </button>
                }
            />
        </div>
    );
}
