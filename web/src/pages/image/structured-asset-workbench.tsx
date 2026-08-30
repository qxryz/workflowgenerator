import {
    Check,
    ChevronDown,
    ChevronRight,
    Circle,
    FolderPlus,
    ImagePlus,
    Layers3,
    Plus,
    Search,
    Trash2,
} from "lucide-react";
import { Button, Empty, Input, Progress, Tag, Tooltip } from "antd";
import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";
import {
    isStructuredAsset,
    useAssetStore,
    type StructuredAsset,
    type StructuredAssetImage,
    type StructuredAssetKind,
    type StructuredAssetPart,
} from "@/stores/use-asset-store";
import type { ReferenceImage } from "@/types/image";

type PartDefinition = Omit<StructuredAssetPart, "prompt">;
type GroupDefinition = { id: string; label: string; parts: PartDefinition[] };

export type StructuredAssetDraft = {
    kind: StructuredAssetKind;
    assetId?: string;
    title: string;
    description: string;
    fields: Record<string, string>;
    images: StructuredAssetImage[];
    parts: StructuredAssetPart[];
    activeGroupId: string;
    activePartId: string;
    tags: string[];
};

export const STRUCTURED_FIELD_DEFINITIONS: Record<StructuredAssetKind, Array<{ key: string; label: string; placeholder: string }>> = {
    character: [
        { key: "角色定位", label: "角色定位", placeholder: "身份、职业、年龄或关系" },
        { key: "外观与脸部", label: "外观与脸部", placeholder: "体型、脸部、肤色、瞳色等关键特征" },
        { key: "发型", label: "发型", placeholder: "发色、长度、发质与造型" },
        { key: "服装与配件", label: "服装与配件", placeholder: "主服装、材质、固定道具" },
        { key: "性格与表演", label: "性格与表演", placeholder: "典型表情、动作和气质" },
        { key: "一致性规则", label: "一致性规则", placeholder: "每一镜都不能变化的特征" },
    ],
    scene: [
        { key: "空间类型", label: "空间类型", placeholder: "地点、室内外、建筑或自然环境" },
        { key: "空间布局", label: "空间布局", placeholder: "入口、窗户、活动区域与视线关系" },
        { key: "主要物件", label: "主要物件", placeholder: "不可缺少的陈设、道具或地标" },
        { key: "光线与时间", label: "光线与时间", placeholder: "主光源、色温、昼夜状态" },
        { key: "氛围与天气", label: "氛围与天气", placeholder: "情绪、天气、粒子与环境状态" },
        { key: "空间锚点", label: "空间锚点", placeholder: "例如：门在左墙，窗在正前方" },
        { key: "一致性规则", label: "一致性规则", placeholder: "每个镜头都要保持的布局与状态" },
    ],
};

