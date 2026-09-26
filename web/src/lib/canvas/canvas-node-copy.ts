import type { CanvasNodeData } from "../../types/canvas";

/** Runtime state must never be cloned into a new node. A copied node keeps its
 * durable content and generation settings, but starts as an idle, retryable
 * node instead of replaying the source node's spinner/task state. */
export function isCanvasNodeRunning(node: CanvasNodeData | undefined): boolean {
    const metadata = node?.metadata;
    if (!metadata) return false;
    return metadata.status === "loading" || metadata.slotState === "waiting" || metadata.slotState === "running" || metadata.slotState === "persisting" || metadata.videoTask?.state === "running" || metadata.videoTask?.state === "unknown";
}

export function sanitizeCanvasNodeForCopy(node: CanvasNodeData): CanvasNodeData {
    if (!node.metadata) return node;
    const metadata = { ...node.metadata };
    if (metadata.status === "loading") metadata.status = metadata.content || metadata.storageKey ? "success" : "idle";
    delete metadata.videoTask;
    delete metadata.errorDetails;
    delete metadata.generationFailureCode;
    if (metadata.slotState === "waiting" || metadata.slotState === "running" || metadata.slotState === "persisting") {
        metadata.slotState = metadata.currentResultVersionId ? "ready" : "empty";
        metadata.status = metadata.currentResultVersionId ? "success" : "idle";
    }
    return { ...node, metadata };
}

export function remapCanvasNodeReferences(node: CanvasNodeData, ids: ReadonlyMap<string, string>): CanvasNodeData {
    if (!node.metadata) return node;
    const metadata = { ...node.metadata };
    const remap = (value: string | undefined) => value?.replace(/@\[node:([^\]]+)\]/g, (token, id: string) => (ids.has(id) ? `@[node:${ids.get(id)}]` : token));
    for (const key of ["prompt", "composerContent", "groupPrompt"] as const) {
        if (metadata[key] !== undefined) metadata[key] = remap(metadata[key]);
    }
    if (metadata.groupId) metadata.groupId = ids.get(metadata.groupId);
    if (metadata.batchRootId) metadata.batchRootId = ids.get(metadata.batchRootId);
    if (metadata.batchChildIds) metadata.batchChildIds = metadata.batchChildIds.flatMap((id) => ids.get(id) || []);
    if (metadata.primaryImageId) metadata.primaryImageId = ids.get(metadata.primaryImageId);
    if (metadata.resultSlotSourceNodeId) metadata.resultSlotSourceNodeId = ids.get(metadata.resultSlotSourceNodeId) || metadata.resultSlotSourceNodeId;
    return { ...node, metadata };
}
