import assert from "node:assert/strict";
import test from "node:test";

import {
    appendResultSlotFailure,
    appendResultSlotSuccess,
    deleteResultSlotArtifact,
    createCanvasResultSlot,
    createCanvasResultSlotBinding,
    deleteResultSlotVersion,
    readCurrentResultSlotArtifact,
    readCurrentResultSlotOutput,
    resolveCanvasResultSlotExecutionControls,
    selectResultSlotVersion,
    setCanvasResultSlotAdvanceMode,
    setCanvasResultSlotState,
    synchronizeResultSlotSelectedOutput,
    syncResultSlotWorkflowStatus,
    workflowNodeOwnsGenerationStop,
} from "../src/lib/canvas/canvas-result-slots.ts";
import { createWorkflowExecution } from "../src/lib/canvas/workflow-execution.ts";

test("creates an explicit built-in result slot and an optional declared connection", () => {
    const { node, connection } = createCanvasResultSlotBinding({
        id: "hero-slot",
        connectionId: "generate-to-hero",
        sourceNodeId: "generate",
        mode: "image",
        position: { x: 420, y: 80 },
        advanceMode: "auto",
    });

    assert.equal(node.type, "image");
    assert.equal(node.metadata.role, "result-slot");
    assert.equal(node.metadata.advanceMode, "auto");
    assert.equal(node.metadata.slotState, "empty");
    assert.deepEqual(node.metadata.resultVersions, []);
    assert.equal(node.metadata.currentResultVersionId, undefined);
    assert.deepEqual(connection, { id: "generate-to-hero", fromNodeId: "generate", toNodeId: "hero-slot" });
});

test("audio result slots keep enough height for their player, versions, and actions", () => {
    const defaultSlot = createCanvasResultSlot({ id: "audio-slot", mode: "audio", position: { x: 0, y: 0 } });
    const undersizedSlot = createCanvasResultSlot({ id: "small-audio-slot", mode: "audio", position: { x: 0, y: 0 }, height: 120 });

    assert.equal(defaultSlot.height, 180);
    assert.equal(undersizedSlot.height, 180);
});

test("success and failure attempts accumulate without a failure hiding the last usable artifact", () => {
    const empty = createCanvasResultSlot({ id: "slot", sourceNodeId: "generate", mode: "image", position: { x: 0, y: 0 } });
    const first = appendResultSlotSuccess(empty, {
        id: "version-1",
        sourceNodeId: "generate",
        createdAt: "2026-08-02T10:00:00.000Z",
        artifacts: [{ id: "image-1", kind: "image", content: "blob:first", storageKey: "image:first", mimeType: "image/png" }],
    });
    const failed = appendResultSlotFailure(first, {
        id: "version-2",
        sourceNodeId: "generate",
        errorDetails: "额度不足",
    });

    assert.equal(empty.metadata.resultVersions.length, 0, "reducers must not mutate their input node");
    assert.equal(failed.metadata.resultVersions.length, 2);
    assert.equal(failed.metadata.slotState, "error");
    assert.equal(failed.metadata.status, "success", "legacy renderers keep showing the last usable preview");
    assert.equal(failed.metadata.currentResultVersionId, "version-1");
    assert.equal(failed.metadata.content, "blob:first");
    assert.equal(readCurrentResultSlotArtifact(failed)?.storageKey, "image:first");
});

