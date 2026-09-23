import intents from "./zodiac-plan-intents.json" with { type: "json" };
import { zodiacPlanFrontier, type ZodiacPlanCommand, type ZodiacStagePlan } from "./zodiac-stage-plan.ts";

type ReviewCommand = Extract<ZodiacPlanCommand, { type: "approve" | "accept" | "retry" }>;

export type ZodiacPlanConfirmation =
    | { kind: "none" }
    | { kind: "ambiguous"; message: string }
    | { kind: "action"; plan: ZodiacStagePlan; command: ReviewCommand };

/** Only a complete, explicit reply can authorize a reviewed revision. Extra prose is not approval. */
export function resolveZodiacPlanConfirmation(text: string, plans: readonly ZodiacStagePlan[], sessionId: string, otherPending = false): ZodiacPlanConfirmation {
    const phrase = text.trim().replace(/[。！!.\s]+$/u, "").toLowerCase();
    const intent = (Object.keys(intents) as (keyof typeof intents)[]).find(key => intents[key].includes(phrase));
    if (!intent || otherPending) return { kind: "none" };
    const candidates = plans.filter(plan => plan.sessionId === sessionId).flatMap(plan => {
        const stage = zodiacPlanFrontier(plan)?.stage;
        if (!stage) return [];
        const runtime = stage.runtime;
        const type = runtime.status === "waiting_user"
            ? runtime.waitingReason === "plan_review" ? "approve" : runtime.waitingReason === "result_review" ? "accept" : undefined
            : intent === "retry" && runtime.status === "blocked" && !Object.values(runtime.items).some(item => ["running", "interrupted"].includes(item.status)) ? "retry" : undefined;
        if (!type || (intent !== "continue" && intent !== type)) return [];
        return [{ plan, command: { type, stageId: stage.id } as ReviewCommand }];
    });
    if (candidates.length > 1) return { kind: "ambiguous", message: "有多个待确认的阶段，请在对应计划卡上确认。" };
    return candidates.length ? { kind: "action", ...candidates[0] } : { kind: "none" };
}