export const STRUCTURED_WORKFLOW_DEFINITIONS: Record<StructuredAssetKind, GroupDefinition[]> = {
    character: [
        {
            id: "identity",
            label: "核心身份",
            parts: [
                { id: "identity-profile", groupId: "identity", title: "身份档案", description: "角色身份、年龄、职业与关系", expectedOutput: "一份可复用的身份描述" },
                { id: "consistency-rules", groupId: "identity", title: "不可变特征", description: "锁定每一镜都不能改变的特征", expectedOutput: "一致性规则与负面约束" },
            ],
        },
        {
            id: "appearance",
            label: "外观基准",
            parts: [
                { id: "hero", groupId: "appearance", title: "主视觉", description: "角色最具代表性的标准形象", expectedOutput: "1 张角色主视觉" },
                { id: "turnaround", groupId: "appearance", title: "三视图", description: "正面、侧面、背面保持比例一致", expectedOutput: "正面 / 侧面 / 背面三张图" },
                { id: "face-detail", groupId: "appearance", title: "脸部特写", description: "清晰锁定五官、肤质与发际线", expectedOutput: "正脸与 3/4 脸部特写" },
                { id: "scale", groupId: "appearance", title: "身高比例", description: "标准站姿与身材比例参考", expectedOutput: "全身比例标尺图" },
            ],
        },
        { id: "expression", label: "表情", parts: [{ id: "expression-sheet", groupId: "expression", title: "表情表", description: "中性、喜怒哀惧等标准表情", expectedOutput: "一组统一角度的表情图" }] },
        { id: "action", label: "动作", parts: [{ id: "pose-sheet", groupId: "action", title: "动作表", description: "站立、行走与剧情常用动作", expectedOutput: "一组全身动作参考" }] },
        {
            id: "outfit",
            label: "服装",
            parts: [
                { id: "default-outfit", groupId: "outfit", title: "主服装", description: "角色默认服装与固定配饰", expectedOutput: "主服装正侧背参考" },
                { id: "outfit-variants", groupId: "outfit", title: "服装版本", description: "日常、战斗或剧情状态服装", expectedOutput: "一组服装版本" },
            ],
        },
        { id: "detail", label: "细节", parts: [{ id: "detail-sheet", groupId: "detail", title: "细节表", description: "纹身、饰品、道具与特殊结构", expectedOutput: "关键局部特写" }] },
        { id: "relationship", label: "关系", parts: [{ id: "pair-reference", groupId: "relationship", title: "关系参考", description: "常同框人物的比例与互动边界", expectedOutput: "人物关系与比例参考图" }] },
    ],
    scene: [
        {
            id: "identity",
            label: "场景设定",
            parts: [
                { id: "scene-profile", groupId: "identity", title: "地点档案", description: "地点、年代、用途与整体气氛", expectedOutput: "一份可复用的场景描述" },
                { id: "spatial-anchors", groupId: "identity", title: "空间锚点", description: "门窗、家具与核心地标的固定关系", expectedOutput: "锚点说明与可见关系" },
            ],
        },
        {
            id: "space",
            label: "空间基准",
            parts: [
                { id: "hero", groupId: "space", title: "主视觉", description: "场景最具代表性的标准画面", expectedOutput: "1 张场景主视觉" },
                { id: "floor-plan", groupId: "space", title: "平面布局", description: "入口、窗户、家具和活动区位置", expectedOutput: "顶视平面布局图" },
                { id: "master-wide", groupId: "space", title: "全景基准", description: "建立空间尺度与核心物件关系", expectedOutput: "1 张广角空间基准图" },
            ],
        },
        {
            id: "views",
            label: "多视角",
            parts: [
                { id: "entrance-view", groupId: "views", title: "入口视角", description: "从入口看向空间内部", expectedOutput: "入口机位参考图" },
                { id: "window-view", groupId: "views", title: "窗口视角", description: "从室内看向窗户与窗外", expectedOutput: "窗口机位参考图" },
                { id: "focal-view", groupId: "views", title: "核心区域", description: "面向主要活动区域与核心物件", expectedOutput: "核心区域机位参考图" },
            ],
        },
        {
            id: "lighting",
            label: "光线天气",
            parts: [
                { id: "day-light", groupId: "lighting", title: "日间", description: "日间自然光与基础色彩", expectedOutput: "日间光线状态" },
                { id: "night-light", groupId: "lighting", title: "夜间", description: "夜间主辅光源与窗外光", expectedOutput: "夜间光线状态" },
                { id: "weather", groupId: "lighting", title: "天气版本", description: "雨、雾、雪等环境变化", expectedOutput: "天气状态版本" },
            ],
        },
        { id: "props", label: "陈设道具", parts: [{ id: "prop-sheet", groupId: "props", title: "道具表", description: "核心物件与固定陈设的细节", expectedOutput: "场景道具参考表" }] },
        { id: "state", label: "状态版本", parts: [{ id: "state-variants", groupId: "state", title: "状态版本", description: "正常、损坏、停电或剧情变化", expectedOutput: "同机位状态对照" }] },
        { id: "continuity", label: "连贯性", parts: [{ id: "continuity", groupId: "continuity", title: "连续性参考", description: "锁定方向、尺度、锚点与状态", expectedOutput: "连续镜头约束参考" }] },
    ],
};

