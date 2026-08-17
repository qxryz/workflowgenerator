import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getCanvasResourceKind, getGenerationResourceNodes, isCanvasResourceNodeReady } from "@/lib/canvas/canvas-resource-references";
import { resolveCanvasInputBindings } from "@/lib/canvas/canvas-input-bindings";
import { getNodeDefinition } from "@/lib/canvas/node-registry";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    referenceVideos: ReferenceVideo[];
    referenceAudios: ReferenceAudio[];
    textCount: number;
    imageCount: number;
    videoCount: number;
    audioCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image" | "video" | "audio";
    title: string;
    ready: boolean;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    return buildNodeGenerationContextFromInputs(sourceNode, inputs, prompt);
}

export function buildNodeGenerationContextFromInputs(sourceNode: CanvasNodeData | undefined, inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    if (sourceNode?.type === CanvasNodeType.Config && Boolean(sourceNode.metadata?.composerContent?.trim())) {
        return buildComposerGenerationContext(inputs, prompt);
    }

    return buildDefaultGenerationContext(inputs.filter((input) => input.ready), prompt);
}

function buildDefaultGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const upstreamText = inputs
        .filter((input) => input.type === "text" && input.text)
        .map((input) => `《${input.title}》\n${input.text}`)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: upstreamText ? [`当前任务\n${prompt.trim()}`, `上游结果\n${upstreamText}`, "请仅选用与当前任务有关的信息，保持本步骤的输出聚焦。"].filter(Boolean).join("\n\n") : prompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: inputs.filter((input) => input.type === "text").length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const { hasTokens, selectedInputs, tokens } = resolveCanvasInputBindings(inputs, prompt);
    if (!hasTokens) return buildDefaultGenerationContext(selectedInputs, prompt);

    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, video: 0, audio: 0, text: 0 };
    for (const input of selectedInputs) {
        const label = generationLabel(input.type, counts[input.type]++);
        labelByNodeId.set(input.nodeId, label);
        if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
    }

    let lastIndex = 0;
    let nextPrompt = "";
    for (const token of tokens) {
        nextPrompt += prompt.slice(lastIndex, token.start);
        if (token.input) {
            const label = labelByNodeId.get(token.nodeId)!;
            const input = token.input;
            nextPrompt += input.type === "text" ? `【${label}】` : label;
        }
        lastIndex = token.end;
    }

    nextPrompt += prompt.slice(lastIndex);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: counts.text,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return getGenerationResourceNodes(nodeId, nodes, connections).flatMap((node): NodeGenerationInput[] => {
        const type = getCanvasResourceKind(node);
        if (!type) return [];
        const ready = isCanvasResourceNodeReady(node);
        const title = ready ? node.title : `${node.title} · 等待结果`;
        if (type === "image") return [{ nodeId: node.id, type, title, ready, image: ready ? readReferenceImage(node) || undefined : undefined }];
        if (type === "video") return [{ nodeId: node.id, type, title, ready, video: ready ? readReferenceVideo(node) || undefined : undefined }];
        if (type === "audio") return [{ nodeId: node.id, type, title, ready, audio: ready ? readReferenceAudio(node) || undefined : undefined }];
        return [{ nodeId: node.id, type, title, ready, text: ready ? readNodeTextInput(node) : undefined }];
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    return { ...context, referenceImages: await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) }))) };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || "";
    return getNodeDefinition(node.type)?.resource?.(node)?.text || node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "image" ? resource.url : node.metadata?.content;
    if ((node.type !== CanvasNodeType.Image && resource?.kind !== "image") || !url) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: node.metadata?.mimeType || "image/png",
        dataUrl: url,
        storageKey: node.metadata?.terminalOutputArtifactStorageKey || node.metadata?.storageKey,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "video" ? resource.url : node.metadata?.content;
    if ((node.type !== CanvasNodeType.Video && resource?.kind !== "video") || !url) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: node.metadata?.mimeType || "video/mp4",
        url,
        storageKey: node.metadata?.terminalOutputArtifactStorageKey || node.metadata?.storageKey,
        bytes: node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
        durationMs: node.metadata?.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "audio" ? resource.url : node.metadata?.content;
    if ((node.type !== CanvasNodeType.Audio && resource?.kind !== "audio") || !url) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: node.metadata?.mimeType || "audio/mpeg",
        url,
        storageKey: node.metadata?.terminalOutputArtifactStorageKey || node.metadata?.storageKey,
        durationMs: node.metadata?.durationMs,
    };
}
