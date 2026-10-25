import assert from "node:assert/strict";
import test from "node:test";
import { workspaceStatusCounts, workspaceStatusIsRunning, workspaceWorkStatus, workspaceWorkStatuses } from "../src/lib/agent/workspace-status.ts";
import { clearWorkspaceActivity, setWorkspaceActivity, withWorkspaceActivity } from "../src/services/workspace-activity.ts";
import { useAgentStore } from "../src/stores/use-agent-store.ts";
import { pendingWriteCount, setStoredValue, subscribePendingWrites } from "../src/services/server-storage.ts";

test("workspace status distinguishes waiting and interrupted work while preserving legacy busy flags", () => {
    assert.equal(workspaceWorkStatus({ agent: false }), undefined);
    assert.equal(workspaceWorkStatus({ agent: true }), "running");
    assert.equal(workspaceWorkStatus({ agent: "waiting", chapters: true }), "waiting");
    assert.equal(workspaceWorkStatus({ agent: "attention", chapters: true }), "attention");
    assert.equal(workspaceWorkStatus({ generation: "generating", workflow: false }), "generating");
    assert.equal(workspaceStatusIsRunning("waiting"), false);
    assert.equal(workspaceStatusIsRunning("attention"), false);
    assert.equal(workspaceStatusIsRunning("saving"), true);
});

test("approval cannot hide separately running canvas work and execution wrappers stay grouped", () => {
    assert.deepEqual(workspaceWorkStatuses({ agent: "waiting", tools: true, generation: true, workflow: true }), ["waiting", "running"]);
    assert.deepEqual(workspaceWorkStatuses({ agent: "waiting", chapters: true }), ["waiting"]);
    assert.deepEqual(workspaceWorkStatuses({ agent: true, tools: true, chapters: true, generation: true }), ["running"]);
});

test("simultaneous activity phases stay visible and storage writes are not counted twice", () => {
    assert.deepEqual(workspaceStatusCounts(["generating", "waiting", "generating"], 3), [{ status: "waiting", count: 1 }, { status: "saving", count: 1 }, { status: "generating", count: 2 }]);
    assert.deepEqual(workspaceStatusCounts(["saving"], 4), [{ status: "saving", count: 1 }]);
    assert.deepEqual(workspaceStatusCounts(["uploading"], 1), [{ status: "uploading", count: 1 }]);
    assert.deepEqual(workspaceStatusCounts([]), []);
});

function deferred() { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; }
const activity = { id: "test-upload", title: "素材上传", status: "uploading" as const, route: "/canvas/test" };

test("an upload owns its global activity until durable saving finishes", async () => {
    const gate = deferred();
    const result = withWorkspaceActivity(activity, async update => {
        await gate.promise;
        update("saving");
        assert.equal(useAgentStore.getState().activities[activity.id].status, "saving");
        return 42;
    });
    assert.equal(useAgentStore.getState().activities[activity.id].status, "uploading");
    gate.resolve();
    assert.equal(await result, 42);
    assert.equal(useAgentStore.getState().activities[activity.id], undefined);
});

test("failure clears a task and a late old completion cannot clear a new attempt", async () => {
    await assert.rejects(withWorkspaceActivity(activity, async () => { throw new Error("upload failed"); }), /upload failed/);
    assert.equal(useAgentStore.getState().activities[activity.id], undefined);
    const old = deferred(), next = deferred();
    const first = withWorkspaceActivity(activity, async update => { await old.promise; update("saving"); });
    const second = withWorkspaceActivity({ ...activity, status: "generating" }, () => next.promise);
    old.resolve(); await first;
    assert.equal(useAgentStore.getState().activities[activity.id].status, "generating");
    next.resolve(); await second;
    assert.equal(useAgentStore.getState().activities[activity.id], undefined);
});

test("external cancellation and replacement invalidate older promise leases", async () => {
    const gate = deferred();
    const task = withWorkspaceActivity(activity, async update => { await gate.promise; update("saving"); });
    clearWorkspaceActivity(activity.id);
    setWorkspaceActivity({ ...activity, status: "waiting" });
    gate.resolve(); await task;
    assert.equal(useAgentStore.getState().activities[activity.id].status, "waiting");
    clearWorkspaceActivity(activity.id);
});

test("the existing write ledger notifies overlapping saves and rejection without retaining a busy status", async () => {
    const original = globalThis.fetch;
    const requests: Array<{ resolve: (response: Response) => void; reject: (error: Error) => void }> = [];
    globalThis.fetch = () => new Promise((resolve, reject) => { requests.push({ resolve, reject }); });
    const counts: number[] = [];
    const unsubscribe = subscribePendingWrites(() => counts.push(pendingWriteCount()));
    const unsubscribeBroken = subscribePendingWrites(() => { throw new Error("status observer failed"); });
    try {
        const one = setStoredValue("test-status", "one", "{}");
        const two = setStoredValue("test-status", "two", "{}");
        assert.equal(pendingWriteCount(), 2);
        await Promise.resolve(); await Promise.resolve();
        requests[0].resolve(new Response("null", { status: 200 }));
        await one;
        assert.equal(pendingWriteCount(), 1);
        const rejected = assert.rejects(two, /write failed/);
        requests[1].reject(new Error("write failed"));
        await rejected;
        assert.equal(pendingWriteCount(), 0);
        assert.deepEqual(counts, [1, 2, 1, 0]);
    } finally { unsubscribe(); unsubscribeBroken(); globalThis.fetch = original; }
});
