import { useState, type ComponentType, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Check, CircleAlert, Download, FileText, FolderPlus, Image as ImageIcon, LayoutGrid, LoaderCircle, MoreHorizontal, Music2, Pencil, RefreshCw, Trash2, Video, Zap } from "lucide-react";
import { Dropdown, type MenuProps } from "antd";

import { canvasThemes } from "@/lib/canvas-theme";
import { resolveCanvasResultSlotLayout } from "@/lib/canvas/canvas-result-slot-layout";
import { getCurrentResultSlotVersion, type CanvasResultSlotNode } from "@/lib/canvas/canvas-result-slots";
import { useThemeStore } from "@/stores/use-theme-store";
import type { CanvasGenerationMode, CanvasResultSlotArtifact, CanvasResultSlotState, CanvasResultSlotSuccessVersion, CanvasResultSlotVersion } from "@/types/canvas";

export type CanvasResultSlotContentProps = {
    node: CanvasResultSlotNode;
    className?: string;
    /** Uses the live workflow ledger when provided; otherwise review slots pause whenever a result becomes ready. */
    awaitingReview?: boolean;
    /** Selects one successful historical generation as the result used downstream. */
    onSelectVersion?: (versionId: string) => void;
    /** Selects one item when a single generation returned multiple candidates. */
    onSelectArtifact?: (versionId: string, artifactId: string) => void;
    onDeleteArtifact?: (versionId: string, artifactId: string) => void;
    onDeleteVersion?: (versionId: string) => void;
    onRegenerate?: () => void;
    onContinue?: (versionId: string) => void;
    onAdvanceModeChange?: (mode: CanvasResultSlotNode["metadata"]["advanceMode"]) => void;
    onDownload?: () => void;
    onSaveAsset?: () => void;
    onLayoutColumnsChange?: (columns?: number) => void;
    /** Saves an edited text as a new slot version without calling the model. */
    onEditText?: (text: string) => void;
};

const SLOT_COPY: Record<CanvasResultSlotState, { label: string; detail: string }> = {
    empty: { label: "等待生成", detail: "运行上一步后，结果会显示在这里" },
    waiting: { label: "等待上一步", detail: "上一步完成后会自动开始" },
    running: { label: "正在生成", detail: "完成后会保留在当前结果槽" },
    persisting: { label: "正在保存", detail: "保存完成后即可继续" },
    ready: { label: "已就绪", detail: "" },
    error: { label: "生成失败", detail: "这次没有生成成功，可以重新生成" },
    stale: { label: "上游已更新", detail: "重新生成即可使用最新内容" },
};

const MODE_COPY: Record<CanvasGenerationMode, string> = {
    text: "文本",
    image: "图片",
    video: "视频",
    audio: "音频",
};

const MODE_ICON: Record<CanvasGenerationMode, ComponentType<{ className?: string }>> = {
    text: FileText,
    image: ImageIcon,
    video: Video,
    audio: Music2,
};