test("a regenerated version may hold a collection and explicitly choose its primary artifact", () => {
    const empty = createCanvasResultSlot({ id: "slot", mode: "image", position: { x: 0, y: 0 } });
    const first = appendResultSlotSuccess(empty, {
        id: "version-1",
        artifacts: [{ id: "old", kind: "image", content: "blob:old" }],
    });
    const regenerated = appendResultSlotSuccess(first, {
        id: "version-2",
        primaryArtifactId: "second-b",
        artifacts: [
            { id: "second-a", kind: "image", content: "blob:a" },
            { id: "second-b", kind: "image", content: "blob:b" },
        ],
    });
    const output = readCurrentResultSlotOutput(regenerated);

    assert.equal(output?.version.id, "version-2");
    assert.deepEqual(
        output?.artifacts.map((artifact) => artifact.id),
        ["second-a", "second-b"],
    );
    assert.equal(output?.primaryArtifact.content, "blob:b");
    assert.equal(regenerated.metadata.content, "blob:b", "legacy node renderers receive the selected primary artifact");

    const selectedOld = selectResultSlotVersion(regenerated, "version-1");
    assert.equal(selectedOld.metadata.content, "blob:old");
    assert.equal(selectedOld.metadata.currentResultVersionId, "version-1");
});

test("deleting one candidate keeps the generation and selects a readable sibling", () => {
    const node = appendResultSlotSuccess(createCanvasResultSlot({ id: "slot", mode: "image", position: { x: 0, y: 0 } }), {
        id: "v1",
        artifacts: [
            { id: "a", kind: "image", content: "data:image/png;base64,a" },
            { id: "b", kind: "image", content: "data:image/png;base64,b" },
        ],
        primaryArtifactId: "a",
    });
    const next = deleteResultSlotArtifact(node, "v1", "a");
    assert.equal(next.metadata.resultVersions.length, 1);
    assert.equal(next.metadata.content, "data:image/png;base64,b");
    assert.equal(next.metadata.resultVersions[0].status === "success" ? next.metadata.resultVersions[0].primaryArtifactId : "", "b");
});

test("deleting any attempt preserves a deterministic usable selection", () => {
    let slot = createCanvasResultSlot({ id: "slot", mode: "text", position: { x: 0, y: 0 } });
    slot = appendResultSlotSuccess(slot, { id: "one", artifacts: [{ id: "text-one", kind: "text", content: "第一版" }] });
    slot = appendResultSlotFailure(slot, { id: "failed", errorDetails: "请求超时" });
    slot = appendResultSlotSuccess(slot, { id: "two", artifacts: [{ id: "text-two", kind: "text", content: "第二版" }] });

    const withoutCurrent = deleteResultSlotVersion(slot, "two");
    assert.equal(withoutCurrent.metadata.currentResultVersionId, "one");
    assert.equal(withoutCurrent.metadata.content, "第一版");

    const withoutFailure = deleteResultSlotVersion(withoutCurrent, "failed");
    assert.equal(withoutFailure.metadata.slotState, "ready");
    assert.equal(withoutFailure.metadata.errorDetails, undefined);

    const empty = deleteResultSlotVersion(withoutFailure, "one");
    assert.equal(empty.metadata.slotState, "empty");
    assert.equal(empty.metadata.status, "idle");
    assert.equal(empty.metadata.content, "");
    assert.equal(readCurrentResultSlotOutput(empty), undefined);
});

test("slot invariants reject incompatible artifacts, duplicate versions, failed selections, and foreign writers", () => {
    const slot = createCanvasResultSlot({ id: "slot", sourceNodeId: "owner", mode: "video", position: { x: 0, y: 0 } });
    assert.throws(() => appendResultSlotSuccess(slot, { id: "bad-kind", sourceNodeId: "owner", artifacts: [{ id: "image", kind: "image", content: "blob:image" }] }), /不兼容/);
    assert.throws(() => appendResultSlotFailure(slot, { id: "foreign", sourceNodeId: "other", errorDetails: "失败" }), /不能写入/);

    const failed = appendResultSlotFailure(slot, { id: "attempt", sourceNodeId: "owner", errorDetails: "失败" });
    assert.throws(() => appendResultSlotFailure(failed, { id: "attempt", errorDetails: "再次失败" }), /已存在/);
    assert.throws(() => selectResultSlotVersion(failed, "attempt"), /失败版本/);
});

