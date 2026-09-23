import assert from "node:assert/strict";
import test from "node:test";
import { resolveZodiacPlanConfirmation } from "../src/lib/agent/zodiac-plan-confirmation.ts";
import { readZodiacWorkflow } from "../src/lib/agent/zodiac-workflows.ts";
import type { ZodiacStagePlan } from "../src/lib/agent/zodiac-stage-plan.ts";

function plan(id = "one", reason: "plan_review" | "result_review" = "plan_review"): ZodiacStagePlan {
    return { version: 2, id, projectId: "canvas", sessionId: "session", title: id, workflowId: "custom", revision: 4,
        outline: [{ id: "stage", title: "阶段" }], createdAt: 1, updatedAt: 1,
        stages: [{ id: "stage", contract: { goal: "交付", workItems: [] }, runtime: { status: "waiting_user", waitingReason: reason, items: {} } }],
    };
}

test("short confirmation binds only the unique visible stage and its reviewed revision", () => {
    const current = plan();
    const result = resolveZodiacPlanConfirmation("继续。", [current], "session");
    assert.equal(result.kind, "action");
    if (result.kind === "action") {
        assert.deepEqual(result.command, { type: "approve", stageId: "stage" });
        assert.equal(result.plan.revision, 4);
    }
    const accepted = resolveZodiacPlanConfirmation("结果通过", [plan("one", "result_review")], "session");
    assert.equal(accepted.kind === "action" && accepted.command.type, "accept");
    assert.equal(resolveZodiacPlanConfirmation("继续", [current, plan("two")], "session").kind, "ambiguous");
    assert.equal(resolveZodiacPlanConfirmation("继续", [current, plan("two", "result_review")], "session").kind, "ambiguous");
});

test("choices, adjustments, questions, unrelated sessions and pending questions are not authorization", () => {
    for (const text of ["16:9", "继续但改成三张", "不要执行", "可以吗？", "确认执行？", "先看看结果", "我会回复‘确认执行’", "结果不错，先换背景"])
        assert.equal(resolveZodiacPlanConfirmation(text, [plan()], "session").kind, "none", text);
    assert.equal(resolveZodiacPlanConfirmation("确认执行", [plan()], "other").kind, "none");
    assert.equal(resolveZodiacPlanConfirmation("确认执行", [plan()], "session", true).kind, "none");
    assert.equal(resolveZodiacPlanConfirmation("结果通过", [plan()], "session").kind, "none");
});

test("retry requires explicit scope and never retries uncertain items", () => {
    const blocked = plan();
    blocked.stages[0].runtime = { status: "blocked", items: { failed: { status: "failed", supersededOutputs: [] } } };
    assert.equal(resolveZodiacPlanConfirmation("继续", [blocked], "session").kind, "none");
    const result = resolveZodiacPlanConfirmation("仅重试未完成项", [blocked], "session");
    assert.equal(result.kind === "action" && result.command.type, "retry");
    blocked.stages[0].runtime.items.failed.status = "interrupted";
    assert.equal(resolveZodiacPlanConfirmation("仅重试未完成项", [blocked], "session").kind, "none");
});

test("workflow reads expose current-stage guidance without injecting all stage bodies", () => {
    const outline = readZodiacWorkflow({ id: "drama-series" });
    assert.ok("stages" in outline && outline.stages.every(stage => !("guidance" in stage)));
    const stage = readZodiacWorkflow({ id: "drama-series", stageId: "storyboard" });
    assert.ok("stage" in stage && stage.stage.guidance.includes("原文对白"));
    assert.throws(() => readZodiacWorkflow({ id: "drama-series", stageId: "unknown" }), /阶段不存在/);
});
