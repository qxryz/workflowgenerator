import assert from "node:assert/strict";
import test from "node:test";

import {
    cancelCanvasGenerationRequestsByRunningId,
    claimCanvasGenerationRequest,
    createCanvasGenerationAttempt,
    discardCanvasGenerationUpload,
    finishCanvasGenerationRequest,
    isCanvasGenerationRequestCurrent,
    isCanvasGenerationRequestSuperseded,
    retainOwnedCanvasGenerationUpload,
    type CanvasGenerationRequestRegistry,
} from "../src/lib/canvas/canvas-generation-attempts.ts";

const projectA = { projectId: "project-a", restoreEpoch: 1 } as const;

test("a newer attempt owns the target even when the old provider ignores abort", async () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const oldAttempt = createCanvasGenerationAttempt(projectA);
    const oldLease = claimCanvasGenerationRequest(registry, { targetNodeId: "slot", originNodeId: "action", runningNodeId: "action", attempt: oldAttempt, ...projectA });
    const nextAttempt = createCanvasGenerationAttempt(projectA);
    const nextLease = claimCanvasGenerationRequest(registry, { targetNodeId: "slot", originNodeId: "action", runningNodeId: "action", attempt: nextAttempt, ...projectA });

    assert.equal(oldAttempt.controller.signal.aborted, true);
    assert.equal(isCanvasGenerationRequestCurrent(registry, oldLease, projectA), false);
    assert.equal(isCanvasGenerationRequestSuperseded(registry, oldLease, projectA), true, "old result-slot cleanup must not reset the newer slot state");
    assert.equal(isCanvasGenerationRequestCurrent(registry, nextLease, projectA), true);
    assert.equal(finishCanvasGenerationRequest(registry, oldLease), false, "an old finally block must not release the new request");
    assert.equal(isCanvasGenerationRequestCurrent(registry, nextLease, projectA), true);
});

test("a provisional upload from a superseded attempt is discarded and never accepted", async () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const oldLease = claimCanvasGenerationRequest(registry, { targetNodeId: "slot", originNodeId: "action", runningNodeId: "action", ...projectA });
    claimCanvasGenerationRequest(registry, { targetNodeId: "slot", originNodeId: "action", runningNodeId: "action", ...projectA });
    const upload = { storageKey: "image:late" };
    const discarded: string[] = [];

    await assert.rejects(
        retainOwnedCanvasGenerationUpload(registry, [oldLease], projectA, upload, async (item) => discarded.push(item.storageKey)),
        (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.deepEqual(discarded, ["image:late"]);
});

test("transient provisional cleanup failures are retried before ownership is released", async () => {
    let attempts = 0;
    await discardCanvasGenerationUpload({ storageKey: "video:late" }, async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("storage busy");
    });
    assert.equal(attempts, 3);
});

test("canceling one running step aborts every shared child lease", () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const attempt = createCanvasGenerationAttempt(projectA);
    claimCanvasGenerationRequest(registry, { targetNodeId: "action", originNodeId: "action", runningNodeId: "action", attempt, ...projectA });
    claimCanvasGenerationRequest(registry, { targetNodeId: "image-1", originNodeId: "action", runningNodeId: "action", attempt, ...projectA });
    claimCanvasGenerationRequest(registry, { targetNodeId: "image-2", originNodeId: "action", runningNodeId: "action", attempt, ...projectA });

    const affected = cancelCanvasGenerationRequestsByRunningId(registry, "action");

    assert.equal(attempt.controller.signal.aborted, true);
    assert.deepEqual(Array.from(affected).sort(), ["action", "image-1", "image-2"]);
    assert.equal(registry.size, 0);
    assert.equal(isCanvasGenerationRequestSuperseded(registry, { targetNodeId: "action", attempt }, projectA), false, "a user stop in the same restored project has no newer owner, so callers may restore the last durable result");
});

test("a late callback is stale after switching projects even when teardown cleared the registry", () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const lease = claimCanvasGenerationRequest(registry, { targetNodeId: "result-slot:shared-id", originNodeId: "action", runningNodeId: "action", ...projectA });
    lease.attempt.controller.abort();
    registry.clear();

    const projectB = { projectId: "project-b", restoreEpoch: 2 } as const;
    assert.equal(isCanvasGenerationRequestCurrent(registry, lease, projectB), false);
    assert.equal(isCanvasGenerationRequestSuperseded(registry, lease, projectB), true, "the old catch block must not restore a same-id slot in project B");
});

test("a late callback is stale after reloading the same project into a new restore epoch", () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const lease = claimCanvasGenerationRequest(registry, { targetNodeId: "result-slot:shared-id", originNodeId: "action", runningNodeId: "action", ...projectA });
    lease.attempt.controller.abort();
    registry.clear();

    const reloadedProjectA = { projectId: projectA.projectId, restoreEpoch: projectA.restoreEpoch + 1 };
    assert.equal(isCanvasGenerationRequestCurrent(registry, lease, reloadedProjectA), false);
    assert.equal(isCanvasGenerationRequestSuperseded(registry, lease, reloadedProjectA), true, "the old catch block must not restore a slot in a newly restored copy of the project");
});

test("a shared attempt cannot be claimed across a project boundary", () => {
    const registry: CanvasGenerationRequestRegistry = new Map();
    const attempt = createCanvasGenerationAttempt(projectA);

    assert.throws(
        () => claimCanvasGenerationRequest(registry, { targetNodeId: "slot", originNodeId: "action", runningNodeId: "action", attempt, projectId: "project-b", restoreEpoch: 2 }),
        (error: unknown) => error instanceof Error && error.name === "AbortError",
    );
    assert.equal(registry.size, 0);
});
