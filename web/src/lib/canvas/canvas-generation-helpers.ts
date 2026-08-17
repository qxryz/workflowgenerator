import { defaultConfig, resolveModelForCapability, type AiConfig } from "@/stores/use-config-store";
import { resolveImageUrl, uploadImage } from "@/services/image-storage";
import { resolveMediaUrl } from "@/services/file-storage";
import { imageMetadata, referenceUrl } from "@/lib/canvas/canvas-node-factory";
import type { NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import type { CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import type { CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import type { ReferenceImage } from "@/types/image";
import {
    CanvasNodeType,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type CanvasResultSlotArtifact,
    type CanvasResultSlotSuccessVersion,
} from "@/types/canvas";

export function imageExtension(dataUrl: string) {
    return dataUrl.match(/^data:image[/]([^;]+)/)?.[1] || dataUrl.match(/image[/]([^;]+)/)?.[1] || "png";
}

export function audioExtension(mimeType?: string) {
    if (mimeType?.includes("wav")) return "wav";
    if (mimeType?.includes("opus")) return "opus";
    if (mimeType?.includes("aac")) return "aac";
    if (mimeType?.includes("flac")) return "flac";
    if (mimeType?.includes("pcm")) return "pcm";
    return "mp3";
}

export function generationReferenceUrls(context: { referenceImages: ReferenceImage[]; referenceVideos: Array<{ storageKey?: string; url?: string }>; referenceAudios?: Array<{ storageKey?: string; url?: string }> }) {
    return [
        ...context.referenceImages.map(referenceUrl).filter((url): url is string => Boolean(url)),
        ...context.referenceVideos.map((video) => video.storageKey || video.url).filter((url): url is string => Boolean(url)),
        ...(context.referenceAudios || []).map((audio) => audio.storageKey || audio.url).filter((url): url is string => Boolean(url)),
    ];
}

export async function resolveMetadataReferences(metadata: CanvasNodeMetadata) {
    if (metadata.generationType !== "edit") return [];
    if (!metadata.references?.length) return null;
    const references = await Promise.all(
        metadata.references.map(async (url, index) => {
            const dataUrl = url.startsWith("image:") ? await resolveImageUrl(url, "") : url;
            return dataUrl ? { id: `${index}`, name: `reference-${index}.png`, type: "image/png", dataUrl, storageKey: url.startsWith("image:") ? url : undefined } : null;
        }),
    );
    return references.every(Boolean) ? (references as ReferenceImage[]) : null;
}

export async function hydrateCanvasImages(nodes: CanvasNodeData[]) {
    return Promise.all(
        nodes.map(async (originalNode) => {
            const resultSlotMetadata = await hydrateResultSlotMetadata(originalNode.metadata);
            const node = resultSlotMetadata === originalNode.metadata ? originalNode : { ...originalNode, metadata: resultSlotMetadata };
            if (Array.isArray(resultSlotMetadata?.resultVersions)) return node;

            const content = node.metadata?.content;
            if ((node.type === CanvasNodeType.Video || node.type === CanvasNodeType.Audio) && node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveMediaUrl(node.metadata.storageKey, content) } };
            if (node.type !== CanvasNodeType.Image || !content) return node;
            if (node.metadata?.storageKey) return { ...node, metadata: { ...node.metadata, content: await resolveImageUrl(node.metadata.storageKey, content) } };
            if (!content.startsWith("data:image/")) return node;
            return { ...node, metadata: { ...node.metadata, ...imageMetadata(await uploadImage(content)) } };
        }),
    );
}

async function hydrateResultSlotMetadata(metadata: CanvasNodeMetadata | undefined) {
    if (!metadata || !Array.isArray(metadata.resultVersions)) return metadata;

    const resultVersions = await Promise.all(
        metadata.resultVersions.map(async (version) => {
            if (version.status !== "success") return version;
            const artifacts = await Promise.all(version.artifacts.map(hydrateResultSlotArtifact));
            return { ...version, artifacts };
        }),
    );
    const currentVersion = resultVersions.find(
        (version): version is CanvasResultSlotSuccessVersion => version.status === "success" && version.id === metadata.currentResultVersionId,
    );
    const primaryArtifact = currentVersion?.artifacts.find((artifact) => artifact.id === currentVersion.primaryArtifactId);

    return {
        ...metadata,
        resultVersions,
        ...(primaryArtifact ? legacyResultMetadata(primaryArtifact) : {}),
    };
}

async function hydrateResultSlotArtifact(artifact: CanvasResultSlotArtifact) {
    if (!artifact.storageKey || artifact.kind === "text") return artifact;
    const content = artifact.kind === "image" ? await resolveImageUrl(artifact.storageKey, artifact.content) : await resolveMediaUrl(artifact.storageKey, artifact.content);
    return content === artifact.content ? artifact : { ...artifact, content };
}

export async function hydrateAssistantImages(sessions: CanvasAssistantSession[]) {
    const hydrateItem = async <T extends { dataUrl?: string; storageKey?: string }>(item: T) => {
        if (item.storageKey) return { ...item, dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl) };
        if (item.dataUrl?.startsWith("data:image/")) {
            const image = await uploadImage(item.dataUrl);
            return { ...item, dataUrl: image.url, storageKey: image.storageKey };
        }
        return item;
    };
    return Promise.all(
        sessions.map(async (session) => ({
            ...session,
            messages: await Promise.all(
                session.messages.map(async (message) => ({
                    ...message,
                    references: await Promise.all((message.references || []).map(hydrateItem)),
                })),
            ),
        })),
    );
}

export function getGenerationCount(count: string) {
    return Math.max(1, Math.min(15, Math.floor(Math.abs(Number(count)) || 1)));
}

/** Starts a new image batch without carrying the previous batch's primary item. */
export function beginCanvasImageBatch(metadata: CanvasNodeMetadata, childIds: readonly string[], usesReferenceImages: boolean): CanvasNodeMetadata {
    const isBatch = childIds.length > 0;
    const inlineResultSlot = metadata.role === "result-slot";
    return {
        ...metadata,
        isBatchRoot: isBatch,
        batchChildIds: isBatch ? [...childIds] : undefined,
        batchUsesReferenceImages: usesReferenceImages,
        primaryImageId: undefined,
        imageBatchExpanded: isBatch ? !inlineResultSlot : undefined,
    };
}

/** Reads only the candidates declared by the current batch, never an older sibling batch. */
export function isCurrentCanvasImageBatchSettled(slot: CanvasNodeData, nodes: readonly CanvasNodeData[]): boolean | undefined {
    if (slot.type !== CanvasNodeType.Image || !slot.metadata?.batchChildIds?.length) return undefined;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    return slot.metadata.batchChildIds.every((id) => {
        const candidate = nodeById.get(id);
        return Boolean(candidate && candidate.metadata?.status !== "loading");
    });
}

export function getInputSummary(inputs: NodeGenerationInput[]) {
    return {
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: inputs.filter((input) => input.type === "image").length,
        videoCount: inputs.filter((input) => input.type === "video").length,
        audioCount: inputs.filter((input) => input.type === "audio").length,
    };
}

export function buildGenerationConfig(config: AiConfig, node: CanvasNodeData | undefined, mode: CanvasNodeGenerationMode): AiConfig {
    return {
        ...config,
        model: resolveModelForCapability(config, node?.metadata?.model, mode),
        reasoningEffort: node?.metadata?.reasoningEffort || config.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node?.metadata?.quality || config.quality || defaultConfig.quality,
        size: node?.metadata?.size || config.size || defaultConfig.size,
        background: node?.metadata?.background ?? config.background ?? defaultConfig.background,
        imageWatermark: node?.metadata?.imageWatermark ?? config.imageWatermark ?? defaultConfig.imageWatermark,
        imageOptimizePrompt: node?.metadata?.imageOptimizePrompt ?? config.imageOptimizePrompt ?? defaultConfig.imageOptimizePrompt,
        videoSeconds: node?.metadata?.seconds || config.videoSeconds || defaultConfig.videoSeconds,
        vquality: node?.metadata?.vquality || config.vquality || defaultConfig.vquality,
        videoGenerateAudio: node?.metadata?.generateAudio || config.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node?.metadata?.watermark || config.videoWatermark || defaultConfig.videoWatermark,
        seedance25TaskMode: node?.metadata?.seedance25TaskMode || config.seedance25TaskMode || defaultConfig.seedance25TaskMode,
        seedance25Continuation: node?.metadata?.seedance25Continuation || config.seedance25Continuation || defaultConfig.seedance25Continuation,
        seedance25OutputFormat: node?.metadata?.seedance25OutputFormat || config.seedance25OutputFormat || defaultConfig.seedance25OutputFormat,
        seedance25InputMode: node?.metadata?.seedance25InputMode || config.seedance25InputMode || defaultConfig.seedance25InputMode,
        seedance25Seed: node?.metadata?.seedance25Seed || config.seedance25Seed || defaultConfig.seedance25Seed,
        seedance25ReturnLastFrame: node?.metadata?.seedance25ReturnLastFrame || config.seedance25ReturnLastFrame || defaultConfig.seedance25ReturnLastFrame,
        seedance25WebSearch: node?.metadata?.seedance25WebSearch || config.seedance25WebSearch || defaultConfig.seedance25WebSearch,
        seedance25CameraFixed: node?.metadata?.seedance25CameraFixed || config.seedance25CameraFixed || defaultConfig.seedance25CameraFixed,
        minimaxVideoInputMode: node?.metadata?.minimaxVideoInputMode || config.minimaxVideoInputMode || defaultConfig.minimaxVideoInputMode,
        minimaxVideoPromptOptimizer: node?.metadata?.minimaxVideoPromptOptimizer || config.minimaxVideoPromptOptimizer || defaultConfig.minimaxVideoPromptOptimizer,
        minimaxVideoFastPretreatment: node?.metadata?.minimaxVideoFastPretreatment || config.minimaxVideoFastPretreatment || defaultConfig.minimaxVideoFastPretreatment,
        audioVoice: node?.metadata?.audioVoice || config.audioVoice || defaultConfig.audioVoice,
        audioFormat: node?.metadata?.audioFormat || config.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node?.metadata?.audioSpeed || config.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node?.metadata?.audioInstructions || config.audioInstructions || defaultConfig.audioInstructions,
        count: String(node?.metadata?.count || (mode === "image" ? config.canvasImageCount || config.count : config.count) || defaultConfig.count),
    };
}

export function resetInterruptedGeneration(nodes: CanvasNodeData[]) {
    return nodes.map((node) => {
        const metadata = node.metadata;
        if (metadata?.role === "result-slot" && (metadata.slotState === "waiting" || metadata.slotState === "running" || metadata.slotState === "persisting")) {
            const successfulVersion = readableResultSlotVersion(metadata);
            const primaryArtifact = successfulVersion?.artifacts.find((artifact) => artifact.id === successfulVersion.primaryArtifactId);
            return {
                ...node,
                metadata: {
                    ...metadata,
                    ...(primaryArtifact ? legacyResultMetadata(primaryArtifact) : emptyLegacyResultMetadata()),
                    currentResultVersionId: successfulVersion?.id,
                    slotState: successfulVersion ? ("stale" as const) : ("error" as const),
                    status: successfulVersion ? ("success" as const) : ("error" as const),
                    errorDetails: successfulVersion ? "本次生成已中断，已保留上次结果。" : "生成已中断，可重新生成。",
                },
            };
        }
        return metadata?.status === "loading" ? { ...node, metadata: { ...metadata, status: "error" as const, errorDetails: "页面刷新后生成已中断，请重新生成。" } } : node;
    });
}

function readableResultSlotVersion(metadata: CanvasNodeMetadata) {
    const versions = metadata.resultVersions || [];
    const isReadable = (version: (typeof versions)[number]): version is CanvasResultSlotSuccessVersion =>
        version.status === "success" && version.artifacts.some((artifact) => artifact.id === version.primaryArtifactId && Boolean(artifact.content || artifact.storageKey));
    const current = versions.find((version) => version.id === metadata.currentResultVersionId && isReadable(version));
    if (current && isReadable(current)) return current;
    for (let index = versions.length - 1; index >= 0; index -= 1) {
        const version = versions[index];
        if (isReadable(version)) return version;
    }
    return undefined;
}

function legacyResultMetadata(artifact: CanvasResultSlotArtifact): Pick<CanvasNodeMetadata, "content" | "storageKey" | "mimeType" | "bytes" | "naturalWidth" | "naturalHeight" | "durationMs"> {
    return {
        content: artifact.content,
        storageKey: artifact.storageKey,
        mimeType: artifact.mimeType,
        bytes: artifact.bytes,
        naturalWidth: artifact.naturalWidth,
        naturalHeight: artifact.naturalHeight,
        durationMs: artifact.durationMs,
    };
}

function emptyLegacyResultMetadata(): ReturnType<typeof legacyResultMetadata> {
    return { content: "", storageKey: undefined, mimeType: undefined, bytes: undefined, naturalWidth: undefined, naturalHeight: undefined, durationMs: undefined };
}

export function isGenerationCanceled(error: unknown) {
    return error instanceof Error && (error.message === "请求已取消" || error.name === "AbortError");
}

export function findRetrySourceNode(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]) {
    const queue = connections.filter((connection) => connection.toNodeId === nodeId).map((connection) => connection.fromNodeId);
    const visited = new Set<string>();
    while (queue.length) {
        const id = queue.shift()!;
        if (visited.has(id)) continue;
        visited.add(id);
        const node = nodes.find((item) => item.id === id);
        if (node?.type === CanvasNodeType.Config) return node;
        connections.filter((connection) => connection.toNodeId === id).forEach((connection) => queue.push(connection.fromNodeId));
    }
    return null;
}

