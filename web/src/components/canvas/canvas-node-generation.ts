import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { seedanceReferenceLabel } from "@/lib/seedance-video";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import { CanvasNodeType, type CanvasConnection, type CanvasGenerationMode, type CanvasNodeData } from "@/types/canvas";
import { getCanvasResourceKind, isCanvasResourceNodeReady } from "@/lib/canvas/canvas-resource-references";
import { resolveCanvasInputBindings, type ResolvedCanvasInputToken } from "@/lib/canvas/canvas-input-bindings";
import { getCanvasInputSources } from "@/lib/canvas/canvas-group-inputs";
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
    type: "text" | "image" | "video" | "audio" | "file";
    title: string;
    ready: boolean;
    bindingNodeIds?: string[];
    bindingTitles?: Record<string, string>;
    /** Only virtual group prompt text contains executable resource references. */
    resolveTextReferences?: boolean;
    text?: string;
    image?: ReferenceImage;
    video?: ReferenceVideo;
    audio?: ReferenceAudio;
};

/** Validate the actual selected context at the request boundary, using the requested mode. */
export function assertNodeGenerationContextSupported(mode: CanvasGenerationMode, context: NodeGenerationContext) {
    if (mode === "video") return;
    const unsupported = [mode === "audio" && context.referenceImages.length ? "图片" : "", context.referenceVideos.length ? "视频" : "", context.referenceAudios.length ? "音频" : ""].filter(Boolean);
    if (!unsupported.length) return;
    const media = unsupported.join("、");
    if (mode === "audio") throw new Error(`当前语音生成只接受文字，不能将${media}作为语音参考，请移除这些引用`);
    throw new Error(`当前${mode === "image" ? "图片" : "文本"}生成不支持${media}参考，请改用文字或图片素材`);
}

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string): NodeGenerationContext {
    const inputs = buildNodeGenerationInputs(nodeId, nodes, connections);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    return buildNodeGenerationContextFromInputs(sourceNode, inputs, prompt);
}

export function buildNodeGenerationContextFromInputs(_sourceNode: CanvasNodeData | undefined, inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    return buildComposerGenerationContext(inputs, prompt);
}

export function buildNodeImageGenerationContext(sourceNode: CanvasNodeData | undefined, context: NodeGenerationContext): NodeGenerationContext {
    if (sourceNode?.type !== CanvasNodeType.Image) return context;
    const sourceImage = readReferenceImage(sourceNode);
    if (!sourceImage || context.referenceImages.some((image) => image.id === sourceImage.id)) return context;
    // Append the image being edited so existing prompt labels still identify the same upstream assets.
    const referenceImages = [...context.referenceImages, sourceImage];
    return {
        ...context,
        prompt: context.referenceImages.length ? `${context.prompt}\n\n编辑目标：${imageReferenceLabel(referenceImages.length - 1)}。` : context.prompt,
        referenceImages,
        imageCount: referenceImages.length,
    };
}

function buildDefaultGenerationContext(inputs: NodeGenerationInput[], prompt: string): NodeGenerationContext {
    const labelByNodeId = generationLabels(inputs);
    const upstreamText = inputs
        .filter((input) => input.type === "text" && input.text)
        .map((input) => `《${input.title}》\n${generationText(input, inputs, labelByNodeId)}`)
        .join("\n\n");
    const referenceImages = inputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = inputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = inputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: appendGenerationInputTitles(upstreamText ? [`当前任务\n${prompt.trim()}`, `上游结果\n${upstreamText}`, "请仅选用与当前任务有关的信息，保持本步骤的输出聚焦。"].filter(Boolean).join("\n\n") : prompt, inputs),
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
    const unsupported = inputs.find((input) => input.type === "file" && (!hasTokens || tokens.some((token) => token.nodeId === input.nodeId || input.bindingNodeIds?.includes(token.nodeId))));
    if (unsupported) throw new Error(`文件「${unsupported.title || unsupported.nodeId}」不能直接用于生成，请改用文本或媒体素材`);
    if (!hasTokens) {
        const unavailable = inputs.find((input) => !isGenerationInputReady(input));
        if (unavailable) throw new Error(`上游素材「${unavailable.title || unavailable.nodeId}」尚未就绪，请先完成或移除该输入`);
        return buildDefaultGenerationContext(selectedInputs, prompt);
    }
    const unavailable = tokens.find((token) => !token.inputs?.length || token.inputs.some((input) => !isGenerationInputReady(input)));
    if (unavailable) {
        const input = inputs.find((input) => input.nodeId === unavailable.nodeId);
        throw new Error(`引用素材「${input?.title || unavailable.nodeId}」不可用，请检查上游连接并等待素材就绪`);
    }

    const labelByNodeId = generationLabels(selectedInputs);
    const textBlocks = selectedInputs.filter((input) => input.type === "text").map((input) => `【${labelByNodeId.get(input.nodeId)}】\n${generationText(input, selectedInputs, labelByNodeId)}`);
    let nextPrompt = replaceGenerationTokens(prompt, tokens, labelByNodeId);
    nextPrompt = appendGenerationInputTitles(nextPrompt, selectedInputs, false);
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));
    const referenceVideos = selectedInputs.map((input) => input.video).filter((video): video is ReferenceVideo => Boolean(video));
    const referenceAudios = selectedInputs.map((input) => input.audio).filter((audio): audio is ReferenceAudio => Boolean(audio));

    return {
        prompt: nextPrompt,
        referenceImages,
        referenceVideos,
        referenceAudios,
        textCount: textBlocks.length,
        imageCount: referenceImages.length,
        videoCount: referenceVideos.length,
        audioCount: referenceAudios.length,
    };
}

