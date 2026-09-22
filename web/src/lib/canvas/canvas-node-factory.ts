import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { resolveStructuredAssetReferenceMedia, structuredAssetSettingParts } from "@/lib/structured-asset-reference";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { StructuredAsset, StructuredAssetKind } from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasImageGenerationType, type CanvasNodeData, type CanvasNodeMetadata, type CanvasNodeTypeId, type Position } from "@/types/canvas";

export function createCanvasNode(type: CanvasNodeTypeId, position: Position, metadata?: CanvasNodeMetadata): CanvasNodeData {
    const spec = getNodeSpec(type);
    const id = `${type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

    return {
        id,
        type,
        title: spec.title,
        position: {
            x: position.x - spec.width / 2,
            y: position.y - spec.height / 2,
        },
        width: spec.width,
        height: spec.height,
        metadata: { ...spec.metadata, ...metadata },
    };
}

export function createStructuredAssetGroup(asset: StructuredAsset["data"] & { assetKind: StructuredAssetKind; title: string; sourceAssetId?: string }, center: Position) {
    const source = { ...asset, kind: asset.assetKind };
    const resolved = resolveStructuredAssetReferenceMedia(source);
    const referencePrompt = resolved.prompt;
    const explicitMediaIds = new Set(Array.from(referencePrompt.matchAll(/@\[node:([^\]]+)\]/gu), (match) => match[1]));
    // Legacy assets retain their historical import behaviour. Collection assets
    // are an authored selection: only media named by the reference survives.
    const images = asset.collectionVersion === 1 ? resolved.images : asset.images.filter((image) => image.id !== asset.avatarImageId && image.partId !== "avatar" && (image.isCurrent !== false || explicitMediaIds.has(image.id)));
    const audios = asset.collectionVersion === 1 ? resolved.audios : (asset.audios || []).filter((audio) => audio.isCurrent !== false || explicitMediaIds.has(audio.id));
    const columns = images.length + audios.length > 1 ? 2 : 1;
    const tileWidth = 240;
    const tileHeight = 176;
    const gap = 24;
    const padding = 32;
    const details =
        asset.collectionVersion === 1
            ? referencePrompt
            : [
                  asset.description,
                  ...Object.entries(asset.fields)
                      .filter(([, value]) => Boolean(value))
                      .map(([label, value]) => `${label}：${value}`),
                  ...structuredAssetSettingParts(asset.assetKind, asset.parts).map((part) => `${part.title}：${part.prompt}`),
              ]
                  .filter(Boolean)
                  .join("\n\n");
    const rows = Math.max(1, Math.ceil((images.length + audios.length) / columns));
    const groupWidth = Math.max(440, columns * tileWidth + (columns - 1) * gap + padding * 2);
    const detailHeight = details ? 144 : 0;
    const groupHeight = 64 + detailHeight + rows * tileHeight + Math.max(0, rows - 1) * gap + padding * 2;
    const group = {
        ...createCanvasNode(CanvasNodeType.Group, center),
        title: `${asset.assetKind === "character" ? "人物" : "场景"} · ${asset.title}`,
        width: 320,
        height: 240,
        position: { x: center.x - 160, y: center.y - 120 },
        metadata: {
            assetKind: asset.assetKind,
            ...(asset.collectionVersion === 1 ? { assetCollectionVersion: 1 as const } : {}),
            ...(asset.sourceAssetId ? { assetSourceId: asset.sourceAssetId } : {}),
            ...(asset.avatarImageId && asset.images.find((image) => image.id === asset.avatarImageId)?.dataUrl ? { assetCoverUrl: asset.images.find((image) => image.id === asset.avatarImageId)!.dataUrl } : {}),
            groupCollapsed: true,
            groupExpandedWidth: groupWidth,
            groupExpandedHeight: groupHeight,
        },
    };
    const contentTop = group.position.y + 48;
    const detailNode = details
        ? {
              ...createCanvasNode(CanvasNodeType.Text, { x: group.position.x + groupWidth / 2, y: contentTop + detailHeight / 2 }, { content: details, status: "success", fontSize: 13, groupId: group.id }),
              title: `${asset.title} · 资料`,
              width: groupWidth - padding * 2,
              height: detailHeight - 12,
              position: { x: group.position.x + padding, y: contentTop },
          }
        : null;
    const imageTop = contentTop + detailHeight + (details ? 16 : 0);
    const imageNodes = images.map((image, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        const node = createCanvasNode(
            CanvasNodeType.Image,
            { x: group.position.x + padding + column * (tileWidth + gap) + tileWidth / 2, y: imageTop + row * (tileHeight + gap) + tileHeight / 2 },
            {
                content: image.dataUrl,
                storageKey: image.storageKey,
                status: "success",
                naturalWidth: image.width,
                naturalHeight: image.height,
                bytes: image.bytes,
                mimeType: image.mimeType,
                groupId: group.id,
                assetSourceItemId: image.id,
                prompt: image.prompt,
            },
        );
        return { ...node, title: image.title || `${asset.title} · 素材 ${index + 1}`, width: tileWidth, height: tileHeight, position: { x: group.position.x + padding + column * (tileWidth + gap), y: imageTop + row * (tileHeight + gap) } };
    });
    const audioNodes = audios.map((audio, index) => {
        const column = (images.length + index) % columns;
        const row = Math.floor((images.length + index) / columns);
        const position = { x: group.position.x + padding + column * (tileWidth + gap), y: imageTop + row * (tileHeight + gap) };
        return {
            ...createCanvasNode(CanvasNodeType.Audio, position, { content: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs, bytes: audio.bytes, mimeType: audio.mimeType, status: "success", groupId: group.id, assetSourceItemId: audio.id }),
            title: audio.title || `${asset.title} · 音频 ${index + 1}`,
            position,
            width: tileWidth,
            height: tileHeight,
        };
    });
    const mediaNodeIds = new Map([...images.map((image, index) => [image.id, imageNodes[index].id] as const), ...audios.map((audio, index) => [audio.id, audioNodes[index].id] as const)]);
    const mappedPrompt = referencePrompt.replace(/@\[node:([^\]]+)\]/gu, (token, id: string) => (mediaNodeIds.has(id) ? `@[node:${mediaNodeIds.get(id)}]` : token));
    if (detailNode && asset.collectionVersion === 1) detailNode.metadata = { ...detailNode.metadata, assetSourceItemId: "reference-prompt", content: details.replace(/@\[node:([^\]]+)\]/gu, (token, id: string) => (mediaNodeIds.has(id) ? `@[node:${mediaNodeIds.get(id)}]` : token)) };
    const groupPrompt = asset.collectionVersion === 1 || typeof asset.referencePrompt === "string" ? mappedPrompt : [mappedPrompt, detailNode ? `资料：@[node:${detailNode.id}]` : ""].filter(Boolean).join("\n");
    return [{ ...group, metadata: { ...group.metadata, groupPrompt } }, ...(detailNode ? [detailNode] : []), ...imageNodes, ...audioNodes];
}

/** Refreshes the imported projection while keeping group and selected child IDs stable for existing wires. */
export function refreshStructuredAssetGroup(nodes: CanvasNodeData[], asset: StructuredAsset["data"] & { assetKind: StructuredAssetKind; title: string; sourceAssetId: string }, groupId: string, connections: Array<{ fromNodeId: string; toNodeId: string }>) {
    const group = nodes.find((node) => node.id === groupId && node.type === CanvasNodeType.Group);
    if (!group) return nodes;
    const fresh = createStructuredAssetGroup(asset, { x: group.position.x + group.width / 2, y: group.position.y + group.height / 2 });
    const oldBySourceItem = new Map(nodes.filter((node) => node.metadata?.groupId === groupId && node.metadata.assetSourceItemId).map((node) => [node.metadata!.assetSourceItemId!, node]));
    const ids = new Map<string, string>([[fresh[0].id, groupId]]);
    for (const node of fresh.slice(1)) {
        const existing = node.metadata?.assetSourceItemId ? oldBySourceItem.get(node.metadata.assetSourceItemId) : undefined;
        if (existing && existing.type === node.type) ids.set(node.id, existing.id);
    }
    const remap = (value: string | undefined) => value?.replace(/@\[node:([^\]]+)\]/gu, (token, id: string) => (ids.has(id) ? `@[node:${ids.get(id)}]` : token));
    const replacements = fresh.map((node) => {
        const id = ids.get(node.id) || node.id;
        const previous = nodes.find((item) => item.id === id);
        return {
            ...node,
            id,
            position: id === groupId ? group.position : node.position,
            metadata: { ...node.metadata, groupId: node.metadata?.groupId ? groupId : undefined, groupPrompt: remap(node.metadata?.groupPrompt), content: remap(node.metadata?.content) },
            ...(previous ? { width: node.id === fresh[0].id ? node.width : node.width, height: node.id === fresh[0].id ? node.height : node.height } : {}),
        };
    });
    const replacementIds = new Set(replacements.map((node) => node.id));
    const staleSourceChildren = new Set(nodes.filter((node) => node.metadata?.groupId === groupId && node.metadata?.assetSourceItemId && !replacementIds.has(node.id)).map((node) => node.id));
    const connectedStale = new Set(connections.flatMap((connection) => [connection.fromNodeId, connection.toNodeId]));
    return [
        ...nodes.filter((node) => !replacementIds.has(node.id) && (!staleSourceChildren.has(node.id) || connectedStale.has(node.id))).map((node) => (staleSourceChildren.has(node.id) ? { ...node, metadata: { ...node.metadata, groupId: undefined } } : node)),
        ...replacements,
    ];
}

export function imageMetadata(image: UploadedImage): CanvasNodeMetadata {
    return { content: image.url, storageKey: image.storageKey, status: "success", naturalWidth: image.width, naturalHeight: image.height, bytes: image.bytes, mimeType: image.mimeType };
}

export function videoMetadata(video: UploadedFile): CanvasNodeMetadata {
    return { content: video.url, storageKey: video.storageKey, status: "success", naturalWidth: video.width, naturalHeight: video.height, bytes: video.bytes, mimeType: video.mimeType || "video/mp4", durationMs: video.durationMs };
}

export function audioMetadata(audio: UploadedFile): CanvasNodeMetadata {
    return { content: audio.url, storageKey: audio.storageKey, status: "success", bytes: audio.bytes, mimeType: audio.mimeType || "audio/mpeg", durationMs: audio.durationMs };
}

export function referenceUrl(image: ReferenceImage) {
    return image.storageKey || image.url || (!image.dataUrl.startsWith("data:") ? image.dataUrl : undefined);
}

export function buildImageGenerationMetadata(type: CanvasImageGenerationType, config: AiConfig, count: number, references: ReferenceImage[]): CanvasNodeMetadata {
    return {
        generationType: type,
        model: config.model,
        size: config.size,
        quality: config.quality,
        ...(config.background ? { background: config.background } : {}),
        imageWatermark: config.imageWatermark,
        imageOptimizePrompt: config.imageOptimizePrompt,
        count,
        references: references.map(referenceUrl).filter((url): url is string => Boolean(url)),
    };
}

export function buildAudioGenerationMetadata(config: AiConfig): CanvasNodeMetadata {
    return {
        model: config.model,
        audioVoice: config.audioVoice,
        audioFormat: config.audioFormat,
        audioSpeed: config.audioSpeed,
        audioInstructions: config.audioInstructions,
    };
}

export function applyNodeConfigPatch(node: CanvasNodeData, patch: Partial<CanvasNodeData["metadata"]>) {
    const safePatch = patch || {};
    const next = { ...node, metadata: { ...node.metadata, ...safePatch } };
    const spec = node.type === CanvasNodeType.Video ? NODE_DEFAULT_SIZE[CanvasNodeType.Video] : NODE_DEFAULT_SIZE[CanvasNodeType.Image];
    const size = typeof safePatch.size === "string" && !node.metadata?.content ? nodeSizeFromRatio(safePatch.size, spec.width, spec.height) : null;
    return size && (node.type === CanvasNodeType.Image || node.type === CanvasNodeType.Video) ? { ...next, ...size, position: { x: node.position.x + node.width / 2 - size.width / 2, y: node.position.y + node.height / 2 - size.height / 2 } } : next;
}