/** Compact, canvas-native result preview with durable versions and review actions. */
export function CanvasResultSlotContent({ node, className, awaitingReview, onSelectVersion, onSelectArtifact, onDeleteArtifact, onDeleteVersion, onRegenerate, onContinue, onAdvanceModeChange, onDownload, onSaveAsset, onLayoutColumnsChange, onEditText }: CanvasResultSlotContentProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const { advanceMode, resultSlotMode: mode, resultVersions: versions, slotState } = node.metadata;
    const current = getCurrentResultSlotVersion(node);
    const successfulVersions = versions.filter((version): version is CanvasResultSlotSuccessVersion => version.status === "success");
    const currentSuccessIndex = current ? successfulVersions.findIndex((version) => version.id === current.id) : -1;
    const busy = slotState === "running" || slotState === "persisting";
    const currentPrimary = current?.artifacts.find((artifact) => artifact.id === current.primaryArtifactId);
    const [editingText, setEditingText] = useState<string | null>(null);
    const canEditText = mode === "text" && Boolean(current) && !busy && Boolean(onEditText);
    const liveArtifact: CanvasResultSlotArtifact | undefined =
        busy && node.metadata.content && node.metadata.content !== currentPrimary?.content
            ? {
                  id: `${node.id}-live`,
                  kind: mode,
                  content: node.metadata.content,
                  title: node.title,
                  storageKey: node.metadata.storageKey,
                  mimeType: node.metadata.mimeType,
                  bytes: node.metadata.bytes,
                  naturalWidth: node.metadata.naturalWidth,
                  naturalHeight: node.metadata.naturalHeight,
                  durationMs: node.metadata.durationMs,
              }
            : undefined;
    const waitingForReview = awaitingReview ?? (slotState === "ready" && advanceMode === "review");
    const statusCopy = waitingForReview ? { label: "待确认", detail: "" } : SLOT_COPY[slotState];
    const StatusIcon = statusIcon(slotState, mode);
    const layout = resolveCanvasResultSlotLayout(node);
    const layoutItems: MenuProps["items"] = layout && layout.artifactCount > 1
        ? [
              { key: "auto", label: "自动布局", icon: node.metadata.resultSlotLayoutColumns === undefined ? <Check className="size-3.5" /> : undefined },
              { type: "divider" },
              ...Array.from({ length: Math.min(4, layout.artifactCount) }, (_, index) => {
                  const columns = index + 1;
                  const rows = Math.ceil(layout.artifactCount / columns);
                  return { key: `columns-${columns}`, label: `${rows} 行 × ${columns} 列`, icon: node.metadata.resultSlotLayoutColumns === columns ? <Check className="size-3.5" /> : undefined };
              }),
          ]
        : [];

    return (
        <section className={`flex h-full w-full min-h-0 flex-col overflow-hidden rounded-[inherit] ${className || ""}`} style={{ background: theme.node.panel, color: theme.node.text }} aria-label={`${MODE_COPY[mode]}结果槽`}>
            <header className="flex h-9 shrink-0 items-center gap-2 border-b px-3" style={{ borderColor: theme.node.stroke }}>
                <StatusIcon className={`size-3.5 shrink-0 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
                <span className="min-w-0 truncate text-[11px] font-medium" aria-live="polite">
                    {statusCopy.label}
                </span>
                <div className="ml-auto flex shrink-0 items-center gap-1.5">
                    {canEditText ? (
                        <button
                            type="button"
                            className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10"
                            style={{ color: theme.node.muted }}
                            title="编辑文字"
                            aria-label="编辑文字"
                            onMouseDown={stopMousePropagation}
                            onPointerDown={stopPointerPropagation}
                            onClick={(event) => {
                                event.stopPropagation();
                                setEditingText(currentPrimary?.content ?? current?.artifacts[0]?.content ?? "");
                            }}
                        >
                            <Pencil className="size-3" />
                        </button>
                    ) : null}
                    {layoutItems.length && onLayoutColumnsChange ? (
                        <Dropdown
                            trigger={["click"]}
                            placement="bottomRight"
                            menu={{
                                items: layoutItems,
                                onClick: ({ key, domEvent }) => {
                                    domEvent.stopPropagation();
                                    onLayoutColumnsChange(key === "auto" ? undefined : Number(key.replace("columns-", "")));
                                },
                            }}
                        >
                            <button
                                type="button"
                                className="inline-flex h-6 items-center gap-1 rounded-md px-1.5 text-[10px] transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10"
                                style={{ color: theme.node.muted }}
                                title="调整结果排列"
                                aria-label={`结果排列：${layout?.rows || 1} 行 ${layout?.columns || 1} 列`}
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={stopMousePropagation}
                            >
                                <LayoutGrid className="size-3" />
                                {layout?.rows || 1}×{layout?.columns || 1}
                            </button>
                        </Dropdown>
                    ) : null}
                    {current ? (
                        <span className="text-[10px] tabular-nums" style={{ color: theme.node.muted }}>
                            第 {Math.max(1, currentSuccessIndex + 1)}/{successfulVersions.length} 版
                        </span>
                    ) : null}
                </div>
            </header>

            <div className="min-h-0 flex-1">
                {editingText !== null ? (
                    <div className="flex h-full min-h-0 flex-col p-2">
                        <textarea
                            className="thin-scrollbar min-h-0 flex-1 resize-none rounded-md border bg-transparent p-2 font-mono text-xs leading-5 focus-visible:outline-none focus-visible:ring-2"
                            style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                            value={editingText}
                            autoFocus
                            onChange={(event) => setEditingText(event.target.value)}
                            onMouseDown={stopMousePropagation}
                            onPointerDown={stopPointerPropagation}
                            onWheel={stopWheelPropagation}
                        />
                        <div className="mt-2 flex shrink-0 items-center justify-end gap-1.5">
                            <button
                                type="button"
                                className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-[11px] font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10 disabled:opacity-45"
                                style={{ color: theme.node.text }}
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    setEditingText(null);
                                }}
                            >
                                取消
                            </button>
                            <button
                                type="button"
                                className="inline-flex h-7 shrink-0 items-center justify-center rounded-md px-2.5 text-[11px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-45"
                                style={{ background: theme.node.activeStroke, color: theme.canvas.background }}
                                disabled={!editingText.trim()}
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onEditText?.(editingText);
                                    setEditingText(null);
                                }}
                            >
                                保存为新版本
                            </button>
                        </div>
                    </div>
                ) : liveArtifact ? (
                    <ArtifactPreview artifact={liveArtifact} theme={theme} />
                ) : current ? (
                    <ResultPreview version={current} columns={layout?.columns || 1} rows={layout?.rows || 1} theme={theme} onSelectArtifact={onSelectArtifact} onDeleteArtifact={onDeleteArtifact} />
                ) : (
                    <EmptySlot mode={mode} state={slotState} label={statusCopy.label} detail={statusCopy.detail} theme={theme} />
                )}
            </div>

            {versions.length > 1 || versions.some((version) => version.status === "error") ? (
                <VersionRail versions={versions} currentVersionId={current?.id} disabled={busy} theme={theme} onSelectVersion={onSelectVersion} onDeleteVersion={onDeleteVersion} />
            ) : null}

            <ResultActions
                current={current}
                slotState={slotState}
                advanceMode={advanceMode}
                awaitingReview={waitingForReview}
                showSingleVersionDelete={versions.length === 1 && Boolean(onDeleteVersion)}
                theme={theme}
                onDeleteVersion={onDeleteVersion}
                onRegenerate={onRegenerate}
                onContinue={onContinue}
                onAdvanceModeChange={onAdvanceModeChange}
                onDownload={onDownload}
                onSaveAsset={onSaveAsset}
            />
        </section>
    );
}

function ResultPreview({
    version,
    columns,
    rows,
    theme,
    onSelectArtifact,
    onDeleteArtifact,
}: {
    version: CanvasResultSlotSuccessVersion;
    columns: number;
    rows: number;
    theme: CanvasTheme;
    onSelectArtifact?: CanvasResultSlotContentProps["onSelectArtifact"];
    onDeleteArtifact?: CanvasResultSlotContentProps["onDeleteArtifact"];
}) {
    if (version.artifacts.length === 1) {
        return <ArtifactPreview artifact={version.artifacts[0]} theme={theme} />;
    }

    return (
        <div
            className="grid h-full min-h-0 gap-2 overflow-hidden p-2"
            style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`, gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))` }}
            onWheel={stopWheelPropagation}
        >
            {version.artifacts.map((artifact, index) => {
                const selected = artifact.id === version.primaryArtifactId;
                const content = <ArtifactPreview artifact={artifact} compact theme={theme} />;
                return (
                    <div key={artifact.id} className="group relative min-h-0 min-w-0 overflow-hidden rounded-lg border" style={{ borderColor: selected ? theme.node.activeStroke : theme.node.stroke }}>
                        {onSelectArtifact ? (
                            <button
                                type="button"
                                className="h-full w-full text-left focus-visible:outline-none focus-visible:ring-2"
                                style={{ color: theme.node.text }}
                                aria-label={`采用候选 ${index + 1}`}
                                aria-pressed={selected}
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSelectArtifact(version.id, artifact.id);
                                }}
                            >
                                {content}
                            </button>
                        ) : (
                            content
                        )}
                        {selected ? <SelectedMark theme={theme} /> : null}
                        {onDeleteArtifact ? (
                            <button
                                type="button"
                                className={`absolute bottom-1.5 right-1.5 z-10 grid size-6 place-items-center rounded-md bg-black/55 text-white transition hover:bg-black/75 focus-visible:opacity-100 ${selected ? "opacity-100" : "opacity-0 group-hover:opacity-100"}`}
                                aria-label={`删除候选 ${index + 1}`}
                                title="删除这个结果"
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteArtifact(version.id, artifact.id);
                                }}
                            >
                                <Trash2 className="size-3.5" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

function ArtifactPreview({ artifact, theme, compact = false }: { artifact: CanvasResultSlotArtifact; theme: CanvasTheme; compact?: boolean }) {
    if (artifact.kind === "image") {
        return <img src={artifact.content} alt={artifact.title || "生成的图片"} className="h-full w-full object-contain" draggable={false} />;
    }
    if (artifact.kind === "video") {
        return (
            <video
                src={artifact.content}
                aria-label={artifact.title || "生成的视频"}
                className="h-full w-full object-contain"
                controls={!compact}
                muted={compact}
                playsInline
                preload="metadata"
                onMouseDown={stopMousePropagation}
                onPointerDown={stopPointerPropagation}
            />
        );
    }
    if (artifact.kind === "audio") {
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-3" style={{ color: theme.node.muted }}>
                <Music2 className={compact ? "size-5" : "size-8"} />
                {compact ? (
                    <span className="max-w-full truncate text-[10px]">{artifact.title || "音频"}</span>
                ) : (
                    <audio src={artifact.content} className="h-8 w-full" controls preload="metadata" onMouseDown={stopMousePropagation} onPointerDown={stopPointerPropagation} />
                )}
            </div>
        );
    }
    return (
        <div className={`thin-scrollbar h-full w-full overflow-auto whitespace-pre-wrap break-words font-mono ${compact ? "p-2 text-[10px] leading-4" : "p-3 text-xs leading-5"}`} style={{ color: theme.node.text }} onWheel={stopWheelPropagation}>
            {artifact.content}
        </div>
    );
}

function EmptySlot({ mode, state, label, detail, theme }: { mode: CanvasGenerationMode; state: CanvasResultSlotState; label: string; detail: string; theme: CanvasTheme }) {
    const busy = state === "running" || state === "persisting";
    const Icon = statusIcon(state, mode);
    return (
        <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center" style={{ color: busy ? theme.node.activeStroke : theme.node.placeholder }}>
            <Icon className={`size-6 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} />
            <span className="text-xs font-medium">{label}</span>
            {detail ? <span className="text-[10px] leading-4 opacity-75">{detail}</span> : null}
        </div>
    );
}

