import type { StructuredAsset, StructuredAssetImage, StructuredAssetKind, StructuredAssetPart } from "@/stores/use-asset-store";
import { STRUCTURED_PART_EXAMPLE_PROMPTS } from "@/lib/structured-asset-reference";

export type StructuredAssetDraft = StructuredAsset["data"] & {
    collectionVersion: 1;
    kind: StructuredAssetKind;
    assetId?: string;
    title: string;
    parts: StructuredAssetPart[];
    activeGroupId: string;
    activePartId: string;
    tags: string[];
    pendingChanges?: boolean;
};

type Section = { id: string; label: string; parts: Array<[string, string]>; selectable?: boolean; textOnly?: boolean };
export const COLLECTION_SECTIONS: Record<StructuredAssetKind, Section[]> = {
    character: [
        { id: "overview", label: "人物总览", textOnly: true, parts: [["identity-profile", "人物设定"]] },
        {
            id: "appearance",
            label: "人物形象",
            parts: [
                ["hero", "主视图"],
                ["turnaround", "多视图"],
            ],
        },
        { id: "expression", label: "表情", parts: [["expression-sheet", "表情板"]] },
        { id: "action", label: "动作", parts: [["pose-sheet", "动作板"]] },
        { id: "voice", label: "音色", parts: [["voice-profile", "角色音色"]] },
        { id: "outfit", label: "服装", selectable: true, parts: [["default-outfit", "日常服装"]] },
        { id: "props", label: "道具", selectable: true, parts: [["prop-default", "常用道具"]] },
        { id: "detail", label: "细节", parts: [["detail-sheet", "细节图"]] },
        { id: "relationship", label: "关系", parts: [["pair-reference", "关系参考图"]] },
        { id: "other", label: "其他", parts: [["other-images", "其他素材"]] },
    ],
    scene: [
        { id: "overview", label: "场景总览", textOnly: true, parts: [["scene-profile", "场景设定"]] },
        {
            id: "space",
            label: "场景形象",
            parts: [
                ["hero", "主视图"],
                ["master-wide", "全景图"],
            ],
        },
        {
            id: "views",
            label: "多视角",
            parts: [
                ["entrance-view", "入口视角"],
                ["focal-view", "核心区域"],
            ],
        },
        { id: "layout", label: "空间布局", parts: [["floor-plan", "平面图"]] },
        { id: "lighting", label: "光线天气", selectable: true, parts: [["day-light", "日间"]] },
        { id: "props", label: "陈设道具", selectable: true, parts: [["prop-sheet", "基础陈设"]] },
        { id: "state", label: "场景状态", selectable: true, parts: [["state-variants", "常态"]] },
        { id: "detail", label: "细节", parts: [["detail-sheet", "材质与细节"]] },
        { id: "relationship", label: "关联场景", parts: [["connection-map", "位置关系图"]] },
        { id: "other", label: "其他", parts: [["other-images", "其他素材"]] },
    ],
};

export function createStructuredAssetDraft(kind: StructuredAssetKind): StructuredAssetDraft {
    return {
        collectionVersion: 1,
        kind,
        title: "",
        referencePrompt: "",
        description: "",
        fields: {},
        images: [],
        audios: [],
        tags: [],
        relationships: [],
        parts: COLLECTION_SECTIONS[kind].flatMap((section) => section.parts.map(([id, title]) => ({ id, title, groupId: section.id, description: "", expectedOutput: "", prompt: "", enabled: true }))),
        activeGroupId: "intro",
        activePartId: "",
    };
}

