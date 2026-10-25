import assert from "node:assert/strict";
import test from "node:test";

import { runQueue } from "../src/lib/drama/media/queue.ts";
import { adoptedArtifact, artifactState, humanError, isStale, ownerState, requestPlan, requestPrompt } from "../src/lib/drama/media/state.ts";
import type { RefImage, ReferencePlan } from "../src/lib/drama/media/references.ts";
import type { DramaArtifact } from "../src/lib/drama/types.ts";

const artifact = (id: string, extra: Partial<DramaArtifact> = {}): DramaArtifact => ({
    id, entityId: null, shotId: "s1", kind: "image", status: "ready", mediaKey: `k-${id}`, mediaUrl: `/media/${id}.png`, mime: "image/png", width: 1024, height: 576, durationMs: null,
    prompt: "p", model: "ch::m", params: {}, inputHash: "h1", providerTask: null, error: "", adopted: false, createdAt: 0, updatedAt: 0, ...extra,
});
const ref = (id: string): RefImage => ({ artifactId: id, url: `/media/${id}.png`, storageKey: `k-${id}`, name: id });

const gate = () => {
    let open!: () => void;
    const opened = new Promise<void>((resolve) => (open = resolve));
    return { opened, open };
};

test("runQueue never runs more than the limit and keeps result order", async () => {
    let running = 0;
    let peak = 0;
    const started: number[] = [];
    const jobs = Array.from({ length: 6 }, (_, index) => async () => {
        started.push(index);
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 5 + (index % 3) * 4));
        running -= 1;
        return index * 10;
    });
    const results = await runQueue(jobs, 2);
    assert.equal(peak, 2);
    assert.deepEqual(started, [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(results.map((result) => (result.status === "fulfilled" ? result.value : null)), [0, 10, 20, 30, 40, 50]);
});

test("runQueue defaults to two at a time and a failure does not stop the others", async () => {
    let running = 0;
    let peak = 0;
    const job = (fail: boolean) => async () => {
        running += 1;
        peak = Math.max(peak, running);
        await new Promise((resolve) => setTimeout(resolve, 3));
        running -= 1;
        if (fail) throw new Error("boom");
        return "ok";
    };
    const results = await runQueue([job(false), job(true), job(false), job(false)]);
    assert.equal(peak, 2);
    assert.deepEqual(results.map((result) => result.status), ["fulfilled", "rejected", "fulfilled", "fulfilled"]);
});

test("runQueue stops starting jobs after abort; running ones finish", async () => {
    const controller = new AbortController();
    const first = gate();
    const ran: number[] = [];
    const jobs = [0, 1, 2, 3].map((index) => async () => {
        ran.push(index);
        if (index === 0) await first.opened;
        return index;
    });
    const done = runQueue(jobs, 1, controller.signal);
    await new Promise((resolve) => setTimeout(resolve, 5));
    controller.abort();
    first.open();
    const results = await done;
    assert.deepEqual(ran, [0]);
    assert.equal(results[0].status, "fulfilled");
    for (const result of results.slice(1)) {
        assert.equal(result.status, "rejected");
        assert.equal((result as PromiseRejectedResult).reason.name, "AbortError");
    }
});

test("runQueue with no jobs resolves empty", async () => {
    assert.deepEqual(await runQueue([], 2), []);
});

test("artifactState: pending, failed, adopted, ready, stale", () => {
    assert.equal(artifactState(artifact("a", { status: "pending" }), "h2"), "pending");
    assert.equal(artifactState(artifact("a", { status: "failed" }), "h2"), "failed");
    assert.equal(artifactState(artifact("a"), "h1"), "ready");
    assert.equal(artifactState(artifact("a", { adopted: true }), "h1"), "adopted");
    assert.equal(artifactState(artifact("a"), "h2"), "stale");
    assert.equal(artifactState(artifact("a", { adopted: true }), "h2"), "stale");
    assert.equal(artifactState(artifact("a"), undefined), "ready");
});