function VersionRail({
    versions,
    currentVersionId,
    disabled,
    theme,
    onSelectVersion,
    onDeleteVersion,
}: {
    versions: CanvasResultSlotVersion[];
    currentVersionId?: string;
    disabled: boolean;
    theme: CanvasTheme;
    onSelectVersion?: CanvasResultSlotContentProps["onSelectVersion"];
    onDeleteVersion?: CanvasResultSlotContentProps["onDeleteVersion"];
}) {
    return (
        <div className="thin-scrollbar flex h-[54px] shrink-0 gap-1.5 overflow-x-auto border-t px-2 py-1.5" style={{ borderColor: theme.node.stroke }} onWheel={stopWheelPropagation} aria-label="生成版本">
            {versions.map((version, index) => {
                const selected = version.id === currentVersionId;
                return (
                    <div key={version.id} className="group relative h-10 w-[68px] shrink-0 overflow-hidden rounded-md border" style={{ borderColor: selected ? theme.node.activeStroke : theme.node.stroke }}>
                        <button
                            type="button"
                            className="h-full w-full overflow-hidden text-left disabled:cursor-default"
                            disabled={disabled || version.status === "error" || !onSelectVersion}
                            aria-label={version.status === "success" ? `切换到第 ${index + 1} 版` : `第 ${index + 1} 次生成失败`}
                            aria-pressed={selected}
                            onMouseDown={stopMousePropagation}
                            onPointerDown={stopPointerPropagation}
                            onClick={(event) => {
                                event.stopPropagation();
                                if (version.status === "success") onSelectVersion?.(version.id);
                            }}
                        >
                            <VersionThumbnail version={version} theme={theme} />
                        </button>
                        <span className="pointer-events-none absolute bottom-0.5 left-1 rounded-sm px-1 text-[9px] leading-4" style={{ background: `${theme.node.panel}e8`, color: theme.node.text }}>
                            {version.status === "success" ? `第 ${index + 1} 版` : "失败"}
                        </span>
                        {onDeleteVersion ? (
                            <button
                                type="button"
                                className="absolute right-0.5 top-0.5 grid size-5 place-items-center rounded-sm opacity-0 transition hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 dark:hover:bg-white/10 disabled:opacity-40"
                                style={{ background: `${theme.node.panel}e8`, color: theme.node.text }}
                                disabled={disabled}
                                aria-label={`删除第 ${index + 1} 次结果`}
                                title="删除这个版本"
                                onMouseDown={stopMousePropagation}
                                onPointerDown={stopPointerPropagation}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onDeleteVersion(version.id);
                                }}
                            >
                                <Trash2 className="size-3" />
                            </button>
                        ) : null}
                    </div>
                );
            })}
        </div>
    );
}

