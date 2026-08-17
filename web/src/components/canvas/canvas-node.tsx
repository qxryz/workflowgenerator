import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { ChevronRight, Group, Image as ImageIcon, Music2, Puzzle, RefreshCw, Settings2, Star, Video } from "lucide-react";
import type { Terminal as XTermInstance } from "@xterm/xterm";
import type { FitAddon as FitAddonInstance } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { nanoid } from "nanoid";

import { canvasThemes } from "@/lib/canvas-theme";
import { formatBytes, readImageMeta } from "@/lib/image-utils";
import { getNodeDefinition } from "@/lib/canvas/node-registry";
import { buildNodeContext } from "@/lib/canvas/plugin-node-context";
import { useThemeStore } from "@/stores/use-theme-store";
import { useSkillStore } from "@/stores/use-skill-store";
import { modelOptionName } from "@/stores/use-config-store";
import { CanvasResourceMentionTextarea } from "./canvas-resource-mention-textarea";
import { CanvasNodeType, type CanvasGenerationMode, type CanvasNodeData, type CanvasTerminalArtifact, type Position } from "@/types/canvas";
import type { CanvasNodeContext, CanvasPluginHost } from "@/types/canvas-plugin";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { importTerminalOutputFile, listenToTerminalArtifact, listenToTerminalOutput, prepareTerminalInputs, resizeTerminalSession, startTerminalSession, stopTerminalSession, writeTerminalInput, type TerminalImportedMedia } from "@/services/terminal";
import { readAudioMeta, readVideoMeta } from "@/services/file-storage";

type ResizeCorner = "top-left" | "top-right" | "bottom-left" | "bottom-right";
const selectionBlue = "#2f80ff";

type CanvasNodeProps = {
    data: CanvasNodeData;
    scale: number;
    isViewportVisible?: boolean;
    isSelected: boolean;
    isRelated: boolean;
    isFocusRelated: boolean;
    isConnectionTarget: boolean;
    isConnecting: boolean;
    editRequestNonce?: number;
    showPanel: boolean;
    showImageInfo: boolean;
    mentionReferences?: CanvasResourceReference[];
    pluginHost?: CanvasPluginHost;
    registryVersion?: number;
    renderPanel?: (node: CanvasNodeData) => ReactNode;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    batchCount?: number;
    groupChildCount?: number;
    isGroupDropTarget?: boolean;
    batchExpanded?: boolean;
    batchClosing?: boolean;
    batchOpening?: boolean;
    batchRecovering?: boolean;
    batchMotion?: { x: number; y: number; index: number };
    onMouseDown: (event: React.MouseEvent, nodeId: string) => void;
    onSelectCapture?: (event: React.MouseEvent, nodeId: string) => void;
    onHoverStart: (nodeId: string) => void;
    onHoverEnd: (nodeId: string) => void;
    onConnectStart: (event: React.MouseEvent, nodeId: string, handleType: "source" | "target") => void;
    onResize: (nodeId: string, width: number, height: number, position?: Position) => void;
    onContentChange: (nodeId: string, content: string) => void;
    onMetadataChange?: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onTerminalArtifact?: (nodeId: string, artifact: CanvasTerminalArtifact) => void;
    onTitleChange: (nodeId: string, title: string) => void;
    onToggleBatch?: (nodeId: string) => void;
    onSetBatchPrimary?: (node: CanvasNodeData) => void;
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onViewImage?: (node: CanvasNodeData) => void;
    onContextMenu: (event: React.MouseEvent, nodeId: string) => void;
};

type NodeContentRendererProps = {
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    isViewportVisible: boolean;
    isEditingContent: boolean;
    textareaRef: React.RefObject<HTMLTextAreaElement | null>;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    renderNodeContent?: (node: CanvasNodeData) => ReactNode;
    pluginContext?: CanvasNodeContext | null;
    onContentChange: (nodeId: string, content: string) => void;
    onMetadataChange?: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void;
    onTerminalArtifact?: (nodeId: string, artifact: CanvasTerminalArtifact) => void;
    onStopEditing: () => void;
    mentionReferences: CanvasResourceReference[];
    onRetry?: (node: CanvasNodeData) => void;
    onGenerateImage?: (node: CanvasNodeData) => void;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
    groupChildCount: number;
};

