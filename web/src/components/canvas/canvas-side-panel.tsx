import { memo, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { App, Empty, Input, Popconfirm, Select, Spin, Tag } from "antd";
import { useQuery } from "@tanstack/react-query";
import { BookOpen, Check, ChevronRight, Download, Eye, File, FileText, Image as ImageIcon, ListChecks, MapPinned, Music2, Plus, Search, Settings2, Square, Terminal, Trash2, Type, UserRound, Video } from "lucide-react";
import { motion } from "motion/react";

import { canvasThemes, type CanvasTheme } from "@/lib/canvas-theme";
import { exportCanvasNodes } from "@/lib/canvas/canvas-export";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { cn } from "@/lib/utils";
import { PromptDetailDialog } from "@/pages/prompts/components/prompt-detail-dialog";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { fetchSourcePrompts, type Prompt } from "@/services/api/prompts";
import { stageAssetImport } from "@/services/asset-import";
import { isStructuredAsset, useAssetStore, type Asset, type AssetKind } from "@/stores/use-asset-store";
import { usePromptSourceStore } from "@/stores/use-prompt-source-store";
import { CANVAS_SIDE_PANEL_MAX_WIDTH, CANVAS_SIDE_PANEL_MIN_WIDTH, CANVAS_SIDE_PANEL_MOTION_MS, useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

import type { InsertAssetPayload } from "./asset-picker-modal";

const PANEL_MOTION_SECONDS = CANVAS_SIDE_PANEL_MOTION_MS / 1000;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;

type PanelTab = "canvas" | "assets" | "prompts";

type Props = {
    nodes: CanvasNodeData[];
    selectedNodeIds: Set<string>;
    onFocusNode: (nodeId: string) => void;
    onPreviewNode: (nodeId: string) => void;
    onInsertAsset: (payload: InsertAssetPayload) => void;
};

const NODE_TYPE_ICON: Record<string, typeof Square> = {
    [CanvasNodeType.Image]: ImageIcon,
    [CanvasNodeType.Video]: Video,
    [CanvasNodeType.Audio]: Music2,
    [CanvasNodeType.Text]: Type,
    [CanvasNodeType.File]: File,
    [CanvasNodeType.Config]: Settings2,
    [CanvasNodeType.Terminal]: Terminal,
    [CanvasNodeType.Group]: Square,
};

const STATUS_COLOR: Record<string, string> = {
    success: "#22c55e",
    loading: "#f59e0b",
    error: "#ef4444",
    idle: "transparent",
};

export function CanvasSidePanel({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, onInsertAsset }: Props) {
    const { t } = useAppTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [tab, setTab] = useState<PanelTab>("canvas");
    const width = useCanvasSidePanelStore((state) => state.width);
    const panelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const panelMounted = useCanvasSidePanelStore((state) => state.panelMounted);
    const panelClosing = useCanvasSidePanelStore((state) => state.panelClosing);
    const setWidth = useCanvasSidePanelStore((state) => state.setWidth);
    const commitWidth = useCanvasSidePanelStore((state) => state.commitWidth);
    const [resizing, setResizing] = useState(false);

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        let frame = 0;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, startWidth + moveEvent.clientX - startX));
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                setWidth(nextWidth);
            });
        };
        const onUp = () => {
            if (frame) window.cancelAnimationFrame(frame);
            setWidth(nextWidth);
            commitWidth(nextWidth);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[60] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-r"
                initial={{ x: -48 }}
                animate={{ x: panelClosing ? -28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: PANEL_EASE }}
                style={{ width, background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                data-canvas-no-zoom
            >
                <div className="flex items-center gap-5 px-4 pt-3.5">
                    <TabButton label="画布" active={tab === "canvas"} theme={theme} onClick={() => setTab("canvas")} />
                    <TabButton label="资产" active={tab === "assets"} theme={theme} onClick={() => setTab("assets")} />
                    <TabButton label="提示词库" active={tab === "prompts"} theme={theme} onClick={() => setTab("prompts")} />
                </div>
                <div className="mt-2 min-h-0 flex-1 overflow-hidden">
                    {tab === "canvas" ? (
                        <CanvasNodesTab nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={onFocusNode} onPreviewNode={onPreviewNode} theme={theme} />
                    ) : tab === "assets" ? (
                        <CanvasAssetsTab onInsert={onInsertAsset} theme={theme} />
                    ) : (
                        <CanvasPromptsTab onInsert={onInsertAsset} theme={theme} />
                    )}
                </div>
                <button type="button" className="absolute inset-y-0 right-0 z-40 w-4 translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label={t("调整左侧面板宽度")} />
            </motion.aside>
        </motion.div>
    );
}

function TabButton({ label, active, theme, onClick }: { label: string; active: boolean; theme: CanvasTheme; onClick: () => void }) {
    const { t } = useAppTranslation();
    return (
        <button type="button" onClick={onClick} className="relative pb-1.5 text-sm font-semibold transition-opacity" style={{ color: theme.node.text, opacity: active ? 1 : 0.45 }}>
            {t(label)}
            {active ? <motion.span layoutId="sidePanelTabIndicator" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full" style={{ background: theme.toolbar.activeText }} transition={{ type: "spring", stiffness: 500, damping: 34 }} /> : null}
        </button>
    );
}

// ---------------------------------------------------------------------------
// 画布 Tab —— 列出节点,点击居中放大并选中
// ---------------------------------------------------------------------------

const NODE_FILTER_OPTIONS = [
    { label: "全部", value: "all" },
    { label: "图片", value: CanvasNodeType.Image },
    { label: "视频", value: CanvasNodeType.Video },
    { label: "文本", value: CanvasNodeType.Text },
    { label: "音频", value: CanvasNodeType.Audio },
    { label: "文件", value: CanvasNodeType.File },
    { label: "配置", value: CanvasNodeType.Config },
    { label: "终端", value: CanvasNodeType.Terminal },
    { label: "分组", value: CanvasNodeType.Group },
];

function nodePreviewText(node: CanvasNodeData) {
    if (node.type === CanvasNodeType.Text) return node.metadata?.content || node.metadata?.prompt || "";
    return getNodeDefinition(node.type)?.title || node.type;
}

function CanvasNodesTab({ nodes, selectedNodeIds, onFocusNode, onPreviewNode, theme }: { nodes: CanvasNodeData[]; selectedNodeIds: Set<string>; onFocusNode: (nodeId: string) => void; onPreviewNode: (nodeId: string) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const [keyword, setKeyword] = useState("");
    const [typeFilter, setTypeFilter] = useState<string>("all");
    const [selectMode, setSelectMode] = useState(false);
    const [checked, setChecked] = useState<Set<string>>(new Set());
    const [exporting, setExporting] = useState(false);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return nodes.filter((node) => (typeFilter === "all" || node.type === typeFilter) && (!query || [node.title, node.metadata?.content, node.metadata?.prompt].filter(Boolean).join(" ").toLowerCase().includes(query)));
    }, [nodes, keyword, typeFilter]);

    const exitSelect = () => {
        setSelectMode(false);
        setChecked(new Set());
    };
    const toggleChecked = (id: string) =>
        setChecked((prev) => {
            const next = new Set(prev);
            next.has(id) ? next.delete(id) : next.add(id);
            return next;
        });
    const allChecked = filtered.length > 0 && filtered.every((node) => checked.has(node.id));
    const toggleAll = () => setChecked(allChecked ? new Set() : new Set(filtered.map((node) => node.id)));

    const handleExport = async () => {
        const targets = nodes.filter((node) => checked.has(node.id));
        if (!targets.length) return;
        setExporting(true);
        const hide = message.loading(t("正在导出选中元素…"), 0);
        try {
            await exportCanvasNodes(targets, `画布元素-${targets.length}个`);
            message.success(t("已导出 {count} 个元素", { count: targets.length }));
            exitSelect();
        } catch (error) {
            console.error(error);
            message.error(t("导出失败，请重试"));
        } finally {
            hide();
            setExporting(false);
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2.5 pt-1">
                <span className="text-xs font-medium opacity-60">{t("画布元素")}</span>
                {filtered.length ? <span className="text-xs opacity-35">{filtered.length}</span> : null}
                <button
                    type="button"
                    onClick={() => (selectMode ? exitSelect() : setSelectMode(true))}
                    className="ml-auto flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10"
                    style={selectMode ? { color: theme.toolbar.activeText, opacity: 1 } : undefined}
                >
                    <ListChecks className="size-3.5" />
                    {t(selectMode ? "取消" : "选择")}
                </button>
                {selectMode ? null : <Select size="small" variant="borderless" className="w-20" value={typeFilter} onChange={setTypeFilter} options={NODE_FILTER_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} />}
            </div>
            <div className="px-3 pb-2.5">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("搜索节点")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {filtered.length ? (
                    <div className="space-y-1.5">
                        {filtered.map((node) => {
                            const Icon = NODE_TYPE_ICON[node.type] || FileText;
                            const isImage = node.type === CanvasNodeType.Image && node.metadata?.content;
                            const isChecked = checked.has(node.id);
                            const active = selectMode ? isChecked : selectedNodeIds.has(node.id);
                            return (
                                <div key={node.id} className={cn("group flex w-full items-center rounded-lg transition", active ? "" : "hover:bg-black/5 dark:hover:bg-white/5")} style={active ? { background: theme.toolbar.activeBg } : undefined}>
                                    <button type="button" onClick={() => (selectMode ? toggleChecked(node.id) : onFocusNode(node.id))} className="flex min-w-0 flex-1 items-center gap-3 px-2 py-2 text-left" title={selectMode ? undefined : t("定位到节点")}>
                                        {selectMode ? <CheckMark checked={isChecked} theme={theme} /> : null}
                                        <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-md">
                                            {isImage ? <img src={node.metadata!.content} alt={node.title} className="size-full object-cover" /> : <Icon className="size-5 opacity-60" />}
                                        </span>
                                        <span className="min-w-0 flex-1 space-y-0.5">
                                            <span className="block truncate text-sm font-medium leading-snug">{node.title || t(getNodeDefinition(node.type)?.title || "未命名节点")}</span>
                                            <span className="block truncate text-xs leading-snug opacity-50">{t(nodePreviewText(node))}</span>
                                        </span>
                                        {node.metadata?.status && node.metadata.status !== "idle" ? <span className="size-1.5 shrink-0 rounded-full" style={{ background: STATUS_COLOR[node.metadata.status] || "transparent" }} /> : null}
                                    </button>
                                    {selectMode || !isImage ? null : (
                                        <div className="flex shrink-0 flex-col items-center gap-0.5 pr-1.5">
                                            <button
                                                type="button"
                                                onClick={() => onPreviewNode(node.id)}
                                                className="grid size-7 place-items-center rounded-md opacity-55 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                                                aria-label={t("放大预览")}
                                                title={t("放大预览")}
                                            >
                                                <Eye className="size-3.5" />
                                            </button>
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <div className="pt-16 text-center text-sm opacity-40">{t("画布暂无节点")}</div>
                )}
            </div>
            {selectMode ? (
                <div className="flex items-center gap-2 border-t px-3 py-2.5" style={{ borderColor: theme.toolbar.border }}>
                    <button type="button" onClick={toggleAll} className="rounded-md px-2 py-1 text-xs font-medium opacity-70 transition hover:bg-black/5 hover:opacity-100 dark:hover:bg-white/10">
                        {t(allChecked ? "取消全选" : "全选")}
                    </button>
                    <span className="text-xs opacity-45">{t("已选 {count}", { count: checked.size })}</span>
                    <button
                        type="button"
                        onClick={() => void handleExport()}
                        disabled={!checked.size || exporting}
                        className="ml-auto flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-40 dark:hover:bg-white/10"
                        style={{ color: theme.node.text }}
                    >
                        <Download className="size-3.5" />
                        {t("导出选中")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}

function CheckMark({ checked, theme }: { checked: boolean; theme: CanvasTheme }) {
    return (
        <span className="grid size-4 shrink-0 place-items-center rounded border transition" style={{ borderColor: checked ? theme.toolbar.activeText : theme.node.stroke, background: checked ? theme.toolbar.activeText : "transparent" }}>
            {checked ? <Check className="size-3 text-white" /> : null}
        </span>
    );
}

// ---------------------------------------------------------------------------
// 资产 Tab —— 按类型折叠分组 + 标签筛选,点击插入画布
// ---------------------------------------------------------------------------

const ASSET_GROUPS: { kind: AssetKind; label: string; icon: typeof Square }[] = [
    { kind: "image", label: "图片", icon: ImageIcon },
    { kind: "video", label: "视频", icon: Video },
    { kind: "audio", label: "音频", icon: Music2 },
    { kind: "character", label: "人物", icon: UserRound },
    { kind: "scene", label: "场景", icon: MapPinned },
    { kind: "text", label: "文本", icon: FileText },
    { kind: "file", label: "文件", icon: File },
];

function buildInsertPayload(asset: Asset): InsertAssetPayload {
    if (asset.kind === "text") return { kind: "text", content: asset.data.content, title: asset.title };
    if (asset.kind === "video") return { kind: "video", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, width: asset.data.width, height: asset.data.height };
    if (asset.kind === "audio") return { kind: "audio", url: asset.data.url, storageKey: asset.data.storageKey, title: asset.title, durationMs: asset.data.durationMs, bytes: asset.data.bytes, mimeType: asset.data.mimeType };
    if (asset.kind === "file") return { kind: "file", title: asset.title, storageKey: asset.data.storageKey, fileName: asset.data.fileName, bytes: asset.data.bytes, mimeType: asset.data.mimeType, extension: asset.data.extension, category: asset.data.category };
    if (isStructuredAsset(asset)) return { kind: "structured", assetKind: asset.kind, title: asset.title, description: asset.data.description, fields: asset.data.fields, images: asset.data.images };
    return { kind: "image", dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, title: asset.title };
}

const CanvasAssetsTab = memo(function CanvasAssetsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const assets = useAssetStore((state) => state.assets);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const removeAsset = useAssetStore((state) => state.removeAsset);
    const [keyword, setKeyword] = useState("");
    const [tagFilter, setTagFilter] = useState<string>("all");
    const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
    const [uploading, setUploading] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const allTags = useMemo(() => Array.from(new Set(assets.flatMap((asset) => asset.tags || []))).slice(0, 20), [assets]);

    const filtered = useMemo(() => {
        const query = keyword.trim().toLowerCase();
        return assets.filter((asset) => (tagFilter === "all" || (asset.tags || []).includes(tagFilter)) && (!query || [asset.title, ...(asset.tags || [])].join(" ").toLowerCase().includes(query)));
    }, [assets, keyword, tagFilter]);

    const groups = useMemo(() => ASSET_GROUPS.map((group) => ({ ...group, items: filtered.filter((asset) => asset.kind === group.kind) })).filter((group) => group.items.length > 0), [filtered]);

    const handleFiles = async (fileList: FileList | null) => {
        const files = Array.from(fileList || []);
        if (!files.length) return;
        setUploading(true);
        const hide = message.loading(t("正在添加资产…"), 0);
        let added = 0;
        try {
            for (const file of files) {
                let staged: Awaited<ReturnType<typeof stageAssetImport>> | undefined;
                try {
                    staged = await stageAssetImport(file);
                    await addAssetPersisted(staged.asset);
                    staged.publish();
                    added += 1;
                } catch (error) {
                    if (staged) await staged.discard().catch(() => undefined);
                    throw error;
                }
            }
            if (added) message.success(t("已添加 {count} 个资产", { count: added }));
        } catch (error) {
            console.error(error);
            message.error(t("添加失败，请重试"));
        } finally {
            hide();
            setUploading(false);
            if (fileInputRef.current) fileInputRef.current.value = "";
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="flex items-center gap-2 px-3 pb-2 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("搜索资产")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
                <button
                    type="button"
                    disabled={uploading}
                    onClick={() => fileInputRef.current?.click()}
                    className="flex shrink-0 items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold transition hover:bg-black/5 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-white/10"
                    style={{ color: theme.node.text }}
                >
                    <Plus className="size-3.5" />
                    {t("添加")}
                </button>
                <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => void handleFiles(e.target.files)} />
            </div>
            {allTags.length ? (
                <div className="flex flex-wrap gap-1.5 px-3 pb-2">
                    <Tag.CheckableTag checked={tagFilter === "all"} className={cn("prompt-filter-tag", tagFilter === "all" && "is-active")} onChange={() => setTagFilter("all")}>
                        {t("全部")}
                    </Tag.CheckableTag>
                    {allTags.map((tag) => (
                        <Tag.CheckableTag key={tag} checked={tagFilter === tag} className={cn("prompt-filter-tag", tagFilter === tag && "is-active")} onChange={() => setTagFilter((prev) => (prev === tag ? "all" : tag))}>
                            {tag}
                        </Tag.CheckableTag>
                    ))}
                </div>
            ) : null}
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                {groups.length ? (
                    <div className="space-y-1">
                        {groups.map((group) => {
                            const isCollapsed = collapsed[group.kind];
                            return (
                                <div key={group.kind}>
                                    <button
                                        type="button"
                                        onClick={() => setCollapsed((prev) => ({ ...prev, [group.kind]: !prev[group.kind] }))}
                                        className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100"
                                    >
                                        <ChevronRight className={cn("size-3.5 transition-transform", !isCollapsed && "rotate-90")} />
                                        <group.icon className="size-3.5" />
                                        <span>{t(group.label)}</span>
                                        <span className="opacity-50">{group.items.length}</span>
                                    </button>
                                    {isCollapsed ? null : (
                                        <div className="grid grid-cols-2 gap-2 px-1 pb-2 pt-1">
                                            {group.items.map((asset) => (
                                                <AssetCard key={asset.id} asset={asset} theme={theme} onInsert={() => onInsert(buildInsertPayload(asset))} onRemove={() => (removeAsset(asset.id), message.success(t("资产已移除")))} />
                                            ))}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                ) : (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无资产")} className="pt-16" />
                )}
            </div>
        </div>
    );
});

function AssetCard({ asset, theme, onInsert, onRemove }: { asset: Asset; theme: CanvasTheme; onInsert: () => void; onRemove: () => void }) {
    const { t } = useAppTranslation();
    return (
        <div className="group relative aspect-square overflow-hidden rounded-xl border transition duration-200 hover:-translate-y-0.5 hover:shadow-lg" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <AssetCover asset={asset} />
            <div className="absolute inset-0 flex items-center justify-center gap-2.5 opacity-0 transition duration-200 group-hover:opacity-100">
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-stone-900 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80"
                    aria-label={t("插入画布")}
                >
                    <Plus className="size-4" />
                </button>
                <Popconfirm title={t("移除该资产?")} okText={t("移除")} cancelText={t("取消")} okButtonProps={{ danger: true }} onConfirm={onRemove}>
                    <button
                        type="button"
                        className="grid size-8 place-items-center rounded-full bg-white/90 text-stone-700 shadow-sm backdrop-blur transition hover:bg-white hover:text-red-500 dark:bg-black/60 dark:text-stone-100 dark:hover:bg-black/80 dark:hover:text-red-400"
                        aria-label={t("移除资产")}
                    >
                        <Trash2 className="size-4" />
                    </button>
                </Popconfirm>
            </div>
        </div>
    );
}

function AssetCover({ asset }: { asset: Asset }) {
    if (asset.kind === "text") return <div className="size-full overflow-hidden whitespace-pre-wrap break-words p-2.5 text-[11px] leading-snug opacity-80">{asset.data.content}</div>;
    if (asset.kind === "video") {
        if (asset.coverUrl) return <img src={asset.coverUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
        return <video src={`${asset.data.url}#t=0.1`} muted playsInline preload="metadata" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
    }
    if (asset.kind === "audio")
        return (
            <div className="grid size-full place-items-center bg-stone-100 dark:bg-stone-900">
                <Music2 className="size-8 opacity-45" />
            </div>
        );
    if (asset.kind === "file")
        return (
            <div className="flex size-full flex-col items-center justify-center gap-2 bg-stone-100 p-3 text-center dark:bg-stone-900">
                <File className="size-8 opacity-45" />
                <span className="line-clamp-2 break-all text-[11px] opacity-70">{asset.data.fileName}</span>
            </div>
        );
    if (isStructuredAsset(asset)) {
        const image = asset.coverUrl || asset.data.images[0]?.dataUrl;
        return image ? <img src={image} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" /> : <div className="flex size-full items-center justify-center text-xs opacity-60">{asset.kind === "character" ? "人物" : "场景"}</div>;
    }
    return <img src={asset.coverUrl || asset.data.dataUrl} alt="" className="size-full object-cover transition duration-300 group-hover:scale-[1.04]" />;
}

// ---------------------------------------------------------------------------
// 提示词库 Tab —— 按来源折叠分组,展开时按需加载,点击复制 / 插入文本节点
// ---------------------------------------------------------------------------

const CanvasPromptsTab = memo(function CanvasPromptsTab({ onInsert, theme }: { onInsert: (payload: InsertAssetPayload) => void; theme: CanvasTheme }) {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const sources = usePromptSourceStore((state) => state.sources);
    const enabledSources = useMemo(() => sources.filter((source) => source.enabled), [sources]);
    const [keyword, setKeyword] = useState("");
    const [expanded, setExpanded] = useState<Record<string, boolean>>({});
    const [detail, setDetail] = useState<Prompt | null>(null);

    const copyPrompt = async (prompt: string) => {
        try {
            await navigator.clipboard.writeText(prompt);
            message.success(t("已复制提示词"));
        } catch {
            message.error(t("复制失败"));
        }
    };

    return (
        <div className="flex h-full flex-col">
            <div className="px-3 pb-2.5 pt-1">
                <Input size="small" allowClear prefix={<Search className="size-3.5 text-stone-400" />} placeholder={t("搜索提示词")} value={keyword} onChange={(e) => setKeyword(e.target.value)} />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
                <div className="space-y-1">
                    {enabledSources.length ? (
                        enabledSources.map((source) => (
                            <PromptSourceGroup
                                key={source.id}
                                sourceId={source.id}
                                sourceName={source.name}
                                keyword={keyword}
                                open={!!expanded[source.id]}
                                theme={theme}
                                onToggle={() => setExpanded((prev) => ({ ...prev, [source.id]: !prev[source.id] }))}
                                onInsert={onInsert}
                                onView={setDetail}
                            />
                        ))
                    ) : (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("暂无提示词")} className="pt-12" />
                    )}
                </div>
            </div>
            <PromptDetailDialog prompt={detail} onClose={() => setDetail(null)} onCopy={(prompt) => void copyPrompt(prompt)} />
        </div>
    );
});

function PromptSourceGroup({
    sourceId,
    sourceName,
    keyword,
    open,
    theme,
    onToggle,
    onInsert,
    onView,
}: {
    sourceId: string;
    sourceName: string;
    keyword: string;
    open: boolean;
    theme: CanvasTheme;
    onToggle: () => void;
    onInsert: (payload: InsertAssetPayload) => void;
    onView: (prompt: Prompt) => void;
}) {
    const { t } = useAppTranslation();
    // 展开过一次即缓存,避免收起后重复请求;搜索命中时也需要拿到数据来计数。
    const showResults = open || !!keyword.trim();
    const query = useQuery({ queryKey: ["side-panel-prompts", sourceId], queryFn: () => fetchSourcePrompts(sourceId), enabled: showResults, staleTime: 1000 * 60 * 60 });

    const filtered = useMemo(() => {
        const items = query.data || [];
        const q = keyword.trim().toLowerCase();
        if (!q) return items;
        return items.filter((item) => [item.title, item.prompt, ...item.tags].join(" ").toLowerCase().includes(q));
    }, [query.data, keyword]);

    const insertPrompt = (item: Prompt) => onInsert({ kind: "text", content: item.prompt, title: item.title });

    return (
        <div>
            <button type="button" onClick={onToggle} className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1.5 text-left text-xs font-semibold opacity-75 transition hover:opacity-100">
                <ChevronRight className={cn("size-3.5 transition-transform", showResults && "rotate-90")} />
                <BookOpen className="size-3.5" />
                <span className="min-w-0 flex-1 truncate">{sourceName}</span>
                {showResults && query.isSuccess ? <span className="opacity-50">{filtered.length}</span> : null}
            </button>
            {showResults ? (
                <div className="px-1 pb-2 pt-1">
                    {query.isLoading ? (
                        <div className="flex justify-center py-6">
                            <Spin size="small" />
                        </div>
                    ) : query.isError ? (
                        <button type="button" onClick={() => void query.refetch()} className="block w-full py-4 text-center text-xs text-red-500 opacity-80 transition hover:opacity-100">
                            {t("加载失败,点击重试")}
                        </button>
                    ) : filtered.length ? (
                        <div className="space-y-1.5">
                            {filtered.map((item) => (
                                <PromptRow key={item.id} item={item} theme={theme} onInsert={() => insertPrompt(item)} onView={() => onView(item)} />
                            ))}
                        </div>
                    ) : (
                        <div className="py-4 text-center text-xs opacity-40">{t(keyword.trim() ? "无匹配提示词" : "该来源暂无提示词")}</div>
                    )}
                </div>
            ) : null}
        </div>
    );
}

function PromptRow({ item, theme, onInsert, onView }: { item: Prompt; theme: CanvasTheme; onInsert: () => void; onView: () => void }) {
    const { t } = useAppTranslation();
    return (
        <div className="group relative flex items-center gap-2.5 rounded-lg px-2 py-2 transition hover:bg-black/5 dark:hover:bg-white/5">
            {item.coverUrl ? (
                <img src={item.coverUrl} alt="" className="size-10 shrink-0 rounded-md object-cover" loading="lazy" />
            ) : (
                <span className="grid size-10 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    <FileText className="size-4 opacity-50" />
                </span>
            )}
            <button type="button" onClick={onView} className="min-w-0 flex-1 text-left">
                <div className="truncate text-sm font-medium leading-snug">{item.title}</div>
                <div className="mt-0.5 truncate text-xs leading-snug opacity-50">{item.prompt}</div>
            </button>
            <div className="flex shrink-0 flex-col items-center gap-0.5">
                <button type="button" onClick={onView} className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10" aria-label={t("查看详情")} title={t("查看详情")}>
                    <Eye className="size-3.5" />
                </button>
                <button
                    type="button"
                    onClick={onInsert}
                    className="grid size-6 place-items-center rounded-md opacity-60 transition hover:bg-black/10 hover:opacity-100 dark:hover:bg-white/10"
                    style={{ color: theme.toolbar.activeText }}
                    aria-label={t("插入画布")}
                    title={t("插入画布")}
                >
                    <Plus className="size-3.5" />
                </button>
            </div>
        </div>
    );
}
