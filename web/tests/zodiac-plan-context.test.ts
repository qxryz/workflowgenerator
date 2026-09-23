import test from "node:test";
import assert from "node:assert/strict";
import { zodiacPlanContext } from "../src/lib/agent/zodiac-plan-context.ts";
import type { ZodiacStagePlan } from "../src/lib/agent/zodiac-stage-plan.ts";

const content = "正文".repeat(20000);
const plan = { id: "plan", revision: 4, plannerSessionId: "ses_planner", title: "广告", workflowId: "ad-tvc", outline: [{ id: "copy", title: "文案" }], stages: [{ id: "copy", contract: { goal: "文案", workItems: [{ id: "doc", title: "脚本", tool: "hub_canvas_write_node", args: { content } }] }, runtime: { status: "waiting_user", items: { doc: { status: "pending" } } } }] } as ZodiacStagePlan;
test("summary preserves resume identity and progress without injecting document bodies", () => {
    const summary = zodiacPlanContext(plan);
    assert.equal(summary.plannerSessionId, "ses_planner");
    assert.equal(summary.revision, 4);
    assert.equal(summary.currentStageId, "copy");
    assert.ok(JSON.stringify(summary).length < 2000);
    assert.doesNotMatch(JSON.stringify(summary), /正文/);
});
test("paged items disclose omitted bodies, which are readable without truncation across text pages", () => {
    const items = zodiacPlanContext(plan, { view: "items" }) as any;
    assert.equal(items.partial, true);
    assert.equal(items.workItems[0].args.content.omitted, true);
    let collected = "", offset: number | null = 0;
    while (offset !== null) {
        const page = zodiacPlanContext(plan, { view: "text", itemId: "doc", field: "content", offset, limit: 8000 }) as any;
        collected += page.text;
        offset = page.nextOffset;
    }
    assert.equal(collected, content);
    assert.throws(() => zodiacPlanContext(plan, { view: "items", offset: -1 }), /范围无效/);
    assert.throws(() => zodiacPlanContext(plan, { view: "text", itemId: "doc", field: "runtime" }), /请选择/);
});