export const CanvasNode = React.memo(function CanvasNode({
    data,
    scale,
    isViewportVisible = true,
    isSelected,
    isRelated,
    isFocusRelated,
    isConnectionTarget,
    isConnecting,
    editRequestNonce = 0,
    showPanel,
    showImageInfo,
    mentionReferences = [],
    pluginHost,
    renderPanel,
    renderNodeContent,
    batchCount = 0,
    groupChildCount = 0,
    isGroupDropTarget = false,
    batchExpanded = false,
    batchClosing = false,
    batchOpening = false,
    batchRecovering = false,
    batchMotion,
    onMouseDown,
    onSelectCapture,
    onHoverStart,
    onHoverEnd,
    onConnectStart,
    onResize,
    onContentChange,
    onMetadataChange,
    onTerminalArtifact,
    onTitleChange,
    onToggleBatch,
    onSetBatchPrimary,
    onRetry,
    onGenerateImage,
    onViewImage,
    onContextMenu,
}: CanvasNodeProps) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [hovered, setHovered] = useState(false);
    const definition = getNodeDefinition(data.type);
    const pluginContext = useMemo<CanvasNodeContext | null>(() => (pluginHost ? buildNodeContext(pluginHost, data, theme, scale, isSelected) : null), [pluginHost, data, theme, scale, isSelected]);
    const [isEditingContent, setIsEditingContent] = useState(false);
    const [isEditingTitle, setIsEditingTitle] = useState(false);
    const [titleDraft, setTitleDraft] = useState(data.title || "");
    const hasImageContent = data.type === CanvasNodeType.Image && Boolean(data.metadata?.content);
    const hasVideoContent = data.type === CanvasNodeType.Video && Boolean(data.metadata?.content);
    const hasAudioContent = data.type === CanvasNodeType.Audio && Boolean(data.metadata?.content);
    const isResultSlot = data.metadata?.role === "result-slot";
    const isGroup = data.type === CanvasNodeType.Group;
    const isBatchRoot = !isResultSlot && data.type === CanvasNodeType.Image && Boolean(data.metadata?.isBatchRoot) && batchCount > 1;
    // 支持「交互/移动」开关的节点:移动态(默认)内容不吃指针,拖动整块;交互态内容可操作。
    // forceInteractive(如编辑态)强制可交互;空态(无内容)始终可交互,避免上传/生成按钮点不动。
    const supportsInteractionToggle = Boolean(definition?.interactionToggle);
    const forceInteractive = supportsInteractionToggle ? Boolean(definition?.forceInteractive?.(data)) : false;
    const contentInteractive = isResultSlot || !supportsInteractionToggle || forceInteractive || !data.metadata?.content ? true : Boolean(data.metadata?.interactive);
    const isBatchChild = data.type === CanvasNodeType.Image && Boolean(data.metadata?.batchRootId);
    // 透明背景节点(如 SVG):卡片背景/边框透明,直接融入画布;选中/关联态仍显示描边以便定位
    const transparentBg = Boolean(definition?.transparentBackground);
    const isActive = isConnectionTarget || isSelected || isFocusRelated;
    const imageBorderColor = isActive ? selectionBlue : isRelated && !isBatchChild ? theme.node.muted : "transparent";
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const titleInputRef = useRef<HTMLInputElement>(null);
    const resizeRef = useRef({
        isResizing: false,
        corner: "bottom-right" as ResizeCorner,
        startX: 0,
        startY: 0,
        startLeft: 0,
        startTop: 0,
        startWidth: 0,
        startHeight: 0,
        keepRatio: false,
        ratio: 1,
    });

    useEffect(() => {
        setTitleDraft(data.title || "");
    }, [data.title]);

    useEffect(() => {
        if (!isEditingTitle) return;
        titleInputRef.current?.focus();
        titleInputRef.current?.select();
    }, [isEditingTitle]);

    const finishTitleEditing = useCallback(() => {
        const title = titleDraft.trim() || data.title || "未命名节点";
        setTitleDraft(title);
        setIsEditingTitle(false);
        if (title !== data.title) onTitleChange(data.id, title);
    }, [data.id, data.title, onTitleChange, titleDraft]);

    useEffect(() => {
        if (!isEditingTitle) return;
        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (target instanceof Node && titleInputRef.current?.contains(target)) return;
            finishTitleEditing();
        };
        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [finishTitleEditing, isEditingTitle]);

    useEffect(() => {
        const textarea = textareaRef.current;
        if (!textarea) return;

        const handleWheel = (event: WheelEvent) => event.stopPropagation();
        textarea.addEventListener("wheel", handleWheel, { passive: false });
        return () => textarea.removeEventListener("wheel", handleWheel);
    }, [data.type, isEditingContent]);

    useEffect(() => {
        if (!isEditingContent) return;
        const textarea = textareaRef.current;
        textarea?.focus();
        textarea?.setSelectionRange(textarea.value.length, textarea.value.length);
    }, [isEditingContent]);

    useEffect(() => {
        if (!editRequestNonce || data.type !== CanvasNodeType.Text) return;
        setIsEditingContent(true);
    }, [data.type, editRequestNonce]);

    useEffect(() => {
        if (!isEditingContent) return;

        const handleOutsidePointerDown = (event: PointerEvent) => {
            const target = event.target;
            if (!(target instanceof Node)) return;
            if (isEditingContent && textareaRef.current?.contains(target)) return;

            setIsEditingContent(false);
        };

        window.addEventListener("pointerdown", handleOutsidePointerDown, true);
        return () => window.removeEventListener("pointerdown", handleOutsidePointerDown, true);
    }, [isEditingContent]);

    const handleResizeMove = useCallback(
        (event: MouseEvent) => {
            if (!resizeRef.current.isResizing) return;

            const dx = (event.clientX - resizeRef.current.startX) / scale;
            const dy = (event.clientY - resizeRef.current.startY) / scale;
            const minWidth = 220;
            const minHeight = isResultSlot && data.type === CanvasNodeType.Audio ? 180 : 160;
            const startRight = resizeRef.current.startLeft + resizeRef.current.startWidth;
            const startBottom = resizeRef.current.startTop + resizeRef.current.startHeight;
            const fromLeft = resizeRef.current.corner.includes("left");
            const fromTop = resizeRef.current.corner.includes("top");
            const rawWidth = Math.max(minWidth, resizeRef.current.startWidth + (fromLeft ? -dx : dx));
            const rawHeight = Math.max(minHeight, resizeRef.current.startHeight + (fromTop ? -dy : dy));
            let width = rawWidth;
            let height = rawHeight;
            if (resizeRef.current.keepRatio) {
                const ratio = resizeRef.current.ratio;
                if (Math.abs(dx) >= Math.abs(dy)) {
                    height = width / ratio;
                } else {
                    width = height * ratio;
                }
                if (height < minHeight) {
                    height = minHeight;
                    width = height * ratio;
                }
                if (width < minWidth) {
                    width = minWidth;
                    height = width / ratio;
                }
            }

            onResize(data.id, width, height, {
                x: fromLeft ? startRight - width : resizeRef.current.startLeft,
                y: fromTop ? startBottom - height : resizeRef.current.startTop,
            });
        },
        [data.id, data.type, isResultSlot, onResize, scale],
    );

    const handleResizeUp = useCallback(() => {
        resizeRef.current.isResizing = false;
        window.removeEventListener("mousemove", handleResizeMove);
        window.removeEventListener("mouseup", handleResizeUp);
    }, [handleResizeMove]);

    const handleResizeMouseDown = (event: React.MouseEvent, corner: ResizeCorner) => {
        event.stopPropagation();
        event.preventDefault();
        resizeRef.current = {
            isResizing: true,
            corner,
            startX: event.clientX,
            startY: event.clientY,
            startLeft: data.position.x,
            startTop: data.position.y,
            startWidth: data.width,
            startHeight: data.height,
            keepRatio: (data.type === CanvasNodeType.Image && !data.metadata?.freeResize) || data.type === CanvasNodeType.Video || Boolean(definition?.keepAspectRatio?.(data)),
            ratio: (data.metadata?.naturalWidth || data.width) / (data.metadata?.naturalHeight || data.height || 1),
        };
        window.addEventListener("mousemove", handleResizeMove);
        window.addEventListener("mouseup", handleResizeUp);
    };

    useEffect(() => {
        return () => {
            window.removeEventListener("mousemove", handleResizeMove);
            window.removeEventListener("mouseup", handleResizeUp);
        };
    }, [handleResizeMove, handleResizeUp]);

    return (
        <div
            data-node-id={data.id}
            className={`node-element absolute flex select-none flex-col transition-shadow duration-200 ${isGroup ? "z-[5]" : isSelected ? "z-50" : "z-10"}`}
            style={{
                transform: `translate(${data.position.x}px, ${data.position.y}px)`,
                width: data.width,
                height: data.height,
                transition: "box-shadow 200ms ease",
                contain: "layout style",
            }}
            onMouseEnter={() => {
                setHovered(true);
                onHoverStart(data.id);
            }}
            onMouseLeave={() => {
                setHovered(false);
                onHoverEnd(data.id);
            }}
            onMouseDownCapture={(event) => onSelectCapture?.(event, data.id)}
            onContextMenu={(event) => onContextMenu(event, data.id)}
        >
            {(isSelected || hovered || isEditingTitle) && (
                <div className="absolute left-3 top-[-28px] z-[65] max-w-[calc(100%-24px)]" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                    {isEditingTitle ? (
                        <input
                            ref={titleInputRef}
                            value={titleDraft}
                            maxLength={64}
                            className="h-6 max-w-full border-0 border-b border-dashed bg-transparent px-0 text-left text-xs font-medium outline-none"
                            style={{ borderColor: theme.node.muted, color: theme.node.text }}
                            onChange={(event) => setTitleDraft(event.target.value)}
                            onBlur={finishTitleEditing}
                            onKeyDown={(event) => {
                                if (event.key === "Enter") finishTitleEditing();
                                if (event.key === "Escape") {
                                    setTitleDraft(data.title || "");
                                    setIsEditingTitle(false);
                                }
                            }}
                        />
                    ) : (
                        <button
                            type="button"
                            className="block max-w-full truncate border-b border-dashed border-transparent px-0 py-0.5 text-left text-xs font-medium opacity-75 transition hover:border-current hover:opacity-100"
                            style={{ color: theme.node.text }}
                            title="双击修改节点名称"
                            onDoubleClick={(event) => {
                                event.stopPropagation();
                                setIsEditingTitle(true);
                            }}
                        >
                            {data.title || "未命名节点"}
                        </button>
                    )}
                </div>
            )}

            <div
                className="relative h-full w-full overflow-visible rounded-3xl border-2"
                style={{
                    background: isGroup ? `${theme.toolbar.panel}66` : !isResultSlot && (hasImageContent || hasVideoContent || transparentBg) ? "transparent" : theme.node.fill,
                    borderColor: isGroup
                        ? isGroupDropTarget || isActive
                            ? selectionBlue
                            : theme.node.stroke
                        : !isResultSlot && hasImageContent
                          ? imageBorderColor
                          : isActive
                            ? selectionBlue
                            : isRelated
                              ? theme.node.muted
                              : transparentBg
                                ? "transparent"
                                : theme.node.stroke,
                    borderStyle: isGroup ? "dashed" : "solid",
                    boxShadow: isGroupDropTarget
                        ? `0 0 0 2px ${selectionBlue}66, inset 0 0 0 999px ${selectionBlue}10`
                        : isActive
                          ? `0 0 0 1px ${selectionBlue}55`
                          : isRelated && !isBatchChild
                            ? `0 0 0 1px ${theme.node.muted}55, 0 18px 48px rgba(0,0,0,.14)`
                            : undefined,
                }}
                onMouseDown={(event) => onMouseDown(event, data.id)}
                onDoubleClick={(event) => {
                    if (isBatchRoot) {
                        event.stopPropagation();
                        onToggleBatch?.(data.id);
                        return;
                    }
                    if (definition?.onDoubleClick && pluginContext) {
                        if (definition.onDoubleClick(pluginContext)) event.stopPropagation();
                        return;
                    }
                    if (data.type === CanvasNodeType.Image && hasImageContent) {
                        event.stopPropagation();
                        onViewImage?.(data);
                        return;
                    }
                    if (data.type !== CanvasNodeType.Text) return;
                    event.stopPropagation();
                    setIsEditingContent(true);
                }}
            >
                <div
                    className={`relative flex h-full w-full items-center justify-center rounded-[inherit] ${isBatchRoot ? "overflow-visible" : "overflow-hidden"}`}
                    style={
                        {
                            background: isGroup ? "transparent" : !isResultSlot && (hasImageContent || hasVideoContent || transparentBg) ? "transparent" : theme.node.fill,
                            pointerEvents: contentInteractive ? undefined : "none",
                            "--batch-from-x": `${batchMotion?.x || 0}px`,
                            "--batch-from-y": `${batchMotion?.y || 0}px`,
                            "--batch-from-rotate": `${6 + (batchMotion?.index || 0) * 4}deg`,
                            animation: data.metadata?.batchRootId ? (batchClosing ? "canvas-batch-child-out 260ms cubic-bezier(.4,0,.2,1) both" : "canvas-batch-child-in 340ms cubic-bezier(.2,.85,.18,1) both") : undefined,
                            animationDelay: data.metadata?.batchRootId ? `${batchClosing ? 0 : 45 + (batchMotion?.index || 0) * 24}ms` : undefined,
                        } as React.CSSProperties
                    }
                >
                    <NodeContent
                        node={data}
                        theme={theme}
                        isViewportVisible={isViewportVisible}
                        isEditingContent={isEditingContent}
                        textareaRef={textareaRef}
                        isBatchRoot={isBatchRoot}
                        batchCount={batchCount}
                        batchExpanded={batchExpanded}
                        batchOpening={batchOpening}
                        batchRecovering={batchRecovering}
                        renderNodeContent={renderNodeContent}
                        pluginContext={pluginContext}
                        mentionReferences={mentionReferences}
                        onContentChange={onContentChange}
                        onMetadataChange={onMetadataChange}
                        onTerminalArtifact={onTerminalArtifact}
                        onStopEditing={() => setIsEditingContent(false)}
                        onRetry={onRetry}
                        onGenerateImage={onGenerateImage}
                        onToggleBatch={() => onToggleBatch?.(data.id)}
                        onSetBatchPrimary={() => onSetBatchPrimary?.(data)}
                        groupChildCount={groupChildCount}
                    />
                </div>

                {showImageInfo && hasImageContent ? <ImageInfoBar node={data} /> : null}

                {!isGroup && !isResultSlot && !hasImageContent && !hasVideoContent && !hasAudioContent ? (
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12" style={{ background: `linear-gradient(to top, ${theme.canvas.background}66, transparent)` }} />
                ) : null}

                <ResizeHandle corner="top-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="top-right" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-left" onMouseDown={handleResizeMouseDown} />
                <ResizeHandle corner="bottom-right" onMouseDown={handleResizeMouseDown} />
            </div>

            {!isGroup ? <ConnectionHandleDot side="left" visible={hovered || isSelected || isConnecting} onMouseDown={(event) => onConnectStart(event, data.id, "target")} /> : null}
            {!isGroup ? <ConnectionHandleDot side="right" visible={(definition?.hasSourceHandle ?? true) && (hovered || isSelected || isConnecting)} onMouseDown={(event) => onConnectStart(event, data.id, "source")} /> : null}

            {showPanel && !isGroup && renderPanel ? <div className="absolute left-1/2 top-full z-[70] w-[600px] -translate-x-1/2 pt-4">{renderPanel(data)}</div> : null}
        </div>
    );
});

