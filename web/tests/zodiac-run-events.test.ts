import assert from "node:assert/strict";
import test from "node:test";

import { createZodiacRun, finishZodiacRun, interruptZodiacRun, markZodiacRunApplying, markZodiacRunPlanning, settleZodiacRun, shouldShowZodiacRun } from "../src/lib/agent/zodiac-run-events.ts";

test("Zodiac run exposes context, planning and confirmation as stable events", () => {
    const initial = createZodiacRun();
    assert.equal(initial.phases[0].status, "active");

    const planning = markZodiacRunPlanning(initial);
    assert.equal(planning.phases[0].status, "done");
    assert.equal(planning.phases[1].status, "active");

    const waiting = finishZodiacRun(planning, true);
    assert.equal(waiting.status, "waiting");
    assert.deepEqual(waiting.phases.map((phase) => phase.status), ["done", "done", "active"]);

    const applying = markZodiacRunApplying(waiting);
    assert.equal(applying.status, "running");
    assert.equal(applying.phases.at(-1)?.label, "正在加入画布");

    const applied = settleZodiacRun(applying, "applied");
    assert.equal(applied.status, "completed");
    assert.equal(applied.phases.at(-1)?.label, "已加入画布");

    const failed = settleZodiacRun(markZodiacRunApplying(waiting), "failed");
    assert.equal(failed.status, "error");
    assert.equal(failed.phases.at(-1)?.status, "error");
});

test("Zodiac run records a stopped or failed active phase", () => {
    const planning = markZodiacRunPlanning(createZodiacRun());
    assert.equal(interruptZodiacRun(planning).status, "stopped");
    assert.equal(interruptZodiacRun(planning, true).phases[1].status, "error");
});

test("only an active turn occupies the conversation with a progress card", () => {
    const running = createZodiacRun();
    const waiting = finishZodiacRun(markZodiacRunPlanning(running), true);
    assert.equal(shouldShowZodiacRun(running), true);
    assert.equal(shouldShowZodiacRun(waiting), false);
    assert.equal(shouldShowZodiacRun(finishZodiacRun(running, false)), false);
    assert.equal(shouldShowZodiacRun(interruptZodiacRun(running)), false);
    assert.equal(shouldShowZodiacRun(interruptZodiacRun(running, true)), false);
});
