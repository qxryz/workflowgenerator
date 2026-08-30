import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ChangeEvent as ReactChangeEvent, DragEvent as ReactDragEvent, MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { Group, Video } from "lucide-react";
import { saveAs } from "file-saver";

import { requestEdit, requestGeneration, requestImageQuestion } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { defaultConfig, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import { discardUploadedImage, publishUploadedImage, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { discardUploadedMedia, publishUploadedMedia, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { getAssetFileBlob, publishUploadedAssetFile, uploadAssetFile, type UploadedAssetFile } from "@/services/asset-file-storage";
import { exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { nanoid } from "nanoid";
import { getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { assetFileCategory, classifyImportedFile, fileExtension } from "@/lib/asset-file";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { cropDataUrl, splitDataUrl, upscaleDataUrl } from "@/lib/canvas/canvas-image-data";
import { fitNodeSize, nodeSizeFromRatio } from "@/lib/canvas/canvas-node-size";
import { fitCanvasResultSlotToContent } from "@/lib/canvas/canvas-result-slot-layout";
import { App, Button, Modal } from "antd";
import { NODE_DEFAULT_SIZE, getNodeSpec } from "@/constant/canvas";
import { ActiveConnectionPath, ConnectionPath } from "@/components/canvas/canvas-connections";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasTerminalSettingsPanel } from "@/components/canvas/canvas-terminal-settings-panel";
import { CanvasNodeContextMenu } from "@/components/canvas/canvas-context-menu";
import { CanvasNodeAngleDialog, type CanvasImageAngleParams } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeCropDialog, type CanvasImageCropRect } from "@/components/canvas/canvas-node-crop-dialog";
import { CanvasNodeMaskEditDialog, type CanvasImageMaskEditPayload } from "@/components/canvas/canvas-node-mask-edit-dialog";
import { CanvasNodeSplitDialog, type CanvasImageSplitParams } from "@/components/canvas/canvas-node-split-dialog";
import { CanvasNodeUpscaleDialog, type CanvasImageUpscaleParams } from "@/components/canvas/canvas-node-upscale-dialog";
import { buildNodeGenerationContext, buildNodeGenerationContextFromInputs, buildNodeGenerationInputs, buildNodeResponseMessages, hydrateNodeGenerationContext, type NodeGenerationContext, type NodeGenerationInput } from "@/components/canvas/canvas-node-generation";
import { CanvasNodeHoverToolbar, CanvasNodeInfoModal } from "@/components/canvas/canvas-node-hover-toolbar";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNode } from "@/components/canvas/canvas-node";
import { CanvasResultSlotContent } from "@/components/canvas/canvas-result-slot-content";
import { CanvasNodePromptPanel, type CanvasNodeGenerationMode } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { CanvasSidePanel } from "@/components/canvas/canvas-side-panel";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";
import { useAgentStore } from "@/stores/use-agent-store";
import { flushCanvasStoreWrites, useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { registerDesktopFlusher } from "@/services/desktop-lifecycle";
import { collectStorageKeys, markMediaReferencesChanged } from "@/services/media-retention-policy";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { useAgentBridge } from "@/pages/canvas/hooks/use-agent-bridge";
import { usePluginHost } from "@/pages/canvas/hooks/use-plugin-host";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { buildNodeMentionReferences, buildTerminalInputReferences, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { findDeclaredOutputNode, resolveDeclaredOutputNode } from "@/lib/canvas/workflow-output-routing";
import {
    appendResultSlotFailure,
    appendResultSlotSuccess,
    createCanvasResultSlot,
    createCanvasResultSlotBinding,
    deleteResultSlotArtifact,
    deleteResultSlotVersion,
    getCurrentResultSlotVersion,
    isCanvasResultSlot,
    selectResultSlotVersion,
    resolveCanvasResultSlotExecutionControls,
    setCanvasResultSlotAdvanceMode,
    setCanvasResultSlotState,
    syncResultSlotWorkflowStatus,
    workflowNodeOwnsGenerationStop,
} from "@/lib/canvas/canvas-result-slots";
import { createWorkflowExecution, type WorkflowExecution, type WorkflowExecutionMode, type WorkflowNodeProgress, type WorkflowRunSnapshot } from "@/lib/canvas/workflow-execution";
import { buildCanvasWorkflowGraph, type CanvasWorkflowNodeData } from "@/lib/canvas/canvas-workflow-graph";
import { resolveCanvasWorkflowGenerationInputs } from "@/lib/canvas/canvas-workflow-inputs";
import {
    areCanvasGenerationRequestsCurrent,
    assertCanvasGenerationRequestsCurrent,
    canvasGenerationAttemptExpiredError,
    cancelCanvasGenerationRequestsByRunningId,
    claimCanvasGenerationRequest,
    discardCanvasGenerationUpload,
    finishCanvasGenerationRequest,
    hasCanvasGenerationRequestForRunningId,
    isCanvasGenerationRequestSuperseded,
    retainOwnedCanvasGenerationUpload,
    type CanvasGenerationAttempt,
    type CanvasGenerationProjectBoundary,
    type CanvasGenerationRequestLease,
    type CanvasGenerationRequestRegistry,
} from "@/lib/canvas/canvas-generation-attempts";
import { observeWorkflowExecution, useWorkflowRunStore } from "@/stores/canvas/use-workflow-run-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { applyNodeConfigPatch, audioMetadata, buildAudioGenerationMetadata, buildImageGenerationMetadata, createCanvasNode, createStructuredAssetGroup, imageMetadata, videoMetadata } from "@/lib/canvas/canvas-node-factory";
import { findContainingGroupId, findGroupDropTarget, getConnectionTargetAnchor, isHiddenBatchChild, normalizeConnection, snapNodesIntoGroup } from "@/lib/canvas/canvas-node-geometry";
import {
    audioExtension,
    beginCanvasImageBatch,
    buildAngleLabel,
    buildAnglePrompt,
    buildGenerationConfig,
    findRetrySourceNode,
    generationReferenceUrls,
    getGenerationCount,
    getInputSummary,
    hydrateAssistantImages,
    hydrateCanvasImages,
    imageExtension,
    isCurrentCanvasImageBatchSettled,
    isGenerationCanceled,
    resetInterruptedGeneration,
    resolveMetadataReferences,
    sourceNodeReferenceImages,
} from "@/lib/canvas/canvas-generation-helpers";
import { getNodeDefinition, isBuiltinNodeType as isBuiltinType, useNodeRegistryVersion } from "@/lib/canvas/node-registry";
import { registerBuiltinNodes } from "@/components/canvas/nodes/builtin-nodes";
import { CanvasPluginManagerModal } from "@/components/canvas/canvas-plugin-manager-modal";
import { CanvasRefreshShell } from "@/components/canvas/canvas-refresh-shell";
import { CanvasTopBar } from "@/components/canvas/canvas-top-bar";
import { ConnectionCreateMenu, NodeCreateMenu, type PendingConnectionCreate } from "@/components/canvas/canvas-create-menus";
import {
    CanvasNodeType,
    type CanvasAssistantImage,
    type CanvasAssistantSession,
    type CanvasConnection,
    type CanvasGenerationMode,
    type CanvasNodeData,
    type CanvasNodeMetadata,
    type CanvasResultSlotArtifact,
    type CanvasTerminalArtifact,
    type CanvasNodeTypeId,
    type ConnectionHandle,
    type ContextMenuState,
    type Position,
    type SelectionBox,
    type ViewportTransform,
} from "@/types/canvas";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio } from "@/types/media";

// 内置节点注册到统一注册表(模块加载时执行一次)
registerBuiltinNodes();

type CanvasClipboard = {
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
};

type ConnectionDropTarget = {
    nodeId: string | null;
    isNearNode: boolean;
};

type CanvasHistoryEntry = Pick<CanvasClipboard, "nodes" | "connections"> & {
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
};

const HISTORY_TRANSIENT_METADATA_KEYS = new Set<keyof CanvasNodeMetadata>([
    "status",
    "errorDetails",
    "terminalOutput",
    "terminalOutputValue",
    "terminalOutputArtifactUrl",
    "terminalOutputArtifactStorageKey",
    "terminalOutputMimeType",
    "terminalImportedArtifactPaths",
    "terminalImportedArtifactSignatures",
    "terminalOutputRevision",
    "terminalSessionVersion",
]);

function metadataMatchesForHistory(left?: CanvasNodeMetadata, right?: CanvasNodeMetadata) {
    if (left === right) return true;
    const leftRecord = (left || {}) as Record<string, unknown>;
    const rightRecord = (right || {}) as Record<string, unknown>;
    const leftKeys = Object.keys(leftRecord).filter((key) => !HISTORY_TRANSIENT_METADATA_KEYS.has(key as keyof CanvasNodeMetadata));
    const rightKeys = Object.keys(rightRecord).filter((key) => !HISTORY_TRANSIENT_METADATA_KEYS.has(key as keyof CanvasNodeMetadata));
    if (leftKeys.length !== rightKeys.length) return false;
    return leftKeys.every((key) => Object.prototype.hasOwnProperty.call(rightRecord, key) && Object.is(leftRecord[key], rightRecord[key]));
}

function nodesMatchForHistory(left: CanvasNodeData[], right: CanvasNodeData[]) {
    if (left === right) return true;
    if (left.length !== right.length) return false;
    for (let index = 0; index < left.length; index += 1) {
        const previous = left[index];
        const current = right[index];
        if (
            previous === current ||
            (previous.id === current.id &&
                previous.type === current.type &&
                previous.title === current.title &&
                previous.position.x === current.position.x &&
                previous.position.y === current.position.y &&
                previous.width === current.width &&
                previous.height === current.height &&
                metadataMatchesForHistory(previous.metadata, current.metadata))
        )
            continue;
        return false;
    }
    return true;
}

function entriesMatchForHistory(left: CanvasHistoryEntry, right: CanvasHistoryEntry) {
    return (
        nodesMatchForHistory(left.nodes, right.nodes) &&
        left.connections === right.connections &&
        left.chatSessions === right.chatSessions &&
        left.activeChatId === right.activeChatId &&
        left.backgroundMode === right.backgroundMode &&
        left.showImageInfo === right.showImageInfo
    );
}

function snapshotHistoryEntry(entry: CanvasHistoryEntry): CanvasHistoryEntry {
    let changed = false;
    const nodes = entry.nodes.map((node) => {
        if (!node.metadata) return node;
        const metadata = { ...node.metadata } as Record<string, unknown>;
        let nodeChanged = false;
        HISTORY_TRANSIENT_METADATA_KEYS.forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(metadata, key)) return;
            delete metadata[key];
            nodeChanged = true;
        });
        if (!nodeChanged) return node;
        changed = true;
        return { ...node, metadata: metadata as CanvasNodeMetadata };
    });
    return changed ? { ...entry, nodes } : entry;
}

function mergeCurrentRuntimeMetadata(entryNodes: CanvasNodeData[], currentNodes: CanvasNodeData[]) {
    const currentById = new Map(currentNodes.map((node) => [node.id, node]));
    return entryNodes.map((node) => {
        const currentMetadata = currentById.get(node.id)?.metadata;
        if (!currentMetadata) return node;
        const currentRecord = currentMetadata as Record<string, unknown>;
        const metadata = { ...node.metadata } as Record<string, unknown>;
        let changed = false;
        HISTORY_TRANSIENT_METADATA_KEYS.forEach((key) => {
            if (!Object.prototype.hasOwnProperty.call(currentRecord, key)) return;
            metadata[key] = currentRecord[key];
            changed = true;
        });
        return changed ? { ...node, metadata: metadata as CanvasNodeMetadata } : node;
    });
}

type CanvasGenerationOutcome = {
    sourceNodeId: string;
    outputSlotId: string;
    mode: CanvasGenerationMode;
    versionId: string;
    artifacts: CanvasResultSlotArtifact[];
};

type CanvasGenerationRunOptions = {
    runId?: string;
    attemptId?: string;
    signal?: AbortSignal;
    onPersisting?: () => void;
    onProgress?: (progress: WorkflowNodeProgress) => void;
    silent?: boolean;
    generationContext?: NodeGenerationContext;
};

type CanvasHandleGenerationOptions = Pick<CanvasGenerationRunOptions, "silent" | "generationContext"> & { attempt?: CanvasGenerationAttempt };

type ProjectStateSnapshot = Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">;

type PendingProjectSave = {
    projectId: string;
    patch: ProjectStateSnapshot;
};

type GraphNodeSemanticSignature = {
    type: CanvasNodeData["type"];
    title: string;
    /** Non-terminal and plugin nodes retain the previous conservative behavior. */
    metadata?: CanvasNodeData["metadata"];
    terminalOutputRevision?: number;
    terminalOutputMode?: CanvasNodeMetadata["terminalOutputMode"];
    terminalOutputArtifactUrl?: string;
    terminalOutputArtifactStorageKey?: string;
    terminalOutputMimeType?: string;
    content?: string;
    prompt?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
};

type GraphDerivedCache = {
    connections: CanvasConnection[];
    registryVersion: number;
    nodeSignatures: Map<string, GraphNodeSemanticSignature>;
    configInputs: Map<string, NodeGenerationInput[]>;
    mentionReferences: Map<string, ReturnType<typeof buildNodeMentionReferences>>;
};

function graphNodeSemanticSignature(node: CanvasNodeData): GraphNodeSemanticSignature {
    if (node.type !== CanvasNodeType.Terminal) {
        return { type: node.type, title: node.title, metadata: node.metadata };
    }

    const metadata = node.metadata;
    return {
        type: node.type,
        title: node.title,
        terminalOutputRevision: metadata?.terminalOutputRevision,
        terminalOutputMode: metadata?.terminalOutputMode,
        terminalOutputArtifactUrl: metadata?.terminalOutputArtifactUrl,
        terminalOutputArtifactStorageKey: metadata?.terminalOutputArtifactStorageKey,
        terminalOutputMimeType: metadata?.terminalOutputMimeType,
        content: metadata?.content,
        prompt: metadata?.prompt,
        storageKey: metadata?.storageKey,
        mimeType: metadata?.mimeType,
        bytes: metadata?.bytes,
        naturalWidth: metadata?.naturalWidth,
        naturalHeight: metadata?.naturalHeight,
        durationMs: metadata?.durationMs,
    };
}

function graphNodeSemanticsMatch(previous: GraphNodeSemanticSignature | undefined, node: CanvasNodeData) {
    if (!previous || previous.type !== node.type || previous.title !== node.title) return false;
    if (node.type !== CanvasNodeType.Terminal) return previous.metadata === node.metadata;

    const metadata = node.metadata;
    return (
        previous.terminalOutputRevision === metadata?.terminalOutputRevision &&
        previous.terminalOutputMode === metadata?.terminalOutputMode &&
        previous.terminalOutputArtifactUrl === metadata?.terminalOutputArtifactUrl &&
        previous.terminalOutputArtifactStorageKey === metadata?.terminalOutputArtifactStorageKey &&
        previous.terminalOutputMimeType === metadata?.terminalOutputMimeType &&
        previous.content === metadata?.content &&
        previous.prompt === metadata?.prompt &&
        previous.storageKey === metadata?.storageKey &&
        previous.mimeType === metadata?.mimeType &&
        previous.bytes === metadata?.bytes &&
        previous.naturalWidth === metadata?.naturalWidth &&
        previous.naturalHeight === metadata?.naturalHeight &&
        previous.durationMs === metadata?.durationMs
    );
}

function resourceReferencesMatch(left: CanvasResourceReference[] | undefined, right: CanvasResourceReference[]) {
    return Boolean(
        left &&
        left.length === right.length &&
        left.every((reference, index) => {
            const next = right[index];
            return (
                next &&
                reference.id === next.id &&
                reference.nodeId === next.nodeId &&
                reference.kind === next.kind &&
                reference.label === next.label &&
                reference.title === next.title &&
                reference.previewUrl === next.previewUrl &&
                reference.storageKey === next.storageKey &&
                reference.text === next.text &&
                reference.inputRevision === next.inputRevision &&
                reference.active === next.active
            );
        }),
    );
}

function generationInputsMatch(left: NodeGenerationInput[] | undefined, right: NodeGenerationInput[]) {
    return Boolean(
        left &&
        left.length === right.length &&
        left.every((input, index) => {
            const next = right[index];
            return (
                next &&
                input.nodeId === next.nodeId &&
                input.type === next.type &&
                input.title === next.title &&
                input.text === next.text &&
                input.image?.dataUrl === next.image?.dataUrl &&
                input.image?.storageKey === next.image?.storageKey &&
                input.video?.url === next.video?.url &&
                input.video?.storageKey === next.video?.storageKey &&
                input.audio?.url === next.audio?.url &&
                input.audio?.storageKey === next.audio?.storageKey
            );
        }),
    );
}

const VIDEO_NODE_MAX_WIDTH = 420;
const VIDEO_NODE_MAX_HEIGHT = 420;
// 稳定的空引用数组:避免每次渲染 `... || []` 产生新数组引用而击穿 CanvasNode 的 React.memo
const EMPTY_REFERENCES: CanvasResourceReference[] = [];
const CONNECTION_HANDLE_HIT_RADIUS = 40;
const CONNECTION_NODE_HIT_PADDING = 32;
const NODE_STATUS_IDLE = "idle" as const;
const NODE_STATUS_LOADING = "loading" as const;
const NODE_STATUS_SUCCESS = "success" as const;
const NODE_STATUS_ERROR = "error" as const;
const IMAGE_PROMPT_REVERSE_PRESET = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

function workflowAbortError() {
    const error = new Error("运行已停止");
    error.name = "AbortError";
    return error;
}

async function waitForCanvasResultSlot(nodesRef: { current: CanvasNodeData[] }, slotId: string, timeoutMs = 4_000, ownsAttempt?: () => boolean) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() <= deadline) {
        if (ownsAttempt && !ownsAttempt()) throw workflowAbortError();
        const node = nodesRef.current.find((candidate) => candidate.id === slotId);
        if (node && isCanvasResultSlot(node)) {
            const batchSettled = isCurrentCanvasImageBatchSettled(node, nodesRef.current);
            // handleGenerateNode 在写入结果后只更新 status/content 等产物字段，不会显式把 slotState 切到 ready/persisting。
            // 如果只看 slotState 会一直停留在 "running"，导致工作流里的结果槽 4 秒后超时。
            // 当 status 已经走到成功/失败时，无论 slotState 是否仍标记为 "running"，都视为本步骤已完成。
            const statusSettled = node.metadata.status === NODE_STATUS_SUCCESS || node.metadata.status === NODE_STATUS_ERROR;
            const lifecycleSettled = statusSettled || (node.metadata.status !== NODE_STATUS_LOADING && node.metadata.slotState !== "running");
            if ((batchSettled ?? lifecycleSettled) && (Boolean(node.metadata.content) || node.metadata.status === NODE_STATUS_ERROR || batchSettled === true)) return node;
        }
        await new Promise<void>((resolve) => window.setTimeout(resolve, 16));
    }
    const node = nodesRef.current.find((candidate) => candidate.id === slotId);
    if (node && isCanvasResultSlot(node)) return node;
    throw new Error("结果槽未能完成保存");
}

function canvasResultArtifacts(slot: CanvasNodeData, nodes: CanvasNodeData[]): CanvasResultSlotArtifact[] {
    if (!isCanvasResultSlot(slot)) return [];
    const mode = slot.metadata.resultSlotMode;
    const batchIds = mode === "image" ? slot.metadata.batchChildIds || [] : [];
    const primaryId = slot.metadata.primaryImageId;
    const orderedIds = primaryId && batchIds.includes(primaryId) ? [primaryId, ...batchIds.filter((id) => id !== primaryId)] : batchIds;
    const candidates = orderedIds.length ? orderedIds.map((id) => nodes.find((node) => node.id === id)).filter((node): node is CanvasNodeData => Boolean(node)) : [slot];
    const readable = candidates.filter((node) => Boolean(node.metadata?.content) && node.metadata?.status !== NODE_STATUS_ERROR);
    const sources = readable.length ? readable : slot.metadata.content ? [slot] : [];
    return sources.map((node, index) => ({
        id: node.id || `${slot.id}-${index + 1}`,
        kind: mode,
        content: node.metadata?.content || "",
        title: node.title,
        storageKey: node.metadata?.storageKey,
        mimeType: node.metadata?.mimeType,
        bytes: node.metadata?.bytes,
        naturalWidth: node.metadata?.naturalWidth,
        naturalHeight: node.metadata?.naturalHeight,
        durationMs: node.metadata?.durationMs,
    }));
}

function canvasWorkflowIssueMessage(code?: string) {
    if (code === "missing_output_slot") return "有步骤还没有结果槽，添加后即可运行";
    if (code === "ambiguous_output_slot") return "有步骤连接了多个结果槽，请保留一个";
    if (code === "pending_input") return "上游结果还没有就绪";
    if (code === "direct_action_connection") return "两个生成步骤之间需要一个结果槽";
    if (code === "workflow_cycle") return "工作流中存在循环，请调整连接";
    if (code === "missing_action_mode" || code === "result_slot_mode_mismatch") return "有步骤的结果类型没有配好";
    if (code === "unknown_start_node" || code === "start_node_not_action") return "选中的步骤无法运行";
    return "工作流还需要整理一下连接后才能运行";
}