function NodeContent(props: NodeContentRendererProps) {
    if ((props.node.type === CanvasNodeType.Config || props.node.metadata?.role === "result-slot") && props.renderNodeContent) return props.renderNodeContent(props.node);
    if (props.isBatchRoot) return <ImageNodeContent {...props} />;
    // 终端需要持续保留可编辑界面与完整输出，不能被通用的 loading/error 占位覆盖。
    if (props.node.type !== CanvasNodeType.Terminal && props.node.metadata?.status === "loading" && !props.node.metadata?.content) return <LoadingContent theme={props.theme} />;
    if (props.node.type !== CanvasNodeType.Terminal && props.node.metadata?.status === "error" && !props.node.metadata?.content) return <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />;

    const Renderer = nodeContentRenderers[props.node.type as CanvasNodeType];
    if (Renderer) return <Renderer {...props} />;

    // 插件节点:有注册渲染器则渲染,否则展示缺少插件占位
    const definition = getNodeDefinition(props.node.type);
    if (definition?.Content && props.pluginContext) {
        const PluginContent = definition.Content;
        return <PluginContent ctx={props.pluginContext} />;
    }
    return <MissingPluginContent theme={props.theme} type={props.node.type} />;
}

const nodeContentRenderers = {
    [CanvasNodeType.Text]: TextContent,
    [CanvasNodeType.Image]: ImageNodeContent,
    [CanvasNodeType.Config]: EmptyImageContent,
    [CanvasNodeType.Video]: VideoNodeContent,
    [CanvasNodeType.Audio]: AudioNodeContent,
    [CanvasNodeType.Terminal]: TerminalNodeContent,
    [CanvasNodeType.Group]: GroupNodeContent,
} satisfies Record<CanvasNodeType, (props: NodeContentRendererProps) => ReactNode>;

