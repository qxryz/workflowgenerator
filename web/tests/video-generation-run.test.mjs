import assert from "node:assert/strict";
import test from "node:test";

import {
    consumePendingVideoGenerationIntent,
    AsyncRevisionClock,
    KeyedAsyncQueue,
    markStaleVideoLogCancelled,
    markVideoLogDeleted,
    mergeVideoCancellationJournalEntry,
    retryAsyncOperation,
    shouldInvalidateVideoGenerationLifecycle,
    shouldRetainUploadedVideo,
    videoGenerationLogMutationQueue,
    videoGenerationLogRevision,
    VideoGenerationLogVisibility,
    VideoGenerationRunRegistry,
} from "../src/lib/video-generation-run.ts";

test("a new foreground run invalidates the previous foreground writer", () => {
    const registry = new VideoGenerationRunRegistry();
    const first = registry.start({ runId: "run-1", jobId: "job-1", mode: "foreground" });
    const second = registry.start({ runId: "run-2", jobId: "job-2", mode: "foreground" });

    assert.ok(first);
    assert.ok(second);
    assert.equal(first.controller.signal.aborted, true);
    assert.equal(registry.isActive(first), false);
    assert.equal(registry.isForeground(first), false);
    assert.equal(registry.isForeground(second), true);
});

test("duplicate polling runs for one persisted job are rejected", () => {
    const registry = new VideoGenerationRunRegistry();
    const first = registry.start({ runId: "run-1", jobId: "job-1", mode: "background" });
    const duplicate = registry.start({ runId: "run-2", jobId: "job-1", mode: "background" });

    assert.ok(first);
    assert.equal(duplicate, null);
    assert.equal(registry.hasJob("job-1"), true);
});

test("a failed or cancelled record can be revived before retrying the same job id", () => {
    const visibility = new VideoGenerationLogVisibility();
    visibility.retire("job-1", "上一次生成已结束");
    assert.equal(visibility.canResume("job-1"), false);
    assert.equal(visibility.revive("job-1"), true);
    assert.equal(visibility.canResume("job-1"), true);
    assert.equal(visibility.retirementReason("job-1"), undefined);
});

test("a deleted record cannot be revived by a retry", () => {
    const visibility = new VideoGenerationLogVisibility();
    visibility.hide("job-1");
    assert.equal(visibility.revive("job-1"), false);
    assert.equal(visibility.isVisible("job-1"), false);
    assert.equal(visibility.canResume("job-1"), false);
});

test("finishing a stale run cannot remove its replacement", () => {
    const registry = new VideoGenerationRunRegistry();
    const first = registry.start({ runId: "run-1", jobId: "job-1", mode: "foreground" });

    assert.ok(first);
    registry.cancel(first);

    const replacement = registry.start({ runId: "run-2", jobId: "job-1", mode: "foreground" });
    assert.ok(replacement);

    registry.finish(first);
    assert.equal(registry.isForeground(replacement), true);
    assert.equal(registry.hasJob("job-1"), true);
});

test("cancelAll aborts foreground and background work", () => {
    const registry = new VideoGenerationRunRegistry();
    const foreground = registry.start({ runId: "run-1", jobId: "job-1", mode: "foreground" });
    const background = registry.start({ runId: "run-2", jobId: "job-2", mode: "background" });

    assert.ok(foreground);
    assert.ok(background);
    const cancelled = registry.cancelAll();

    assert.equal(cancelled.length, 2);
    assert.equal(foreground.controller.signal.aborted, true);
    assert.equal(background.controller.signal.aborted, true);
    assert.equal(registry.isActive(foreground), false);
    assert.equal(registry.isActive(background), false);
});

test("cancelJob invalidates only the matching persisted job", () => {
    const registry = new VideoGenerationRunRegistry();
    const first = registry.start({ runId: "run-1", jobId: "job-1", mode: "background" });
    const second = registry.start({ runId: "run-2", jobId: "job-2", mode: "background" });

    assert.ok(first);
    assert.ok(second);
    assert.deepEqual(registry.cancelJob("job-1"), [first]);
    assert.equal(registry.isActive(first), false);
    assert.equal(registry.isActive(second), true);
});