/** Preserve saved material IDs and authored text; only old generation examples are removed. */
export function normalizeStructuredAssetDraft(kind: StructuredAssetKind, draft?: Partial<StructuredAssetDraft>): StructuredAssetDraft {
    if (draft?.kind && draft.kind !== kind) return createStructuredAssetDraft(kind);
    const baseline = createStructuredAssetDraft(kind);
    const legacy = draft?.collectionVersion !== 1;
    if (draft && draft.referencePrompt === undefined) baseline.referencePrompt = undefined;
    const defaults = new Map(baseline.parts.map((part) => [part.id, part]));
    const sections = new Set(COLLECTION_SECTIONS[kind].map((section) => section.id));
    const parts = (draft?.parts || []).map((part) => {
        const groupId = part.groupId === "identity" || part.groupId === "continuity" ? "overview" : ["face-detail", "scale"].includes(part.id) ? "detail" : part.id === "floor-plan" ? "layout" : sections.has(part.groupId) ? part.groupId : "other";
        return { ...part, groupId, prompt: legacy && part.prompt === STRUCTURED_PART_EXAMPLE_PROMPTS[kind][part.id] ? "" : part.prompt || "" };
    });
    if (legacy) for (const part of defaults.values()) if (!parts.some((saved) => saved.id === part.id)) parts.push(part);
    if (kind === "character" && draft && !Array.isArray(draft.audios) && !parts.some((part) => part.groupId === "voice")) parts.push(defaults.get("voice-profile")!);
    const legacyText = legacy
        ? [
              draft?.description,
              ...Object.entries(draft?.fields || {})
                  .filter(([, value]) => value?.trim())
                  .map(([key, value]) => `${key}：${value}`),
          ]
              .filter(Boolean)
              .join("\n\n")
        : "";
    if (legacyText) parts.unshift({ id: "legacy-overview", groupId: "overview", title: "已有资料", description: "", expectedOutput: "", prompt: legacyText, enabled: true });
    const explicitIds = new Set(Array.from((draft?.referencePrompt || "").matchAll(/@\[node:([^\]]+)\]/g), (match) => match[1]));
    const images = (draft?.images || []).map((image) => ({
        ...image,
        ...(legacy && explicitIds.has(image.id) ? { isCurrent: true } : {}),
        partId: image.partId === "avatar" || parts.some((part) => part.id === image.partId) ? image.partId : "other-images",
    }));
    if (images.some((image) => image.partId === "other-images") && !parts.some((part) => part.id === "other-images")) parts.push({ id: "other-images", groupId: "other", title: "其他素材", description: "", expectedOutput: "", prompt: "", enabled: true });
    const activeGroupId = draft?.activeGroupId && (sections.has(draft.activeGroupId) || ["intro", "reference"].includes(draft.activeGroupId)) ? draft.activeGroupId : "intro";
    return { ...baseline, ...draft, kind, collectionVersion: 1, fields: draft?.fields || {}, parts, images, audios: draft?.audios || [], activeGroupId, tags: draft?.tags || [], relationships: draft?.relationships || [] };
}

export function structuredAssetToDraft(kind: StructuredAssetKind, asset: StructuredAsset): StructuredAssetDraft {
    const draft = normalizeStructuredAssetDraft(kind, { ...asset.data, kind, assetId: asset.id, title: asset.title, tags: asset.tags });
    // Legacy covers also served as generation references. Duplicate the identity, not the file.
    if (asset.data.collectionVersion !== 1 && !draft.avatarImageId) {
        const cover = draft.images.find((image) => image.dataUrl === asset.coverUrl) || draft.images.find((image) => image.isCurrent !== false);
        if (cover) {
            draft.avatarImageId = `avatar-${cover.id}`;
            draft.images = [...draft.images, { ...cover, id: draft.avatarImageId, partId: "avatar", title: asset.title }];
        }
    }
    return draft;
}

export function structuredAssetPayload(draft: StructuredAssetDraft): Omit<StructuredAsset, "id" | "createdAt" | "updatedAt"> {
    const { kind, assetId: _assetId, title, tags, activeGroupId: _activeGroupId, pendingChanges: _pendingChanges, ...data } = draft;
    return { kind, title: title.trim(), tags, coverUrl: draft.images.find((image) => image.id === draft.avatarImageId)?.dataUrl || "", source: kind === "character" ? "人物工作台" : "场景工作台", data };
}

export function removeCollectionImage(draft: StructuredAssetDraft, id: string): StructuredAssetDraft {
    return {
        ...draft,
        images: draft.images.filter((image) => image.id !== id),
        avatarImageId: draft.avatarImageId === id ? undefined : draft.avatarImageId,
        referencePrompt: draft.referencePrompt?.split(`@[node:${id}]`).join(""),
    };
}

export function moveCollectionImage(images: StructuredAssetImage[], id: string, direction: -1 | 1) {
    const index = images.findIndex((image) => image.id === id);
    const siblings = images.map((image, position) => ({ image, position })).filter((entry) => entry.image.partId === images[index]?.partId);
    const siblingIndex = siblings.findIndex((entry) => entry.position === index);
    const adjacent = siblings[siblingIndex + direction];
    if (index < 0 || !adjacent) return images;
    const next = [...images];
    [next[index], next[adjacent.position]] = [next[adjacent.position], next[index]];
    return next;
}

export function removeCollectionPart(draft: StructuredAssetDraft, id: string): StructuredAssetDraft {
    const target = id === "other-images" ? "collected-images" : "other-images";
    const images = draft.images.map((image) => (image.partId === id ? { ...image, partId: target } : image));
    const audios = draft.audios?.map((audio) => (audio.partId === id ? { ...audio, partId: target } : audio));
    const parts = draft.parts.filter((part) => part.id !== id);
    if ((images.some((image) => image.partId === target) || audios?.some((audio) => audio.partId === target)) && !parts.some((part) => part.id === target))
        parts.push({ id: target, groupId: "other", title: "其他素材", description: "", expectedOutput: "", prompt: "", enabled: true });
    return { ...draft, parts, images, audios, referencePrompt: draft.referencePrompt?.split(`@[node:${id}]`).join("") };
}
