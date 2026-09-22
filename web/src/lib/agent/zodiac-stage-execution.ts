import { normalizeAudioDefaultsForModel } from "../audio-defaults.ts";
import type { CanvasNodeData } from "../../types/canvas";
import type { AiConfig } from "../../stores/use-config-store";
import type { ZodiacStageDraft } from "./zodiac-stage-plan";
import type { HubToolOutcome, HubToolRequest } from "./zodiac-hub-tools";
import type { ZodiacPlanCommand, ZodiacPlanMutation, ZodiacPlanOutput, ZodiacPlanReply, ZodiacPlanWorkItem, ZodiacStagePlan } from "./zodiac-stage-plan";

const EXECUTION_TOOLS = new Set(["hub_canvas_write_node", "hub_generate_image", "hub_generate_video", "hub_generate_audio"]);

type StageExecutionOptions = {
    plan: ZodiacStagePlan;
    stageId: string;
    mutate: (input: ZodiacPlanMutation) => Promise<ZodiacPlanReply>;
    executeTool: (request: HubToolRequest) => Promise<HubToolOutcome>;
    persistOutput: (output: ZodiacPlanOutput) => Promise<void>;
    validateInput: (output: ZodiacPlanOutput, sourceItem: ZodiacPlanWorkItem) => Promise<void> | void;
    signal?: AbortSignal;
    onPlan?: (plan: ZodiacStagePlan) => void;
};

export function zodiacStageItemArgs(plan: ZodiacStagePlan, stageId: string, item: ZodiacPlanWorkItem) {
    const references = Array.isArray(item.args.references) ? [...item.args.references] : [];
    for (const id of item.inputItemIds || []) {
        const state = plan.stages.flatMap((stage) => Object.entries(stage.runtime.items)).find(([itemId]) => itemId === id)?.[1];
        if (state?.status !== "succeeded" || !state.output?.nodeId) throw new Error(`引用任务「${id}」尚未完成。`);
        if (!references.some((entry) => entry && typeof entry === "object" && "nodeId" in entry && entry.nodeId === state.output!.nodeId)) references.push({ nodeId: state.output.nodeId });
    }
    return { ...item.args, ...(references.length ? { references } : {}), operationId: plan.stages.find((stage) => stage.id === stageId)?.runtime.items[item.id]?.operationId || `${stageId}:${item.id}` };
}

/** Execute only an already approved stage. Callers must never resume this function on mount. */
export async function executeZodiacStage(options: StageExecutionOptions) {
    let plan = options.plan;
    const initial = plan.stages.find((stage) => stage.id === options.stageId);
    if (initial?.runtime.status !== "doing" || !initial.runtime.attemptId) throw new Error("请先确认当前阶段的任务。 ");
    const attemptId = initial.runtime.attemptId;
    const mutate = async (command: ZodiacPlanCommand, suffix: string) => {
        const result = await options.mutate({ planId: plan.id, expectedRevision: plan.revision, requestId: `${attemptId}:${suffix}`, command });
        plan = result.plan;
        options.onPlan?.(plan);
        return result;
    };
    const base = { stageId: options.stageId, attemptId };
    try {
        for (;;) {
            options.signal?.throwIfAborted();
            const stage = plan.stages.find((entry) => entry.id === options.stageId)!;
            if (stage.runtime.status !== "doing" || stage.runtime.attemptId !== attemptId) throw new Error("阶段状态已改变，请刷新后继续。");
            const states = new Map(plan.stages.flatMap((entry) => Object.entries(entry.runtime.items)));
            const item = stage.contract.workItems.find((entry) => stage.runtime.items[entry.id]?.status === "pending" && (!stage.runtime.activeItemIds || stage.runtime.activeItemIds.includes(entry.id)) && [...entry.dependsOn || [], ...entry.inputItemIds || []].every((id) => states.get(id)?.status === "succeeded"));
            if (!item) break;
            const claim = await mutate({ type: "claim_item", ...base, itemId: item.id }, `claim:${item.id}`);
            if (!claim.claim?.shouldExecute) throw new Error("这项任务已有执行记录，请核对结果后再恢复，避免重复生成。");
            let output: ZodiacPlanOutput | undefined;
            let error: string | undefined;
            let resultNeedsReview = false;
            try {
                options.signal?.throwIfAborted();
                if (!EXECUTION_TOOLS.has(item.tool)) throw new Error("当前任务使用了不支持的操作。");
                for (const inputId of item.inputItemIds || []) {
                    const sourceStage = plan.stages.find((entry) => entry.runtime.items[inputId]);
                    const sourceItem = sourceStage?.contract.workItems.find((entry) => entry.id === inputId);
                    const sourceOutput = sourceStage?.runtime.items[inputId]?.output;
                    if (!sourceItem || !sourceOutput) throw new Error("引用结果缺失，请重新审核阶段。");
                    await options.validateInput(sourceOutput, sourceItem);
                }
                options.signal?.throwIfAborted();
                const result = await options.executeTool({ callId: `${attemptId}:${item.id}`, name: item.tool, args: zodiacStageItemArgs(plan, options.stageId, item) });
                if (!result.ok) {
                    if ("requiresReconciliation" in result && result.requiresReconciliation === true) {
                        resultNeedsReview = true;
                        if ("nodeId" in result && typeof result.nodeId === "string") output = { nodeId: result.nodeId };
                    }
                    throw new Error(result.error);
                }
                resultNeedsReview = true;
                const value = result.result as Partial<ZodiacPlanOutput> | null;
                if (!value || typeof value.nodeId !== "string" || !value.nodeId) throw new Error("任务没有返回已保存的结果。");
                output = { nodeId: value.nodeId, ...(typeof value.storageKey === "string" ? { storageKey: value.storageKey } : {}), ...(typeof value.resultVersionId === "string" ? { resultVersionId: value.resultVersionId } : {}) };
                await options.persistOutput(output);
            } catch (reason) {
                // Abort may only stop the browser waiting while the provider still runs.
                // Keep the claim running so cancel records an uncertain, non-retryable item.
                if (options.signal?.aborted) throw reason;
                if (resultNeedsReview) {
                    await mutate({ type: "cancel", stageId: options.stageId }, `uncertain:${item.id}`);
                    throw new Error(`结果可能已生成，但保存尚未确认${output?.nodeId ? `（节点 ${output.nodeId}）` : ""}。请先核对结果，勿直接重新生成。${reason instanceof Error ? reason.message : ""}`);
                }
                output = undefined;
                error = reason instanceof Error ? reason.message : "任务失败";
            }
            await mutate({ type: "record_item", ...base, itemId: item.id, ...(output ? { output } : { error: error || "任务未完成" }) }, `record:${item.id}`);
        }
        await mutate({ type: "finish", ...base }, "finish");
    } catch (error) {
        if (options.signal?.aborted) await mutate({ type: "cancel", stageId: options.stageId }, "cancel");
        else throw error;
    }
    return plan;
}