test("late create, poll, store, and log continuations cannot publish after replacement", async () => {
    for (const stage of ["create", "poll", "store", "log"]) {
        const registry = new VideoGenerationRunRegistry();
        const oldRun = registry.start({ runId: `old-${stage}`, jobId: `old-job-${stage}`, mode: "foreground", agentTaskId: "agent-old" });
        assert.ok(oldRun);
        const pending = deferred();
        const effects = [];
        const lateContinuation = (async () => {
            await pending.promise;
            registry.runIfForeground(oldRun, () => effects.push(`result:${stage}`, `agent:${stage}`, `message:${stage}`));
        })();

        const replacement = registry.start({ runId: `new-${stage}`, jobId: `new-job-${stage}`, mode: "foreground", agentTaskId: "agent-new" });
        assert.ok(replacement);
        pending.resolve();
        await lateContinuation;

        assert.deepEqual(effects, []);
        assert.equal(registry.isForeground(replacement), true);
    }
});

test("a restored background job may update its own log but cannot publish foreground UI", () => {
    const registry = new VideoGenerationRunRegistry();
    const foreground = registry.start({ runId: "foreground", jobId: "current-job", mode: "foreground" });
    const background = registry.start({ runId: "background", jobId: "restored-job", mode: "background" });
    assert.ok(foreground);
    assert.ok(background);

    const effects = [];
    registry.runIfActive(background, () => effects.push("restored-job:log"));
    registry.runIfForeground(background, () => effects.push("current-result", "current-agent", "message"));

    assert.deepEqual(effects, ["restored-job:log"]);
    assert.equal(registry.isForeground(foreground), true);
});

test("replacing foreground work leaves restored background polling active", () => {
    const registry = new VideoGenerationRunRegistry();
    const background = registry.start({ runId: "background", jobId: "restored-job", mode: "background" });
    const foreground = registry.start({ runId: "foreground", jobId: "current-job", mode: "foreground" });
    const replacement = registry.start({ runId: "replacement", jobId: "replacement-job", mode: "foreground" });

    assert.ok(background);
    assert.ok(foreground);
    assert.ok(replacement);
    assert.equal(foreground.controller.signal.aborted, true);
    assert.equal(registry.isActive(background), true);
    assert.equal(registry.isForeground(replacement), true);
});

test("route handoff keeps one background owner alive until its final write commits", async () => {
    const registry = new VideoGenerationRunRegistry();
    const background = registry.start({ runId: "background", jobId: "restored-job", mode: "background" });
    assert.ok(background);
    const finalWrite = deferred();
    const writes = [];
    const completion = (async () => {
        await finalWrite.promise;
        registry.runIfActive(background, () => writes.push("success"));
        registry.finish(background);
    })();

    const foregroundAtCleanup = registry.foregroundRun();
    if (foregroundAtCleanup) registry.cancel(foregroundAtCleanup);
    const duplicateFromReplacementPage = registry.start({ runId: "replacement-page", jobId: "restored-job", mode: "background" });

    assert.equal(duplicateFromReplacementPage, null);
    assert.equal(registry.isActive(background), true);
    finalWrite.resolve();
    await completion;
    assert.deepEqual(writes, ["success"]);
});

test("a deleted polling job cannot be resurrected by a late continuation", async () => {
    const registry = new VideoGenerationRunRegistry();
    const run = registry.start({ runId: "run-1", jobId: "job-1", mode: "foreground" });
    assert.ok(run);
    const pending = deferred();
    const writes = [];
    const lateContinuation = (async () => {
        await pending.promise;
        registry.runIfActive(run, () => writes.push("restored"));
    })();

    assert.deepEqual(registry.retireJob("job-1"), [run]);
    pending.resolve();
    await lateContinuation;

    assert.deepEqual(writes, []);
    assert.equal(registry.isRetired("job-1"), true);
    assert.equal(registry.start({ runId: "run-2", jobId: "job-1", mode: "background" }), null);
});

test("StrictMode's simulated cleanup does not consume the replacement lifecycle intent", async () => {
    let lifecycleEpoch = 0;
    let intent = { id: "intent-1", taskId: "agent-1" };
    const failedTasks = [];
    const setup = () => {
        const cleanupEpoch = ++lifecycleEpoch;
        return () =>
            queueMicrotask(() => {
                if (!shouldInvalidateVideoGenerationLifecycle(lifecycleEpoch, cleanupEpoch)) return;
                if (intent?.taskId) failedTasks.push(intent.taskId);
                intent = null;
            });
    };

    const simulatedCleanup = setup();
    simulatedCleanup();
    setup();
    await Promise.resolve();

    assert.deepEqual(consumePendingVideoGenerationIntent(intent, "intent-1"), { id: "intent-1", taskId: "agent-1" });
    assert.deepEqual(failedTasks, []);
});