export function sourceNodeReferenceImages(node: CanvasNodeData | null) {
    if (!node || node.type !== CanvasNodeType.Image || !node.metadata?.content) return [];
    return [
        {
            id: node.id,
            name: `${node.title || node.id}.png`,
            type: node.metadata.mimeType || "image/png",
            dataUrl: node.metadata.content,
            storageKey: node.metadata.storageKey,
        },
    ];
}

export function isAudioFile(file: File) {
    return file.type.startsWith("audio/") || /\.(mp3|wav)$/i.test(file.name);
}

export function buildAngleLabel(params: CanvasImageAngleParams) {
    const horizontal = params.horizontalAngle === 0 ? "正面视角" : params.horizontalAngle > 0 ? `向右旋转 ${params.horizontalAngle} 度` : `向左旋转 ${Math.abs(params.horizontalAngle)} 度`;
    const pitch = params.pitchAngle === 0 ? "水平视角" : params.pitchAngle > 0 ? `俯视 ${params.pitchAngle} 度` : `仰视 ${Math.abs(params.pitchAngle)} 度`;
    return `AI 多角度：${horizontal}，${pitch}，镜头距离 ${params.cameraDistance.toFixed(1)}，${params.wideAngle ? "广角" : "标准"}镜头`;
}

export function buildAnglePrompt(params: CanvasImageAngleParams) {
    return `基于参考图重新生成同一主体的新视角，保持主体、颜色、材质和画面风格一致，不要只做透视变形。${buildAngleLabel(params)}。`;
}