function VersionThumbnail({ version, theme }: { version: CanvasResultSlotVersion; theme: CanvasTheme }) {
    if (version.status === "error") {
        return (
            <span className="grid h-full w-full place-items-center" style={{ color: theme.node.muted }}>
                <CircleAlert className="size-4" />
            </span>
        );
    }
    const primary = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId) || version.artifacts[0];
    if (!primary) return null;
    if (primary.kind === "image") return <img src={primary.content} alt="" className="h-full w-full object-cover" draggable={false} />;
    if (primary.kind === "video") return <video src={primary.content} className="h-full w-full object-cover" muted playsInline preload="metadata" />;
    if (primary.kind === "audio") return <Music2 className="mx-auto size-4" style={{ color: theme.node.muted }} />;
    return (
        <span className="block h-full overflow-hidden p-1 text-[8px] leading-3" style={{ color: theme.node.muted }}>
            {primary.content}
        </span>
    );
}

function ResultActions({
    current,
    slotState,
    advanceMode,
    awaitingReview,
    showSingleVersionDelete,
    theme,
    onDeleteVersion,
    onRegenerate,
    onContinue,
    onAdvanceModeChange,
    onDownload,
    onSaveAsset,
}: {
    current?: CanvasResultSlotSuccessVersion;
    slotState: CanvasResultSlotState;
    advanceMode: CanvasResultSlotNode["metadata"]["advanceMode"];
    awaitingReview: boolean;
    showSingleVersionDelete: boolean;
    theme: CanvasTheme;
    onDeleteVersion?: CanvasResultSlotContentProps["onDeleteVersion"];
    onRegenerate?: CanvasResultSlotContentProps["onRegenerate"];
    onContinue?: CanvasResultSlotContentProps["onContinue"];
    onAdvanceModeChange?: CanvasResultSlotContentProps["onAdvanceModeChange"];
    onDownload?: CanvasResultSlotContentProps["onDownload"];
    onSaveAsset?: CanvasResultSlotContentProps["onSaveAsset"];
}) {
    const busy = slotState === "running" || slotState === "persisting" || slotState === "waiting";
    const showRegenerate = Boolean(onRegenerate) && (Boolean(current) || slotState === "error" || slotState === "stale");
    const showContinue = Boolean(current && onContinue && advanceMode === "review" && slotState === "ready" && awaitingReview);
    const primaryAction = showContinue ? "continue" : showRegenerate ? "regenerate" : undefined;
    const showDownload = Boolean(current && onDownload);
    const showSaveAsset = Boolean(current && onSaveAsset);
    const secondaryItems: MenuProps["items"] = [];

    if (showContinue && showRegenerate) secondaryItems.push({ key: "regenerate", label: "重新生成", icon: <RefreshCw className="size-3.5" />, disabled: busy });
    if (showSingleVersionDelete && current) secondaryItems.push({ key: "delete", label: "删除当前版本", icon: <Trash2 className="size-3.5" />, danger: true, disabled: busy });
    if (onAdvanceModeChange) {
        if (secondaryItems.length) secondaryItems.push({ type: "divider" });
        secondaryItems.push({
            type: "group",
            label: "后续方式",
            children: [
                { key: "advance-review", label: "每步确认", icon: advanceMode === "review" ? <Check className="size-3.5" /> : undefined, disabled: busy || advanceMode === "review" },
                { key: "advance-auto", label: "自动继续", icon: advanceMode === "auto" ? <Check className="size-3.5" /> : <Zap className="size-3.5" />, disabled: busy || advanceMode === "auto" },
            ],
        });
    }
    if (!primaryAction && !showDownload && !showSaveAsset && !secondaryItems.length) return null;

    const handleSecondaryAction: MenuProps["onClick"] = ({ key, domEvent }) => {
        domEvent.stopPropagation();
        if (key === "regenerate") onRegenerate?.();
        if (key === "delete" && current) onDeleteVersion?.(current.id);
        if (key === "advance-review") onAdvanceModeChange?.("review");
        if (key === "advance-auto") onAdvanceModeChange?.("auto");
    };

    return (
        <footer className="flex h-11 shrink-0 items-center gap-1.5 border-t px-2" style={{ borderColor: theme.node.stroke }}>
            {primaryAction === "continue" && current ? (
                <button
                    type="button"
                    className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 disabled:opacity-45"
                    style={{ background: theme.node.activeStroke, color: theme.canvas.background }}
                    disabled={busy}
                    onMouseDown={stopMousePropagation}
                    onPointerDown={stopPointerPropagation}
                    onClick={(event) => {
                        event.stopPropagation();
                        onContinue?.(current.id);
                    }}
                >
                    <Check className="size-3.5" />
                    <span className="truncate">使用这版并继续</span>
                </button>
            ) : primaryAction === "regenerate" ? (
                <button
                    type="button"
                    className="inline-flex h-8 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-md px-2.5 text-[11px] font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10 disabled:opacity-45"
                    style={{ background: theme.toolbar.activeBg, color: theme.node.text }}
                    disabled={busy}
                    onMouseDown={stopMousePropagation}
                    onPointerDown={stopPointerPropagation}
                    onClick={(event) => {
                        event.stopPropagation();
                        onRegenerate?.();
                    }}
                >
                    <RefreshCw className="size-3.5" />
                    <span className="truncate">重新生成</span>
                </button>
            ) : null}
            {showDownload ? (
                <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10 disabled:opacity-45"
                    style={{ color: theme.node.text }}
                    disabled={busy}
                    onMouseDown={stopMousePropagation}
                    onPointerDown={stopPointerPropagation}
                    onClick={(event) => {
                        event.stopPropagation();
                        onDownload?.();
                    }}
                >
                    <Download className="size-3.5" />
                    <span>下载</span>
                </button>
            ) : null}
            {showSaveAsset ? (
                <button
                    type="button"
                    className="inline-flex h-8 shrink-0 items-center justify-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10 disabled:opacity-45"
                    style={{ color: theme.node.text }}
                    disabled={busy}
                    onMouseDown={stopMousePropagation}
                    onPointerDown={stopPointerPropagation}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSaveAsset?.();
                    }}
                >
                    <FolderPlus className="size-3.5" />
                    <span>存入资产</span>
                </button>
            ) : null}
            {secondaryItems.length ? (
                <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: secondaryItems, onClick: handleSecondaryAction }}>
                    <button
                        type="button"
                        className="grid size-8 shrink-0 place-items-center rounded-md transition-colors hover:bg-black/5 focus-visible:outline-none focus-visible:ring-2 dark:hover:bg-white/10 disabled:opacity-45"
                        style={{ color: theme.node.text }}
                        disabled={busy}
                        aria-label="更多结果操作"
                        title="更多结果操作"
                        onMouseDown={stopMousePropagation}
                        onPointerDown={stopPointerPropagation}
                        onClick={stopMousePropagation}
                    >
                        <MoreHorizontal className="size-4" />
                    </button>
                </Dropdown>
            ) : null}
        </footer>
    );
}

function SelectedMark({ theme }: { theme: CanvasTheme }) {
    return (
        <span className="pointer-events-none absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full" style={{ background: theme.node.activeStroke, color: theme.canvas.background }}>
            <Check className="size-3" />
        </span>
    );
}

function statusIcon(state: CanvasResultSlotState, mode: CanvasGenerationMode) {
    if (state === "running" || state === "persisting") return LoaderCircle;
    if (state === "error" || state === "stale") return CircleAlert;
    if (state === "ready") return Check;
    return MODE_ICON[mode];
}

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

function stopMousePropagation(event: ReactMouseEvent) {
    event.stopPropagation();
}

function stopPointerPropagation(event: ReactPointerEvent) {
    event.stopPropagation();
}

function stopWheelPropagation(event: ReactWheelEvent) {
    event.stopPropagation();
}
