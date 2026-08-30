import { getNodeSpec, NODE_DEFAULT_SIZE } from "@/constant/canvas";
import { nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import type { AiConfig } from "@/stores/use-config-store";
import type { UploadedImage } from "@/services/image-storage";
import type { UploadedFile } from "@/services/file-storage";
import type { StructuredAssetImage, StructuredAssetKind } from "@/stores/use-asset-store";
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

export function createStructuredAssetGroup(
    asset: { assetKind: StructuredAssetKind; title: string; description: string; fields: Record<string, string>; images: StructuredAssetImage[] },
    center: Position,
) {
    const columns = asset.images.length > 1 ? 2 : 1;
    const tileWidth = 240;
    const tileHeight = 176;
    const gap = 24;
    const padding = 32;
    const details = [asset.description, ...Object.entries(asset.fields).filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}：${value}`)].filter(Boolean).join("\n\n");
    const rows = Math.max(1, Math.ceil(asset.images.length / columns));
    const groupWidth = Math.max(440, columns * tileWidth + (columns - 1) * gap + padding * 2);
    const detailHeight = details ? 144 : 0;
    const groupHeight = 64 + detailHeight + rows * tileHeight + Math.max(0, rows - 1) * gap + padding * 2;
    const group = {
        ...createCanvasNode(CanvasNodeType.Group, center),
        title: `${asset.assetKind === "character" ? "人物" : "场景"} · ${asset.title}`,
        width: groupWidth,
        height: groupHeight,
        position: { x: center.x - groupWidth / 2, y: center.y - groupHeight / 2 },
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
    const imageNodes = asset.images.map((image, index) => {
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
                prompt: image.prompt,
            },
        );
        return { ...node, title: image.title || `${asset.title} · 素材 ${index + 1}`, width: tileWidth, height: tileHeight, position: { x: group.position.x + padding + column * (tileWidth + gap), y: imageTop + row * (tileHeight + gap) } };
    });
    return [group, ...(detailNode ? [detailNode] : []), ...imageNodes];
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
