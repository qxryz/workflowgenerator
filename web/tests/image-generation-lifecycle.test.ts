import assert from "node:assert/strict";
import test from "node:test";

import {
    awaitForCurrentGeneration,
    consumePendingGenerationIntent,
    createGenerationIdentity,
    GenerationLogVisibilityRegistry,
    isGenerationIdentityCurrent,
    mergeRetriedGenerationLog,
    reconcileCancelledGenerationLog,
    resolveGenerationAppendLogId,
    resolveGenerationMediaAction,
    shouldInvalidateGenerationLifecycle,
    shouldDisplayGenerationLog,
    StaleGenerationError,
    updateStableGenerationSlot,
} from "../src/lib/image-generation-lifecycle.ts";

test("regeneration keeps the original log even when the active result briefly lacks its log id", () => {
    assert.equal(resolveGenerationAppendLogId("log-explicit", "log-preview", ["log-result"]), "log-explicit");
    assert.equal(resolveGenerationAppendLogId(undefined, "log-preview", ["log-result"]), "log-preview");
    assert.equal(resolveGenerationAppendLogId(undefined, undefined, [undefined, "log-result"]), "log-result");
    assert.equal(resolveGenerationAppendLogId(undefined, undefined, [undefined]), undefined);
});

test("a successful retry updates the original generation log instead of creating a duplicate", () => {
    const failedLog = { id: "log-1", durationMs: 1200, successCount: 0, failCount: 1, status: "失败" as const, images: [] as Array<{ dataUrl: string }>, thumbnails: [] as string[] };
    const merged = mergeRetriedGenerationLog(failedLog, { dataUrl: "wg-media://image-1" }, 800);
    assert.equal(merged.id, "log-1");
    assert.equal(merged.status, "成功");
    assert.equal(merged.successCount, 1);
    assert.equal(merged.failCount, 0);
    assert.equal(merged.durationMs, 2000);
    assert.deepEqual(merged.thumbnails, ["wg-media://image-1"]);
    assert.equal(failedLog.status, "失败");
});

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((next, fail) => {
        resolve = next;
        reject = fail;
    });
    return { promise, resolve, reject };
}

test("a generation batch and every result slot receive stable identities", () => {
    let value = 0;
    const identity = createGenerationIdentity(3, () => `id-${++value}`);

    assert.deepEqual(identity, {
        batchId: "id-1",
        slotIds: ["id-2", "id-3", "id-4"],
    });
    assert.equal(new Set([identity.batchId, ...identity.slotIds]).size, 4);
});

test("a late slot result cannot overwrite another batch at the same array index", () => {
    const current = [
        { id: "new-slot-a", status: "pending" },
        { id: "new-slot-b", status: "pending" },
    ];

    const unchanged = updateStableGenerationSlot(current, "old-slot-a", { status: "success" });

    assert.deepEqual(unchanged, current);
    assert.equal(unchanged, current);
});

test("a retry updates its stable result slot without replacing neighboring results", () => {
    const retrying = [
        { id: "retry-slot", status: "pending" },
        { id: "untouched-slot", status: "success" },
    ];

    const updated = updateStableGenerationSlot(retrying, "retry-slot", { status: "success" });

    assert.equal(updated[0].status, "success");
    assert.equal(updated[1], retrying[1]);
});

test("only the active, non-aborted batch is current", () => {
    assert.equal(isGenerationIdentityCurrent("batch-new", "batch-old"), false);
    assert.equal(isGenerationIdentityCurrent("batch-new", "batch-new", true), false);
    assert.equal(isGenerationIdentityCurrent("batch-new", "batch-new"), true);
});

test("a deferred result that resolves after invalidation cannot reach its commit", async () => {
    const pending = deferred<string>();
    let current = true;
    const commits: string[] = [];
    const task = (async () => {
        const value = await awaitForCurrentGeneration(
            () => pending.promise,
            () => current,
        );
        commits.push(value);
    })();

    current = false;
    pending.resolve("late result");

    await assert.rejects(task, StaleGenerationError);
    assert.deepEqual(commits, []);
});

test("an already stale generation does not start another async operation", async () => {
    let started = false;

    await assert.rejects(
        awaitForCurrentGeneration(
            async () => {
                started = true;
                return "result";
            },
            () => false,
        ),
        StaleGenerationError,
    );
    assert.equal(started, false);
});

