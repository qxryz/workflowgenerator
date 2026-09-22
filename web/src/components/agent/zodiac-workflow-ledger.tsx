import { useState } from "react";
import { Button } from "antd";
import {
    CheckCircle2,
    Circle,
    CircleAlert,
    CircleMinus,
    Eye,
    LoaderCircle,
    PauseCircle,
    Play,
    RefreshCw,
    Square,
    type LucideIcon,
} from "lucide-react";

import { canvasThemes } from "@/lib/canvas-theme";
import type { WorkflowNodeRunRecord, WorkflowNodeStatus, WorkflowRunSnapshot } from "@/lib/canvas/workflow-execution";
import { useWorkflowRunStore } from "@/stores/canvas/use-workflow-run-store";
import { useThemeStore } from "@/stores/use-theme-store";

type LedgerAction = (nodeId: string) => unknown | Promise<unknown>;
type RunAction = () => unknown | Promise<unknown>;
type NodeLabelSource = Readonly<Record<string, string>> | ((nodeId: string, index: number) => string | undefined);

export type ZodiacWorkflowLedgerProps = {
    /** Omit to follow the active workflow run from the shared store. */
    snapshot?: WorkflowRunSnapshot<unknown> | null;
    /** Select a stored run instead of the active run. Ignored when snapshot is provided. */
    runId?: string;
    nodeLabels?: NodeLabelSource;
    className?: string;
    onInspectResult?: LedgerAction;
    onContinue?: LedgerAction;
    onRetry?: LedgerAction;
    onStop?: RunAction;
    onResume?: RunAction;
    onActionError?: (error: unknown) => void;
};

type PendingAction = { kind: "inspect" | "continue" | "retry" | "stop" | "resume"; nodeId?: string } | null;

const STATUS_PRESENTATION: Record<WorkflowNodeStatus, { label: string; detail: string; icon: LucideIcon; tone: string }> = {
    queued: { label: "即将开始", detail: "已进入运行队列", icon: Circle, tone: "text-current" },
    waiting_inputs: { label: "等待", detail: "等待上一步结果", icon: Circle, tone: "text-current" },
    running: { label: "进行中", detail: "正在生成", icon: LoaderCircle, tone: "text-[color:var(--wg-home-accent)]" },
    persisting: { label: "保存中", detail: "正在保存结果", icon: LoaderCircle, tone: "text-[color:var(--wg-home-accent)]" },
    waiting_review: { label: "待检查", detail: "结果已就绪", icon: Eye, tone: "text-[color:var(--wg-home-accent)]" },
    completed: { label: "已完成", detail: "结果已保存", icon: CheckCircle2, tone: "text-emerald-500" },
    error: { label: "失败", detail: "本步骤未完成", icon: CircleAlert, tone: "text-red-500" },
    stopped: { label: "已停止", detail: "可稍后继续", icon: PauseCircle, tone: "text-current" },
    blocked: { label: "等待处理", detail: "上一步未完成", icon: CircleMinus, tone: "text-amber-500" },
};

const RUN_STATUS_LABELS: Record<WorkflowRunSnapshot<unknown>["status"], string> = {
    idle: "准备运行",
    running: "正在运行",
    waiting_review: "等待检查结果",
    completed: "全部完成",
    error: "有步骤未完成",
    stopped: "已停止",
};