export function createStructuredAssetDraft(kind: StructuredAssetKind): StructuredAssetDraft {
    const definitions = STRUCTURED_WORKFLOW_DEFINITIONS[kind];
    return {
        kind,
        title: "",
        description: "",
        fields: Object.fromEntries(STRUCTURED_FIELD_DEFINITIONS[kind].map((field) => [field.key, ""])),
        images: [],
        parts: definitions.flatMap((group) => group.parts.map((part) => ({ ...part, prompt: "" }))),
        activeGroupId: definitions[1]?.id || definitions[0].id,
        activePartId: definitions[1]?.parts[0]?.id || definitions[0].parts[0].id,
        tags: [],
    };
}

export function normalizeStructuredAssetDraft(kind: StructuredAssetKind, draft?: Partial<StructuredAssetDraft>): StructuredAssetDraft {
    const baseline = createStructuredAssetDraft(kind);
    const savedParts = new Map((draft?.parts || []).map((part) => [part.id, part]));
    const parts = baseline.parts.map((part) => ({ ...part, ...savedParts.get(part.id), groupId: part.groupId, title: part.title, description: part.description, expectedOutput: part.expectedOutput }));
    const activePartId = parts.some((part) => part.id === draft?.activePartId) ? draft!.activePartId! : baseline.activePartId;
    const activePart = parts.find((part) => part.id === activePartId)!;
    return {
        ...baseline,
        ...draft,
        kind,
        fields: { ...baseline.fields, ...(draft?.fields || {}) },
        images: draft?.images || [],
        parts,
        activePartId,
        activeGroupId: activePart.groupId,
        tags: draft?.tags || [],
    };
}

export function structuredAssetToDraft(kind: StructuredAssetKind, asset: StructuredAsset): StructuredAssetDraft {
    return normalizeStructuredAssetDraft(kind, {
        assetId: asset.id,
        title: asset.title,
        description: asset.data.description,
        fields: asset.data.fields,
        images: asset.data.images,
        parts: asset.data.parts,
        activePartId: asset.data.activePartId,
        tags: asset.tags,
    });
}

export function structuredPrompt(draft: StructuredAssetDraft, partId = draft.activePartId) {
    const part = draft.parts.find((item) => item.id === partId);
    return [
        draft.title,
        draft.description,
        ...Object.entries(draft.fields).filter(([, value]) => Boolean(value)).map(([label, value]) => `${label}：${value}`),
        part ? `${part.title}：${part.prompt || part.description}` : "",
        part?.expectedOutput ? `期望输出：${part.expectedOutput}` : "",
    ].filter(Boolean).join("\n");
}

