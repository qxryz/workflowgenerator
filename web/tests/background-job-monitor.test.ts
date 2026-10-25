import assert from "node:assert/strict";
import test from "node:test";
import { createBackgroundJobMonitor } from "../src/lib/background-job-monitor.ts";

type Job = { id: string; status: "encoding" | "ready" | "cancelled" };
function fixture(read: (id: string) => Promise<Job>) {
    const queue: Array<{ action: () => void; delay: number; cancelled: boolean }> = [];
    const updates: Array<Job | undefined> = [];
    const unavailable: Array<Job | undefined> = [];
    const monitor = createBackgroundJobMonitor<Job>({ active: job => job.status === "encoding", read, changed: job => updates.push(job), unavailable: job => unavailable.push(job), removed: error => error === "removed", schedule: (action, delay) => { const timer = { action, delay, cancelled: false }; queue.push(timer); return () => { timer.cancelled = true; }; } });
    const tick = async () => { const timer = queue.shift()!; if (!timer.cancelled) timer.action(); await Promise.resolve(); await Promise.resolve(); };
    return { monitor, queue, updates, unavailable, tick };
}

test("a known encoding job is followed across page departure until completion without duplicate polls", async () => {
    let reads = 0;
    const f = fixture(async id => ({ id, status: ++reads === 1 ? "encoding" : "ready" }));
    f.monitor.observe({ id: "job", status: "encoding" });
    f.monitor.observe({ id: "job", status: "encoding" });
    assert.equal(f.queue.length, 1);
    await f.tick();
    assert.equal(f.queue.length, 1);
    await f.tick();
    assert.equal(f.queue.length, 0);
    assert.equal(f.updates.at(-1)?.status, "ready");
    assert.equal(reads, 2);
});

test("inactive history never starts polling or emits phantom tasks", () => {
    const f = fixture(async () => { throw new Error("unexpected read"); });
    f.monitor.observe({ id: "old", status: "ready" });
    assert.equal(f.queue.length, 0);
    assert.equal(f.updates.length, 0);
});

test("lost submission receipt remains visible and follows only its known ID", async () => {
    const ids: string[] = [];
    const f = fixture(async id => { ids.push(id); return { id, status: ids.length === 1 ? "encoding" : "ready" }; });
    f.monitor.follow("lost-receipt");
    f.monitor.follow("lost-receipt");
    assert.equal(f.queue.length, 1);
    assert.equal(f.unavailable.length, 2);
    await f.tick();
    assert.equal(f.updates.at(-1)?.status, "encoding");
    await f.tick();
    assert.deepEqual(ids, ["lost-receipt", "lost-receipt"]);
    assert.equal(f.queue.length, 0);
    assert.equal(f.updates.at(-1)?.status, "ready");
});

test("unknown transport status stays visible with backoff, then recovers", async () => {
    let reads = 0;
    const f = fixture(async id => { if (++reads === 1) throw new Error("offline"); return { id, status: "ready" }; });
    f.monitor.observe({ id: "job", status: "encoding" });
    await f.tick();
    assert.equal(f.unavailable.length, 1);
    assert.equal(f.queue[0].delay, 2400);
    await f.tick();
    assert.equal(f.queue.length, 0);
    assert.equal(f.updates.at(-1)?.status, "ready");
});

test("deleted jobs stop and a delayed response cannot revive a cancelled job", async () => {
    const removed = fixture(async () => { throw "removed"; });
    removed.monitor.observe({ id: "gone", status: "encoding" });
    await removed.tick();
    assert.equal(removed.queue.length, 0);
    assert.equal(removed.updates.at(-1), undefined);
    let resolve!: (job: Job) => void;
    const delayed = fixture(() => new Promise(done => { resolve = done; }));
    delayed.monitor.observe({ id: "job", status: "encoding" });
    await delayed.tick();
    delayed.monitor.observe({ id: "job", status: "cancelled" });
    resolve({ id: "job", status: "encoding" });
    await Promise.resolve(); await Promise.resolve();
    assert.equal(delayed.queue.length, 0);
    assert.equal(delayed.updates.at(-1)?.status, "cancelled");
});
