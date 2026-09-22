import type { CanvasNodeData } from "../../types/canvas";

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