test("an invalidated or replaced Agent intent cannot be consumed by an old token", () => {
    assert.equal(consumePendingGenerationIntent(null, "intent-old"), null);
    assert.equal(consumePendingGenerationIntent({ id: "intent-new", taskId: "task-new" }, "intent-old"), null);
    assert.deepEqual(consumePendingGenerationIntent({ id: "intent-new", taskId: "task-new" }, "intent-new"), {
        id: "intent-new",
        taskId: "task-new",
    });
});

test("StrictMode's simulated cleanup cannot invalidate the replacement setup", () => {
    assert.equal(shouldInvalidateGenerationLifecycle(2, 1), false);
    assert.equal(shouldInvalidateGenerationLifecycle(2, 2), true);
});

test("a rejected write keeps media when read-back confirms the log owner", () => {
    assert.equal(
        resolveGenerationMediaAction("image:owned", {
            rollbackSucceeded: false,
            owner: { kind: "known", exists: true, discarded: false, storageKeys: ["image:owned"] },
        }),
        "publish",
    );
});

test("a rejected rollback or uncertain owner keeps media fail-safe", () => {
    assert.equal(
        resolveGenerationMediaAction("image:uncertain", {
            rollbackSucceeded: false,
            owner: { kind: "unknown" },
        }),
        "publish",
    );
    assert.equal(
        resolveGenerationMediaAction("image:rolled-back", {
            rollbackSucceeded: true,
            owner: { kind: "unknown" },
        }),
        "discard",
    );
});

test("a confirmed absent owner permits provisional media rollback", () => {
    assert.equal(
        resolveGenerationMediaAction("image:orphan", {
            rollbackSucceeded: false,
            owner: { kind: "known", exists: false, discarded: false, storageKeys: [] },
        }),
        "discard",
    );
});

test("a partial multi-image owner keeps only media still referenced by the log", () => {
    const resolution = {
        rollbackSucceeded: false,
        owner: { kind: "known" as const, exists: true, discarded: false, storageKeys: ["image:kept"] },
    };

    assert.equal(resolveGenerationMediaAction("image:kept", resolution), "publish");
    assert.equal(resolveGenerationMediaAction("image:unowned", resolution), "discard");
});

test("a cancelled log stays hidden when rollback rejects but retains its media owner", () => {
    const tombstone = { id: "log-cancelled", discarded: true };
    const owner = {
        rollbackSucceeded: false,
        owner: { kind: "known" as const, exists: true, discarded: true, storageKeys: ["image:cancelled"] },
    };

    assert.equal(shouldDisplayGenerationLog(tombstone, new Set()), false);
    assert.equal(resolveGenerationMediaAction("image:cancelled", owner), "publish");
});

test("a cancelled partial write is tombstoned when removal rejects and keeps its referenced media", async () => {
    let stored: { id: string; discarded: boolean; storageKeys: string[] } | undefined = {
        id: "log-cancelled",
        discarded: false,
        storageKeys: ["image:cancelled"],
    };
    const removal = deferred<void>();
    const reconcile = reconcileCancelledGenerationLog({
        probe: async () => (stored ? { kind: "known", exists: true, discarded: stored.discarded, storageKeys: stored.storageKeys } : { kind: "known", exists: false, discarded: false, storageKeys: [] }),
        writeTombstone: async () => {
            if (stored) stored = { ...stored, discarded: true };
            throw new Error("migration marker failed after body write");
        },
        remove: () => removal.promise,
    });

    removal.reject(new Error("remove failed before body write"));
    const result = await reconcile;

    assert.deepEqual(result.media.owner, {
        kind: "known",
        exists: true,
        discarded: true,
        storageKeys: ["image:cancelled"],
    });
    assert.equal(result.media.rollbackSucceeded, false);
    assert.equal(resolveGenerationMediaAction("image:cancelled", result.media), "publish");
    assert.equal(shouldDisplayGenerationLog(stored!, new Set()), false);
});

test("a late history read and a remounted page both reject a globally suppressed log", async () => {
    const visibility = new GenerationLogVisibilityRegistry();
    const staleSnapshot = [{ id: "log-old", discarded: false }];
    const delayedRead = deferred<void>();
    let currentLogs = [...staleSnapshot];
    const unsubscribe = visibility.subscribe(() => {
        currentLogs = visibility.filter(currentLogs);
    });
    const lateRefresh = (async () => {
        const capturedBeforeCancellation = [...staleSnapshot];
        await delayedRead.promise;
        return visibility.filter(capturedBeforeCancellation);
    })();

    visibility.suppress("log-old");
    delayedRead.resolve(undefined);

    assert.deepEqual(currentLogs, []);
    assert.deepEqual(await lateRefresh, []);
    assert.deepEqual(visibility.filter([...staleSnapshot]), []);
    unsubscribe();
});