test("lifecycle updates remain pure and keep an existing preview while persisting", () => {
    const ready = appendResultSlotSuccess(createCanvasResultSlot({ id: "slot", mode: "audio", position: { x: 0, y: 0 } }), {
        id: "audio-version",
        artifacts: [{ id: "audio", kind: "audio", content: "blob:audio", storageKey: "audio:stored" }],
    });
    const persisting = setCanvasResultSlotState(ready, "persisting");
    const automatic = setCanvasResultSlotAdvanceMode(persisting, "auto");

    assert.equal(ready.metadata.status, "success");
    assert.equal(persisting.metadata.status, "loading");
    assert.equal(persisting.metadata.content, "blob:audio");
    assert.equal(persisting.metadata.storageKey, "audio:stored");
    assert.equal(automatic.metadata.advanceMode, "auto");
    assert.equal(persisting.metadata.advanceMode, "review");
});

test("failure and cancellation discard staged legacy payloads and restore the selected persisted version", () => {
    const ready = appendResultSlotSuccess(createCanvasResultSlot({ id: "slot", mode: "video", position: { x: 0, y: 0 } }), {
        id: "persisted",
        artifacts: [{ id: "video-old", kind: "video", content: "wg-media://old", storageKey: "video:old", mimeType: "video/mp4" }],
    });
    const staged = {
        ...ready,
        metadata: {
            ...ready.metadata,
            slotState: "running" as const,
            status: "loading" as const,
            content: "wg-media://partial",
            storageKey: "video:partial",
            mimeType: "video/partial",
        },
    };

    const canceled = setCanvasResultSlotState(staged, "ready");
    assert.equal(canceled.metadata.content, "wg-media://old");
    assert.equal(canceled.metadata.storageKey, "video:old");
    assert.equal(canceled.metadata.mimeType, "video/mp4");

    const failed = appendResultSlotFailure(staged, { id: "failed-attempt", errorDetails: "请求超时" });
    assert.equal(failed.metadata.slotState, "error");
    assert.equal(failed.metadata.content, "wg-media://old");
    assert.equal(failed.metadata.storageKey, "video:old");
    assert.equal(failed.metadata.mimeType, "video/mp4");
    assert.equal(failed.metadata.currentResultVersionId, "persisted");
});

test("an empty result slot never exposes an unpersisted legacy payload after a failed attempt", () => {
    const empty = createCanvasResultSlot({ id: "slot", mode: "image", position: { x: 0, y: 0 } });
    const staged = {
        ...empty,
        metadata: { ...empty.metadata, content: "blob:partial", storageKey: "image:partial", status: "loading" as const, slotState: "running" as const },
    };
    const failed = appendResultSlotFailure(staged, { id: "failed", errorDetails: "生成失败" });
    const synchronized = synchronizeResultSlotSelectedOutput(failed);

    assert.equal(synchronized.metadata.content, "");
    assert.equal(synchronized.metadata.storageKey, undefined);
    assert.equal(synchronized.metadata.currentResultVersionId, undefined);
    assert.equal(synchronized.metadata.status, "error");
});

test("workflow errors always move their result slot into a visible error state", () => {
    const empty = createCanvasResultSlot({ id: "slot", mode: "video", position: { x: 0, y: 0 } });
    const running = syncResultSlotWorkflowStatus(empty, "running");
    const failed = syncResultSlotWorkflowStatus(running, "error", "本地视频保存失败");

    assert.equal(running.metadata.slotState, "running");
    assert.equal(failed.metadata.slotState, "error");
    assert.equal(failed.metadata.status, "error");
    assert.equal(failed.metadata.errorDetails, "本地视频保存失败");
});

