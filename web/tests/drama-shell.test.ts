import assert from "node:assert/strict";
import test from "node:test";

import { formatClock, formatElapsed, relativeTime } from "../src/lib/drama/format.ts";
import { isUnsettled, pickStageRuns, sameScope } from "../src/lib/drama/stage-runs.ts";
import type { DramaRun } from "../src/lib/drama/types.ts";

const run = (id: string, createdAt: number, patch: Partial<DramaRun> = {}): DramaRun => ({
    id, episodeId: null, stage: "chapter", scope: {}, instruction: "", model: "", status: "accepted", parentId: null, error: "", createdAt, finishedAt: null, ...patch,
});

test("pickStageRuns prefers the live run, then the newest awaiting review, then the newest", () => {
    const runs = [run("a", 1, { status: "review" }), run("b", 2, { status: "accepted" }), run("c", 3, { status: "rejected" })];
    assert.equal(pickStageRuns(runs, "chapter").current?.id, "a");
    assert.equal(pickStageRuns([...runs, run("d", 0, { status: "running" })], "chapter").current?.id, "d");
    assert.equal(pickStageRuns(runs.slice(1), "chapter").current?.id, "c");
    assert.deepEqual(pickStageRuns(runs, "chapter").history.map((item) => item.id), ["c", "b", "a"]);
    assert.equal(pickStageRuns(runs, "settings").current, undefined);
});

test("pickStageRuns applies the scope filter before choosing", () => {
    const runs = [run("a", 1, { status: "review", scope: { ord: 1 } }), run("b", 2, { status: "running", scope: { ord: 2 } })];
    assert.equal(pickStageRuns(runs, "chapter", (item) => item.scope.ord === 1).current?.id, "a");
});

test("sameScope: empty scope matches any run of that episode, a given scope must be equal", () => {
    const chapterTwo = run("a", 1, { scope: { ord: 2 } });
    assert.equal(sameScope(chapterTwo, undefined), true);
    assert.equal(sameScope(chapterTwo, { ord: 2 }), true);
    assert.equal(sameScope(chapterTwo, { ord: 3 }), false);
    assert.equal(sameScope(chapterTwo, undefined, "e1"), false);
    assert.equal(sameScope(run("b", 1, { episodeId: "e1" }), {}, "e1"), true);
});

test("sameScope: reviews of other chapters do not block each other, as the server locks on the exact scope", () => {
    const review = run("r", 1, { scope: { target: "chapters", chapterOrds: [1, 2] } });
    assert.equal(sameScope(review, { target: "chapters", chapterOrds: [1, 2] }), true);
    assert.equal(sameScope(review, { target: "chapters", chapterOrds: [3] }), false);
    assert.equal(sameScope(review, { target: "settings" }), false);
});

test("isUnsettled: everything but adopted and dropped results", () => {
    assert.deepEqual(
        (["running", "review", "failed", "stopped", "accepted", "rejected"] as const).map((status) => isUnsettled({ status })),
        [true, true, true, true, false, false],
    );
});

test("time formatting", () => {
    assert.equal(formatElapsed(83_000), "01:23");
    assert.equal(formatElapsed(-5), "00:00");
    assert.match(formatClock(new Date(2026, 9, 25, 14, 3).getTime()), /^10-25 14:03$/);
    const t = (message: string, values?: Record<string, string | number>) => message.replace(/\{(\w+)\}/g, (_, key: string) => String(values?.[key]));
    const now = 10_000_000_000;
    assert.equal(relativeTime(now - 30_000, now, t), "刚刚");
    assert.equal(relativeTime(now - 5 * 60_000, now, t), "5 分钟前");
    assert.equal(relativeTime(now - 3 * 3_600_000, now, t), "3 小时前");
    assert.equal(relativeTime(now - 2 * 86_400_000, now, t), "2 天前");
});
