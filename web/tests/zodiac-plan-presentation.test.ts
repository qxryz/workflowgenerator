import assert from "node:assert/strict";
import test from "node:test";
import { zodiacPlanMessageAnchor, zodiacStageExecutionState } from "../src/lib/agent/zodiac-plan-presentation.ts";
import { zodiacConfirmedCanvasFailures } from "../src/lib/agent/zodiac-stage-reconciliation.ts";
import { GenerationError, generationBatchError, generationErrorWithMessage, generationFailureCode } from "../src/lib/generation-error.ts";
import { buildMiniMaxImageRequest } from "../src/lib/minimax-contract.ts";
import type { ZodiacStagePlan } from "../src/lib/agent/zodiac-stage-plan.ts";
import type { CanvasNodeMetadata } from "../src/types/canvas.ts";

test("plan cards stay with their authoring turn when later replies or execution updates arrive", () => {
    const items = [{ id: "user1", role: "user" }, { id: "run1", role: "tool", activity: [{ startedAt: 100, at: 300 }] }, { id: "answer1", role: "assistant" }, { id: "user2", role: "user" }, { id: "answer2", role: "assistant" }];
    assert.equal(zodiacPlanMessageAnchor({ id: "plan", createdAt: 200 }, items), "answer1");
    assert.equal(zodiacPlanMessageAnchor({ id: "plan", createdAt: 200 }, [...items, { id: "user3", role: "user" }]), "answer1");
    assert.equal(zodiacPlanMessageAnchor({ id: "plan", createdAt: 200 }, items.map(item => item.id === "answer2" ? { ...item, planIds: ["plan"] } : item)), "answer2");
    assert.equal(zodiacPlanMessageAnchor({ id: "legacy", createdAt: 0 }, items), "answer1");
    assert.equal(zodiacPlanMessageAnchor(null, items), undefined);
});

test("preflight evidence survives adapter error messages; an uncertain batch cannot unlock retry", () => {
    let failure: unknown;
    try { buildMiniMaxImageRequest("image-01", { prompt: "牛".repeat(1501), ratio: "1:1", count: 1 }); } catch (error) { failure = error; }
    assert.equal(generationFailureCode(failure), "GENERATION_NOT_SUBMITTED");
    assert.equal(generationFailureCode(generationErrorWithMessage(failure, "提示词太长")), "GENERATION_NOT_SUBMITTED");
    assert.equal(generationFailureCode(generationBatchError([failure, new GenerationError("无效参数") ])), "GENERATION_NOT_SUBMITTED");
    assert.equal(generationFailureCode(generationBatchError([failure, new Error("连接中断") ])), undefined);
    assert.equal(generationFailureCode(generationBatchError([failure, undefined])), undefined);
    assert.equal(generationFailureCode(new Error("MiniMax 图片提示词不能超过 1500 个字符")), undefined, "display text alone is not execution evidence");
});

function recoveryFixture() {
    const plan: ZodiacStagePlan = { version: 2, id: "plan", projectId: "project", sessionId: "session", title: "创作", workflowId: "custom", revision: 4, createdAt: 100, updatedAt: 400, outline: [{ id: "stage", title: "配图" }], stages: [{ id: "stage", contract: { goal: "配图", workItems: [{ id: "image", title: "配图", tool: "hub_generate_image", args: { prompt: "牛".repeat(1501), model: "qa::image-01" } }] }, runtime: { status: "blocked", attemptId: "attempt", blockedReason: "执行已停止", items: { image: { status: "interrupted", attemptId: "attempt", operationId: "op", supersededOutputs: [] } } } }] };
    const meta: CanvasNodeMetadata = { agentSessionId: "session", agentTurnId: "attempt", agentOperationId: "op", status: "error" };
    const error = "MiniMax 图片提示词不能超过 1500 个字符";
    const nodes = [{ id: "action", metadata: { ...meta, model: "qa::image-01", prompt: "牛".repeat(1000) } }, { id: "slot", metadata: { ...meta, role: "result-slot" as const, slotState: "error" as const, resultSlotSourceNodeId: "action", errorDetails: error, resultVersions: [{ id: "failure", status: "error" as const, artifacts: [] as [], errorDetails: error }] } }];
    return { plan, nodes, error };
}

test("legacy local rejection is recoverable only for the matching session, operation, attempt, and persisted failure", () => {
    const { plan, nodes, error } = recoveryFixture();
    assert.deepEqual(zodiacConfirmedCanvasFailures(plan, "stage", nodes), [{ itemId: "image", error }]);
    for (const patch of [{ agentTurnId: "older" }, { agentSessionId: "other" }, { agentOperationId: "other" }, { status: "loading" }, { storageKey: "image:saved" }, { errorDetails: "网络超时" }]) {
        const altered = structuredClone(nodes);
        Object.assign(altered[1].metadata, patch);
        assert.deepEqual(zodiacConfirmedCanvasFailures(plan, "stage", altered), []);
    }
    nodes[0].metadata.model = "qa::other-model";
    assert.deepEqual(zodiacConfirmedCanvasFailures(plan, "stage", nodes), []);
});

test("stage presentation distinguishes running, uncertain and definitive failure", () => {
    const { plan } = recoveryFixture();
    const stage = plan.stages[0];
    assert.deepEqual(zodiacStageExecutionState(stage), { running: false, needsReconciliation: true, canEdit: false, error: "执行已结束，部分结果仍需核对。" });
    stage.runtime.items.image.status = "failed";
    stage.runtime.items.image.error = "提示词超出限制";
    assert.deepEqual(zodiacStageExecutionState(stage), { running: false, needsReconciliation: false, canEdit: true, error: "提示词超出限制" });
    stage.runtime.status = "doing";
    assert.equal(zodiacStageExecutionState(stage).running, true);
    assert.equal(zodiacStageExecutionState(stage).canEdit, false);
});
