import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { Button, Drawer, Popconfirm, Select } from "antd";
import { ZodiacGlyph } from "@/components/brand/zodiac-glyph";
import { AgentPendingToolCard } from "@/components/canvas/canvas-agent-chat-ui";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { executeHubTool, type HubExecutorContext } from "@/lib/agent/zodiac-hub-tools";
import { executeZodiacStage, prepareZodiacStageRecovery, validateZodiacStageInput, zodiacStageRecoveryOutput } from "@/lib/agent/zodiac-stage-execution";
import { zodiacPlanFrontier, type ZodiacPlanCommand, type ZodiacPlanEvidence, type ZodiacStagePlan } from "@/lib/agent/zodiac-stage-plan";
import { getZodiacPlan, listZodiacPlans, mutateZodiacPlan } from "@/services/server-storage";
import { createZodiacToolDispatcher } from "@/lib/agent/zodiac-agent-policy";
import { nativeTools } from "@/services/api/zodic";
import { resolveZodiacExecutionSource } from "@/services/api/zodiac-transport";
import { flushAppState } from "@/services/app-lifecycle";
import { useConfigStore, selectableModelsByCapability, modelOptionLabel } from "@/stores/use-config-store";

import { resolveZodiacPlanConfirmation } from "@/lib/agent/zodiac-plan-confirmation";

export type ZodiacPlanActions = {
    confirm: (text: string, messageId: string, otherPending: boolean, onConfirmed: () => Promise<void>) => Promise<string | null>;
    deliverDocuments: (plan: ZodiacStagePlan, signal: AbortSignal) => Promise<ZodiacStagePlan>;
};

const itemLabels = { pending: "待执行", running: "执行中", succeeded: "已完成", failed: "未完成", interrupted: "待核对" };

