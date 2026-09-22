import assert from "node:assert/strict";
import test from "node:test";
import { executeZodiacStage, loadZodiacPlanForCurrentTurn, materializeZodiacStage, prepareZodiacStageRecovery, validateZodiacStageInput, zodiacStageRecoveryOutput, zodiacPlanRequestId, zodiacStageItemArgs } from "../src/lib/agent/zodiac-stage-execution.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";
import type { ZodiacPlanCommand, ZodiacPlanMutation, ZodiacPlanReply, ZodiacStagePlan } from "../src/lib/agent/zodiac-stage-plan.ts";

function fixture() {
    const plan: ZodiacStagePlan = { version: 1, id: "plan", projectId: "project", title: "创作", workflowId: "custom", revision: 1, createdAt: 0, updatedAt: 0, outline: [{ id: "draft", title: "文案" }], stages: [{ id: "draft", contract: { goal: "完成文案和配图", workItems: [{ id: "image", title: "配图", tool: "hub_generate_image", args: { prompt: "配图" }, dependsOn: ["text"], inputItemIds: ["text"] }, { id: "text", title: "介绍", tool: "hub_canvas_write_node", args: { content: "介绍正文" } }] }, runtime: { status: "doing", attemptId: "attempt", items: { text: { status: "pending", supersededOutputs: [] }, image: { status: "pending", supersededOutputs: [] } } } }] };
    const commands: ZodiacPlanCommand[] = [];
    let current = structuredClone(plan);
    const mutate = async (input: ZodiacPlanMutation): Promise<ZodiacPlanReply> => {
        assert.equal(input.expectedRevision, current.revision);
        commands.push(input.command);
        const command = input.command;
        const runtime = current.stages[0].runtime;
        if (command.type === "claim_item") runtime.items[command.itemId].status = "running";
        if (command.type === "record_item") runtime.items[command.itemId] = { ...runtime.items[command.itemId], status: command.output ? "succeeded" : "failed", output: command.output, error: command.error };
        if (command.type === "finish") { runtime.status = Object.values(runtime.items).every((item) => item.status === "succeeded") ? "waiting_user" : "blocked"; runtime.waitingReason = "result_review"; }
        if (command.type === "cancel") { runtime.status = "blocked"; for (const item of Object.values(runtime.items)) if (item.status === "running") item.status = "interrupted"; }
        current.revision += 1;
        return { plan: structuredClone(current), replayed: false, ...(command.type === "claim_item" ? { claim: { itemId: command.itemId, shouldExecute: true } } : {}) };
    };
    return { plan, commands, mutate, validateInput: () => {}, replace(next: ZodiacStagePlan) { current = structuredClone(next); } };
}

test("stage execution claims dependency order, injects real output references, persists before success, and waits for review", async () => {
    const state = fixture();
    const operations: string[] = [];
    const plan = await executeZodiacStage({ ...state, stageId: "draft", executeTool: async (request) => {
        const args = request.args as Record<string, unknown>;
        const id = request.name === "hub_canvas_write_node" ? "text" : "image";
        operations.push(`execute:${id}`);
        assert.equal(state.commands.at(-1)?.type, "claim_item");
        assert.equal(args.operationId, `draft:${id}`);
        if (id === "image") assert.deepEqual(args.references, [{ nodeId: "text-output" }]);
        return { ok: true, result: { nodeId: `${id}-output` } };
    }, persistOutput: async (output) => { operations.push(`persist:${output.nodeId}`); assert.equal(state.commands.at(-1)?.type, "claim_item"); } });
    assert.deepEqual(operations, ["execute:text", "persist:text-output", "execute:image", "persist:image-output"]);
    assert.equal(plan.stages[0].runtime.status, "waiting_user");
    assert.equal(plan.stages[0].runtime.waitingReason, "result_review");
});

test("retry skips succeeded work and only runs pending failed items", async () => {
    const state = fixture();
    state.plan.stages[0].runtime.items.text = { status: "succeeded", output: { nodeId: "saved-text" }, supersededOutputs: [] };
    state.replace(state.plan);
    const calls: string[] = [];
    await executeZodiacStage({ ...state, stageId: "draft", executeTool: async (request) => { calls.push(request.name); assert.deepEqual((request.args as Record<string, unknown>).references, [{ nodeId: "saved-text" }]); return { ok: true, result: { nodeId: "image" } }; }, persistOutput: async () => {} });
    assert.deepEqual(calls, ["hub_generate_image"]);
});

test("uncertain or replayed claim never launches a paid call", async () => {
    const state = fixture();
    let executed = false;
    await assert.rejects(executeZodiacStage({ ...state, stageId: "draft", mutate: async (input) => ({ ...await state.mutate(input), claim: { itemId: "text", shouldExecute: false } }), executeTool: async () => { executed = true; return { ok: true, result: {} }; }, persistOutput: async () => {} }), /已有执行记录/);
    assert.equal(executed, false);
});

