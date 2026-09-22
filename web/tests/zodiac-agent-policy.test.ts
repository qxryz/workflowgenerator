import assert from "node:assert/strict";
import test from "node:test";
import { createZodiacToolDispatcher, zodiacRoleAllowsTool, zodiacToolsForRole, type ZodiacRoleContext } from "../src/lib/agent/zodiac-agent-policy.ts";
const actor = (role: ZodiacRoleContext["role"]): ZodiacRoleContext => ({ role, rootSessionId: "root", taskId: "task", source: { kind: "model" } });
const tool = (name: string) => ({ name, description: name, parameters: { type: "object" } });
const call = (name: string, args = {}, callId = name) => ({ name, args, callId });

test("role maximums exclude generation, delegation and runtime state mutations", () => {
    const catalog = ["hub_read", "workflow", "hub_plan_write", "hub_generate_image", "task", "hub_plan_approve", "hub_plan_record_item", "hub_canvas_write_node"].map(tool);
    assert.deepEqual(
        zodiacToolsForRole(actor("router"), catalog).map((entry) => entry.name),
        ["hub_read", "workflow"],
    );
    assert.deepEqual(
        zodiacToolsForRole(actor("planner"), catalog).map((entry) => entry.name),
        ["hub_read", "workflow", "hub_plan_write"],
    );
    assert.equal(zodiacRoleAllowsTool(actor("executor"), "hub_generate_image"), false);
    const executor = { ...actor("executor"), planId: "plan", stageId: "stage", approvedTools: ["hub_generate_image", "task", "hub_plan_write"] };
    assert.equal(zodiacRoleAllowsTool(executor, "hub_generate_image"), true);
    assert.equal(zodiacRoleAllowsTool(executor, "task"), false);
    assert.equal(zodiacRoleAllowsTool(executor, "hub_plan_write"), false);
    assert.equal(zodiacRoleAllowsTool(actor("orchestrator"), "hub_plan_approve"), false);
});

test("dispatch enforces role even if supplied an over-broad catalog", async () => {
    let executed = false;
    const guard = createZodiacToolDispatcher({
        context: actor("router"),
        tools: () => [tool("hub_generate_image")],
        execute: () => {
            executed = true;
            return { ok: true };
        },
    });
    assert.equal((await guard.dispatch(call("hub_generate_image"))).ok, false);
    assert.equal(executed, false);
});

test("duplicate mutations reuse the first receipt instead of executing twice", async () => {
    let calls = 0;
    const guard = createZodiacToolDispatcher({ context: actor("orchestrator"), tools: () => [tool("hub_generate_image")], execute: async () => ({ ok: true, result: { nodeId: `node-${++calls}` } }) });
    const first = guard.dispatch(call("hub_generate_image", { prompt: "hello", count: 1 }, "one"));
    const second = guard.dispatch(call("hub_generate_image", { count: 1, prompt: "hello" }, "two"));
    assert.deepEqual(await first, await second);
    assert.equal(calls, 1);
    assert.equal((await guard.dispatch(call("hub_generate_image", { prompt: "changed" }, "one"))).ok, false);
});

test("plan review pauses dispatch and never implies execution approval", async () => {
    const ran: string[] = [];
    const guard = createZodiacToolDispatcher({
        context: actor("orchestrator"),
        tools: () => [tool("hub_plan_write"), tool("hub_generate_image")],
        execute: (request) => {
            ran.push(request.name);
            return { ok: true, result: { status: "waiting_user" } };
        },
    });
    await guard.dispatch(call("hub_plan_write"));
    assert.equal((await guard.dispatch(call("hub_generate_image"))).ok, false);
    assert.deepEqual(ran, ["hub_plan_write"]);
});

test("skill grants require successful loading, trusted metadata, and role intersection", async () => {
    let loaded = false;
    const guard = createZodiacToolDispatcher({
        context: actor("planner"),
        tools: () => [tool("skill")],
        skillTools: () => ["hub_plan_get", "hub_generate_image", "task"],
        execute: () => (loaded ? { ok: true, result: { tools: ["hub_generate_video"] } } : { ok: false, error: "missing" }),
    });
    await guard.dispatch(call("skill", { name: "skill" }, "missing"));
    assert.deepEqual(guard.grantedTools, []);
    loaded = true;
    await guard.dispatch(call("skill", { name: "skill" }, "loaded"));
    assert.deepEqual(guard.grantedTools, ["hub_plan_get"]);
});

test("pending tool is cancelled by the parent and no later tool executes", async () => {
    const controller = new AbortController();
    const guard = createZodiacToolDispatcher({ context: { ...actor("planner"), signal: controller.signal }, tools: () => [tool("hub_plan_get")], execute: () => new Promise(() => undefined) });
    const pending = guard.dispatch(call("hub_plan_get"));
    controller.abort();
    await assert.rejects(pending, { name: "AbortError" });
    await assert.rejects(guard.dispatch(call("hub_plan_get")), { name: "AbortError" });
});

test("read calls are bounded and plan-bound roles cannot edit other plans", async () => {
    const guard = createZodiacToolDispatcher({ context: { ...actor("planner"), planId: "ours" }, maxCalls: 2, tools: () => [tool("hub_plan_get")], execute: () => ({ ok: true }) });
    assert.equal((await guard.dispatch(call("hub_plan_get", { planId: "other" }, "one"))).ok, false);
    assert.equal((await guard.dispatch(call("hub_plan_get", { planId: "ours" }, "two"))).ok, true);
    await assert.rejects(guard.dispatch(call("hub_plan_get", { planId: "ours" }, "three")), /调用已达到上限/);
});
