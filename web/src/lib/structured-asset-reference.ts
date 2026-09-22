import type { StructuredAsset, StructuredAssetImage, StructuredAssetKind, StructuredAssetPart } from "../stores/use-asset-store.ts";

type StructuredAssetReferenceSource = StructuredAsset["data"] & { kind: StructuredAssetKind; title: string };

/** Default generation examples are instructions for producing parts, not asset identity facts. */
export function structuredAssetSettingParts(kind: StructuredAssetKind, parts: StructuredAssetPart[] = []) {
    return parts.filter((part) => part.prompt?.trim() && part.prompt.trim() !== STRUCTURED_PART_EXAMPLE_PROMPTS[kind][part.id]?.trim());
}

/** Uses stable image IDs inside the asset; canvas import maps these tokens to new node IDs. */
export function buildStructuredAssetReferencePrompt(source: StructuredAssetReferenceSource) {
    const parts = source.parts || [];
    if (source.collectionVersion === 1) {
        const audios = (source.audios || []).filter((audio) => audio.isCurrent !== false && !parts.some((part) => part.id === audio.partId && part.enabled === false));
        const images = source.images.filter((image) => image.isCurrent !== false && isStructuredAssetReferenceImage(source, image));
        return [
            ...parts.filter((part) => part.enabled !== false && (part.prompt.trim() || images.some((image) => image.partId === part.id) || audios.some((audio) => audio.partId === part.id))).map((part) => `@[node:${part.id}]`),
            ...images.filter((image) => !parts.some((part) => part.id === image.partId)).map((image) => `${image.title || "参考图"}：@[node:${image.id}]`),
            ...audios.filter((audio) => !parts.some((part) => part.id === audio.partId)).map((audio) => `${audio.title}：@[node:${audio.id}]`),
            source.relationships?.length ? "@[node:relationships]" : "",
        ]
            .filter(Boolean)
            .join("\n");
    }
    return [
        source.title.trim() ? `${source.kind === "character" ? "人物" : "场景"}：${source.title.trim()}` : "",
        source.description.trim(),
        ...Object.entries(source.fields)
            .filter(([, value]) => value.trim())
            .map(([key, value]) => `${key}：${value.trim()}`),
        ...structuredAssetSettingParts(source.kind, parts).map((part) => `${part.title}：${part.prompt.trim()}`),
        ...source.images
            .filter((image) => image.isCurrent !== false)
            .map((image) => {
                const partTitle = parts.find((part) => part.id === image.partId)?.title;
                return `${image.title || partTitle || "参考图"}：@[node:${image.id}]`;
            }),
    ]
        .filter(Boolean)
        .join("\n");
}

/** An explicit empty string is intentional; only absent legacy/draft values get a default. */
export function structuredAssetReferencePrompt(source: StructuredAssetReferenceSource) {
    return typeof source.referencePrompt === "string" ? source.referencePrompt : buildStructuredAssetReferencePrompt(source);
}

/** Display avatars, unselected images and disabled sets cannot become whole-asset references. */
export function isStructuredAssetReferenceImage(source: StructuredAssetReferenceSource, image: StructuredAssetImage) {
    return image.id !== source.avatarImageId && image.partId !== "avatar" && (source.collectionVersion !== 1 || image.isCurrent !== false) && !source.parts?.some((part) => part.id === image.partId && part.enabled === false);
}

/** The same relationship statement is used from either endpoint. */
export function structuredAssetRelationshipText(source: StructuredAssetReferenceSource) {
    return (source.relationships || [])
        .map((relation) => {
            const mirrored = relation.sourceAssetId === relation.targetAssetId;
            const from = mirrored ? relation.sourceName || relation.targetName : source.title;
            const to = mirrored ? source.title : relation.targetName;
            return `${from} → ${to}：${relation.label}`;
        })
        .join("\n");
}

