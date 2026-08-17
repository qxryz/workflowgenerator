import assert from "node:assert/strict";
import test from "node:test";

import { createDebouncedWriteQueue } from "../src/lib/debounced-write-queue.ts";

test("flush forces the newest debounced value to write and waits for acknowledgement", async () => {
    const writes: string[] = [];
    let acknowledge!: () => void;
    let markStarted!: () => void;
    const started = new Promise<void>((resolve) => {
        markStarted = resolve;
    });
    const queue = createDebouncedWriteQueue<string>(
        async (value) => {
            writes.push(value);
            markStarted();
            await new Promise<void>((resolve) => {
                acknowledge = resolve;
            });
        },
        10_000,
    );

    queue.schedule("older");
    queue.schedule("newest");
    const flushed = queue.flush();

    await started;
    assert.deepEqual(writes, ["newest"]);
    let settled = false;
    void flushed.then(() => {
        settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);

    acknowledge();
    await flushed;
    assert.equal(settled, true);
});

test("flush observes a timer-started write and reports its failure", async () => {
    const queue = createDebouncedWriteQueue<string>(async () => {
        throw new Error("disk unavailable");
    }, 0);

    queue.schedule("snapshot");
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    await assert.rejects(queue.flush(), /disk unavailable/);
});

test("a newer snapshot can recover the queue after an earlier write failed", async () => {
    const writes: string[] = [];
    const queue = createDebouncedWriteQueue<string>(async (value) => {
        writes.push(value);
        if (value === "broken") throw new Error("write failed");
    }, 10_000);

    queue.schedule("broken");
    await assert.rejects(queue.flush(), /write failed/);
    queue.schedule("recovered");
    await queue.flush();

    assert.deepEqual(writes, ["broken", "recovered"]);
});

test("a newer flush stays ordered behind an active write and every caller awaits the newest snapshot", async () => {
    const writes: string[] = [];
    let releaseFirst!: () => void;
    let releaseSecond!: () => void;
    let markFirstStarted!: () => void;
    let markSecondStarted!: () => void;
    const firstStarted = new Promise<void>((resolve) => {
        markFirstStarted = resolve;
    });
    const secondStarted = new Promise<void>((resolve) => {
        markSecondStarted = resolve;
    });
    const firstAcknowledged = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const secondAcknowledged = new Promise<void>((resolve) => {
        releaseSecond = resolve;
    });
    const queue = createDebouncedWriteQueue<string>(async (value) => {
        writes.push(value);
        if (value === "v1") {
            markFirstStarted();
            await firstAcknowledged;
            return;
        }
        markSecondStarted();
        await secondAcknowledged;
    }, 10_000);

    queue.schedule("v1");
    const firstFlush = queue.flush();
    await firstStarted;
    queue.schedule("v2");
    const secondFlush = queue.flush();
    const concurrentFlush = queue.flush();

    assert.deepEqual(writes, ["v1"]);
    releaseFirst();
    await secondStarted;
    assert.deepEqual(writes, ["v1", "v2"]);

    let newestSettled = false;
    void Promise.all([secondFlush, concurrentFlush]).then(() => {
        newestSettled = true;
    });
    await Promise.resolve();
    assert.equal(newestSettled, false);

    releaseSecond();
    await Promise.all([firstFlush, secondFlush, concurrentFlush]);
    assert.equal(newestSettled, true);
});

test("cancelling a pending value prevents a delayed stale write", async () => {
    const writes: string[] = [];
    const queue = createDebouncedWriteQueue<string>(async (value) => {
        writes.push(value);
    }, 5);

    queue.schedule("stale");
    queue.cancelPending();
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
    await queue.waitForIdle();

    assert.deepEqual(writes, []);
});
