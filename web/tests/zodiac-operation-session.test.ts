import assert from "node:assert/strict";
import test from "node:test";

import {
    getZodiacActiveOperation,
    hasZodiacActiveOperations,
    mergeActiveOperationItems,
    reconcileZodiacSessionItems,
    registerZodiacActiveOperation,
    removeZodiacActiveOperation,
    subscribeZodiacOperationRuntime,
    updateZodiacActiveOperationItems,
    type ZodiacActiveOperation,
} from "../src/lib/agent/zodiac-operation-session.ts";
import { ZodiacSessionWriteCoordinator, ZodiacSessionWriteFence } from "../src/lib/agent/zodiac-session-write-fence.ts";

type Item = { id: string; status?: string; text?: string };

test("returning to a session keeps its live operation while preserving newer conversation items", () => {
    const operation: ZodiacActiveOperation<Item> = {
        operationId: "tool",
        sessionId: "session-a",
        workspaceId: "project-a",
        ownedItemIds: new Set(["run", "tool"]),
        items: [
            { id: "message", text: "before" },
            { id: "run", status: "running" },
            { id: "tool", status: "running" },
        ],
    };
    const reloaded = [
        { id: "message", text: "before" },
        { id: "run", status: "failed" },
        { id: "tool", status: "failed" },
        { id: "new-message", text: "keep me" },
    ];

    assert.deepEqual(mergeActiveOperationItems("session-a", reloaded, [operation]), [
        { id: "message", text: "before" },
        { id: "run", status: "running" },
        { id: "tool", status: "running" },
        { id: "new-message", text: "keep me" },
    ]);
});

test("an operation never leaks into a different session", () => {
    const operation: ZodiacActiveOperation<Item> = {
        operationId: "tool",
        sessionId: "session-a",
        workspaceId: "project-a",
        ownedItemIds: new Set(["tool"]),
        items: [{ id: "tool", status: "running" }],
    };
    const other = [{ id: "tool", status: "failed" }];
    assert.deepEqual(mergeActiveOperationItems("session-b", other, [operation]), other);
});

test("live operation events received during storage load reconcile by id without duplicate cards", () => {
    const stored = [
        { id: "message", text: "stored" },
        { id: "tool", status: "running" },
    ];
    const live = [
        { id: "tool", status: "applied" },
        { id: "new-message", text: "arrived while loading" },
    ];

    assert.deepEqual(reconcileZodiacSessionItems(stored, live), [
        { id: "message", text: "stored" },
        { id: "tool", status: "applied" },
        { id: "new-message", text: "arrived while loading" },
    ]);
});

test("a remounted panel receives later operation items from the workspace/session/operation registry", () => {
    const operation: ZodiacActiveOperation<Item> = {
        operationId: "tool-runtime",
        sessionId: "session-runtime",
        workspaceId: "project-runtime",
        ownedItemIds: new Set(["run-runtime", "tool-runtime"]),
        items: [
            { id: "run-runtime", status: "running" },
            { id: "tool-runtime", status: "running" },
        ],
    };
    assert.equal(registerZodiacActiveOperation(operation), true);

    let remountedItems: Item[] = [
        { id: "run-runtime", status: "failed" },
        { id: "tool-runtime", status: "failed" },
        { id: "newer-message", text: "preserve" },
    ];
    const unsubscribe = subscribeZodiacOperationRuntime<Item>((event) => {
        if (event.operation.workspaceId !== "project-runtime" || event.operation.sessionId !== "session-runtime") return;
        remountedItems = mergeActiveOperationItems("session-runtime", remountedItems, [event.operation]);
    });

    updateZodiacActiveOperationItems(operation, [
        { id: "run-runtime", status: "completed" },
        { id: "tool-runtime", status: "applied" },
    ]);

    assert.deepEqual(remountedItems, [
        { id: "run-runtime", status: "completed" },
        { id: "tool-runtime", status: "applied" },
        { id: "newer-message", text: "preserve" },
    ]);
    assert.equal(hasZodiacActiveOperations("project-runtime"), true);
    assert.equal(getZodiacActiveOperation("project-runtime", "session-runtime", "tool-runtime"), operation);
    assert.equal(getZodiacActiveOperation("project-runtime", "other-session", "tool-runtime"), undefined);

    unsubscribe();
    assert.equal(removeZodiacActiveOperation(operation), true);
    assert.equal(hasZodiacActiveOperations("project-runtime"), false);
});

test("session write fencing rejects a late settlement after an empty replacement session takes ownership", () => {
    const fence = new ZodiacSessionWriteFence();
    fence.activate("project-fence", "old-session");
    assert.equal(fence.claimOrMatches("project-fence", "old-session"), true);

    fence.activate("project-fence", "empty-new-session");

    assert.equal(fence.claimOrMatches("project-fence", "old-session"), false);
    assert.equal(fence.matches("project-fence", "empty-new-session"), true);
});

test("an unregistered rejection still advances the operation snapshot used for persistence", () => {
    const operation: ZodiacActiveOperation<Item> = {
        operationId: "rejected-tool",
        sessionId: "rejected-session",
        workspaceId: "rejected-workspace",
        ownedItemIds: new Set(["rejected-tool"]),
        items: [{ id: "rejected-tool", status: "pending" }],
    };
    let published = 0;
    const unsubscribe = subscribeZodiacOperationRuntime(() => {
        published += 1;
    });

    assert.equal(updateZodiacActiveOperationItems(operation, [{ id: "rejected-tool", status: "rejected" }]), false);
    assert.deepEqual(operation.items, [{ id: "rejected-tool", status: "rejected" }]);
    assert.equal(published, 0, "a non-active rejection updates its own durable snapshot without publishing a live event");
    unsubscribe();
});

test("queued old-session settlements are fenced before an empty replacement removes storage", async () => {
    const fence = new ZodiacSessionWriteFence();
    const writes = new ZodiacSessionWriteCoordinator(fence);
    const committed: string[] = [];
    let releaseFirstWrite = () => undefined;
    let markFirstWriteStarted = () => undefined;
    const firstWriteGate = new Promise<void>((resolve) => {
        releaseFirstWrite = resolve;
    });
    const firstWriteStarted = new Promise<void>((resolve) => {
        markFirstWriteStarted = resolve;
    });

    const firstWrite = writes.enqueue("project-queue", "old-session", async () => {
        markFirstWriteStarted();
        await firstWriteGate;
        committed.push("old-started");
    });
    await firstWriteStarted;
    const lateSettlement = writes.enqueue("project-queue", "old-session", () => {
        committed.push("old-late");
    });
    const replacement = writes.replace("project-queue", "empty-new-session", () => {
        committed.push("remove-active-record");
    });

    releaseFirstWrite();
    assert.equal(await firstWrite, true);
    assert.equal(await lateSettlement, false);
    assert.equal(await replacement, true);
    assert.deepEqual(committed, ["old-started", "remove-active-record"]);
});
