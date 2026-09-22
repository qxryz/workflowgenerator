import assert from "node:assert/strict";
import test from "node:test";

import { collectStorageKeys, createProvisionalUploadRegistry, getMediaReferenceEpoch, getProvisionalStorageKeys, reserveStorageKey, selectStorageKeysForDeletion, withMediaStorageFence } from "../src/services/media-retention-policy.ts";

const isImageKey = (key) => key.startsWith("image:");
const isMediaKey = (key) => key.includes(":") && !key.startsWith("image:");

test("fails closed when a complete reference snapshot is unavailable", () => {
    assert.deepEqual(selectStorageKeysForDeletion(["image:orphan"], undefined, isImageKey), []);
});

test("keeps files referenced by assets, generation history, or canvas nodes", () => {
    const snapshot = {
        complete: true,
        data: {
            assets: [{ data: { storageKey: "image:shared-asset" } }],
            imageGenerationHistory: [{ images: [{ storageKey: "image:shared-history" }] }],
            projects: [{ nodes: [{ metadata: { storageKey: "image:shared-canvas" } }] }],
        },
    };

    assert.deepEqual(selectStorageKeysForDeletion(["image:shared-asset", "image:shared-history", "image:shared-canvas", "image:orphan", "image:orphan"], snapshot, isImageKey), ["image:orphan"]);
});

test("keeps shared video and terminal output files while excluding image bucket keys", () => {
    const snapshot = {
        complete: true,
        data: {
            assets: [{ data: { storageKey: "video:shared" } }],
            projects: [{ nodes: [{ metadata: { terminalOutputArtifactStorageKey: "terminal-output:shared" } }] }],
        },
    };

    assert.deepEqual(selectStorageKeysForDeletion(["video:shared", "terminal-output:shared", "video:orphan", "image:not-in-media-bucket"], snapshot, isMediaKey), ["video:orphan"]);
});

test("reference collection handles circular runtime objects safely", () => {
    const root = { storageKey: "image:root" };
    root.self = root;
    root.children = [{ storageKey: "image:child" }, root];

    assert.deepEqual([...collectStorageKeys(root, isImageKey)].sort(), ["image:child", "image:root"]);
});

test("reference collection keeps storage keys stored in plain string arrays", () => {
    const snapshot = {
        metadata: {
            references: ["image:reference", "video:reference", "ordinary text"],
        },
    };

    assert.deepEqual([...collectStorageKeys(snapshot, isImageKey)], ["image:reference"]);
    assert.deepEqual([...collectStorageKeys(snapshot, isMediaKey)], ["video:reference"]);
});

test("storage reservations are visible to snapshots and invalidate stale epochs", () => {
    const epochBeforeReservation = getMediaReferenceEpoch();
    const release = reserveStorageKey("image:deferred-owner");

    assert.ok(getMediaReferenceEpoch() > epochBeforeReservation);
    assert.ok(getProvisionalStorageKeys().includes("image:deferred-owner"));

    const epochBeforeRelease = getMediaReferenceEpoch();
    release();
    release();

    assert.ok(getMediaReferenceEpoch() > epochBeforeRelease);
    assert.ok(!getProvisionalStorageKeys().includes("image:deferred-owner"));
});

test("media storage fence serializes destructive and publishing operations", async () => {
    const events = [];
    let releaseFirst;
    const firstMayFinish = new Promise((resolve) => {
        releaseFirst = resolve;
    });

    const first = withMediaStorageFence(async () => {
        events.push("cleanup:start");
        await firstMayFinish;
        events.push("cleanup:end");
    });
    await Promise.resolve();

    const second = withMediaStorageFence(async () => {
        events.push("publish");
    });
    await Promise.resolve();

    assert.deepEqual(events, ["cleanup:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(events, ["cleanup:start", "cleanup:end", "publish"]);
});

test("only the original provisional upload object can be discarded once", async () => {
    const removed = [];
    const registry = createProvisionalUploadRegistry(
        (upload) => upload.storageKey,
        async (storageKey) => {
            removed.push(storageKey);
        },
    );
    const upload = registry.track({ storageKey: "image:new" });
    const forged = { storageKey: "image:new" };
    upload.storageKey = "image:other";

    assert.equal(await registry.discard(forged), false);
    assert.equal(await registry.discard(upload), true);
    assert.equal(await registry.discard(upload), false);
    assert.deepEqual(removed, ["image:new"]);
});

test("published uploads cannot be discarded through the provisional channel", async () => {
    let removals = 0;
    const registry = createProvisionalUploadRegistry(
        (upload) => upload.storageKey,
        async () => {
            removals += 1;
        },
    );
    const upload = registry.track({ storageKey: "video:published" });

    assert.equal(registry.publish(upload), true);
    assert.equal(registry.publish(upload), false);
    assert.equal(await registry.discard(upload), false);
    assert.equal(removals, 0);
});

test("a failed provisional discard can be retried safely", async () => {
    let attempts = 0;
    const registry = createProvisionalUploadRegistry(
        (upload) => upload.storageKey,
        async () => {
            attempts += 1;
            if (attempts === 1) throw new Error("disk busy");
        },
    );
    const upload = registry.track({ storageKey: "audio:retry" });

    await assert.rejects(registry.discard(upload), /disk busy/);
    assert.equal(await registry.discard(upload), true);
    assert.equal(attempts, 2);
});