export function ZodiacWorkflowLedger({
    snapshot: suppliedSnapshot,
    runId,
    nodeLabels,
    className = "",
    onInspectResult,
    onContinue,
    onRetry,
    onStop,
    onResume,
    onActionError,
}: ZodiacWorkflowLedgerProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const storedSnapshot = useWorkflowRunStore((state) => {
        const selectedRunId = runId ?? state.activeRunId;
        return selectedRunId ? state.runs[selectedRunId] ?? null : null;
    });
    const snapshot = suppliedSnapshot === undefined ? storedSnapshot : suppliedSnapshot;
    const [pendingAction, setPendingAction] = useState<PendingAction>(null);

    const perform = async (action: NonNullable<LedgerAction | RunAction>, pending: NonNullable<PendingAction>, nodeId?: string) => {
        if (pendingAction) return;
        setPendingAction(pending);
        try {
            await (nodeId ? (action as LedgerAction)(nodeId) : (action as RunAction)());
        } catch (error) {
            onActionError?.(error);
        } finally {
            setPendingAction(null);
        }
    };

    if (!snapshot?.nodes.length) {
        return (
            <section
                className={`rounded-2xl border px-3.5 py-3 ${className}`}
                style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                aria-label="工作流运行进度"
            >
                <h3 className="text-[13px] font-medium" style={{ color: theme.node.text }}>运行进度</h3>
                <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>运行后，进度会显示在这里。</p>
            </section>
        );
    }

    const completedCount = snapshot.nodes.filter((node) => node.status === "completed").length;
    const canStop = Boolean(onStop && (snapshot.status === "running" || snapshot.status === "waiting_review"));
    const canResume = Boolean(onResume && snapshot.status === "stopped");
    const focusedNodes = workflowFocusNodes(snapshot.nodes);
    const collapseSteps = snapshot.nodes.length > 3;
    const focusedNodeIds = new Set(focusedNodes.map((node) => node.nodeId));
    const remainingNodes = snapshot.nodes.filter((node) => !focusedNodeIds.has(node.nodeId));

    if (snapshot.status === "completed") {
        return (
            <details
                className={`group rounded-2xl border px-3.5 py-3 ${className}`}
                style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
                aria-label="工作流运行摘要"
            >
                <summary className="flex cursor-pointer list-none items-center gap-2 outline-none focus-visible:underline">
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-500" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-[13px] font-medium" style={{ color: theme.node.text }}>工作流已完成</span>
                    <span className="shrink-0 text-[11px]" style={{ color: theme.node.muted }}>
                        {snapshot.nodes.length} 个步骤 · {snapshot.mode === "guided" ? "逐步运行" : "自动运行"}
                    </span>
                    <span className="shrink-0 text-[11px] group-open:hidden" style={{ color: theme.node.muted }}>查看</span>
                    <span className="hidden shrink-0 text-[11px] group-open:inline" style={{ color: theme.node.muted }}>收起</span>
                </summary>
                <ol className="mt-3 border-t pt-3" style={{ borderColor: theme.node.stroke }} aria-label="已完成的步骤">
                    {snapshot.nodes.map((node, index) => (
                        <WorkflowLedgerRow
                            key={node.nodeId}
                            node={node}
                            index={index}
                            isLast={index === snapshot.nodes.length - 1}
                            label={resolveNodeLabel(node, index, nodeLabels)}
                            theme={theme}
                            pendingAction={null}
                        />
                    ))}
                </ol>
            </details>
        );
    }

    return (
        <section
            className={`rounded-2xl border px-3.5 py-3 ${className}`}
            style={{ borderColor: theme.node.stroke, background: theme.node.panel }}
            aria-label="工作流运行进度"
        >
            <header className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                    <h3 className="text-[13px] font-medium" style={{ color: theme.node.text }}>运行进度</h3>
                    <p className="mt-0.5 text-[11px] leading-5" style={{ color: theme.node.muted }} aria-live="polite">
                        {RUN_STATUS_LABELS[snapshot.status]} · {completedCount}/{snapshot.nodes.length} 完成
                    </p>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                    <span className="mr-1 text-[11px]" style={{ color: theme.node.muted }}>
                        {snapshot.mode === "guided" ? "逐步运行" : "自动运行"}
                    </span>
                    {canResume ? (
                        <Button
                            type="text"
                            size="small"
                            icon={<Play className="size-3.5" />}
                            loading={pendingAction?.kind === "resume"}
                            disabled={Boolean(pendingAction && pendingAction.kind !== "resume")}
                            onClick={() => void perform(onResume!, { kind: "resume" })}
                        >
                            继续运行
                        </Button>
                    ) : null}
                    {canStop ? (
                        <Button
                            danger
                            type="text"
                            size="small"
                            icon={<Square className="size-3" />}
                            loading={pendingAction?.kind === "stop"}
                            disabled={Boolean(pendingAction && pendingAction.kind !== "stop")}
                            onClick={() => void perform(onStop!, { kind: "stop" })}
                        >
                            停止
                        </Button>
                    ) : null}
                </div>
            </header>

            <ol className="mt-3" aria-label="当前运行阶段">
                {(collapseSteps ? focusedNodes : snapshot.nodes).map((node, index, shownNodes) => (
                    <WorkflowLedgerRow
                        key={node.nodeId}
                        node={node}
                        index={snapshot.nodes.findIndex((candidate) => candidate.nodeId === node.nodeId)}
                        isLast={index === shownNodes.length - 1}
                        label={resolveNodeLabel(node, snapshot.nodes.findIndex((candidate) => candidate.nodeId === node.nodeId), nodeLabels)}
                        theme={theme}
                        pendingAction={pendingAction}
                        onInspectResult={onInspectResult ? () => void perform(onInspectResult, { kind: "inspect", nodeId: node.nodeId }, node.nodeId) : undefined}
                        onContinue={onContinue ? () => void perform(onContinue, { kind: "continue", nodeId: node.nodeId }, node.nodeId) : undefined}
                        onRetry={onRetry ? () => void perform(onRetry, { kind: "retry", nodeId: node.nodeId }, node.nodeId) : undefined}
                    />
                ))}
            </ol>
            {collapseSteps && remainingNodes.length ? (
                <details className="mt-2 border-t pt-2 text-[11px]" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    <summary className="w-fit cursor-pointer select-none outline-none focus-visible:underline">查看其余 {remainingNodes.length} 步</summary>
                    <ol className="mt-2" aria-label="其余运行步骤">
                        {remainingNodes.map((node, index) => (
                            <WorkflowLedgerRow
                                key={node.nodeId}
                                node={node}
                                index={snapshot.nodes.findIndex((candidate) => candidate.nodeId === node.nodeId)}
                                isLast={index === remainingNodes.length - 1}
                                label={resolveNodeLabel(node, snapshot.nodes.findIndex((candidate) => candidate.nodeId === node.nodeId), nodeLabels)}
                                theme={theme}
                                pendingAction={pendingAction}
                                onInspectResult={onInspectResult ? () => void perform(onInspectResult, { kind: "inspect", nodeId: node.nodeId }, node.nodeId) : undefined}
                                onContinue={onContinue ? () => void perform(onContinue, { kind: "continue", nodeId: node.nodeId }, node.nodeId) : undefined}
                                onRetry={onRetry ? () => void perform(onRetry, { kind: "retry", nodeId: node.nodeId }, node.nodeId) : undefined}
                            />
                        ))}
                    </ol>
                </details>
            ) : null}
        </section>
    );
}