test("a successful side effect with failed persistence remains uncertain instead of becoming a retryable failure", async () => {
    const state = fixture();
    state.plan.stages[0].contract.workItems = [{ id: "image", title: "付费生图", tool: "hub_generate_image", args: { prompt: "产品图" } }];
    delete state.plan.stages[0].runtime.items.text;
    state.replace(state.plan);
    let calls = 0;
    let saved: ZodiacStagePlan | undefined;
    await assert.rejects(executeZodiacStage({ ...state, stageId: "draft", executeTool: async () => { calls += 1; return { ok: true, result: { nodeId: "paid-result", storageKey: "paid-image" } }; }, persistOutput: async () => { throw new Error("保存冲突"); }, onPlan: (plan) => { saved = plan; } }), /结果可能已生成.*节点 paid-result.*保存冲突/);
    assert.equal(calls, 1);
    assert.equal(saved?.stages[0].runtime.items.image.status, "interrupted");
    assert.equal(saved?.stages[0].runtime.status, "blocked");
    assert.equal(state.commands.some((command) => command.type === "record_item"), false);
});

test("cancellation records blocked status and does not start another work item", async () => {
    const state = fixture();
    const controller = new AbortController();
    let calls = 0;
    const plan = await executeZodiacStage({ ...state, stageId: "draft", signal: controller.signal, executeTool: async () => { calls += 1; controller.abort(); return { ok: false, error: "已停止" }; }, persistOutput: async () => {} });
    assert.equal(calls, 1);
    assert.equal(plan.stages[0].runtime.status, "blocked");
    assert.equal(state.commands.at(-1)?.type, "cancel");
    assert.equal(plan.stages[0].runtime.items.text.status, "interrupted");
    assert.equal(state.commands.some((command) => command.type === "record_item"), false, "an aborted wait is not proof of failure and must not unlock retry");
});

test("unapproved stages and missing dependency output fail before execution", async () => {
    const state = fixture();
    state.plan.stages[0].runtime.status = "waiting_user";
    await assert.rejects(executeZodiacStage({ ...state, stageId: "draft", executeTool: async () => { throw new Error("must not execute"); }, persistOutput: async () => {} }), /请先确认/);
    assert.throws(() => zodiacStageItemArgs(state.plan, "draft", state.plan.stages[0].contract.workItems[0]), /尚未完成/);
});


test("operation identity survives retry and follows the server when a contract changes", () => {
    const { plan } = fixture();
    const item = plan.stages[0].contract.workItems[1];
    plan.stages[0].runtime.items.text.operationId = "approved-contract-v1";
    assert.equal(zodiacStageItemArgs(plan, "draft", item).operationId, "approved-contract-v1");
    plan.stages[0].runtime.attemptId = "retry-attempt";
    assert.equal(zodiacStageItemArgs(plan, "draft", item).operationId, "approved-contract-v1");
    plan.stages[0].runtime.items.text.operationId = "replanned-contract-v2";
    assert.equal(zodiacStageItemArgs(plan, "draft", item).operationId, "replanned-contract-v2");
});

test("an approved retry subset does not execute other pending work", async () => {
    const state = fixture();
    state.plan.stages[0].runtime.activeItemIds = ["text"];
    state.replace(state.plan);
    const tools: string[] = [];
    await executeZodiacStage({ ...state, stageId: "draft", executeTool: async (request) => { tools.push(request.name); return { ok: true, result: { nodeId: "text" } }; }, persistOutput: async () => {} });
    assert.deepEqual(tools, ["hub_canvas_write_node"]);
});

test("plans freeze model and generation defaults before approval while retaining explicit choices", () => {
    const config = { imageModel: "channel::image", videoModel: "channel::video", audioModel: "channel::qwen-audio-3.0-tts-flash", size: "16:9", canvasImageCount: "2", videoSeconds: "8", audioVoice: "alloy", audioSpeed: "1.2", audioFormat: "wav", audioInstructions: "温柔", imagePromptPrefix: "品牌", quality: "high", background: "transparent", imageWatermark: "false", imageOptimizePrompt: "true", vquality: "720", videoGenerateAudio: "true", videoWatermark: "false" } as AiConfig;
    const contract = { id: "media", contract: { goal: "生成素材", workItems: [
        { id: "image", title: "图片", tool: "hub_generate_image" as const, args: { prompt: "产品" } },
        { id: "video", title: "视频", tool: "hub_generate_video" as const, args: { prompt: "镜头", model: "selected::video", seconds: 12, size: "9:16" } },
        { id: "audio", title: "配音", tool: "hub_generate_audio" as const, args: { text: "口播" } },
    ] } };
    const result = materializeZodiacStage(contract, config);
    config.imageModel = "other::image";
    config.size = "1:1";
    const [image, video, audio] = result.contract.workItems;
    assert.equal(image.args.model, "channel::image"); assert.equal(image.args.size, "16:9"); assert.equal(image.args.count, 2);
    assert.equal(video.args.model, "selected::video"); assert.equal(video.args.seconds, 12); assert.equal(video.args.size, "9:16");
    assert.equal(audio.args.voice, "longanhuan_v3.6");
    assert.equal(audio.args.speed, 1.2); assert.equal(audio.args.format, "wav");
    assert.equal("model" in contract.contract.workItems[0].args, false);
});


