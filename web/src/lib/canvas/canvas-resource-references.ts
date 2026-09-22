import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { builtinCanvasResourceKind, directUpstreamNodeIds, isReadyCanvasResourceValue } from "@/lib/canvas/canvas-input-bindings";
import { getCanvasInputSources } from "@/lib/canvas/canvas-group-inputs";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

export type CanvasResourceKind = "image" | "video" | "audio" | "text" | "file";

export type CanvasResourceReference = {
    id: string;
    nodeId: string;
    kind: CanvasResourceKind;
    label: string;
    title: string;
    previewUrl?: string;
    storageKey?: string;
    text?: string;
    fileName?: string;
    mimeType?: string;
    bytes?: number;
    /** Stable input revision used to tell whether a referenced input actually changed. */
    inputRevision?: string;
    /** Pending result slots remain selectable, but are not valid execution inputs yet. */
    ready: boolean;
    active: boolean;
    bindingKind?: "character" | "scene" | "group";
    bindingNodeIds?: string[];
    members?: CanvasResourceReference[];
};

export function buildNodeMentionReferences(node: CanvasNodeData, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const candidates = node.type === CanvasNodeType.Group ? nodes.filter((item) => item.metadata?.groupId === node.id && item.type !== CanvasNodeType.Config) : getMentionResourceNodes(node.id, nodes, connections);
    const counts = { character: 0, scene: 0, group: 0 };
    const leaves = labelResourceNodes(candidates);
    return candidates.flatMap((candidate): CanvasResourceReference[] => {
        if (candidate.type !== CanvasNodeType.Group) return leaves.filter((item) => item.nodeId === candidate.id);
        const bindingKind = candidate.metadata?.assetKind || (/^(?:人物|角色)\s*·\s*/u.test(candidate.title) ? "character" : /^场景\s*·\s*/u.test(candidate.title) ? "scene" : "group");
        const label = `${bindingKind === "character" ? "角色" : bindingKind === "scene" ? "场景" : "组"}${++counts[bindingKind]}`;
        const sources = getCanvasInputSources("", nodes, [{ fromNodeId: candidate.id, toNodeId: "" }]);
        const members = labelResourceNodes(sources.map((source) => source.node));
        const ready = members.length === sources.length && members.length > 0 && members.every((item) => item.ready);
        return [
            {
                id: candidate.id,
                nodeId: candidate.id,
                kind: "text",
                bindingKind,
                label,
                title: candidate.title || label,
                members,
                text: candidate.metadata?.groupPrompt || members.map((item) => item.title).join("、"),
                previewUrl: members.find((item) => item.kind === "image" && item.ready)?.previewUrl,
                ready,
                active: true,
                inputRevision: members.map((item) => `${item.id}:${item.inputRevision}`).join("|"),
            },
        ];
    });
}

export function getMentionResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const ownInputs = getContextResourceNodes(nodeId, nodes, connections);
    if (ownInputs.length) return ownInputs;
    const node = nodes.find((item) => item.id === nodeId);
    return node && isCanvasResourceNodeReady(node) ? [node] : [];
}

export function getGenerationResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    return getCanvasInputSources(nodeId, nodes, connections).map((source) => source.node);
}

function getContextResourceNodes(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return directUpstreamNodeIds(nodeId, connections)
        .map((upstreamId) => nodeById.get(upstreamId))
        .filter((node): node is CanvasNodeData => Boolean(node && (node.type === CanvasNodeType.Group || getCanvasResourceKind(node))));
}

function labelResourceNodes(nodes: CanvasNodeData[]) {
    const counts: Record<CanvasResourceKind, number> = { image: 0, video: 0, audio: 0, text: 0, file: 0 };
    return nodes.flatMap((node): CanvasResourceReference[] => {
        const kind = getCanvasResourceKind(node);
        if (!kind) return [];
        const ready = isCanvasResourceNodeReady(node);
        const resource = getNodeDefinition(node.type)?.resource?.(node);
        const text = ready ? resourceText(node) : undefined;
        const inputRevision =
            kind === "text"
                ? text || ""
                : ready
                  ? resource?.storageKey || node.metadata?.storageKey || resource?.url || node.metadata?.content || ""
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
                storageKey: ready ? resource?.storageKey || node.metadata?.storageKey : undefined,
                text: ready ? text : "等待上游结果",
                fileName: ready && kind === "file" ? resource?.fileName || node.metadata?.fileName || node.title : undefined,
                mimeType: ready ? resource?.mimeType || node.metadata?.mimeType : undefined,
                bytes: ready ? resource?.bytes || node.metadata?.bytes : undefined,
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
    if (kind === "file") return `文件${index + 1}`;
    return `文本${index + 1}`;
}

function resourceText(node: CanvasNodeData): string | undefined {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content;
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    return resource?.kind === "text" ? resource.text : undefined;
}

export function getCanvasResourceKind(node: CanvasNodeData): CanvasResourceKind | null {
    const builtinKind = builtinCanvasResourceKind(node.type);
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
    if (kind === "file") return isReadyCanvasResourceValue(node.metadata?.status, resource?.storageKey || node.metadata?.storageKey, resultSlotState);
    const value = (resource?.kind === kind ? resource.url || resource.storageKey : undefined) || node.metadata?.content || node.metadata?.storageKey;
    return isReadyCanvasResourceValue(node.metadata?.status, value, resultSlotState);
}