/** Resolve collected sections before mapping asset image IDs to canvas nodes. */
export function resolveStructuredAssetReferencePrompt(source: StructuredAssetReferenceSource) {
    const prompt = structuredAssetReferencePrompt(source);
    if (source.collectionVersion !== 1) return prompt;
    const parts = new Map(source.parts?.map((part) => [part.id, part]));
    const images = new Map(source.images.map((image) => [image.id, image]));
    const audios = new Map((source.audios || []).map((audio) => [audio.id, audio]));
    const resolve = (text: string, ancestors: Set<string>): string =>
        text.replace(/@\[node:([^\]]+)\]/gu, (token, id: string) => {
            if (id === "relationships") return structuredAssetRelationshipText(source);
            if (id === source.avatarImageId || id === "avatar") return "";
            const part = parts.get(id);
            if (part) {
                if (part.enabled === false) return "";
                if (ancestors.has(id)) return token;
                const next = new Set(ancestors).add(id);
                return [
                    part.prompt.trim() ? `${part.title}：${resolve(part.prompt.trim(), next)}` : "",
                    ...source.images.filter((image) => image.partId === id && image.isCurrent !== false && isStructuredAssetReferenceImage(source, image)).map((image) => `${image.title || part.title || "参考图"}：@[node:${image.id}]`),
                    ...(source.audios || []).filter((audio) => audio.partId === id && audio.isCurrent !== false).map((audio) => `${audio.title || part.title}：@[node:${audio.id}]`),
                ]
                    .filter(Boolean)
                    .join("\n");
            }
            const audio = audios.get(id);
            if (audio && (audio.isCurrent === false || source.parts?.some((part) => part.id === audio.partId && part.enabled === false))) return "";
            const image = images.get(id);
            return image && !isStructuredAssetReferenceImage(source, image) ? "" : token;
        });
    return resolve(prompt, new Set());
}

/**
 * The canvas must mirror the authored reference, not every file collected in
 * the workbench.  This returns the concrete media that survived resolution.
 */
export function resolveStructuredAssetReferenceMedia(source: StructuredAssetReferenceSource) {
    const prompt = resolveStructuredAssetReferencePrompt(source);
    const referencedIds = new Set(Array.from(prompt.matchAll(/@\[node:([^\]]+)\]/gu), (match) => match[1]));
    return {
        prompt,
        images: source.images.filter((image) => referencedIds.has(image.id) && isStructuredAssetReferenceImage(source, image)),
        audios: (source.audios || []).filter((audio) => referencedIds.has(audio.id) && audio.isCurrent !== false && !source.parts?.some((part) => part.id === audio.partId && part.enabled === false)),
    };
}