test("a cancelled delayed plan read never reaches the mutation", async () => {
    const controller = new AbortController();
    let finish!: (plan: ZodiacStagePlan) => void;
    let writes = 0;
    const read = loadZodiacPlanForCurrentTurn(() => new Promise((resolve) => { finish = resolve; }), "plan", "project", controller.signal).then(() => { writes += 1; });
    controller.abort();
    finish(fixture().plan);
    await assert.rejects(read, { name: "AbortError" });
    assert.equal(writes, 0);
});

test("a delayed plan read from a previous conversation never reaches mutation", async () => {
    let finish!: (plan: ZodiacStagePlan) => void;
    let current = true;
    let writes = 0;
    const read = loadZodiacPlanForCurrentTurn(() => new Promise((resolve) => { finish = resolve; }), "plan", "project", undefined, () => current).then(() => { writes += 1; });
    current = false;
    finish(fixture().plan);
    await assert.rejects(read, { name: "AbortError" });
    assert.equal(writes, 0);
});


test("dependent work rejects changed text before invoking a generator", async () => {
    const state = fixture();
    state.plan.stages[0].runtime.items.text = { status: "succeeded", output: { nodeId: "saved-text" }, supersededOutputs: [] };
    state.replace(state.plan);
    let generated = false;
    const plan = await executeZodiacStage({ ...state, stageId: "draft", validateInput: (output, item) => validateZodiacStageInput(output, item, [{ id: "saved-text", metadata: { content: "未经审核的新正文" } }]), executeTool: async () => { generated = true; return { ok: true, result: { nodeId: "image" } }; }, persistOutput: async () => {} });
    assert.equal(generated, false);
    assert.equal(plan.stages[0].runtime.items.image.status, "failed");
    assert.match(plan.stages[0].runtime.items.image.error!, /引用文本已变化/);
});

test("reviewed media references require the exact saved storage key and result version", () => {
    const sourceItem = fixture().plan.stages[0].contract.workItems[0];
    const output = { nodeId: "image", storageKey: "media-v1", resultVersionId: "v1" };
    assert.doesNotThrow(() => validateZodiacStageInput(output, sourceItem, [{ id: "image", metadata: { storageKey: "media-v1", currentResultVersionId: "v1" } }]));
    assert.throws(() => validateZodiacStageInput(output, sourceItem, [{ id: "image", metadata: { storageKey: "media-v2", currentResultVersionId: "v2" } }]), /引用媒体已变化/);
    assert.throws(() => validateZodiacStageInput(output, sourceItem, [{ id: "image", metadata: { storageKey: "media-v1", currentResultVersionId: "v2" } }]), /引用媒体已变化/);
    assert.throws(() => validateZodiacStageInput(output, sourceItem, []), /引用结果已移除/);
});


test("malformed approved parameters are rejected instead of silently ignored by generation tools", () => {
    const stage = fixture().plan.stages[0];
    const image = stage.contract.workItems[0];
    const config = { imageModel: "channel::image", size: "1:1", canvasImageCount: "1" } as AiConfig;
    image.args.count = "2";
    assert.throws(() => materializeZodiacStage(stage, config), /count 必须是数字/);
    delete image.args.count;
    image.args.references = [{ missingNode: "id" }];
    assert.throws(() => materializeZodiacStage(stage, config), /引用必须使用有效节点/);
});


test("provider fallback call IDs are isolated per user turn while retries within the same turn remain stable", async () => {
    const first = await zodiacPlanRequestId("user-turn-a", "reused-task", "native-1-1");
    const replay = await zodiacPlanRequestId("user-turn-a", "reused-task", "native-1-1");
    const second = await zodiacPlanRequestId("user-turn-b", "reused-task", "native-1-1");
    const sibling = await zodiacPlanRequestId("user-turn-a", "another-task", "native-1-1");
    assert.equal(first, replay);
    assert.notEqual(first, second);
    assert.notEqual(first, sibling);
    assert.ok(first.length <= 160);
    const saved = new Map<string, string>();
    let writes = 0;
    const apply = (requestId: string, body: string) => { if (saved.has(requestId)) { assert.equal(saved.get(requestId), body); return; } saved.set(requestId, body); writes += 1; };
    apply(first, "first plan edit"); apply(replay, "first plan edit"); apply(second, "different plan edit");
    assert.equal(writes, 2);
});