function generationLabels(inputs: NodeGenerationInput[]) {
    const counts = { image: 0, video: 0, audio: 0, text: 0, file: 0 };
    return new Map(inputs.map((input) => [input.nodeId, generationLabel(input.type, counts[input.type]++)]));
}

function generationText(input: NodeGenerationInput, inputs: NodeGenerationInput[], labels: Map<string, string>) {
    const text = input.text || "";
    return input.resolveTextReferences ? replaceGenerationTokens(text, resolveCanvasInputBindings(inputs, text).tokens, labels) : text;
}

function replaceGenerationTokens(prompt: string, tokens: ResolvedCanvasInputToken<NodeGenerationInput>[], labels: Map<string, string>) {
    let lastIndex = 0;
    let result = "";
    for (const token of tokens) {
        if (!token.inputs?.length) throw new Error(`组内引用素材「${token.nodeId}」不可用，请检查组内素材`);
        const members = token.inputs
            .map((input) => {
                const label = labels.get(input.nodeId);
                if (!label) throw new Error(`引用素材「${input.title || input.nodeId}」未包含在本次输入中`);
                return input.type === "text" ? `【${label}】` : label;
            })
            .join("、");
        const bindingTitle = token.inputs.find((input) => input.bindingNodeIds?.includes(token.nodeId) && input.bindingTitles?.[token.nodeId])?.bindingTitles?.[token.nodeId];
        result += prompt.slice(lastIndex, token.start) + (bindingTitle ? `「${bindingTitle}」（${members}）` : members);
        lastIndex = token.end;
    }
    return result + prompt.slice(lastIndex);
}

function appendGenerationInputTitles(prompt: string, inputs: NodeGenerationInput[], includeBindingTitles = true) {
    if (!inputs.length) return prompt;
    const labels = generationLabels(inputs);
    const titles = inputs.map((input) => {
        const label = labels.get(input.nodeId)!;
        return `${label}：${input.title || label}`;
    });
    if (includeBindingTitles) {
        const groups = new Map<string, { title: string; labels: string[] }>();
        for (const input of inputs) {
            for (const bindingId of input.bindingNodeIds || []) {
                const title = input.bindingTitles?.[bindingId];
                if (!title) continue;
                const group = groups.get(bindingId) || { title, labels: [] };
                group.labels.push(labels.get(input.nodeId)!);
                groups.set(bindingId, group);
            }
        }
        titles.push(...Array.from(groups.values(), (group) => `「${group.title}」：${group.labels.join("、")}`));
    }
    return `${prompt.trim()}\n\n素材对应\n${titles.join("\n")}`;
}