function workflowFocusNodes(nodes: readonly WorkflowNodeRunRecord<unknown>[]) {
    const active = nodes.filter((node) => node.status === "running" || node.status === "persisting" || node.status === "waiting_review" || node.status === "error" || node.status === "blocked" || node.status === "stopped");
    if (active.length) return active.slice(0, 2);
    const next = nodes.find((node) => node.status === "queued" || node.status === "waiting_inputs");
    return next ? [next] : nodes.length ? [nodes[nodes.length - 1]] : [];
}

function WorkflowLedgerRow({
    node,
    index,
    isLast,
    label,
    theme,
    pendingAction,
    onInspectResult,
    onContinue,
    onRetry,
}: {
    node: WorkflowNodeRunRecord<unknown>;
    index: number;
    isLast: boolean;
    label: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    pendingAction: PendingAction;
    onInspectResult?: () => void;
    onContinue?: () => void;
    onRetry?: () => void;
}) {
    const presentation = STATUS_PRESENTATION[node.status];
    const StatusIcon = presentation.icon;
    const isCurrent = node.status === "running" || node.status === "persisting" || node.status === "waiting_review";
    const actionPending = pendingAction?.nodeId === node.nodeId;

    return (
        <li className="relative flex gap-2.5 pb-3 last:pb-0">
            {!isLast ? <span className="absolute left-[10px] top-6 h-[calc(100%-18px)] w-px" style={{ background: theme.node.stroke }} aria-hidden /> : null}
            <span
                className={`relative z-[1] mt-0.5 flex size-[21px] shrink-0 items-center justify-center ${presentation.tone}`}
                style={{ color: node.status === "queued" || node.status === "waiting_inputs" || node.status === "stopped" ? theme.node.faint : undefined }}
                aria-hidden
            >
                <StatusIcon className={`size-4 ${node.status === "running" || node.status === "persisting" ? "motion-safe:animate-spin" : ""}`} strokeWidth={1.8} />
            </span>
            <div
                className="min-w-0 flex-1 rounded-xl px-2.5 py-2 transition-colors duration-150"
                style={{ background: isCurrent ? theme.toolbar.activeBg : "transparent" }}
            >
                <div className="flex items-baseline justify-between gap-3">
                    <span className="min-w-0 truncate text-[13px] font-medium" style={{ color: theme.node.text }}>{label}</span>
                    <span className="shrink-0 text-[11px]" style={{ color: node.status === "error" ? "#ef4444" : theme.node.muted }}>{presentation.label}</span>
                </div>
                <p className="mt-0.5 text-[11px] leading-4" style={{ color: theme.node.muted }}>
                    {presentation.detail}{node.attempt > 1 ? ` · 第 ${node.attempt} 次` : ""}
                </p>

                {node.status === "error" && node.error?.message ? (
                    <details className="mt-1.5 text-[11px]" style={{ color: theme.node.muted }}>
                        <summary className="w-fit cursor-pointer select-none outline-none focus-visible:underline">查看原因</summary>
                        <p className="mt-1 break-words leading-4" style={{ color: theme.node.text }}>{node.error.message}</p>
                    </details>
                ) : null}

                {node.status === "waiting_review" && (onInspectResult || onContinue) ? (
                    <div className="mt-2 flex flex-wrap items-center gap-1">
                        {onInspectResult ? (
                            <Button
                                type="text"
                                size="small"
                                icon={<Eye className="size-3.5" />}
                                loading={actionPending && pendingAction?.kind === "inspect"}
                                disabled={Boolean(pendingAction && !actionPending)}
                                onClick={onInspectResult}
                            >
                                检查结果
                            </Button>
                        ) : null}
                        {onContinue ? (
                            <Button
                                type="primary"
                                size="small"
                                icon={<Play className="size-3.5" />}
                                loading={actionPending && pendingAction?.kind === "continue"}
                                disabled={Boolean(pendingAction && !actionPending)}
                                onClick={onContinue}
                            >
                                继续下一步
                            </Button>
                        ) : null}
                    </div>
                ) : null}

                {node.status === "error" && onRetry ? (
                    <Button
                        danger
                        type="text"
                        size="small"
                        className="mt-1.5"
                        icon={<RefreshCw className="size-3.5" />}
                        loading={actionPending && pendingAction?.kind === "retry"}
                        disabled={Boolean(pendingAction && !actionPending)}
                        onClick={onRetry}
                    >
                        重试
                    </Button>
                ) : null}
            </div>
            <span className="sr-only">步骤 {index + 1}：{presentation.label}</span>
        </li>
    );
}

function resolveNodeLabel(node: WorkflowNodeRunRecord<unknown>, index: number, source?: NodeLabelSource) {
    const provided = typeof source === "function" ? source(node.nodeId, index) : source?.[node.nodeId];
    if (provided?.trim()) return provided.trim();
    const metadataTitle = typeof node.metadata?.title === "string" ? node.metadata.title.trim() : "";
    return metadataTitle || `步骤 ${index + 1}`;
}