test("uncertain provider outcomes remain interrupted until the user reconciles them", async () => {
    const state = fixture();
    let saved: ZodiacStagePlan | undefined;
    await assert.rejects(executeZodiacStage({ ...state, stageId: "draft", executeTool: async () => ({ ok: false, error: "供应商结果待核对", requiresReconciliation: true, nodeId: "pending-result" }), persistOutput: async () => {}, onPlan: (plan) => { saved = plan; } }), /节点 pending-result/);
    assert.equal(saved?.stages[0].runtime.items.text.status, "interrupted");
    assert.equal(state.commands.some((command) => command.type === "record_item"), false);
});


test("recovery uses only actual matching complete canvas results", () => {
    const text = fixture().plan.stages[0].contract.workItems[1];
    const image = fixture().plan.stages[0].contract.workItems[0];
    assert.deepEqual(zodiacStageRecoveryOutput(text, { id: "saved", type: "text", metadata: { content: "介绍正文" } }), { nodeId: "saved" });
    assert.throws(() => zodiacStageRecoveryOutput(text, { id: "wrong", type: "text", metadata: { content: "其他正文" } }), /正文.*不符/);
    assert.throws(() => zodiacStageRecoveryOutput(text, undefined), /对应类型/);
    assert.throws(() => zodiacStageRecoveryOutput(image, { id: "wrong-kind", type: "video", metadata: { status: "success", storageKey: "video:ready" } }), /对应类型/);
    assert.throws(() => zodiacStageRecoveryOutput(image, { id: "pending", type: "image", metadata: { status: "loading", storageKey: "image:pending" } }), /尚未保存完成/);
    assert.throws(() => zodiacStageRecoveryOutput(image, { id: "url-only", type: "image", metadata: { status: "success", content: "https://example.invalid/image.png" } }), /尚未保存完成/);
    assert.deepEqual(zodiacStageRecoveryOutput(image, { id: "paid-result", type: "image", metadata: { status: "success", storageKey: "image:ready", currentResultVersionId: "version-1" } }), { nodeId: "paid-result", storageKey: "image:ready", resultVersionId: "version-1" });
});

test("adopting an interrupted paid result waits for persistence and never reruns generation", async () => {
    const state = fixture();
    const image = state.plan.stages[0].contract.workItems[0];
    const nodes = [{ id: "paid-result", type: "image", metadata: { status: "success" as const, storageKey: "image:ready", currentResultVersionId: "version-1" } }];
    const steps: string[] = [];
    const output = await prepareZodiacStageRecovery(image, "paid-result", () => nodes, async () => { steps.push("flush"); });
    const command: ZodiacPlanCommand = { type: "resolve_item", stageId: "draft", itemId: image.id, output };
    steps.push("resolve_item");
    assert.deepEqual(steps, ["flush", "resolve_item"]);
    assert.deepEqual(command.output, { nodeId: "paid-result", storageKey: "image:ready", resultVersionId: "version-1" });
});

test("recovery refuses a failed save or a result changed while saving", async () => {
    const image = fixture().plan.stages[0].contract.workItems[0];
    const nodes = [{ id: "result", type: "image", metadata: { status: "success" as const, storageKey: "image:ready", currentResultVersionId: "v1" } }];
    await assert.rejects(prepareZodiacStageRecovery(image, "result", () => nodes, async () => { throw new Error("save conflict"); }), /save conflict/);
    await assert.rejects(prepareZodiacStageRecovery(image, "result", () => nodes, async () => { nodes[0].metadata.currentResultVersionId = "v2"; }), /结果已变化/);
    await assert.rejects(prepareZodiacStageRecovery(image, "result", () => nodes, async () => { nodes.length = 0; }), /对应类型/);
});

test("malformed native stage payloads report the exact field instead of a generic incomplete error", () => {
    const config = {} as AiConfig;
    assert.throws(() => materializeZodiacStage(undefined as never, config, "firstStage"), /firstStage 缺失或不是对象/);
    assert.throws(() => materializeZodiacStage({ id: "first", workItems: [] } as never, config, "firstStage"), /firstStage.contract 缺失或不是对象.*id、workItems/);
    assert.throws(() => materializeZodiacStage({ id: "first", contract: { goal: "goal" }, workItems: [] } as never, config, "firstStage"), /firstStage.contract.workItems 必须是非空数组.*goal/);
});
