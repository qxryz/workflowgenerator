import { generationFailureCode } from "../generation-error.ts";
import type { CanvasNodeData } from "../../types/canvas";
import type { ZodiacStagePlan } from "./zodiac-stage-plan";

/** Used only by the user's reconciliation action, never to launch or retry a task. */
export function zodiacConfirmedCanvasFailures(plan: ZodiacStagePlan, stageId: string, nodes: readonly Pick<CanvasNodeData, "id" | "metadata">[]) {
    const stage = plan.stages.find(stage => stage.id === stageId);
    if (!stage || stage.runtime.status !== "blocked" || !plan.sessionId) return [];
    return stage.contract.workItems.flatMap(item => {
        const runtime = stage.runtime.items[item.id];
        if (!runtime || !["running", "interrupted"].includes(runtime.status) || !runtime.attemptId || !runtime.operationId) return [];
        const slot = nodes.find(node => {
            const meta = node.metadata;
            return meta?.role === "result-slot" && meta.agentSessionId === plan.sessionId && meta.agentOperationId === runtime.operationId && meta.agentTurnId === runtime.attemptId;
        });
        const meta = slot?.metadata;
        if (!meta || meta.slotState !== "error" || meta.status !== "error" || meta.storageKey || meta.currentResultVersionId) return [];
        const latest = meta.resultVersions?.at(-1);
        if (latest?.status !== "error" || latest.errorDetails !== meta.errorDetails) return [];
        const source = nodes.find(node => node.id === meta.resultSlotSourceNodeId)?.metadata;
        if (!source || source.status !== "error" || source.agentTurnId !== runtime.attemptId || source.agentOperationId !== runtime.operationId) return [];
        const definitive = generationFailureCode({ code: latest.generationFailureCode });
        // Compatibility with the old image-01 validator, which ran before any HTTP request
        // but did not persist its failure code. The submitted prompt also included reference
        // instructions and channel prefixes, so source.prompt alone cannot reproduce its length.
        const legacyPreflight = item.tool === "hub_generate_image"
            && String(item.args.model).split("::").at(-1) === "image-01"
            && meta.errorDetails === "MiniMax 图片提示词不能超过 1500 个字符"
            && source.model === item.args.model;
        return definitive || legacyPreflight ? [{ itemId: item.id, error: latest.errorDetails }] : [];
    });
}
