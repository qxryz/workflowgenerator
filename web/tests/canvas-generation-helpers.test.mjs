import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const calls = { images: [], media: [] };
globalThis.__canvasGenerationHelperMocks = calls;

const mockModules = new Map([
    [
        "@/stores/use-config-store",
        `export const defaultConfig = {};
         export const resolveModelForCapability = (_config, model) => model || "model";`,
    ],
    [
        "@/services/image-storage",
        `export async function resolveImageUrl(storageKey, fallback = "") {
             globalThis.__canvasGenerationHelperMocks.images.push([storageKey, fallback]);
             return "desktop-image://" + storageKey;
         }
         export async function uploadImage() { throw new Error("unexpected upload"); }`,
    ],
    [
        "@/services/file-storage",
        `export async function resolveMediaUrl(storageKey, fallback = "") {
             globalThis.__canvasGenerationHelperMocks.media.push([storageKey, fallback]);
             return "desktop-media://" + storageKey;
         }`,
    ],
    [
        "@/lib/canvas/canvas-node-factory",
        `export const imageMetadata = (image) => image;
         export const referenceUrl = (image) => image.storageKey || image.url;`,
    ],
    [
        "@/types/canvas",
        `export const CanvasNodeType = { Image: "image", Text: "text", Config: "config", Video: "video", Audio: "audio", Terminal: "terminal", Group: "group" };`,
    ],
]);

registerHooks({
    resolve(specifier, context, nextResolve) {
        const source = mockModules.get(specifier);
        if (source !== undefined) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
        return nextResolve(specifier, context);
    },
});

const { beginCanvasImageBatch, hydrateCanvasImages, isCurrentCanvasImageBatchSettled, resetInterruptedGeneration } = await import("../src/lib/canvas/canvas-generation-helpers.ts");

function node(id, type, metadata) {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 200, metadata };
}

function successVersion(id, kind, artifacts, primaryArtifactId = artifacts[0].id) {
    return { id, status: "success", artifacts: artifacts.map((artifact) => ({ kind, ...artifact })), primaryArtifactId };
}

test("hydrates every persisted result-slot artifact and mirrors the selected primary artifact", async () => {
    calls.images.length = 0;
    calls.media.length = 0;
    const failedAttempt = { id: "image-failed", status: "error", artifacts: [], errorDetails: "额度不足" };
    const restored = await hydrateCanvasImages([
        node("image-slot", "image", {
            role: "result-slot",
            resultVersions: [
                successVersion(
                    "image-v1",
                    "image",
                    [
                        { id: "image-a", content: "old-a", storageKey: "image:a", mimeType: "image/png" },
                        { id: "image-b", content: "old-b", storageKey: "image:b", mimeType: "image/png" },
                    ],
                    "image-b",
                ),
                failedAttempt,
                successVersion("image-v2", "image", [{ id: "image-c", content: "old-c", storageKey: "image:c" }]),
            ],
            currentResultVersionId: "image-v1",
            content: "stale-current-url",
        }),
        node("video-slot", "video", {
            role: "result-slot",
            resultVersions: [successVersion("video-v1", "video", [{ id: "video-a", content: "old-video", storageKey: "video:a" }])],
            currentResultVersionId: "video-v1",
        }),
        node("audio-slot", "audio", {
            role: "result-slot",
            resultVersions: [successVersion("audio-v1", "audio", [{ id: "audio-a", content: "old-audio", storageKey: "audio:a" }])],
            currentResultVersionId: "audio-v1",
        }),
        node("text-slot", "text", {
            role: "result-slot",
            resultVersions: [successVersion("text-v1", "text", [{ id: "text-a", content: "可恢复的文本" }])],
            currentResultVersionId: "text-v1",
            content: "旧文本",
        }),
    ]);

    const imageSlot = restored[0];
    assert.deepEqual(
        imageSlot.metadata.resultVersions[0].artifacts.map((artifact) => artifact.content),
        ["desktop-image://image:a", "desktop-image://image:b"],
    );
    assert.equal(imageSlot.metadata.resultVersions[1], failedAttempt);
    assert.equal(imageSlot.metadata.resultVersions[2].artifacts[0].content, "desktop-image://image:c");
    assert.equal(imageSlot.metadata.content, "desktop-image://image:b");
    assert.equal(imageSlot.metadata.storageKey, "image:b");
    assert.equal(restored[1].metadata.content, "desktop-media://video:a");
    assert.equal(restored[2].metadata.content, "desktop-media://audio:a");
    assert.equal(restored[3].metadata.content, "可恢复的文本");
    assert.deepEqual(
        calls.images.map(([storageKey]) => storageKey),
        ["image:a", "image:b", "image:c"],
    );
    assert.deepEqual(
        calls.media.map(([storageKey]) => storageKey),
        ["video:a", "audio:a"],
    );
});