test("an invalidated or replaced Agent intent cannot be consumed by an old token", () => {
    assert.equal(consumePendingVideoGenerationIntent(null, "intent-old"), null);
    assert.equal(consumePendingVideoGenerationIntent({ id: "intent-new", taskId: "agent-new" }, "intent-old"), null);
});

test("a foreground failure reaches one terminal UI and Agent update even when log persistence rejects", async () => {
    const registry = new VideoGenerationRunRegistry();
    const run = registry.start({ runId: "run-1", jobId: "job-1", mode: "foreground", agentTaskId: "agent-1" });
    assert.ok(run);
    const effects = [];

    const persistence = deferred();
    const finalize = (async () => {
        try {
            await persistence.promise;
        } catch {
            registry.runIfForeground(run, () => effects.push("result:failed", "agent:failed", "message:error"));
        }
    })();
    persistence.reject(new Error("log write failed"));
    await finalize;

    assert.deepEqual(effects, ["result:failed", "agent:failed", "message:error"]);
});

test("uncertain rollback retains uploaded video while confirmed removal may discard it", () => {
    assert.equal(shouldRetainUploadedVideo("committed"), true);
    assert.equal(shouldRetainUploadedVideo("uncertain"), true);
    assert.equal(shouldRetainUploadedVideo("stale-removed"), false);
});

test("same-job replacement writes wait until stale cleanup finishes", async () => {
    const queue = new KeyedAsyncQueue();
    const cleanupStarted = deferred();
    const releaseCleanup = deferred();
    const events = [];
    let storedRunId = "old-run";

    const staleCleanup = queue.run("job-1", async () => {
        events.push(`read:${storedRunId}`);
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        storedRunId = "";
        events.push("remove:old-run");
    });
    await cleanupStarted.promise;
    const replacementWrite = queue.run("job-1", async () => {
        storedRunId = "new-run";
        events.push("write:new-run");
    });

    await Promise.resolve();
    assert.equal(storedRunId, "old-run");
    releaseCleanup.resolve();
    await Promise.all([staleCleanup, replacementWrite]);

    assert.equal(storedRunId, "new-run");
    assert.deepEqual(events, ["read:old-run", "remove:old-run", "write:new-run"]);
});

test("the module-lifetime log queue serializes cleanup across a real page remount", async () => {
    const key = `remount-job-${Date.now()}`;
    const cleanupStarted = deferred();
    const releaseCleanup = deferred();
    const events = [];
    let storedRunId = "old-run";

    const oldPageCleanup = videoGenerationLogMutationQueue.run(key, async () => {
        events.push(`old-page-read:${storedRunId}`);
        cleanupStarted.resolve();
        await releaseCleanup.promise;
        storedRunId = "";
        events.push("old-page-remove");
    });
    await cleanupStarted.promise;
    const newPageWrite = videoGenerationLogMutationQueue.run(key, async () => {
        storedRunId = "new-run";
        events.push("new-page-write");
    });

    await Promise.resolve();
    assert.equal(storedRunId, "old-run");
    releaseCleanup.resolve();
    await Promise.all([oldPageCleanup, newPageWrite]);

    assert.equal(storedRunId, "new-run");
    assert.deepEqual(events, ["old-page-read:old-run", "old-page-remove", "new-page-write"]);
});

test("failed stale-success removal is terminalized instead of restoring a successful result", () => {
    const terminal = markStaleVideoLogCancelled({
        id: "job-1",
        runId: "old-run",
        status: "成功",
        task: { id: "remote-task" },
        video: { storageKey: "video:old" },
    });

    assert.equal(terminal.status, "失败");
    assert.equal(terminal.task, undefined);
    assert.equal(terminal.video, undefined);
    assert.equal(terminal.error, "视频任务已取消");
});

test("foreground cancellation is synchronously non-resumable across a route remount", () => {
    const visibility = new VideoGenerationLogVisibility();
    visibility.retire("job-1", "视频工作台已关闭");

    assert.equal(visibility.canResume("job-1"), false);
    assert.equal(visibility.isVisible("job-1"), true);
    assert.equal(visibility.retirementReason("job-1"), "视频工作台已关闭");

    const pending = { id: "job-1", status: "生成中", task: { id: "remote-task" } };
    const visibleState = visibility.retirementReason(pending.id) ? markStaleVideoLogCancelled(pending) : pending;
    assert.equal(visibleState.status, "失败");
    assert.equal(visibleState.task, undefined);
});