export function StructuredAssetLibraryPanel({
    kind,
    activeAssetId,
    onSelect,
    onCreate,
}: {
    kind: StructuredAssetKind;
    activeAssetId?: string;
    onSelect: (asset: StructuredAsset) => void;
    onCreate: () => void;
}) {
    const { t } = useAppTranslation();
    const [query, setQuery] = useState("");
    const assets = useAssetStore((state) => state.assets);
    const label = kind === "character" ? "人物" : "场景";
    const filtered = useMemo(() => {
        const keyword = query.trim().toLowerCase();
        return assets
            .filter((asset): asset is StructuredAsset => isStructuredAsset(asset) && asset.kind === kind)
            .filter((asset) => !keyword || `${asset.title} ${asset.data.description} ${asset.tags.join(" ")}`.toLowerCase().includes(keyword));
    }, [assets, kind, query]);

    return (
        <div className="flex h-full min-h-0 flex-col">
            <div className="border-b border-[color:var(--wg-studio-line)] p-3">
                <div className="mb-3 flex items-center justify-between gap-2">
                    <div>
                        <h2 className="text-sm font-semibold">{t(`${label}资产`)}</h2>
                        <p className="mt-0.5 text-[10px] text-[color:var(--wg-studio-muted)]">{t("与资产库同步")}</p>
                    </div>
                    <span className="text-[10px] text-[color:var(--wg-studio-muted)]">{filtered.length}</span>
                </div>
                <Input allowClear prefix={<Search className="size-3.5" />} value={query} placeholder={t(`搜索${label}名称`)} onChange={(event) => setQuery(event.target.value)} />
                <Button className="mt-2" block type="primary" icon={<Plus className="size-3.5" />} onClick={onCreate}>{t(`新建${label}`)}</Button>
            </div>
            <div className="thin-scrollbar min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
                {filtered.length ? filtered.map((asset) => {
                    const completion = assetCompletion(kind, asset.data.parts || [], asset.data.images);
                    return (
                        <button
                            type="button"
                            key={asset.id}
                            className={cn(
                                "flex w-full items-center gap-2.5 rounded-xl border px-2 py-2 text-left transition",
                                asset.id === activeAssetId
                                    ? "border-[color:var(--wg-studio-accent-strong)] bg-[color:var(--wg-studio-accent-soft)]"
                                    : "border-transparent hover:border-[color:var(--wg-studio-line)] hover:bg-[color:var(--wg-studio-raised)]",
                            )}
                            onClick={() => onSelect(asset)}
                        >
                            <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg bg-[color:var(--wg-studio-raised)]">
                                {asset.coverUrl ? <img src={asset.coverUrl} alt={asset.title} className="size-full object-cover" /> : <ImagePlus className="size-5 text-[color:var(--wg-studio-muted)]" />}
                            </div>
                            <div className="min-w-0 flex-1">
                                <div className="flex items-center gap-1.5">
                                    <strong className="truncate text-xs">{asset.title}</strong>
                                    {asset.id === activeAssetId ? <Check className="size-3.5 shrink-0 text-[color:var(--wg-studio-accent-strong)]" /> : null}
                                </div>
                                <p className="mt-1 truncate text-[10px] text-[color:var(--wg-studio-muted)]">{asset.data.description || t("尚未填写概述")}</p>
                                <div className="mt-2 flex items-center gap-2">
                                    <span className="size-1.5 rounded-full bg-emerald-500" />
                                    <span className="text-[10px] text-[color:var(--wg-studio-muted)]">{t("已完成 {value}%", { value: completion })}</span>
                                    <div className="h-1 min-w-0 flex-1 overflow-hidden rounded-full bg-[color:var(--wg-studio-line)]"><div className="h-full bg-[color:var(--wg-studio-accent-strong)]" style={{ width: `${completion}%` }} /></div>
                                </div>
                            </div>
                        </button>
                    );
                }) : (
                    <div className="grid h-full min-h-52 place-items-center px-4"><Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(`还没有${label}资产`)}><Button size="small" onClick={onCreate}>{t(`创建第一个${label}`)}</Button></Empty></div>
                )}
            </div>
        </div>
    );
}