function GroupNodeContent({ node, theme, groupChildCount }: NodeContentRendererProps) {
    return (
        <div className="pointer-events-none flex h-full w-full flex-col p-4">
            <div className="flex items-center gap-2 text-sm font-semibold" style={{ color: theme.node.text }}>
                <span className="grid size-8 place-items-center rounded-xl" style={{ background: theme.toolbar.activeBg, color: theme.node.muted }}>
                    <Group className="size-4" />
                </span>
                <span>组</span>
                <span className="ml-auto rounded-full px-2 py-1 text-[11px] font-medium" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    {groupChildCount} 个节点
                </span>
            </div>
            <div className="mt-3 flex-1 rounded-2xl border border-dashed" style={{ borderColor: theme.node.stroke, background: `${theme.node.fill}55` }} />
        </div>
    );
}

function LoadingContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.activeStroke }}>
            <div className="size-10 animate-spin rounded-full border-2" style={{ borderColor: theme.node.stroke, borderTopColor: theme.node.activeStroke }} />
            <span className="text-[10px] tracking-[0.2em]">生成中</span>
        </div>
    );
}

function ErrorContent({ node, theme, onRetry }: Pick<NodeContentRendererProps, "node" | "theme" | "onRetry">) {
    return (
        <div className="flex max-w-[260px] flex-col items-center gap-3 px-5 text-center">
            <div className="text-xs leading-5 text-red-300">{node.metadata?.errorDetails || "生成失败"}</div>
            <button
                type="button"
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition hover:scale-[1.02]"
                style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onRetry?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
            >
                <RefreshCw className="size-3.5" />
                重试
            </button>
        </div>
    );
}

function MissingPluginContent({ theme, type }: Pick<NodeContentRendererProps, "theme"> & { type: string }) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center" style={{ color: theme.node.placeholder }}>
            <Puzzle className="size-7 opacity-40" />
            <span className="text-sm">缺少插件</span>
            <span className="text-[11px] opacity-70">节点类型 “{type}” 的插件未安装或未启用</span>
        </div>
    );
}