export default function CanvasPage() {
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    const { message, modal } = App.useApp();
    // 订阅节点注册表版本,插件动态注册/卸载后驱动画布重渲染
    const nodeRegistryVersion = useNodeRegistryVersion((state) => state.version);
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const smoothNavigate = useSmoothNavigation();
    const [searchParams] = useSearchParams();
    const projectId = params.id || "";
    const agentPanelOpen = useAgentStore((state) => state.panelOpen);
    const toggleAgentPanel = useAgentStore((state) => state.togglePanel);
    const openAgentPanel = useAgentStore((state) => state.openPanel);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const containerRef = useRef<HTMLDivElement>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const uploadTargetRef = useRef<{ nodeId?: string; position?: Position } | null>(null);
    const clipboardRef = useRef<CanvasClipboard | null>(null);
    const historyRef = useRef<{ past: CanvasHistoryEntry[]; future: CanvasHistoryEntry[] }>({ past: [], future: [] });
    const lastHistoryRef = useRef<CanvasHistoryEntry | null>(null);
    const historyCommitTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const projectSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const pendingProjectSaveRef = useRef<PendingProjectSave | null>(null);
    const pendingUploadedImagesRef = useRef(new Map<string, UploadedImage>());
    const pendingUploadedMediaRef = useRef(new Map<string, UploadedFile>());
    const pendingUploadedAssetFilesRef = useRef(new Map<string, UploadedAssetFile>());
    const generationImageOwnerRef = useRef(new Map<string, string>());
    const generationMediaOwnerRef = useRef(new Map<string, string>());
    const graphDerivedCacheRef = useRef<GraphDerivedCache | null>(null);
    const applyingHistoryRef = useRef(false);
    const historyPausedRef = useRef(false);
    const didInitialCenterRef = useRef(false);
    const rafRef = useRef<number | null>(null);
    const nodeDraggingRef = useRef(false);
    const dragRef = useRef<{
        isDraggingNode: boolean;
        hasMoved: boolean;
        startX: number;
        startY: number;
        initialSelectedNodes: { id: string; x: number; y: number }[];
        initialPositionById: Map<string, { x: number; y: number }>;
    }>({
        isDraggingNode: false,
        hasMoved: false,
        startX: 0,
        startY: 0,
        initialSelectedNodes: [],
        initialPositionById: new Map(),
    });

    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const activeWorkflowSnapshot = useWorkflowRunStore((state) => (state.activeRunId ? state.runs[state.activeRunId] || null : null));
    const hydrated = useCanvasStore((state) => state.hydrated);
    const createProject = useCanvasStore((state) => state.createProject);
    const openProject = useCanvasStore((state) => state.openProject);
    const updateProject = useCanvasStore((state) => state.updateProject);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const deleteProjects = useCanvasStore((state) => state.deleteProjects);
    const currentProjectTitle = useCanvasStore((state) => state.projects.find((project) => project.id === projectId)?.title);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const [nodes, setNodes] = useState<CanvasNodeData[]>([]);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [connectingParams, setConnectingParams] = useState<ConnectionHandle | null>(null);
    const [connectionTargetNodeId, setConnectionTargetNodeId] = useState<string | null>(null);
    const [pendingConnectionCreate, setPendingConnectionCreate] = useState<PendingConnectionCreate | null>(null);
    const [mouseWorld, setMouseWorld] = useState<Position>({ x: 0, y: 0 });
    const [selectionBox, setSelectionBox] = useState<SelectionBox | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [nodeCreatePosition, setNodeCreatePosition] = useState<Position | null>(null);
    const [runningNodeId, setRunningNodeId] = useState<string | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(false);
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>("lines");
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [clearConfirmOpen, setClearConfirmOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [editingNodeId, setEditingNodeId] = useState<string | null>(null);
    const [editRequestNonce, setEditRequestNonce] = useState(0);
    const [infoNodeId, setInfoNodeId] = useState<string | null>(null);
    const [pluginManagerOpen, setPluginManagerOpen] = useState(false);
    const [cropNodeId, setCropNodeId] = useState<string | null>(null);
    const [maskEditNodeId, setMaskEditNodeId] = useState<string | null>(null);
    const [splitNodeId, setSplitNodeId] = useState<string | null>(null);
    const [upscaleNodeId, setUpscaleNodeId] = useState<string | null>(null);
    const [superResolveNodeId, setSuperResolveNodeId] = useState<string | null>(null);
    const [angleNodeId, setAngleNodeId] = useState<string | null>(null);
    const [previewNodeId, setPreviewNodeId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [historyState, setHistoryState] = useState({ canUndo: false, canRedo: false });
    const [collapsingBatchIds, setCollapsingBatchIds] = useState<Set<string>>(new Set());
    const [openingBatchIds, setOpeningBatchIds] = useState<Set<string>>(new Set());
    const [isNodeDragging, setIsNodeDragging] = useState(false);
    const [dropTargetGroupId, setDropTargetGroupId] = useState<string | null>(null);

    const nodesRef = useRef(nodes);
    const connectionsRef = useRef(connections);
    const runtimeMediaReferencesRef = useRef<unknown>(undefined);
    runtimeMediaReferencesRef.current = { nodes, chatSessions, history: historyRef.current, lastHistory: lastHistoryRef.current };
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);
    const focusAnimRef = useRef<number | null>(null);
    const workflowExecutionRef = useRef<WorkflowExecution<CanvasResultSlotArtifact, CanvasWorkflowNodeData> | null>(null);
    const workflowObserverCleanupRef = useRef<(() => void) | null>(null);
    const runWorkflowRef = useRef<((startNodeIds: string[] | undefined, mode: WorkflowExecutionMode) => Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact>>) | null>(null);
    const continueWorkflowRef = useRef<((nodeId: string) => Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact>>) | null>(null);
    const retryWorkflowRef = useRef<((nodeId: string) => Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact>>) | null>(null);
    const stopWorkflowRef = useRef<(() => Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact> | undefined>) | null>(null);
    const resumeWorkflowRef = useRef<(() => Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact> | undefined>) | null>(null);
    const inspectWorkflowResultRef = useRef<((nodeId: string) => void) | null>(null);
    const connectingParamsRef = useRef(connectingParams);
    const connectionTargetNodeIdRef = useRef(connectionTargetNodeId);
    const selectionBoxRef = useRef(selectionBox);
    const pendingConnectionCreateRef = useRef(pendingConnectionCreate);
    const generationRequestsRef = useRef<CanvasGenerationRequestRegistry>(new Map());
    const activeProjectIdRef = useRef<string | null>(null);
    const projectRestoreVersionRef = useRef(0);
    const projectStateRef = useRef<ProjectStateSnapshot>({
        nodes,
        connections,
        chatSessions,
        activeChatId,
        backgroundMode,
        showImageInfo,
        viewport,
    });

    const getActiveGenerationBoundary = useCallback((): CanvasGenerationProjectBoundary | null => {
        const activeProjectId = activeProjectIdRef.current;
        return activeProjectId ? { projectId: activeProjectId, restoreEpoch: projectRestoreVersionRef.current } : null;
    }, []);

    const commitNodes = useCallback(
        (updater: CanvasNodeData[] | ((current: CanvasNodeData[]) => CanvasNodeData[])) => {
            const next = typeof updater === "function" ? updater(nodesRef.current) : updater;
            nodesRef.current = next;
            projectStateRef.current = { ...projectStateRef.current, nodes: next };
            setNodes(next);
            return next;
        },
        [],
    );

    const commitConnections = useCallback(
        (updater: CanvasConnection[] | ((current: CanvasConnection[]) => CanvasConnection[])) => {
            const next = typeof updater === "function" ? updater(connectionsRef.current) : updater;
            connectionsRef.current = next;
            projectStateRef.current = { ...projectStateRef.current, connections: next };
            setConnections(next);
            return next;
        },
        [],
    );

    const stageUploadedImage = useCallback(
        (image: UploadedImage) => {
            pendingUploadedImagesRef.current.set(image.storageKey, image);
            return image;
        },
        [],
    );

    const stageUploadedMedia = useCallback((file: UploadedFile) => {
        pendingUploadedMediaRef.current.set(file.storageKey, file);
        return file;
    }, []);

    const uploadCanvasImage = useCallback(async (input: string | Blob) => stageUploadedImage(await uploadImage(input)), [stageUploadedImage]);
    const discardCanvasImageUpload = useCallback(async (image: UploadedImage) => {
        const discarded = await discardUploadedImage(image);
        if (discarded) pendingUploadedImagesRef.current.delete(image.storageKey);
    }, []);
    const uploadCanvasMedia = useCallback(async (input: string | Blob, prefix: string) => stageUploadedMedia(await uploadMediaFile(input, prefix)), [stageUploadedMedia]);
    const uploadCanvasAssetFile = useCallback(async (file: File) => {
        const stored = await uploadAssetFile(file, file.name);
        pendingUploadedAssetFilesRef.current.set(stored.storageKey, stored);
        return stored;
    }, []);

    const publishPersistedCanvasUploads = useCallback((snapshot: ProjectStateSnapshot) => {
        const pendingKeys = new Set([...pendingUploadedImagesRef.current.keys(), ...pendingUploadedMediaRef.current.keys(), ...pendingUploadedAssetFilesRef.current.keys()]);
        const persistedKeys = collectStorageKeys(snapshot, (storageKey) => pendingKeys.has(storageKey));
        pendingUploadedImagesRef.current.forEach((image, storageKey) => {
            if (!persistedKeys.has(storageKey)) return;
            if (publishUploadedImage(image)) {
                pendingUploadedImagesRef.current.delete(storageKey);
                generationImageOwnerRef.current.delete(storageKey);
            }
        });
        pendingUploadedMediaRef.current.forEach((file, storageKey) => {
            if (!persistedKeys.has(storageKey)) return;
            if (publishUploadedMedia(file)) {
                pendingUploadedMediaRef.current.delete(storageKey);
                generationMediaOwnerRef.current.delete(storageKey);
            }
        });
        pendingUploadedAssetFilesRef.current.forEach((file, storageKey) => {
            if (!persistedKeys.has(storageKey)) return;
            if (publishUploadedAssetFile(file)) pendingUploadedAssetFilesRef.current.delete(storageKey);
        });
    }, []);

    useEffect(
        () =>
            registerRuntimeMediaReferenceProvider(() => ({
                project: runtimeMediaReferencesRef.current,
                clipboard: clipboardRef.current,
            })),
        [],
    );
    useEffect(() => markMediaReferencesChanged(), [chatSessions, nodes]);

    const createHistoryEntry = useCallback(
        (): CanvasHistoryEntry => ({
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
        }),
        [activeChatId, backgroundMode, chatSessions, showImageInfo],
    );

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, history: historyRef.current, lastHistory: lastHistoryRef.current });
        },
        [cleanupAssetImages],
    );

    const discardGenerationAttemptUploads = useCallback((attemptToken: string) => {
        const images: Array<{ storageKey: string; image: UploadedImage }> = [];
        generationImageOwnerRef.current.forEach((owner, storageKey) => {
            if (owner !== attemptToken) return;
            const image = pendingUploadedImagesRef.current.get(storageKey);
            if (image) images.push({ storageKey, image });
        });
        const media: Array<{ storageKey: string; file: UploadedFile }> = [];
        generationMediaOwnerRef.current.forEach((owner, storageKey) => {
            if (owner !== attemptToken) return;
            const file = pendingUploadedMediaRef.current.get(storageKey);
            if (file) media.push({ storageKey, file });
        });
        if (images.length || media.length) {
            void Promise.allSettled([
                ...images.map(({ storageKey, image }) =>
                    discardCanvasGenerationUpload(image, discardUploadedImage).then(() => {
                        if (generationImageOwnerRef.current.get(storageKey) !== attemptToken) return;
                        generationImageOwnerRef.current.delete(storageKey);
                        pendingUploadedImagesRef.current.delete(storageKey);
                    }),
                ),
                ...media.map(({ storageKey, file }) =>
                    discardCanvasGenerationUpload(file, discardUploadedMedia).then(() => {
                        if (generationMediaOwnerRef.current.get(storageKey) !== attemptToken) return;
                        generationMediaOwnerRef.current.delete(storageKey);
                        pendingUploadedMediaRef.current.delete(storageKey);
                    }),
                ),
            ]);
        }
    }, []);

    const startGenerationRequest = useCallback((targetNodeId: string, originNodeId: string, runningId = originNodeId, attempt?: CanvasGenerationAttempt) => {
        const boundary = getActiveGenerationBoundary();
        if (!boundary) throw canvasGenerationAttemptExpiredError();
        const previous = generationRequestsRef.current.get(targetNodeId);
        const lease = claimCanvasGenerationRequest(generationRequestsRef.current, { targetNodeId, originNodeId, runningNodeId: runningId, attempt, ...boundary });
        if (previous && previous.attempt.token !== lease.attempt.token) discardGenerationAttemptUploads(previous.attempt.token);
        return lease;
    }, [discardGenerationAttemptUploads, getActiveGenerationBoundary]);

    const finishGenerationRequest = useCallback((lease: CanvasGenerationRequestLease) => finishCanvasGenerationRequest(generationRequestsRef.current, lease), []);

    const isGenerationRequestCurrent = useCallback(
        (...leases: CanvasGenerationRequestLease[]) => areCanvasGenerationRequestsCurrent(generationRequestsRef.current, leases, getActiveGenerationBoundary()),
        [getActiveGenerationBoundary],
    );

    const assertGenerationRequestCurrent = useCallback(
        (...leases: CanvasGenerationRequestLease[]) => assertCanvasGenerationRequestsCurrent(generationRequestsRef.current, leases, getActiveGenerationBoundary()),
        [getActiveGenerationBoundary],
    );

    const retainGenerationImage = useCallback(async (leases: readonly CanvasGenerationRequestLease[], image: UploadedImage) => {
        const retained = await retainOwnedCanvasGenerationUpload(generationRequestsRef.current, leases, getActiveGenerationBoundary(), image, async (stale) => {
            await discardUploadedImage(stale);
            pendingUploadedImagesRef.current.delete(stale.storageKey);
            generationImageOwnerRef.current.delete(stale.storageKey);
        });
        generationImageOwnerRef.current.set(retained.storageKey, leases[0].attempt.token);
        return retained;
    }, [getActiveGenerationBoundary]);

    const retainGenerationMedia = useCallback(async (leases: readonly CanvasGenerationRequestLease[], file: UploadedFile) => {
        const retained = await retainOwnedCanvasGenerationUpload(generationRequestsRef.current, leases, getActiveGenerationBoundary(), file, async (stale) => {
            await discardUploadedMedia(stale);
            pendingUploadedMediaRef.current.delete(stale.storageKey);
            generationMediaOwnerRef.current.delete(stale.storageKey);
        });
        if (retained.storageKey) generationMediaOwnerRef.current.set(retained.storageKey, leases[0].attempt.token);
        return retained;
    }, [getActiveGenerationBoundary]);

    const stopGenerationByRunningId = useCallback((runningId: string) => {
        const attemptTokens = new Set(
            Array.from(generationRequestsRef.current.values())
                .filter((request) => request.runningNodeId === runningId)
                .map((request) => request.attempt.token),
        );
        const affectedNodeIds = cancelCanvasGenerationRequestsByRunningId(generationRequestsRef.current, runningId);
        attemptTokens.forEach(discardGenerationAttemptUploads);
        setRunningNodeId((current) => (current === runningId ? null : current));
        if (!affectedNodeIds.size) return;
        setNodes((prev) => prev.map((node) => (affectedNodeIds.has(node.id) && node.metadata?.status === NODE_STATUS_LOADING ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_IDLE, errorDetails: undefined } } : node)));
    }, [discardGenerationAttemptUploads]);

    const confirmStopGeneration = useCallback(
        (nodeId: string) => {
            modal.confirm({
                title: "停止生成？",
                content: "当前生成请求会被中断，已经生成完成的内容会保留。",
                okText: "停止",
                cancelText: "继续生成",
                okButtonProps: { danger: true },
                onOk: () => stopGenerationByRunningId(nodeId),
            });
        },
        [modal, stopGenerationByRunningId],
    );

    const flushProjectSave = useCallback(() => {
        if (projectSaveTimerRef.current) {
            clearTimeout(projectSaveTimerRef.current);
            projectSaveTimerRef.current = null;
        }
        const activeProjectId = activeProjectIdRef.current;
        if (activeProjectId) {
            pendingProjectSaveRef.current = {
                projectId: activeProjectId,
                patch: projectStateRef.current,
            };
        }
        const pending = pendingProjectSaveRef.current;
        if (!pending) return;
        pendingProjectSaveRef.current = null;
        updateProject(pending.projectId, pending.patch);
        void flushCanvasStoreWrites()
            .then(() => publishPersistedCanvasUploads(pending.patch))
            .catch((error) => console.error("Failed to finalize canvas media", error));
    }, [publishPersistedCanvasUploads, updateProject]);

    useEffect(() => {
        if (!hydrated) return;
        const restoreVersion = projectRestoreVersionRef.current + 1;
        projectRestoreVersionRef.current = restoreVersion;
        let canceled = false;
        setProjectLoaded(false);
        void workflowExecutionRef.current?.cancel("已切换画布");
        workflowExecutionRef.current = null;
        workflowObserverCleanupRef.current?.();
        workflowObserverCleanupRef.current = null;
        useWorkflowRunStore.getState().reset();
        activeProjectIdRef.current = null;
        const project = openProject(projectId);
        if (!project) {
            navigate("/canvas", { replace: true });
            return;
        }

        const commitRestore = (restoredNodes: CanvasNodeData[], restoredSessions: CanvasAssistantSession[]) => {
            if (canceled || projectRestoreVersionRef.current !== restoreVersion) return;
            const normalizedNodes = restoredNodes.map((node) => (isCanvasResultSlot(node) && node.metadata.resultSlotMode === "audio" && node.height < 180 ? { ...node, height: 180 } : node));
            const restoredState: ProjectStateSnapshot = {
                nodes: normalizedNodes,
                connections: project.connections,
                chatSessions: restoredSessions,
                activeChatId: project.activeChatId || null,
                backgroundMode: project.backgroundMode,
                showImageInfo: project.showImageInfo || false,
                viewport: project.viewport,
            };
            // 先更新同步快照，再激活项目；桌面关闭事件即使发生在 React 提交前也不会保存到错误项目。
            projectStateRef.current = restoredState;
            nodesRef.current = restoredState.nodes;
            connectionsRef.current = restoredState.connections;
            selectedNodeIdsRef.current = new Set();
            viewportRef.current = restoredState.viewport;
            activeProjectIdRef.current = projectId;
            setNodes(restoredState.nodes);
            setConnections(restoredState.connections);
            setChatSessions(restoredState.chatSessions);
            setActiveChatId(restoredState.activeChatId);
            setBackgroundMode(restoredState.backgroundMode);
            setShowImageInfo(restoredState.showImageInfo);
            setViewport(restoredState.viewport);
            historyRef.current = { past: [], future: [] };
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
            lastHistoryRef.current = snapshotHistoryEntry(restoredState);
            setHistoryState({ canUndo: false, canRedo: false });
            setProjectLoaded(true);
        };

        const restore = async () => {
            try {
                const [restoredNodes, restoredSessions] = await Promise.all([hydrateCanvasImages(resetInterruptedGeneration(project.nodes)), hydrateAssistantImages(project.chatSessions || [])]);
                commitRestore(restoredNodes, restoredSessions);
            } catch (error) {
                if (canceled || projectRestoreVersionRef.current !== restoreVersion) return;
                console.error("Failed to restore canvas media", error);
                commitRestore(resetInterruptedGeneration(project.nodes), project.chatSessions || []);
                message.warning("部分媒体暂时无法加载，画布内容已恢复");
            }
        };
        void restore();

        return () => {
            canceled = true;
            if (projectRestoreVersionRef.current === restoreVersion) projectRestoreVersionRef.current += 1;
            if (activeProjectIdRef.current === projectId) {
                pendingProjectSaveRef.current = {
                    projectId,
                    patch: projectStateRef.current,
                };
                flushProjectSave();
                activeProjectIdRef.current = null;
            }
            const generationAttemptTokens = new Set<string>();
            generationRequestsRef.current.forEach((request) => {
                generationAttemptTokens.add(request.attempt.token);
                request.attempt.controller.abort();
            });
            generationRequestsRef.current.clear();
            generationAttemptTokens.forEach(discardGenerationAttemptUploads);
            void workflowExecutionRef.current?.cancel("已离开画布");
            workflowExecutionRef.current = null;
            workflowObserverCleanupRef.current?.();
            workflowObserverCleanupRef.current = null;
        };
    }, [discardGenerationAttemptUploads, flushProjectSave, hydrated, message, navigate, openProject, projectId]);

    useEffect(() => {
        if (!projectLoaded || !["new", "recent", "choose"].includes(searchParams.get("mode") || "")) return;
        openAgentPanel();
    }, [openAgentPanel, projectLoaded, searchParams]);

    useEffect(() => {
        if (!projectLoaded || applyingHistoryRef.current || historyPausedRef.current) return;
        const next = createHistoryEntry();
        const previous = lastHistoryRef.current;
        if (previous && entriesMatchForHistory(previous, next)) return;

        if (historyCommitTimerRef.current) clearTimeout(historyCommitTimerRef.current);
        historyCommitTimerRef.current = setTimeout(() => {
            if (applyingHistoryRef.current || historyPausedRef.current) {
                historyCommitTimerRef.current = null;
                return;
            }
            const current = createHistoryEntry();
            const last = lastHistoryRef.current;
            if (!last || entriesMatchForHistory(last, current)) {
                historyCommitTimerRef.current = null;
                return;
            }
            historyRef.current.past = [...historyRef.current.past.slice(-49), last];
            historyRef.current.future = [];
            setHistoryState({ canUndo: true, canRedo: false });
            lastHistoryRef.current = snapshotHistoryEntry(current);
            historyCommitTimerRef.current = null;
        }, 180);

        return () => {
            if (historyCommitTimerRef.current) {
                clearTimeout(historyCommitTimerRef.current);
                historyCommitTimerRef.current = null;
            }
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, createHistoryEntry, nodes, projectLoaded, showImageInfo]);

    useEffect(() => {
        if (!projectLoaded || historyPausedRef.current || activeProjectIdRef.current !== projectId) return;
        pendingProjectSaveRef.current = {
            projectId,
            patch: projectStateRef.current,
        };
        if (projectSaveTimerRef.current) clearTimeout(projectSaveTimerRef.current);
        projectSaveTimerRef.current = setTimeout(flushProjectSave, 700);
    }, [activeChatId, backgroundMode, chatSessions, connections, flushProjectSave, nodes, projectId, projectLoaded, showImageInfo, viewport]);

    useEffect(() => {
        const handlePageHide = () => flushProjectSave();
        window.addEventListener("pagehide", handlePageHide);
        return () => {
            window.removeEventListener("pagehide", handlePageHide);
            flushProjectSave();
        };
    }, [flushProjectSave]);

    useEffect(
        () =>
            registerDesktopFlusher(async () => {
                flushProjectSave();
                await flushCanvasStoreWrites();
            }),
        [flushProjectSave],
    );

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
        connectingParamsRef.current = connectingParams;
        connectionTargetNodeIdRef.current = connectionTargetNodeId;
        pendingConnectionCreateRef.current = pendingConnectionCreate;
        projectStateRef.current = {
            nodes,
            connections,
            chatSessions,
            activeChatId,
            backgroundMode,
            showImageInfo,
            viewport,
        };
    }, [activeChatId, backgroundMode, chatSessions, connections, connectingParams, connectionTargetNodeId, nodes, pendingConnectionCreate, selectedNodeIds, showImageInfo, viewport]);

    useEffect(() => {
        setNodes((current) => {
            let changed = false;
            const fitted = current.map((node) => {
                const next = fitCanvasResultSlotToContent(node);
                if (next !== node) changed = true;
                return next;
            });
            return changed ? fitted : current;
        });
    }, [nodes]);

    useLayoutEffect(() => {
        selectionBoxRef.current = selectionBox;
    }, [selectionBox]);

    useEffect(() => {
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize({ width: rect.width, height: rect.height });
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                setViewport({ x: rect.width / 2, y: rect.height / 2, k: 1 });
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, []);

    const screenToCanvas = useCallback((clientX: number, clientY: number) => {
        const rect = containerRef.current?.getBoundingClientRect();
        const currentViewport = viewportRef.current;
        const localX = clientX - (rect?.left || 0);
        const localY = clientY - (rect?.top || 0);

        return {
            x: (localX - currentViewport.x) / currentViewport.k,
            y: (localY - currentViewport.y) / currentViewport.k,
        };
    }, []);

    const handleViewportChange = useCallback((next: ViewportTransform) => {
        viewportRef.current = next;
        setViewport(next);
        setContextMenu((current) => (current ? null : current));
    }, []);

    const handleCanvasDoubleClick = useCallback(
        (event: ReactMouseEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(screenToCanvas(event.clientX, event.clientY));
        },
        [screenToCanvas],
    );

    const getCanvasCenter = useCallback(() => {
        const rect = containerRef.current?.getBoundingClientRect();
        return screenToCanvas((rect?.left || 0) + (rect?.width || size.width) / 2, (rect?.top || 0) + (rect?.height || size.height) / 2);
    }, [screenToCanvas, size.height, size.width]);

    const setConnecting = useCallback((next: ConnectionHandle | null) => {
        connectingParamsRef.current = next;
        setConnectingParams(next);
        if (!next) {
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
        }
    }, []);

    const keepNodeToolbar = useCallback(
        (nodeId: string) => {
            if (nodeDraggingRef.current || nodeImageSettingsOpen || !selectedNodeIdsRef.current.has(nodeId)) return;
            setToolbarNodeId(nodeId);
        },
        [nodeImageSettingsOpen],
    );

    const hideNodeToolbar = useCallback(() => {}, []);

    const connectNodes = useCallback(
        (current: ConnectionHandle, targetNodeId: string) => {
            if (current.nodeId === targetNodeId) return;

            const connection = normalizeConnection(current.nodeId, targetNodeId, nodesRef.current, current.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            const { fromNodeId, toNodeId } = connection;
            const exists = connectionsRef.current.some((conn) => conn.fromNodeId === fromNodeId && conn.toNodeId === toNodeId);
            if (!exists) {
                setConnections((prev) => [...prev, { id: `conn-${Date.now()}`, fromNodeId, toNodeId }]);
            }
            setContextMenu(null);
        },
        [message],
    );

    const createConnectedNode = useCallback(
        (type: CanvasNodeType.Image | CanvasNodeType.Text | CanvasNodeType.Config | CanvasNodeType.Video | CanvasNodeType.Audio | CanvasNodeType.Terminal, pending: PendingConnectionCreate) => {
            const metadata = type === CanvasNodeType.Config ? { model: effectiveConfig.imageModel || effectiveConfig.model, size: effectiveConfig.size, count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count) } : undefined;
            const newNode = createCanvasNode(type, pending.position, metadata);
            const connection = normalizeConnection(pending.connection.nodeId, newNode.id, [...nodesRef.current, newNode], pending.connection.handleType);
            if (!connection) {
                message.warning("配置节点之间不能连接");
                return;
            }
            setNodes((prev) => [...prev, newNode]);
            setConnections((prev) => [...prev, { id: nanoid(), ...connection }]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            if (type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio) setDialogNodeId(newNode.id);
            setPendingConnectionCreate(null);
            setConnecting(null);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message, setConnecting],
    );

    const cancelPendingConnectionCreate = useCallback(() => {
        setPendingConnectionCreate(null);
        setConnecting(null);
    }, [setConnecting]);

    const getConnectionDropTarget = useCallback(
        (clientX: number, clientY: number, current: ConnectionHandle): ConnectionDropTarget => {
            const world = screenToCanvas(clientX, clientY);
            const scale = Math.max(viewportRef.current.k, 0.05);
            const padding = CONNECTION_NODE_HIT_PADDING / scale;
            const handleRadius = CONNECTION_HANDLE_HIT_RADIUS / scale;
            let isNearNode = false;
            let bestNodeId: string | null = null;
            let bestPriority = Number.POSITIVE_INFINITY;

            [...nodesRef.current]
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .reverse()
                .forEach((node) => {
                    const anchor = getConnectionTargetAnchor(node, current);
                    const dx = world.x - anchor.x;
                    const dy = world.y - anchor.y;
                    const hitsHandle = dx * dx + dy * dy <= handleRadius * handleRadius;
                    const hitsInside = world.x >= node.position.x && world.x <= node.position.x + node.width && world.y >= node.position.y && world.y <= node.position.y + node.height;
                    const hitsExpanded = world.x >= node.position.x - padding && world.x <= node.position.x + node.width + padding && world.y >= node.position.y - padding && world.y <= node.position.y + node.height + padding;

                    if (!hitsHandle && !hitsInside && !hitsExpanded) return;
                    isNearNode = true;
                    if (node.id === current.nodeId || !normalizeConnection(current.nodeId, node.id, nodesRef.current, current.handleType)) return;

                    const priority = hitsInside ? 0 : hitsHandle ? 1 : 2;
                    if (priority < bestPriority) {
                        bestNodeId = node.id;
                        bestPriority = priority;
                    }
                });

            return { nodeId: bestNodeId, isNearNode };
        },
        [screenToCanvas],
    );

    const viewportBounds = useMemo(() => {
        const padding = 280;
        const scale = Math.max(viewport.k, 0.05);
        const left = -viewport.x / scale - padding;
        const top = -viewport.y / scale - padding;
        return {
            left,
            top,
            right: left + size.width / scale + padding * 2,
            bottom: top + size.height / scale + padding * 2,
        };
    }, [size.height, size.width, viewport.k, viewport.x, viewport.y]);

    const { visibleNodes, viewportVisibleNodeIds } = useMemo(() => {
        const viewportVisibleNodeIds = new Set<string>();
        const visibleNodes = nodes.filter((node) => {
            if (isHiddenBatchChild(node, nodes, collapsingBatchIds)) return false;
            const isViewportVisible = node.position.x + node.width > viewportBounds.left && node.position.x < viewportBounds.right && node.position.y + node.height > viewportBounds.top && node.position.y < viewportBounds.bottom;
            if (isViewportVisible) viewportVisibleNodeIds.add(node.id);
            // Terminal components stay mounted so their PTY/data flow survives panning,
            // while CanvasNode unloads the expensive XTerm view outside the viewport.
            return node.type === CanvasNodeType.Terminal || isViewportVisible;
        });
        return { visibleNodes, viewportVisibleNodeIds };
    }, [collapsingBatchIds, nodes, viewportBounds]);

    const nodeById = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
    // 工具条跟随「单选节点」:点击/新建/框选/键盘选中任一节点都会显示,不再仅靠精确点中触发。
    // 多选时不显示;拖拽中由下方 isNodeDragging 守卫隐藏。
    const singleSelectedNodeId = selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null;
    const toolbarNode = (toolbarNodeId ? nodeById.get(toolbarNodeId) || null : null) || (singleSelectedNodeId ? nodeById.get(singleSelectedNodeId) || null : null);
    const infoNode = infoNodeId ? nodeById.get(infoNodeId) || null : null;
    const cropNode = cropNodeId ? nodeById.get(cropNodeId) || null : null;
    const maskEditNode = maskEditNodeId ? nodeById.get(maskEditNodeId) || null : null;
    const splitNode = splitNodeId ? nodeById.get(splitNodeId) || null : null;
    const upscaleNode = upscaleNodeId ? nodeById.get(upscaleNodeId) || null : null;
    const superResolveNode = superResolveNodeId ? nodeById.get(superResolveNodeId) || null : null;
    const angleNode = angleNodeId ? nodeById.get(angleNodeId) || null : null;
    const previewNode = previewNodeId ? nodeById.get(previewNodeId) || null : null;
    const hasMultipleSelectedNodes = selectedNodeIds.size > 1;
    const activeNodeId = hasMultipleSelectedNodes ? null : hoveredNodeId || (selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null);
    const batchChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            if (node.metadata?.isBatchRoot) map.set(node.id, node.metadata.batchChildIds?.length || 0);
        });
        return map;
    }, [nodes]);
    const groupChildCountById = useMemo(() => {
        const map = new Map<string, number>();
        nodes.forEach((node) => {
            const groupId = node.metadata?.groupId;
            if (groupId) map.set(groupId, (map.get(groupId) || 0) + 1);
        });
        return map;
    }, [nodes]);
    const batchMotionById = useMemo(() => {
        const map = new Map<string, { x: number; y: number; index: number }>();
        nodes.forEach((node) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return;
            const root = nodeById.get(rootId);
            const index = root?.metadata?.batchChildIds?.indexOf(node.id) ?? 0;
            const stackX = root ? root.position.x + 34 + index * 14 : node.position.x;
            const stackY = root ? root.position.y + 14 + index * 8 : node.position.y;
            map.set(node.id, { x: stackX - node.position.x, y: stackY - node.position.y, index: Math.max(index, 0) });
        });
        return map;
    }, [nodeById, nodes]);
    const relatedHighlight = useMemo(() => {
        const nodeIds = new Set<string>();
        const connectionIds = new Set<string>();

        if (!activeNodeId) return { nodeIds, connectionIds };

        nodeIds.add(activeNodeId);
        connections.forEach((connection) => {
            if (connection.fromNodeId !== activeNodeId && connection.toNodeId !== activeNodeId) return;
            connectionIds.add(connection.id);
            nodeIds.add(connection.fromNodeId);
            nodeIds.add(connection.toNodeId);
        });

        return { nodeIds, connectionIds };
    }, [activeNodeId, connections]);
    const visibleConnections = useMemo(() => {
        const items: Array<{ connection: CanvasConnection; from: CanvasNodeData; to: CanvasNodeData; active: boolean }> = [];
        const isHiddenEndpoint = (node: CanvasNodeData) => {
            const rootId = node.metadata?.batchRootId;
            if (!rootId) return false;
            const root = nodeById.get(rootId);
            return Boolean(root && !root.metadata?.imageBatchExpanded);
        };

        connections.forEach((connection) => {
            const from = nodeById.get(connection.fromNodeId);
            const to = nodeById.get(connection.toNodeId);
            if (!from || !to || isHiddenEndpoint(from) || isHiddenEndpoint(to)) return;

            const active = selectedConnectionId === connection.id || relatedHighlight.connectionIds.has(connection.id);
            if (!active) {
                const startX = from.position.x + from.width;
                const startY = from.position.y + from.height / 2;
                const endX = to.position.x;
                const endY = to.position.y + to.height / 2;
                const curvature = Math.max(Math.abs(endX - startX) * 0.5, 50);
                const minX = Math.min(startX, startX + curvature, endX - curvature, endX);
                const maxX = Math.max(startX, startX + curvature, endX - curvature, endX);
                const minY = Math.min(startY, endY);
                const maxY = Math.max(startY, endY);
                if (maxX < viewportBounds.left || minX > viewportBounds.right || maxY < viewportBounds.top || minY > viewportBounds.bottom) return;
            }

            items.push({ connection, from, to, active });
        });

        return items;
    }, [connections, nodeById, relatedHighlight.connectionIds, selectedConnectionId, viewportBounds]);

    const graphDerived = graphDerivedCacheRef.current;
    const graphInputsChanged =
        !graphDerived ||
        graphDerived.registryVersion !== nodeRegistryVersion ||
        graphDerived.connections !== connections ||
        graphDerived.nodeSignatures.size !== nodes.length ||
        nodes.some((node) => !graphNodeSemanticsMatch(graphDerived.nodeSignatures.get(node.id), node));
    if (graphInputsChanged) {
        const configInputs = graphDerived?.configInputs || new Map<string, NodeGenerationInput[]>();
        const mentionReferences = graphDerived?.mentionReferences || new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
        const activeNodeIds = new Set(nodes.map((node) => node.id));
        for (const nodeId of configInputs.keys()) {
            if (!activeNodeIds.has(nodeId)) configInputs.delete(nodeId);
        }
        for (const nodeId of mentionReferences.keys()) {
            if (!activeNodeIds.has(nodeId)) mentionReferences.delete(nodeId);
        }
        nodes.forEach((node) => {
            if (node.type === CanvasNodeType.Config) {
                const nextInputs = buildNodeGenerationInputs(node.id, nodes, connections);
                if (!generationInputsMatch(configInputs.get(node.id), nextInputs)) configInputs.set(node.id, nextInputs);
            } else {
                configInputs.delete(node.id);
            }
            const nextReferences = node.type === CanvasNodeType.Terminal ? buildTerminalInputReferences(node, nodes, connections) : buildNodeMentionReferences(node, nodes, connections);
            if (!resourceReferencesMatch(mentionReferences.get(node.id), nextReferences)) mentionReferences.set(node.id, nextReferences);
        });
        graphDerivedCacheRef.current = {
            connections,
            registryVersion: nodeRegistryVersion,
            nodeSignatures: new Map(nodes.map((node) => [node.id, graphNodeSemanticSignature(node)])),
            configInputs,
            mentionReferences,
        };
    }
    const configInputsById = graphDerivedCacheRef.current?.configInputs || new Map<string, NodeGenerationInput[]>();
    const mentionReferencesByNodeId = graphDerivedCacheRef.current?.mentionReferences || new Map<string, ReturnType<typeof buildNodeMentionReferences>>();
    const { applyAgentOps } = useAgentBridge({
        projectId,
        projectEpoch: projectRestoreVersionRef.current,
        ready: projectLoaded && activeProjectIdRef.current === projectId,
        title: currentProjectTitle,
        nodes,
        connections,
        selectedNodeIds,
        viewport,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        viewportRef,
        runWorkflowRef,
        continueWorkflowRef,
        retryWorkflowRef,
        stopWorkflowRef,
        resumeWorkflowRef,
        inspectWorkflowResultRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setViewport,
        setContextMenu,
        setDialogNodeId,
    });

    const { pluginHost, renderPluginPanel, buildNodeToolbarItems } = usePluginHost({
        effectiveConfig,
        isAiConfigReady,
        openConfigDialog,
        theme,
        nodesRef,
        connectionsRef,
        viewportRef,
        setNodes,
        setDialogNodeId,
        applyAgentOps,
        storeImage: uploadCanvasImage,
        discardImage: discardCanvasImageUpload,
        resolveImage: resolveImageUrl,
    });
    const createNode = useCallback(
        (type: CanvasNodeTypeId, position?: Position) => {
            const targetPosition = position || getCanvasCenter();
            const configMetadata =
                type === CanvasNodeType.Config
                    ? {
                          model: effectiveConfig.imageModel || effectiveConfig.model,
                          size: effectiveConfig.size,
                          count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                      }
                    : undefined;
            const newNode = createCanvasNode(type, targetPosition, configMetadata);

            setNodes((prev) => [...prev, newNode]);
            setSelectedNodeIds(new Set([newNode.id]));
            setSelectedConnectionId(null);
            const definition = getNodeDefinition(type);
            // 纯展示型插件节点(hidePanel)不弹面板;插件自定义 Panel 需显式 autoOpenPanel 才在新建时打开;
            // 声明了 useBuiltinPanel 的插件节点复用内置生成面板,新建即打开(与图片节点一致);
            // 内置的图片/视频/配置类节点保持原有「新建即打开生图面板」行为。
            const wantsPanel = definition?.hidePanel
                ? false
                : definition?.Panel
                  ? Boolean(definition.autoOpenPanel)
                  : definition?.useBuiltinPanel
                    ? true
                    : isBuiltinType(type) && type !== CanvasNodeType.Text && type !== CanvasNodeType.Audio && type !== CanvasNodeType.Group;
            if (wantsPanel) setDialogNodeId(newNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, getCanvasCenter],
    );

    const deleteNodes = useCallback(
        (ids: Set<string>) => {
            if (!ids.size) return;
            const allIds = new Set(ids);
            nodesRef.current.forEach((node) => {
                if (ids.has(node.id)) node.metadata?.batchChildIds?.forEach((childId) => allIds.add(childId));
            });
            const canceledAttemptTokens = new Set<string>();
            generationRequestsRef.current.forEach((request) => {
                if (allIds.has(request.targetNodeId) || allIds.has(request.originNodeId)) canceledAttemptTokens.add(request.attempt.token);
            });
            generationRequestsRef.current.forEach((request) => {
                if (!canceledAttemptTokens.has(request.attempt.token)) return;
                request.attempt.controller.abort();
                generationRequestsRef.current.delete(request.targetNodeId);
            });
            canceledAttemptTokens.forEach(discardGenerationAttemptUploads);
            setNodes((prev) => {
                const next = prev.filter((node) => !allIds.has(node.id));
                return next.map((node) => {
                    const groupId = node.metadata?.groupId;
                    if (groupId && allIds.has(groupId)) return { ...node, metadata: { ...node.metadata, groupId: undefined } };
                    const childIds = node.metadata?.batchChildIds?.filter((childId) => !allIds.has(childId));
                    if (!node.metadata?.isBatchRoot || childIds?.length === node.metadata.batchChildIds?.length) return node;
                    const primaryImageId = childIds?.includes(node.metadata.primaryImageId || "") ? node.metadata.primaryImageId : childIds?.[0];
                    const primaryNode = next.find((item) => item.id === primaryImageId);
                    return {
                        ...node,
                        metadata: {
                            ...node.metadata,
                            batchChildIds: childIds,
                            primaryImageId,
                            content: primaryNode?.metadata?.content || node.metadata.content,
                            naturalWidth: primaryNode?.metadata?.naturalWidth || node.metadata.naturalWidth,
                            naturalHeight: primaryNode?.metadata?.naturalHeight || node.metadata.naturalHeight,
                        },
                    };
                });
            });
            setConnections((prev) => prev.filter((conn) => !allIds.has(conn.fromNodeId) && !allIds.has(conn.toNodeId)));
            setSelectedNodeIds(new Set());
            setSelectedConnectionId(null);
            setHoveredNodeId((current) => (current && allIds.has(current) ? null : current));
            setToolbarNodeId((current) => (current && allIds.has(current) ? null : current));
            setDialogNodeId((current) => (current && allIds.has(current) ? null : current));
            setEditingNodeId((current) => (current && allIds.has(current) ? null : current));
            setInfoNodeId((current) => (current && allIds.has(current) ? null : current));
            setCropNodeId((current) => (current && allIds.has(current) ? null : current));
            setMaskEditNodeId((current) => (current && allIds.has(current) ? null : current));
            setAngleNodeId((current) => (current && allIds.has(current) ? null : current));
            setPreviewNodeId((current) => (current && allIds.has(current) ? null : current));
            setRunningNodeId((current) => (current && allIds.has(current) ? null : current));
            setContextMenu((current) => (current?.type === "node" && allIds.has(current.nodeId) ? null : current));
            cleanupCanvasFiles({ projectId, nodes: nodesRef.current.filter((node) => !allIds.has(node.id)), chatSessions });
        },
        [chatSessions, cleanupCanvasFiles, discardGenerationAttemptUploads, projectId],
    );

    const deleteConnection = useCallback((connectionId: string) => {
        setConnections((prev) => prev.filter((conn) => conn.id !== connectionId));
        setSelectedConnectionId((current) => (current === connectionId ? null : current));
        setContextMenu((current) => (current?.type === "connection" && current.connectionId === connectionId ? null : current));
    }, []);

    const selectConnection = useCallback((connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setSelectedNodeIds(new Set());
        setContextMenu(null);
    }, []);

    const openConnectionContextMenu = useCallback((event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
        setSelectedConnectionId(connectionId);
        setSelectedNodeIds(new Set());
        setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
    }, []);

    const deselectCanvas = useCallback(() => {
        cancelPendingConnectionCreate();
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setSelectionBox(null);
        setHoveredNodeId(null);
        setToolbarNodeId(null);
        setDialogNodeId(null);
        setEditingNodeId(null);
    }, [cancelPendingConnectionCreate]);

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        setInfoNodeId(null);
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAngleNodeId(null);
        setPreviewNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        setClearConfirmOpen(false);
        cleanupCanvasFiles({ projectId, nodes: [], chatSessions: [] });
    }, [cleanupCanvasFiles, deselectCanvas, projectId]);

    const duplicateNode = useCallback((nodeId: string) => {
        const source = nodesRef.current.find((node) => node.id === nodeId);
        if (!source) return;

        const id = `${source.type}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const next: CanvasNodeData = {
            ...source,
            id,
            title: `${source.title} Copy`,
            position: { x: source.position.x + 36, y: source.position.y + 36 },
        };

        setNodes((prev) => [...prev, next]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        if (next.type !== CanvasNodeType.Group) setDialogNodeId(id);
    }, []);

    const copySelectedNodes = useCallback(() => {
        const selectedIds = selectedNodeIdsRef.current;
        if (!selectedIds.size) return;

        const copiedNodes = nodesRef.current
            .filter((node) => selectedIds.has(node.id))
            .map((node) => ({
                ...node,
                position: { ...node.position },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            }));

        if (!copiedNodes.length) return;

        clipboardRef.current = {
            nodes: copiedNodes,
            connections: connectionsRef.current.filter((connection) => selectedIds.has(connection.fromNodeId) && selectedIds.has(connection.toNodeId)).map((connection) => ({ ...connection })),
        };
        markMediaReferencesChanged();
    }, []);

    const pasteCopiedNodes = useCallback(() => {
        const clipboard = clipboardRef.current;
        if (!clipboard?.nodes.length) return false;

        const center = getCanvasCenter();
        const bounds = clipboard.nodes.reduce(
            (acc, node) => ({
                left: Math.min(acc.left, node.position.x),
                top: Math.min(acc.top, node.position.y),
                right: Math.max(acc.right, node.position.x + node.width),
                bottom: Math.max(acc.bottom, node.position.y + node.height),
            }),
            { left: Infinity, top: Infinity, right: -Infinity, bottom: -Infinity },
        );
        const dx = center.x - (bounds.left + bounds.right) / 2;
        const dy = center.y - (bounds.top + bounds.bottom) / 2;
        const idMap = new Map<string, string>();
        const nextNodes = clipboard.nodes.map((node, index) => {
            const id = `${node.type}-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`;
            idMap.set(node.id, id);
            return {
                ...node,
                id,
                title: node.title.endsWith(" Copy") ? node.title : `${node.title} Copy`,
                position: {
                    x: node.position.x + dx,
                    y: node.position.y + dy,
                },
                metadata: node.metadata ? { ...node.metadata } : undefined,
            };
        });

        const pastedNodes = nextNodes.map((node) => {
            const groupId = node.metadata?.groupId;
            if (!groupId) return node;
            return { ...node, metadata: { ...node.metadata, groupId: idMap.get(groupId) } };
        });

        const nextConnections = clipboard.connections.flatMap((connection, index) => {
            const fromNodeId = idMap.get(connection.fromNodeId);
            const toNodeId = idMap.get(connection.toNodeId);
            if (!fromNodeId || !toNodeId) return [];
            return [
                {
                    ...connection,
                    id: `conn-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 7)}`,
                    fromNodeId,
                    toNodeId,
                },
            ];
        });

        setNodes((prev) => [...prev, ...pastedNodes]);
        setConnections((prev) => [...prev, ...nextConnections]);
        setSelectedNodeIds(new Set(pastedNodes.map((node) => node.id)));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(pastedNodes[0]?.type === CanvasNodeType.Group ? null : pastedNodes[0]?.id || null);
        return true;
    }, [getCanvasCenter]);

    const resetViewport = useCallback(() => {
        setViewport({ x: size.width / 2, y: size.height / 2, k: 1 });
        setContextMenu(null);
    }, [size.height, size.width]);

    const focusNode = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (!node) return;
            const worldX = node.position.x + node.width / 2;
            const worldY = node.position.y + node.height / 2;
            const k = Math.min(Math.max(Math.min((size.width * 0.6) / node.width, (size.height * 0.6) / node.height), 0.05), 1.5);
            const target = { x: size.width / 2 - worldX * k, y: size.height / 2 - worldY * k, k };
            setSelectedNodeIds(new Set([nodeId]));
            setSelectedConnectionId(null);
            setContextMenu(null);

            if (focusAnimRef.current) cancelAnimationFrame(focusAnimRef.current);
            const start = { ...viewportRef.current };
            const duration = 450;
            const easeOutCubic = (t: number) => 1 - Math.pow(1 - t, 3);
            let startTime: number | null = null;
            const step = (now: number) => {
                if (startTime === null) startTime = now;
                const progress = Math.min((now - startTime) / duration, 1);
                const t = easeOutCubic(progress);
                setViewport({ x: start.x + (target.x - start.x) * t, y: start.y + (target.y - start.y) * t, k: start.k + (target.k - start.k) * t });
                focusAnimRef.current = progress < 1 ? requestAnimationFrame(step) : null;
            };
            focusAnimRef.current = requestAnimationFrame(step);
        },
        [size.height, size.width],
    );

    useEffect(() => () => void (focusAnimRef.current && cancelAnimationFrame(focusAnimRef.current)), []);

    const setZoomScale = useCallback(
        (scale: number) => {
            const nextScale = Math.min(Math.max(scale, 0.05), 5);
            setViewport((prev) => ({
                x: size.width / 2 - ((size.width / 2 - prev.x) / prev.k) * nextScale,
                y: size.height / 2 - ((size.height / 2 - prev.y) / prev.k) * nextScale,
                k: nextScale,
            }));
            setContextMenu(null);
        },
        [size.height, size.width],
    );

    const applyHistory = useCallback((entry: CanvasHistoryEntry) => {
        if (historyCommitTimerRef.current) {
            clearTimeout(historyCommitTimerRef.current);
            historyCommitTimerRef.current = null;
        }
        applyingHistoryRef.current = true;
        setNodes(mergeCurrentRuntimeMetadata(entry.nodes, nodesRef.current));
        setConnections(entry.connections);
        setChatSessions(entry.chatSessions);
        setActiveChatId(entry.activeChatId);
        setBackgroundMode(entry.backgroundMode);
        setShowImageInfo(entry.showImageInfo);
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
        setContextMenu(null);
        setTimeout(() => {
            lastHistoryRef.current = entry;
            applyingHistoryRef.current = false;
            setHistoryState({ canUndo: historyRef.current.past.length > 0, canRedo: historyRef.current.future.length > 0 });
        });
    }, []);

    const undoCanvas = useCallback(() => {
        const previous = historyRef.current.past.pop();
        const current = lastHistoryRef.current;
        if (!previous || !current) return;
        historyRef.current.future.push(current);
        applyHistory(previous);
    }, [applyHistory]);

    const redoCanvas = useCallback(() => {
        const next = historyRef.current.future.pop();
        const current = lastHistoryRef.current;
        if (!next || !current) return;
        historyRef.current.past.push(current);
        applyHistory(next);
    }, [applyHistory]);

    const createAndOpenProject = useCallback(() => {
        const id = createProject(`工作流 ${useCanvasStore.getState().projects.length + 1}`);
        navigate(`/canvas/${id}`);
    }, [createProject, navigate]);

    const deleteCurrentProject = useCallback(() => {
        deleteProjects([projectId]);
        cleanupAssetImages();
        navigate("/canvas");
    }, [cleanupAssetImages, deleteProjects, navigate, projectId]);

    const exportCurrentProject = useCallback(async () => {
        const project = useCanvasStore.getState().projects.find((item) => item.id === projectId);
        if (!project) return message.error("未找到当前画布");
        const hide = message.loading("正在导出当前画布…", 0);
        try {
            await exportCanvasProjects([project], project.title || "WorkflowGenerator");
            message.success("已导出当前画布");
        } catch (error) {
            console.error(error);
            message.error("导出失败，请重试");
        } finally {
            hide();
        }
    }, [message, projectId]);

    const handleCanvasMouseDown = useCallback(
        (event: ReactPointerEvent<HTMLDivElement>) => {
            setContextMenu(null);
            setNodeCreatePosition(null);
            if (pendingConnectionCreateRef.current) cancelPendingConnectionCreate();
            if (event.button !== 0) return;

            if (!event.ctrlKey && !event.metaKey) {
                setSelectionBox(null);
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const nextSelectionBox = {
                startWorldX: world.x,
                startWorldY: world.y,
                currentWorldX: world.x,
                currentWorldY: world.y,
                additive: event.shiftKey,
                initialSelectedNodeIds: event.shiftKey ? Array.from(selectedNodeIdsRef.current) : [],
            };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            if (!event.shiftKey) {
                setSelectedNodeIds(new Set());
            }

            setSelectedConnectionId(null);
        },
        [cancelPendingConnectionCreate, screenToCanvas],
    );

    // 仅处理「选中」的纯逻辑,供 body 冒泡拖拽入口与外层 capture 入口共用。
    // 返回本次点击后的单选目标 id(多选/取消时为 null),用于同步工具条。
    const selectNodeByEvent = useCallback((event: Pick<ReactMouseEvent, "shiftKey" | "metaKey" | "ctrlKey">, nodeId: string) => {
        const nextSelected = new Set(selectedNodeIdsRef.current);
        if (event.shiftKey || event.metaKey || event.ctrlKey) {
            if (nextSelected.has(nodeId)) nextSelected.delete(nodeId);
            else nextSelected.add(nodeId);
        } else if (!nextSelected.has(nodeId)) {
            nextSelected.clear();
            nextSelected.add(nodeId);
        }
        setSelectedNodeIds(nextSelected);
        const soloId = nextSelected.size === 1 && nextSelected.has(nodeId) ? nodeId : null;
        setToolbarNodeId(soloId);
        return { nextSelected, soloId };
    }, []);

    // capture 阶段选中:点击节点内部任意元素(含吞掉 mousedown 的 textarea/iframe)都能选中并弹出工具条。
    // 只做选中,不启动拖拽 —— 拖拽仍由 body 的 onMouseDown(冒泡)负责,故编辑器内选词不会拖动节点。
    // capture 必先于同一次事件的 body 冒泡触发,故把算好的选中集暂存,供紧随其后的拖拽入口复用,避免二次选中(shift 反选被抵消)。
    const pendingSelectionRef = useRef<Set<string> | null>(null);
    const handleNodeSelectCapture = useCallback(
        (event: ReactMouseEvent, nodeId: string) => {
            if (event.button !== 0) return;
            setContextMenu(null);
            setHoveredNodeId(null);
            setSelectedConnectionId(null);
            const { nextSelected } = selectNodeByEvent(event, nodeId);
            pendingSelectionRef.current = nextSelected;
        },
        [selectNodeByEvent],
    );

    const handleNodeMouseDown = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.stopPropagation();
        // 选中已由 capture 阶段完成;这里只负责建立拖拽。若因故没走 capture,则兜底再选一次。
        const currentNodes = nodesRef.current;
        const nextSelected = pendingSelectionRef.current ?? selectNodeByEvent(event, nodeId).nextSelected;
        pendingSelectionRef.current = null;
        const dragIds = new Set(nextSelected);
        currentNodes.forEach((node) => {
            if (!nextSelected.has(node.id)) return;
            node.metadata?.batchChildIds?.forEach((childId) => dragIds.add(childId));
            if (node.type === CanvasNodeType.Group) {
                currentNodes.forEach((child) => {
                    if (child.metadata?.groupId === node.id) dragIds.add(child.id);
                });
            }
        });
        const initialSelectedNodes = currentNodes.filter((node) => dragIds.has(node.id)).map((node) => ({ id: node.id, x: node.position.x, y: node.position.y }));
        dragRef.current = {
            isDraggingNode: true,
            hasMoved: false,
            startX: event.clientX,
            startY: event.clientY,
            initialSelectedNodes,
            initialPositionById: new Map(initialSelectedNodes.map(({ id, x, y }) => [id, { x, y }])),
        };
        historyPausedRef.current = true;
        nodeDraggingRef.current = true;
        setIsNodeDragging(true);
    }, []);

    const finishNodeDrag = useCallback((clientX?: number, clientY?: number) => {
        if (rafRef.current) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
        }
        if (!dragRef.current.isDraggingNode) return;

        const wasClick = !dragRef.current.hasMoved && dragRef.current.initialSelectedNodes.length === 1;
        const clickedNodeId = dragRef.current.initialSelectedNodes[0]?.id;
        const currentViewport = viewportRef.current;
        const dx = clientX == null ? 0 : (clientX - dragRef.current.startX) / currentViewport.k;
        const dy = clientY == null ? 0 : (clientY - dragRef.current.startY) / currentViewport.k;
        const initialPositions = dragRef.current.initialSelectedNodes;
        const initialPositionById = dragRef.current.initialPositionById;

        historyPausedRef.current = false;
        nodeDraggingRef.current = false;
        setIsNodeDragging(false);
        setDropTargetGroupId(null);
        if (dragRef.current.hasMoved && clientX != null && clientY != null) {
            const movedIds = new Set(initialPositions.map((item) => item.id));
            setNodes((prev) => {
                const moved = prev.map((node) => {
                    const initial = initialPositionById.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                const targetGroup = findGroupDropTarget(movedIds, moved);
                if (targetGroup) return snapNodesIntoGroup(movedIds, moved, targetGroup);
                return moved.map((node) => {
                    if (!movedIds.has(node.id) || node.type === CanvasNodeType.Group) return node;
                    const groupId = findContainingGroupId(node, moved);
                    if (node.metadata?.groupId === groupId) return node;
                    return { ...node, metadata: { ...node.metadata, groupId } };
                });
            });
        }

        dragRef.current.isDraggingNode = false;
        dragRef.current.hasMoved = false;
        dragRef.current.initialSelectedNodes = [];
        dragRef.current.initialPositionById = new Map();
        if (wasClick && clickedNodeId) {
            const clickedNode = nodesRef.current.find((node) => node.id === clickedNodeId);
            const clickedDefinition = clickedNode ? getNodeDefinition(clickedNode.type) : undefined;
            if (clickedNode?.type === CanvasNodeType.Text) {
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type === CanvasNodeType.Terminal && clickedNode.metadata?.terminalConfigured === false) {
                setDialogNodeId(clickedNodeId);
            } else if (clickedDefinition?.hidePanel || clickedNode?.type === CanvasNodeType.Terminal) {
                // 纯展示型插件节点:单击只选中,不弹下方面板
                setDialogNodeId((current) => (current === clickedNodeId ? current : null));
            } else if (clickedNode?.type !== CanvasNodeType.Group) {
                setDialogNodeId(clickedNodeId);
            }
        }
    }, []);

    const handleGlobalMouseMove = useCallback(
        (event: MouseEvent) => {
            const currentViewport = viewportRef.current;

            if (dragRef.current.isDraggingNode) {
                const dx = (event.clientX - dragRef.current.startX) / currentViewport.k;
                const dy = (event.clientY - dragRef.current.startY) / currentViewport.k;
                const initialPositions = dragRef.current.initialSelectedNodes;
                const initialPositionById = dragRef.current.initialPositionById;
                if (Math.abs(event.clientX - dragRef.current.startX) > 3 || Math.abs(event.clientY - dragRef.current.startY) > 3) {
                    dragRef.current.hasMoved = true;
                }

                const movedIds = new Set(initialPositions.map((item) => item.id));
                const previewNodes = nodesRef.current.map((node) => {
                    const initial = initialPositionById.get(node.id);
                    return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                });
                setDropTargetGroupId(findGroupDropTarget(movedIds, previewNodes)?.id || null);

                if (rafRef.current) cancelAnimationFrame(rafRef.current);
                rafRef.current = requestAnimationFrame(() => {
                    setNodes((prev) =>
                        prev.map((node) => {
                            const initial = initialPositionById.get(node.id);
                            return initial ? { ...node, position: { x: initial.x + dx, y: initial.y + dy } } : node;
                        }),
                    );
                    rafRef.current = null;
                });
                return;
            }

            if (connectingParamsRef.current && !pendingConnectionCreateRef.current) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, connectingParamsRef.current);
                connectionTargetNodeIdRef.current = dropTarget.nodeId;
                setConnectionTargetNodeId(dropTarget.nodeId);
                setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            }
        },
        [finishNodeDrag, getConnectionDropTarget, screenToCanvas],
    );

    const handleGlobalPointerMove = useCallback(
        (event: PointerEvent) => {
            const currentSelection = selectionBoxRef.current;
            if (!currentSelection) return;

            if (event.buttons === 0) {
                selectionBoxRef.current = null;
                setSelectionBox(null);
                return;
            }

            const world = screenToCanvas(event.clientX, event.clientY);
            const rectX = Math.min(currentSelection.startWorldX, world.x);
            const rectY = Math.min(currentSelection.startWorldY, world.y);
            const rectW = Math.abs(world.x - currentSelection.startWorldX);
            const rectH = Math.abs(world.y - currentSelection.startWorldY);
            const nextSelected = new Set<string>(currentSelection.additive ? currentSelection.initialSelectedNodeIds : []);

            nodesRef.current
                .filter((node) => !isHiddenBatchChild(node, nodesRef.current))
                .forEach((node) => {
                    const intersects = rectX < node.position.x + node.width && rectX + rectW > node.position.x && rectY < node.position.y + node.height && rectY + rectH > node.position.y;

                    if (intersects) nextSelected.add(node.id);
                });

            const nextSelectionBox = { ...currentSelection, currentWorldX: world.x, currentWorldY: world.y };
            selectionBoxRef.current = nextSelectionBox;
            setSelectionBox(nextSelectionBox);
            setSelectedNodeIds(nextSelected);
        },
        [screenToCanvas],
    );

    const handleGlobalMouseUp = useCallback(
        (event: MouseEvent) => {
            finishNodeDrag(event.clientX, event.clientY);

            selectionBoxRef.current = null;
            setSelectionBox(null);

            if (pendingConnectionCreateRef.current) return;

            const currentConnection = connectingParamsRef.current;
            if (currentConnection) {
                const dropTarget = getConnectionDropTarget(event.clientX, event.clientY, currentConnection);
                if (dropTarget.nodeId) {
                    connectNodes(currentConnection, dropTarget.nodeId);
                    setConnecting(null);
                } else if (dropTarget.isNearNode) {
                    setConnecting(null);
                } else {
                    setMouseWorld(screenToCanvas(event.clientX, event.clientY));
                    setPendingConnectionCreate({ connection: currentConnection, position: screenToCanvas(event.clientX, event.clientY) });
                }
            }
        },
        [connectNodes, finishNodeDrag, getConnectionDropTarget, screenToCanvas, setConnecting],
    );

    useEffect(() => {
        const handlePointerUp = (event: PointerEvent) => finishNodeDrag(event.clientX, event.clientY);
        const cancelNodeDrag = () => finishNodeDrag();
        window.addEventListener("mousemove", handleGlobalMouseMove);
        window.addEventListener("mouseup", handleGlobalMouseUp);
        window.addEventListener("pointerup", handlePointerUp);
        window.addEventListener("pointercancel", cancelNodeDrag);
        window.addEventListener("blur", cancelNodeDrag);
        window.addEventListener("pointermove", handleGlobalPointerMove);
        return () => {
            window.removeEventListener("mousemove", handleGlobalMouseMove);
            window.removeEventListener("mouseup", handleGlobalMouseUp);
            window.removeEventListener("pointerup", handlePointerUp);
            window.removeEventListener("pointercancel", cancelNodeDrag);
            window.removeEventListener("blur", cancelNodeDrag);
            window.removeEventListener("pointermove", handleGlobalPointerMove);
        };
    }, [finishNodeDrag, handleGlobalMouseMove, handleGlobalMouseUp, handleGlobalPointerMove]);

    const createImageFileNode = useCallback(async (file: File, position: Position) => {
        const image = await uploadCanvasImage(file);
        const size = fitNodeSize(image.width, image.height);
        const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const newNode: CanvasNodeData = {
            id,
            type: CanvasNodeType.Image,
            title: file.name,
            position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: imageMetadata(image),
        };

        setNodes((prev) => [...prev, newNode]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, [uploadCanvasImage]);

    const createVideoFileNode = useCallback(async (file: File, position: Position) => {
        const video = await uploadCanvasMedia(file, "video");
        const size = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
        const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Video,
                title: file.name,
                position: { x: position.x - size.width / 2, y: position.y - size.height / 2 },
                width: size.width,
                height: size.height,
                metadata: videoMetadata(video),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
        setDialogNodeId(id);
    }, [uploadCanvasMedia]);

    const createAudioFileNode = useCallback(async (file: File, position: Position) => {
        const audio = await uploadCanvasMedia(file, "audio");
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
        const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.Audio,
                title: file.name,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: audioMetadata(audio),
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, [uploadCanvasMedia]);

    const createGenericFileNode = useCallback(async (file: File, position: Position) => {
        const stored = await uploadCanvasAssetFile(file);
        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.File];
        const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        setNodes((prev) => [
            ...prev,
            {
                id,
                type: CanvasNodeType.File,
                title: stored.fileName,
                position: { x: position.x - spec.width / 2, y: position.y - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: {
                    storageKey: stored.storageKey,
                    fileName: stored.fileName,
                    fileExtension: fileExtension(stored.fileName),
                    fileCategory: assetFileCategory(stored.fileName, stored.mimeType),
                    bytes: stored.bytes,
                    mimeType: stored.mimeType,
                    status: NODE_STATUS_SUCCESS,
                },
            },
        ]);
        setSelectedNodeIds(new Set([id]));
        setSelectedConnectionId(null);
    }, [uploadCanvasAssetFile]);

    const createImportedFileNode = useCallback(async (file: File, position: Position) => {
        const kind = classifyImportedFile(file);
        if (kind === "image") return createImageFileNode(file, position);
        if (kind === "video") return createVideoFileNode(file, position);
        if (kind === "audio") return createAudioFileNode(file, position);
        return createGenericFileNode(file, position);
    }, [createAudioFileNode, createGenericFileNode, createImageFileNode, createVideoFileNode]);

    const createTextNodeFromClipboard = useCallback(
        (text: string) => {
            const trimmed = text.trim();
            if (!trimmed) return false;

            const node = {
                ...createCanvasNode(CanvasNodeType.Text, getCanvasCenter(), { content: trimmed, status: NODE_STATUS_SUCCESS }),
                title: trimmed.slice(0, 32) || "剪切板文本",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            setContextMenu(null);
            setDialogNodeId(node.id);
            return true;
        },
        [getCanvasCenter],
    );

    const pasteSystemClipboard = useCallback(async () => {
        if (!navigator.clipboard) return;

        const items = await navigator.clipboard.read();
        const imageItem = items.find((item) => item.types.some((type) => type.startsWith("image/")));
        if (imageItem) {
            const imageType = imageItem.types.find((type) => type.startsWith("image/"));
            if (!imageType) return;
            const blob = await imageItem.getType(imageType);
            const file = new File([blob], "clipboard-image.png", { type: imageType });
            await createImageFileNode(file, getCanvasCenter());
            message.success("已从剪切板添加图片");
            return;
        }

        const text = await navigator.clipboard.readText();
        if (createTextNodeFromClipboard(text)) message.success("已从剪切板添加文本");
    }, [createImageFileNode, createTextNodeFromClipboard, getCanvasCenter, message]);

    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || target?.closest("[contenteditable='true'],[data-canvas-no-zoom],[data-canvas-shortcuts-ignore]"))
                return;

            const key = event.key.toLowerCase();
            const isModifierShortcut = event.metaKey || event.ctrlKey;

            if (isModifierShortcut && key === "c" && window.getSelection()?.toString()) return;

            if (isModifierShortcut && !event.altKey && key === "z") {
                event.preventDefault();
                if (event.shiftKey) redoCanvas();
                else undoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "y") {
                event.preventDefault();
                redoCanvas();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "a") {
                event.preventDefault();
                setSelectedNodeIds(new Set(nodesRef.current.map((node) => node.id)));
                setSelectedConnectionId(null);
                setContextMenu(null);
                setSelectionBox(null);
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "c") {
                event.preventDefault();
                copySelectedNodes();
                return;
            }

            if (isModifierShortcut && !event.altKey && key === "v") {
                event.preventDefault();
                if (!pasteCopiedNodes()) {
                    void pasteSystemClipboard().catch((error) => {
                        message.error(error instanceof Error ? `无法粘贴资产：${error.message}` : "无法粘贴资产");
                    });
                }
                return;
            }

            if (event.key === "Delete" || event.key === "Backspace") {
                if (selectedNodeIdsRef.current.size) {
                    deleteNodes(new Set(selectedNodeIdsRef.current));
                } else if (selectedConnectionId) {
                    deleteConnection(selectedConnectionId);
                }
            }

            if (event.key === "Escape") {
                setSelectedNodeIds(new Set());
                setSelectedConnectionId(null);
                setContextMenu(null);
                setNodeCreatePosition(null);
                setSelectionBox(null);
                setConnecting(null);
                setHoveredNodeId(null);
                setToolbarNodeId(null);
                setDialogNodeId(null);
                setEditingNodeId(null);
                setInfoNodeId(null);
                setCropNodeId(null);
                setMaskEditNodeId(null);
                setPendingConnectionCreate(null);
            }
        };

        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, [copySelectedNodes, deleteConnection, deleteNodes, message, pasteCopiedNodes, pasteSystemClipboard, redoCanvas, selectedConnectionId, setConnecting, undoCanvas]);

    const handleConnectStart = useCallback(
        (event: ReactMouseEvent, nodeId: string, handleType: "source" | "target") => {
            event.stopPropagation();
            setMouseWorld(screenToCanvas(event.clientX, event.clientY));
            setConnecting({ nodeId, handleType });
            connectionTargetNodeIdRef.current = null;
            setConnectionTargetNodeId(null);
            setSelectedConnectionId(null);
        },
        [screenToCanvas, setConnecting],
    );

    const handleNodeResize = useCallback((nodeId: string, width: number, height: number, position?: Position) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId
            ? {
                  ...node,
                  width,
                  height,
                  position: position || node.position,
                  metadata: node.metadata?.role === "result-slot" ? { ...node.metadata, resultSlotAutoSize: false } : node.metadata,
              }
            : node)));
    }, []);

    const toggleNodeFreeResize = useCallback((nodeId: string) => {
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                const freeResize = !node.metadata?.freeResize;
                if (freeResize || node.type !== CanvasNodeType.Image) return { ...node, metadata: { ...node.metadata, freeResize } };
                const ratio = (node.metadata?.naturalWidth || node.width) / (node.metadata?.naturalHeight || node.height || 1);
                const height = node.width / ratio;
                return { ...node, height, position: { x: node.position.x, y: node.position.y + node.height / 2 - height / 2 }, metadata: { ...node.metadata, freeResize } };
            }),
        );
    }, []);

    const handleNodeContentChange = useCallback((nodeId: string, content: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, content } } : node)));
    }, []);

    const handleNodeTitleChange = useCallback((nodeId: string, title: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, title } : node)));
    }, []);

    const toggleBatchExpanded = useCallback((nodeId: string) => {
        const isExpanded = Boolean(nodesRef.current.find((node) => node.id === nodeId)?.metadata?.imageBatchExpanded);
        if (isExpanded) {
            setCollapsingBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setCollapsingBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 320);
        } else {
            setOpeningBatchIds((prev) => new Set(prev).add(nodeId));
            window.setTimeout(() => {
                setOpeningBatchIds((prev) => {
                    const next = new Set(prev);
                    next.delete(nodeId);
                    return next;
                });
            }, 260);
        }
        setNodes((prev) =>
            prev.map((node) => {
                if (node.id !== nodeId) return node;
                return { ...node, metadata: { ...node.metadata, imageBatchExpanded: !node.metadata?.imageBatchExpanded } };
            }),
        );
    }, []);

    const setBatchPrimary = useCallback((child: CanvasNodeData) => {
        const rootId = child.metadata?.batchRootId;
        if (!rootId || !child.metadata?.content) return;
        setNodes((prev) =>
            prev.map((node) =>
                node.id === rootId
                    ? {
                          ...node,
                          width: child.width,
                          height: child.height,
                          metadata: {
                              ...node.metadata,
                              content: child.metadata?.content,
                              primaryImageId: child.id,
                              naturalWidth: child.metadata?.naturalWidth,
                              naturalHeight: child.metadata?.naturalHeight,
                              freeResize: child.metadata?.freeResize,
                          },
                      }
                    : node,
            ),
        );
    }, []);

    const openTextEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setDialogNodeId(node.id);
        setEditingNodeId(node.id);
        setEditRequestNonce((value) => value + 1);
    }, []);

    const handleNodePromptChange = useCallback((nodeId: string, prompt: string) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt } } : node)));
    }, []);

    const handleConfigNodeChange = useCallback(
        (nodeId: string, patch: Partial<CanvasNodeData["metadata"]>) => {
            const nextMode = patch?.generationMode;
            const source = nodesRef.current.find((node) => node.id === nodeId);
            const connectedSlots = connectionsRef.current
                .filter((connection) => connection.fromNodeId === nodeId)
                .map((connection) => nodesRef.current.find((node) => node.id === connection.toNodeId))
                .filter((node): node is CanvasNodeData => Boolean(node?.metadata?.role === "result-slot"));
            const existingSlot = connectedSlots.length === 1 ? connectedSlots[0] : undefined;
            if (!source || source.type !== CanvasNodeType.Config || !nextMode || !existingSlot || !isCanvasResultSlot(existingSlot) || existingSlot.metadata.resultSlotMode === nextMode) {
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node)));
                return;
            }

            const hasSavedResults = existingSlot.metadata.resultVersions.some((version) => version.status === "success");
            if (!hasSavedResults) {
                const replacement = createCanvasResultSlot({
                    id: existingSlot.id,
                    mode: nextMode,
                    sourceNodeId: nodeId,
                    position: existingSlot.position,
                    width: existingSlot.width,
                    height: existingSlot.height,
                    advanceMode: existingSlot.metadata.advanceMode,
                });
                commitNodes((current) => current.map((node) => (node.id === nodeId ? applyNodeConfigPatch(node, patch) : node.id === existingSlot.id ? replacement : node)));
                return;
            }

            const replacementId = nanoid();
            const replacement = createCanvasResultSlotBinding({
                id: replacementId,
                connectionId: nanoid(),
                sourceNodeId: nodeId,
                mode: nextMode,
                position: existingSlot.position,
                advanceMode: existingSlot.metadata.advanceMode,
            });
            commitNodes((current) => [
                ...current.map((node) =>
                    node.id === nodeId
                        ? applyNodeConfigPatch(node, patch)
                        : node.id === existingSlot.id
                          ? { ...node, position: { x: node.position.x, y: node.position.y + node.height + 56 }, metadata: { ...node.metadata, resultSlotSourceNodeId: undefined } }
                          : node,
                ),
                replacement.node,
            ]);
            commitConnections((current) => [
                ...current.filter((connection) => !(connection.fromNodeId === nodeId && connection.toNodeId === existingSlot.id)).map((connection) => (connection.fromNodeId === existingSlot.id ? { ...connection, fromNodeId: replacementId } : connection)),
                replacement.connection,
            ]);
            message.info("原结果已保留，新类型使用新的结果槽");
        },
        [commitConnections, commitNodes, message],
    );

    const addResultSlotForAction = useCallback(
        (nodeId: string) => {
            const source = nodesRef.current.find((node) => node.id === nodeId);
            if (!source || (source.type !== CanvasNodeType.Config && source.type !== CanvasNodeType.Terminal)) return;
            const mode: CanvasGenerationMode = source.type === CanvasNodeType.Terminal ? source.metadata?.terminalOutputMode || "text" : source.metadata?.generationMode || "image";
            const resolution = resolveDeclaredOutputNode(nodeId, mode, nodesRef.current, connectionsRef.current);
            if (resolution.status === "ambiguous") {
                message.warning("这一步已连接多个同类结果，请先保留一个");
                return;
            }
            if (resolution.status === "unique" && resolution.explicit) {
                setSelectedNodeIds(new Set([resolution.node.id]));
                focusNode(resolution.node.id);
                return;
            }
            if (resolution.status === "unique") {
                const legacy = resolution.node;
                let upgraded = createCanvasResultSlot({
                    id: legacy.id,
                    mode,
                    position: legacy.position,
                    title: legacy.title,
                    width: legacy.width,
                    height: legacy.height,
                    sourceNodeId: nodeId,
                    metadata: legacy.metadata,
                });
                if (legacy.metadata?.content) {
                    upgraded = appendResultSlotSuccess(upgraded, {
                        id: `imported-${nanoid()}`,
                        sourceNodeId: nodeId,
                        createdAt: new Date().toISOString(),
                        artifacts: canvasResultArtifacts(
                            {
                                ...upgraded,
                                metadata: { ...upgraded.metadata, ...legacy.metadata, role: "result-slot", resultSlotMode: mode, advanceMode: "review", slotState: "ready", resultVersions: [] },
                            },
                            nodesRef.current,
                        ),
                    });
                }
                commitNodes((current) => current.map((node) => (node.id === legacy.id ? upgraded : node)));
                setSelectedNodeIds(new Set([legacy.id]));
                message.success("已转为可检查的结果槽");
                return;
            }

            const slotId = nanoid();
            const binding = createCanvasResultSlotBinding({
                id: slotId,
                connectionId: nanoid(),
                sourceNodeId: nodeId,
                mode,
                position: { x: source.position.x + source.width + 96, y: source.position.y + source.height / 2 - 120 },
            });
            commitNodes((current) => [...current, binding.node]);
            commitConnections((current) => [...current, binding.connection]);
            setSelectedNodeIds(new Set([slotId]));
            setSelectedConnectionId(null);
        },
        [commitConnections, commitNodes, focusNode, message],
    );

    const handleTerminalArtifact = useCallback((sourceNodeId: string, artifact: CanvasTerminalArtifact) => {
        const source = nodesRef.current.find((node) => node.id === sourceNodeId);
        if (!source) return;
        if (artifact.kind === "file") {
            const spec = NODE_DEFAULT_SIZE[CanvasNodeType.File];
            const node: CanvasNodeData = {
                id: nanoid(),
                type: CanvasNodeType.File,
                title: artifact.title,
                position: { x: source.position.x + source.width + 96, y: source.position.y + source.height / 2 - spec.height / 2 },
                width: spec.width,
                height: spec.height,
                metadata: { storageKey: artifact.storageKey, mimeType: artifact.mimeType, bytes: artifact.bytes, fileName: artifact.fileName, fileExtension: artifact.extension, fileCategory: artifact.category, status: NODE_STATUS_SUCCESS },
            };
            setNodes((prev) => [...prev, node]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: sourceNodeId, toNodeId: node.id }]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
            return;
        }
        const spec = NODE_DEFAULT_SIZE[artifact.kind];
        const size = artifact.kind === CanvasNodeType.Audio ? { width: spec.width, height: spec.height } : fitNodeSize(artifact.width || spec.width, artifact.height || spec.height, spec.width, spec.height);
        const node: CanvasNodeData = {
            id: nanoid(),
            type: artifact.kind,
            title: artifact.title,
            position: { x: source.position.x + source.width + 96, y: source.position.y + source.height / 2 - size.height / 2 },
            width: size.width,
            height: size.height,
            metadata: {
                content: artifact.url,
                storageKey: artifact.storageKey,
                mimeType: artifact.mimeType,
                bytes: artifact.bytes,
                naturalWidth: artifact.width,
                naturalHeight: artifact.height,
                durationMs: artifact.durationMs,
                status: NODE_STATUS_SUCCESS,
            },
        };
        setNodes((prev) => [...prev, node]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: sourceNodeId, toNodeId: node.id }]);
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
    }, []);

    const downloadNodeImage = useCallback(async (node: CanvasNodeData) => {
        if (node.type === CanvasNodeType.File) {
            if (!node.metadata?.storageKey) return;
            const filename = node.metadata.fileName || node.title || "文件";
            try {
                if (isDesktopApp()) {
                    const exportedName = await exportDesktopMedia("files", node.metadata.storageKey, filename);
                    message.success(`已下载：${exportedName || filename}`);
                } else {
                    const blob = await getAssetFileBlob(node.metadata.storageKey);
                    if (!blob) throw new Error("本地文件不存在");
                    saveAs(blob, filename);
                }
            } catch (error) {
                message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
            }
            return;
        }
        if (!node.metadata?.content) return;
        if (node.type === CanvasNodeType.Text) {
            saveAs(new Blob([node.metadata.content], { type: "text/plain;charset=utf-8" }), `canvas-text-${node.id}.txt`);
            return;
        }
        if (node.type !== CanvasNodeType.Image && node.type !== CanvasNodeType.Video && node.type !== CanvasNodeType.Audio) return;
        const filename = `canvas-${node.type}-${node.id}.${node.type === CanvasNodeType.Video ? "mp4" : node.type === CanvasNodeType.Audio ? audioExtension(node.metadata.mimeType) : imageExtension(node.metadata.content)}`;
        try {
            if (isDesktopApp()) {
                if (!node.metadata.storageKey) throw new Error("文件尚未保存到本地");
                const bucket = node.type === CanvasNodeType.Image ? "images" : "media";
                const exportedName = await exportDesktopMedia(bucket, node.metadata.storageKey, filename);
                message.success(`已下载：${exportedName || filename}`);
                return;
            }
            saveAs(node.metadata.content, filename);
        } catch (error) {
            message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
        }
    }, [message]);

    const saveNodeAsset = useCallback(
        async (node: CanvasNodeData) => {
            try {
                if (node.type === CanvasNodeType.Text) {
                    const content = node.metadata?.content?.trim();
                    if (!content) return message.error("没有可保存的文本");
                    await addAssetPersisted({ kind: "text", title: node.metadata?.prompt?.slice(0, 24) || "画布文本", coverUrl: "", tags: [], source: "Canvas", data: { content }, metadata: { source: "canvas", nodeId: node.id } });
                    message.success("已加入我的资产");
                    return;
                }
                if (node.type === CanvasNodeType.File) {
                    if (!node.metadata?.storageKey) return message.error("没有可保存的文件");
                    await addAssetPersisted({
                        kind: "file",
                        title: node.title || node.metadata.fileName || "画布文件",
                        coverUrl: "",
                        tags: [],
                        source: "Canvas",
                        data: {
                            storageKey: node.metadata.storageKey,
                            fileName: node.metadata.fileName || node.title || "文件",
                            bytes: node.metadata.bytes || 0,
                            mimeType: node.metadata.mimeType || "application/octet-stream",
                            extension: node.metadata.fileExtension || fileExtension(node.metadata.fileName || node.title || ""),
                            category: node.metadata.fileCategory || assetFileCategory(node.metadata.fileName || node.title || "", node.metadata.mimeType),
                        },
                        metadata: { source: "canvas", nodeId: node.id },
                    });
                    message.success("已加入我的资产");
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    if (!node.metadata?.content) return message.error("没有可保存的视频");
                    await addAssetPersisted({
                        kind: "video",
                        title: node.metadata?.prompt?.slice(0, 24) || "画布视频",
                        coverUrl: "",
                        tags: [],
                        source: "Canvas",
                        data: { url: node.metadata.content, storageKey: node.metadata.storageKey, width: node.width, height: node.height, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "video/mp4" },
                        metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                    });
                    message.success("已加入我的资产");
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    if (!node.metadata?.content) return message.error("没有可保存的音频");
                    await addAssetPersisted({
                        kind: "audio",
                        title: node.metadata?.prompt?.slice(0, 24) || "画布音频",
                        coverUrl: "",
                        tags: [],
                        source: "Canvas",
                        data: { url: node.metadata.content, storageKey: node.metadata.storageKey, durationMs: node.metadata.durationMs, bytes: node.metadata.bytes || 0, mimeType: node.metadata.mimeType || "audio/mpeg" },
                        metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                    });
                    message.success("已加入我的资产");
                    return;
                }
                if (!node.metadata?.content) return message.error("没有可保存的图片");
                const dataUrl = node.metadata.storageKey ? "" : node.metadata.content;
                await addAssetPersisted({
                    kind: "image",
                    title: node.metadata?.prompt?.slice(0, 24) || "画布图片",
                    coverUrl: node.metadata.content,
                    tags: [],
                    source: "Canvas",
                    data: {
                        dataUrl,
                        storageKey: node.metadata.storageKey,
                        width: node.metadata.naturalWidth || node.width,
                        height: node.metadata.naturalHeight || node.height,
                        bytes: node.metadata.bytes || getDataUrlByteSize(dataUrl),
                        mimeType: node.metadata.mimeType || "image/png",
                    },
                    metadata: { source: "canvas", nodeId: node.id, prompt: node.metadata?.prompt },
                });
                message.success("已加入我的资产");
            } catch (error) {
                message.error(error instanceof Error ? `保存资产失败：${error.message}` : "保存资产失败，请重试");
            }
        },
        [addAssetPersisted, message],
    );

    const createImageReversePromptNodes = useCallback(
        (node: CanvasNodeData) => {
            if (node.type !== CanvasNodeType.Image || !node.metadata?.content) {
                message.warning("图片节点为空，无法反推提示词");
                return;
            }

            const gap = 96;
            const textSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
            const configSpec = NODE_DEFAULT_SIZE[CanvasNodeType.Config];
            const centerY = node.position.y + node.height / 2;
            const textNode = {
                ...createCanvasNode(CanvasNodeType.Text, { x: node.position.x + node.width + gap + textSpec.width / 2, y: centerY }, { content: IMAGE_PROMPT_REVERSE_PRESET, prompt: IMAGE_PROMPT_REVERSE_PRESET, status: NODE_STATUS_SUCCESS, fontSize: 14 }),
                title: "反推提示词",
            };
            const configNode = {
                ...createCanvasNode(
                    CanvasNodeType.Config,
                    { x: textNode.position.x + textNode.width + gap + configSpec.width / 2, y: centerY },
                    {
                        generationMode: "text",
                        model: effectiveConfig.textModel || effectiveConfig.model || defaultConfig.textModel,
                        count: 1,
                        composerContent: `参考图片：@[node:${node.id}]\n任务说明：@[node:${textNode.id}]`,
                    },
                ),
                title: "反推提示词配置",
            };

            setNodes((prev) => [...prev, textNode, configNode]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: configNode.id }, { id: nanoid(), fromNodeId: textNode.id, toNodeId: configNode.id }]);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
            setContextMenu(null);
        },
        [effectiveConfig.model, effectiveConfig.textModel, message],
    );

    const cropImageNode = useCallback(async (node: CanvasNodeData, crop: CanvasImageCropRect) => {
        if (!node.metadata?.content) return;
        const cropped = await cropDataUrl(node.metadata.content, crop);
        const image = await uploadCanvasImage(cropped);
        const width = Math.min(node.width, Math.max(220, image.width));
        const childId = nanoid();
        const child: CanvasNodeData = {
            id: childId,
            type: CanvasNodeType.Image,
            title: "Cropped Image",
            position: { x: node.position.x + node.width + 96, y: node.position.y },
            width,
            height: width * (image.height / image.width),
            metadata: {
                ...imageMetadata(image),
                prompt: node.metadata?.prompt,
            },
        };
        setNodes((prev) => [...prev, child]);
        setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
        setSelectedNodeIds(new Set([childId]));
        setDialogNodeId(childId);
        setCropNodeId(null);
    }, [uploadCanvasImage]);

    const splitImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageSplitParams) => {
            if (!node.metadata?.content) return;
            setSplitNodeId(null);
            const pieces = await splitDataUrl(node.metadata.content, params);
            const gap = 16;
            const cellWidth = node.width / params.columns;
            const cellHeight = node.height / params.rows;
            const startX = node.position.x + node.width + 96;
            const startY = node.position.y;
            const childNodes = await Promise.all(
                pieces.map(async (piece) => {
                    const image = await uploadCanvasImage(piece.dataUrl);
                    const id = nanoid();
                    return {
                        id,
                        type: CanvasNodeType.Image,
                        title: `${node.title || "图片"} ${piece.row + 1}-${piece.column + 1}`,
                        position: { x: startX + piece.column * (cellWidth + gap), y: startY + piece.row * (cellHeight + gap) },
                        width: cellWidth,
                        height: cellHeight,
                        metadata: {
                            ...imageMetadata(image),
                            prompt: node.metadata?.prompt,
                        },
                    } satisfies CanvasNodeData;
                }),
            );
            setNodes((prev) => [...prev, ...childNodes]);
            setConnections((prev) => [...prev, ...childNodes.map((child) => ({ id: nanoid(), fromNodeId: node.id, toNodeId: child.id }))]);
            setSelectedNodeIds(new Set(childNodes.map((child) => child.id)));
            setSelectedConnectionId(null);
            setDialogNodeId(null);
            message.success(`已切分为 ${childNodes.length} 个子节点`);
        },
        [message, uploadCanvasImage],
    );

    const maskEditImageNode = useCallback(
        async (node: CanvasNodeData, payload: CanvasImageMaskEditPayload) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1", size: node.metadata?.size || "auto" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const userPrompt = payload.prompt.trim();
            const prompt = `只修改蒙版透明区域，其他区域保持不变。${userPrompt}`;
            const childId = nanoid();
            const source = { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey };
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [source]);
            setMaskEditNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title: userPrompt.slice(0, 32) || "局部编辑结果",
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: node.width,
                    height: node.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setSelectedConnectionId(null);
            setDialogNodeId(childId);
            const lease = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(generationConfig, prompt, [source], { id: `${node.id}-mask`, name: "mask.png", type: "image/png", dataUrl: payload.maskDataUrl }, { signal: lease.attempt.controller.signal }).then((items) => items[0]);
                assertGenerationRequestCurrent(lease);
                const uploaded = await retainGenerationImage([lease], await uploadCanvasImage(image.dataUrl));
                const size = fitNodeSize(uploaded.width, uploaded.height, node.width, node.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error) || !isGenerationRequestCurrent(lease)) return;
                const errorDetails = error instanceof Error ? error.message : "局部修改失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(lease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, childId)) setRunningNodeId((current) => (current === childId ? null : current));
            }
        },
        [assertGenerationRequestCurrent, effectiveConfig, finishGenerationRequest, isAiConfigReady, isGenerationRequestCurrent, message, openConfigDialog, retainGenerationImage, startGenerationRequest, uploadCanvasImage],
    );

    const upscaleImageNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageUpscaleParams) => {
            if (!node.metadata?.content) return;
            setUpscaleNodeId(null);
            const upscaled = await upscaleDataUrl(node.metadata.content, params);
            const image = await uploadCanvasImage(upscaled);
            const size = fitNodeSize(image.width, image.height);
            const childId = nanoid();
            const child: CanvasNodeData = {
                id: childId,
                type: CanvasNodeType.Image,
                title: "Upscaled Image",
                position: { x: node.position.x + node.width + 96, y: node.position.y },
                width: size.width,
                height: size.height,
                metadata: {
                    ...imageMetadata(image),
                    prompt: node.metadata?.prompt,
                },
            };
            setNodes((prev) => [...prev, child]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
        },
        [uploadCanvasImage],
    );

    const generateAngleNode = useCallback(
        async (node: CanvasNodeData, params: CanvasImageAngleParams) => {
            if (!node.metadata?.content) return;
            const generationConfig = { ...buildGenerationConfig(effectiveConfig, node, "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }
            const childId = nanoid();
            const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
            const title = buildAngleLabel(params);
            const prompt = buildAnglePrompt(params);
            const generationMetadata = buildImageGenerationMetadata("edit", generationConfig, 1, [
                { id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey },
            ]);
            setAngleNodeId(null);
            setRunningNodeId(childId);
            setNodes((prev) => [
                ...prev,
                {
                    id: childId,
                    type: CanvasNodeType.Image,
                    title,
                    position: { x: node.position.x + node.width + 96, y: node.position.y },
                    width: imageConfig.width,
                    height: imageConfig.height,
                    metadata: { prompt, status: NODE_STATUS_LOADING, ...generationMetadata },
                },
            ]);
            setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: node.id, toNodeId: childId }]);
            setSelectedNodeIds(new Set([childId]));
            setDialogNodeId(childId);
            const lease = startGenerationRequest(childId, node.id, childId);
            try {
                const image = await requestEdit(
                    generationConfig,
                    prompt,
                    [{ id: node.id, name: `${node.title || node.id}.png`, type: node.metadata.mimeType || "image/png", dataUrl: node.metadata.content, storageKey: node.metadata.storageKey }],
                    undefined,
                    { signal: lease.attempt.controller.signal },
                ).then((items) => items[0]);
                assertGenerationRequestCurrent(lease);
                const uploaded = await retainGenerationImage([lease], await uploadCanvasImage(image.dataUrl));
                const size = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, width: size.width, height: size.height, metadata: { ...item.metadata, ...imageMetadata(uploaded), prompt, ...generationMetadata } } : item)));
            } catch (error) {
                if (isGenerationCanceled(error) || !isGenerationRequestCurrent(lease)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                setNodes((prev) => prev.map((item) => (item.id === childId ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(lease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, childId)) setRunningNodeId((current) => (current === childId ? null : current));
            }
        },
        [assertGenerationRequestCurrent, effectiveConfig, finishGenerationRequest, isGenerationRequestCurrent, openConfigDialog, retainGenerationImage, startGenerationRequest, uploadCanvasImage],
    );

    const handleFontSizeChange = useCallback((nodeId: string, fontSize: number) => {
        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, fontSize } } : node)));
    }, []);

    const handleUploadRequest = useCallback(
        (nodeId?: string, position?: Position) => {
            const input = imageInputRef.current;
            if (!input) {
                message.error("文件选择器尚未准备好，请稍后重试");
                return;
            }
            uploadTargetRef.current = { nodeId, position };
            // Clearing before opening lets users intentionally choose the same
            // file again after replacing or deleting a node.
            input.value = "";
            try {
                if (typeof input.showPicker === "function") input.showPicker();
                else input.click();
            } catch {
                input.click();
            }
        },
        [message],
    );

    const handleImageInputChange = useCallback(
        async (event: ReactChangeEvent<HTMLInputElement>) => {
            const input = event.currentTarget;
            const files = Array.from(event.target.files || []);
            if (!files.length) {
                uploadTargetRef.current = null;
                input.value = "";
                return;
            }

            const target = uploadTargetRef.current;
            const basePosition = target?.position || screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const STAGGER = 40; // 多文件时的偏移间距

            try {
                // 如果有替换目标节点，第一个文件替换它，其余在附近新建
                if (target?.nodeId) {
                    const [first, ...rest] = files;
                    const firstKind = classifyImportedFile(first);

                    // 第一个文件：替换目标节点
                    if (firstKind === "audio") {
                        const audio = await uploadCanvasMedia(first, "audio");
                        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Audio,
                                          title: first.name,
                                          position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                          width: spec.width,
                                          height: spec.height,
                                          metadata: { ...node.metadata, ...audioMetadata(audio), fileName: undefined, fileExtension: undefined, fileCategory: undefined, errorDetails: undefined },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                    } else if (firstKind === "video") {
                        const video = await uploadCanvasMedia(first, "video");
                        const nextSize = fitNodeSize(video.width || 1280, video.height || 720, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Video,
                                          title: first.name,
                                          position: { x: node.position.x + node.width / 2 - nextSize.width / 2, y: node.position.y + node.height / 2 - nextSize.height / 2 },
                                          width: nextSize.width,
                                          height: nextSize.height,
                                          metadata: { ...node.metadata, ...videoMetadata(video), fileName: undefined, fileExtension: undefined, fileCategory: undefined, errorDetails: undefined },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                    } else if (firstKind === "image") {
                        const image = await uploadCanvasImage(first);
                        const s = fitNodeSize(image.width, image.height);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Image,
                                          title: first.name,
                                          width: s.width,
                                          height: s.height,
                                          metadata: {
                                              ...node.metadata,
                                              ...imageMetadata(image),
                                              fileName: undefined,
                                              fileExtension: undefined,
                                              fileCategory: undefined,
                                              errorDetails: undefined,
                                              freeResize: false,
                                              isBatchRoot: undefined,
                                              batchRootId: undefined,
                                              batchChildIds: undefined,
                                              batchUsesReferenceImages: undefined,
                                              generationType: undefined,
                                              model: undefined,
                                              size: undefined,
                                              quality: undefined,
                                              count: undefined,
                                              references: undefined,
                                              primaryImageId: undefined,
                                              imageBatchExpanded: undefined,
                                          },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                    } else {
                        const stored = await uploadCanvasAssetFile(first);
                        const spec = NODE_DEFAULT_SIZE[CanvasNodeType.File];
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === target.nodeId
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.File,
                                          title: stored.fileName,
                                          position: { x: node.position.x + node.width / 2 - spec.width / 2, y: node.position.y + node.height / 2 - spec.height / 2 },
                                          width: spec.width,
                                          height: spec.height,
                                          metadata: {
                                              storageKey: stored.storageKey,
                                              fileName: stored.fileName,
                                              fileExtension: fileExtension(stored.fileName),
                                              fileCategory: assetFileCategory(stored.fileName, stored.mimeType),
                                              bytes: stored.bytes,
                                              mimeType: stored.mimeType,
                                              status: NODE_STATUS_SUCCESS,
                                          },
                                      }
                                    : node,
                            ),
                        );
                        setSelectedNodeIds(new Set([target.nodeId]));
                        setSelectedConnectionId(null);
                    }

                    // 剩余文件：在目标节点附近新建
                    for (let i = 0; i < rest.length; i++) {
                        const offsetPos = { x: basePosition.x + (i + 1) * STAGGER, y: basePosition.y + (i + 1) * STAGGER };
                        const f = rest[i];
                        await createImportedFileNode(f, offsetPos);
                    }
                } else {
                    // 无替换目标：所有文件在画布中心附近新建
                    for (let i = 0; i < files.length; i++) {
                        const offsetPos = { x: basePosition.x + i * STAGGER, y: basePosition.y + i * STAGGER };
                        const f = files[i];
                        await createImportedFileNode(f, offsetPos);
                    }
                }
                message.success(target?.nodeId ? (files.length > 1 ? `已替换并导入 ${files.length} 个资产` : "已替换资产") : `已导入 ${files.length} 个资产`);
            } catch (error) {
                console.error("资产导入失败", error);
                const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
                message.error(detail ? `资产导入失败：${detail}` : "资产导入失败，请重试");
            } finally {
                uploadTargetRef.current = null;
                input.value = "";
            }
        },
        [createImportedFileNode, message, screenToCanvas, size.height, size.width, uploadCanvasAssetFile, uploadCanvasImage, uploadCanvasMedia],
    );

    const handleDrop = useCallback(
        async (event: ReactDragEvent<HTMLDivElement>) => {
            event.preventDefault();
            const files = Array.from(event.dataTransfer.files);
            if (!files.length) return;

            const basePos = screenToCanvas(event.clientX, event.clientY);
            const STAGGER = 40;
            try {
                for (let i = 0; i < files.length; i++) {
                    const pos = { x: basePos.x + i * STAGGER, y: basePos.y + i * STAGGER };
                    const f = files[i];
                    await createImportedFileNode(f, pos);
                }
                message.success(`已导入 ${files.length} 个资产`);
            } catch (error) {
                console.error("拖入资产失败", error);
                const detail = error instanceof Error ? error.message : typeof error === "string" ? error : "";
                message.error(detail ? `资产导入失败：${detail}` : "资产导入失败，请重试");
            }
        },
        [createImportedFileNode, message, screenToCanvas],
    );

    const startTitleEditing = useCallback(() => {
        setTitleDraft(currentProjectTitle || "未命名画布");
        setTitleEditing(true);
    }, [currentProjectTitle]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameProject(projectId, nextTitle);
        setTitleEditing(false);
    }, [projectId, renameProject, titleDraft]);

    const preventCanvasContextMenu = useCallback((event: ReactMouseEvent) => {
        if ((event.target as HTMLElement).closest("[data-node-id]")) return;
        event.preventDefault();
        setContextMenu(null);
    }, []);

    const handleGenerateNode = useCallback(
        async (nodeId: string, mode: CanvasNodeGenerationMode, prompt: string, runOptions?: CanvasHandleGenerationOptions) => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            const generationConfig = buildGenerationConfig(effectiveConfig, sourceNode, mode);
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            // 插件节点声明了 useBuiltinPanel.writeBackToSelf:复用内置面板生成,但结果写回节点自身。
            // 目前支持 image 模式(全景等展示型节点),前缀由 useBuiltinPanel.promptPrefix 指定。
            const builtinPanel = sourceNode ? getNodeDefinition(sourceNode.type)?.useBuiltinPanel : undefined;
            if (sourceNode && builtinPanel?.writeBackToSelf && builtinPanel.mode === "image") {
                const scene = prompt.trim();
                if (!scene) return;
                setRunningNodeId(nodeId);
                const lease = startGenerationRequest(nodeId, nodeId, nodeId, runOptions?.attempt);
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, prompt: scene, status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));
                try {
                    const fullPrompt = (builtinPanel.promptPrefix || "") + scene;
                    // 上游图片节点作为参考图(图生图);无上游则纯文生图
                    const upstreamNodes = connectionsRef.current
                        .filter((conn) => conn.toNodeId === nodeId)
                        .map((conn) => nodesRef.current.find((node) => node.id === conn.fromNodeId))
                        .filter((node): node is CanvasNodeData => Boolean(node));
                    const refs = upstreamNodes.flatMap((up) =>
                        typeof up.metadata?.content === "string" && up.metadata.content && up.type !== sourceNode.type
                            ? [{ id: up.id, name: `${up.title || up.id}.png`, type: up.metadata.mimeType || "image/png", dataUrl: up.metadata.content, storageKey: up.metadata.storageKey }]
                            : [],
                    );
                    const image = refs.length
                        ? await requestEdit({ ...generationConfig, count: "1" }, fullPrompt, refs, undefined, { signal: lease.attempt.controller.signal }).then((items) => items[0])
                        : await requestGeneration({ ...generationConfig, count: "1" }, fullPrompt, { signal: lease.attempt.controller.signal }).then((items) => items[0]);
                    assertGenerationRequestCurrent(lease);
                    const uploaded = await retainGenerationImage([lease], await uploadCanvasImage(image.dataUrl));
                    setNodes((prev) =>
                        prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...imageMetadata(uploaded), prompt: scene, model: generationConfig.model, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)),
                    );
                    setDialogNodeId(null);
                } catch (error) {
                    if (!isGenerationCanceled(error) && isGenerationRequestCurrent(lease)) {
                        const errorDetails = error instanceof Error ? error.message : "生成失败";
                        if (!runOptions?.silent) message.error(errorDetails);
                        setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                    }
                } finally {
                    finishGenerationRequest(lease);
                    if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, nodeId)) setRunningNodeId((current) => (current === nodeId ? null : current));
                }
                return;
            }

            setRunningNodeId(nodeId);
            const runLease = startGenerationRequest(nodeId, nodeId, nodeId, runOptions?.attempt);
            const runController = runLease.attempt.controller;
            const sourceTextContent = sourceNode?.type === CanvasNodeType.Text ? sourceNode.metadata?.content?.trim() || "" : "";
            const editingTextNode = mode === "text" && Boolean(sourceTextContent);
            const contextPrompt = editingTextNode ? `请根据要求修改以下文本。\n\n原文：\n${sourceTextContent}\n\n修改要求：\n${prompt}` : prompt;
            const generationContext = await hydrateNodeGenerationContext(runOptions?.generationContext || buildNodeGenerationContext(nodeId, nodesRef.current, connectionsRef.current, contextPrompt));
            const effectivePrompt = generationContext.prompt.trim();
            if (!isGenerationRequestCurrent(runLease)) {
                finishGenerationRequest(runLease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, nodeId)) setRunningNodeId((current) => (current === nodeId ? null : current));
                return;
            }
            const markSourceStatus = sourceNode?.type !== CanvasNodeType.Image && !editingTextNode;
            if (!effectivePrompt && (mode === "text" || mode === "audio")) {
                finishGenerationRequest(runLease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, nodeId)) setRunningNodeId((current) => (current === nodeId ? null : current));
                return;
            }
            let pendingChildIds: string[] = [];
            if (markSourceStatus)
                setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, ...(node.type === CanvasNodeType.Config ? {} : { prompt }), status: NODE_STATUS_LOADING, errorDetails: undefined } } : node)));

            try {
                if (mode === "image") {
                    const count = getGenerationCount(generationConfig.count);
                    const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                    const isImageNode = sourceNode?.type === CanvasNodeType.Image;
                    const isEmptyImageNode = isImageNode && !sourceNode?.metadata?.content;
                    const declaredImageNode = isConfigNode ? findDeclaredOutputNode(nodeId, "image", nodesRef.current, connectionsRef.current) : undefined;
                    const writesToDeclaredImage = Boolean(declaredImageNode);
                    const sourceReference =
                        isImageNode && sourceNode?.metadata?.content
                            ? [{ id: sourceNode.id, name: `${sourceNode.title || sourceNode.id}.png`, type: sourceNode.metadata.mimeType || "image/png", dataUrl: sourceNode.metadata.content, storageKey: sourceNode.metadata.storageKey }]
                            : [];
                    const referenceImages = sourceReference.length ? sourceReference : generationContext.referenceImages;
                    const generationType = referenceImages.length ? ("edit" as const) : ("generation" as const);
                    const generationMetadata = buildImageGenerationMetadata(generationType, generationConfig, count, referenceImages);
                    const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : isImageNode ? CanvasNodeType.Image : CanvasNodeType.Text];
                    const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                    const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                    const gap = 96;
                    const rowGap = 36;
                    const rootId = isEmptyImageNode ? nodeId : declaredImageNode?.id || nanoid();
                    const childIds = count > 1 ? Array.from({ length: count }, () => nanoid()) : [];
                    const targetIds = count > 1 ? childIds : [rootId];
                    pendingChildIds = isEmptyImageNode ? childIds : [rootId, ...childIds];
                    const rootNode: CanvasNodeData = {
                        id: rootId,
                        type: CanvasNodeType.Image,
                        title: declaredImageNode?.title || effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: declaredImageNode?.position.x ?? (isEmptyImageNode ? parentPosition.x : parentPosition.x + parentConfig.width + gap),
                            y: declaredImageNode?.position.y ?? parentPosition.y + parentConfig.height / 2 - imageConfig.height / 2,
                        },
                        width: declaredImageNode?.width || (isEmptyImageNode ? sourceNode?.width || imageConfig.width : imageConfig.width),
                        height: declaredImageNode?.height || (isEmptyImageNode ? sourceNode?.height || imageConfig.height : imageConfig.height),
                        metadata: beginCanvasImageBatch(
                            {
                                ...(declaredImageNode?.metadata?.role === "result-slot" ? { role: "result-slot" as const } : {}),
                                prompt: effectivePrompt,
                                status: NODE_STATUS_LOADING,
                                ...generationMetadata,
                            },
                            childIds,
                            referenceImages.length > 0,
                        ),
                    };
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Image,
                        title: effectivePrompt.slice(0, 32) || "Generated Image",
                        position: {
                            x: rootNode.position.x + rootNode.width + 120 + (index % 2) * (imageConfig.width + 36),
                            y: rootNode.position.y + Math.floor(index / 2) * (imageConfig.height + rowGap),
                        },
                        width: imageConfig.width,
                        height: imageConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, batchRootId: count > 1 ? rootId : undefined, ...generationMetadata },
                    }));
                    const batchConnections = [...(isEmptyImageNode || writesToDeclaredImage ? [] : [{ id: nanoid(), fromNodeId: nodeId, toNodeId: rootId }]), ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: rootId, toNodeId: childId }))];

                    const previousBatchChildIds = new Set(declaredImageNode?.metadata?.batchChildIds || []);
                    setNodes((prev) => [
                        ...prev
                            .filter((node) => !previousBatchChildIds.has(node.id))
                            .map((node) =>
                                node.id === declaredImageNode?.id
                                    ? {
                                          ...node,
                                          metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                      }
                                    : node.id === nodeId
                                      ? isConfigNode
                                          ? {
                                                ...node,
                                                metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined },
                                            }
                                          : isEmptyImageNode
                                            ? {
                                                  ...node,
                                                  position: rootNode.position,
                                                  width: rootNode.width,
                                                  height: rootNode.height,
                                                  title: rootNode.title,
                                                  metadata: { ...node.metadata, ...rootNode.metadata, errorDetails: undefined },
                                              }
                                            : isImageNode
                                              ? {
                                                    ...node,
                                                    metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined },
                                                }
                                              : {
                                                    ...node,
                                                    type: CanvasNodeType.Text,
                                                    title: prompt.slice(0, 32) || "Prompt",
                                                    width: parentConfig.width,
                                                    height: parentConfig.height,
                                                    metadata: { ...node.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS, fontSize: 14, errorDetails: undefined },
                                                }
                                      : node,
                            ),
                        ...(isEmptyImageNode || writesToDeclaredImage ? [] : [rootNode]),
                        ...childNodes,
                    ]);
                    setConnections((prev) => [...prev.filter((connection) => !previousBatchChildIds.has(connection.fromNodeId) && !previousBatchChildIds.has(connection.toNodeId)), ...batchConnections]);
                    setSelectedNodeIds(new Set([nodeId]));
                    setSelectedConnectionId(null);
                    setDialogNodeId(nodeId);

                    const targetLeaseById = new Map(targetIds.map((targetId) => [targetId, startGenerationRequest(targetId, nodeId, nodeId, runLease.attempt)]));
                    const rootLease = count > 1 ? startGenerationRequest(rootId, nodeId, nodeId, runLease.attempt) : targetLeaseById.get(rootId);
                    let hasSuccess = false;
                    let hasFailure = false;
                    let firstError = "";
                    await Promise.all(
                        targetIds.map(async (targetId) => {
                            const targetLease = targetLeaseById.get(targetId)!;
                            const leases = rootLease ? [runLease, rootLease, targetLease] : [runLease, targetLease];
                            try {
                                const image = referenceImages.length
                                    ? await requestEdit({ ...generationConfig, count: "1" }, effectivePrompt, referenceImages, undefined, { signal: runController.signal }).then((items) => items[0])
                                    : await requestGeneration({ ...generationConfig, count: "1" }, effectivePrompt, { signal: runController.signal }).then((items) => items[0]);
                                assertGenerationRequestCurrent(...leases);
                                const uploaded = await retainGenerationImage(leases, await uploadCanvasImage(image.dataUrl));
                                const imageSize = fitNodeSize(uploaded.width, uploaded.height, imageConfig.width, imageConfig.height);
                                setNodes((prev) => {
                                    const root = prev.find((node) => node.id === rootId);
                                    return prev.map((node) => {
                                        if (node.id !== targetId && node.id !== rootId) return node;
                                        const center = { x: node.position.x + node.width / 2, y: node.position.y + node.height / 2 };
                                        if (node.id === rootId && (targetId === rootId || !root?.metadata?.primaryImageId))
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded), primaryImageId: targetId },
                                            };
                                        if (node.id === targetId)
                                            return {
                                                ...node,
                                                position: { x: center.x - imageSize.width / 2, y: center.y - imageSize.height / 2 },
                                                width: imageSize.width,
                                                height: imageSize.height,
                                                metadata: { ...node.metadata, ...imageMetadata(uploaded) },
                                            };
                                        return node;
                                    });
                                });
                                hasSuccess = true;
                                if (isConfigNode) setNodes((prev) => prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } } : node)));
                                return true;
                            } catch (error) {
                                if (isGenerationCanceled(error) || !isGenerationRequestCurrent(...leases)) return false;
                                const errorDetails = error instanceof Error ? error.message : "生成失败";
                                if (!firstError) firstError = errorDetails;
                                hasFailure = true;
                                setNodes((prev) => prev.map((node) => (node.id === targetId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } } : node)));
                            }
                            return false;
                        }),
                    );
                    const batchCurrent = isGenerationRequestCurrent(runLease) && Array.from(targetLeaseById.values()).every((lease) => isGenerationRequestCurrent(lease)) && (!rootLease || isGenerationRequestCurrent(rootLease));
                    targetLeaseById.forEach((lease) => finishGenerationRequest(lease));
                    if (rootLease && !targetLeaseById.has(rootLease.targetNodeId) && rootLease.targetNodeId !== runLease.targetNodeId) finishGenerationRequest(rootLease);
                    if (!batchCurrent) return;
                    if (hasFailure) {
                        if (!runOptions?.silent) message.error(hasSuccess ? "部分图片生成失败" : firstError || "生成失败");
                    }
                    setNodes((prev) =>
                        prev.map((node) =>
                            node.id === rootId && count > 1
                                ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "全部图片生成失败" } }
                                : node.id === nodeId && isConfigNode
                                  ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "生成失败" } }
                                  : node.id === nodeId && isEmptyImageNode
                                    ? { ...node, metadata: { ...node.metadata, status: hasSuccess ? NODE_STATUS_SUCCESS : NODE_STATUS_ERROR, errorDetails: hasSuccess ? undefined : "生成失败" } }
                                    : node,
                        ),
                    );
                    return;
                }

                if (mode === "video") {
                    const spec = nodeSizeFromRatio(generationConfig.size, NODE_DEFAULT_SIZE[CanvasNodeType.Video].width, NODE_DEFAULT_SIZE[CanvasNodeType.Video].height) || NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                    const isEmptyVideoNode = sourceNode?.type === CanvasNodeType.Video && !sourceNode.metadata?.content;
                    const declaredVideoNode = sourceNode?.type === CanvasNodeType.Config ? findDeclaredOutputNode(nodeId, "video", nodesRef.current, connectionsRef.current) : undefined;
                    const writesToDeclaredVideo = Boolean(declaredVideoNode);
                    const videoId = isEmptyVideoNode ? nodeId : declaredVideoNode?.id || nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const videoNode: CanvasNodeData = {
                        id: videoId,
                        type: CanvasNodeType.Video,
                        title: declaredVideoNode?.title || effectivePrompt.slice(0, 32) || "Generated Video",
                        position: declaredVideoNode?.position || (isEmptyVideoNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y }),
                        width: declaredVideoNode?.width || (isEmptyVideoNode ? sourceNode.width : spec.width),
                        height: declaredVideoNode?.height || (isEmptyVideoNode ? sourceNode.height : spec.height),
                        metadata: {
                            prompt: effectivePrompt,
                            status: NODE_STATUS_LOADING,
                            model: generationConfig.model,
                            size: generationConfig.size,
                            seconds: generationConfig.videoSeconds,
                            vquality: generationConfig.vquality,
                            generateAudio: generationConfig.videoGenerateAudio,
                            watermark: generationConfig.videoWatermark,
                            seedance25TaskMode: generationConfig.seedance25TaskMode,
                            seedance25Continuation: generationConfig.seedance25Continuation,
                            seedance25OutputFormat: generationConfig.seedance25OutputFormat,
                            seedance25InputMode: generationConfig.seedance25InputMode,
                            seedance25Seed: generationConfig.seedance25Seed,
                            seedance25ReturnLastFrame: generationConfig.seedance25ReturnLastFrame,
                            seedance25WebSearch: generationConfig.seedance25WebSearch,
                            seedance25CameraFixed: generationConfig.seedance25CameraFixed,
                            minimaxVideoInputMode: generationConfig.minimaxVideoInputMode,
                            minimaxVideoPromptOptimizer: generationConfig.minimaxVideoPromptOptimizer,
                            minimaxVideoFastPretreatment: generationConfig.minimaxVideoFastPretreatment,
                            references: generationReferenceUrls(generationContext),
                        },
                    };
                    pendingChildIds = [videoId];
                    setNodes((prev) =>
                        isEmptyVideoNode || writesToDeclaredVideo
                            ? prev.map((node) =>
                                  node.id === videoId
                                      ? { ...node, ...videoNode, metadata: { ...node.metadata, ...videoNode.metadata } }
                                      : node.id === nodeId && sourceNode?.type === CanvasNodeType.Config
                                        ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } }
                                        : node,
                              )
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), videoNode],
                    );
                    if (!isEmptyVideoNode && !writesToDeclaredVideo) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: videoId }]);
                    const videoLease = startGenerationRequest(videoId, nodeId, nodeId, runLease.attempt);
                    try {
                        const generatedVideo = await requestVideoGeneration(generationConfig, effectivePrompt, generationContext.referenceImages, generationContext.referenceVideos, generationContext.referenceAudios, { signal: runController.signal });
                        assertGenerationRequestCurrent(runLease, videoLease);
                        const video = await retainGenerationMedia([runLease, videoLease], stageUploadedMedia(await storeGeneratedVideo(generatedVideo)));
                        const videoSize = fitNodeSize(video.width || spec.width, video.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === videoId
                                    ? {
                                          ...node,
                                          width: videoSize.width,
                                          height: videoSize.height,
                                          position: { x: node.position.x + node.width / 2 - videoSize.width / 2, y: node.position.y + node.height / 2 - videoSize.height / 2 },
                                          metadata: {
                                              ...node.metadata,
                                              ...videoMetadata(video),
                                              prompt: effectivePrompt,
                                              model: generationConfig.model,
                                              size: generationConfig.size,
                                              seconds: generationConfig.videoSeconds,
                                              vquality: generationConfig.vquality,
                                              generateAudio: generationConfig.videoGenerateAudio,
                                              watermark: generationConfig.videoWatermark,
                                              seedance25TaskMode: generationConfig.seedance25TaskMode,
                                              seedance25Continuation: generationConfig.seedance25Continuation,
                                              seedance25OutputFormat: generationConfig.seedance25OutputFormat,
                                              seedance25InputMode: generationConfig.seedance25InputMode,
                                              seedance25Seed: generationConfig.seedance25Seed,
                                              seedance25ReturnLastFrame: generationConfig.seedance25ReturnLastFrame,
                                              seedance25WebSearch: generationConfig.seedance25WebSearch,
                                              seedance25CameraFixed: generationConfig.seedance25CameraFixed,
                                              minimaxVideoInputMode: generationConfig.minimaxVideoInputMode,
                                              minimaxVideoPromptOptimizer: generationConfig.minimaxVideoPromptOptimizer,
                                              minimaxVideoFastPretreatment: generationConfig.minimaxVideoFastPretreatment,
                                              references: generationReferenceUrls(generationContext),
                                          },
                                      }
                                    : node.id === nodeId && sourceNode?.type === CanvasNodeType.Config
                                      ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } }
                                      : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(videoLease);
                    }
                    return;
                }

                if (mode === "audio") {
                    const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                    const isEmptyAudioNode = sourceNode?.type === CanvasNodeType.Audio && !sourceNode.metadata?.content;
                    const declaredAudioNode = sourceNode?.type === CanvasNodeType.Config ? findDeclaredOutputNode(nodeId, "audio", nodesRef.current, connectionsRef.current) : undefined;
                    const writesToDeclaredAudio = Boolean(declaredAudioNode);
                    const audioId = isEmptyAudioNode ? nodeId : declaredAudioNode?.id || nanoid();
                    const parent = sourceNode?.position || { x: 0, y: 0 };
                    const audioNode: CanvasNodeData = {
                        id: audioId,
                        type: CanvasNodeType.Audio,
                        title: declaredAudioNode?.title || effectivePrompt.slice(0, 32) || "Generated Audio",
                        position: declaredAudioNode?.position || (isEmptyAudioNode ? sourceNode.position : { x: parent.x + (sourceNode?.width || spec.width) + 96, y: parent.y + ((sourceNode?.height || spec.height) - spec.height) / 2 }),
                        width: declaredAudioNode?.width || (isEmptyAudioNode ? sourceNode.width : spec.width),
                        height: declaredAudioNode?.height || (isEmptyAudioNode ? sourceNode.height : spec.height),
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, ...buildAudioGenerationMetadata(generationConfig) },
                    };
                    pendingChildIds = [audioId];
                    setNodes((prev) =>
                        isEmptyAudioNode || writesToDeclaredAudio
                            ? prev.map((node) =>
                                  node.id === audioId
                                      ? { ...node, ...audioNode, metadata: { ...node.metadata, ...audioNode.metadata } }
                                      : node.id === nodeId && sourceNode?.type === CanvasNodeType.Config
                                        ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } }
                                        : node,
                              )
                            : [...prev.map((node) => (node.id === nodeId ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } } : node)), audioNode],
                    );
                    if (!isEmptyAudioNode && !writesToDeclaredAudio) setConnections((prev) => [...prev, { id: nanoid(), fromNodeId: nodeId, toNodeId: audioId }]);
                    const audioLease = startGenerationRequest(audioId, nodeId, nodeId, runLease.attempt);
                    try {
                        const generatedAudio = await requestAudioGeneration(generationConfig, effectivePrompt, { signal: runController.signal });
                        assertGenerationRequestCurrent(runLease, audioLease);
                        const audio = await retainGenerationMedia([runLease, audioLease], stageUploadedMedia(await storeGeneratedAudio(generatedAudio, generationConfig.audioFormat)));
                        setNodes((prev) =>
                            prev.map((node) =>
                                node.id === audioId
                                    ? { ...node, metadata: { ...node.metadata, ...audioMetadata(audio), prompt: effectivePrompt, ...buildAudioGenerationMetadata(generationConfig) } }
                                    : node.id === nodeId && sourceNode?.type === CanvasNodeType.Config
                                      ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS, errorDetails: undefined } }
                                      : node,
                            ),
                        );
                    } finally {
                        finishGenerationRequest(audioLease);
                    }
                    return;
                }

                let streamed = "";
                const isConfigNode = sourceNode?.type === CanvasNodeType.Config;
                const textCount = isConfigNode ? getGenerationCount(generationConfig.count) : 1;
                const parentConfig = NODE_DEFAULT_SIZE[isConfigNode ? CanvasNodeType.Config : CanvasNodeType.Text];
                const textConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Text];
                const parentPosition = sourceNode?.position || { x: 0, y: 0 };
                const declaredTextNode = isConfigNode ? findDeclaredOutputNode(nodeId, "text", nodesRef.current, connectionsRef.current) : undefined;
                const childIds = isConfigNode || editingTextNode ? (declaredTextNode ? [declaredTextNode.id] : Array.from({ length: textCount }, () => nanoid())) : [];
                pendingChildIds = childIds;
                if (isConfigNode || editingTextNode) {
                    const childNodes: CanvasNodeData[] = childIds.map((id, index) => ({
                        id,
                        type: CanvasNodeType.Text,
                        title: declaredTextNode?.title || effectivePrompt.slice(0, 32) || "Generated Text",
                        position: declaredTextNode?.position || {
                            x: parentPosition.x + parentConfig.width + 96,
                            y: parentPosition.y + parentConfig.height / 2 - textConfig.height / 2 + (index - (textCount - 1) / 2) * (textConfig.height + 36),
                        },
                        width: declaredTextNode?.width || textConfig.width,
                        height: declaredTextNode?.height || textConfig.height,
                        metadata: { prompt: effectivePrompt, status: NODE_STATUS_LOADING, fontSize: 14, model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort },
                    }));
                    setNodes((prev) => [
                        ...prev.map((node) =>
                            node.id === declaredTextNode?.id
                                ? { ...node, metadata: { ...node.metadata, ...childNodes[0]?.metadata } }
                                : node.id === nodeId && isConfigNode
                                  ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } }
                                  : node,
                        ),
                        ...childNodes.filter((node) => node.id !== declaredTextNode?.id),
                    ]);
                    if (!declaredTextNode) setConnections((prev) => [...prev, ...childIds.map((childId) => ({ id: nanoid(), fromNodeId: nodeId, toNodeId: childId }))]);
                }

                const textTargetIds = childIds.length ? childIds : [nodeId];
                const textLeaseById = new Map(textTargetIds.map((targetNodeId) => [targetNodeId, startGenerationRequest(targetNodeId, nodeId, nodeId, runLease.attempt)]));
                try {
                    const answers = await Promise.all(
                        textTargetIds.map((targetNodeId) => {
                            const targetLease = textLeaseById.get(targetNodeId)!;
                            return requestImageQuestion(
                                generationConfig,
                                buildNodeResponseMessages({ ...generationContext, prompt: effectivePrompt }),
                                (text) => {
                                    if (!isGenerationRequestCurrent(runLease, targetLease)) return;
                                    streamed = text;
                                    setNodes((prev) => prev.map((node) => (node.id === targetNodeId ? { ...node, type: CanvasNodeType.Text, metadata: { ...node.metadata, content: text, status: NODE_STATUS_LOADING } } : node)));
                                },
                                { signal: runController.signal },
                            ).then((answer) => ({ nodeId: targetNodeId, content: answer }));
                        }),
                    );
                    assertGenerationRequestCurrent(runLease, ...textLeaseById.values());
                    const answerByNodeId = new Map(answers.map((item) => [item.nodeId, item.content]));
                    setNodes((prev) =>
                        prev.map((node) =>
                            childIds.includes(node.id)
                                ? { ...node, metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, status: NODE_STATUS_SUCCESS } }
                                : node.id === nodeId && isConfigNode
                                  ? { ...node, metadata: { ...node.metadata, status: NODE_STATUS_SUCCESS } }
                                  : node.id === nodeId && !editingTextNode
                                    ? {
                                          ...node,
                                          type: CanvasNodeType.Text,
                                          title: prompt.slice(0, 32) || "Generated Text",
                                          metadata: { ...node.metadata, content: answerByNodeId.get(node.id) || streamed, model: generationConfig.model, reasoningEffort: generationConfig.reasoningEffort, status: NODE_STATUS_SUCCESS },
                                      }
                                    : node,
                        ),
                    );
                } finally {
                    textLeaseById.forEach((lease) => finishGenerationRequest(lease));
                }
            } catch (error) {
                if (isGenerationCanceled(error) || !isGenerationRequestCurrent(runLease)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                if (!runOptions?.silent) message.error(errorDetails);
                setNodes((prev) =>
                    prev.map((node) => (node.id === nodeId || pendingChildIds.includes(node.id) ? (node.id === nodeId && !markSourceStatus ? node : { ...node, metadata: { ...node.metadata, status: NODE_STATUS_ERROR, errorDetails } }) : node)),
                );
            } finally {
                finishGenerationRequest(runLease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, nodeId)) setRunningNodeId((current) => (current === nodeId ? null : current));
            }
        },
        [assertGenerationRequestCurrent, effectiveConfig, finishGenerationRequest, isAiConfigReady, isGenerationRequestCurrent, message, openConfigDialog, retainGenerationImage, retainGenerationMedia, stageUploadedMedia, startGenerationRequest, uploadCanvasImage],
    );
    const generateIntoResultSlot = useCallback(
        async (nodeId: string, mode: CanvasGenerationMode, prompt: string, options: CanvasGenerationRunOptions = {}): Promise<CanvasGenerationOutcome> => {
            const sourceNode = nodesRef.current.find((node) => node.id === nodeId);
            if (!sourceNode) throw new Error("找不到要运行的步骤");
            const outputResolution = resolveDeclaredOutputNode(nodeId, mode, nodesRef.current, connectionsRef.current);
            if (outputResolution.status === "none" || !outputResolution.explicit) throw new Error("请先为这一步添加结果槽");
            if (outputResolution.status === "ambiguous") throw new Error("这一步连接了多个结果槽，请保留一个后再运行");
            const slotId = outputResolution.node.id;
            const normalizedPrompt = prompt.trim();
            if (!normalizedPrompt && (mode === "text" || mode === "audio")) throw new Error("先写下这一步要生成的内容");
            if (options.signal?.aborted) throw workflowAbortError();
            const slotRequestKey = `result-slot:${slotId}`;
            const slotLease = startGenerationRequest(slotRequestKey, nodeId, nodeId);

            commitNodes((current) =>
                current.map((node) => {
                    if (node.id !== slotId || !isCanvasResultSlot(node)) return node;
                    return setCanvasResultSlotState(node, "running");
                }),
            );
            options.onProgress?.({ message: "正在生成", ratio: 0.08 });

            const abort = () => stopGenerationByRunningId(nodeId);
            options.signal?.addEventListener("abort", abort, { once: true });
            try {
                if (options.signal?.aborted) {
                    abort();
                    throw workflowAbortError();
                }
                await handleGenerateNode(nodeId, mode, normalizedPrompt, { silent: true, generationContext: options.generationContext, attempt: slotLease.attempt });
                assertGenerationRequestCurrent(slotLease);
                if (options.signal?.aborted) throw workflowAbortError();
                const settledSlot = await waitForCanvasResultSlot(nodesRef, slotId, 4_000, () => isGenerationRequestCurrent(slotLease));
                assertGenerationRequestCurrent(slotLease);
                const artifacts = canvasResultArtifacts(settledSlot, nodesRef.current);
                const currentBatchSettled = isCurrentCanvasImageBatchSettled(settledSlot, nodesRef.current);
                // 与 waitForCanvasResultSlot 的判定保持一致:handleGenerateNode 成功后只更新
                // status/content,不会把 slotState 切到 ready,因此 status 已到成功/失败就视为完成。
                const statusSettled = settledSlot.metadata?.status === NODE_STATUS_SUCCESS || settledSlot.metadata?.status === NODE_STATUS_ERROR;
                const lifecycleSettled = statusSettled || (settledSlot.metadata?.status !== NODE_STATUS_LOADING && settledSlot.metadata?.slotState !== "running");
                if (currentBatchSettled !== true && !lifecycleSettled) {
                    throw new Error("这一步未能完成，请检查模型配置后重试");
                }
                if (!artifacts.length || settledSlot.metadata?.status === NODE_STATUS_ERROR) {
                    throw new Error(settledSlot.metadata?.errorDetails || "这一步没有生成可用结果");
                }

                options.onPersisting?.();
                options.onProgress?.({ message: "正在保存结果", ratio: 0.92 });
                assertGenerationRequestCurrent(slotLease);
                commitNodes((current) => current.map((node) => (node.id === slotId && isCanvasResultSlot(node) ? setCanvasResultSlotState(node, "persisting") : node)));

                const versionId = `${options.runId || "manual"}-${options.attemptId || nanoid()}`;
                commitNodes((current) =>
                    current.map((node) =>
                        node.id === slotId && isCanvasResultSlot(node)
                            ? appendResultSlotSuccess(node, {
                                  id: versionId,
                                  artifacts,
                                  primaryArtifactId: artifacts[0]?.id,
                                  createdAt: new Date().toISOString(),
                                  sourceNodeId: nodeId,
                                  runId: options.runId,
                                  attemptId: options.attemptId,
                              })
                            : node,
                    ),
                );
                flushProjectSave();
                await flushCanvasStoreWrites();
                options.onProgress?.({ message: "结果已就绪", ratio: 1 });
                return { sourceNodeId: nodeId, outputSlotId: slotId, mode, versionId, artifacts };
            } catch (error) {
                if (isCanvasGenerationRequestSuperseded(generationRequestsRef.current, slotLease, getActiveGenerationBoundary())) throw workflowAbortError();
                if (isGenerationCanceled(error) || options.signal?.aborted || (error as Error)?.name === "AbortError") {
                    commitNodes((current) =>
                        current.map((node) => {
                            if (node.id !== slotId || !isCanvasResultSlot(node)) return node;
                            return setCanvasResultSlotState(node, getCurrentResultSlotVersion(node) ? "ready" : "empty");
                        }),
                    );
                    throw workflowAbortError();
                }
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                const failureId = `${options.runId || "manual"}-${options.attemptId || nanoid()}-failed`;
                commitNodes((current) =>
                    current.map((node) =>
                        node.id === slotId && isCanvasResultSlot(node)
                            ? appendResultSlotFailure(node, {
                                  id: failureId,
                                  errorDetails,
                                  createdAt: new Date().toISOString(),
                                  sourceNodeId: nodeId,
                                  runId: options.runId,
                                  attemptId: options.attemptId,
                              })
                            : node,
                    ),
                );
                flushProjectSave();
                await flushCanvasStoreWrites();
                if (!options.silent) message.error(errorDetails);
                throw error instanceof Error ? error : new Error(errorDetails);
            } finally {
                options.signal?.removeEventListener("abort", abort);
                finishGenerationRequest(slotLease);
            }
        },
        [assertGenerationRequestCurrent, commitNodes, finishGenerationRequest, flushProjectSave, getActiveGenerationBoundary, handleGenerateNode, isGenerationRequestCurrent, message, startGenerationRequest, stopGenerationByRunningId],
    );

    const startCanvasWorkflow = useCallback(
        async (startNodeIds: string[] | undefined, mode: WorkflowExecutionMode): Promise<WorkflowRunSnapshot<CanvasResultSlotArtifact>> => {
            const frozenNodes = nodesRef.current;
            const frozenConnections = connectionsRef.current;
            const compiled = buildCanvasWorkflowGraph({ nodes: frozenNodes, connections: frozenConnections, startNodeIds });
            if (!compiled.ok) throw new Error(canvasWorkflowIssueMessage(compiled.issues[0]?.code));
            if (!compiled.graph.nodes.length) throw new Error("画布上还没有可运行的步骤");
            const frozenActionById = new Map(frozenNodes.map((node) => [node.id, node]));
            const frozenInputsByActionId = new Map(compiled.graph.nodes.map((node) => [node.id, buildNodeGenerationInputs(node.id, frozenNodes, frozenConnections)]));

            if (workflowExecutionRef.current) await workflowExecutionRef.current.cancel("已开始新的运行");
            workflowObserverCleanupRef.current?.();

            const execution = createWorkflowExecution<CanvasResultSlotArtifact, CanvasWorkflowNodeData>({
                graph: compiled.graph,
                mode,
                runNode: async (context) => {
                    const data = context.node.data;
                    if (!data) throw new Error("这一步缺少运行配置");
                    const action = nodesRef.current.find((node) => node.id === data.actionNodeId);
                    if (!action) throw new Error("这一步已不在画布上");
                    const frozenAction = frozenActionById.get(data.actionNodeId);
                    if (!frozenAction) throw new Error("这一步不在本次运行快照中");

                    if (action.type === CanvasNodeType.Terminal) {
                        const content = data.mode === "text" ? action.metadata?.terminalOutputValue || action.metadata?.terminalOutput || action.metadata?.content || "" : action.metadata?.terminalOutputArtifactUrl || action.metadata?.content || "";
                        if (!content) throw new Error("请先在终端步骤中完成运行");
                        const artifact: CanvasResultSlotArtifact = {
                            id: `${action.id}-${context.attempt}`,
                            kind: data.mode,
                            content,
                            title: action.title,
                            storageKey: action.metadata?.terminalOutputArtifactStorageKey || action.metadata?.storageKey,
                            mimeType: action.metadata?.terminalOutputMimeType || action.metadata?.mimeType,
                            bytes: action.metadata?.bytes,
                            naturalWidth: action.metadata?.naturalWidth,
                            naturalHeight: action.metadata?.naturalHeight,
                            durationMs: action.metadata?.durationMs,
                        };
                        context.markPersisting();
                        const versionId = `${context.runId}-${context.attempt}`;
                        commitNodes((current) =>
                            current.map((node) =>
                                node.id === data.outputSlotId && isCanvasResultSlot(node)
                                    ? appendResultSlotSuccess(setCanvasResultSlotState(node, "persisting"), {
                                          id: versionId,
                                          artifacts: [artifact],
                                          createdAt: new Date().toISOString(),
                                          sourceNodeId: action.id,
                                          runId: context.runId,
                                          attemptId: String(context.attempt),
                                      })
                                    : node,
                            ),
                        );
                        flushProjectSave();
                        await flushCanvasStoreWrites();
                        return { artifacts: [artifact], metadata: { title: action.title, outputSlotId: data.outputSlotId, versionId } };
                    }

                    const generationInputs = resolveCanvasWorkflowGenerationInputs({
                        sourceSnapshot: data.sourceSnapshot,
                        frozenInputs: frozenInputsByActionId.get(data.actionNodeId) || [],
                        frozenNodes,
                        liveNodes: nodesRef.current,
                        workflowInputs: context.inputs,
                    });
                    const generationContext = buildNodeGenerationContextFromInputs(frozenAction, generationInputs, data.prompt);
                    const outcome = await generateIntoResultSlot(data.actionNodeId, data.mode, data.prompt, {
                        runId: context.runId,
                        attemptId: String(context.attempt),
                        signal: context.signal,
                        onPersisting: context.markPersisting,
                        onProgress: context.reportProgress,
                        silent: true,
                        generationContext,
                    });
                    return { artifacts: outcome.artifacts, metadata: { title: action.title, outputSlotId: outcome.outputSlotId, versionId: outcome.versionId } };
                },
            });
            workflowExecutionRef.current = execution;
            const stopObservingStore = observeWorkflowExecution(execution);
            const outputSlotByActionId = new Map(compiled.graph.nodes.map((node) => [node.id, node.data?.outputSlotId]));
            commitNodes((current) =>
                current.map((node) => {
                    const actionRecord = execution.getSnapshot().nodes.find((record) => outputSlotByActionId.get(record.nodeId) === node.id);
                    if (!actionRecord || !isCanvasResultSlot(node)) return node;
                    return setCanvasResultSlotState(node, actionRecord.status === "waiting_inputs" ? "waiting" : getCurrentResultSlotVersion(node) ? "stale" : "empty");
                }),
            );
            const stopObservingSlots = execution.subscribe((event) => {
                if (event.type !== "node_status_changed") return;
                const slotId = outputSlotByActionId.get(event.nodeId);
                if (!slotId) return;
                commitNodes((current) =>
                    current.map((node) => {
                        if (node.id !== slotId || !isCanvasResultSlot(node)) return node;
                        return syncResultSlotWorkflowStatus(node, event.status, event.error?.message);
                    }),
                );
                if (event.status === "error" || event.status === "blocked") flushProjectSave();
            });
            workflowObserverCleanupRef.current = () => {
                stopObservingSlots();
                stopObservingStore();
            };
            return execution.start();
        },
        [commitNodes, flushProjectSave, generateIntoResultSlot],
    );

    useEffect(() => {
        runWorkflowRef.current = startCanvasWorkflow;
        return () => {
            if (runWorkflowRef.current === startCanvasWorkflow) runWorkflowRef.current = null;
        };
    }, [startCanvasWorkflow]);

    const continueCanvasWorkflow = useCallback(async (actionNodeId: string) => {
        const execution = workflowExecutionRef.current;
        if (!execution) throw new Error("当前没有等待继续的工作流");
        return execution.continueNode(actionNodeId);
    }, []);

    const retryCanvasWorkflow = useCallback(async (actionNodeId: string) => {
        const execution = workflowExecutionRef.current;
        if (!execution) throw new Error("当前没有可重试的工作流");
        return execution.retryFrom(actionNodeId);
    }, []);

    const stopCanvasWorkflow = useCallback(async () => workflowExecutionRef.current?.cancel("用户停止"), []);
    const resumeCanvasWorkflow = useCallback(async () => workflowExecutionRef.current?.resume(), []);

    const inspectWorkflowResult = useCallback(
        (actionNodeId: string) => {
            const action = nodesRef.current.find((node) => node.id === actionNodeId);
            if (!action) return;
            const mode = action.type === CanvasNodeType.Terminal ? action.metadata?.terminalOutputMode || "text" : action.metadata?.generationMode || "image";
            const resolution = resolveDeclaredOutputNode(actionNodeId, mode, nodesRef.current, connectionsRef.current);
            if (resolution.status !== "unique") return;
            setSelectedNodeIds(new Set([resolution.node.id]));
            focusNode(resolution.node.id);
        },
        [focusNode],
    );

    useEffect(() => {
        continueWorkflowRef.current = continueCanvasWorkflow;
        retryWorkflowRef.current = retryCanvasWorkflow;
        stopWorkflowRef.current = stopCanvasWorkflow;
        resumeWorkflowRef.current = resumeCanvasWorkflow;
        inspectWorkflowResultRef.current = inspectWorkflowResult;
        return () => {
            if (continueWorkflowRef.current === continueCanvasWorkflow) continueWorkflowRef.current = null;
            if (retryWorkflowRef.current === retryCanvasWorkflow) retryWorkflowRef.current = null;
            if (stopWorkflowRef.current === stopCanvasWorkflow) stopWorkflowRef.current = null;
            if (resumeWorkflowRef.current === resumeCanvasWorkflow) resumeWorkflowRef.current = null;
            if (inspectWorkflowResultRef.current === inspectWorkflowResult) inspectWorkflowResultRef.current = null;
        };
    }, [continueCanvasWorkflow, inspectWorkflowResult, resumeCanvasWorkflow, retryCanvasWorkflow, stopCanvasWorkflow]);

    const handleRetryNode = useCallback(
        async (node: CanvasNodeData) => {
            const sourceNode = findRetrySourceNode(node.id, nodesRef.current, connectionsRef.current) || node;
            const batchRoot = node.metadata?.batchRootId ? nodesRef.current.find((item) => item.id === node.metadata?.batchRootId) : null;
            const savedImageMetadata = node.type === CanvasNodeType.Image ? { ...batchRoot?.metadata, ...node.metadata } : undefined;
            const hasSavedImageMetadata = Boolean(savedImageMetadata?.generationType);
            const generationConfig =
                hasSavedImageMetadata && savedImageMetadata
                    ? {
                          ...effectiveConfig,
                          model: savedImageMetadata.model || effectiveConfig.imageModel || effectiveConfig.model,
                          quality: savedImageMetadata.quality || effectiveConfig.quality,
                          size: savedImageMetadata.size || effectiveConfig.size,
                          background: savedImageMetadata.background ?? effectiveConfig.background,
                          count: "1",
                      }
                    : { ...buildGenerationConfig(effectiveConfig, sourceNode, node.type === CanvasNodeType.Text ? "text" : node.type === CanvasNodeType.Video ? "video" : node.type === CanvasNodeType.Audio ? "audio" : "image"), count: "1" };
            if (!isAiConfigReady(generationConfig, generationConfig.model)) {
                openConfigDialog(true);
                return;
            }

            const context = hasSavedImageMetadata ? null : await hydrateNodeGenerationContext(buildNodeGenerationContext(sourceNode.id, nodesRef.current, connectionsRef.current, sourceNode.metadata?.prompt || node.metadata?.prompt || ""));
            const prompt = (savedImageMetadata?.prompt || context?.prompt || "").trim();
            if (!prompt) {
                message.warning("找不到提示词，无法重试");
                return;
            }
            const generationType = savedImageMetadata?.generationType;
            const useReferenceImages = generationType ? generationType === "edit" : Boolean(context?.referenceImages.length);
            const retryReferenceImages =
                hasSavedImageMetadata && savedImageMetadata ? await resolveMetadataReferences(savedImageMetadata) : useReferenceImages ? (context?.referenceImages.length ? context.referenceImages : sourceNodeReferenceImages(batchRoot || sourceNode)) : [];
            if (useReferenceImages && !retryReferenceImages) {
                message.error("参考图片已丢失，无法继续重试");
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails: "参考图片已丢失，无法继续重试" } } : item)));
                return;
            }
            const retryImages = retryReferenceImages || [];

            setRunningNodeId(node.id);
            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_LOADING, errorDetails: undefined } } : item)));
            const lease = startGenerationRequest(node.id, sourceNode.id, node.id);

            try {
                if (node.type === CanvasNodeType.Text) {
                    if (!context) return;
                    let streamed = "";
                    const answer = await requestImageQuestion(
                        generationConfig,
                        buildNodeResponseMessages({ ...context, prompt }),
                        (text) => {
                            if (!isGenerationRequestCurrent(lease)) return;
                            streamed = text;
                            setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: text, status: NODE_STATUS_LOADING } } : item)));
                        },
                        { signal: lease.attempt.controller.signal },
                    );
                    assertGenerationRequestCurrent(lease);
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, type: CanvasNodeType.Text, metadata: { ...item.metadata, content: answer || streamed, prompt, status: NODE_STATUS_SUCCESS } } : item)));
                    return;
                }
                if (node.type === CanvasNodeType.Video) {
                    const generatedVideo = await requestVideoGeneration(generationConfig, prompt, retryImages, context?.referenceVideos || [], context?.referenceAudios || [], { signal: lease.attempt.controller.signal });
                    assertGenerationRequestCurrent(lease);
                    const video = await retainGenerationMedia([lease], stageUploadedMedia(await storeGeneratedVideo(generatedVideo)));
                    const videoSize = fitNodeSize(video.width || node.width, video.height || node.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                    setNodes((prev) =>
                        prev.map((item) =>
                            item.id === node.id
                                ? {
                                      ...item,
                                      width: videoSize.width,
                                      height: videoSize.height,
                                      position: { x: item.position.x + item.width / 2 - videoSize.width / 2, y: item.position.y + item.height / 2 - videoSize.height / 2 },
                                      metadata: {
                                          ...item.metadata,
                                          ...videoMetadata(video),
                                          prompt,
                                          model: generationConfig.model,
                                          size: generationConfig.size,
                                          seconds: generationConfig.videoSeconds,
                                          vquality: generationConfig.vquality,
                                          generateAudio: generationConfig.videoGenerateAudio,
                                          watermark: generationConfig.videoWatermark,
                                          seedance25TaskMode: generationConfig.seedance25TaskMode,
                                          seedance25Continuation: generationConfig.seedance25Continuation,
                                          seedance25OutputFormat: generationConfig.seedance25OutputFormat,
                                          seedance25InputMode: generationConfig.seedance25InputMode,
                                          seedance25Seed: generationConfig.seedance25Seed,
                                          seedance25ReturnLastFrame: generationConfig.seedance25ReturnLastFrame,
                                          seedance25WebSearch: generationConfig.seedance25WebSearch,
                                          seedance25CameraFixed: generationConfig.seedance25CameraFixed,
                                          minimaxVideoInputMode: generationConfig.minimaxVideoInputMode,
                                          minimaxVideoPromptOptimizer: generationConfig.minimaxVideoPromptOptimizer,
                                          minimaxVideoFastPretreatment: generationConfig.minimaxVideoFastPretreatment,
                                      },
                                  }
                                : item,
                        ),
                    );
                    return;
                }
                if (node.type === CanvasNodeType.Audio) {
                    const generatedAudio = await requestAudioGeneration(generationConfig, prompt, { signal: lease.attempt.controller.signal });
                    assertGenerationRequestCurrent(lease);
                    const audio = await retainGenerationMedia([lease], stageUploadedMedia(await storeGeneratedAudio(generatedAudio, generationConfig.audioFormat)));
                    setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, ...audioMetadata(audio), prompt, ...buildAudioGenerationMetadata(generationConfig) } } : item)));
                    return;
                }

                const image = useReferenceImages
                    ? await requestEdit(generationConfig, prompt, retryImages, undefined, { signal: lease.attempt.controller.signal }).then((items) => items[0])
                    : await requestGeneration(generationConfig, prompt, { signal: lease.attempt.controller.signal }).then((items) => items[0]);
                assertGenerationRequestCurrent(lease);
                const uploadedImage = await retainGenerationImage([lease], await uploadCanvasImage(image.dataUrl));
                const imageConfig = NODE_DEFAULT_SIZE[CanvasNodeType.Image];
                const imageSize = fitNodeSize(uploadedImage.width, uploadedImage.height, imageConfig.width, imageConfig.height);
                const generationMetadata = savedImageMetadata?.generationType
                    ? {
                          generationType: savedImageMetadata.generationType,
                          model: generationConfig.model,
                          size: generationConfig.size,
                          quality: generationConfig.quality,
                          ...(generationConfig.background ? { background: generationConfig.background } : {}),
                          count: savedImageMetadata.count || 1,
                          references: savedImageMetadata.references,
                      }
                    : buildImageGenerationMetadata(useReferenceImages ? "edit" : "generation", generationConfig, 1, retryImages);
                setNodes((prev) =>
                    prev.map((item) =>
                        item.id === node.id
                            ? {
                                  ...item,
                                  type: CanvasNodeType.Image,
                                  width: imageSize.width,
                                  height: imageSize.height,
                                  metadata: { ...item.metadata, ...imageMetadata(uploadedImage), prompt, ...generationMetadata },
                              }
                            : item,
                    ),
                );
            } catch (error) {
                if (isGenerationCanceled(error) || !isGenerationRequestCurrent(lease)) return;
                const errorDetails = error instanceof Error ? error.message : "生成失败";
                message.error(errorDetails);
                setNodes((prev) => prev.map((item) => (item.id === node.id ? { ...item, metadata: { ...item.metadata, status: NODE_STATUS_ERROR, errorDetails } } : item)));
            } finally {
                finishGenerationRequest(lease);
                if (!hasCanvasGenerationRequestForRunningId(generationRequestsRef.current, node.id)) setRunningNodeId((current) => (current === node.id ? null : current));
            }
        },
        [assertGenerationRequestCurrent, effectiveConfig, finishGenerationRequest, isAiConfigReady, isGenerationRequestCurrent, message, openConfigDialog, retainGenerationImage, retainGenerationMedia, stageUploadedMedia, startGenerationRequest, uploadCanvasImage],
    );

    const generateImageFromTextNode = useCallback(
        (node: CanvasNodeData) => {
            const prompt = (node.metadata?.content || node.metadata?.prompt || "").trim();
            if (!prompt) {
                message.warning("文本节点为空，无法生图");
                return;
            }
            const sourceNode = nodesRef.current.find((item) => item.id === node.id);
            if (!sourceNode) return;
            const nodeSize = getNodeSpec(CanvasNodeType.Config);
            const configNode = createCanvasNode(
                CanvasNodeType.Config,
                {
                    x: sourceNode.position.x + sourceNode.width + 96 + nodeSize.width / 2,
                    y: sourceNode.position.y + sourceNode.height / 2,
                },
                {
                    prompt: "",
                    model: effectiveConfig.imageModel || effectiveConfig.model,
                    size: effectiveConfig.size,
                    count: getGenerationCount(effectiveConfig.canvasImageCount || effectiveConfig.count),
                },
            );
            const connection = { id: nanoid(), fromNodeId: sourceNode.id, toNodeId: configNode.id };
            const nextNodes = nodesRef.current.map((item) => (item.id === sourceNode.id ? { ...item, metadata: { ...item.metadata, content: prompt, prompt, status: NODE_STATUS_SUCCESS } } : item)).concat(configNode);
            const nextConnections = [...connectionsRef.current, connection];
            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            setSelectedNodeIds(new Set([configNode.id]));
            setSelectedConnectionId(null);
            setDialogNodeId(configNode.id);
        },
        [effectiveConfig.canvasImageCount, effectiveConfig.count, effectiveConfig.imageModel, effectiveConfig.model, effectiveConfig.size, message],
    );

    const insertAssistantImage = useCallback(
        async (image: CanvasAssistantImage) => {
            const storedImage = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: 1, height: 1, bytes: 0, mimeType: "image/png" } : await uploadCanvasImage(image.dataUrl);
            const meta = storedImage.width === 1 && storedImage.height === 1 ? await readImageMeta(storedImage.url) : storedImage;
            const config = fitNodeSize(meta.width, meta.height);
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const id = `image-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
            const node: CanvasNodeData = {
                id,
                type: CanvasNodeType.Image,
                title: image.prompt.slice(0, 32) || "Generated Image",
                position: { x: center.x - config.width / 2, y: center.y - config.height / 2 },
                width: config.width,
                height: config.height,
                metadata: { ...imageMetadata({ ...storedImage, width: meta.width, height: meta.height }), prompt: image.prompt },
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([id]));
            setSelectedConnectionId(null);
            setDialogNodeId(id);
        },
        [screenToCanvas, size.height, size.width, uploadCanvasImage],
    );

    const insertAssistantText = useCallback(
        (text: string, title?: string) => {
            const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
            const node = {
                ...createCanvasNode(CanvasNodeType.Text, center, { content: text, status: NODE_STATUS_SUCCESS }),
                title: title || text.slice(0, 32) || "Assistant Text",
            };

            setNodes((prev) => [...prev, node]);
            setSelectedNodeIds(new Set([node.id]));
            setSelectedConnectionId(null);
        },
        [screenToCanvas, size.height, size.width],
    );

    const handleAssetInsert = useCallback(
        (payload: InsertAssetPayload) => {
            if (payload.kind === "structured") {
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const structuredNodes = createStructuredAssetGroup(payload, center);
                setNodes((prev) => [...prev, ...structuredNodes]);
                setSelectedNodeIds(new Set([structuredNodes[0].id]));
                setSelectedConnectionId(null);
            } else if (payload.kind === "text") {
                insertAssistantText(payload.content, payload.title);
            } else if (payload.kind === "video") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Video];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `video-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                const nextSize = fitNodeSize(payload.width || spec.width, payload.height || spec.height, VIDEO_NODE_MAX_WIDTH, VIDEO_NODE_MAX_HEIGHT);
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Video,
                        title: payload.title,
                        position: { x: center.x - nextSize.width / 2, y: center.y - nextSize.height / 2 },
                        width: nextSize.width,
                        height: nextSize.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, naturalWidth: payload.width, naturalHeight: payload.height },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else if (payload.kind === "audio") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.Audio];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `audio-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.Audio,
                        title: payload.title,
                        position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                        width: spec.width,
                        height: spec.height,
                        metadata: { content: payload.url, storageKey: payload.storageKey, status: NODE_STATUS_SUCCESS, durationMs: payload.durationMs, bytes: payload.bytes, mimeType: payload.mimeType },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else if (payload.kind === "file") {
                const spec = NODE_DEFAULT_SIZE[CanvasNodeType.File];
                const center = screenToCanvas((containerRef.current?.getBoundingClientRect().left || 0) + size.width / 2, (containerRef.current?.getBoundingClientRect().top || 0) + size.height / 2);
                const id = `file-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
                setNodes((prev) => [
                    ...prev,
                    {
                        id,
                        type: CanvasNodeType.File,
                        title: payload.title,
                        position: { x: center.x - spec.width / 2, y: center.y - spec.height / 2 },
                        width: spec.width,
                        height: spec.height,
                        metadata: { storageKey: payload.storageKey, fileName: payload.fileName, bytes: payload.bytes, mimeType: payload.mimeType, fileExtension: payload.extension, fileCategory: payload.category, status: NODE_STATUS_SUCCESS },
                    },
                ]);
                setSelectedNodeIds(new Set([id]));
            } else {
                insertAssistantImage({ id: `asset-${Date.now()}`, prompt: payload.title, dataUrl: payload.dataUrl, storageKey: payload.storageKey });
            }
            setAssetPickerOpen(false);
        },
        [insertAssistantImage, insertAssistantText, screenToCanvas, size.height, size.width],
    );

    // --- 传给 CanvasNode 的回调/渲染函数统一 memo 化 ---
    // CanvasNode 是 React.memo,但只要这些 prop 每次渲染都是新引用,memo 就失效,
    // 导致点击/悬停/移动视角时全部节点跟着重渲染(markdown 尤其明显)。全部 useCallback 后,
    // 未变化的节点不再重渲染。依赖里的 map/handler 均已 memo 化,纯交互时保持稳定。
    const handleNodeHoverStart = useCallback((nodeId: string) => {
        if (nodeDraggingRef.current) return;
        setHoveredNodeId(nodeId);
    }, []);
    const handleNodeHoverEnd = useCallback((nodeId: string) => {
        setHoveredNodeId((current) => (current === nodeId ? null : current));
    }, []);
    const handleNodeViewImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const handleNodeRetry = useCallback((node: CanvasNodeData) => void handleRetryNode(node), [handleRetryNode]);
    const handleNodeContextMenu = useCallback((event: ReactMouseEvent, nodeId: string) => {
        event.preventDefault();
        event.stopPropagation();
        setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId });
    }, []);

    const renderNodePanel = useCallback(
        (panelNode: CanvasNodeData) =>
            getNodeDefinition(panelNode.type)?.Panel ? (
                renderPluginPanel(panelNode)
            ) : panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : panelNode.type === CanvasNodeType.Terminal ? (
                <CanvasTerminalSettingsPanel
                    node={panelNode}
                    references={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    onChange={(patch) => handleConfigNodeChange(panelNode.id, patch)}
                    onClose={() => setDialogNodeId(null)}
                    onConfirm={() => {
                        handleConfigNodeChange(panelNode.id, { terminalConfigured: true, terminalSessionVersion: (panelNode.metadata?.terminalSessionVersion || 0) + 1 });
                        setDialogNodeId(null);
                    }}
                />
            ) : (
                <CanvasNodePromptPanel
                    node={panelNode}
                    isRunning={runningNodeId === panelNode.id}
                    mentionReferences={mentionReferencesByNodeId.get(panelNode.id) || EMPTY_REFERENCES}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onStop={confirmStopGeneration}
                    modeOverride={getNodeDefinition(panelNode.type)?.useBuiltinPanel?.mode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            ),
        [configInputsById, confirmStopGeneration, handleConfigNodeChange, handleGenerateNode, handleNodePromptChange, mentionReferencesByNodeId, renderPluginPanel, runningNodeId],
    );

    const runnableWorkflow = useMemo(() => {
        const actionIds = new Set(nodes.filter((node) => node.type === CanvasNodeType.Config || node.type === CanvasNodeType.Terminal).map((node) => node.id));
        const explicitSlotsByAction = new Map<string, string[]>();
        connections.forEach((connection) => {
            if (!actionIds.has(connection.fromNodeId)) return;
            const target = nodes.find((node) => node.id === connection.toNodeId);
            if (target?.metadata?.role !== "result-slot") return;
            explicitSlotsByAction.set(connection.fromNodeId, [...(explicitSlotsByAction.get(connection.fromNodeId) || []), target.id]);
        });
        const validActionIds = new Set(Array.from(actionIds).filter((id) => explicitSlotsByAction.get(id)?.length === 1));
        const downstreamActionIds = new Set<string>();
        explicitSlotsByAction.forEach((slotIds, actionId) => {
            if (!validActionIds.has(actionId)) return;
            connections.forEach((connection) => {
                if (!slotIds.includes(connection.fromNodeId) || !validActionIds.has(connection.toNodeId)) return;
                downstreamActionIds.add(connection.toNodeId);
            });
        });
        const roots = Array.from(validActionIds).filter((id) => !downstreamActionIds.has(id));
        return { actionCount: validActionIds.size, rootIds: roots.length ? roots : Array.from(validActionIds) };
    }, [connections, nodes]);

    const renderNodeContentPanel = useCallback(
        (contentNode: CanvasNodeData) => {
            if (isCanvasResultSlot(contentNode)) {
                const sourceActionId = contentNode.metadata.resultSlotSourceNodeId;
                const workflowRecord = sourceActionId ? activeWorkflowSnapshot?.nodes.find((record) => record.nodeId === sourceActionId) : undefined;
                const executionControls = resolveCanvasResultSlotExecutionControls(workflowRecord?.status, contentNode.metadata.slotState);
                return (
                    <CanvasResultSlotContent
                        node={contentNode}
                        awaitingReview={workflowRecord ? executionControls.canContinue : undefined}
                        onSelectVersion={(versionId) => commitNodes((current) => current.map((node) => (node.id === contentNode.id && isCanvasResultSlot(node) ? selectResultSlotVersion(node, versionId) : node)))}
                        onSelectArtifact={(versionId, artifactId) =>
                            commitNodes((current) =>
                                current.map((node) => {
                                    if (node.id !== contentNode.id || !isCanvasResultSlot(node)) return node;
                                    const versions = node.metadata.resultVersions.map((version) => (version.id === versionId && version.status === "success" ? { ...version, primaryArtifactId: artifactId } : version));
                                    return selectResultSlotVersion({ ...node, metadata: { ...node.metadata, resultVersions: versions } }, versionId);
                                }),
                            )
                        }
                        onDeleteVersion={(versionId) => commitNodes((current) => current.map((node) => (node.id === contentNode.id && isCanvasResultSlot(node) ? deleteResultSlotVersion(node, versionId) : node)))}
                        onDeleteArtifact={(versionId, artifactId) => commitNodes((current) => current.map((node) => (node.id === contentNode.id && isCanvasResultSlot(node) ? deleteResultSlotArtifact(node, versionId, artifactId) : node)))}
                        onAdvanceModeChange={(advanceMode) => {
                            commitNodes((current) => current.map((node) => (node.id === contentNode.id && isCanvasResultSlot(node) ? setCanvasResultSlotAdvanceMode(node, advanceMode) : node)));
                            if (advanceMode === "auto" && sourceActionId && executionControls.canContinue) {
                                const continueWorkflow = continueWorkflowRef.current;
                                if (!continueWorkflow) {
                                    message.error("当前运行已经结束，请重新开始");
                                    return;
                                }
                                void continueWorkflow(sourceActionId).catch((error) => message.error(error instanceof Error ? error.message : "无法继续运行"));
                            }
                        }}
                        onRegenerate={
                            sourceActionId && executionControls.regenerateWith
                                ? () => {
                                      const liveWorkflowOwnsNode = Boolean(workflowExecutionRef.current?.getSnapshot().nodes.some((record) => record.nodeId === sourceActionId));
                                      if (executionControls.regenerateWith === "workflow" || liveWorkflowOwnsNode) {
                                          const retryWorkflow = retryWorkflowRef.current;
                                          if (!retryWorkflow) {
                                              message.error("当前运行已经结束，请重新开始");
                                              return;
                                          }
                                          void retryWorkflow(sourceActionId).catch((error) => message.error(error instanceof Error ? error.message : "无法重新生成"));
                                          return;
                                      }
                                      const action = nodesRef.current.find((node) => node.id === sourceActionId);
                                      if (!action) return;
                                      const mode = contentNode.metadata.resultSlotMode;
                                      void generateIntoResultSlot(sourceActionId, mode, action.metadata?.composerContent ?? action.metadata?.prompt ?? "", { silent: true }).catch((error) =>
                                          message.error(error instanceof Error ? error.message : "生成失败"),
                                      );
                                  }
                                : undefined
                        }
                        onContinue={
                            sourceActionId && executionControls.canContinue
                                ? () => {
                                      const continueWorkflow = continueWorkflowRef.current;
                                      if (!continueWorkflow) {
                                          message.error("当前运行已经结束，请重新开始");
                                          return;
                                      }
                                      void continueWorkflow(sourceActionId).catch((error) => message.error(error instanceof Error ? error.message : "无法继续运行"));
                                  }
                                : undefined
                        }
                        onDownload={contentNode.metadata.content ? () => downloadNodeImage(contentNode) : undefined}
                        onSaveAsset={contentNode.metadata.content ? () => void saveNodeAsset(contentNode) : undefined}
                        onEditText={(text) => {
                            const trimmed = text.trim();
                            if (!trimmed) return;
                            const versionId = `edited-${nanoid()}`;
                            commitNodes((current) =>
                                current.map((node) => {
                                    if (node.id !== contentNode.id || !isCanvasResultSlot(node)) return node;
                                    const artifactId = nanoid();
                                    return appendResultSlotSuccess(node, {
                                        id: versionId,
                                        artifacts: [{ id: artifactId, kind: "text", content: trimmed, title: "手动编辑" }],
                                        primaryArtifactId: artifactId,
                                        createdAt: new Date().toISOString(),
                                        sourceNodeId: contentNode.metadata.resultSlotSourceNodeId,
                                    });
                                }),
                            );
                            flushProjectSave();
                        }}
                        onLayoutColumnsChange={(columns) =>
                            commitNodes((current) =>
                                current.map((node) => node.id === contentNode.id && isCanvasResultSlot(node)
                                    ? { ...node, metadata: { ...node.metadata, resultSlotLayoutColumns: columns, resultSlotAutoSize: true } }
                                    : node),
                            )
                        }
                    />
                );
            }

            const inputs = configInputsById.get(contentNode.id) || [];
            const mode = contentNode.metadata?.generationMode || "image";
            const output = resolveDeclaredOutputNode(contentNode.id, mode, nodesRef.current, connectionsRef.current);
            const outputSlot = output.status === "unique" && output.explicit ? output.node : undefined;
            const workflowRecord = activeWorkflowSnapshot?.nodes.find((record) => record.nodeId === contentNode.id);
            const workflowOwnsStop = workflowNodeOwnsGenerationStop(workflowRecord?.status);
            return (
                <CanvasConfigNodePanel
                    node={contentNode}
                    isRunning={runningNodeId === contentNode.id || workflowRecord?.status === "running" || workflowRecord?.status === "persisting"}
                    inputSummary={getInputSummary(inputs.filter((input) => input.ready))}
                    pendingInputs={inputs.filter((input) => !input.ready)}
                    onConfigChange={handleConfigNodeChange}
                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                    onStop={workflowOwnsStop ? () => void stopCanvasWorkflow() : confirmStopGeneration}
                    onGenerate={(nodeId) => {
                        const target = nodesRef.current.find((item) => item.id === nodeId);
                        const prompt = target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "";
                        if (outputSlot) {
                            void generateIntoResultSlot(nodeId, mode, prompt, { silent: true }).catch((error) => message.error(error instanceof Error ? error.message : "生成失败"));
                        } else {
                            void handleGenerateNode(nodeId, mode, prompt);
                        }
                    }}
                    workflowMode={activeWorkflowSnapshot?.mode}
                    workflowStatus={workflowRecord?.status}
                    onAddResultSlot={outputSlot ? undefined : addResultSlotForAction}
                />
            );
        },
        [
            activeWorkflowSnapshot,
            addResultSlotForAction,
            commitNodes,
            configInputsById,
            confirmStopGeneration,
            connectionsRef,
            continueCanvasWorkflow,
            downloadNodeImage,
            generateIntoResultSlot,
            handleConfigNodeChange,
            handleGenerateNode,
            message,
            nodesRef,
            retryCanvasWorkflow,
            runningNodeId,
            saveNodeAsset,
            stopCanvasWorkflow,
        ],
    );

    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <main className="flex h-full min-h-0 overflow-hidden" style={{ background: theme.canvas.background, color: theme.node.text }}>
            <CanvasSidePanel nodes={nodes} selectedNodeIds={selectedNodeIds} onFocusNode={focusNode} onPreviewNode={setPreviewNodeId} onInsertAsset={handleAssetInsert} />
            <section className="relative min-w-0 flex-1 overflow-hidden">
                <CanvasTopBar
                    title={currentProjectTitle || "未命名画布"}
                    titleDraft={titleDraft}
                    isTitleEditing={titleEditing}
                    onTitleDraftChange={setTitleDraft}
                    onStartTitleEditing={startTitleEditing}
                    onFinishTitleEditing={finishTitleEditing}
                    onCancelTitleEditing={() => setTitleEditing(false)}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    onHome={() =>
                        void smoothNavigate("/", {
                            direction: "return-home",
                            preload: () => import("@/pages/home"),
                            onCommit: () =>
                                setAgentState({
                                    panelOpen: false,
                                    panelMounted: false,
                                    panelClosing: false,
                                }),
                        })
                    }
                    onProjects={() => navigate("/canvas")}
                    onCreateProject={createAndOpenProject}
                    onDeleteProject={deleteCurrentProject}
                    onExportProject={exportCurrentProject}
                    onImportImage={() => handleUploadRequest()}
                    onOpenPlugins={() => setPluginManagerOpen(true)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    agentOpen={agentPanelOpen}
                    onToggleAgent={toggleAgentPanel}
                    terminalNodeCount={nodes.filter((node) => node.type === CanvasNodeType.Terminal).length}
                    workflowActionCount={runnableWorkflow.actionCount}
                    workflowStatus={activeWorkflowSnapshot?.status}
                    onRunGuided={() => void startCanvasWorkflow(runnableWorkflow.rootIds, "guided").catch((error) => message.error(error instanceof Error ? error.message : "无法开始运行"))}
                    onRunAutomatic={() => void startCanvasWorkflow(runnableWorkflow.rootIds, "automatic").catch((error) => message.error(error instanceof Error ? error.message : "无法开始运行"))}
                    onInspectWorkflow={() => {
                        const pendingReview = activeWorkflowSnapshot?.nodes.find((record) => record.status === "waiting_review");
                        if (pendingReview) inspectWorkflowResult(pendingReview.nodeId);
                    }}
                    onStopWorkflow={() => void stopCanvasWorkflow()}
                />

                <InfiniteCanvas
                    containerRef={containerRef}
                    viewport={viewport}
                    backgroundMode={backgroundMode}
                    onViewportChange={handleViewportChange}
                    onCanvasMouseDown={handleCanvasMouseDown}
                    onCanvasDeselect={deselectCanvas}
                    onCanvasDoubleClick={handleCanvasDoubleClick}
                    onContextMenu={preventCanvasContextMenu}
                    onDrop={handleDrop}
                >
                    <svg className="absolute left-0 top-0 h-[10000px] w-[10000px] overflow-visible" style={{ pointerEvents: "none", transform: "translateZ(0)", zIndex: 0 }}>
                        <defs>
                            <marker id="workflow-connection-arrow" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
                                <path d="M 0 0 L 10 5 L 0 10 z" fill="#4f8cff" />
                            </marker>
                        </defs>
                        {visibleConnections.map(({ connection, from, to, active }) => (
                            <ConnectionPath key={connection.id} connection={connection} from={from} to={to} active={active} onSelect={selectConnection} onContextMenu={openConnectionContextMenu} />
                        ))}
                        {connectingParams ? <ActiveConnectionPath node={nodeById.get(connectingParams.nodeId)} handle={connectingParams} mouseWorld={mouseWorld} target={connectionTargetNodeId ? nodeById.get(connectionTargetNodeId) : undefined} /> : null}
                    </svg>

                    {visibleNodes.map((node) => (
                        <CanvasNode
                            key={node.id}
                            data={node}
                            scale={viewport.k}
                            isViewportVisible={viewportVisibleNodeIds.has(node.id)}
                            isSelected={selectedNodeIds.has(node.id)}
                            isRelated={relatedHighlight.nodeIds.has(node.id)}
                            isFocusRelated={activeNodeId === node.id}
                            isConnectionTarget={connectionTargetNodeId === node.id}
                            isConnecting={Boolean(connectingParams)}
                            editRequestNonce={editingNodeId === node.id ? editRequestNonce : 0}
                            showPanel={dialogNodeId === node.id && !selectionBox && !getNodeDefinition(node.type)?.hidePanel}
                            batchCount={batchChildCountById.get(node.id) || 0}
                            groupChildCount={groupChildCountById.get(node.id) || 0}
                            isGroupDropTarget={dropTargetGroupId === node.id}
                            batchExpanded={Boolean(node.metadata?.imageBatchExpanded)}
                            batchClosing={Boolean(node.metadata?.batchRootId && collapsingBatchIds.has(node.metadata.batchRootId))}
                            batchOpening={openingBatchIds.has(node.id)}
                            batchRecovering={collapsingBatchIds.has(node.id)}
                            batchMotion={batchMotionById.get(node.id)}
                            showImageInfo={showImageInfo}
                            mentionReferences={mentionReferencesByNodeId.get(node.id) || EMPTY_REFERENCES}
                            pluginHost={pluginHost}
                            registryVersion={nodeRegistryVersion}
                            renderPanel={renderNodePanel}
                            renderNodeContent={renderNodeContentPanel}
                            onMouseDown={handleNodeMouseDown}
                            onSelectCapture={handleNodeSelectCapture}
                            onHoverStart={handleNodeHoverStart}
                            onHoverEnd={handleNodeHoverEnd}
                            onConnectStart={handleConnectStart}
                            onResize={handleNodeResize}
                            onContentChange={handleNodeContentChange}
                            onMetadataChange={handleConfigNodeChange}
                            onTerminalArtifact={handleTerminalArtifact}
                            onTitleChange={handleNodeTitleChange}
                            onToggleBatch={toggleBatchExpanded}
                            onSetBatchPrimary={setBatchPrimary}
                            onRetry={handleNodeRetry}
                            onGenerateImage={generateImageFromTextNode}
                            onViewImage={handleNodeViewImage}
                            onContextMenu={handleNodeContextMenu}
                        />
                    ))}

                    {selectionBox ? (
                        <div
                            className="pointer-events-none absolute z-[100] border"
                            style={{
                                left: Math.min(selectionBox.startWorldX, selectionBox.currentWorldX),
                                top: Math.min(selectionBox.startWorldY, selectionBox.currentWorldY),
                                width: Math.abs(selectionBox.currentWorldX - selectionBox.startWorldX),
                                height: Math.abs(selectionBox.currentWorldY - selectionBox.startWorldY),
                                borderColor: theme.canvas.selectionStroke,
                                background: theme.canvas.selectionFill,
                            }}
                        />
                    ) : null}
                    {pendingConnectionCreate ? <ConnectionCreateMenu pending={pendingConnectionCreate} onCreate={(type) => createConnectedNode(type, pendingConnectionCreate)} onClose={cancelPendingConnectionCreate} /> : null}
                    {nodeCreatePosition ? (
                        <NodeCreateMenu
                            position={nodeCreatePosition}
                            onCreate={(type) => {
                                createNode(type, nodeCreatePosition);
                                setNodeCreatePosition(null);
                            }}
                            onClose={() => setNodeCreatePosition(null)}
                        />
                    ) : null}
                </InfiniteCanvas>

                <CanvasNodeHoverToolbar
                    node={isNodeDragging || nodeImageSettingsOpen ? null : toolbarNode}
                    viewport={viewport}
                    extraTools={toolbarNode ? buildNodeToolbarItems(toolbarNode) : undefined}
                    onKeep={keepNodeToolbar}
                    onLeave={hideNodeToolbar}
                    onInfo={(node) => setInfoNodeId(node.id)}
                    onEditText={openTextEditor}
                    onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                    onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                    onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                    onGenerateImage={generateImageFromTextNode}
                    onUpload={(node) => handleUploadRequest(node.id)}
                    onDownload={downloadNodeImage}
                    onSaveAsset={(node) => void saveNodeAsset(node)}
                    onMaskEdit={(node) => setMaskEditNodeId(node.id)}
                    onCrop={(node) => setCropNodeId(node.id)}
                    onSplit={(node) => setSplitNodeId(node.id)}
                    onUpscale={(node) => setUpscaleNodeId(node.id)}
                    onSuperResolve={(node) => setSuperResolveNodeId(node.id)}
                    onAngle={(node) => setAngleNodeId(node.id)}
                    onViewImage={(node) => setPreviewNodeId(node.id)}
                    onReversePrompt={createImageReversePromptNodes}
                    onRetry={(node) => void handleRetryNode(node)}
                    onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                    onDelete={(node) => deleteNodes(new Set([node.id]))}
                />

                <CanvasToolbar
                    selectedCount={selectedNodeIds.size}
                    canUndo={historyState.canUndo}
                    canRedo={historyState.canRedo}
                    backgroundMode={backgroundMode}
                    showImageInfo={showImageInfo}
                    onAddImage={() => createNode(CanvasNodeType.Image)}
                    onAddVideo={() => createNode(CanvasNodeType.Video)}
                    onAddAudio={() => createNode(CanvasNodeType.Audio)}
                    onAddText={() => createNode(CanvasNodeType.Text)}
                    onAddConfig={() => createNode(CanvasNodeType.Config)}
                    onAddTerminal={() => createNode(CanvasNodeType.Terminal)}
                    onAddGroup={() => createNode(CanvasNodeType.Group)}
                    onAddExtensionNode={(type) => createNode(type)}
                    onUndo={undoCanvas}
                    onRedo={redoCanvas}
                    onUpload={() => handleUploadRequest()}
                    onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                    onClear={() => setClearConfirmOpen(true)}
                    onDeselect={deselectCanvas}
                    onBackgroundModeChange={setBackgroundMode}
                    onShowImageInfoChange={setShowImageInfo}
                />

                {isMiniMapOpen ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} onViewportChange={setViewport} /> : null}

                <CanvasZoomControls scale={viewport.k} onScaleChange={setZoomScale} onReset={resetViewport} isMiniMapOpen={isMiniMapOpen} onToggleMiniMap={() => setIsMiniMapOpen((value) => !value)} />

                {contextMenu ? (
                    <CanvasNodeContextMenu
                        menu={contextMenu}
                        onClose={() => setContextMenu(null)}
                        onDuplicate={() => {
                            if (contextMenu.type !== "node") return;
                            duplicateNode(contextMenu.nodeId);
                            setContextMenu(null);
                        }}
                        onDelete={() => {
                            if (contextMenu.type === "node") {
                                deleteNodes(new Set([contextMenu.nodeId]));
                            } else {
                                deleteConnection(contextMenu.connectionId);
                            }
                            setContextMenu(null);
                        }}
                    />
                ) : null}

                <input ref={imageInputRef} type="file" multiple className="hidden" onChange={handleImageInputChange} />

                <CanvasNodeInfoModal node={infoNode} open={Boolean(infoNode)} onClose={() => setInfoNodeId(null)} />
                <CanvasPluginManagerModal open={pluginManagerOpen} onClose={() => setPluginManagerOpen(false)} />

                {cropNode?.metadata?.content ? <CanvasNodeCropDialog dataUrl={cropNode.metadata.content} open={Boolean(cropNode)} onClose={() => setCropNodeId(null)} onConfirm={(crop) => void cropImageNode(cropNode!, crop)} /> : null}

                {maskEditNode?.metadata?.content ? (
                    <CanvasNodeMaskEditDialog dataUrl={maskEditNode.metadata.content} open={Boolean(maskEditNode)} onClose={() => setMaskEditNodeId(null)} onConfirm={(payload) => void maskEditImageNode(maskEditNode!, payload)} />
                ) : null}

                {splitNode?.metadata?.content ? <CanvasNodeSplitDialog dataUrl={splitNode.metadata.content} open={Boolean(splitNode)} onClose={() => setSplitNodeId(null)} onConfirm={(params) => void splitImageNode(splitNode!, params)} /> : null}

                {upscaleNode?.metadata?.content ? (
                    <CanvasNodeUpscaleDialog dataUrl={upscaleNode.metadata.content} open={Boolean(upscaleNode)} onClose={() => setUpscaleNodeId(null)} onConfirm={(params) => void upscaleImageNode(upscaleNode!, params)} />
                ) : null}

                <Modal title="AI 超分" open={Boolean(superResolveNode?.metadata?.content)} centered footer={null} onCancel={() => setSuperResolveNodeId(null)}>
                    <div className="py-8 text-center text-base font-medium">暂未实现</div>
                </Modal>

                {angleNode?.metadata?.content ? <CanvasNodeAngleDialog dataUrl={angleNode.metadata.content} open={Boolean(angleNode)} onClose={() => setAngleNodeId(null)} onConfirm={(params) => void generateAngleNode(angleNode!, params)} /> : null}

                <Modal
                    title="图片详情"
                    open={Boolean(previewNode?.metadata?.content)}
                    centered
                    onCancel={() => setPreviewNodeId(null)}
                    footer={null}
                    width="auto"
                    styles={{ body: { padding: 0, display: "flex", justifyContent: "center", alignItems: "center", maxHeight: "80vh" } }}
                >
                    {previewNode?.metadata?.content ? <img src={previewNode.metadata.content} alt={previewNode.title || "图片"} style={{ maxWidth: "100%", maxHeight: "80vh", objectFit: "contain" }} /> : null}
                </Modal>

                <Modal
                    title="清空画布？"
                    open={clearConfirmOpen}
                    centered
                    onCancel={() => setClearConfirmOpen(false)}
                    footer={
                        <>
                            <Button onClick={() => setClearConfirmOpen(false)}>取消</Button>
                            <Button danger type="primary" onClick={clearCanvas}>
                                清空
                            </Button>
                        </>
                    }
                >
                    <p className="text-sm opacity-60">这会删除当前画布上的所有节点和连线。</p>
                </Modal>

                <AssetPickerModal open={assetPickerOpen} onInsert={handleAssetInsert} onClose={() => setAssetPickerOpen(false)} />
            </section>
        </main>
    );
}