test("uploaded and library artifacts never go stale", () => {
    for (const model of ["upload", "library"]) {
        assert.equal(isStale(artifact("a", { model, inputHash: "" }), "h2"), false);
        assert.equal(artifactState(artifact("a", { model, inputHash: "", adopted: true }), "h2"), "adopted");
    }
});

test("an artifact with unknown inputs (empty inputHash) is never out of date", () => {
    assert.equal(isStale(artifact("a", { inputHash: "" }), "h2"), false);
    assert.equal(artifactState(artifact("a", { inputHash: "" }), "h2"), "ready");
    assert.equal(artifactState(artifact("a", { inputHash: "", adopted: true }), "h2"), "adopted");
    assert.equal(ownerState([artifact("a", { inputHash: "", adopted: true })], "h2"), "adopted");
    assert.equal(isStale(artifact("a", { inputHash: "h1" }), "h2"), true, "a recorded hash that differs still goes stale");
});

test("ownerState: adopted wins, then pending, then drafts, then failed", () => {
    assert.equal(ownerState([]), "none");
    assert.equal(ownerState([artifact("a", { status: "failed" })]), "failed");
    assert.equal(ownerState([artifact("a", { status: "failed" }), artifact("b")]), "ready");
    assert.equal(ownerState([artifact("a", { status: "pending" }), artifact("b", { adopted: true })]), "adopted");
    assert.equal(ownerState([artifact("a", { status: "pending" }), artifact("b")]), "pending");
    assert.equal(ownerState([artifact("b", { adopted: true })], "other"), "stale");
    assert.equal(adoptedArtifact([artifact("a"), artifact("b", { adopted: true }), artifact("c", { adopted: true, status: "failed" })])?.id, "b");
});

test("requestPlan puts the first frame first and renumbers the sheet notes", () => {
    const plan: ReferencePlan = { images: [ref("sheet1"), ref("sheet2")], notes: ["图片1：人物A", "图片2：场景B"] };
    const out = requestPlan(plan, ref("frame"), false);
    assert.deepEqual(out.images.map((image) => image.artifactId), ["frame", "sheet1", "sheet2"]);
    assert.equal(out.notes.length, 3);
    assert.match(out.notes[0], /^图片1：首帧/);
    assert.equal(out.notes[1], "图片2：人物A");
    assert.equal(out.notes[2], "图片3：场景B");
    assert.match(requestPlan(plan, ref("frame"), true).notes[0], /^图片1：opening frame/);
});

test("requestPlan leaves a plan without a first frame untouched and honours plan.firstFrame", () => {
    const plan: ReferencePlan = { images: [ref("sheet1")], notes: ["图片1：人物A"] };
    assert.equal(requestPlan(plan, undefined, false), plan);
    const withFrame = requestPlan({ ...plan, firstFrame: ref("f") }, undefined, false);
    assert.equal(withFrame.images[0].artifactId, "f");
    assert.equal(withFrame.notes[1], "图片2：人物A");
});

test("requestPrompt joins the prompt and notes, skipping blanks", () => {
    assert.equal(requestPrompt(" 画面 ", { images: [], notes: [] }), "画面");
    assert.equal(requestPrompt("画面", { images: [ref("a")], notes: ["图片1：人物"] }), "画面\n\n图片1：人物");
});

test("humanError is short and never carries URLs or keys", () => {
    assert.equal(humanError(new DOMException("x", "AbortError")), "已取消");
    assert.equal(humanError(new Error("")), "生成失败，请重试");
    assert.equal(humanError(undefined), "生成失败，请重试");
    const leaked = humanError(new Error("请求 https://api.example.com/v1/images?key=abc 失败 sk-1234567890abcdef"));
    assert.ok(!leaked.includes("https://") && !leaked.includes("sk-1234567890abcdef"), leaked);
    assert.ok(humanError(new Error("长".repeat(500))).length <= 120);
});