function TextContent({ node, theme, isEditingContent, textareaRef, mentionReferences, onContentChange, onStopEditing, onGenerateImage }: NodeContentRendererProps) {
    const fontSize = node.metadata?.fontSize || 14;
    const textStyle = { fontSize: `${fontSize}px`, lineHeight: `${Math.round(fontSize * 1.65)}px`, color: theme.node.text, boxSizing: "border-box" } as React.CSSProperties;

    return (
        <div className="flex h-full w-full flex-col overflow-hidden pt-8">
            <button
                type="button"
                className="absolute right-3 top-3 z-20 inline-flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-medium opacity-85 backdrop-blur-md transition hover:scale-[1.02] hover:opacity-100"
                style={{ background: `${theme.toolbar.panel}dd`, borderColor: theme.node.stroke, color: theme.node.text }}
                onClick={(event) => {
                    event.stopPropagation();
                    onGenerateImage?.(node);
                }}
                onMouseDown={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
                title="用文本生图"
                aria-label="用文本生图"
            >
                <ImageIcon className="size-3.5" />
                生图
            </button>
            {isEditingContent ? (
                <CanvasResourceMentionTextarea
                    ref={textareaRef}
                    className="thin-scrollbar block h-full w-full resize-none overflow-y-auto whitespace-pre-wrap break-words border-none bg-transparent pl-4 pr-14 pt-0 pb-4 m-0 font-mono outline-none select-text appearance-none"
                    style={textStyle}
                    value={node.metadata?.content || ""}
                    references={mentionReferences}
                    highlightLabels={false}
                    onChange={(value) => onContentChange(node.id, value)}
                    onBlur={onStopEditing}
                    onKeyDown={(event) => {
                        if (event.key === "Escape") onStopEditing();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                    onWheel={(event) => event.stopPropagation()}
                />
            ) : (
                <div className="thin-scrollbar block h-full w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent pl-4 pr-14 pt-0 pb-4 font-mono" style={textStyle} onWheel={(event) => event.stopPropagation()}>
                    {node.metadata?.content || <span style={{ color: theme.node.placeholder }}>双击编辑文字</span>}
                </div>
            )}
        </div>
    );
}

function ImageNodeContent(props: NodeContentRendererProps) {
    if (!props.node.metadata?.content && props.isBatchRoot) {
        const content =
            props.node.metadata?.status === "loading" ? (
                <LoadingContent theme={props.theme} />
            ) : props.node.metadata?.status === "error" ? (
                <ErrorContent node={props.node} theme={props.theme} onRetry={props.onRetry} />
            ) : (
                <EmptyImageContent {...props} isBatchRoot={false} />
            );
        return (
            <BatchFrame batchCount={props.batchCount} batchExpanded={props.batchExpanded} batchOpening={props.batchOpening} batchRecovering={props.batchRecovering} onToggleBatch={props.onToggleBatch}>
                {content}
            </BatchFrame>
        );
    }
    if (!props.node.metadata?.content) return <EmptyImageContent {...props} />;

    return (
        <ImageContent
            node={props.node}
            isBatchRoot={props.isBatchRoot}
            batchCount={props.batchCount}
            batchExpanded={props.batchExpanded}
            batchOpening={props.batchOpening}
            batchRecovering={props.batchRecovering}
            onToggleBatch={props.onToggleBatch}
            onSetBatchPrimary={props.onSetBatchPrimary}
        />
    );
}

function EmptyImageContent({ theme, isBatchRoot, batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch }: NodeContentRendererProps) {
    const content = (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
            <div className="flex size-14 items-center justify-center rounded-2xl" style={{ background: theme.toolbar.activeBg }}>
                <ImageIcon className="size-6 opacity-30" />
            </div>
            <span className="text-[10px] tracking-[0.18em] opacity-50">空图片节点</span>
        </div>
    );
    if (isBatchRoot)
        return (
            <BatchFrame batchCount={batchCount} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
                {content}
            </BatchFrame>
        );
    return content;
}

function VideoNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-3" style={{ color: theme.node.placeholder }}>
                <Video className="size-7 opacity-35" />
                <span className="text-sm">空视频节点</span>
            </div>
        );
    const model = node.metadata.model ? modelOptionName(node.metadata.model) : "";
    const summary = [model, node.metadata.vquality, node.metadata.seconds ? `${node.metadata.seconds}s` : ""].filter(Boolean).join(" · ");
    const options = [node.metadata.minimaxVideoPromptOptimizer === "true" ? "提示词优化" : "", node.metadata.minimaxVideoFastPretreatment === "true" ? "快速预处理" : "", node.metadata.watermark === "true" ? "水印" : ""].filter(Boolean).join(" · ");
    return (
        <div className="relative h-full w-full overflow-hidden rounded-[18px] bg-black">
            <video src={node.metadata.content} controls className="h-full w-full object-contain" data-canvas-no-zoom />
            {summary ? (
                <div className="pointer-events-none absolute left-2 top-2 max-w-[calc(100%-1rem)] rounded-md bg-black/60 px-2 py-1 text-[10px] leading-4 text-white backdrop-blur-sm">
                    <div className="truncate">{summary}</div>
                    {options ? <div className="truncate text-white/70">{options}</div> : null}
                </div>
            ) : null}
        </div>
    );
}

function AudioNodeContent({ node, theme }: NodeContentRendererProps) {
    if (!node.metadata?.content)
        return (
            <div className="flex h-full w-full flex-col items-center justify-center gap-2" style={{ color: theme.node.placeholder }}>
                <Music2 className="size-7 opacity-35" />
                <span className="text-sm">空音频节点</span>
            </div>
        );
    return (
        <div className="flex h-full w-full flex-col justify-center gap-3 px-4" style={{ background: theme.node.fill, color: theme.node.text }}>
            <div className="flex min-w-0 items-center gap-2 text-sm opacity-70">
                <Music2 className="size-4 shrink-0" />
                <span className="truncate">音频</span>
            </div>
            <audio src={node.metadata.content} controls className="w-full" data-canvas-no-zoom />
        </div>
    );
}

function stopTerminalControlEvent(event: React.MouseEvent | React.PointerEvent) {
    event.stopPropagation();
}

function TerminalNodeContent(props: NodeContentRendererProps) {
    if (props.node.metadata?.terminalConfigured === false) return <TerminalSetupContent theme={props.theme} />;
    return <TerminalSessionContent {...props} />;
}

function TerminalSetupContent({ theme }: Pick<NodeContentRendererProps, "theme">) {
    return (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-7 text-center" style={{ color: theme.node.text }}>
            <span className="grid size-11 place-items-center rounded-2xl bg-emerald-400/[.12] text-emerald-400">
                <Settings2 className="size-5" />
            </span>
            <div>
                <div className="text-sm font-semibold">终端等待配置</div>
                <p className="mt-1.5 text-[11px] leading-5 opacity-55">先确认工作目录、接收内容和输出类型，再启动终端。</p>
            </div>
            <span className="rounded-full border px-2.5 py-1 text-[10px] opacity-65" style={{ borderColor: theme.node.stroke }}>
                点击节点继续配置
            </span>
        </div>
    );
}

function TerminalSessionContent({ node, onMetadataChange, onTerminalArtifact, mentionReferences, isViewportVisible }: NodeContentRendererProps) {
    const terminalHostRef = useRef<HTMLDivElement>(null);
    const outputRef = useRef(node.metadata?.terminalOutput || "");
    const terminalRef = useRef<XTermInstance | null>(null);
    const fitAddonRef = useRef<FitAddonInstance | null>(null);
    const outputModeRef = useRef<CanvasGenerationMode>(node.metadata?.terminalOutputMode || "text");
    const markerBufferRef = useRef("");
    const importedArtifactSignaturesRef = useRef(new Map(Object.entries(node.metadata?.terminalImportedArtifactSignatures || {})));
    const importingArtifactPathsRef = useRef(new Set<string>());
    const queuedArtifactPathsRef = useRef(new Map<string, string | undefined>());
    const sessionReadyRef = useRef(false);
    const sessionRunRef = useRef(0);
    const runtimeSessionIdRef = useRef("");
    const [directory, setDirectory] = useState(node.metadata?.terminalDirectory || "");
    const [terminalViewState, setTerminalViewState] = useState<"loading" | "ready" | "error">("loading");
    const [terminalViewAttempt, setTerminalViewAttempt] = useState(0);
    const installedSkills = useSkillStore((state) => state.skills);
    const activeSkills = useMemo(
        () =>
            installedSkills
                .filter((skill) => skill.enabled && !skill.zodiacOnly)
                .sort((a, b) => a.priority - b.priority)
                .map((skill) => ({ id: skill.id, name: skill.name, version: skill.version, updatedAt: skill.updatedAt, body: skill.body })),
        [installedSkills],
    );
    const skillFingerprint = activeSkills.map((skill) => `${skill.id}@${skill.version}:${skill.updatedAt}`).join("|");
    const upstreamReferences = mentionReferences.filter((reference) => reference.nodeId !== node.id);
    const sessionVersion = node.metadata?.terminalSessionVersion || 0;
    const inputMode = node.metadata?.terminalInputMode || "auto";
    const inputFingerprint = terminalInputFingerprint(upstreamReferences, inputMode);
    const logicalSessionKey = `${node.id}:${sessionVersion}:${shortHash(inputFingerprint)}:${shortHash(directory.trim())}:${shortHash(skillFingerprint)}`;
    const fontSize = Math.min(20, Math.max(10, node.metadata?.terminalFontSize || 12));
    const fontSizeRef = useRef(fontSize);
    useEffect(() => setDirectory(node.metadata?.terminalDirectory || ""), [node.id, node.metadata?.terminalDirectory]);
    useEffect(() => {
        outputRef.current = node.metadata?.terminalOutput || "";
    }, [node.id, node.metadata?.terminalOutput]);
    useEffect(() => {
        outputModeRef.current = node.metadata?.terminalOutputMode || "text";
    }, [node.metadata?.terminalOutputMode]);
    useEffect(() => {
        const runtimeSessionId = `${logicalSessionKey}:${++sessionRunRef.current}`;
        runtimeSessionIdRef.current = runtimeSessionId;
        sessionReadyRef.current = false;
        let metadataFlushTimer: number | undefined;
        let outputMetadataDirty = false;
        const importArtifact = (path: string, mimeType?: string) => {
            if (cancelled) return;
            const outputMode = outputModeRef.current;
            if (outputMode === "text" || (mimeType && !mimeType.startsWith(`${outputMode}/`))) return;
            if (importingArtifactPathsRef.current.has(path)) {
                queuedArtifactPathsRef.current.set(path, mimeType);
                return;
            }
            importingArtifactPathsRef.current.add(path);
            const previousSignature = importedArtifactSignaturesRef.current.get(path);
            void importTerminalOutputWhenReady(runtimeSessionId, path, outputMode, terminalArtifactStorageKey(outputMode), previousSignature)
                .then(async (file) => {
                    if (cancelled || !file) return;
                    const imported = await importTerminalArtifact(file, path, outputMode, node.id, onMetadataChange, onTerminalArtifact);
                    if (!imported || cancelled) return;
                    importedArtifactSignaturesRef.current.set(path, file.signature);
                    onMetadataChange?.(node.id, {
                        terminalImportedArtifactPaths: Array.from(importedArtifactSignaturesRef.current.keys()),
                        terminalImportedArtifactSignatures: Object.fromEntries(importedArtifactSignaturesRef.current),
                    });
                })
                .catch((error) => {
                    if (!cancelled) onMetadataChange?.(node.id, { errorDetails: error instanceof Error ? error.message : "无法导入终端输出文件" });
                })
                .finally(() => {
                    importingArtifactPathsRef.current.delete(path);
                    if (cancelled) {
                        queuedArtifactPathsRef.current.delete(path);
                        return;
                    }
                    if (!queuedArtifactPathsRef.current.has(path)) return;
                    const queuedMimeType = queuedArtifactPathsRef.current.get(path);
                    queuedArtifactPathsRef.current.delete(path);
                    importArtifact(path, queuedMimeType);
                });
        };
        const flushOutputMetadata = () => {
            if (metadataFlushTimer !== undefined) {
                window.clearTimeout(metadataFlushTimer);
                metadataFlushTimer = undefined;
            }
            if (!outputMetadataDirty) return;
            outputMetadataDirty = false;
            onMetadataChange?.(node.id, {
                terminalOutput: outputRef.current,
                terminalOutputValue: terminalPlainText(outputRef.current),
                status: "success",
                errorDetails: undefined,
            });
        };
        const scheduleOutputMetadataFlush = () => {
            outputMetadataDirty = true;
            if (metadataFlushTimer !== undefined) return;
            metadataFlushTimer = window.setTimeout(flushOutputMetadata, 350);
        };
        const appendOutput = (data: string) => {
            terminalRef.current?.write(data);
            outputRef.current = `${outputRef.current}${data}`.slice(-80_000);
            scheduleOutputMetadataFlush();
            const completedLines = `${markerBufferRef.current}${data}`.split(/\r?\n/gu);
            markerBufferRef.current = completedLines.pop() || "";
            completedLines.forEach((line) => terminalArtifactPaths(terminalPlainText(line)).forEach((path) => importArtifact(path)));
        };
        let cancelled = false;
        let unlistenOutput: (() => void) | undefined;
        let unlistenArtifact: (() => void) | undefined;
        const lifecycle = (async () => {
            try {
                const stopListeningOutput = await listenToTerminalOutput(runtimeSessionId, (event) => {
                    if (!cancelled) appendOutput(event.data);
                });
                if (cancelled) {
                    stopListeningOutput();
                    return;
                }
                unlistenOutput = stopListeningOutput;
                const stopListeningArtifact = await listenToTerminalArtifact(runtimeSessionId, (event) => {
                    if (!cancelled) importArtifact(event.path, event.mimeType);
                });
                if (cancelled) {
                    stopListeningArtifact();
                    return;
                }
                unlistenArtifact = stopListeningArtifact;
                markerBufferRef.current = outputRef.current.split(/\r?\n/gu).pop() || "";
                const inputs = await prepareTerminalInputs(upstreamReferences, inputMode);
                if (cancelled) return;
                await startTerminalSession(runtimeSessionId, directory, inputs, activeSkills);
                if (cancelled) return;
                sessionReadyRef.current = true;
                terminalArtifactPaths(terminalPlainText(outputRef.current)).forEach((path) => importArtifact(path));
                const terminal = terminalRef.current;
                if (terminal) {
                    fitAddonRef.current?.fit();
                    void resizeTerminalSession(runtimeSessionId, terminal.cols, terminal.rows).catch(() => undefined);
                }
            } catch (error) {
                if (!cancelled) appendOutput(`\r\n终端启动失败：${error instanceof Error ? error.message : String(error)}\r\n`);
            }
        })();
        return () => {
            cancelled = true;
            if (runtimeSessionIdRef.current === runtimeSessionId) sessionReadyRef.current = false;
            flushOutputMetadata();
            unlistenOutput?.();
            unlistenArtifact?.();
            void lifecycle.then(() => stopTerminalSession(runtimeSessionId)).catch(() => undefined);
        };
        // 输入结构、工作位置或用户显式重开时才创建新的运行会话。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [logicalSessionKey]);
    useEffect(() => {
        if (!isViewportVisible) return;
        const host = terminalHostRef.current;
        if (!host) return;
        setTerminalViewState("loading");
        let disposed = false;
        let terminal: XTermInstance | null = null;
        let fitAddon: FitAddonInstance | null = null;
        let resizeObserver: ResizeObserver | null = null;
        let inputSubscription: { dispose: () => void } | null = null;
        let resizeFrame: number | null = null;
        const loadTerminalView = async () => {
            const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")]);
            if (disposed || !host.isConnected) return;
            terminal = new Terminal({
                cursorBlink: true,
                convertEol: false,
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Kaiti SC", "STKaiti", "KaiTi", monospace',
                fontSize: fontSizeRef.current,
                lineHeight: 1.28,
                scrollback: 2000,
                theme: { background: "#05080d", foreground: "#d7e3f4", cursor: "#39e7a5", selectionBackground: "#1f6feb66", black: "#05080d", brightBlack: "#64748b", green: "#39e7a5", brightGreen: "#65f2bd" },
            });
            fitAddon = new FitAddon();
            terminalRef.current = terminal;
            fitAddonRef.current = fitAddon;
            terminal.loadAddon(fitAddon);
            terminal.open(host);
            if (outputRef.current) terminal.write(outputRef.current);
            setTerminalViewState("ready");
            const syncTerminalSize = () => {
                if (disposed || !terminal || !fitAddon) return;
                fitAddon.fit();
                const runtimeSessionId = runtimeSessionIdRef.current;
                if (runtimeSessionId) void resizeTerminalSession(runtimeSessionId, terminal.cols, terminal.rows).catch(() => undefined);
            };
            resizeFrame = requestAnimationFrame(syncTerminalSize);
            resizeObserver = new ResizeObserver(syncTerminalSize);
            resizeObserver.observe(host);
            inputSubscription = terminal.onData((data) => {
                // Agent TUI 可能启用鼠标追踪；画布拖动不应被转成终端的鼠标转义序列。
                if (!sessionReadyRef.current || isTerminalMouseSequence(data)) return;
                const runtimeSessionId = runtimeSessionIdRef.current;
                if (runtimeSessionId) void writeTerminalInput(runtimeSessionId, data).catch(() => undefined);
            });
        };
        void loadTerminalView().catch(() => {
            if (disposed) return;
            inputSubscription?.dispose();
            inputSubscription = null;
            resizeObserver?.disconnect();
            resizeObserver = null;
            terminal?.dispose();
            terminal = null;
            fitAddon = null;
            terminalRef.current = null;
            fitAddonRef.current = null;
            setTerminalViewState("error");
        });
        return () => {
            disposed = true;
            if (resizeFrame !== null) cancelAnimationFrame(resizeFrame);
            inputSubscription?.dispose();
            resizeObserver?.disconnect();
            terminal?.dispose();
            if (terminalRef.current === terminal) terminalRef.current = null;
            if (fitAddonRef.current === fitAddon) fitAddonRef.current = null;
        };
        // 离开视口仅卸载 XTerm 视图，PTY、监听和数据流继续运行。
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isViewportVisible, node.id, terminalViewAttempt]);
    useEffect(() => {
        fontSizeRef.current = fontSize;
        const terminal = terminalRef.current;
        if (!terminal) return;
        terminal.options.fontSize = fontSize;
        requestAnimationFrame(() => {
            fitAddonRef.current?.fit();
            const runtimeSessionId = runtimeSessionIdRef.current;
            if (runtimeSessionId) void resizeTerminalSession(runtimeSessionId, terminal.cols, terminal.rows).catch(() => undefined);
        });
    }, [fontSize]);
    return (
        <div className="flex h-full w-full flex-col overflow-hidden rounded-[18px] bg-[#05080d] text-[#d7e3f4]">
            <div className="flex h-9 shrink-0 cursor-grab items-center justify-between border-b border-white/[.07] px-3 active:cursor-grabbing" title="拖动此栏移动节点">
                <div className="flex items-center gap-2 font-mono text-[11px] text-emerald-300">
                    <span className="size-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_#39e7a5]" />
                    terminal
                </div>
                <span className="max-w-[55%] truncate font-mono text-[10px] text-slate-500">{terminalWorkspaceLabel(directory)}</span>
            </div>
            {isViewportVisible ? (
                <div className="relative min-h-0 flex-1">
                    <div
                        ref={terminalHostRef}
                        className={`h-full cursor-text px-3 py-2 transition-opacity [&_.xterm]:h-full [&_.xterm-viewport]:!bg-transparent ${terminalViewState === "ready" ? "opacity-100" : "opacity-0"}`}
                        title="点击后直接输入"
                        onClick={() => terminalRef.current?.focus()}
                        onMouseDown={stopTerminalControlEvent}
                        onPointerDown={stopTerminalControlEvent}
                        onWheel={(event) => event.stopPropagation()}
                    />
                    {terminalViewState !== "ready" ? (
                        <div className="absolute inset-0 flex items-center justify-center text-[11px] text-slate-500">
                            {terminalViewState === "loading" ? (
                                <span className="flex items-center gap-2">
                                    <span className="size-1.5 animate-pulse rounded-full bg-emerald-400" />
                                    正在打开终端...
                                </span>
                            ) : (
                                <button
                                    type="button"
                                    className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-slate-400 transition hover:border-white/20 hover:text-slate-200"
                                    onClick={() => setTerminalViewAttempt((value) => value + 1)}
                                    onMouseDown={stopTerminalControlEvent}
                                    onPointerDown={stopTerminalControlEvent}
                                >
                                    <RefreshCw className="size-3" />
                                    重新加载终端
                                </button>
                            )}
                        </div>
                    ) : null}
                </div>
            ) : (
                <div className="min-h-0 flex-1" aria-hidden />
            )}
        </div>
    );
}

function terminalPlainText(value: string) {
    return value
        .replace(/\u001B\[[0-?]*[ -/]*[@-~]/gu, "")
        .replace(/\r/g, "")
        .slice(-80_000);
}

function isTerminalMouseSequence(value: string) {
    return value.startsWith("\u001b[<") || value.startsWith("\u001b[M");
}

async function importTerminalArtifact(
    file: TerminalImportedMedia,
    path: string,
    outputMode: Exclude<CanvasGenerationMode, "text">,
    nodeId: string,
    onMetadataChange?: (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => void,
    onTerminalArtifact?: (nodeId: string, artifact: CanvasTerminalArtifact) => void,
) {
    try {
        const stored = file.record;
        if (outputMode === "image") {
            const image = await readImageMeta(stored.url);
            onMetadataChange?.(nodeId, { terminalOutputArtifactUrl: stored.url, terminalOutputArtifactStorageKey: stored.key, terminalOutputMimeType: stored.mimeType, terminalOutputValue: stored.url, status: "success", errorDetails: undefined });
            onTerminalArtifact?.(nodeId, { kind: "image", url: stored.url, storageKey: stored.key, mimeType: stored.mimeType, bytes: stored.bytes, width: image.width, height: image.height, title: terminalArtifactTitle(path) });
            return true;
        }
        onMetadataChange?.(nodeId, { terminalOutputArtifactUrl: stored.url, terminalOutputArtifactStorageKey: stored.key, terminalOutputMimeType: stored.mimeType, terminalOutputValue: stored.url, status: "success", errorDetails: undefined });
        if (outputMode === "video") {
            const media = await readVideoMeta(stored.url);
            onTerminalArtifact?.(nodeId, {
                kind: "video",
                url: stored.url,
                storageKey: stored.key,
                mimeType: stored.mimeType,
                bytes: stored.bytes,
                width: media.width,
                height: media.height,
                durationMs: media.durationMs,
                title: terminalArtifactTitle(path),
            });
        } else {
            const media = await readAudioMeta(stored.url);
            onTerminalArtifact?.(nodeId, { kind: "audio", url: stored.url, storageKey: stored.key, mimeType: stored.mimeType, bytes: stored.bytes, durationMs: media.durationMs, title: terminalArtifactTitle(path) });
        }
        return true;
    } catch (error) {
        onMetadataChange?.(nodeId, { errorDetails: error instanceof Error ? error.message : "无法导入终端输出文件" });
        return false;
    }
}

async function importTerminalOutputWhenReady(sessionId: string, path: string, outputMode: Exclude<CanvasGenerationMode, "text">, storageKey: string, previousSignature?: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < 3; attempt += 1) {
        try {
            return await importTerminalOutputFile(sessionId, path, outputMode, storageKey, previousSignature);
        } catch (error) {
            lastError = error;
            if (attempt < 2) await new Promise((resolve) => window.setTimeout(resolve, 350));
        }
    }
    throw lastError;
}

function terminalArtifactStorageKey(outputMode: Exclude<CanvasGenerationMode, "text">) {
    const prefix = outputMode === "image" ? "image" : "terminal-output";
    return `${prefix}:${nanoid()}`;
}

function terminalArtifactTitle(path: string) {
    return (
        path
            .split("/")
            .at(-1)
            ?.replace(/\.[^.]+$/u, "") || "终端输出"
    );
}

function terminalWorkspaceLabel(path: string) {
    const name = path.replace(/\\/gu, "/").replace(/\/+$/gu, "").split("/").at(-1);
    return name ? `工作区 · ${name}` : "应用工作区";
}

function terminalArtifactPaths(line: string) {
    const explicit = line
        .replace(/\r/g, "")
        .trim()
        .match(/^__WG_OUTPUT__:(.+)$/u)?.[1]
        ?.trim();
    return explicit ? [explicit] : [];
}

function terminalInputFingerprint(references: CanvasResourceReference[], inputMode: string) {
    return `${inputMode}|${references
        .filter((reference) => inputMode === "auto" || reference.kind === inputMode)
        .map((reference) => `${reference.id}:${reference.kind}:${reference.inputRevision ?? reference.previewUrl ?? reference.text ?? ""}`)
        .join("|")}`;
}

function shortHash(value: string) {
    let hash = 5381;
    for (let index = 0; index < value.length; index += 1) hash = (hash * 33) ^ value.charCodeAt(index);
    return (hash >>> 0).toString(36);
}

function ImageContent({
    node,
    isBatchRoot,
    batchCount,
    batchExpanded,
    batchOpening,
    batchRecovering,
    onToggleBatch,
    onSetBatchPrimary,
}: {
    node: CanvasNodeData;
    isBatchRoot: boolean;
    batchCount: number;
    batchExpanded: boolean;
    batchOpening: boolean;
    batchRecovering: boolean;
    onToggleBatch?: () => void;
    onSetBatchPrimary?: () => void;
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchChild = Boolean(node.metadata?.batchRootId);

    return (
        <BatchFrame batchCount={isBatchRoot ? batchCount : 0} batchExpanded={batchExpanded} batchOpening={batchOpening} batchRecovering={batchRecovering} onToggleBatch={onToggleBatch}>
            <div className="h-full w-full overflow-hidden rounded-3xl">
                <img
                    src={node.metadata!.content!}
                    alt={node.title}
                    draggable={false}
                    onDragStart={(event) => event.preventDefault()}
                    className={`pointer-events-none block h-full w-full select-none ${node.metadata?.freeResize ? "object-fill" : "object-contain"}`}
                />
            </div>
            {isBatchRoot ? (
                <button
                    type="button"
                    className="absolute right-2.5 top-2.5 z-30 flex h-8 items-center justify-center gap-1 rounded-full border px-2.5 text-xs font-semibold shadow-[0_6px_18px_rgba(15,23,42,.10)] backdrop-blur-md transition hover:scale-[1.02]"
                    style={{ background: `${theme.toolbar.panel}d9`, borderColor: `${theme.toolbar.border}cc`, color: theme.node.text }}
                    aria-label={batchExpanded ? "图片组已展开" : "图片组已收起"}
                    onClick={(event) => {
                        event.stopPropagation();
                        onToggleBatch?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <span className="leading-none text-[#2f80ff]">{batchCount}</span>
                    <ChevronRight className={`size-3.5 opacity-55 transition-transform ${batchExpanded ? "rotate-90" : ""}`} />
                </button>
            ) : null}
            {isBatchChild ? (
                <button
                    type="button"
                    className="absolute right-3 top-3 z-30 flex h-9 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-medium opacity-0 shadow-[0_8px_20px_rgba(68,64,60,.13)] backdrop-blur-md transition group-hover/batch:opacity-100 hover:scale-[1.02]"
                    style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border, color: theme.node.text }}
                    onClick={(event) => {
                        event.stopPropagation();
                        onSetBatchPrimary?.();
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onPointerDown={(event) => event.stopPropagation()}
                >
                    <Star className="size-3.5 text-[#2f80ff]" />
                    设为主图
                </button>
            ) : null}
        </BatchFrame>
    );
}

function ImageInfoBar({ node }: { node: CanvasNodeData }) {
    const width = Math.round(node.metadata?.naturalWidth || node.width);
    const height = Math.round(node.metadata?.naturalHeight || node.height);
    const size = formatBytes(node.metadata?.bytes || 0);
    return (
        <div className="pointer-events-none absolute bottom-3 right-3 z-40 max-w-[calc(100%-24px)]">
            <span className="max-w-full truncate rounded-md bg-black/55 px-2 py-1 text-[11px] font-medium leading-none text-white backdrop-blur-sm">
                {width} x {height}
                {size ? ` · ${size}` : ""}
            </span>
        </div>
    );
}

function BatchFrame({ batchCount, batchExpanded, batchOpening, batchRecovering, onToggleBatch, children }: { batchCount: number; batchExpanded: boolean; batchOpening: boolean; batchRecovering: boolean; onToggleBatch?: () => void; children: ReactNode }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const isBatchRoot = batchCount > 1;
    return (
        <div
            className="group/batch relative h-full w-full overflow-visible"
            onDoubleClick={
                isBatchRoot
                    ? (event) => {
                          event.stopPropagation();
                          onToggleBatch?.();
                      }
                    : undefined
            }
        >
            {isBatchRoot ? (
                <div className="pointer-events-none absolute inset-0 overflow-visible">
                    {Array.from({ length: Math.min(batchCount - 1, 5) }).map((_, index) => (
                        <div
                            key={index}
                            className="absolute rounded-[inherit] border shadow-[0_14px_34px_rgba(68,64,60,.16)] transition-all duration-300 group-hover/batch:translate-x-2"
                            style={{
                                inset: 0,
                                background: `linear-gradient(135deg, ${theme.node.panel}, ${theme.node.fill})`,
                                borderColor: theme.node.stroke,
                                opacity: batchExpanded && !batchOpening ? 0.34 : 1,
                                transform:
                                    batchOpening || batchRecovering ? `translate(${54 + index * 22}px, ${20 + index * 12}px) rotate(${8 + index * 5}deg) scale(.98)` : `translate(${34 + index * 18}px, ${14 + index * 10}px) rotate(${6 + index * 4}deg)`,
                                zIndex: -index - 1,
                            }}
                        />
                    ))}
                </div>
            ) : null}
            {children}
        </div>
    );
}
function ResizeHandle({ corner, onMouseDown }: { corner: ResizeCorner; onMouseDown: (event: React.MouseEvent, corner: ResizeCorner) => void }) {
    const positionClass = {
        "top-left": "-left-[14px] -top-[14px] cursor-nwse-resize",
        "top-right": "-right-[14px] -top-[14px] cursor-nesw-resize",
        "bottom-left": "-bottom-[14px] -left-[14px] cursor-nesw-resize",
        "bottom-right": "-bottom-[14px] -right-[14px] cursor-nwse-resize",
    }[corner];

    return <div className={`absolute z-50 size-7 ${positionClass}`} onMouseDown={(event) => onMouseDown(event, corner)} />;
}

function ConnectionHandleDot({ side, visible, onMouseDown }: { side: "left" | "right"; visible: boolean; onMouseDown: (event: React.MouseEvent) => void }) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];

    return (
        <div
            className={`absolute top-1/2 z-30 flex size-12 -translate-y-1/2 cursor-crosshair items-center justify-center transition-opacity duration-150 ${
                side === "left" ? "-left-6" : "-right-6"
            } ${visible ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"}`}
            onMouseDown={onMouseDown}
        >
            <div className="size-3 rounded-full border-2 transition-all hover:scale-125" style={{ background: theme.node.panel, borderColor: theme.node.muted }} />
        </div>
    );
}
