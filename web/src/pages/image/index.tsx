import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, ImagePlus, LoaderCircle, PenLine, Plus, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { App, Button, Checkbox, Drawer, Empty, Image, Input, Modal, Popconfirm, Tag, Tooltip, Typography } from "antd";
import { saveAs } from "file-saver";

import { ImageSettingsPanel } from "@/components/image-settings-panel";
import { MediaWorkbenchHeader } from "@/components/media-workbench-header";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelExperienceKind } from "@/lib/model-providers";
import {
    awaitForCurrentGeneration,
    consumePendingGenerationIntent,
    createGenerationIdentity,
    generationLogVisibility,
    isGenerationIdentityCurrent,
    mergeRetriedGenerationLog,
    reconcileCancelledGenerationLog,
    resolveGenerationAppendLogId,
    resolveGenerationMediaAction,
    shouldInvalidateGenerationLifecycle,
    StaleGenerationError,
    updateStableGenerationSlot,
    type GenerationLogMediaResolution,
    type GenerationLogOwnerProbe,
} from "@/lib/image-generation-lifecycle";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import { modelOptionName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { nanoid } from "nanoid";
import { formatBytes, formatDuration, getDataUrlByteSize, readImageMeta } from "@/lib/image-utils";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { deleteStoredImages, discardUploadedImage, getImageBlob, publishUploadedImage, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { createDesktopJsonStore, exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import type { ReferenceImage } from "@/types/image";

type GeneratedImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType?: string;
};

type GenerationResult = {
    id: string;
    logId?: string;
    status: "pending" | "success" | "failed";
    image?: GeneratedImage;
    error?: string;
};

type GenerationLog = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    imageCount: number;
    size: string;
    quality: string;
    status: "成功" | "失败";
    discarded?: boolean;
    images: GeneratedImage[];
    thumbnails: string[];
};

type GenerationLogConfig = Pick<AiConfig, "model" | "imageModel" | "quality" | "size" | "count">;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

type ActiveGenerationBatch = {
    id: string;
    slotIds: string[];
    controller: AbortController;
    agentTaskId?: string;
    logId?: string;
};

type PendingAgentGeneration = {
    id: string;
    taskId?: string;
};

type BatchLogPersistenceResult = {
    committed: boolean;
    media: GenerationLogMediaResolution;
    error?: unknown;
};

const LOG_STORE_KEY = "infinite-canvas:image_generation_logs";
const RESULT_ACTION_BUTTON_CLASS = "min-w-0 px-1.5 [&_.ant-btn-icon]:shrink-0 [&>span:last-child]:min-w-0 [&>span:last-child]:truncate";
const logStore = createDesktopJsonStore({
    namespace: "image-generation-logs-v1",
    legacy: { name: "infinite-canvas", storeName: "image_generation_logs" },
});

export default function ImagePage() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const [prompt, setPrompt] = useState("");
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [results, setResults] = useState<GenerationResult[]>([]);
    const [logs, setLogs] = useState<GenerationLog[]>([]);
    const [running, setRunning] = useState(false);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [startedAt, setStartedAt] = useState(0);
    const [elapsedMs, setElapsedMs] = useState(0);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [previewLog, setPreviewLog] = useState<GenerationLog | null>(null);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const [isReferenceDragActive, setIsReferenceDragActive] = useState(false);
    const [autoRunIntentId, setAutoRunIntentId] = useState<string>();
    const imageCommand = useWorkbenchAgentStore((state) => state.imageCommand);
    const clearImageCommand = useWorkbenchAgentStore((state) => state.clearImageCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const pendingAgentGenerationRef = useRef<PendingAgentGeneration | null>(null);
    const activeBatchRef = useRef<ActiveGenerationBatch | null>(null);
    const lifecycleEpochRef = useRef(0);
    const logReadVersionRef = useRef(0);
    const mountedRef = useRef(false);
    const runtimeMediaReferencesRef = useRef<unknown>(undefined);
    runtimeMediaReferencesRef.current = { references, results, logs, previewLog };

    const model = effectiveConfig.imageModel || effectiveConfig.model;
    const canGenerate = Boolean(prompt.trim());
    const selectedImageConfig = { ...effectiveConfig, model, imageModel: model };
    const selectedImageRequestConfig = resolveModelRequestConfig(selectedImageConfig, model);
    const imageExperience = modelExperienceKind(selectedImageRequestConfig.apiFormat, modelOptionName(model), "image");
    const maxReferenceImages = imageExperience === "minimax-image" ? 1 : imageExperience === "grok-image" ? 3 : 10;
    const generationCount = Math.max(1, Math.min(imageExperience === "minimax-image" ? 9 : 10, Number(config.count) || 1));

    useEffect(() => registerRuntimeMediaReferenceProvider(() => runtimeMediaReferencesRef.current), []);
    useEffect(() => markMediaReferencesChanged(), [logs, previewLog, references, results]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    const addReferences = async (files?: FileList | null) => {
        if (references.length >= maxReferenceImages) {
            message.warning(`当前模型最多使用 ${maxReferenceImages} 张参考图`);
            return;
        }
        const imageFiles = Array.from(files || [])
            .filter((file) => file.type.startsWith("image/"))
            .slice(0, Math.max(0, maxReferenceImages - references.length));
        if (imageExperience === "minimax-image" && (files?.length || 0) > imageFiles.length) message.info("MiniMax image-01 仅使用 1 张人物参考图");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                publishUploadedImage(image);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
            }),
        );
        setReferences((value) => [...value, ...nextReferences].slice(0, maxReferenceImages));
    };

    const addReferencesFromClipboard = async () => {
        if (references.length >= maxReferenceImages) {
            message.warning(`当前模型最多使用 ${maxReferenceImages} 张参考图`);
            return;
        }
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const nextReferences = await Promise.all(
                blobs.slice(0, Math.max(0, maxReferenceImages - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    publishUploadedImage(image);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey };
                }),
            );
            setReferences((value) => [...value, ...nextReferences].slice(0, maxReferenceImages));
            message.success(`已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const isBatchCurrent = (batch: ActiveGenerationBatch) => isGenerationIdentityCurrent(activeBatchRef.current?.id, batch.id, batch.controller.signal.aborted);

    const invalidateRunningBatch = (reason: string, updateUi = true) => {
        const activeBatch = activeBatchRef.current;
        if (!activeBatch) return;
        activeBatchRef.current = null;
        activeBatch.controller.abort();
        if (activeBatch.logId) generationLogVisibility.suppress(activeBatch.logId);
        if (activeBatch.agentTaskId) {
            updateAgentTask(activeBatch.agentTaskId, { status: "failed", error: reason });
        }
        if (updateUi) {
            setRunning(false);
            setStartedAt(0);
        }
    };

    const invalidateActiveBatch = (reason: string, updateUi = true) => {
        const pendingAgentGeneration = pendingAgentGenerationRef.current;
        pendingAgentGenerationRef.current = null;
        if (pendingAgentGeneration?.taskId) {
            updateAgentTask(pendingAgentGeneration.taskId, { status: "failed", error: reason });
        }
        invalidateRunningBatch(reason, updateUi);
    };

    const startGenerationBatch = (id: string, slotIds: string[], agentTaskId?: string) => {
        invalidateActiveBatch("已被新的生图任务替代");
        const batch = { id, slotIds, controller: new AbortController(), agentTaskId };
        activeBatchRef.current = batch;
        return batch;
    };

    const finishGenerationBatch = (batch: ActiveGenerationBatch) => {
        if (!isBatchCurrent(batch)) return;
        activeBatchRef.current = null;
        setRunning(false);
        setStartedAt(0);
    };

    const probeGenerationLogOwner = async (logId: string): Promise<GenerationLogOwnerProbe> => {
        try {
            const stored = await logStore.getItem<Partial<GenerationLog>>(logId);
            if (!stored) return { kind: "known", exists: false, discarded: false, storageKeys: [] };
            return {
                kind: "known",
                exists: true,
                discarded: Boolean(stored.discarded),
                storageKeys: (stored.images || []).map((image) => image.storageKey).filter((key): key is string => Boolean(key)),
            };
        } catch {
            return { kind: "unknown" };
        }
    };

    const rollbackGenerationLog = async (log: GenerationLog, error?: unknown): Promise<BatchLogPersistenceResult> => {
        generationLogVisibility.suppress(log.id);
        const tombstone = serializeLog({ ...log, discarded: true });
        const reconciled = await reconcileCancelledGenerationLog({
            probe: () => probeGenerationLogOwner(log.id),
            writeTombstone: () => logStore.setItem(log.id, tombstone),
            remove: () => logStore.removeItem(log.id),
            cause: error,
        });
        return { committed: false, ...reconciled };
    };

    const persistBatchLog = async (batch: ActiveGenerationBatch, log: GenerationLog): Promise<BatchLogPersistenceResult> => {
        batch.logId = log.id;
        const serializedLog = serializeLog(log);
        const expectedStorageKeys = serializedLog.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key));
        if (!isBatchCurrent(batch)) return rollbackGenerationLog(log);

        try {
            await logStore.setItem(log.id, serializedLog);
        } catch (writeError) {
            const owner = await probeGenerationLogOwner(log.id);
            if (!isBatchCurrent(batch)) return rollbackGenerationLog(log, writeError);
            const ownerConfirmsWrite = owner.kind === "known" && owner.exists && !owner.discarded && expectedStorageKeys.every((key) => owner.storageKeys.includes(key));
            if (!ownerConfirmsWrite) {
                return rollbackGenerationLog(log, writeError);
            }
        }

        if (!isBatchCurrent(batch)) return rollbackGenerationLog(log);
        const nextLogs = await readStoredLogs();
        if (!isBatchCurrent(batch)) return rollbackGenerationLog(log);
        setLogs(generationLogVisibility.filter(nextLogs));
        return {
            committed: true,
            media: { owner: { kind: "known", exists: true, discarded: false, storageKeys: expectedStorageKeys }, rollbackSucceeded: false },
        };
    };

    const persistRetriedLog = async (batch: ActiveGenerationBatch, previousLog: GenerationLog, nextLog: GenerationLog): Promise<BatchLogPersistenceResult> => {
        batch.logId = nextLog.id;
        const previousSerialized = serializeLog(previousLog);
        const nextSerialized = serializeLog(nextLog);
        const nextStorageKeys = nextSerialized.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key));
        const previousStorageKeys = previousSerialized.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key));
        if (!isBatchCurrent(batch)) {
            return { committed: false, media: { owner: { kind: "known", exists: true, discarded: false, storageKeys: previousStorageKeys }, rollbackSucceeded: true } };
        }

        try {
            await logStore.setItem(nextLog.id, nextSerialized);
        } catch (writeError) {
            const owner = await probeGenerationLogOwner(nextLog.id);
            const ownerConfirmsWrite = owner.kind === "known" && owner.exists && !owner.discarded && nextStorageKeys.every((key) => owner.storageKeys.includes(key));
            if (!ownerConfirmsWrite) return { committed: false, media: { owner, rollbackSucceeded: true }, error: writeError };
        }

        if (!isBatchCurrent(batch)) {
            try {
                await logStore.setItem(previousLog.id, previousSerialized);
                return { committed: false, media: { owner: { kind: "known", exists: true, discarded: false, storageKeys: previousStorageKeys }, rollbackSucceeded: true } };
            } catch (restoreError) {
                const owner = await probeGenerationLogOwner(nextLog.id);
                return { committed: false, media: { owner, rollbackSucceeded: false }, error: restoreError };
            }
        }

        const nextLogs = await readStoredLogs();
        if (!isBatchCurrent(batch)) {
            try {
                await logStore.setItem(previousLog.id, previousSerialized);
                return { committed: false, media: { owner: { kind: "known", exists: true, discarded: false, storageKeys: previousStorageKeys }, rollbackSucceeded: true } };
            } catch (restoreError) {
                const owner = await probeGenerationLogOwner(nextLog.id);
                return { committed: false, media: { owner, rollbackSucceeded: false }, error: restoreError };
            }
        }
        setLogs(generationLogVisibility.filter(nextLogs));
        setPreviewLog((value) => (value?.id === nextLog.id ? nextLog : value));
        return { committed: true, media: { owner: { kind: "known", exists: true, discarded: false, storageKeys: nextStorageKeys }, rollbackSucceeded: false } };
    };

    useEffect(() => {
        const lifecycleEpoch = ++lifecycleEpochRef.current;
        mountedRef.current = true;
        const unsubscribeVisibility = generationLogVisibility.subscribe(() => {
            logReadVersionRef.current += 1;
            setLogs((value) => generationLogVisibility.filter(value));
        });
        void refreshLogs();
        return () => {
            mountedRef.current = false;
            logReadVersionRef.current += 1;
            unsubscribeVisibility();
            invalidateRunningBatch("生图工作台已关闭", false);
            queueMicrotask(() => {
                if (shouldInvalidateGenerationLifecycle(lifecycleEpochRef.current, lifecycleEpoch)) {
                    invalidateActiveBatch("生图工作台已关闭", false);
                }
            });
        };
        // StrictMode replays setup/cleanup in development. The epoch keeps that
        // simulated cleanup from consuming a real pending Agent intent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const generate = async (agentTaskId?: string, preserveResults = false, appendToLogId?: string) => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "请输入生图提示词" });
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图配置不完整" });
            return;
        }

        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "生图参数无效" });
            return;
        }

        const appendLogId = preserveResults ? resolveGenerationAppendLogId(appendToLogId, previewLog?.id, results.map((item) => item.logId)) : undefined;
        const appendTarget = appendLogId ? (previewLog?.id === appendLogId ? previewLog : logs.find((log) => log.id === appendLogId)) : undefined;
        if (preserveResults && !appendTarget) {
            message.error("找不到原生成记录，请从左侧记录重新打开后再生成");
            return;
        }
        const identity = createGenerationIdentity(generationCount, nanoid);
        const batch = startGenerationBatch(identity.batchId, identity.slotIds, agentTaskId);
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        if (!appendTarget) setPreviewLog(null);
        const pendingResults = batch.slotIds.map((id) => ({ id, logId: appendTarget?.id, status: "pending" as const }));
        setResults((current) => (preserveResults ? [...current, ...pendingResults] : pendingResults));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);

        const tasks = batch.slotIds.map((slotId) => runGenerationSlot(slotId, snapshot, batch));

        const result = await Promise.allSettled(tasks);
        if (!isBatchCurrent(batch)) return;
        const successImages = result.filter((item): item is PromiseFulfilledResult<GeneratedImage> => item.status === "fulfilled").map((item) => item.value);
        const successCount = successImages.length;
        const failCount = batch.slotIds.length - successCount;
        const failed = result.find((item): item is PromiseRejectedResult => item.status === "rejected");
        const error = failed?.reason instanceof Error ? failed.reason.message : failCount ? "生成失败" : undefined;
        let logImages: GeneratedImage[] = [];
        const uploadedImages: UploadedImage[] = [];
        let uploadsSettled = false;

        try {
            const uploadResults = await Promise.allSettled(
                successImages.map(async (image) => {
                    if (!isBatchCurrent(batch)) throw new StaleGenerationError();
                    const stored = await uploadImage(image.dataUrl);
                    uploadedImages.push(stored);
                    if (!isBatchCurrent(batch)) throw new StaleGenerationError();
                    return { ...image, dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType };
                }),
            );
            if (!isBatchCurrent(batch)) {
                await discardProvisionalImages(uploadedImages);
                return;
            }
            const failedUpload = uploadResults.find((item): item is PromiseRejectedResult => item.status === "rejected");
            if (failedUpload) {
                await discardProvisionalImages(uploadedImages);
                throw failedUpload.reason;
            }
            logImages = uploadResults.flatMap((item) => (item.status === "fulfilled" ? [item.value] : []));
            const completedLog = appendTarget
                ? appendGeneratedImagesToLog(appendTarget, logImages, performance.now() - batchStartedAt, successCount, failCount)
                : buildLog({
                      prompt: text,
                      model,
                      config: { ...snapshot.config, count: String(batch.slotIds.length) },
                      references: snapshot.references,
                      durationMs: performance.now() - batchStartedAt,
                      successCount,
                      failCount,
                      status: successCount ? "成功" : "失败",
                      images: logImages,
                  });
            let persisted = appendTarget ? await persistRetriedLog(batch, appendTarget, completedLog) : await persistBatchLog(batch, completedLog);
            if (!appendTarget && persisted.committed && !isBatchCurrent(batch)) {
                persisted = await rollbackGenerationLog(completedLog);
            }
            if (!persisted.committed || !isBatchCurrent(batch)) {
                await settleProvisionalImages(uploadedImages, persisted.media);
                uploadsSettled = true;
                if (isBatchCurrent(batch) && persisted.error) throw persisted.error;
                return;
            }
            uploadedImages.forEach(publishUploadedImage);
            uploadsSettled = true;
            setResults((value) =>
                value.map((item) => {
                    if (!batch.slotIds.includes(item.id)) return item;
                    const storedImage = item.image ? logImages.find((image) => image.id === item.image?.id) : undefined;
                    return { ...item, logId: completedLog.id, status: storedImage ? "success" : item.status, image: storedImage || item.image };
                }),
            );
            if (appendTarget) setPreviewLog(completedLog);
            if (agentTaskId) updateAgentTask(agentTaskId, { status: successCount ? "succeeded" : "failed", successCount, failCount, error: successCount ? undefined : error });
            if (!isBatchCurrent(batch)) return;
            successCount ? message.success("图片已生成") : message.error(failed?.reason instanceof Error ? failed.reason.message : "生成失败");
        } catch (storageError) {
            if (!uploadsSettled) await discardProvisionalImages(uploadedImages);
            if (!isBatchCurrent(batch)) return;
            const storageErrorMessage = storageError instanceof Error ? storageError.message : "生成记录保存失败";
            setResults((value) =>
                value.map((item) =>
                    batch.slotIds.includes(item.id) && item.status === "pending"
                        ? { ...item, logId: appendTarget?.id, status: "failed", image: undefined, error: storageErrorMessage }
                        : item,
                ),
            );
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", successCount, failCount, error: storageErrorMessage });
            message.error(storageErrorMessage);
        } finally {
            finishGenerationBatch(batch);
        }
    };

    // 响应 Agent 面板下发的生图命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!imageCommand || imageCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = imageCommand.nonce;
        clearImageCommand();
        if (typeof imageCommand.prompt === "string") setPrompt(imageCommand.prompt);
        if (imageCommand.run && activeBatchRef.current) {
            if (imageCommand.taskId) updateAgentTask(imageCommand.taskId, { status: "failed", error: "生图工作台已有任务正在运行" });
            return;
        }
        if (imageCommand.run) {
            const previousIntent = pendingAgentGenerationRef.current;
            if (previousIntent?.taskId && previousIntent.taskId !== imageCommand.taskId) {
                updateAgentTask(previousIntent.taskId, { status: "failed", error: "已被新的生图任务替代" });
            }
            const intent = { id: nanoid(), taskId: imageCommand.taskId };
            pendingAgentGenerationRef.current = intent;
            setAutoRunIntentId(intent.id);
        }
    }, [imageCommand, clearImageCommand, updateAgentTask]);

    useEffect(() => {
        if (!autoRunIntentId) return;
        const intent = consumePendingGenerationIntent(pendingAgentGenerationRef.current, autoRunIntentId);
        if (!intent) return;
        pendingAgentGenerationRef.current = null;
        void generate(intent.taskId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunIntentId]);

    const downloadImage = async (image: GeneratedImage, index: number) => {
        const filename = `WorkflowGenerator-image-${index + 1}.png`;
        try {
            if (isDesktopApp() && image.storageKey) {
                const exportedName = await exportDesktopMedia("images", image.storageKey, filename);
                message.success(`已下载：${exportedName || filename}`);
                return;
            }
            const blob = image.storageKey ? await getImageBlob(image.storageKey) : await (await fetch(image.dataUrl)).blob();
            if (!blob) throw new Error("找不到图片文件");
            saveAs(blob, filename);
        } catch (error) {
            message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
        }
    };

    const addResultToReferences = async (image: GeneratedImage, index: number) => {
        if (references.length >= maxReferenceImages) {
            message.warning(`当前模型最多使用 ${maxReferenceImages} 张参考图`);
            return;
        }
        if (image.storageKey) {
            setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: image.mimeType || "image/png", dataUrl: image.dataUrl, storageKey: image.storageKey }].slice(0, maxReferenceImages));
        } else {
            const stored = await uploadImage(image.dataUrl);
            publishUploadedImage(stored);
            setReferences((value) => [...value, { id: nanoid(), name: `result-${index + 1}.png`, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, maxReferenceImages));
        }
        message.success("已加入参考图");
    };

    const saveResultToAssets = async (image: GeneratedImage, index: number) => {
        let stored: UploadedImage | undefined;
        let createdStorage = false;
        try {
            if (image.storageKey && !(await getImageBlob(image.storageKey))) throw new Error("本地图片文件不存在，请重新生成");
            stored = image.storageKey ? { url: image.dataUrl, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType || "image/png" } : await uploadImage(image.dataUrl);
            createdStorage = !image.storageKey;
            await addAssetPersisted({
                kind: "image",
                title: `生成结果 ${index + 1}`,
                coverUrl: stored.url,
                tags: [],
                source: "生图工作台",
                data: { dataUrl: stored.url, storageKey: stored.storageKey, width: stored.width, height: stored.height, bytes: stored.bytes, mimeType: stored.mimeType },
                metadata: { source: "image-page", prompt },
            });
            if (createdStorage) publishUploadedImage(stored);
            message.success("已保存到我的资产");
        } catch (error) {
            if (createdStorage && stored) await discardUploadedImage(stored);
            message.error(error instanceof Error ? `保存资产失败：${error.message}` : "保存资产失败，请重试");
        }
    };

    const deleteResultFromLog = async (logId: string | undefined, imageId: string) => {
        if (!logId) {
            setResults((value) => value.filter((item) => item.image?.id !== imageId));
            return;
        }
        const sourceLog = previewLog?.id === logId ? previewLog : logs.find((log) => log.id === logId);
        const removedImage = sourceLog?.images.find((image) => image.id === imageId);
        if (!sourceLog || !removedImage) return;
        const images = sourceLog.images.filter((image) => image.id !== imageId);
        const nextLog: GenerationLog = {
            ...sourceLog,
            images,
            thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
            successCount: Math.min(images.length, sourceLog.successCount),
            imageCount: images.length,
            status: images.length ? "成功" : sourceLog.failCount ? "失败" : "成功",
        };
        try {
            if (images.length || sourceLog.failCount) await logStore.setItem(logId, serializeLog(nextLog));
            else await logStore.removeItem(logId);
            setResults((value) => value.filter((item) => !(item.logId === logId && item.image?.id === imageId)));
            setLogs((value) => (images.length || sourceLog.failCount ? value.map((log) => (log.id === logId ? nextLog : log)) : value.filter((log) => log.id !== logId)));
            setPreviewLog((value) => (value?.id === logId ? (images.length || sourceLog.failCount ? nextLog : null) : value));
            await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
            if (removedImage.storageKey) await deleteStoredImages([removedImage.storageKey]);
            message.success("已删除这次生成结果");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除生成结果失败");
        }
    };

    const deleteFailedResultFromLog = async (logId: string | undefined, resultId: string) => {
        if (!logId) {
            setResults((value) => value.filter((item) => item.id !== resultId));
            return;
        }
        const sourceLog = previewLog?.id === logId ? previewLog : logs.find((log) => log.id === logId);
        if (!sourceLog || !sourceLog.failCount) return;
        const nextFailCount = Math.max(0, sourceLog.failCount - 1);
        const nextLog: GenerationLog = {
            ...sourceLog,
            failCount: nextFailCount,
            status: sourceLog.images.length ? "成功" : nextFailCount ? "失败" : "成功",
        };
        const keepLog = Boolean(sourceLog.images.length || nextFailCount);
        try {
            if (keepLog) await logStore.setItem(logId, serializeLog(nextLog));
            else await logStore.removeItem(logId);
            setResults((value) => value.filter((item) => item.id !== resultId));
            setLogs((value) => (keepLog ? value.map((log) => (log.id === logId ? nextLog : log)) : value.filter((log) => log.id !== logId)));
            setPreviewLog((value) => (value?.id === logId ? (keepLog ? nextLog : null) : value));
            message.success("已删除失败结果");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除失败结果失败");
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            const stored = await uploadImage(payload.dataUrl);
            publishUploadedImage(stored);
            setReferences((value) => [...value, { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey }].slice(0, maxReferenceImages));
        } else {
            message.warning("生图工作台只能使用文本或图片资产");
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        invalidateActiveBatch("已新建生图会话");
        setPrompt("");
        setReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const deletingIds = [...selectedLogIds];
        const imageKeys = logs.filter((log) => deletingIds.includes(log.id)).flatMap((log) => log.images.map((image) => image.storageKey).filter((key): key is string => Boolean(key)));
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        void (async () => {
            try {
                for (const id of deletingIds) await logStore.removeItem(id);
                await deleteStoredImages(imageKeys);
            } catch {
                message.error("删除生成记录失败");
            } finally {
                await refreshLogs();
            }
        })();
    };

    const refreshLogs = async () => {
        const readVersion = ++logReadVersionRef.current;
        const nextLogs = await readStoredLogs();
        if (!mountedRef.current || readVersion !== logReadVersionRef.current) return;
        setLogs(generationLogVisibility.filter(nextLogs));
    };

    const previewGenerationLog = async (log: GenerationLog) => {
        invalidateActiveBatch("已切换到生成记录");
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        if (log.config.imageModel || log.model) updateConfig("imageModel", log.config.imageModel || log.model);
        if (log.config.quality) updateConfig("quality", log.config.quality);
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.count) updateConfig("count", log.config.count);
        setResults([
            ...log.images.map((image) => ({ id: image.id, logId: log.id, status: "success" as const, image })),
            ...Array.from({ length: Math.max(0, log.failCount || 0) }, () => ({ id: nanoid(), logId: log.id, status: "failed" as const, error: "生成失败，可重试" })),
        ]);
    };

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text) {
            message.error("请输入生图提示词");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        if (imageExperience === "minimax-image" && references.length > 1) {
            message.error("MiniMax image-01 人物参考只支持 1 张图片，请先移除多余图片");
            return null;
        }
        return { text, config: { ...selectedImageConfig, count: "1" }, references: [...references].slice(0, maxReferenceImages) };
    };

    const runGenerationSlot = async (slotId: string, snapshot: { text: string; config: AiConfig; references: ReferenceImage[] }, batch: ActiveGenerationBatch) => {
        const itemStartedAt = performance.now();
        try {
            const result = await awaitForCurrentGeneration(
                () => (snapshot.references.length ? requestEdit(snapshot.config, snapshot.text, snapshot.references, undefined, { signal: batch.controller.signal }) : requestGeneration(snapshot.config, snapshot.text, { signal: batch.controller.signal })),
                () => isBatchCurrent(batch),
            );
            const image = result[0];
            if (!image) throw new Error("接口没有返回图片");
            const meta = await awaitForCurrentGeneration(
                () => readImageMeta(image.dataUrl),
                () => isBatchCurrent(batch),
            );
            if (!isBatchCurrent(batch)) throw new DOMException("生图任务已取消", "AbortError");
            const nextImage = { id: image.id, dataUrl: image.dataUrl, durationMs: performance.now() - itemStartedAt, width: meta.width, height: meta.height, bytes: getDataUrlByteSize(image.dataUrl) };
            // Keep the slot pending until its native media and generation log
            // have both committed. This prevents a transient provider URL from
            // looking like a usable result that cannot be saved or restored.
            setResults((value) => updateStableGenerationSlot(value, slotId, { status: "pending", image: nextImage }));
            return nextImage;
        } catch (error) {
            if (isBatchCurrent(batch)) {
                setResults((value) => updateStableGenerationSlot(value, slotId, { status: "failed", error: error instanceof Error ? error.message : "生成失败" }));
            }
            throw error;
        }
    };

    const retryResult = async (slotId: string) => {
        if (activeBatchRef.current) return;
        const sourceResult = results.find((item) => item.id === slotId);
        const sourceLogId = sourceResult?.logId || previewLog?.id;
        const sourceLog = sourceLogId ? (previewLog?.id === sourceLogId ? previewLog : logs.find((log) => log.id === sourceLogId)) : undefined;
        const snapshot = buildRequestSnapshot();
        if (!snapshot) return;

        const batch = startGenerationBatch(nanoid(), [slotId]);
        setResults((value) => updateStableGenerationSlot(value, slotId, { logId: sourceLogId, status: "pending", error: undefined, image: undefined }));
        setElapsedMs(0);
        setRunning(true);
        const retryStartedAt = performance.now();
        setStartedAt(retryStartedAt);
        let stored: UploadedImage | undefined;
        let uploadSettled = false;
        try {
            const image = await runGenerationSlot(slotId, snapshot, batch);
            if (!isBatchCurrent(batch)) return;
            const uploaded = await uploadImage(image.dataUrl);
            stored = uploaded;
            if (!isBatchCurrent(batch)) {
                await discardUploadedImage(uploaded);
                return;
            }
            const logImage = { ...image, dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType };
            const retryDurationMs = performance.now() - retryStartedAt;
            const completedLog: GenerationLog = sourceLog
                ? mergeRetriedGenerationLog<GeneratedImage, GenerationLog>(sourceLog, logImage, retryDurationMs)
                : buildLog({
                      prompt: snapshot.text,
                      model,
                      config: { ...snapshot.config, count: "1" },
                      references: snapshot.references,
                      durationMs: retryDurationMs,
                      successCount: 1,
                      failCount: 0,
                      status: "成功",
                      images: [logImage],
                  });
            let persisted = sourceLog ? await persistRetriedLog(batch, sourceLog, completedLog) : await persistBatchLog(batch, completedLog);
            if (!sourceLog && persisted.committed && !isBatchCurrent(batch)) persisted = await rollbackGenerationLog(completedLog);
            if (!persisted.committed || !isBatchCurrent(batch)) {
                await settleProvisionalImages([uploaded], persisted.media);
                uploadSettled = true;
                if (isBatchCurrent(batch) && persisted.error) throw persisted.error;
                return;
            }
            publishUploadedImage(uploaded);
            uploadSettled = true;
            setResults((value) => updateStableGenerationSlot(value, slotId, { logId: completedLog.id, status: "success", error: undefined, image: logImage }));
            setPreviewLog((value) => (sourceLog && (!value || value.id === completedLog.id) ? completedLog : value));
            if (!isBatchCurrent(batch)) return;
            message.success("重试成功，原记录已更新");
        } catch (retryError) {
            if (stored && !uploadSettled) await discardProvisionalImages([stored]);
            if (!isBatchCurrent(batch)) return;
            const retryErrorMessage = retryError instanceof Error ? retryError.message : "重试失败";
            setResults((value) => updateStableGenerationSlot(value, slotId, { logId: sourceLogId, status: "failed", image: undefined, error: retryErrorMessage }));
            message.error(retryErrorMessage);
        } finally {
            finishGenerationBatch(batch);
        }
    };

    return (
        <div className="wg-media-workbench">
            <MediaWorkbenchHeader kind="image" title="图片创作" onOpenHistory={() => setLogsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />

            <main className="wg-media-workbench-grid">
                <aside className="wg-media-workbench-pane wg-media-workbench-history">
                    <div className="thin-scrollbar h-full min-h-0 overflow-y-auto p-4">
                        <LogPanel
                            logs={logs}
                            selectedLogIds={selectedLogIds}
                            activeLogId={previewLog?.id}
                            onSelectedLogIdsChange={setSelectedLogIds}
                            onCreateSession={createSession}
                            onDeleteSelected={() => setDeleteConfirmOpen(true)}
                            onPreviewLog={(log) => void previewGenerationLog(log)}
                        />
                    </div>
                </aside>

                <section className="wg-media-workbench-pane wg-media-workbench-creation">
                    <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
                        <div className="wg-media-workbench-result-stage">
                            <div className="wg-media-section-heading">
                                <div>
                                    <h2>{t("生成结果")}</h2>
                                    <p>{results.length ? t("{count} 个结果", { count: results.length }) : t("结果会显示在这里")}</p>
                                </div>
                                {running ? <Tag className="m-0 border-0 bg-[color:var(--wg-studio-accent-soft)] px-2.5 py-1 text-[color:var(--wg-studio-accent-strong)]">{t("生成中 · {time}", { time: formatDuration(elapsedMs) })}</Tag> : null}
                            </div>
                            <ImageResultStage
                                results={results}
                                running={running}
                                onEdit={addResultToReferences}
                                onDownload={downloadImage}
                                onSaveAsset={saveResultToAssets}
                                onRetry={(slotId) => void retryResult(slotId)}
                                onRegenerate={(logId) => void generate(undefined, true, logId)}
                                onDelete={(logId, imageId) => void deleteResultFromLog(logId, imageId)}
                                onDeleteFailure={(logId, resultId) => void deleteFailedResultFromLog(logId, resultId)}
                            />
                        </div>

                        <div className="wg-media-composer">
                            <div className="wg-media-composer-heading">
                                <div>
                                    <h2>{t("描述你想生成的图片")}</h2>
                                    <p>{t("写清主体、环境、光线和风格")}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                        {t("提示词库")}
                                    </Button>
                                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                        {t("我的资产")}
                                    </Button>
                                </div>
                            </div>
                            <Input.TextArea className="wg-media-prompt-input" value={prompt} onChange={(event) => setPrompt(event.target.value)} autoSize={{ minRows: 3, maxRows: 7 }} placeholder={t("例如：清晨薄雾中的玻璃温室，柔和逆光，电影感构图…")} />

                            <div className="wg-media-reference-heading">
                                <div>
                                    <span>{t("参考图")}</span>
                                    <small>{t(imageExperience === "minimax-image" ? "支持 1 张清晰人物参考图，用于保持人物特征" : "用于控制人物、风格、构图和细节")}</small>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                        {t("剪切板")}
                                    </Button>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {t("添加图片")}
                                    </Button>
                                </div>
                            </div>
                            <div
                                className={isReferenceDragActive ? "wg-media-reference-strip is-dragging" : "wg-media-reference-strip"}
                                onDragEnter={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current += 1;
                                    if (event.dataTransfer.types.includes("Files")) setIsReferenceDragActive(true);
                                }}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                }}
                                onDragLeave={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
                                    if (!dragDepthRef.current) setIsReferenceDragActive(false);
                                }}
                                onDrop={(event) => {
                                    event.preventDefault();
                                    dragDepthRef.current = 0;
                                    setIsReferenceDragActive(false);
                                    void addReferences(event.dataTransfer.files);
                                }}
                            >
                                {references.map((item, index) => (
                                    <div key={item.id} className="wg-media-reference-tile">
                                        <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                        <span className="wg-media-reference-index">{imageReferenceLabel(index)}</span>
                                        <ReferenceOrderButtons index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                        <button type="button" className="wg-media-reference-remove" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label={"移除" + imageReferenceLabel(index)}>
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {!references.length ? (
                                    <button type="button" className="wg-media-reference-empty" onClick={() => fileInputRef.current?.click()}>
                                        <ImagePlus className="size-5" />
                                        <span>{t(isReferenceDragActive ? "松开即可添加参考图" : "拖入图片，或点此添加参考图")}</span>
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="wg-media-mobile-cta">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                            {t("生成图片 · {count} 张", { count: generationCount })}
                        </Button>
                    </div>
                </section>

                <aside className="wg-media-workbench-pane wg-media-workbench-inspector">
                    <div className="wg-media-inspector-heading">
                        <div>
                            <h2>{t("模型与参数")}</h2>
                            <p>{t("按当前模型调整可用选项")}</p>
                        </div>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <GenerationSettings config={selectedImageConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                        </div>
                    </div>
                    <div className="wg-media-generate-footer">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                            {t("生成图片 · {count} 张", { count: generationCount })}
                        </Button>
                    </div>
                </aside>
            </main>

            <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple={maxReferenceImages > 1}
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer rootClassName="wg-media-workbench-drawer" title={t("生成记录")} placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={(log) => void previewGenerationLog(log)}
                />
            </Drawer>
            <Drawer rootClassName="wg-media-workbench-drawer" title={t("模型与参数")} placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-4 pb-24">
                    <GenerationSettings config={selectedImageConfig} model={model} updateConfig={updateConfig} openConfigDialog={openConfigDialog} />
                </div>
                <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                    <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                        {t("生成图片 · {count} 张", { count: generationCount })}
                    </Button>
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title={t("删除生成记录")} open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText={t("删除")} okButtonProps={{ danger: true }} cancelText={t("取消")}>
                {t("确定删除选中的 {count} 条生成记录吗？", { count: selectedLogIds.length })}
            </Modal>
        </div>
    );
}

function GenerationSettings({ config, model, updateConfig, openConfigDialog }: { config: AiConfig; model: string; updateConfig: UpdateAiConfig; openConfigDialog: (shouldPromptContinue?: boolean) => void }) {
    const { t } = useAppTranslation();
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resolvedConfig = { ...config, model, imageModel: model };

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{t("模型")}</span>
                <ModelPicker config={resolvedConfig} value={model} onChange={(value) => updateConfig("imageModel", value)} capability="image" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <ImageSettingsPanel config={resolvedConfig} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-5" maxCount={10} />
            </div>
        </>
    );
}

function ImageResultStage({
    results,
    running,
    onEdit,
    onDownload,
    onSaveAsset,
    onRetry,
    onRegenerate,
    onDelete,
    onDeleteFailure,
}: {
    results: GenerationResult[];
    running: boolean;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
    onRetry: (slotId: string) => void;
    onRegenerate: (logId?: string) => void;
    onDelete: (logId: string | undefined, imageId: string) => void;
    onDeleteFailure: (logId: string | undefined, resultId: string) => void;
}) {
    const { t } = useAppTranslation();
    const [activeId, setActiveId] = useState<string>();

    useEffect(() => {
        if (!results.length) {
            setActiveId(undefined);
            return;
        }
        if (!results.some((item) => item.id === activeId)) setActiveId(results[0].id);
    }, [activeId, results]);

    if (!results.length) {
        return (
            <div className="wg-media-result-empty">
                <div className="wg-media-result-empty-icon">
                    <ImagePlus className="size-7" strokeWidth={1.6} />
                </div>
                <h3>{t("从一个画面想法开始")}</h3>
                <p>{t("描述主体、环境和风格，生成结果会显示在这里")}</p>
            </div>
        );
    }

    const activeIndex = Math.max(
        0,
        results.findIndex((item) => item.id === activeId),
    );
    const active = results[activeIndex] || results[0];

    return (
        <div className="wg-media-result-viewer">
            <div className="wg-media-result-active">
                {active.status === "success" && active.image ? (
                    <ResultImageCard image={active.image} index={activeIndex} onEdit={onEdit} onDownload={onDownload} onSaveAsset={onSaveAsset} onRegenerate={() => onRegenerate(active.logId)} onDelete={() => onDelete(active.logId, active.image!.id)} regenerateDisabled={running} />
                ) : active.status === "failed" ? (
                    <FailedImageCard error={active.error || t("生成失败")} retryDisabled={running} onRetry={() => onRetry(active.id)} onDelete={() => onDeleteFailure(active.logId, active.id)} />
                ) : (
                    <PendingImageCard />
                )}
            </div>
            {results.length > 1 ? (
                <div className="wg-media-result-thumbnails" aria-label={t("生成结果列表")}>
                    {results.map((result, index) => (
                        <button key={result.id} type="button" className={result.id === active.id ? "is-active" : ""} onClick={() => setActiveId(result.id)} aria-label={t("查看结果 {number}", { number: index + 1 })}>
                            {result.image ? <img src={result.image.dataUrl} alt="" /> : result.status === "failed" ? <span className="text-red-700">{t("失败")}</span> : <LoaderCircle className="size-4 animate-spin" />}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function ResultImageCard({
    image,
    index,
    onEdit,
    onDownload,
    onSaveAsset,
    onRegenerate,
    onDelete,
    regenerateDisabled,
}: {
    image: GeneratedImage;
    index: number;
    onEdit: (image: GeneratedImage, index: number) => void;
    onDownload: (image: GeneratedImage, index: number) => void;
    onSaveAsset: (image: GeneratedImage, index: number) => void;
    onRegenerate: () => void;
    onDelete: () => void;
    regenerateDisabled: boolean;
}) {
    const { t } = useAppTranslation();
    return (
        <div className="wg-media-result-card overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="wg-media-result-card-preview flex min-h-48 items-center justify-center bg-stone-100/70 dark:bg-stone-950/40">
                <Image rootClassName="block w-full" src={image.dataUrl} alt={t("查看结果 {number}", { number: index + 1 })} className="block h-auto max-h-[560px] w-full object-contain" />
            </div>
            <div className="wg-media-result-card-actions space-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {image.width}x{image.height}
                    </span>
                    <span>{formatBytes(image.bytes)}</span>
                    <span>{formatDuration(image.durationMs)}</span>
                    <Popconfirm title={t("删除这次生成结果？")} description={t("不会影响同一记录中的其他结果。")} okText={t("删除")} cancelText={t("取消")} okButtonProps={{ danger: true }} onConfirm={onDelete}>
                        <Button type="text" danger size="small" className="ml-auto !h-5 !px-1" icon={<Trash2 className="size-3.5" />} aria-label={`删除生成结果 ${index + 1}`} />
                    </Popconfirm>
                </div>
                <div className="grid min-w-0 grid-cols-2 gap-2 sm:grid-cols-4">
                    <Tooltip title={t("按当前提示词和参数再生成一组，原结果会保留")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<RefreshCw className="size-3.5" />} disabled={regenerateDisabled} onClick={onRegenerate}>
                            {t("重新生成")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("添加到资产")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(image, index)}>
                            {t("保存到我的资产")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("加入参考图")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<PenLine className="size-3.5" />} onClick={() => void onEdit(image, index)}>
                            {t("加入参考图")}
                        </Button>
                    </Tooltip>
                    <Tooltip title={t("下载")}>
                        <Button className={RESULT_ACTION_BUTTON_CLASS} size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(image, index)}>
                            {t("下载")}
                        </Button>
                    </Tooltip>
                </div>
            </div>
        </div>
    );
}

function PendingImageCard() {
    const { t } = useAppTranslation();
    return (
        <div className="relative aspect-square overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div
                className="absolute inset-0 opacity-60"
                style={{
                    backgroundImage: "radial-gradient(circle, rgba(120,113,108,0.35) 1.4px, transparent 1.6px)",
                    backgroundSize: "16px 16px",
                }}
            />
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>{t("生成中")}</span>
            </div>
        </div>
    );
}

function FailedImageCard({ error, retryDisabled, onRetry, onDelete }: { error: string; retryDisabled: boolean; onRetry: () => void; onDelete: () => void }) {
    const { t } = useAppTranslation();
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-square flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">{t("生成失败")}</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end gap-2 border-t border-red-200 p-3 dark:border-red-950">
                <Popconfirm title={t("删除这次失败结果？")} description={t("不会影响同一记录中的其他结果。")} okText={t("删除")} cancelText={t("取消")} okButtonProps={{ danger: true }} onConfirm={onDelete}>
                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />}>
                        {t("删除")}
                    </Button>
                </Popconfirm>
                <Button size="small" danger disabled={retryDisabled} onClick={onRetry}>
                    {t("重试")}
                </Button>
            </div>
        </div>
    );
}

function LogPanel({
    logs,
    selectedLogIds,
    activeLogId,
    onSelectedLogIdsChange,
    onCreateSession,
    onDeleteSelected,
    onPreviewLog,
}: {
    logs: GenerationLog[];
    selectedLogIds: string[];
    activeLogId?: string;
    onSelectedLogIdsChange: (ids: string[]) => void;
    onCreateSession: () => void;
    onDeleteSelected: () => void;
    onPreviewLog: (log: GenerationLog) => void;
}) {
    const { t } = useAppTranslation();
    const allSelected = Boolean(logs.length) && selectedLogIds.length === logs.length;
    const selectedCount = selectedLogIds.length;
    const [managing, setManaging] = useState(false);
    const toggleAll = () => onSelectedLogIdsChange(allSelected ? [] : logs.map((log) => log.id));
    const toggleManaging = () => {
        if (managing) onSelectedLogIdsChange([]);
        setManaging((value) => !value);
    };

    return (
        <>
            <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                    <h2 className="text-[15px] font-semibold">{t("生成记录")}</h2>
                    <p className="mt-0.5 text-[10px] text-[color:var(--wg-studio-muted)]">{t("{count} 条图片创作", { count: logs.length })}</p>
                </div>
                <Button type="text" size="small" icon={<CheckSquare className="size-3.5" />} onClick={toggleManaging} aria-pressed={managing}>
                    {t(managing ? "完成" : "多选")}
                </Button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    {t("新创作")}
                </Button>
                {managing ? (
                    <>
                        <Button size="small" disabled={!logs.length} onClick={toggleAll}>
                            {t(allSelected ? "取消全选" : "全选")}
                        </Button>
                        <span className="self-center text-[11px] text-[color:var(--wg-studio-muted)]">{t("已选 {count} 条", { count: selectedCount })}</span>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedCount} onClick={onDeleteSelected}>
                            {t("删除（{count}）", { count: selectedCount })}
                        </Button>
                    </>
                ) : null}
            </div>
            <div className="space-y-2.5">
                {logs.map((log) => (
                    <LogCard
                        key={log.id}
                        log={log}
                        managing={managing}
                        selected={selectedLogIds.includes(log.id)}
                        active={activeLogId === log.id}
                        onSelectedChange={(checked) => onSelectedLogIdsChange(checked ? [...selectedLogIds, log.id] : selectedLogIds.filter((id) => id !== log.id))}
                        onClick={() => onPreviewLog(log)}
                    />
                ))}
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">{t("暂无生成记录")}</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, managing, selected, active, onSelectedChange, onClick }: { log: GenerationLog; managing: boolean; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const { t } = useAppTranslation();
    const thumbnail = (log.thumbnails || []).find(Boolean);

    return (
        <div className={active ? "wg-media-history-card is-active" : "wg-media-history-card"}>
            {managing ? <Checkbox className="absolute right-2 top-2 z-10" checked={selected} onChange={(event) => onSelectedChange(event.target.checked)} aria-label={t("选择记录：{title}", { title: log.title })} /> : null}
            <button type="button" className="block w-full text-left focus-visible:outline-none" onClick={onClick}>
                <div className="flex gap-2.5">
                    <div className="wg-media-history-thumb">
                        {thumbnail ? <img src={thumbnail} alt="" /> : <ImagePlus className="size-5" />}
                        <span className={log.failCount && !log.successCount ? "is-failed" : ""}>{log.failCount && !log.successCount ? t("失败") : t("{count} 张", { count: log.imageCount })}</span>
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                        <div className="truncate pr-5 text-[12px] font-semibold">{log.title}</div>
                        <div className="mt-1 truncate text-[10px] text-[color:var(--wg-studio-muted)]">{log.model || t("图片模型")}</div>
                        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[color:var(--wg-studio-muted)]">
                            <span>{log.size || t("自适应")}</span>
                            <span>{log.quality || t("自动")}</span>
                            <span>{formatDuration(log.durationMs)}</span>
                        </div>
                        <div className="mt-1.5 truncate text-[9px] text-[color:var(--wg-studio-muted)] opacity-75">{log.time}</div>
                    </div>
                </div>
            </button>
        </div>
    );
}

async function readStoredLogs() {
    if (typeof window === "undefined") return [];
    try {
        const values: GenerationLog[] = [];
        await logStore.iterate<GenerationLog, void>((value) => {
            values.push(value);
        });
        const logs = await Promise.all(generationLogVisibility.filter(values).map(normalizeLog));
        return generationLogVisibility.filter(logs).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const images = await Promise.all(
        (log.images || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || log.title || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.imageModel || "",
        config,
        references,
        durationMs: log.durationMs || 0,
        successCount: log.successCount ?? log.imageCount ?? 0,
        failCount: log.failCount || 0,
        imageCount: log.imageCount || log.successCount || 0,
        size: log.size || config.size || "",
        quality: log.quality || config.quality || "",
        status: log.status || "成功",
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        images: log.images.map((image) => ({ ...image, dataUrl: image.storageKey ? "" : image.dataUrl })),
        thumbnails: [],
    };
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        imageModel: log.config?.imageModel || log.model || "",
        quality: log.config?.quality || log.quality || "",
        size: log.config?.size || log.size || "",
        count: log.config?.count || String(log.imageCount || log.successCount || 1),
    };
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

async function discardProvisionalImages(images: UploadedImage[]) {
    await Promise.allSettled(images.map((image) => discardUploadedImage(image)));
}

async function settleProvisionalImages(images: UploadedImage[], resolution: GenerationLogMediaResolution) {
    await Promise.allSettled(
        images.map(async (image) => {
            if (resolveGenerationMediaAction(image.storageKey, resolution) === "publish") {
                publishUploadedImage(image);
                return;
            }
            await discardUploadedImage(image);
        }),
    );
}

function ReferenceOrderButtons({ index, total, onMove }: { index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button aria-label={`将${imageReferenceLabel(index)}向前移动`} size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button
                aria-label={`将${imageReferenceLabel(index)}向后移动`}
                size="small"
                className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm"
                icon={<ArrowRight className="size-3" />}
                disabled={index >= total - 1}
                onClick={() => onMove(1)}
            />
        </div>
    );
}

function buildLog({
    prompt,
    model,
    config,
    references,
    durationMs,
    successCount,
    failCount,
    status,
    images,
}: {
    prompt: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    durationMs: number;
    successCount: number;
    failCount: number;
    status: GenerationLog["status"];
    images: GeneratedImage[];
}): GenerationLog {
    const logConfig = {
        model: config.model,
        imageModel: config.imageModel,
        quality: config.quality,
        size: config.size,
        count: config.count,
    };
    return {
        id: nanoid(),
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        durationMs,
        successCount,
        failCount,
        imageCount: Number(logConfig.count) || successCount,
        size: logConfig.size,
        quality: logConfig.quality,
        status,
        images,
        thumbnails: images.map((image) => image.dataUrl).filter(Boolean),
    };
}

function appendGeneratedImagesToLog(log: GenerationLog, images: GeneratedImage[], durationMs: number, successCount: number, failCount: number): GenerationLog {
    const nextImages = [...log.images, ...images];
    return {
        ...log,
        durationMs: log.durationMs + Math.max(0, durationMs),
        successCount: log.successCount + successCount,
        failCount: log.failCount + failCount,
        imageCount: nextImages.length,
        status: nextImages.length ? "成功" : "失败",
        images: nextImages,
        thumbnails: nextImages.map((image) => image.dataUrl).filter(Boolean),
    };
}
