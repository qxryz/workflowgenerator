import type { CanvasNodeData } from "../../types/canvas";
import { canvasTextHash } from "../canvas/canvas-text-tools.ts";
import { isSeedance25Model } from "../seedance-2-5.ts";

export type ZodiacWorkspaceAsset = {
    id: string; name: string; type: string; storageKey?: string; content?: string;
    resultVersionId?: string; contentHash?: string; groupId?: string; selected?: boolean;
    width?: number; height?: number; duration?: number;
};

/** Only materialized resources cross the runtime boundary, never configuration or credentials. */
export function zodiacWorkspaceAssets(nodes: readonly CanvasNodeData[], selectedNodeIds: readonly string[] = []): ZodiacWorkspaceAsset[] {
    return nodes.flatMap((node) => {
        const meta = node.metadata || {};
        if (!["text", "image", "video", "audio", "file"].includes(node.type)
            || ["loading", "running", "generating", "error"].includes(String(meta.status))
            || (meta.role === "result-slot" && meta.slotState !== "ready")) return [];
        const storageKey = typeof meta.storageKey === "string" && meta.storageKey ? meta.storageKey : undefined;
        const content = node.type === "text" && typeof meta.content === "string" ? meta.content : undefined;
        if (!storageKey && !content?.trim()) return [];
        return [{
            id: node.id, name: node.title || node.id, type: node.type,
            ...(node.type === "text" ? { content } : { storageKey }),
            ...(typeof meta.currentResultVersionId === "string" ? { resultVersionId: meta.currentResultVersionId } : {}),
            ...(typeof meta.groupId === "string" ? { groupId: meta.groupId } : {}),
            selected: selectedNodeIds.includes(node.id),
            ...(typeof meta.naturalWidth === "number" ? { width: meta.naturalWidth } : {}),
            ...(typeof meta.naturalHeight === "number" ? { height: meta.naturalHeight } : {}),
        }];
    });
}

export const ZODIAC_REFERENCE_ROLES = ["source_edit", "identity", "style", "layout", "scene", "first_frame", "last_frame", "audio", "reference"] as const;
export type ZodiacAssetReference = { nodeId: string; role?: string; label?: string; storageKey?: string; resultVersionId?: string; contentHash?: string };

const roleInstructions: Record<string, string> = {
    source_edit: "待修改原图；只改变指定部分，保留其余内容", identity: "人物或主体身份参考；保持外形与识别特征",
    style: "风格参考；不替换主体身份", layout: "构图参考", scene: "场景参考", first_frame: "视频首帧", last_frame: "视频尾帧", audio: "声音参考",
};

export function zodiacReferenceInstructions(references: readonly ZodiacAssetReference[]) {
    if (!references.some(ref => ref.role && roleInstructions[ref.role])) return "";
    return `参考素材用途：\n${references.map(ref => `@[node:${ref.nodeId}]：${roleInstructions[ref.role || ""] || "参考素材"}`).join("\n")}\n\n`;
}

/** Explicit roles override the old image-count heuristic, especially identity/style pairs. */
export function zodiacVideoReferenceSettings(model: string, references: readonly ZodiacAssetReference[], nodes: readonly CanvasNodeData[]) {
    const media = references.filter(ref => ["image", "video", "audio"].includes(nodes.find(node => node.id === ref.nodeId)?.type || ""));
    if (!media.some(ref => ref.role && ref.role !== "reference")) return {};
    const frames = media.filter(ref => ref.role === "first_frame" || ref.role === "last_frame");
    let mode = "reference";
    if (frames.length) {
        if (frames.length !== media.length || frames.some(ref => nodes.find(node => node.id === ref.nodeId)?.type !== "image")) throw new Error("首尾帧不能与其它媒体参考混用，请调整引用用途。");
        if (frames.length === 1) mode = frames[0].role === "first_frame" ? "first-frame" : "last-frame";
        else if (frames.length === 2 && frames[0].role === "first_frame" && frames[1].role === "last_frame") mode = "first-last";
        else throw new Error("帧引用必须按首帧、尾帧顺序排列，不能重复。");
    }
    const name = model.split("::").at(-1)?.toLowerCase() || "";
    if (name === "minimax-h3") return { minimaxVideoInputMode: mode };
    if (isSeedance25Model(name)) {
        if (mode === "last-frame") throw new Error("当前模型不支持单独尾帧，请使用首帧或首尾帧。");
        return { seedance25InputMode: mode };
    }
    if (/agnes-video|minimax-hailuo/.test(name) && mode !== "first-frame") throw new Error("当前模型仅支持首帧图片，不能把人物或风格参考自动当作首帧。");
    return {};
}

/** Pin reviewed inputs. A later node/version change requires a new review. */
export async function pinZodiacReference(reference: ZodiacAssetReference, nodes: readonly CanvasNodeData[]): Promise<ZodiacAssetReference> {
    const node = nodes.find((node) => node.id === reference.nodeId);
    if (!node) throw new Error(`引用素材「${reference.nodeId}」已不存在。`);
    const meta = node.metadata || {};
    if (node.type === "text") {
        if (typeof meta.content !== "string" || !meta.content.trim()) throw new Error("引用文档尚无正文。");
        const hash = await canvasTextHash(meta.content);
        if (reference.contentHash && reference.contentHash !== hash) throw new Error("引用文档已变化，请重新读取并审核。");
        return { ...reference, contentHash: hash };
    }
    if (!meta.storageKey || (meta.role === "result-slot" && meta.slotState !== "ready")) throw new Error("引用素材尚未保存完成。");
    if ((reference.storageKey && reference.storageKey !== meta.storageKey)
        || (reference.resultVersionId && reference.resultVersionId !== meta.currentResultVersionId)) throw new Error("引用媒体已变化，请重新读取并审核。");
    return { ...reference, storageKey: meta.storageKey, ...(meta.currentResultVersionId ? { resultVersionId: meta.currentResultVersionId } : {}) };
}