/** Freeze visible execution defaults in the contract before a user reviews it. */
export function materializeZodiacStage(stage: ZodiacStageDraft, config: AiConfig, field = "stage"): ZodiacStageDraft {
    const shape = `${field}: { id: "阶段ID", contract: { goal: "交付目标", workItems: [{ id: "任务ID", title: "名称", tool: "hub_canvas_write_node", args: { kind: "text", name: "文档名称", content: "完整正文" } }] } }`;
    if (!stage || typeof stage !== "object" || Array.isArray(stage)) throw new Error(`${field} 缺失或不是对象。请使用 ${shape}`);
    if (!stage.contract || typeof stage.contract !== "object" || Array.isArray(stage.contract)) throw new Error(`${field}.contract 缺失或不是对象（收到字段：${Object.keys(stage).slice(0, 12).map((key) => key.slice(0, 40)).join("、")}）。请使用 ${shape}`);
    if (!Array.isArray(stage.contract.workItems) || !stage.contract.workItems.length) throw new Error(`${field}.contract.workItems 必须是非空数组（contract 收到字段：${Object.keys(stage.contract).slice(0, 12).map((key) => key.slice(0, 40)).join("、")}）。请使用 ${shape}`);
    return { ...stage, contract: { ...stage.contract, workItems: stage.contract.workItems.map((item) => {
        if (item.tool === "hub_canvas_write_node") return item;
        const args = { ...item.args };
        for (const key of ["model", "size", "voice", "format", "instructions", "quality", "background", "imageWatermark", "imageOptimizePrompt", "imagePromptPrefix", "vquality", "generateAudio", "watermark"]) {
            if (args[key] !== undefined && typeof args[key] !== "string") throw new Error(`「${item.title}」的 ${key} 必须是文本。`);
        }
        if (args.model !== undefined && !(args.model as string).trim()) throw new Error(`「${item.title}」的模型不能为空。`);
        for (const key of ["count", "seconds", "speed"]) {
            if (args[key] !== undefined && (typeof args[key] !== "number" || !Number.isFinite(args[key]))) throw new Error(`「${item.title}」的 ${key} 必须是数字。`);
        }
        for (const key of ["references", "videoReferences", "audioReferences"]) {
            if (args[key] !== undefined && (!Array.isArray(args[key]) || args[key].some((reference) => !reference || typeof reference !== "object" || typeof reference.nodeId !== "string" || !reference.nodeId.trim()))) throw new Error(`「${item.title}」的引用必须使用有效节点。`);
        }
        const mode = item.tool === "hub_generate_image" ? "image" : item.tool === "hub_generate_video" ? "video" : "audio";
        const model = typeof args.model === "string" && args.model.trim() ? args.model : config[`${mode}Model`];
        if (!model?.trim()) throw new Error("请先选择对应的生成模型。");
        args.model = model;
        const defaults: Record<string, unknown> = {};
        if (mode === "image") Object.assign(defaults, { size: config.size, count: Number(config.canvasImageCount) || 1, quality: config.quality, background: config.background, imageWatermark: config.imageWatermark, imageOptimizePrompt: config.imageOptimizePrompt, imagePromptPrefix: config.imagePromptPrefix });
        if (mode === "video") Object.assign(defaults, { size: config.size, seconds: Number(config.videoSeconds) || 6, vquality: config.vquality, generateAudio: config.videoGenerateAudio, watermark: config.videoWatermark });
        if (mode === "audio") {
            const audio = normalizeAudioDefaultsForModel(model, { voice: config.audioVoice, format: config.audioFormat, speed: config.audioSpeed, instructions: config.audioInstructions });
            Object.assign(defaults, { voice: audio.voice, format: audio.format, speed: Number(audio.speed), instructions: audio.instructions });
        }
        for (const [key, value] of Object.entries(defaults)) if (args[key] === undefined) args[key] = value;
        return { ...item, args };
    }) } };
}