test("workflow errors remain visibly failed while preserving the last durable preview", () => {
    const ready = appendResultSlotSuccess(createCanvasResultSlot({ id: "slot", mode: "image", position: { x: 0, y: 0 } }), {
        id: "stored",
        artifacts: [{ id: "image", kind: "image", content: "asset://localhost/stored.png", storageKey: "image:stored" }],
    });
    const failed = syncResultSlotWorkflowStatus(syncResultSlotWorkflowStatus(ready, "running"), "error", "供应商请求超时");

    assert.equal(failed.metadata.slotState, "error");
    assert.equal(failed.metadata.status, "error");
    assert.equal(failed.metadata.errorDetails, "供应商请求超时");
    assert.equal(failed.metadata.content, "asset://localhost/stored.png", "a failed retry must not erase the last durable result");
    assert.equal(failed.metadata.storageKey, "image:stored");
});

test("the executor error event writes its exact message into the owned result slot", async () => {
    let slot = createCanvasResultSlot({ id: "slot", mode: "video", position: { x: 0, y: 0 } });
    const execution = createWorkflowExecution({
        mode: "automatic",
        graph: { nodes: [{ id: "render" }], edges: [] },
        runNode: async () => {
            throw new Error("火山方舟返回了不支持的参数");
        },
    });
    execution.subscribe((event) => {
        if (event.type !== "node_status_changed" || event.nodeId !== "render") return;
        slot = syncResultSlotWorkflowStatus(slot, event.status, event.error?.message);
    });

    await execution.start();

    assert.equal(slot.metadata.slotState, "error");
    assert.equal(slot.metadata.status, "error");
    assert.equal(slot.metadata.errorDetails, "火山方舟返回了不支持的参数");
});

test("result-slot controls never bypass an owned workflow or continue while work is active", () => {
    assert.deepEqual(resolveCanvasResultSlotExecutionControls("waiting_review", "ready"), {
        busy: false,
        canContinue: true,
        regenerateWith: "workflow",
    });
    assert.deepEqual(resolveCanvasResultSlotExecutionControls("running", "running"), {
        busy: true,
        canContinue: false,
        regenerateWith: undefined,
    });
    assert.deepEqual(resolveCanvasResultSlotExecutionControls("error", "error"), {
        busy: false,
        canContinue: false,
        regenerateWith: "workflow",
    });
    assert.deepEqual(resolveCanvasResultSlotExecutionControls(undefined, "ready"), {
        busy: false,
        canContinue: false,
        regenerateWith: "direct",
    });
});

test("a video persistence failure keeps the last durable video selected", () => {
    const previous = appendResultSlotSuccess(createCanvasResultSlot({ id: "video-slot", mode: "video", position: { x: 0, y: 0 } }), {
        id: "stored-version",
        artifacts: [{ id: "stored-video", kind: "video", content: "asset://localhost/old.mp4", storageKey: "video:old", mimeType: "video/mp4" }],
    });
    const running = syncResultSlotWorkflowStatus(previous, "running");
    const failed = appendResultSlotFailure(running, { id: "failed-version", errorDetails: "视频已生成，但无法保存到本地" });

    assert.equal(failed.metadata.slotState, "error");
    assert.equal(failed.metadata.status, "success", "the durable preview remains readable");
    assert.equal(failed.metadata.currentResultVersionId, "stored-version");
    assert.equal(failed.metadata.content, "asset://localhost/old.mp4");
    assert.equal(failed.metadata.storageKey, "video:old");
});

test("only an actively executing workflow node owns the generation stop action", () => {
    assert.equal(workflowNodeOwnsGenerationStop("queued"), true);
    assert.equal(workflowNodeOwnsGenerationStop("running"), true);
    assert.equal(workflowNodeOwnsGenerationStop("persisting"), true);
    assert.equal(workflowNodeOwnsGenerationStop("completed"), false);
    assert.equal(workflowNodeOwnsGenerationStop("error"), false);
    assert.equal(workflowNodeOwnsGenerationStop("stopped"), false);
    assert.equal(workflowNodeOwnsGenerationStop(undefined), false);
});