export function StructuredAssetBoard({
    kind,
    draft,
    ready,
    references,
    running,
    onDraftChange,
    onSelectPart,
    onPartPromptChange,
    onAddReference,
    onRemoveReference,
    onSaveReference,
    onGenerate,
    onSave,
    onSetCurrentImage,
    onRemoveImage,
}: {
    kind: StructuredAssetKind;
    draft: StructuredAssetDraft;
    ready: boolean;
    references: ReferenceImage[];
    running: boolean;
    onDraftChange: (update: (current: StructuredAssetDraft) => StructuredAssetDraft) => void;
    onSelectPart: (partId: string) => void;
    onPartPromptChange: (partId: string, value: string) => void;
    onAddReference: () => void;
    onRemoveReference: (id: string) => void;
    onSaveReference: (reference: ReferenceImage) => void;
    onGenerate: () => void;
    onSave: () => void;
    onSetCurrentImage: (imageId: string) => void;
    onRemoveImage: (imageId: string) => void;
}) {
    const { t } = useAppTranslation();
    const navigate = useNavigate();

    if (!ready) return <div className="grid h-full place-items-center text-xs text-[color:var(--wg-studio-muted)]">{t("正在读取资产…")}</div>;

    const definitions = STRUCTURED_WORKFLOW_DEFINITIONS[kind];
    const activeGroup = definitions.find((group) => group.id === draft.activeGroupId) || definitions[0];
    const activePart = draft.parts.find((part) => part.id === draft.activePartId) || draft.parts[0];
    const currentCover = draft.images.find((image) => image.isCurrent) || draft.images[0];
    const completion = assetCompletion(kind, draft.parts, draft.images);
    const label = kind === "character" ? "人物" : "场景";
    const activePartImages = imagesForPart(draft, activePart.id);
    const firstReferenceSaved = references[0] ? activePartImages.some((image) => image.storageKey ? image.storageKey === references[0].storageKey : image.dataUrl === references[0].dataUrl) : false;

    return (
        <div className="thin-scrollbar h-full min-h-0 overflow-y-auto">
            <header className="grid grid-cols-[4rem_minmax(0,1fr)] items-start gap-3 border-b border-[color:var(--wg-studio-line)] p-3 sm:flex">
                <div className="grid size-16 shrink-0 place-items-center overflow-hidden rounded-xl bg-[color:var(--wg-studio-raised)]">
                    {currentCover ? <img src={currentCover.dataUrl} alt={currentCover.title} className="size-full object-cover" /> : <Layers3 className="size-6 text-[color:var(--wg-studio-muted)]" />}
                </div>
                <div className="min-w-0 flex-1">
                    <Input variant="borderless" className="-ml-2 !text-base !font-semibold" value={draft.title} placeholder={t(`未命名${label}`)} onChange={(event) => onDraftChange((current) => ({ ...current, title: event.target.value }))} />
                    <Input variant="borderless" className="-ml-2" value={draft.description} placeholder={t(`用一句话锁定${label}的核心设定`)} onChange={(event) => onDraftChange((current) => ({ ...current, description: event.target.value }))} />
                    <div className="mt-1 flex items-center gap-2">
                        <span className="text-[10px] text-[color:var(--wg-studio-muted)]">{t("完成度")}</span>
                        <Progress className="!mb-0 max-w-44" percent={completion} size="small" showInfo={false} />
                        <span className="text-[10px] text-[color:var(--wg-studio-muted)]">{completion}%</span>
                    </div>
                </div>
                <div className="col-span-2 flex flex-wrap gap-2 sm:ml-auto sm:shrink-0 sm:flex-nowrap">
                    {draft.assetId ? <Button onClick={() => navigate("/assets")}>{t("查看资产详情")}</Button> : null}
                    <Button type="primary" icon={<FolderPlus className="size-3.5" />} onClick={onSave}>{t(draft.assetId ? "更新资产包" : "打包入库")}</Button>
                </div>
            </header>

            <nav className="thin-scrollbar flex overflow-x-auto border-b border-[color:var(--wg-studio-line)] px-3" aria-label={t(`${label}资产部件`)}>
                {definitions.map((group) => (
                    <button
                        type="button"
                        key={group.id}
                        className={cn(
                            "relative shrink-0 px-3 py-3 text-xs transition",
                            group.id === activeGroup.id ? "font-semibold text-[color:var(--wg-studio-accent-strong)]" : "text-[color:var(--wg-studio-muted)] hover:text-[color:var(--wg-studio-text)]",
                        )}
                        onClick={() => onSelectPart(group.parts[0].id)}
                    >
                        {t(group.label)}
                        {group.id === activeGroup.id ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-[color:var(--wg-studio-accent-strong)]" /> : null}
                    </button>
                ))}
            </nav>

            <div className="divide-y divide-[color:var(--wg-studio-line)]">
                {activeGroup.parts.map((definition) => {
                    const part = draft.parts.find((item) => item.id === definition.id)!;
                    const partImages = imagesForPart(draft, part.id);
                    const isActive = part.id === activePart.id;
                    return (
                        <section key={part.id} className={cn(isActive && "bg-[color:var(--wg-studio-accent-soft)]/40")}>
                            <button type="button" className="flex w-full items-center gap-3 px-4 py-3 text-left" onClick={() => onSelectPart(part.id)}>
                                <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", partImages.length ? "border-emerald-500 text-emerald-500" : "border-[color:var(--wg-studio-line)] text-[color:var(--wg-studio-muted)]")}>{partImages.length ? <Check className="size-3" /> : <Circle className="size-2.5" />}</span>
                                <div className="min-w-0 flex-1">
                                    <strong className="block text-xs">{t(part.title)}</strong>
                                    <span className="block truncate text-[10px] text-[color:var(--wg-studio-muted)]">{t(part.description)}</span>
                                </div>
                                <div className="flex max-w-52 items-center -space-x-2">
                                    {partImages.slice(0, 3).map((image) => <img key={image.id} src={image.dataUrl} alt={image.title} className="size-10 rounded-md border-2 border-[color:var(--wg-studio-surface)] object-cover" />)}
                                </div>
                                <Tag className="m-0 border-0">{partImages.length ? t("{count} 个版本", { count: partImages.length }) : t("待制作")}</Tag>
                                {isActive ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                            </button>

                            {isActive ? (
                                <div className="grid gap-0 border-t border-[color:var(--wg-studio-line)] lg:grid-cols-[0.85fr_1.4fr_0.8fr]">
                                    <div className="border-b border-[color:var(--wg-studio-line)] p-4 lg:border-b-0 lg:border-r">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--wg-studio-muted)]">{t("继承的一致性约束")}</span>
                                        <div className="mt-3 space-y-2 text-[11px] leading-5">
                                            {consistencyItems(draft).length ? consistencyItems(draft).map(([key, value]) => <p key={key}><strong>{t(key)}：</strong>{value}</p>) : <p className="text-[color:var(--wg-studio-muted)]">{t(kind === "character" ? "先在核心身份中补充不可变特征" : "先在场景设定中补充空间锚点与一致性规则")}</p>}
                                        </div>
                                    </div>
                                    <div className="border-b border-[color:var(--wg-studio-line)] p-4 lg:border-b-0 lg:border-r">
                                        <div className="mb-2 flex items-center justify-between gap-2">
                                            <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--wg-studio-muted)]">{t("本部分描述")}</span>
                                            <Button size="small" type="text" icon={<ImagePlus className="size-3.5" />} onClick={onAddReference}>{t("添加参考图")}</Button>
                                        </div>
                                        <Input.TextArea value={part.prompt} autoSize={{ minRows: 4, maxRows: 7 }} placeholder={t(`描述“${part.title}”需要保持和生成的内容`)} onChange={(event) => onPartPromptChange(part.id, event.target.value)} />
                                        <div className="mt-3 flex min-h-14 flex-wrap gap-2">
                                            {references.length ? references.map((reference) => (
                                                <div key={reference.id} className="group relative size-14 overflow-hidden rounded-lg border border-[color:var(--wg-studio-line)]" onDoubleClick={() => onSaveReference(reference)}>
                                                    <img src={reference.dataUrl} alt={reference.name} className="size-full object-cover" />
                                                    <button type="button" className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded bg-black/60 text-white opacity-0 group-hover:opacity-100" onClick={() => onRemoveReference(reference.id)} aria-label={t("移除参考图")}><Trash2 className="size-3" /></button>
                                                </div>
                                            )) : <button type="button" className="flex min-h-14 flex-1 items-center justify-center gap-2 rounded-lg border border-dashed border-[color:var(--wg-studio-line)] text-[11px] text-[color:var(--wg-studio-muted)]" onClick={onAddReference}><ImagePlus className="size-4" />{t("从本机或资产库添加参考图")}</button>}
                                        </div>
                                        {references.length ? <Button className="mt-2" size="small" block disabled={firstReferenceSaved} onClick={() => onSaveReference(references[0])}>{t(firstReferenceSaved ? "首张参考图已存为版本" : "将首张参考图存为当前版本")}</Button> : null}
                                    </div>
                                    <div className="flex flex-col p-4">
                                        <span className="text-[10px] font-semibold uppercase tracking-wide text-[color:var(--wg-studio-muted)]">{t("期望输出")}</span>
                                        <p className="mt-3 text-xs leading-5">{t(part.expectedOutput)}</p>
                                        <p className="mt-2 text-[10px] leading-4 text-[color:var(--wg-studio-muted)]">{t("生成成功后会自动保存到当前部件，并保留旧版本。")}</p>
                                        <Button className="mt-auto" type="primary" loading={running} disabled={!draft.title.trim() || running} onClick={onGenerate}>{t("生成并保存到“{name}”", { name: part.title })}</Button>
                                    </div>
                                </div>
                            ) : null}
                        </section>
                    );
                })}
            </div>

            <section className="border-t border-[color:var(--wg-studio-line)] p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                    <div><strong className="text-xs">{t("版本记录")}</strong><span className="ml-2 text-[10px] text-[color:var(--wg-studio-muted)]">{t(activePart.title)}</span></div>
                    <span className="text-[10px] text-[color:var(--wg-studio-muted)]">{t("新版本不会覆盖旧结果")}</span>
                </div>
                {activePartImages.length ? (
                    <div className="thin-scrollbar flex gap-2 overflow-x-auto pb-1">
                        {activePartImages.map((image, index) => (
                            <div key={image.id} className={cn("group relative w-32 shrink-0 overflow-hidden rounded-lg border", image.isCurrent ? "border-[color:var(--wg-studio-accent-strong)]" : "border-[color:var(--wg-studio-line)]")}>
                                <img src={image.dataUrl} alt={image.title} className="aspect-[4/3] w-full object-cover" />
                                <div className="flex items-center justify-between gap-1 px-2 py-1.5">
                                    <span className="truncate text-[10px]">v{activePartImages.length - index}</span>
                                    {image.isCurrent ? <span className="text-[10px] text-emerald-500">{t("当前")}</span> : <button type="button" className="text-[10px] text-[color:var(--wg-studio-accent-strong)]" onClick={() => onSetCurrentImage(image.id)}>{t("设为当前")}</button>}
                                </div>
                                <Tooltip title={t("移除版本")}><button type="button" className="absolute right-1 top-1 grid size-6 place-items-center rounded-md bg-black/60 text-white opacity-0 transition group-hover:opacity-100" onClick={() => onRemoveImage(image.id)}><Trash2 className="size-3.5" /></button></Tooltip>
                            </div>
                        ))}
                    </div>
                ) : <div className="rounded-lg border border-dashed border-[color:var(--wg-studio-line)] px-3 py-6 text-center text-xs text-[color:var(--wg-studio-muted)]">{t("这个部件还没有版本，完善描述后开始生成")}</div>}
            </section>
        </div>
    );
}

function imagesForPart(draft: StructuredAssetDraft, partId: string) {
    const direct = draft.images.filter((image) => image.partId === partId);
    if (direct.length || partId !== "hero") return direct;
    return draft.images.filter((image) => !image.partId);
}

function consistencyItems(draft: StructuredAssetDraft) {
    const preferred = ["一致性规则", "角色定位", "外观与脸部", "空间布局", "空间锚点"];
    return preferred.flatMap((key) => draft.fields[key]?.trim() ? [[key, draft.fields[key].trim()] as const] : []).slice(0, 5);
}

function assetCompletion(kind: StructuredAssetKind, parts: StructuredAssetPart[], images: StructuredAssetImage[]) {
    const baseline = STRUCTURED_WORKFLOW_DEFINITIONS[kind].flatMap((group) => group.parts);
    const saved = new Map(parts.map((part) => [part.id, part]));
    const completed = baseline.filter((part) => Boolean(saved.get(part.id)?.prompt?.trim()) || images.some((image) => image.partId === part.id || (!image.partId && part.id === "hero"))).length;
    return Math.round((completed / Math.max(1, baseline.length)) * 100);
}