function isGenerationInputReady(input: NodeGenerationInput) {
    if (!input.ready) return false;
    if (input.type === "text") return Boolean(input.text?.trim());
    if (input.type === "image") return Boolean(input.image && (input.image.dataUrl?.trim() || input.image.storageKey?.trim()));
    const media = input.type === "video" ? input.video : input.audio;
    return Boolean(media && (media.url?.trim() || media.storageKey?.trim()));
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    const groupTitles = new Map(nodes.filter((node) => node.type === CanvasNodeType.Group).map((node) => [node.id, node.title]));
    return getCanvasInputSources(nodeId, nodes, connections).flatMap(({ node, bindingNodeIds }): NodeGenerationInput[] => {
        const type = getCanvasResourceKind(node);
        const binding = bindingNodeIds.length ? { bindingNodeIds, bindingTitles: Object.fromEntries(bindingNodeIds.map((id) => [id, groupTitles.get(id) || id])) } : {};
        if (!type) return bindingNodeIds.length ? [{ nodeId: node.id, type: "text", title: node.title, ready: false, ...binding }] : [];
        const ready = isCanvasResourceNodeReady(node);
        const title = ready ? node.title : `${node.title} · 等待结果`;
        if (type === "file") return [{ nodeId: node.id, type, title, ready, ...binding }];
        if (type === "image") return [{ nodeId: node.id, type, title, ready, ...binding, image: ready ? readReferenceImage(node) || undefined : undefined }];
        if (type === "video") return [{ nodeId: node.id, type, title, ready, ...binding, video: ready ? readReferenceVideo(node) || undefined : undefined }];
        if (type === "audio") return [{ nodeId: node.id, type, title, ready, ...binding, audio: ready ? readReferenceAudio(node) || undefined : undefined }];
        return [{ nodeId: node.id, type, title, ready, ...binding, ...(groupTitles.has(node.id) ? { resolveTextReferences: true } : {}), text: ready ? readNodeTextInput(node) : undefined }];
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
    const referenceImages = await Promise.all(
        context.referenceImages.map(async (image) => {
            try {
                const dataUrl = await imageToDataUrl(image);
                if (!/^data:image\/[^,]+,.+/s.test(dataUrl)) throw new Error("未能读取有效图片");
                return { ...image, dataUrl };
            } catch (error) {
                const detail = error instanceof Error ? error.message : "请重新导入后重试";
                throw new Error(`参考图片「${image.name || image.id}」读取失败：${detail}`);
            }
        }),
    );
    return { ...context, referenceImages };
}

function readNodeTextInput(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || "";
    return getNodeDefinition(node.type)?.resource?.(node)?.text || node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    if (type === "video") return seedanceReferenceLabel("video", index);
    if (type === "audio") return seedanceReferenceLabel("audio", index);
    if (type === "file") return `文件${index + 1}`;
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "image" ? resource.url : node.metadata?.content;
    const storageKey = resource?.storageKey || node.metadata?.storageKey;
    if ((node.type !== CanvasNodeType.Image && resource?.kind !== "image") || (!url && !storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.png`,
        type: resource?.mimeType || node.metadata?.mimeType || "image/png",
        dataUrl: url || "",
        storageKey,
        bytes: resource?.bytes || node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
    };
}

function readReferenceVideo(node: CanvasNodeData): ReferenceVideo | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "video" ? resource.url : node.metadata?.content;
    const storageKey = resource?.storageKey || node.metadata?.storageKey;
    if ((node.type !== CanvasNodeType.Video && resource?.kind !== "video") || (!url && !storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp4`,
        type: resource?.mimeType || node.metadata?.mimeType || "video/mp4",
        url: url || "",
        storageKey,
        bytes: resource?.bytes || node.metadata?.bytes,
        width: node.metadata?.naturalWidth,
        height: node.metadata?.naturalHeight,
        durationMs: node.metadata?.durationMs,
    };
}

function readReferenceAudio(node: CanvasNodeData): ReferenceAudio | null {
    const resource = getNodeDefinition(node.type)?.resource?.(node);
    const url = resource?.kind === "audio" ? resource.url : node.metadata?.content;
    const storageKey = resource?.storageKey || node.metadata?.storageKey;
    if ((node.type !== CanvasNodeType.Audio && resource?.kind !== "audio") || (!url && !storageKey)) return null;
    return {
        id: node.id,
        name: `${node.title || node.id}.mp3`,
        type: resource?.mimeType || node.metadata?.mimeType || "audio/mpeg",
        url: url || "",
        storageKey,
        durationMs: node.metadata?.durationMs,
        bytes: resource?.bytes || node.metadata?.bytes,
    };
}