export function ZodiacPlanPanel({
    projectId,
    sessionId,
    createContext,
    onRunningChange,
    stopRef,
    actionsRef,
    onContinue,
    onAdjust,
    conversationBusy = false,
}: {
    projectId: string;
    sessionId: string;
    createContext: (signal: AbortSignal, operationNamespace: string, turnId?: string, ownerSessionId?: string) => HubExecutorContext;
    conversationBusy?: boolean;
    onRunningChange: (running: boolean) => void;
    stopRef: { current: (() => void) | null };
    actionsRef: { current: ZodiacPlanActions | null };
    onContinue: (planId: string, title: string) => void;
    onAdjust: (stageTitle: string) => void;
}) {
    const { t } = useAppTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const config = useConfigStore((state) => state.config);
    const [plans, setPlans] = useState<ZodiacStagePlan[]>([]);
    const [selectedId, setSelectedId] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [expanded, setExpanded] = useState(false);
    const [recovery, setRecovery] = useState<{ itemId: string; nodeId?: string; options: Array<{ value: string; label: string }> } | null>(null);
    const acting = useRef(false);
    const controller = useRef<AbortController | null>(null);
    const epoch = useRef(0);
    const currentScope = `${projectId}:${sessionId}`;
    const scopeRef = useRef(currentScope);
    scopeRef.current = currentScope;
    const refresh = async () => {
        const token = epoch.current;
        try {
            const next = await listZodiacPlans(projectId);
            if (token === epoch.current) setPlans(current => next.filter(plan => !plan.sessionId || plan.sessionId === sessionId).map(plan => {
                const local = current.find(entry => entry.id === plan.id);
                return local && local.revision > plan.revision ? local : plan;
            }));
        } catch (reason) {
            if (token === epoch.current) setError(reason instanceof Error ? reason.message : "计划读取失败");
        }
    };
    useEffect(() => {
        epoch.current += 1;
        setPlans([]);
        setSelectedId("");
        setError("");
        setRecovery(null);
        setBusy(false);
        onRunningChange(false);
        void refresh();
        const changed = (event: Event) => {
            const planId = (event as CustomEvent<{ planId?: string }>).detail?.planId;
            if (planId) setSelectedId(planId);
            void refresh();
        };
        window.addEventListener("zodiac-plans-changed", changed);
        return () => {
            epoch.current += 1;
            controller.current?.abort();
            stopRef.current = null;
            window.removeEventListener("zodiac-plans-changed", changed);
        };
    }, [currentScope]);
    const plan = plans.find((entry) => entry.id === selectedId) || plans.find((entry) => entry.sessionId === sessionId) || plans.find(entry => !entry.sessionId);
    const frontier = plan ? zodiacPlanFrontier(plan) : undefined;
    const stage = frontier?.stage;
    const update = (next: ZodiacStagePlan) => setPlans(current => current.some(entry => entry.id === next.id)
        ? current.map(entry => entry.id === next.id && entry.revision <= next.revision ? next : entry)
        : [...current, next]);
    const act = async (input: ZodiacPlanCommand | (() => Promise<ZodiacPlanCommand>), execute = false, target = plan, options: { evidence?: ZodiacPlanEvidence; signal?: AbortSignal; internal?: boolean; propagate?: boolean } = {}): Promise<ZodiacStagePlan | undefined> => {
        if (!target || acting.current || (conversationBusy && !options.internal)) {
            if (options.propagate) throw new Error("当前任务尚未结束，请稍后继续。");
            return;
        }
        if ((target.sessionId && target.sessionId !== sessionId) || target.projectId !== projectId) throw new Error("计划不属于当前会话。");
        const plan = target;
        acting.current = true;
        const originScope = currentScope;
        setBusy(true);
        setError("");
        try {
            const command = typeof input === "function" ? await input() : input;
            if (scopeRef.current !== originScope) return;
            options.signal?.throwIfAborted();
            const reply = await mutateZodiacPlan({ planId: plan.id, expectedRevision: plan.revision,
                requestId: command.type === "begin_documents" ? `documents:${plan.revision}` : crypto.randomUUID(), command,
                ...(command.type === "begin_documents" ? {} : { evidence: options.evidence || { source: "button", sessionId } }),
            });
            if (scopeRef.current !== originScope) return;
            update(reply.plan);
            if (execute || command.type === "accept") setExpanded(false);
            setRecovery(null);
            if (execute && "stageId" in command) {
                const abort = new AbortController();
                const stop = () => abort.abort();
                options.signal?.addEventListener("abort", stop, { once: true });
                if (options.signal?.aborted) abort.abort();
                controller.current = abort;
                stopRef.current = () => abort.abort();
                onRunningChange(true);
                try {
                    const approvedStage = reply.plan.stages.find((entry) => entry.id === command.stageId)!;
                    const context = { ...createContext(abort.signal, plan.id, approvedStage.runtime.attemptId, plan.sessionId || sessionId), generationPolicy: "execute" as const };
                    const dispatcher = createZodiacToolDispatcher({
                        context: {
                            role: "executor",
                            taskId: approvedStage.runtime.attemptId!,
                            rootSessionId: plan.sessionId || sessionId,
                            planId: plan.id,
                            stageId: command.stageId,
                            source: await resolveZodiacExecutionSource(),
                            signal: abort.signal,
                            approvedTools: approvedStage.contract.workItems.map((item) => item.tool),
                        },
                        tools: nativeTools,
                        execute: (request) => executeHubTool(request, context),
                    });
                    return await executeZodiacStage({
                        plan: reply.plan,
                        stageId: command.stageId,
                        signal: abort.signal,
                        mutate: mutateZodiacPlan,
                        executeTool: async (request) => {
                            const result = await dispatcher.dispatch(request);
                            return result.ok ? { ok: true, result: result.result } : result;
                        },
                        validateInput: (output, sourceItem) => validateZodiacStageInput(output, sourceItem, context.getSnapshot().nodes),
                        persistOutput: async (output) => {
                            if (!context.getSnapshot().nodes.some((node) => node.id === output.nodeId)) throw new Error("结果尚未写入画布。");
                            await flushAppState();
                        },
                        onPlan: (next) => {
                            if (scopeRef.current === originScope) update(next);
                        },
                    });
                } finally { options.signal?.removeEventListener("abort", stop); }
            }
            return reply.plan;
        } catch (reason) {
            if (scopeRef.current === originScope) {
                setError(reason instanceof Error ? reason.message : "操作未完成");
                await refresh();
            }
            if (options.propagate) throw reason;
        } finally {
            acting.current = false;
            if (scopeRef.current === originScope) {
                setBusy(false);
                onRunningChange(false);
                controller.current = null;
                stopRef.current = null;
            }
        }
    };
    useImperativeHandle(actionsRef, () => ({
        confirm: async (text, messageId, otherPending, onConfirmed) => {
            const resolved = resolveZodiacPlanConfirmation(text, plans, sessionId, otherPending);
            if (resolved.kind === "none") return null;
            if (resolved.kind === "ambiguous") return t(resolved.message);
            if (resolved.command.type !== "accept") {
                await onConfirmed();
                return t("请先在阶段卡中检查模型和参数，再点击执行。");
            }
            const latest = await getZodiacPlan(resolved.plan.id);
            if (latest.revision !== resolved.plan.revision) {
                await refresh();
                return t("计划已更新，请查看最新内容后重新确认。");
            }
            // Persist the actual user message before it authorizes any stage work.
            await onConfirmed();
            const next = await act(resolved.command, resolved.command.type !== "accept", resolved.plan, {
                evidence: { source: "chat", sessionId, messageId, text }, propagate: true,
            });
            if (!next) return "阶段状态已变化，请查看计划后继续。";
            const stage = next.stages.find(stage => stage.id === resolved.command.stageId);
            return t(resolved.command.type === "accept" ? "已确认阶段结果。" : stage?.runtime.status === "blocked"
                ? "部分内容尚未完成，请查看计划中的结果。" : "本阶段内容已保存到画布。");
        },
        deliverDocuments: async (target, signal) => {
            const stage = zodiacPlanFrontier(target)?.stage;
            if (stage?.runtime.status !== "ready") return target;
            return await act({ type: "begin_documents", stageId: stage.id }, true, target, { internal: true, signal, propagate: true }) || target;
        },
    }));
    const modelSelect = (item: import("@/lib/agent/zodiac-stage-plan").ZodiacPlanWorkItem) => stage && typeof item.args.model === "string" ? (
        <Select aria-label={`${item.title} · ${t("模型")}`} size="small" className="w-full min-w-44"
            value={item.args.model} disabled={busy || conversationBusy || !(stage.runtime.status === "waiting_user" && stage.runtime.waitingReason === "plan_review")}
            options={selectableModelsByCapability(config, item.tool === "hub_generate_image" ? "image" : item.tool === "hub_generate_video" ? "video" : "audio").map(value => ({ value, label: modelOptionLabel(config, value) }))}
            onChange={model => void act({ type: "write_stage", stage: { id: stage.id, contract: { ...stage.contract, workItems: stage.contract.workItems.map(entry => entry.id === item.id ? { ...entry, args: { ...entry.args, model } } : entry) } } })} />
    ) : null;
    if (!plan)
        return error ? (
            <div role="alert" className="px-4 py-2 text-xs text-red-600">
                {error}
            </div>
        ) : null;
    const outline = plan.outline.filter((entry) => !entry.omitted);
    const completed = outline.filter((entry) => plan.stages.find((item) => item.id === entry.id)?.runtime.status === "done").length;
    const executing = busy || stage?.runtime.status === "doing";
    const stageActions = stage ? (
        <div className="flex flex-wrap gap-2">
            {stage.runtime.status === "ready" ? (
                <Button type="primary" loading={busy} disabled={conversationBusy} onClick={() => void act({ type: "begin_documents", stageId: stage.id }, true)}>{t("保存文档")}</Button>
            ) : null}
            {stage.runtime.status === "waiting_user" && stage.runtime.waitingReason === "plan_review" ? (
                <Button type="primary" loading={busy} disabled={conversationBusy} onClick={() => void act({ type: "approve", stageId: stage.id }, true)}>
                    {t("确认并执行本阶段")}
                </Button>
            ) : null}
            {stage.runtime.status === "waiting_user" && stage.runtime.waitingReason === "result_review" ? (
                <Button type="primary" loading={busy} disabled={conversationBusy} onClick={() => void act({ type: "accept", stageId: stage.id })}>
                    {t("结果通过，完成本阶段")}
                </Button>
            ) : null}
            {stage.runtime.status === "doing" && !controller.current && Object.values(stage.runtime.items).every((item) => item.status === "succeeded") && stage.runtime.attemptId ? (
                <Button type="primary" loading={busy} disabled={conversationBusy} onClick={() => void act({ type: "finish", stageId: stage.id, attemptId: stage.runtime.attemptId! })}>
                    {t("核对已保存结果")}
                </Button>
            ) : stage.runtime.status === "doing" ? (
                <Button type="text" size="small" onClick={() => (controller.current ? controller.current.abort() : void act({ type: "cancel", stageId: stage.id }))}>
                    {t(controller.current ? "停止" : "结束中断的执行")}
                </Button>
            ) : null}
            {stage.runtime.status === "blocked" ? (
                <Button type="primary" loading={busy} disabled={conversationBusy || Object.values(stage.runtime.items).some((item) => ["running", "interrupted"].includes(item.status))} onClick={() => void act({ type: "retry", stageId: stage.id }, true)}>
                    {t("仅重试未完成项")}
                </Button>
            ) : null}
        </div>
    ) : null;
    const ready = stage?.runtime.status === "ready";
    const waitingApproval = stage?.runtime.status === "waiting_user" && stage.runtime.waitingReason === "plan_review";
    const waitingResult = stage?.runtime.status === "waiting_user" && stage.runtime.waitingReason === "result_review";
    return (
        <section className="mt-5" aria-label={t("创作计划")}>
            {stage ? (
                <AgentPendingToolCard minimal
                    theme={theme}
                    title={waitingResult ? "这一步的结果可以吗？" : frontier?.outline.title || plan.title}
                    summary={executing ? `正在完成「${frontier?.outline.title}」` : waitingResult ? "内容已写入画布，请检查后继续。" : ready ? "文档已准备，可保存到画布。" : "确认后完成以下内容。"}
                    summaryMeta={`${stage.contract.workItems.length} 项内容`}
                    state={executing ? "running" : stage.runtime.status === "blocked" ? "failed" : "pending"}
                    errorText={stage.runtime.blockedReason || error}
                    approveText={ready ? "保存文档" : waitingResult ? "结果通过" : waitingApproval ? "确认执行" : "查看详情"}
                    rejectText="继续调整"
                    onApprove={conversationBusy || busy ? undefined : () => (ready ? void act({ type: "begin_documents", stageId: stage.id }, true) : waitingApproval ? void act({ type: "approve", stageId: stage.id }, true) : waitingResult ? void act({ type: "accept", stageId: stage.id }) : setExpanded(true))}
                    disabled={conversationBusy || busy}
                    onReject={conversationBusy || busy ? undefined : () => onAdjust(frontier?.outline.title || plan.title)}
                >
                    <ol className="space-y-3">
                        {stage.contract.workItems.slice(0, 4).map((item, index) => (
                            <li key={item.id} className="flex items-start gap-3 text-xs leading-5">
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px]" style={{ borderColor: theme.node.stroke }}>
                                    {stage.runtime.items[item.id]?.status === "succeeded" ? <ZodiacGlyph name="check" className="size-3" /> : index + 1}
                                </span>
                                <div className="min-w-0">
                                    <p className="font-medium">{item.title}</p>
                                    {typeof item.args.model === "string" ? (
                                        <div style={{ color: theme.node.muted }}>
                                            {modelSelect(item)}
                                            {item.args.count ? ` · ${item.args.count} 项` : ""}
                                            {item.args.seconds ? ` · ${item.args.seconds} 秒` : ""}
                                        </div>
                                    ) : null}
                                </div>
                            </li>
                        ))}
                    </ol>
                    <button type="button" className="mt-3 text-xs text-[color:var(--wg-home-accent)] hover:underline" onClick={() => setExpanded(true)}>
                        查看详情{stage.contract.workItems.length > 4 ? ` · 共 ${stage.contract.workItems.length} 项` : ""}
                    </button>
                </AgentPendingToolCard>
            ) : frontier ? (
                <AgentPendingToolCard minimal
                    theme={theme}
                    title={frontier.outline.title}
                    summary="上一阶段已完成，可以继续准备下一步。"
                    approveText="继续下一阶段"
                    rejectText="调整方向"
                    onApprove={conversationBusy || busy ? undefined : () => onContinue(plan.id, plan.title)}
                    onReject={() => onAdjust(frontier.outline.title)}
                />
            ) : (
                <p className="py-2 text-center text-xs" style={{ color: theme.node.muted }}>
                    创作计划已完成
                </p>
            )}
            <div className="mt-2 flex items-center gap-2 text-xs" style={{ color: theme.node.muted }}>
                {!stage ? (
                    <button type="button" className="hover:underline" onClick={() => setExpanded(true)}>
                        查看详情
                    </button>
                ) : null}
                <span className="ml-auto">
                    {completed} / {outline.length} 阶段完成
                </span>
                {executing ? (
                    <Button type="text" size="small" onClick={() => (controller.current ? controller.current.abort() : stage && void act({ type: "cancel", stageId: stage.id }))}>
                        停止
                    </Button>
                ) : null}
            </div>
            {error && stage?.runtime.status !== "blocked" ? (
                <p role="alert" className="mt-2 text-xs text-red-500">
                    {error}
                </p>
            ) : null}
            <Drawer rootClassName="zodiac-surface" title="创作流程" open={expanded} onClose={() => setExpanded(false)} width={560} footer={stageActions}>
                <h2 className="mb-5 text-base font-semibold">{plan.title}</h2>
                <div className="space-y-4">
                    {plans.length > 1 ? (
                        <Select
                            aria-label={t("选择创作计划")}
                            size="small"
                            className="w-full"
                            value={plan.id}
                            disabled={busy}
                            options={plans.map((entry) => ({ value: entry.id, label: entry.title }))}
                            onChange={(id) => {
                                setSelectedId(id);
                                setRecovery(null);
                            }}
                        />
                    ) : null}
                    <ol className="mb-6 space-y-3" aria-label="制作阶段">
                        {plan.outline
                            .filter((entry) => !entry.omitted)
                            .map((entry, index) => {
                                const done = plan.stages.find((item) => item.id === entry.id)?.runtime.status === "done";
                                const current = entry.id === frontier?.outline.id;
                                return (
                                    <li key={entry.id} className="flex items-center gap-3 text-sm" style={{ color: current ? theme.node.text : theme.node.muted }}>
                                        <span className="flex size-6 shrink-0 items-center justify-center rounded-full border text-xs" style={{ borderColor: theme.node.stroke, background: current ? theme.node.stroke : undefined }}>
                                            {done ? <ZodiacGlyph name="check" className="size-3.5" /> : index + 1}
                                        </span>
                                        <span className={current ? "font-semibold" : ""}>{entry.title}</span>
                                        {current ? <span className="ml-auto text-xs">当前阶段</span> : null}
                                    </li>
                                );
                            })}
                    </ol>
                    {!frontier ? (
                        <p className="text-sm">{t("所有阶段已完成")}</p>
                    ) : !stage ? (
                        <p className="text-xs" style={{ color: theme.node.muted }}>
                            {t("下一阶段：{title}。可以在对话中继续细化。", { title: frontier.outline.title })}
                        </p>
                    ) : (
                        <>
                            <p className="text-sm font-medium">{frontier.outline.title}</p>
                            <p className="text-xs leading-5">{stage.contract.goal}</p>
                            <div className="space-y-2">
                                {stage.contract.workItems.map((item) => {
                                    const state = stage.runtime.items[item.id];
                                    const details = typeof item.args.content === "string" ? item.args.content : typeof item.args.prompt === "string" ? item.args.prompt : typeof item.args.text === "string" ? item.args.text : "";
                                    const parameters = [
                                        typeof item.args.model === "string" ? `${t("模型")}：${item.args.model.split("::").at(-1)}` : "",
                                        item.args.count !== undefined ? t("数量：{value}", { value: String(item.args.count) }) : "",
                                        item.args.seconds !== undefined ? t("时长：{value} 秒", { value: String(item.args.seconds) }) : "",
                                        item.args.size ? t("画幅：{value}", { value: String(item.args.size) }) : "",
                                        item.args.voice ? t("音色：{value}", { value: String(item.args.voice) }) : "",
                                        item.args.speed !== undefined ? t("语速：{value}", { value: String(item.args.speed) }) : "",
                                        item.args.vquality ? t("清晰度：{value}", { value: String(item.args.vquality) }) : "",
                                        item.tool !== "hub_canvas_write_node"
                                            ? t("引用：{count} 项", { count: ["references", "videoReferences", "audioReferences"].reduce((sum, key) => sum + (Array.isArray(item.args[key]) ? item.args[key].length : 0), item.inputItemIds?.length || 0) })
                                            : "",
                                    ].filter(Boolean);
                                    return (
                                        <div key={item.id} className="border-l-2 pl-3" style={{ borderColor: theme.node.stroke }}>
                                            <div className="flex items-start justify-between gap-2 text-xs">
                                                <span>{item.title}</span>
                                                <span className="shrink-0" style={{ color: theme.node.muted }}>
                                                    {t(itemLabels[state?.status || "pending"])}
                                                </span>
                                            </div>
                                            {modelSelect(item)}
                                            {parameters.length ? (
                                                <p className="mt-1 text-xs leading-5" style={{ color: theme.node.muted }}>
                                                    {parameters.join(" · ")}
                                                </p>
                                            ) : null}
                                            {details ? (
                                                <details className="mt-1 text-xs" style={{ color: theme.node.muted }}>
                                                    <summary className="cursor-pointer">{t("查看内容")}</summary>
                                                    <p className="mt-1 whitespace-pre-wrap leading-5">{details}</p>
                                                </details>
                                            ) : null}
                                            {state?.error ? <p className="mt-1 text-xs text-red-600">{state.error}</p> : null}
                                            {stage.runtime.status === "blocked" && ["running", "interrupted"].includes(state?.status || "") ? (
                                                <div className="mt-1 space-y-2">
                                                    <div className="flex flex-wrap gap-1">
                                                        <Button
                                                            type="text"
                                                            size="small"
                                                            disabled={busy || conversationBusy}
                                                            onClick={() => {
                                                                const nodes = createContext(new AbortController().signal, plan.id).getSnapshot().nodes;
                                                                const options = nodes.flatMap((node) => {
                                                                    try {
                                                                        zodiacStageRecoveryOutput(item, node);
                                                                        return [{ value: node.id, label: `${node.title || item.title} · ${node.id.slice(-6)}` }];
                                                                    } catch {
                                                                        return [];
                                                                    }
                                                                });
                                                                setRecovery({ itemId: item.id, options });
                                                            }}
                                                        >
                                                            {t("采用已有结果")}
                                                        </Button>
                                                        <Popconfirm
                                                            title={t("已确认这项任务停止？")}
                                                            description={t("请先核对画布和生成结果，确认不会继续生成。")}
                                                            onConfirm={() => act({ type: "resolve_item", stageId: stage.id, itemId: item.id, error: "已核对任务停止，可以重试。" })}
                                                        >
                                                            <Button type="text" size="small" disabled={busy || conversationBusy}>
                                                                {t("确认已停止")}
                                                            </Button>
                                                        </Popconfirm>
                                                    </div>
                                                    {recovery?.itemId === item.id ? (
                                                        <div className="flex items-center gap-1">
                                                            <Select
                                                                size="small"
                                                                className="min-w-0 flex-1"
                                                                aria-label={t("选择已有结果")}
                                                                placeholder={t("选择已有结果")}
                                                                notFoundContent={t("暂无符合要求的结果")}
                                                                disabled={busy || conversationBusy}
                                                                options={recovery.options}
                                                                value={recovery.nodeId}
                                                                onChange={(nodeId) => setRecovery({ ...recovery, nodeId })}
                                                            />
                                                            <Button
                                                                size="small"
                                                                type="text"
                                                                loading={busy}
                                                                disabled={!recovery.nodeId || conversationBusy}
                                                                onClick={() =>
                                                                    void act(async () => {
                                                                        const context = createContext(new AbortController().signal, plan.id);
                                                                        const output = await prepareZodiacStageRecovery(item, recovery.nodeId!, () => context.getSnapshot().nodes, flushAppState);
                                                                        return { type: "resolve_item", stageId: stage.id, itemId: item.id, output };
                                                                    })
                                                                }
                                                            >
                                                                {t("确认采用")}
                                                            </Button>
                                                        </div>
                                                    ) : null}
                                                </div>
                                            ) : null}
                                        </div>
                                    );
                                })}
                            </div>
                            {(stage.runtime.waitingReason === "result_review" ? stage.contract.review?.afterExecution : stage.contract.review?.beforeExecution)?.map((check) => (
                                <p key={check} className="text-xs leading-5" style={{ color: theme.node.muted }}>
                                    {check}
                                </p>
                            ))}
                            {stage.runtime.blockedReason ? <p className="text-xs text-red-600">{stage.runtime.blockedReason}</p> : null}
                        </>
                    )}
                    {error ? (
                        <p role="alert" className="text-xs text-red-600">
                            {error}
                        </p>
                    ) : null}
                </div>
            </Drawer>
        </section>
    );
}