test("interrupted result slots retain a selected success as a readable stale result", () => {
    const versions = [
        successVersion("v1", "image", [{ id: "a", content: "readable-a", storageKey: "image:a", mimeType: "image/png" }]),
        successVersion("v2", "image", [{ id: "b", content: "readable-b", storageKey: "image:b" }]),
    ];
    const [restored] = resetInterruptedGeneration([
        node("slot", "image", {
            role: "result-slot",
            slotState: "persisting",
            status: "loading",
            resultVersions: versions,
            currentResultVersionId: "v1",
            content: "unfinished",
        }),
    ]);

    assert.equal(restored.metadata.slotState, "stale");
    assert.equal(restored.metadata.status, "success");
    assert.equal(restored.metadata.currentResultVersionId, "v1");
    assert.equal(restored.metadata.content, "readable-a");
    assert.equal(restored.metadata.storageKey, "image:a");
    assert.equal(restored.metadata.resultVersions, versions);
    assert.match(restored.metadata.errorDetails, /已保留上次结果/);
});

test("interrupted result slots recover the newest readable success when the selection is missing", () => {
    const [restored] = resetInterruptedGeneration([
        node("slot", "video", {
            role: "result-slot",
            slotState: "running",
            status: "loading",
            resultVersions: [
                successVersion("v1", "video", [{ id: "a", content: "first", storageKey: "video:a" }]),
                { id: "failed", status: "error", artifacts: [], errorDetails: "失败" },
                successVersion("v2", "video", [{ id: "b", content: "latest", storageKey: "video:b" }]),
            ],
        }),
    ]);

    assert.equal(restored.metadata.slotState, "stale");
    assert.equal(restored.metadata.currentResultVersionId, "v2");
    assert.equal(restored.metadata.content, "latest");
});

test("interrupted empty result slots become retryable errors without keeping partial output", () => {
    const failedAttempt = { id: "failed", status: "error", artifacts: [], errorDetails: "上次失败" };
    const [restored] = resetInterruptedGeneration([
        node("slot", "audio", {
            role: "result-slot",
            slotState: "waiting",
            status: "idle",
            resultVersions: [failedAttempt],
            content: "partial-output",
            storageKey: "audio:partial",
        }),
    ]);

    assert.equal(restored.metadata.slotState, "error");
    assert.equal(restored.metadata.status, "error");
    assert.equal(restored.metadata.content, "");
    assert.equal(restored.metadata.storageKey, undefined);
    assert.equal(restored.metadata.currentResultVersionId, undefined);
    assert.equal(restored.metadata.resultVersions[0], failedAttempt);
    assert.match(restored.metadata.errorDetails, /可重新生成/);
});

test("ordinary interrupted nodes keep the existing retry behavior", () => {
    const [restored] = resetInterruptedGeneration([node("ordinary", "image", { status: "loading", content: "partial" })]);
    assert.equal(restored.metadata.status, "error");
    assert.equal(restored.metadata.content, "partial");
    assert.match(restored.metadata.errorDetails, /页面刷新后生成已中断/);
});

test("a regenerated multi-image batch drops the old primary and waits only for its new candidates", () => {
    const metadata = beginCanvasImageBatch(
        {
            role: "result-slot",
            primaryImageId: "old-primary",
            batchChildIds: ["old-a", "old-b"],
            imageBatchExpanded: false,
            content: "old-preview",
        },
        ["new-a", "new-b"],
        true,
    );
    const slot = node("slot", "image", metadata);
    const oldA = node("old-a", "image", { status: "success", content: "old-a" });
    const oldB = node("old-b", "image", { status: "success", content: "old-b" });
    const newA = node("new-a", "image", { status: "success", content: "new-a" });
    const newBLoading = node("new-b", "image", { status: "loading" });
    const newBFailed = node("new-b", "image", { status: "error", errorDetails: "failed" });

    assert.equal(metadata.primaryImageId, undefined);
    assert.deepEqual(metadata.batchChildIds, ["new-a", "new-b"]);
    assert.equal(metadata.imageBatchExpanded, false, "result slots keep their candidates inside the slot instead of expanding duplicate child cards");
    assert.equal(metadata.content, "old-preview", "the prior version remains available while the new batch runs");
    assert.equal(isCurrentCanvasImageBatchSettled(slot, [slot, oldA, oldB, newA, newBLoading]), false);
    assert.equal(isCurrentCanvasImageBatchSettled(slot, [slot, oldA, oldB, newA, newBFailed]), true);
});

test("ordinary image batches still expand on the canvas", () => {
    const metadata = beginCanvasImageBatch({ content: "preview" }, ["a", "b"], false);
    assert.equal(metadata.imageBatchExpanded, true);
});