export const STRUCTURED_PART_EXAMPLE_PROMPTS: Record<StructuredAssetKind, Record<string, string>> = {
    character: {
        "identity-profile": "电影感角色设定肖像，半身正视，纯净浅灰背景；自然中性表情，清晰呈现年龄、职业气质与身份线索；写实材质，柔和棚拍光，人物居中，画面干净；不要文字、不要水印、不要多余人物。",
        "consistency-rules": "同一人物的一致性基准肖像，正面半身，中性表情，纯色背景；清晰展示脸型、瞳色、发型轮廓、固定饰品与特殊身体特征；比例稳定，左右对称，不改变关键身份特征；不要文字、不要其他人物。",
        hero: "电影感人物主视觉，全身站立，3/4 正面视角，视线平稳；保留角色的固定发型、脸部特征、主服装与配件；简洁环境，人物轮廓清晰，柔和侧逆光，细腻写实质感；单人，不要文字和水印。",
        turnaround: "同一个角色的三视图设定图：正面、左侧面、背面，全身站姿，三个人像等高并列，统一镜头高度和比例，纯净浅灰背景；准确保留发型轮廓、服装结构、鞋履和固定配件；无文字、无额外角色。",
        "face-detail": "同一角色的脸部特写，正脸与 3/4 角度并列；清晰呈现脸型、眉眼、鼻唇、瞳色、肤质、雀斑或痣、发际线；柔和自然光，浅景深，皮肤质感真实；不要美颜过度、不要文字。",
        scale: "角色全身比例参考图，正面标准站姿，双臂自然下垂，镜头与角色齐平；完整呈现头身比例、肩宽、四肢和鞋履，纯色背景，柔和均匀棚拍光；不要透视夸张、不要裁切、不要文字。",
        "expression-sheet": "同一角色的六格表情参考，统一正面半身构图和光线；包含中性、微笑、愤怒、悲伤、惊讶、疲惫，保持五官、发型和服装不变；浅灰背景，清晰面部细节；无文字、无多余人物。",
        "pose-sheet": "同一角色的四格全身动作参考：标准站立、行走中、坐姿、剧情常用动作；统一全身比例、服装和固定配件，动作清楚且彼此分开，简洁浅色背景，镜头齐平；不要文字、不要其他人物。",
        "default-outfit": "角色主服装设定图，正面、侧面、背面全身并列；重点呈现服装层次、材质、颜色、剪裁、鞋履和固定饰品，比例统一，纯净背景，柔和棚拍光；不要改变人物脸部和发型，不要文字。",
        "outfit-variants": "同一角色的三套服装版本设定图：日常、剧情状态、特殊状态；全身站姿并列，脸部、体型、发型和固定配件保持一致；服装材质与功能有清晰差异，背景简洁，光线统一；无文字、无额外人物。",
        "detail-sheet": "角色关键细节设定图，以干净分区展示面部局部、固定饰品、纹身或伤疤、专属道具与特殊结构；每个局部清晰可辨，写实材质，均匀棚拍光，浅色背景；不要文字、不要新增无关物件。",
        "pair-reference": "两位常同框角色的关系参考图，全身站立并列，镜头齐平；明确身高差、体型差与彼此距离，保留各自的固定外观和服装；自然克制的互动姿态，简洁背景，柔和光线；不要文字、不要第三人。",
    },
    scene: {
        "scene-profile": "电影感场景设定主视觉，广角平视建立镜头；清晰呈现地点用途、年代感、主要建筑或自然结构、核心物件和整体氛围；空间层次明确，主光源方向稳定，色彩克制；无人物、无文字、无水印。",
        "spatial-anchors": "固定机位的广角空间基准图，从入口看向室内；清楚呈现门、窗、桌面、座位和核心地标之间的相对位置，空间尺度可信，地面与墙面结构连贯；中性均匀光，无人物、无文字。",
        hero: "电影感场景主视觉，广角建立镜头，视线高度自然；以核心区域为视觉焦点，完整呈现空间结构、标志物、材质、主光源和色彩基调；画面干净、尺度可信、景深自然；无人物、无文字、无水印。",
        "floor-plan": "建筑概念用的正交俯视平面布局图，清晰展示入口、窗户、核心家具、活动区与通道位置；墙体和家具比例可信，材质简洁，光线均匀，布局一目了然；无人物、无文字、无标注。",
        "master-wide": "场景全景基准图，室内或街道的广角平视镜头；完整交代前景、中景、远景与核心物件的位置关系，保留固定门窗和地标，空间深度真实，主光源方向一致；无人物、无文字。",
        "entrance-view": "入口机位的场景参考图，摄影机位于入口内侧向空间中心望去；保持门的位置、动线、核心物件和远处视觉锚点与基准一致，广角但不过度变形，空间清晰；无人物、无文字。",
        "window-view": "窗口机位的场景参考图，从室内面向窗户与窗外；保留窗框尺度、室内家具位置、窗外地标和光线方向，内外曝光平衡，构图自然，空间连续；无人物、无文字。",
        "focal-view": "面向场景核心活动区域的机位参考图，中广角平视；突出主要桌面、座位、机器或地标，同时保留可辨认的背景锚点，材质与色彩延续基准图，光线方向稳定；无人物、无文字。",
        "day-light": "与场景基准完全相同的固定机位，日间版本；自然日光从既定窗户或天空方向进入，保留原有空间布局、道具和色彩关系，阴影柔和，曝光真实；无人物、无文字。",
        "night-light": "与场景基准完全相同的固定机位，夜间版本；由既定灯具、窗外光或霓虹提供主辅光，清晰保留空间轮廓、门窗和核心物件的位置，冷暖关系明确，避免过暗；无人物、无文字。",
        weather: "与场景基准完全相同的固定机位，天气状态版本；选择一种天气并清晰表现雨、雾或雪对地面、窗面、空气与远景的影响，空间布局和核心锚点不改变，主光方向延续基准；无人物、无文字。",
        "prop-sheet": "场景核心道具参考表，在干净背景上分区展示固定陈设、关键工具、灯具或地标细节；物件比例、材质、颜色和磨损状态与场景基准一致，柔和棚拍光，轮廓清晰；无人物、无文字。",
        "state-variants": "同一固定机位的场景状态对照，保持门窗、家具、核心物件和镜头位置不变；只改变一种明确状态，例如轻度损坏、紧急照明或停电，变化可读但空间仍连续；无人物、无文字。",
        continuity: "用于连续镜头的空间基准图，广角平视，完整呈现入口、窗户、核心家具和远景地标的固定相对位置；尺度、方向、材质和光线关系稳定，画面留出人物活动区域；无人物、无文字。",
    },
};
