import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { builtinCanvasResourceKind, directUpstreamNodeIds, isReadyCanvasResourceValue } from "@/lib/canvas/canvas-input-bindings";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    storageKey?: string;
    text?: string;
    /** Stable input revision used by terminal sessions; live terminal text does not rev on every output chunk. */
    inputRevision?: string;
    /** Pending result slots remain selectable, but are not valid execution inputs yet. */
    ready: boolean;
    active: boolean;
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceNodes(getMentionResourceNodes(node.id, nodes, connections));
}

export function buildTerminalInputReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return labelResourceNodes(getContextResourceNodes(node.id, nodes, connections).filter(isCanvasResourceNodeReady));
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isCanvasResourceNodeReady(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return getContextResourceNodes(nodeId, nodes, connections);
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return directUpstreamNodeIds(nodeId, connections)
        .map((upstreamId) => nodeById.get(upstreamId))
        .filter((node): node is CanvasNodeData => Boolean(node && getCanvasResourceKind(node)));
}

function labelResourceNodes(nodes: CanvasNodeData[]) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = getCanvasResourceKind(node);
        if (!kind) return [];
        const ready = isCanvasResourceNodeReady(node);
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const text = ready ? resourceText(node) : undefined;
        const inputRevision =
            node.type === CanvasNodeType.Terminal && kind === "text"
                ? `terminal-output:${node.metadata?.terminalOutputRevision || 0}`
                : kind === "text"
                  ? text || ""
                  : ready
                    ? node.metadata?.terminalOutputArtifactStorageKey || node.metadata?.storageKey || resource?.url || node.metadata?.content || ""
                    : "";
        const index = counts[kind]++;
        const label = labelForKind(kind, index);
        return [
            {
                id: node.id,
                nodeId: node.id,
                kind,
                label,
                title: ready ? node.title || label : `${node.title || label} · 等待结果`,
                previewUrl: ready ? resource?.url || node.metadata?.content : undefined,
                storageKey: ready ? node.metadata?.terminalOutputArtifactStorageKey || node.metadata?.storageKey : undefined,
                text: ready ? text : "等待上游结果",
                inputRevision,
                ready,
                active: true,
            },
        ];
    });
}

function labelForKind(kind: CanvasResourceKind, index: number) {
    if (kind === "image") return imageReferenceLabel(index);
    if (kind === "video") return seedanceReferenceLabel("video", index);
    if (kind === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

export function getCanvasResourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    const builtinKind = builtinCanvasResourceKind(node.type, node.metadata?.terminalOutputMode);
    if (builtinKind) return builtinKind;
    // 插件节点通过 definition.resource 声明可作为输入
    return getNodeDefinition(node.type)?.resource?.(node)?.kind || null;
}

export function isCanvasResourceNodeReady(node: CanvasNodeData) {
    const kind = getCanvasResourceKind(node);
    if (!kind) return false;
    const resultSlotState = node.metadata?.role === "result-slot" ? node.metadata.slotState : undefined;
    if (kind === "text") return isReadyCanvasResourceValue(node.metadata?.status, resourceText(node), resultSlotState);
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return isReadyCanvasResourceValue(node.metadata?.status, resource?.kind === kind ? resource.url || node.metadata?.content : node.metadata?.content, resultSlotState);
}
