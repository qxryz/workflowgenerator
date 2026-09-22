import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (path: string) => readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("external canvas tools validate the whole request before normalization or effects", () => {
    const text = source("components/agent/zodic-panel.tsx");
    const entry = text.slice(text.indexOf("const applyToolRequest ="), text.indexOf("const requestItems ="));
    assert.match(entry, /!isCurrentRequest\(\) \|\| toolSignal\.aborted/);
    assert.ok(entry.indexOf("validateZodiacUi(request.args)") < entry.indexOf("normalizeZodiacDecisionUi(request.args)"));
    assert.ok(entry.indexOf("validateZodiacOps(request.args)") < entry.indexOf("normalizeZodiacCanvasOps(args.ops)"));
    assert.match(entry, /catch \(error\) \{ return \{ ok: false, error:/);
});


test("active plans gate direct root mutations and plan authoring waits for user review", () => {
    const panel = source("components/agent/zodic-panel.tsx");
    const tools = panel.slice(panel.indexOf("const applyToolRequest ="), panel.indexOf("const requestItems ="));
    assert.match(tools, /plan\.sessionId === sessionRef\.current\.id && zodiacPlanFrontier\(plan\)/);
    assert.ok(tools.indexOf("listZodiacPlans(requestSessionKey)") < tools.indexOf("executeHubTool(request"));
    assert.match(tools, /status: "waiting_user"/);
    assert.match(tools, /firstStage: materializeZodiacStage/);
    assert.match(tools, /stage: materializeZodiacStage/);
    assert.doesNotMatch(tools, /type: "approve"|type: "accept"|type: "retry"/);
});
