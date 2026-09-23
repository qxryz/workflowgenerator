import { zodiacStageExecutionState } from "./zodiac-plan-presentation.ts";
import { zodiacPlanFrontier, type ZodiacStagePlan } from "./zodiac-stage-plan.ts";

/** Model context is a projection; the persisted plan remains complete. */
export function zodiacPlanContext(plan: ZodiacStagePlan, args: Record<string, unknown> = {}) {
    const frontier = zodiacPlanFrontier(plan);
    const summary = {
        planId: plan.id, revision: plan.revision, title: plan.title, workflowId: plan.workflowId,
        plannerSessionId: plan.plannerSessionId, currentStageId: frontier?.outline.id,
        outline: plan.outline, view: "summary",
        stages: plan.stages.map(stage => ({ id: stage.id, goal: stage.contract.goal, review: stage.contract.review,
            reviewPolicy: stage.runtime.reviewPolicy, status: stage.runtime.status, waitingReason: stage.runtime.waitingReason, blockedReason: zodiacStageExecutionState(stage).error,
            execution: zodiacStageExecutionState(stage),
            nextAction: zodiacStageExecutionState(stage).needsReconciliation ? "请在会话的阶段卡点击「核对结果」，采用已有产物或确认任务已停止；无需重置画布。" : stage.runtime.status === "blocked" ? "可修改本阶段提示词或参数，重新提交后等待用户确认执行。" : undefined,
            itemCount: stage.contract.workItems.length,
            counts: Object.fromEntries(["pending", "running", "succeeded", "failed", "interrupted"].map(status => [status, Object.values(stage.runtime.items).filter(item => item.status === status).length])),
        })),
    };
    if (args.view === undefined || args.view === "summary") return summary;
    if (args.view !== "items" && args.view !== "text") throw new Error("view 必须是 summary、items 或 text。");
    const stage = plan.stages.find(stage => stage.id === (args.stageId || frontier?.outline.id));
    if (!stage) throw new Error("请选择要读取的阶段。");
    const offset = args.offset ?? 0;
    const limit = args.limit ?? (args.view === "text" ? 8000 : 5);
    if (!Number.isInteger(offset) || (offset as number) < 0 || !Number.isInteger(limit) || (limit as number) < 1 || (limit as number) > (args.view === "text" ? 12000 : 10)) throw new Error("读取范围无效。");
    const start = offset as number, size = limit as number;
    const base = { planId: plan.id, revision: plan.revision, plannerSessionId: plan.plannerSessionId, stageId: stage.id, view: args.view, partial: true };
    if (args.view === "text") {
        const item = stage.contract.workItems.find(item => item.id === args.itemId);
        if (!item || !["content", "prompt", "text"].includes(String(args.field))) throw new Error("请选择工作项及正文 content、prompt 或 text。");
        const value = item.args[String(args.field)];
        if (typeof value !== "string") throw new Error("这个工作项没有对应正文。");
        if (start > value.length) throw new Error("读取范围超出正文。");
        return { ...base, itemId: item.id, field: args.field, offset: start, total: value.length, text: value.slice(start, start + size), nextOffset: start + size < value.length ? start + size : null };
    }
    if (start > stage.contract.workItems.length) throw new Error("读取范围超出工作项。");
    const workItems = stage.contract.workItems.slice(start, start + size).map(item => ({
        ...item,
        args: Object.fromEntries(Object.entries(item.args).map(([field, value]) => [field, typeof value === "string" && value.length > 1200 ? { omitted: true, characters: value.length, read: { view: "text", itemId: item.id, field } } : value])),
    }));
    return { ...base, goal: stage.contract.goal, review: stage.contract.review, offset: start, total: stage.contract.workItems.length,
        workItems, runtime: Object.fromEntries(workItems.map(item => [item.id, stage.runtime.items[item.id]])),
        nextOffset: start + size < stage.contract.workItems.length ? start + size : null };
}