test("a durable cancellation journal keeps pending work terminal after a renderer restart", () => {
    const oldRenderer = new VideoGenerationLogVisibility();
    oldRenderer.retire("job-1", "视频工作台已关闭");
    const durableJournal = new Map([["job-1", { reason: "视频工作台已关闭" }]]);

    const newRenderer = new VideoGenerationLogVisibility();
    const pending = { id: "job-1", status: "生成中", task: { id: "remote-task" } };
    const reason = newRenderer.retirementReason(pending.id) || durableJournal.get(pending.id)?.reason;
    const restored = reason ? { ...markStaleVideoLogCancelled(pending), error: reason } : pending;

    assert.equal(restored.status, "失败");
    assert.equal(restored.task, undefined);
    assert.equal(restored.error, "视频工作台已关闭");
});

test("a durable cancellation journal also masks a stale success after restart", () => {
    const durableJournal = new Map([["job-1", { reason: "已由新的视频任务替换" }]]);
    const staleSuccess = {
        id: "job-1",
        status: "成功",
        video: { storageKey: "video:stale" },
        task: { id: "remote-task" },
    };
    const reason = durableJournal.get(staleSuccess.id)?.reason;
    const restored = reason ? { ...markStaleVideoLogCancelled(staleSuccess), error: reason } : staleSuccess;

    assert.equal(restored.status, "失败");
    assert.equal(restored.video, undefined);
    assert.equal(restored.task, undefined);
    assert.equal(restored.error, "已由新的视频任务替换");
});

test("a deleted pending task stays hidden and its tombstone cannot resume after restart", () => {
    const visibility = new VideoGenerationLogVisibility();
    visibility.hide("job-1");
    assert.equal(visibility.isVisible("job-1"), false);
    assert.equal(visibility.canResume("job-1"), false);

    const tombstone = markVideoLogDeleted({ id: "job-1", status: "生成中", task: { id: "remote-task" }, video: { storageKey: "video:old" } });
    assert.equal(tombstone.deletedAt > 0, true);
    assert.equal(tombstone.status, "失败");
    assert.equal(tombstone.task, undefined);
    assert.equal(tombstone.video, undefined);
});

test("a late cancellation writer cannot downgrade an already hidden deletion journal", () => {
    const cancelled = { reason: "视频任务已取消", createdAt: 1, hidden: false };
    const deleted = mergeVideoCancellationJournalEntry(cancelled, {
        reason: "视频生成记录已删除",
        createdAt: 2,
        hidden: true,
    });
    const lateCancellation = mergeVideoCancellationJournalEntry(deleted, {
        reason: "视频任务已取消",
        createdAt: 3,
        hidden: false,
    });

    assert.equal(lateCancellation.hidden, true);
    assert.equal(lateCancellation.reason, "视频生成记录已删除");
    assert.equal(lateCancellation.createdAt, 3);
});

test("terminal storage reconciliation retries a transient read or write failure", async () => {
    let attempts = 0;
    const result = await retryAsyncOperation(async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("transient storage failure");
        return "terminal";
    });

    assert.equal(result, "terminal");
    assert.equal(attempts, 3);
});

test("a cancelled foreground read cannot be committed after another page terminalizes it", async () => {
    const queue = new KeyedAsyncQueue();
    const clock = new AsyncRevisionClock();
    const readCaptured = deferred();
    const releaseRead = deferred();
    let stored = { id: "job-1", status: "生成中", task: { id: "remote-task" } };
    const readRevision = clock.snapshot();

    const remountRead = (async () => {
        const captured = { ...stored };
        readCaptured.resolve();
        await releaseRead.promise;
        return clock.isCurrent(readRevision) ? captured : null;
    })();
    await readCaptured.promise;
    await queue.run("job-1", async () => {
        stored = markStaleVideoLogCancelled(stored);
        clock.bump();
    });
    releaseRead.resolve();

    assert.equal(await remountRead, null);
    assert.equal(stored.status, "失败");
    assert.equal(stored.task, undefined);
});

test("a log read snapshot becomes stale when another page mutates the repository", async () => {
    const clock = new AsyncRevisionClock();
    const oldRead = clock.snapshot();
    const changed = deferred();
    const notifications = [];
    const unsubscribe = clock.subscribe(() => notifications.push("refresh"));

    const read = (async () => {
        await changed.promise;
        return clock.isCurrent(oldRead);
    })();
    clock.bump();
    changed.resolve();

    assert.equal(await read, false);
    assert.deepEqual(notifications, ["refresh"]);
    unsubscribe();
});

test("the exported revision clock is shared across page instances", () => {
    const firstPageSnapshot = videoGenerationLogRevision.snapshot();
    videoGenerationLogRevision.bump();
    assert.equal(videoGenerationLogRevision.isCurrent(firstPageSnapshot), false);
});

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}
