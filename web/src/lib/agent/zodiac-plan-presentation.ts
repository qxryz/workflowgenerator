import type { ZodiacPlanStage, ZodiacStagePlan } from "./zodiac-stage-plan.ts";

type ConversationItem = { id: string; role: string; planIds?: string[]; activity?: Array<{ startedAt: number; at: number }> };

/** New plans carry an explicit message anchor. Old sessions use their recorded turn interval. */
export function zodiacPlanMessageAnchor(plan: Pick<ZodiacStagePlan, "id" | "createdAt"> | null, items: readonly ConversationItem[]): string | undefined {
    if (!plan || !items.length) return undefined;
    const explicit = items.findLast(item => item.planIds?.includes(plan.id));
    if (explicit) return explicit.id;
    const timed = items.findLastIndex(item => item.activity?.some(event => event.startedAt <= plan.createdAt));
    // A legacy plan must stay before later user turns, even when its runtime changes.
    let anchor = Math.max(0, timed);
    while (anchor + 1 < items.length && items[anchor + 1].role !== "user") anchor += 1;
    return items[anchor].id;
}

export function zodiacStageExecutionState(stage: ZodiacPlanStage) {
    const states = Object.values(stage.runtime.items);
    const running = stage.runtime.status === "doing";
    const needsReconciliation = !running && states.some(item => item.status === "running" || item.status === "interrupted");
    const failures = states.flatMap(item => item.status === "failed" && item.error ? [item.error] : []);
    return {
        running,
        needsReconciliation,
        canEdit: !running && !needsReconciliation && stage.runtime.status !== "done",
        error: needsReconciliation ? "执行已结束，部分结果仍需核对。" : failures[0] || (stage.runtime.status === "blocked" ? "本阶段未完成，可调整后再执行。" : undefined),
    };
}
