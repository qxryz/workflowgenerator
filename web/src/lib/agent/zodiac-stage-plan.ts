/** Durable creative stages. Canvas DAG execution remains a separate layer. */
export type ZodiacPlanTool = "hub_canvas_write_node" | "hub_generate_image" | "hub_generate_video" | "hub_generate_audio";
export type ZodiacPlanWorkItem = { id: string; title: string; tool: ZodiacPlanTool; args: Record<string, unknown>; dependsOn?: string[]; inputItemIds?: string[] };
export type ZodiacStageContract = { goal: string; workItems: ZodiacPlanWorkItem[]; review?: { beforeExecution?: string[]; afterExecution?: string[] } };
export type ZodiacStageOutline = { id: string; title: string; omitted?: boolean };
export type ZodiacStageDraft = { id: string; contract: ZodiacStageContract };
export type ZodiacPlanOutput = { nodeId: string; storageKey?: string; resultVersionId?: string };
export type ZodiacPlanItemRuntime = { status: "pending" | "running" | "succeeded" | "failed" | "interrupted"; attemptId?: string; operationId?: string; output?: ZodiacPlanOutput; supersededOutputs: ZodiacPlanOutput[]; error?: string };
export type ZodiacStageRuntime = { status: "waiting_user" | "doing" | "done" | "blocked"; waitingReason?: "plan_review" | "result_review"; attemptId?: string; activeItemIds?: string[]; items: Record<string, ZodiacPlanItemRuntime>; blockedReason?: string };
export type ZodiacPlanStage = ZodiacStageDraft & { runtime: ZodiacStageRuntime };
export type ZodiacStagePlan = { version: 1; id: string; originId?: string; projectId: string; sessionId?: string; plannerSessionId?: string; title: string; workflowId: string; revision: number; retiredOutputs?: ZodiacPlanOutput[]; outline: ZodiacStageOutline[]; stages: ZodiacPlanStage[]; createdAt: number; updatedAt: number };
export type ZodiacPlanCreate = { id: string; projectId: string; sessionId?: string; plannerSessionId?: string; title: string; workflowId: string; outline: ZodiacStageOutline[]; firstStage: ZodiacStageDraft; requestId: string };
export type ZodiacPlanCommand =
    | { type: "write_stage"; stage: ZodiacStageDraft }
    | { type: "replan"; outline: ZodiacStageOutline[]; stage: ZodiacStageDraft; reason: string }
    | { type: "approve"; stageId: string }
    | { type: "accept"; stageId: string }
    | { type: "retry"; stageId: string; itemIds?: string[] }
    | { type: "cancel"; stageId: string }
    | { type: "resolve_item"; stageId: string; itemId: string; output?: ZodiacPlanOutput; error?: string }
    | { type: "claim_item"; stageId: string; attemptId: string; itemId: string }
    | { type: "record_item"; stageId: string; attemptId: string; itemId: string; output?: ZodiacPlanOutput; error?: string }
    | { type: "finish"; stageId: string; attemptId: string };
export type ZodiacPlanMutation = { planId: string; expectedRevision: number; requestId: string; command: ZodiacPlanCommand; plannerSessionId?: string };
/** claim.shouldExecute is false on replay: an uncertain claim must never launch a second paid request. */
export type ZodiacPlanReply = { plan: ZodiacStagePlan; replayed: boolean; claim?: { itemId: string; shouldExecute: boolean } };
export function zodiacPlanFrontier(plan: ZodiacStagePlan) {
    const outline = plan.outline.find((entry) => !entry.omitted && plan.stages.find((stage) => stage.id === entry.id)?.runtime.status !== "done");
    return outline ? { outline, stage: plan.stages.find((stage) => stage.id === outline.id) } : undefined;
}