/** A delayed read must not authorize a write after the conversation has stopped or changed. */
export async function loadZodiacPlanForCurrentTurn(load: (id: string) => Promise<ZodiacStagePlan>, planId: string, projectId: string, signal?: AbortSignal, isCurrent = () => true) {
    signal?.throwIfAborted();
    const plan = await load(planId);
    signal?.throwIfAborted();
    if (!isCurrent()) throw new DOMException("Aborted", "AbortError");
    if (plan.projectId !== projectId) throw new Error("计划不属于当前画布。");
    return plan;
}


/** Bind the next stage to the exact reviewed output, rather than whatever now occupies its node. */
export function validateZodiacStageInput(output: ZodiacPlanOutput, sourceItem: ZodiacPlanWorkItem, nodes: Array<{ id: string; metadata?: { content?: unknown; storageKey?: unknown; currentResultVersionId?: unknown } }>) {
    const node = nodes.find((entry) => entry.id === output.nodeId);
    if (!node) throw new Error("引用结果已移除，请重新审核阶段。");
    if (sourceItem.tool === "hub_canvas_write_node") {
        if (typeof sourceItem.args.content !== "string" || node.metadata?.content !== sourceItem.args.content) throw new Error("引用文本已变化，请重新审核阶段。");
    } else if (!output.storageKey || node.metadata?.storageKey !== output.storageKey || node.metadata?.currentResultVersionId !== output.resultVersionId) {
        throw new Error("引用媒体已变化，请重新审核阶段。");
    }
}


/** Native providers can reuse tool-call IDs every turn; persistent idempotency must include the real user turn. */
export async function zodiacPlanRequestId(turnId: string, taskId: string, callId: string) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify([turnId, taskId, callId])));
    return `plan-${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}


/** Only explicit user reconciliation may bind a saved canvas result to an interrupted item. */
export function zodiacStageRecoveryOutput(item: ZodiacPlanWorkItem, node: Pick<CanvasNodeData, "id" | "type" | "metadata"> | undefined): ZodiacPlanOutput {
    const kind = item.tool === "hub_canvas_write_node" ? "text" : item.tool.slice("hub_generate_".length);
    if (!node || node.type !== kind) throw new Error("请选择对应类型的画布结果。");
    if (kind === "text") {
        if (typeof item.args.content !== "string" || !item.args.content.trim() || node.metadata?.content !== item.args.content) throw new Error("文档正文与本项要求不符。");
        return { nodeId: node.id };
    }
    const storageKey = node.metadata?.storageKey;
    if (node.metadata?.status !== "success" || typeof storageKey !== "string" || !storageKey.startsWith(`${kind}:`)) throw new Error("这个结果尚未保存完成。");
    return { nodeId: node.id, storageKey, ...(node.metadata?.currentResultVersionId ? { resultVersionId: node.metadata.currentResultVersionId } : {}) };
}

export async function prepareZodiacStageRecovery(item: ZodiacPlanWorkItem, nodeId: string, getNodes: () => Pick<CanvasNodeData, "id" | "type" | "metadata">[], persist: () => Promise<void>): Promise<ZodiacPlanOutput> {
    const output = zodiacStageRecoveryOutput(item, getNodes().find((node) => node.id === nodeId));
    await persist();
    const saved = zodiacStageRecoveryOutput(item, getNodes().find((node) => node.id === nodeId));
    if (JSON.stringify(saved) !== JSON.stringify(output)) throw new Error("结果已变化，请重新选择。");
    return saved;
}
