import { ArrowLeft, ArrowRight, BookOpen, CheckSquare, ClipboardPaste, Download, FolderPlus, ImagePlus, LoaderCircle, Music2, Plus, RefreshCw, Sparkles, Trash2, Upload, VideoIcon } from "lucide-react";
import { useEffect, useRef, useState, type DragEvent } from "react";
import { App, Button, Checkbox, Drawer, Empty, Input, Modal, Popconfirm, Tag, Typography } from "antd";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { MediaWorkbenchHeader } from "@/components/media-workbench-header";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { VideoSettingsPanel, normalizeVideoResolutionValue, normalizeVideoSizeValue } from "@/components/video-settings-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { modelExperienceKind } from "@/lib/model-providers";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceRatio, seedanceReferenceLabel, seedanceVideoReferenceError, seedanceVideoReferenceHint, SEEDANCE_REFERENCE_LIMITS, SEEDANCE_VIDEO_MIME_TYPES } from "@/lib/seedance-video";
import {
    isSeedance25Model,
    normalizeSeedance25Continuation,
    normalizeSeedance25Duration,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25RemoteVideoUrl,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    seedance25InputModeError,
    seedance25MultimodalReferenceError,
    seedance25TaskLabel,
    SEEDANCE_25_REFERENCE_LIMITS,
} from "@/lib/seedance-2-5";
import {
    isMiniMaxHailuoFastModel,
    isMiniMaxHailuoModel,
    miniMaxVideoInputModeError,
    normalizeMiniMaxHailuoVideoOptions,
    normalizeMiniMaxVideoInputMode,
    normalizeMiniMaxVideoRatio,
    normalizeMiniMaxVideoResolution,
    resolveMiniMaxVideoInputMode,
} from "@/lib/minimax-contract";
import {
    consumePendingVideoGenerationIntent,
    markStaleVideoLogCancelled,
    markVideoLogDeleted,
    mergeVideoCancellationJournalEntry,
    retryAsyncOperation,
    shouldInvalidateVideoGenerationLifecycle,
    shouldRetainUploadedVideo,
    videoGenerationLogMutationQueue,
    videoGenerationLogRevision,
    videoGenerationLogVisibility,
    VideoGenerationRunRegistry,
    type PendingVideoGenerationIntent,
    type VideoCancellationJournalEntry,
    type VideoGenerationRun,
    type VideoGenerationRunMode,
} from "@/lib/video-generation-run";
import { deleteStoredMedia, discardUploadedMedia, getMediaBlob, publishUploadedMedia, resolveMediaUrl, uploadMediaFile } from "@/services/file-storage";
import { deleteStoredImages, discardUploadedImage, publishUploadedImage, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { createDesktopJsonStore, exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { createVideoGenerationTask, isMiniMaxH3ImageMime, miniMaxHailuoReferenceError, miniMaxH3ReferenceError, pollVideoGenerationTask, storeGeneratedVideo, videoGenerationPollingPolicy, type VideoGenerationTask } from "@/services/api/video";
import { useAssetStore } from "@/stores/use-asset-store";
import { useWorkbenchAgentStore } from "@/stores/use-workbench-agent-store";
import { modelOptionName, resolveModelRequestConfig, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { useThemeStore } from "@/stores/use-theme-store";
import type { ReferenceImage } from "@/types/image";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";

type GeneratedVideo = {
    id: string;
    url: string;
    storageKey: string;
    durationMs: number;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
    remoteUrl?: string;
    lastFrame?: UploadedImage;
    remoteLastFrameUrl?: string;
};

type GenerationResult = {
    id: string;
    status: "pending" | "success" | "failed";
    video?: GeneratedVideo;
    error?: string;
};

type GenerationLog = {
    id: string;
    runId?: string;
    createdAt: number;
    title: string;
    prompt: string;
    time: string;
    model: string;
    config: GenerationLogConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    size: string;
    resolution: string;
    seconds: string;
    status: "生成中" | "成功" | "失败";
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
    deletedAt?: number;
};

type GenerationLogConfig = Pick<
    AiConfig,
    | "model"
    | "videoModel"
    | "size"
    | "vquality"
    | "videoSeconds"
    | "videoGenerateAudio"
    | "videoWatermark"
    | "seedance25TaskMode"
    | "seedance25Continuation"
    | "seedance25OutputFormat"
    | "seedance25InputMode"
    | "seedance25Seed"
    | "seedance25ReturnLastFrame"
    | "seedance25WebSearch"
    | "seedance25CameraFixed"
    | "minimaxVideoInputMode"
    | "minimaxVideoPromptOptimizer"
    | "minimaxVideoFastPretreatment"
>;

type RunLogSaveOutcome = {
    status: "committed" | "stale-removed" | "uncertain";
    error?: unknown;
};

type CancelledVideoJob = VideoCancellationJournalEntry;

type UpdateAiConfig = <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;

const LOG_STORE_KEY = "infinite-canvas:video_generation_logs";
const CANCELLATION_JOURNAL_KEY = "workflowgenerator:video-cancellation-journal-v1";
const MINIMAX_HAILUO_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const logStore = createDesktopJsonStore({
    namespace: "video-generation-logs-v1",
    legacy: { name: "infinite-canvas", storeName: "video_generation_logs" },
});
const cancelledJobStore = createDesktopJsonStore({
    namespace: "video-generation-cancellations-v1",
    legacy: { name: "infinite-canvas", storeName: "video_generation_cancellations" },
});
const videoGenerationRunRegistry = new VideoGenerationRunRegistry();
const videoRetrySnapshots = new Map<string, GenerationLog>();

function readSynchronousCancellationJournal() {
    if (typeof window === "undefined") return new Map<string, CancelledVideoJob>();
    try {
        const parsed = JSON.parse(window.localStorage.getItem(CANCELLATION_JOURNAL_KEY) || "{}") as Record<string, CancelledVideoJob>;
        return new Map(Object.entries(parsed));
    } catch {
        return new Map<string, CancelledVideoJob>();
    }
}

function writeSynchronousCancellationJournal(jobId: string, entry: CancelledVideoJob) {
    if (typeof window === "undefined") return entry;
    try {
        const journal = Object.fromEntries(readSynchronousCancellationJournal());
        const current = journal[jobId];
        journal[jobId] = mergeVideoCancellationJournalEntry(current, entry);
        window.localStorage.setItem(CANCELLATION_JOURNAL_KEY, JSON.stringify(journal));
        return journal[jobId];
    } catch {
        // Native storage remains the primary journal when WebView recovery
        // storage is unavailable.
        return entry;
    }
}

function removeSynchronousCancellationJournal(jobId: string) {
    if (typeof window === "undefined") return;
    try {
        const journal = Object.fromEntries(readSynchronousCancellationJournal());
        delete journal[jobId];
        window.localStorage.setItem(CANCELLATION_JOURNAL_KEY, JSON.stringify(journal));
    } catch {
        // A stale deletion marker is fail-safe: it can only keep this unique
        // job id hidden.
    }
}

export default function VideoPage() {
    const { message } = App.useApp();
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dragDepthRef = useRef(0);
    const mountedRef = useRef(false);
    const contextVersionRef = useRef(0);
    const refreshRequestRef = useRef(0);
    const runRegistry = videoGenerationRunRegistry;
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const [prompt, setPrompt] = useState("");
    const [seedance25VideoUrl, setSeedance25VideoUrl] = useState("");
    const [seedance25VideoDuration, setSeedance25VideoDuration] = useState(10);
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [videoReferences, setVideoReferences] = useState<ReferenceVideo[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
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
    const [referenceDragTarget, setReferenceDragTarget] = useState<"image" | "video" | "audio" | null>(null);
    const [autoRunIntentId, setAutoRunIntentId] = useState<string>();
    const videoCommand = useWorkbenchAgentStore((state) => state.videoCommand);
    const clearVideoCommand = useWorkbenchAgentStore((state) => state.clearVideoCommand);
    const updateAgentTask = useWorkbenchAgentStore((state) => state.updateTask);
    const processedCommandRef = useRef(0);
    const pendingAgentGenerationRef = useRef<PendingVideoGenerationIntent | null>(null);
    const lifecycleEpochRef = useRef(0);
    const runtimeMediaReferencesRef = useRef<unknown>(undefined);
    runtimeMediaReferencesRef.current = { references, videoReferences, audioReferences, results, logs, previewLog };

    const model = effectiveConfig.videoModel || effectiveConfig.model;
    const selectedVideoConfig = { ...effectiveConfig, model, videoModel: model };
    const selectedVideoRequestConfig = resolveModelRequestConfig(selectedVideoConfig, model);
    const videoExperience = modelExperienceKind(selectedVideoRequestConfig.apiFormat, modelOptionName(model), "video");
    const isSeedance25 = videoExperience === "seedance-video" && isSeedance25Model(modelOptionName(model));
    const seedance25TaskMode = normalizeSeedance25TaskMode(selectedVideoConfig.seedance25TaskMode);
    const seedance25InputMode = normalizeSeedance25InputMode(selectedVideoConfig.seedance25InputMode);
    const seedance25FrameMode = isSeedance25 && seedance25TaskMode === "generate" && seedance25InputMode !== "reference";
    const isMiniMaxH3 = videoExperience === "minimax-video";
    const isMiniMaxHailuo = videoExperience === "minimax-hailuo-video";
    const isMiniMaxHailuoFast = isMiniMaxHailuo && isMiniMaxHailuoFastModel(modelOptionName(model));
    const hailuoVideoOptions = isMiniMaxHailuo ? normalizeMiniMaxHailuoVideoOptions(selectedVideoConfig.vquality, Number(selectedVideoConfig.videoSeconds)) : null;
    const generationSeconds = isSeedance25 ? normalizeSeedance25Duration(effectiveConfig.videoSeconds, seedance25TaskMode) : hailuoVideoOptions?.duration || effectiveConfig.videoSeconds || "6";
    const generationDurationLabel = isSeedance25 && generationSeconds === -1 ? "智能时长" : `${generationSeconds} 秒`;
    const generationActionLabel = isSeedance25 ? seedance25TaskLabel(seedance25TaskMode) : "生成视频";
    const seedance25InputError = isSeedance25
        ? seedance25InputModeError(seedance25TaskMode, seedance25InputMode, { images: Math.min(references.length, seedance25InputMode === "first-frame" ? 1 : seedance25InputMode === "first-last" ? 2 : references.length), videos: seedance25FrameMode ? 0 : videoReferences.length, audios: seedance25FrameMode ? 0 : audioReferences.length })
        : "";
    const seedance25PureTextConflict = isSeedance25 && references.length + (seedance25FrameMode ? 0 : videoReferences.length + audioReferences.length) > 0 && (selectedVideoConfig.seedance25WebSearch === "true" || selectedVideoConfig.seedance25CameraFixed === "true");
    const canGenerate =
        isSeedance25 && seedance25TaskMode !== "generate"
            ? Boolean(prompt.trim()) && videoReferences.length >= 1 && !seedance25InputError
            : isMiniMaxHailuo
              ? isMiniMaxHailuoFast
                  ? references.length === 1
                  : Boolean(prompt.trim()) || references.length === 1
              : Boolean(prompt.trim()) && !seedance25InputError && !seedance25PureTextConflict;
    const supportsVideoReferences = (videoExperience === "seedance-video" || isMiniMaxH3 || videoExperience === "grok-video") && !seedance25FrameMode;
    const supportsAudioReferences = (videoExperience === "seedance-video" || isMiniMaxH3) && !seedance25FrameMode;
    const maxImageReferences = isSeedance25 ? (seedance25FrameMode ? (seedance25InputMode === "first-frame" ? 1 : 2) : SEEDANCE_25_REFERENCE_LIMITS.images) : videoExperience === "agnes-video" || isMiniMaxHailuo ? 1 : videoExperience === "grok-video" ? 3 : videoExperience === "seedance-video" || isMiniMaxH3 ? SEEDANCE_REFERENCE_LIMITS.images : 7;
    const maxVideoReferences = videoExperience === "grok-video" ? 1 : isSeedance25 ? SEEDANCE_25_REFERENCE_LIMITS.videos : SEEDANCE_REFERENCE_LIMITS.videos;
    const maxAudioReferences = isSeedance25 ? SEEDANCE_25_REFERENCE_LIMITS.audios : SEEDANCE_REFERENCE_LIMITS.audios;
    const maxVideoReferenceBytes = isMiniMaxH3 ? 50 * 1024 * 1024 : SEEDANCE_REFERENCE_LIMITS.videoMaxBytes;
    const seedance25ReferenceTitle = seedance25FrameMode ? (seedance25InputMode === "first-frame" ? "开场图片" : "开始与结束图片") : "参考素材";
    const seedance25ReferenceDescription =
        seedance25FrameMode && seedance25InputMode === "first-frame"
            ? "添加 1 张图片作为视频的开场画面"
            : seedance25FrameMode && seedance25InputMode === "first-last"
              ? "依次添加开始和结束两张图片"
              : "图片和音频可直接添加；参考视频使用上方链接";
    const seedance25ReferenceEmptyText =
        seedance25FrameMode && seedance25InputMode === "first-frame"
            ? referenceDragTarget
                ? "松开即可添加开场图片"
                : "拖入 1 张开场图片，或点此选择"
            : seedance25FrameMode && seedance25InputMode === "first-last"
              ? referenceDragTarget
                  ? "松开即可添加图片"
                  : "拖入开始和结束两张图片，或点此选择"
              : referenceDragTarget
                ? "松开即可添加图片或音频"
                : "拖入图片或音频；参考视频使用上方链接";

    useEffect(() => registerRuntimeMediaReferenceProvider(() => runtimeMediaReferencesRef.current), []);
    useEffect(() => markMediaReferencesChanged(), [audioReferences, logs, previewLog, references, results, videoReferences]);
    useEffect(() => {
        if (!isMiniMaxHailuo) return;
        setReferences((value) => value.slice(0, 1));
        setVideoReferences([]);
        setAudioReferences([]);
    }, [isMiniMaxHailuo, model]);

    useEffect(() => {
        if (!running || !startedAt) return;
        const timer = window.setInterval(() => setElapsedMs(performance.now() - startedAt), 1000);
        return () => window.clearInterval(timer);
    }, [running, startedAt]);

    useEffect(() => {
        const lifecycleEpoch = ++lifecycleEpochRef.current;
        mountedRef.current = true;
        const unsubscribeRevision = videoGenerationLogRevision.subscribe(() => {
            if (mountedRef.current) void refreshLogs(false);
        });
        void refreshLogs();
        return () => {
            const foregroundRunAtCleanup = runRegistry.foregroundRun();
            mountedRef.current = false;
            contextVersionRef.current += 1;
            refreshRequestRef.current += 1;
            unsubscribeRevision();
            queueMicrotask(() => {
                if (!shouldInvalidateVideoGenerationLifecycle(lifecycleEpochRef.current, lifecycleEpoch)) return;
                const pendingIntent = pendingAgentGenerationRef.current;
                pendingAgentGenerationRef.current = null;
                if (pendingIntent?.taskId) updateAgentTask(pendingIntent.taskId, { status: "failed", successCount: 0, failCount: 1, error: "视频工作台已关闭" });
                // Background polling is owned by the module-lifetime registry
                // and hands off across route remounts without destructive stale
                // rollback. Only the foreground run captured by this page is
                // cancelled; a replacement page's run can never be mistaken for it.
                if (foregroundRunAtCleanup && runRegistry.cancel(foregroundRunAtCleanup)) {
                    if (foregroundRunAtCleanup.agentTaskId) {
                        updateAgentTask(foregroundRunAtCleanup.agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: "视频工作台已关闭" });
                    }
                    terminalizeCancelledRun(foregroundRunAtCleanup, "视频工作台已关闭");
                }
            });
        };
        // StrictMode replays setup/cleanup in development. The epoch keeps that
        // simulated cleanup from consuming a real pending Agent intent.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const addReferences = async (files?: FileList | null) => {
        const selectedFiles = Array.from(files || []);
        if (isSeedance25 && selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type))) {
            message.warning(seedance25FrameMode ? "当前画面模式只使用图片，不能添加参考视频" : "Seedance 2.5 参考视频请粘贴公网 URL 或方舟素材 ID；本机视频不能直接发送给官方接口");
        }
        if (isSeedance25 && seedance25FrameMode && selectedFiles.some((file) => isSupportedAudioFile(file))) message.warning("当前画面模式只使用图片，不能添加参考音频");
        const unsupported = selectedFiles.filter((file) => (isMiniMaxHailuo ? !file.type.startsWith("image/") : !file.type.startsWith("image/") && !SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && !isSupportedAudioFile(file)));
        if (unsupported.length) message.warning(isMiniMaxHailuo ? "Hailuo 仅支持一张首帧图片" : "已忽略不支持的参考资产，请使用图片、mp4/mov 视频或 mp3/wav 音频");
        const imageMaxBytes = isMiniMaxHailuo ? MINIMAX_HAILUO_IMAGE_MAX_BYTES : SEEDANCE_REFERENCE_LIMITS.imageMaxBytes;
        const imageFiles =
            videoExperience === "grok-video" && videoReferences.length
                ? []
                : selectedFiles
                      .filter((file) => file.type.startsWith("image/") && (!(isMiniMaxH3 || isMiniMaxHailuo) || isMiniMaxH3ImageMime(file.type)) && (isMiniMaxHailuo ? file.size < imageMaxBytes : file.size <= imageMaxBytes))
                      .slice(0, Math.max(0, maxImageReferences - references.length));
        const videoFiles =
            supportsVideoReferences && !isSeedance25 && !(videoExperience === "grok-video" && references.length)
                ? selectedFiles.filter((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size <= maxVideoReferenceBytes).slice(0, maxVideoReferences - videoReferences.length)
                : [];
        const audioFiles = supportsAudioReferences ? selectedFiles.filter((file) => isSupportedAudioFile(file) && file.size <= SEEDANCE_REFERENCE_LIMITS.audioMaxBytes).slice(0, maxAudioReferences - audioReferences.length) : [];
        if (selectedFiles.some((file) => file.type.startsWith("image/") && (isMiniMaxHailuo ? file.size >= imageMaxBytes : file.size > imageMaxBytes))) message.warning(isMiniMaxHailuo ? "已忽略大于或等于 20MB 的首帧图片" : "已忽略超过 30MB 的参考图");
        if ((isMiniMaxH3 || isMiniMaxHailuo) && selectedFiles.some((file) => file.type.startsWith("image/") && !isMiniMaxH3ImageMime(file.type)))
            message.warning(`已忽略不支持的图片；${isMiniMaxHailuo ? "MiniMax Hailuo" : "MiniMax H3"} 仅接受 JPEG、PNG 或 WebP`);
        if (selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type) && file.size > maxVideoReferenceBytes)) message.warning(`已忽略超过 ${isMiniMaxH3 ? "50MB" : "200MB"} 的参考视频`);
        if (selectedFiles.some((file) => isSupportedAudioFile(file) && file.size > SEEDANCE_REFERENCE_LIMITS.audioMaxBytes)) message.warning("已忽略超过 15MB 的参考音频");
        if (videoExperience === "grok-video" && videoReferences.length && selectedFiles.some((file) => file.type.startsWith("image/"))) message.warning("Grok 每次只能使用参考图或参考视频，已保留当前参考视频");
        if (videoExperience === "grok-video" && references.length && selectedFiles.some((file) => SEEDANCE_VIDEO_MIME_TYPES.includes(file.type))) message.warning("Grok 每次只能使用参考图或参考视频，已保留当前参考图");
        const nextReferences = await Promise.all(
            imageFiles.map(async (file) => {
                const image = await uploadImage(file);
                return { id: nanoid(), name: file.name, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
            }),
        );
        const nextVideoReferences = filterMiniMaxVideoReferencesByDuration(
            isMiniMaxH3 ? videoReferences : [],
            await Promise.all(
                videoFiles.map(async (file) => {
                    const video = await uploadMediaFile(file, "video-reference");
                    publishUploadedMedia(video);
                    return { id: nanoid(), name: file.name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
                }),
            ),
            isMiniMaxH3,
            message.warning,
        );
        const nextAudioReferences = filterAudioReferencesByDuration(
            audioReferences,
            await Promise.all(
                audioFiles.map(async (file) => {
                    const audio = await uploadMediaFile(file, "audio-reference");
                    publishUploadedMedia(audio);
                    return { id: nanoid(), name: file.name, type: audio.mimeType, url: audio.url, storageKey: audio.storageKey, durationMs: audio.durationMs, bytes: audio.bytes };
                }),
            ),
            message.warning,
            isSeedance25 ? SEEDANCE_25_REFERENCE_LIMITS.mediaMaxDurationMs : 15_000,
            isSeedance25 ? SEEDANCE_25_REFERENCE_LIMITS.mediaTotalDurationMs : 15_000,
        );
        if (isMiniMaxH3) {
            const error = miniMaxH3ReferenceError([...references, ...nextReferences], [...videoReferences, ...nextVideoReferences], [...audioReferences, ...nextAudioReferences]);
            if (error) {
                nextReferences.forEach((item) => discardUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
                message.warning(error);
                return;
            }
        }
        if (isMiniMaxHailuo) {
            const error = miniMaxHailuoReferenceError(modelOptionName(model), [...references, ...nextReferences], [], []);
            if (error) {
                nextReferences.forEach((item) => discardUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
                message.warning(error);
                return;
            }
        }
        nextReferences.forEach((item) => publishUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
        setReferences((value) => [...value, ...nextReferences].slice(0, maxImageReferences));
        setVideoReferences((value) => [...value, ...nextVideoReferences].slice(0, maxVideoReferences));
        setAudioReferences((value) => [...value, ...nextAudioReferences].slice(0, maxAudioReferences));
        if (isSeedance25 && nextReferences.length + nextVideoReferences.length + nextAudioReferences.length > 0) {
            updateConfig("seedance25WebSearch", "false");
            updateConfig("seedance25CameraFixed", "false");
        }
    };

    const addSeedance25RemoteVideo = () => {
        const url = normalizeSeedance25RemoteVideoUrl(seedance25VideoUrl);
        if (!url) {
            message.warning("请输入 https:// 公网视频 URL 或 asset:// 方舟素材 ID");
            return;
        }
        const reference: ReferenceVideo = {
            id: nanoid(),
            name: url.startsWith("asset://") ? "方舟视频素材" : "远程参考视频",
            type: /\.mov(?:$|[?#])/i.test(url) ? "video/quicktime" : "video/mp4",
            url,
            durationMs: Math.max(seedance25TaskMode === "edit" ? 4 : 2, Math.min(30, Math.round(seedance25VideoDuration) || 10)) * 1000,
        };
        const error = seedance25MultimodalReferenceError(seedance25TaskMode, references, [...videoReferences, reference], audioReferences);
        if (error) {
            message.warning(error);
            return;
        }
        setVideoReferences((value) => [...value, reference].slice(0, maxVideoReferences));
        updateConfig("seedance25WebSearch", "false");
        updateConfig("seedance25CameraFixed", "false");
        setSeedance25VideoUrl("");
    };

    const handleReferenceDragEnter = (event: DragEvent<HTMLDivElement>, target: "image" | "video" | "audio") => {
        event.preventDefault();
        dragDepthRef.current += 1;
        if (event.dataTransfer.types.includes("Files")) setReferenceDragTarget(target);
    };

    const handleReferenceDragLeave = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
        if (!dragDepthRef.current) setReferenceDragTarget(null);
    };

    const handleReferenceDrop = (event: DragEvent<HTMLDivElement>) => {
        event.preventDefault();
        dragDepthRef.current = 0;
        setReferenceDragTarget(null);
        void addReferences(event.dataTransfer.files);
    };

    const addReferencesFromClipboard = async () => {
        if (videoExperience === "grok-video" && videoReferences.length) {
            message.warning("Grok 每次只能使用参考图或参考视频，请先移除参考视频");
            return;
        }
        try {
            const items = await navigator.clipboard.read();
            const blobs = await Promise.all(items.flatMap((item) => item.types.filter((type) => type.startsWith("image/")).map((type) => item.getType(type))));
            if (!blobs.length) {
                message.error("剪切板里没有可读取的图片");
                return;
            }
            const acceptedBlobs = blobs.filter((blob) => !(isMiniMaxH3 || isMiniMaxHailuo) || (isMiniMaxH3ImageMime(blob.type) && (isMiniMaxHailuo ? blob.size < MINIMAX_HAILUO_IMAGE_MAX_BYTES : blob.size <= SEEDANCE_REFERENCE_LIMITS.imageMaxBytes)));
            if ((isMiniMaxH3 || isMiniMaxHailuo) && acceptedBlobs.length !== blobs.length)
                message.warning(isMiniMaxHailuo ? "已忽略不符合 Hailuo 要求的图片；仅支持 JPEG、PNG、WebP，且需小于 20MB" : "已忽略不符合 MiniMax H3 要求的图片；仅支持 JPEG、PNG、WebP，单张不超过 30MB");
            const nextReferences = await Promise.all(
                acceptedBlobs.slice(0, Math.max(0, maxImageReferences - references.length)).map(async (blob, index) => {
                    const image = await uploadImage(blob);
                    return { id: nanoid(), name: `clipboard-${index + 1}.png`, type: image.mimeType, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, width: image.width, height: image.height };
                }),
            );
            if (isMiniMaxH3) {
                const error = miniMaxH3ReferenceError([...references, ...nextReferences], videoReferences, audioReferences);
                if (error) {
                    nextReferences.forEach((item) => discardUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
                    message.warning(error);
                    return;
                }
            }
            if (isMiniMaxHailuo) {
                const error = miniMaxHailuoReferenceError(modelOptionName(model), [...references, ...nextReferences], [], []);
                if (error) {
                    nextReferences.forEach((item) => discardUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
                    message.warning(error);
                    return;
                }
            }
            nextReferences.forEach((item) => publishUploadedImage({ url: item.dataUrl, storageKey: item.storageKey, width: item.width || 0, height: item.height || 0, bytes: item.bytes || 0, mimeType: item.type }));
            setReferences((value) => [...value, ...nextReferences].slice(0, maxImageReferences));
            if (isSeedance25 && nextReferences.length) {
                updateConfig("seedance25WebSearch", "false");
                updateConfig("seedance25CameraFixed", "false");
            }
            message.success(isMiniMaxHailuo ? "已读取首帧图片" : `已读取 ${nextReferences.length} 张参考图`);
        } catch {
            message.error("剪切板里没有可读取的图片");
        }
    };

    const persistCancellationJournal = (jobId: string, reason: string, hidden = false) => {
        const entry: CancelledVideoJob = { reason, hidden, createdAt: Date.now() };
        writeSynchronousCancellationJournal(jobId, entry);
        return retryVideoLogStorage(async () => {
            const recovery = readSynchronousCancellationJournal().get(jobId);
            const stored = await cancelledJobStore.getItem<CancelledVideoJob>(jobId);
            let merged = mergeVideoCancellationJournalEntry(stored || undefined, recovery || entry);
            merged = mergeVideoCancellationJournalEntry(merged, entry);
            const mergedHidden = Boolean(merged.hidden);
            writeSynchronousCancellationJournal(jobId, merged);
            await cancelledJobStore.setItem(jobId, merged);
            const confirmed = await cancelledJobStore.getItem<CancelledVideoJob>(jobId);
            if (!confirmed || confirmed.reason !== merged.reason || Boolean(confirmed.hidden) !== mergedHidden) {
                throw new Error("视频任务终止记录尚未落盘");
            }
        }, Number.MAX_SAFE_INTEGER);
    };

    const terminalizeCancelledRun = (run: VideoGenerationRun, reason: string) => {
        const retrySnapshot = videoRetrySnapshots.get(run.runId);
        if (retrySnapshot) {
            videoRetrySnapshots.delete(run.runId);
            videoGenerationLogVisibility.revive(run.jobId);
            removeSynchronousCancellationJournal(run.jobId);
            videoGenerationLogRevision.bump();
            void videoGenerationLogMutationQueue
                .run(run.jobId, async () => {
                    await retryVideoLogStorage(() => logStore.setItem(run.jobId, serializeLog(retrySnapshot)));
                    await retryVideoLogStorage(() => cancelledJobStore.removeItem(run.jobId)).catch(() => undefined);
                    removeSynchronousCancellationJournal(run.jobId);
                    videoGenerationLogRevision.bump();
                })
                .catch(() => undefined);
            return;
        }
        // Retire synchronously so a new page cannot resume the durable pending
        // task while the native-store mutation is still queued.
        videoGenerationLogVisibility.retire(run.jobId, reason);
        writeSynchronousCancellationJournal(run.jobId, { reason, createdAt: Date.now() });
        videoGenerationLogRevision.bump();
        void videoGenerationLogMutationQueue
            .run(run.jobId, async () => {
                try {
                    // This small journal is the cross-restart source of truth.
                    // Keep retrying until native storage acknowledges and reads
                    // back the exact cancellation intent.
                    await persistCancellationJournal(run.jobId, reason);
                    try {
                        await retryVideoLogStorage(async () => {
                            const stored = await logStore.getItem<GenerationLog>(run.jobId);
                            if (!stored) return;
                            await logStore.setItem(
                                run.jobId,
                                serializeLog({
                                    ...markStaleVideoLogCancelled(stored),
                                    error: reason,
                                    durationMs: Date.now() - stored.createdAt,
                                }),
                            );
                            const confirmed = await logStore.getItem<GenerationLog>(run.jobId);
                            if (!confirmed || confirmed.status !== "失败" || confirmed.task || confirmed.video) {
                                throw new Error("视频任务终止状态尚未落盘");
                            }
                        });
                    } catch {
                        // Removing the pending record is an equally terminal
                        // fallback if updating its status remains unavailable.
                        await retryVideoLogStorage(() => logStore.removeItem(run.jobId));
                    }
                } finally {
                    // The journal intentionally remains. It is tiny, and keeping
                    // it prevents an old pending record from ever reviving after
                    // a later renderer or full application restart.
                    // Native writes may succeed even if their acknowledgement
                    // is interrupted. Invalidate every in-flight read either way.
                    videoGenerationLogRevision.bump();
                }
            })
            .catch(() => undefined);
    };

    const cancelActiveRuns = (reason: string) => {
        contextVersionRef.current += 1;
        const pendingIntent = pendingAgentGenerationRef.current;
        pendingAgentGenerationRef.current = null;
        if (pendingIntent?.taskId) updateAgentTask(pendingIntent.taskId, { status: "failed", successCount: 0, failCount: 1, error: reason });
        const cancelled = runRegistry.cancelForeground();
        for (const run of cancelled) {
            if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: reason });
            terminalizeCancelledRun(run, reason);
        }
        setRunning(false);
        setStartedAt(0);
        return cancelled;
    };

    const generate = async (agentTaskId?: string, retryLog?: GenerationLog, preserveResults = false) => {
        const snapshot = buildRequestSnapshot();
        if (!snapshot) {
            if (agentTaskId) updateAgentTask(agentTaskId, { status: "failed", error: "视频生成参数无效" });
            return;
        }
        cancelActiveRuns("已由新的视频任务替换");

        if (retryLog) {
            if (retryLog.deletedAt || !videoGenerationLogVisibility.revive(retryLog.id)) {
                message.error("这条记录已删除，无法重试");
                return;
            }
            removeSynchronousCancellationJournal(retryLog.id);
            try {
                await retryVideoLogStorage(() => cancelledJobStore.removeItem(retryLog.id));
            } catch {
                message.error("无法恢复这条视频任务，请稍后重试");
                return;
            }
        }

        const jobId = retryLog?.id || nanoid();
        const run = runRegistry.start({ runId: nanoid(), jobId, mode: "foreground", agentTaskId });
        if (!run) return;
        if (retryLog) videoRetrySnapshots.set(run.runId, retryLog);
        setElapsedMs(0);
        setRunning(true);
        if (agentTaskId) updateAgentTask(agentTaskId, { status: "running", error: undefined });
        setPreviewLog(retryLog || null);
        setResults((current) => (preserveResults ? [...current, { id: jobId, status: "pending" as const }] : [{ id: jobId, status: "pending" as const }]));
        const batchStartedAt = performance.now();
        setStartedAt(batchStartedAt);
        let handedOffToPolling = false;
        try {
            const task = await createVideoGenerationTask(snapshot.config, snapshot.text, snapshot.references, snapshot.videoReferences, snapshot.audioReferences, { signal: run.controller.signal });
            if (!runRegistry.isForeground(run)) return;
            const taskModel = snapshot.config.videoModel || snapshot.config.model || model;
            const log = buildLog({
                id: jobId,
                runId: run.runId,
                prompt: snapshot.text,
                model: taskModel,
                config: snapshot.config,
                references: snapshot.references,
                videoReferences: snapshot.videoReferences,
                audioReferences: snapshot.audioReferences,
                durationMs: 0,
                status: "生成中",
                task,
            });
            const pendingLogOutcome = retryLog ? await saveRetriedLogForRun(run, retryLog, log) : await saveLogForRun(run, log);
            if (pendingLogOutcome.status !== "committed") {
                if (pendingLogOutcome.error && runRegistry.isForeground(run)) throw pendingLogOutcome.error;
                return;
            }
            if (!runRegistry.isForeground(run)) return;
            setPreviewLog(log);
            handedOffToPolling = true;
            void pollGenerationLog(log, snapshot.config, agentTaskId, run, "foreground", retryLog);
        } catch (error) {
            if (!runRegistry.isForeground(run) || run.controller.signal.aborted) return;
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const failedLog = buildLog({
                id: jobId,
                runId: run.runId,
                prompt: snapshot.text,
                model: snapshot.config.videoModel || snapshot.config.model || model,
                config: snapshot.config,
                references: snapshot.references,
                videoReferences: snapshot.videoReferences,
                audioReferences: snapshot.audioReferences,
                durationMs: performance.now() - batchStartedAt,
                status: "失败",
                error: errorMessage,
            });
            const saveOutcome = retryLog ? await saveRetriedLogForRun(run, retryLog, failedLog) : await saveLogForRun(run, failedLog);
            if (saveOutcome.status === "committed") setPreviewLog(failedLog);
            runRegistry.runIfForeground(run, () => {
                setResults((current) => {
                    const next = { id: jobId, status: "failed" as const, error: errorMessage };
                    return current.some((item) => item.id === jobId) ? current.map((item) => (item.id === jobId ? next : item)) : [next];
                });
                if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
                message.error(errorMessage);
            });
        } finally {
            if (!handedOffToPolling) videoRetrySnapshots.delete(run.runId);
            if (!handedOffToPolling && runRegistry.isForeground(run)) {
                runRegistry.finish(run);
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    // 响应 Agent 面板下发的视频命令：填入提示词，并按需自动触发生成。
    useEffect(() => {
        if (!videoCommand || videoCommand.nonce === processedCommandRef.current) return;
        processedCommandRef.current = videoCommand.nonce;
        clearVideoCommand();
        if (typeof videoCommand.prompt === "string") setPrompt(videoCommand.prompt);
        if (videoCommand.run && running) {
            if (videoCommand.taskId) updateAgentTask(videoCommand.taskId, { status: "failed", error: "视频工作台已有任务正在运行" });
            return;
        }
        if (videoCommand.run) {
            const previousIntent = pendingAgentGenerationRef.current;
            if (previousIntent?.taskId && previousIntent.taskId !== videoCommand.taskId) {
                updateAgentTask(previousIntent.taskId, { status: "failed", successCount: 0, failCount: 1, error: "已被新的视频任务替代" });
            }
            const intent = { id: nanoid(), taskId: videoCommand.taskId };
            pendingAgentGenerationRef.current = intent;
            setAutoRunIntentId(intent.id);
        }
    }, [videoCommand, clearVideoCommand, running, updateAgentTask]);

    useEffect(() => {
        if (!autoRunIntentId) return;
        const intent = consumePendingVideoGenerationIntent(pendingAgentGenerationRef.current, autoRunIntentId);
        if (!intent) return;
        pendingAgentGenerationRef.current = null;
        void generate(intent.taskId);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoRunIntentId]);

    const buildRequestSnapshot = () => {
        const text = prompt.trim();
        if (!text && !(isMiniMaxHailuo && references.length === 1)) {
            message.error("请输入视频提示词");
            return null;
        }
        if (isMiniMaxHailuo && text.length > 2000) {
            message.error("MiniMax Hailuo 视频提示词不能超过 2000 个字符");
            return null;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成配置");
            openConfigDialog(true);
            return null;
        }
        const activeVideoReferences = supportsVideoReferences ? videoReferences : [];
        const activeAudioReferences = supportsAudioReferences ? audioReferences : [];
        const videoReferenceError = isMiniMaxH3 ? miniMaxVideoReferenceError(activeVideoReferences) : isSeedance25 ? "" : seedanceVideoReferenceError(activeVideoReferences);
        if (videoReferenceError) {
            message.error(isMiniMaxH3 || isSeedance25 ? videoReferenceError : `${videoReferenceError}。${seedanceVideoReferenceHint}`);
            return null;
        }
        const audioReferenceError = isMiniMaxH3 ? miniMaxAudioReferenceError(activeAudioReferences) : "";
        if (audioReferenceError) {
            message.error(audioReferenceError);
            return null;
        }
        const activeReferences = [...references].slice(0, maxImageReferences);
        if (isSeedance25) {
            const referenceError = seedance25MultimodalReferenceError(seedance25TaskMode, activeReferences, activeVideoReferences, activeAudioReferences);
            if (referenceError) {
                message.error(referenceError);
                return null;
            }
        }
        if (isMiniMaxH3) {
            const referenceError = miniMaxH3ReferenceError(activeReferences, activeVideoReferences, activeAudioReferences);
            if (referenceError) {
                message.error(referenceError);
                return null;
            }
        }
        if (isMiniMaxHailuo) {
            const referenceError = miniMaxHailuoReferenceError(modelOptionName(model), activeReferences, activeVideoReferences, activeAudioReferences);
            if (referenceError) {
                message.error(referenceError);
                return null;
            }
        }
        const referenceCounts = { images: activeReferences.length, videos: activeVideoReferences.length, audios: activeAudioReferences.length };
        if (isSeedance25) {
            const modeError = seedance25InputModeError(seedance25TaskMode, seedance25InputMode, referenceCounts);
            if (modeError) {
                message.error(modeError);
                return null;
            }
            const hasReferences = referenceCounts.images + referenceCounts.videos + referenceCounts.audios > 0;
            if (hasReferences && selectedVideoConfig.seedance25WebSearch === "true") {
                message.error("联网搜索只能用于纯文字生成，请先移除参考素材");
                return null;
            }
            if (hasReferences && selectedVideoConfig.seedance25CameraFixed === "true") {
                message.error("固定机位只能用于纯文字生成，请先移除参考素材");
                return null;
            }
        }
        if (isMiniMaxH3) {
            const modeError = miniMaxVideoInputModeError(normalizeMiniMaxVideoInputMode(selectedVideoConfig.minimaxVideoInputMode), referenceCounts);
            if (modeError) {
                message.error(`${modeError}，请调整素材或切换模式`);
                return null;
            }
        }
        return { text, config: buildVideoConfig(selectedVideoConfig, model, referenceCounts), references: activeReferences, videoReferences: [...activeVideoReferences], audioReferences: [...activeAudioReferences] };
    };

    const retryResult = (resultId?: string) => {
        const failedLog = previewLog?.status === "失败" && (!resultId || previewLog.id === resultId) ? previewLog : logs.find((log) => log.id === resultId && log.status === "失败");
        if (!failedLog) {
            message.error("找不到原生成记录，请从左侧记录重新打开");
            return;
        }
        void generate(undefined, failedLog);
    };

    const downloadVideo = async (video: GeneratedVideo) => {
        const extension = video.mimeType === "video/webm" ? "webm" : video.mimeType === "video/quicktime" ? "mov" : "mp4";
        const filename = `WorkflowGenerator-video.${extension}`;
        try {
            if (isDesktopApp() && video.storageKey) {
                const exportedName = await exportDesktopMedia("media", video.storageKey, filename);
                message.success(`已下载：${exportedName || filename}`);
                return;
            }
            const blob = video.storageKey ? await getMediaBlob(video.storageKey) : await (await fetch(video.url)).blob();
            if (!blob) throw new Error("找不到视频文件");
            saveAs(blob, filename);
        } catch (error) {
            message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
        }
    };

    const saveResultToAssets = async (video: GeneratedVideo) => {
        try {
            await addAssetPersisted({
                kind: "video",
                title: "生成视频",
                coverUrl: "",
                tags: [],
                source: "视频创作台",
                data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                metadata: { source: "video-page", prompt },
            });
            message.success("已保存到我的资产");
        } catch (error) {
            message.error(error instanceof Error ? `保存资产失败：${error.message}` : "保存资产失败，请重试");
        }
    };

    const extendGeneratedVideo = (video: GeneratedVideo) => {
        const url = normalizeSeedance25RemoteVideoUrl(video.remoteUrl || "");
        if (!url) {
            message.warning("这个旧结果没有仍可用的官方视频地址，请改用公网 URL 或方舟素材 ID");
            return;
        }
        setVideoReferences([{ id: nanoid(), name: "上一段生成结果", type: video.mimeType === "video/quicktime" ? "video/quicktime" : "video/mp4", url, durationMs: video.durationMs }]);
        setPrompt("自然延续上一段的动作与镜头，保持人物、环境、光线和声音连贯。");
        updateConfig("seedance25TaskMode", "extend");
        updateConfig("seedance25Continuation", "natural");
        updateConfig("videoSeconds", "10");
        updateConfig("size", "adaptive");
    };

    const useGeneratedLastFrame = (video: GeneratedVideo) => {
        if (!video.lastFrame) {
            message.warning("这个结果没有可复用的尾帧");
            return;
        }
        const image: ReferenceImage = {
            id: nanoid(),
            name: "上一段视频尾帧",
            type: video.lastFrame.mimeType,
            dataUrl: video.lastFrame.url,
            url: video.lastFrame.url,
            storageKey: video.lastFrame.storageKey,
            bytes: video.lastFrame.bytes,
            width: video.lastFrame.width,
            height: video.lastFrame.height,
        };
        setReferences([image]);
        setVideoReferences([]);
        setAudioReferences([]);
        setPrompt("从首帧自然延续动作与镜头，保持人物、环境、光线和声音连贯。");
        updateConfig("seedance25TaskMode", "generate");
        updateConfig("seedance25InputMode", "first-frame");
        updateConfig("seedance25WebSearch", "false");
        updateConfig("seedance25CameraFixed", "false");
        updateConfig("size", "adaptive");
        message.success("已将尾帧设为新视频的首帧");
    };

    const deleteFailedResult = (logId: string) => {
        const failedLog = previewLog?.id === logId ? previewLog : logs.find((log) => log.id === logId);
        if (!failedLog || failedLog.status !== "失败") return;
        videoGenerationLogVisibility.hide(logId);
        writeSynchronousCancellationJournal(logId, { reason: "视频生成失败结果已删除", hidden: true, createdAt: Date.now() });
        runRegistry.retireJob(logId).forEach((run) => videoRetrySnapshots.delete(run.runId));
        setResults((value) => value.filter((item) => item.id !== logId));
        setLogs((value) => value.filter((log) => log.id !== logId));
        setPreviewLog((value) => (value?.id === logId ? null : value));
        videoGenerationLogRevision.bump();
        void (async () => {
            const removed = await removeDeletedLog(logId);
            if (removed) message.success("已删除失败结果");
            else message.error("删除失败结果失败，请重试");
            await refreshLogs();
        })();
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
        } else if (payload.kind === "image") {
            if (videoExperience === "grok-video" && videoReferences.length) {
                message.warning("Grok 每次只能使用参考图或参考视频，请先移除参考视频");
                return;
            }
            if (isMiniMaxH3 || isMiniMaxHailuo) {
                const sourceMime = payload.mimeType || payload.dataUrl.match(/^data:([^;,]+)/i)?.[1] || "";
                if (sourceMime && !isMiniMaxH3ImageMime(sourceMime)) {
                    message.warning(`${isMiniMaxHailuo ? "MiniMax Hailuo" : "MiniMax H3"} 仅接受 JPEG、PNG 或 WebP 图片`);
                    return;
                }
                if (isMiniMaxHailuo && typeof payload.bytes === "number" && payload.bytes >= MINIMAX_HAILUO_IMAGE_MAX_BYTES) {
                    message.warning("Hailuo 首帧图片需要小于 20MB");
                    return;
                }
            }
            const stored = await uploadImage(payload.dataUrl);
            const reference = { id: nanoid(), name: payload.title, type: stored.mimeType, dataUrl: stored.url, storageKey: stored.storageKey, bytes: stored.bytes, width: stored.width, height: stored.height };
            if (isMiniMaxH3) {
                const error = miniMaxH3ReferenceError([...references, reference], videoReferences, audioReferences);
                if (error) {
                    discardUploadedImage(stored);
                    message.warning(error);
                    return;
                }
            }
            if (isMiniMaxHailuo) {
                const error = miniMaxHailuoReferenceError(modelOptionName(model), [...references, reference], [], []);
                if (error) {
                    discardUploadedImage(stored);
                    message.warning(error);
                    return;
                }
            }
            publishUploadedImage(stored);
            setReferences((value) => [...value, reference].slice(0, maxImageReferences));
            if (isSeedance25) {
                updateConfig("seedance25WebSearch", "false");
                updateConfig("seedance25CameraFixed", "false");
            }
        } else if (payload.kind === "video") {
            if (!supportsVideoReferences) {
                message.warning(isSeedance25 && seedance25FrameMode ? "当前画面模式只使用图片，不能添加参考视频" : "当前模型不支持参考视频");
                return;
            }
            if (isSeedance25 && !normalizeSeedance25RemoteVideoUrl(payload.url)) {
                message.warning("Seedance 2.5 参考视频需要公网 URL 或方舟素材 ID，请使用参考素材区的链接输入框");
                return;
            }
            if (videoExperience === "grok-video" && references.length) {
                message.warning("Grok 每次只能使用参考图或参考视频，请先移除参考图");
                return;
            }
            const reference = { id: nanoid(), name: payload.title, type: payload.mimeType || "video/mp4", url: payload.url, storageKey: payload.storageKey, width: payload.width, height: payload.height, bytes: payload.bytes };
            if (isMiniMaxH3) {
                const error = miniMaxH3ReferenceError(references, [...videoReferences, reference], audioReferences);
                if (error) {
                    message.warning(error);
                    return;
                }
            }
            setVideoReferences((value) => [...value, reference].slice(0, maxVideoReferences));
        } else if (payload.kind === "audio") {
            if (!supportsAudioReferences) {
                message.warning(isSeedance25 && seedance25FrameMode ? "当前画面模式只使用图片，不能添加参考音频" : "当前模型不支持参考音频");
                return;
            }
            const reference = { id: nanoid(), name: payload.title, type: payload.mimeType, url: payload.url, storageKey: payload.storageKey, durationMs: payload.durationMs, bytes: payload.bytes };
            if (isMiniMaxH3) {
                const error = miniMaxH3ReferenceError(references, videoReferences, [...audioReferences, reference]);
                if (error) {
                    message.warning(error);
                    return;
                }
            }
            setAudioReferences((value) => [...value, reference].slice(0, maxAudioReferences));
        }
        setAssetPickerOpen(false);
    };

    const createSession = () => {
        cancelActiveRuns("视频生成已取消");
        setPrompt("");
        setSeedance25VideoUrl("");
        setSeedance25VideoDuration(10);
        setReferences([]);
        setVideoReferences([]);
        setAudioReferences([]);
        setResults([]);
        setElapsedMs(0);
        setStartedAt(0);
        setSelectedLogIds([]);
        setPreviewLog(null);
    };

    const deleteSelectedLogs = () => {
        const idsToDelete = [...selectedLogIds];
        let cancelledForeground = false;
        for (const id of idsToDelete) {
            videoGenerationLogVisibility.hide(id);
            writeSynchronousCancellationJournal(id, { reason: "视频生成记录已删除", hidden: true, createdAt: Date.now() });
            const cancelled = runRegistry.retireJob(id);
            for (const run of cancelled) {
                videoRetrySnapshots.delete(run.runId);
                cancelledForeground ||= run.mode === "foreground";
                if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: "视频生成记录已删除" });
            }
        }
        // Hide deleted rows immediately, including from another mounted page,
        // while durable removal is waiting behind an in-flight writer.
        videoGenerationLogRevision.bump();
        if (cancelledForeground) {
            setRunning(false);
            setStartedAt(0);
            setElapsedMs(0);
            setResults([]);
        }
        const mediaKeys = logs
            .filter((log) => idsToDelete.includes(log.id))
            .map((log) => log.video?.storageKey)
            .filter((key): key is string => Boolean(key));
        const imageKeys = logs
            .filter((log) => idsToDelete.includes(log.id))
            .flatMap((log) => [log.video?.lastFrame?.storageKey])
            .filter((key): key is string => Boolean(key));
        if (previewLog && selectedLogIds.includes(previewLog.id)) {
            setPreviewLog(null);
            setResults([]);
        }
        setSelectedLogIds([]);
        setDeleteConfirmOpen(false);
        void (async () => {
            const removedOwners = [];
            for (const id of idsToDelete) removedOwners.push(await removeDeletedLog(id));
            if (removedOwners.every(Boolean)) {
                await deleteStoredMedia(mediaKeys);
                await deleteStoredImages(imageKeys);
            }
            await refreshLogs();
        })();
    };

    const removeDeletedLog = (logId: string) =>
        videoGenerationLogMutationQueue.run(logId, async () => {
            let durableDeletion = false;
            try {
                await persistCancellationJournal(logId, "视频生成记录已删除", true);
                await retryVideoLogStorage(() => logStore.removeItem(logId));
                durableDeletion = true;
                return true;
            } catch {
                // A failed remove must not leave a resumable task behind. Keep
                // a durable, media-free tombstone which remains invisible after
                // a full application restart.
                try {
                    durableDeletion = await retryVideoLogStorage(async () => {
                        const stored = await logStore.getItem<GenerationLog>(logId);
                        if (!stored) return true;
                        await logStore.setItem(logId, serializeLog(markVideoLogDeleted(stored)));
                        const confirmed = await logStore.getItem<GenerationLog>(logId);
                        if (!confirmed?.deletedAt || confirmed.task || confirmed.video) {
                            throw new Error("视频删除标记尚未落盘");
                        }
                        return true;
                    });
                    return durableDeletion;
                } catch {
                    // Module-lifetime visibility still prevents resurrection
                    // for this process when native storage is unavailable.
                    return false;
                }
            } finally {
                if (durableDeletion) {
                    await retryVideoLogStorage(() => cancelledJobStore.removeItem(logId)).catch(() => undefined);
                    removeSynchronousCancellationJournal(logId);
                }
                videoGenerationLogRevision.bump();
            }
        });

    const saveLogForRun = (run: VideoGenerationRun, log: GenerationLog): Promise<RunLogSaveOutcome> =>
        videoGenerationLogMutationQueue.run(log.id, async () => {
            if (!runRegistry.isActive(run) || runRegistry.isRetired(log.id) || !videoGenerationLogVisibility.canResume(log.id)) return { status: "stale-removed" };
            const nextLog = { ...log, runId: run.runId };
            try {
                await logStore.setItem(nextLog.id, serializeLog(nextLog));
            } catch (error) {
                videoGenerationLogRevision.bump();
                return removeRunLogAfterFailedWrite(nextLog.id, run.runId, error);
            }
            videoGenerationLogRevision.bump();
            if (!runRegistry.isActive(run) || runRegistry.isRetired(nextLog.id) || !videoGenerationLogVisibility.canResume(nextLog.id)) {
                return removeRunLogAfterFailedWrite(nextLog.id, run.runId);
            }
            await refreshLogs(false, run);
            if (runRegistry.isActive(run)) return { status: "committed" };
            return removeRunLogAfterFailedWrite(nextLog.id, run.runId);
        });

    const saveRetriedLogForRun = (run: VideoGenerationRun, previousLog: GenerationLog, log: GenerationLog): Promise<RunLogSaveOutcome> =>
        videoGenerationLogMutationQueue.run(log.id, async () => {
            if (!runRegistry.isActive(run) || runRegistry.isRetired(log.id) || !videoGenerationLogVisibility.canResume(log.id)) return { status: "stale-removed" };
            const nextLog = { ...log, runId: run.runId };
            try {
                await logStore.setItem(nextLog.id, serializeLog(nextLog));
            } catch (error) {
                const stored = await logStore.getItem<GenerationLog>(nextLog.id).catch(() => undefined);
                if (stored?.runId !== run.runId) return { status: "uncertain", error };
            }
            videoGenerationLogRevision.bump();
            if (!runRegistry.isActive(run) || runRegistry.isRetired(nextLog.id) || !videoGenerationLogVisibility.canResume(nextLog.id)) {
                return restoreRetriedLog(previousLog, run.runId);
            }
            await refreshLogs(false, run);
            if (runRegistry.isActive(run)) return { status: "committed" };
            return restoreRetriedLog(previousLog, run.runId);
        });

    const restoreRetriedLog = async (previousLog: GenerationLog, runId: string): Promise<RunLogSaveOutcome> => {
        try {
            const stored = await logStore.getItem<GenerationLog>(previousLog.id);
            if (stored?.runId && stored.runId !== runId) return { status: "uncertain" };
            await logStore.setItem(previousLog.id, serializeLog(previousLog));
            videoGenerationLogRevision.bump();
            if (mountedRef.current) await refreshLogs(false);
            return { status: "stale-removed" };
        } catch (error) {
            videoGenerationLogRevision.bump();
            return { status: "uncertain", error };
        }
    };

    const removeRunLogAfterFailedWrite = async (logId: string, runId: string, originalError?: unknown): Promise<RunLogSaveOutcome> => {
        try {
            const stored = await logStore.getItem<GenerationLog>(logId);
            if (!stored) return { status: "stale-removed", error: originalError };
            if (stored.runId !== runId) return { status: "uncertain", error: originalError };
            try {
                await logStore.removeItem(logId);
                videoGenerationLogRevision.bump();
                if (mountedRef.current) await refreshLogs(false);
                return { status: "stale-removed", error: originalError };
            } catch (removeError) {
                videoGenerationLogRevision.bump();
                // Never leave an old success or pending record behind after its
                // Agent run was cancelled. If removal is unavailable, replace
                // every stale terminal state with a media-free cancellation.
                try {
                    await logStore.setItem(
                        logId,
                        serializeLog({
                            ...markStaleVideoLogCancelled(stored),
                            durationMs: Date.now() - stored.createdAt,
                        }),
                    );
                    videoGenerationLogRevision.bump();
                    if (mountedRef.current) await refreshLogs(false);
                    return { status: "stale-removed", error: originalError || removeError };
                } catch {
                    videoGenerationLogRevision.bump();
                    // Both reconciliation paths failed. The old record may
                    // still reference its upload, so callers must retain it.
                    return { status: "uncertain", error: originalError || removeError };
                }
            }
        } catch (readError) {
            return { status: "uncertain", error: originalError || readError };
        }
    };

    const refreshLogs = async (resumePending = true, guardRun?: VideoGenerationRun): Promise<GenerationLog[]> => {
        const contextVersion = contextVersionRef.current;
        const requestId = ++refreshRequestRef.current;
        const repositoryRevision = videoGenerationLogRevision.snapshot();
        const nextLogs = await readStoredLogs();
        if (!mountedRef.current || contextVersion !== contextVersionRef.current || requestId !== refreshRequestRef.current || (guardRun && !runRegistry.isActive(guardRun))) return nextLogs;
        if (!videoGenerationLogRevision.isCurrent(repositoryRevision)) return refreshLogs(resumePending, guardRun);
        setLogs(nextLogs);
        if (resumePending) resumePendingLogs(nextLogs);
        return nextLogs;
    };

    const resumePendingLogs = (items: GenerationLog[]) => {
        for (const log of items) {
            if (log.status === "生成中" && log.task && videoGenerationLogVisibility.canResume(log.id)) void pollGenerationLog(log, undefined, undefined, undefined, "background");
        }
    };

    const pollGenerationLog = async (log: GenerationLog, configOverride?: AiConfig, agentTaskId?: string, existingRun?: VideoGenerationRun, mode: VideoGenerationRunMode = "foreground", retryPreviousLog?: GenerationLog) => {
        if (!log.task || !videoGenerationLogVisibility.canResume(log.id)) return;
        const run = existingRun || runRegistry.start({ runId: nanoid(), jobId: log.id, mode, agentTaskId });
        if (!run || !runRegistry.isActive(run)) return;
        if (runRegistry.isForeground(run)) {
            setRunning(true);
            setStartedAt((value) => value || performance.now());
            setResults((value) => (value.length ? value : [{ id: log.id, status: "pending" }]));
        }
        const isMiniMaxNative = log.task.provider === "minimax";
        const { maxAttempts, delayMs: pollDelayMs } = videoGenerationPollingPolicy(log.task);
        try {
            const taskConfig = buildVideoConfig({ ...effectiveConfig, ...log.config }, log.task.model || log.model);
            for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
                const state = await pollVideoGenerationTask(configOverride || taskConfig, log.task, { signal: run.controller.signal });
                if (!runRegistry.isActive(run)) return;
                if (state.status === "completed") {
                    const stored = await storeGeneratedVideo(state.result);
                    let lastFrame: UploadedImage | undefined;
                    try {
                        lastFrame = state.result.lastFrameUrl ? await uploadImage(state.result.lastFrameUrl) : undefined;
                    } catch (error) {
                        await discardUploadedMedia(stored);
                        throw error;
                    }
                    if (!runRegistry.isActive(run)) {
                        await discardUploadedMedia(stored);
                        if (lastFrame) await discardUploadedImage(lastFrame);
                        return;
                    }
                    const nextVideo: GeneratedVideo = {
                        id: nanoid(),
                        url: stored.url,
                        storageKey: stored.storageKey,
                        durationMs: stored.durationMs || 0,
                        width: stored.width || 1280,
                        height: stored.height || 720,
                        bytes: stored.bytes,
                        mimeType: stored.mimeType,
                        remoteUrl: state.result.url,
                        lastFrame,
                        remoteLastFrameUrl: state.result.lastFrameUrl,
                    };
                    const completedLog = { ...log, runId: run.runId, status: "成功" as const, durationMs: Date.now() - log.createdAt, video: nextVideo, error: undefined };
                    const logOutcome = retryPreviousLog ? await saveRetriedLogForRun(run, retryPreviousLog, completedLog) : await saveLogForRun(run, completedLog);
                    if (shouldRetainUploadedVideo(logOutcome.status)) {
                        publishUploadedMedia(stored);
                        if (lastFrame) publishUploadedImage(lastFrame);
                    } else {
                        await discardUploadedMedia(stored);
                        if (lastFrame) await discardUploadedImage(lastFrame);
                    }
                    if (logOutcome.status !== "committed") {
                        if (logOutcome.error && runRegistry.isActive(run)) throw logOutcome.error;
                        return;
                    }
                    if (!runRegistry.isActive(run)) return;
                    runRegistry.runIfForeground(run, () => {
                        setResults((current) => {
                            const next = { id: run.jobId, status: "success" as const, video: nextVideo };
                            return current.some((item) => item.id === run.jobId) ? current.map((item) => (item.id === run.jobId ? next : item)) : [next];
                        });
                        setPreviewLog(completedLog);
                        if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "succeeded", successCount: 1, failCount: 0, error: undefined });
                        message.success(lastFrame ? "视频与尾帧已生成" : "视频已生成");
                    });
                    return;
                }
                if (state.status === "failed") throw new Error(state.error);
                if (attempt === maxAttempts - 1) {
                    if (isMiniMaxNative) {
                        const pendingMessage = "云端任务仍在处理中，可从生成记录继续查询";
                        const pendingLog = { ...log, runId: run.runId, status: "生成中" as const, durationMs: Date.now() - log.createdAt, task: log.task, video: undefined, error: pendingMessage };
                        const logOutcome = retryPreviousLog ? await saveRetriedLogForRun(run, retryPreviousLog, pendingLog) : await saveLogForRun(run, pendingLog);
                        if (logOutcome.status !== "committed") {
                            if (logOutcome.error && runRegistry.isActive(run)) throw logOutcome.error;
                            return;
                        }
                        runRegistry.runIfForeground(run, () => {
                            setPreviewLog(pendingLog);
                            if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "running", error: pendingMessage });
                            message.warning(pendingMessage);
                        });
                        return;
                    }
                    throw new Error("视频生成超时，请稍后重试");
                }
                await delay(pollDelayMs, run.controller.signal);
            }
        } catch (error) {
            if (!runRegistry.isActive(run) || run.controller.signal.aborted) return;
            const errorMessage = error instanceof Error ? error.message : "生成失败";
            const failedLog = { ...log, runId: run.runId, status: "失败" as const, durationMs: Date.now() - log.createdAt, task: undefined, video: undefined, error: errorMessage };
            if (retryPreviousLog) await saveRetriedLogForRun(run, retryPreviousLog, failedLog);
            else await saveLogForRun(run, failedLog);
            runRegistry.runIfForeground(run, () => {
                setResults((current) => {
                    const next = { id: log.id, status: "failed" as const, error: errorMessage };
                    return current.some((item) => item.id === log.id) ? current.map((item) => (item.id === log.id ? next : item)) : [next];
                });
                setPreviewLog(failedLog);
                if (run.agentTaskId) updateAgentTask(run.agentTaskId, { status: "failed", successCount: 0, failCount: 1, error: errorMessage });
                message.error(errorMessage);
            });
        } finally {
            videoRetrySnapshots.delete(run.runId);
            const ownsForeground = runRegistry.isForeground(run);
            runRegistry.finish(run);
            if (ownsForeground && mountedRef.current) {
                setRunning(false);
                setStartedAt(0);
            }
        }
    };

    const previewGenerationLog = (log: GenerationLog) => {
        const alreadyForeground = runRegistry.foregroundJobId() === log.id;
        if (!alreadyForeground) cancelActiveRuns("已切换到其他视频记录");
        setPreviewLog(log);
        setLogsOpen(false);
        setPrompt(log.prompt);
        setReferences(log.references || []);
        setVideoReferences(log.videoReferences || []);
        setAudioReferences(log.audioReferences || []);
        const restoredVideoModel = log.config.videoModel || log.model;
        if (restoredVideoModel) {
            try {
                resolveModelRequestConfig(effectiveConfig, restoredVideoModel);
                updateConfig("videoModel", restoredVideoModel);
            } catch (error) {
                message.warning(error instanceof Error ? error.message : "原视频渠道已不可用，请重新选择模型");
            }
        }
        if (log.config.size) updateConfig("size", log.config.size);
        if (log.config.vquality) updateConfig("vquality", log.config.vquality);
        if (log.config.videoSeconds) updateConfig("videoSeconds", log.config.videoSeconds);
        if (log.config.videoGenerateAudio) updateConfig("videoGenerateAudio", log.config.videoGenerateAudio);
        if (log.config.videoWatermark) updateConfig("videoWatermark", log.config.videoWatermark);
        if (log.config.seedance25TaskMode) updateConfig("seedance25TaskMode", log.config.seedance25TaskMode);
        if (log.config.seedance25Continuation) updateConfig("seedance25Continuation", log.config.seedance25Continuation);
        if (log.config.seedance25OutputFormat) updateConfig("seedance25OutputFormat", log.config.seedance25OutputFormat);
        if (log.config.seedance25InputMode) updateConfig("seedance25InputMode", log.config.seedance25InputMode);
        if (log.config.seedance25Seed) updateConfig("seedance25Seed", log.config.seedance25Seed);
        if (log.config.seedance25ReturnLastFrame) updateConfig("seedance25ReturnLastFrame", log.config.seedance25ReturnLastFrame);
        if (log.config.seedance25WebSearch) updateConfig("seedance25WebSearch", log.config.seedance25WebSearch);
        if (log.config.seedance25CameraFixed) updateConfig("seedance25CameraFixed", log.config.seedance25CameraFixed);
        if (log.config.minimaxVideoInputMode) updateConfig("minimaxVideoInputMode", log.config.minimaxVideoInputMode);
        if (log.config.minimaxVideoPromptOptimizer) updateConfig("minimaxVideoPromptOptimizer", log.config.minimaxVideoPromptOptimizer);
        if (log.config.minimaxVideoFastPretreatment) updateConfig("minimaxVideoFastPretreatment", log.config.minimaxVideoFastPretreatment);
        setResults(log.status === "生成中" ? [{ id: log.id, status: "pending" }] : log.video ? [{ id: log.video.id, status: "success", video: log.video }] : [{ id: log.id, status: "failed", error: log.error || "生成失败" }]);
        if (log.status === "生成中" && log.task && !alreadyForeground) {
            // Promote a restored background poll without semantically
            // cancelling its durable task.
            runRegistry.cancelJob(log.id);
            void pollGenerationLog(log, undefined, undefined, undefined, "foreground");
        }
    };

    return (
        <div className="wg-media-workbench">
            <MediaWorkbenchHeader kind="video" title="视频创作" onOpenHistory={() => setLogsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />

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
                            onPreviewLog={previewGenerationLog}
                        />
                    </div>
                </aside>

                <section className="wg-media-workbench-pane wg-media-workbench-creation">
                    <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
                        <div className="wg-media-workbench-result-stage">
                            <div className="wg-media-section-heading">
                                <div>
                                    <h2>生成结果</h2>
                                    <p>{results.length ? "当前视频" : "结果会显示在这里"}</p>
                                </div>
                                {running ? <Tag className="m-0 border-0 bg-[color:var(--wg-studio-accent-soft)] px-2.5 py-1 text-[color:var(--wg-studio-accent-strong)]">生成中 · {formatDuration(elapsedMs)}</Tag> : null}
                            </div>
                            <VideoResultStage
                                results={results}
                                running={running}
                                onDownload={downloadVideo}
                                onSaveAsset={saveResultToAssets}
                                onRetry={retryResult}
                                onRegenerate={() => void generate(undefined, undefined, true)}
                                onExtend={isSeedance25 ? extendGeneratedVideo : undefined}
                                onUseLastFrame={isSeedance25 ? useGeneratedLastFrame : undefined}
                                onDeleteFailure={deleteFailedResult}
                            />
                        </div>

                        <div className="wg-media-composer">
                            <div className="wg-media-composer-heading">
                                <div>
                                    <h2>描述你想生成的视频</h2>
                                    <p>写清主体动作、镜头运动、场景和氛围</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                        提示词库
                                    </Button>
                                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                        我的资产
                                    </Button>
                                </div>
                            </div>
                            <Input.TextArea
                                className="wg-media-prompt-input"
                                value={prompt}
                                onChange={(event) => setPrompt(event.target.value)}
                                autoSize={{ minRows: 3, maxRows: 7 }}
                                maxLength={isMiniMaxHailuo ? 2000 : undefined}
                                showCount={isMiniMaxHailuo}
                                placeholder={isMiniMaxHailuo && references.length ? "可选：描述首帧之后的动作、镜头和氛围…" : "例如：镜头缓慢推近，登山者站在雪峰前，云海流动，晨光照亮山脊…"}
                            />

                            <div className="wg-media-reference-heading">
                                <div>
                                    <span>{isSeedance25 ? seedance25ReferenceTitle : videoExperience === "agnes-video" || isMiniMaxHailuo ? "首帧图片" : videoExperience === "grok-video" ? "参考图或视频" : videoExperience === "seedance-video" || isMiniMaxH3 ? "参考素材" : "参考图"}</span>
                                    <small>
                                        {isSeedance25
                                            ? seedance25ReferenceDescription
                                            : videoExperience === "seedance-video"
                                              ? "可添加图片、视频与音频"
                                            : isMiniMaxH3
                                              ? "1 张图作为首帧，2 张图作为首尾帧；更多图片或视频、音频作为参考"
                                              : isMiniMaxHailuo
                                                ? isMiniMaxHailuoFast
                                                    ? "Fast 模型需要一张首帧图片"
                                                    : "可选；不添加时使用文字生成"
                                                : videoExperience === "grok-video"
                                                  ? "图片用于引导，或添加一段参考视频"
                                                  : videoExperience === "agnes-video"
                                                    ? "添加一张图片，让画面从这里开始运动"
                                                    : "用于确定画面主体和首帧"}
                                    </small>
                                </div>
                                <div className="flex gap-2">
                                    <Button size="small" icon={<ClipboardPaste className="size-3.5" />} onClick={() => void addReferencesFromClipboard()}>
                                        剪切板
                                    </Button>
                                    <Button size="small" icon={<Upload className="size-3.5" />} onClick={() => fileInputRef.current?.click()}>
                                        {isSeedance25 && seedance25FrameMode ? "添加图片" : "添加素材"}
                                    </Button>
                                </div>
                            </div>
                            {isSeedance25 && !seedance25FrameMode ? (
                                <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_112px]">
                                    <Input.Search
                                        value={seedance25VideoUrl}
                                        onChange={(event) => setSeedance25VideoUrl(event.target.value)}
                                        onSearch={addSeedance25RemoteVideo}
                                        enterButton="添加视频"
                                        placeholder="粘贴 https:// 公网视频 URL 或 asset:// 方舟素材 ID"
                                        aria-label="Seedance 2.5 参考视频地址"
                                    />
                                    <Input
                                        type="number"
                                        min={seedance25TaskMode === "edit" ? 4 : 2}
                                        max={30}
                                        suffix="秒"
                                        value={seedance25VideoDuration}
                                        onChange={(event) => setSeedance25VideoDuration(Number(event.target.value))}
                                        aria-label="参考视频时长"
                                    />
                                </div>
                            ) : null}
                            <div
                                className={referenceDragTarget ? "wg-media-reference-strip is-dragging" : "wg-media-reference-strip"}
                                onDragEnter={(event) => handleReferenceDragEnter(event, "image")}
                                onDragOver={(event) => {
                                    event.preventDefault();
                                    event.dataTransfer.dropEffect = "copy";
                                }}
                                onDragLeave={handleReferenceDragLeave}
                                onDrop={handleReferenceDrop}
                            >
                                {references.slice(0, maxImageReferences).map((item, index) => (
                                    <div key={item.id} className="wg-media-reference-tile">
                                        <img src={item.dataUrl} alt={item.name} className="size-full object-cover" />
                                        <span className="wg-media-reference-index">
                                            {isSeedance25 && seedance25InputMode === "first-frame"
                                                ? "首帧"
                                                : isSeedance25 && seedance25InputMode === "first-last"
                                                  ? index === 0
                                                      ? "首帧"
                                                      : "尾帧"
                                                  : isMiniMaxHailuo
                                                    ? "首帧"
                                                    : isMiniMaxH3 && !videoReferences.length && !audioReferences.length && references.length <= 2
                                                      ? index === 0
                                                          ? "首帧"
                                                          : "尾帧"
                                                      : seedanceReferenceLabel("image", index)}
                                        </span>
                                        <ReferenceOrderButtons label="参考图" index={index} total={references.length} onMove={(offset) => setReferences((value) => moveListItem(value, index, offset))} />
                                        <button type="button" className="wg-media-reference-remove" onClick={() => setReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考图">
                                            <Trash2 className="size-3.5" />
                                        </button>
                                    </div>
                                ))}
                                {supportsVideoReferences
                                    ? videoReferences.map((item, index) => (
                                          <div key={item.id} className="wg-media-reference-tile is-video">
                                              <video src={item.url} muted preload="metadata" />
                                              <span className="wg-media-reference-index">{seedanceReferenceLabel("video", index)}</span>
                                              <ReferenceOrderButtons label="参考视频" index={index} total={videoReferences.length} onMove={(offset) => setVideoReferences((value) => moveListItem(value, index, offset))} />
                                              <button type="button" className="wg-media-reference-remove" onClick={() => setVideoReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考视频">
                                                  <Trash2 className="size-3.5" />
                                              </button>
                                          </div>
                                      ))
                                    : null}
                                {supportsAudioReferences
                                    ? audioReferences.map((item, index) => (
                                          <div key={item.id} className="wg-media-reference-tile is-audio">
                                              <Music2 className="size-5" />
                                              <span className="max-w-28 truncate text-[11px]">{item.name}</span>
                                              <span className="wg-media-reference-index">{seedanceReferenceLabel("audio", index)}</span>
                                              <ReferenceOrderButtons label="参考音频" index={index} total={audioReferences.length} onMove={(offset) => setAudioReferences((value) => moveListItem(value, index, offset))} />
                                              <button type="button" className="wg-media-reference-remove" onClick={() => setAudioReferences((value) => value.filter((ref) => ref.id !== item.id))} aria-label="移除参考音频">
                                                  <Trash2 className="size-3.5" />
                                              </button>
                                          </div>
                                      ))
                                    : null}
                                {!references.length && (!supportsVideoReferences || !videoReferences.length) && (!supportsAudioReferences || !audioReferences.length) ? (
                                    <button type="button" className="wg-media-reference-empty" onClick={() => fileInputRef.current?.click()}>
                                        <ImagePlus className="size-5" />
                                        <span>{isSeedance25 ? seedance25ReferenceEmptyText : referenceDragTarget ? (isMiniMaxHailuo ? "松开即可添加首帧图片" : "松开即可添加参考素材") : isMiniMaxHailuo ? "拖入图片，或点此添加首帧" : "拖入文件，或点此添加参考素材"}</span>
                                    </button>
                                ) : null}
                            </div>
                        </div>
                    </div>
                    <div className="wg-media-mobile-cta">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                            {generationActionLabel} · {seedance25TaskMode === "edit" && isSeedance25 ? "跟随原片" : generationDurationLabel}
                        </Button>
                    </div>
                </section>

                <aside className="wg-media-workbench-pane wg-media-workbench-inspector">
                    <div className="wg-media-inspector-heading">
                        <div>
                            <h2>模型与参数</h2>
                            <p>参数会随模型自动调整</p>
                        </div>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <div className="grid grid-cols-2 gap-4">
                            <GenerationSettings
                                config={selectedVideoConfig}
                                model={model}
                                updateConfig={updateConfig}
                                openConfigDialog={openConfigDialog}
                                referenceCounts={{ images: references.length, videos: videoReferences.length, audios: audioReferences.length }}
                            />
                        </div>
                    </div>
                    <div className="wg-media-generate-footer">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                            {generationActionLabel} · {seedance25TaskMode === "edit" && isSeedance25 ? "跟随原片" : generationDurationLabel}
                        </Button>
                    </div>
                </aside>
            </main>

            <input
                ref={fileInputRef}
                type="file"
                accept={isMiniMaxHailuo ? "image/jpeg,image/png,image/webp" : isSeedance25 ? (seedance25FrameMode ? "image/*" : "image/*,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav") : supportsAudioReferences ? "image/*,video/mp4,video/quicktime,audio/mpeg,audio/wav,audio/x-wav,.mp3,.wav" : supportsVideoReferences ? "image/*,video/mp4,video/quicktime" : "image/*"}
                multiple={maxImageReferences > 1 || supportsVideoReferences || supportsAudioReferences}
                className="hidden"
                onChange={(event) => {
                    void addReferences(event.target.files);
                    event.target.value = "";
                }}
            />
            <Drawer rootClassName="wg-media-workbench-drawer" title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <LogPanel
                    logs={logs}
                    selectedLogIds={selectedLogIds}
                    activeLogId={previewLog?.id}
                    onSelectedLogIdsChange={setSelectedLogIds}
                    onCreateSession={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onPreviewLog={previewGenerationLog}
                />
            </Drawer>
            <Drawer rootClassName="wg-media-workbench-drawer" title="模型与参数" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-4 pb-24">
                    <GenerationSettings
                        config={selectedVideoConfig}
                        model={model}
                        updateConfig={updateConfig}
                        openConfigDialog={openConfigDialog}
                        referenceCounts={{ images: references.length, videos: videoReferences.length, audios: audioReferences.length }}
                    />
                </div>
                <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                    <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canGenerate || running} onClick={() => void generate()}>
                        {generationActionLabel} · {seedance25TaskMode === "edit" && isSeedance25 ? "跟随原片" : generationDurationLabel}
                    </Button>
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={deleteSelectedLogs} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function GenerationSettings({
    config,
    model,
    updateConfig,
    openConfigDialog,
    referenceCounts,
}: {
    config: AiConfig;
    model: string;
    updateConfig: UpdateAiConfig;
    openConfigDialog: (shouldPromptContinue?: boolean) => void;
    referenceCounts: { images: number; videos: number; audios: number };
}) {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const resolvedConfig = { ...config, model, videoModel: model };

    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={resolvedConfig} value={model} onChange={(value) => updateConfig("videoModel", value)} capability="video" fullWidth onMissingConfig={() => openConfigDialog(false)} />
            </label>
            <div className="col-span-2">
                <VideoSettingsPanel config={resolvedConfig} onConfigChange={(key, value) => updateConfig(key, value)} theme={theme} showTitle={false} className="space-y-5" miniMaxReferenceCounts={referenceCounts} />
            </div>
        </>
    );
}

function VideoResultStage({
    results,
    running,
    onDownload,
    onSaveAsset,
    onRetry,
    onRegenerate,
    onExtend,
    onUseLastFrame,
    onDeleteFailure,
}: {
    results: GenerationResult[];
    running: boolean;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => Promise<void>;
    onRetry: (resultId: string) => void;
    onRegenerate: () => void;
    onExtend?: (video: GeneratedVideo) => void;
    onUseLastFrame?: (video: GeneratedVideo) => void;
    onDeleteFailure: (logId: string) => void;
}) {
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
                    <VideoIcon className="size-7" strokeWidth={1.6} />
                </div>
                <h3>让一个镜头动起来</h3>
                <p>描述动作、镜头和氛围，生成结果会显示在这里</p>
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
                {active.status === "success" && active.video ? (
                    <ResultVideoCard video={active.video} onDownload={onDownload} onSaveAsset={onSaveAsset} onRegenerate={onRegenerate} onExtend={onExtend} onUseLastFrame={onUseLastFrame} regenerateDisabled={running} />
                ) : active.status === "failed" ? (
                    <FailedVideoCard error={active.error || "生成失败"} retryDisabled={running} onRetry={() => onRetry(active.id)} onDelete={() => onDeleteFailure(active.id)} />
                ) : (
                    <PendingVideoCard />
                )}
            </div>
            {results.length > 1 ? (
                <div className="wg-media-result-thumbnails" aria-label="生成结果列表">
                    {results.map((result, index) => (
                        <button key={result.id} type="button" className={result.id === active.id ? "is-active" : ""} onClick={() => setActiveId(result.id)} aria-label={`查看结果 ${index + 1}`}>
                            {result.video ? <video src={result.video.url} muted preload="metadata" /> : result.status === "failed" ? <span className="text-red-700">失败</span> : <LoaderCircle className="size-4 animate-spin" />}
                        </button>
                    ))}
                </div>
            ) : null}
        </div>
    );
}

function ResultVideoCard({
    video,
    onDownload,
    onSaveAsset,
    onRegenerate,
    onExtend,
    onUseLastFrame,
    regenerateDisabled,
}: {
    video: GeneratedVideo;
    onDownload: (video: GeneratedVideo) => void;
    onSaveAsset: (video: GeneratedVideo) => Promise<void>;
    onRegenerate: () => void;
    onExtend?: (video: GeneratedVideo) => void;
    onUseLastFrame?: (video: GeneratedVideo) => void;
    regenerateDisabled: boolean;
}) {
    return (
        <div className="wg-media-result-card overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="wg-media-result-card-preview">
                <video src={video.url} controls className="aspect-video size-full bg-black object-contain" />
            </div>
            <div className="wg-media-result-card-actions flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                <div className="flex min-w-0 flex-wrap gap-x-2 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                    <span>
                        {video.width}x{video.height}
                    </span>
                    <span>{formatBytes(video.bytes)}</span>
                    <span>{formatDuration(video.durationMs)}</span>
                </div>
                <div className="flex shrink-0 gap-1">
                    {onUseLastFrame && video.lastFrame ? (
                        <Button size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => onUseLastFrame(video)}>
                            尾帧续作
                        </Button>
                    ) : null}
                    {onExtend ? (
                        <Button size="small" icon={<ArrowRight className="size-3.5" />} onClick={() => onExtend(video)}>
                            继续延长
                        </Button>
                    ) : null}
                    <Button size="small" icon={<RefreshCw className="size-3.5" />} disabled={regenerateDisabled} onClick={onRegenerate}>
                        重新生成
                    </Button>
                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSaveAsset(video)}>
                        保存到我的资产
                    </Button>
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(video)}>
                        下载
                    </Button>
                </div>
            </div>
        </div>
    );
}

function PendingVideoCard() {
    return (
        <div className="relative aspect-video overflow-hidden rounded-lg border border-dashed border-stone-300 bg-stone-50 dark:border-stone-700 dark:bg-stone-900">
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-sm text-stone-500 dark:text-stone-400">
                <LoaderCircle className="size-6 animate-spin" />
                <span>生成中</span>
            </div>
        </div>
    );
}

function FailedVideoCard({ error, retryDisabled, onRetry, onDelete }: { error: string; retryDisabled: boolean; onRetry: () => void; onDelete: () => void }) {
    return (
        <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
            <div className="flex aspect-video flex-col items-center justify-center gap-3 p-5 text-center">
                <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                <Typography.Paragraph ellipsis={{ rows: 4 }} className="!mb-0 !text-xs !text-red-500 dark:!text-red-300">
                    {error}
                </Typography.Paragraph>
            </div>
            <div className="flex justify-end gap-2 border-t border-red-200 p-3 dark:border-red-950">
                <Popconfirm title="删除这次失败结果？" description="删除后不能继续重试。" okText="删除" cancelText="取消" okButtonProps={{ danger: true }} onConfirm={onDelete}>
                    <Button size="small" danger type="text" icon={<Trash2 className="size-3.5" />}>
                        删除
                    </Button>
                </Popconfirm>
                <Button size="small" danger disabled={retryDisabled} onClick={onRetry}>
                    重试
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
                    <h2 className="text-[15px] font-semibold">生成记录</h2>
                    <p className="mt-0.5 text-[10px] text-[color:var(--wg-studio-muted)]">{logs.length} 条视频创作</p>
                </div>
                <Button type="text" size="small" icon={<CheckSquare className="size-3.5" />} onClick={toggleManaging} aria-pressed={managing}>
                    {managing ? "完成" : "多选"}
                </Button>
            </div>
            <div className="mb-3 flex flex-wrap gap-2">
                <Button size="small" icon={<Plus className="size-3.5" />} onClick={onCreateSession}>
                    新创作
                </Button>
                {managing ? (
                    <>
                        <Button size="small" disabled={!logs.length} onClick={toggleAll}>
                            {allSelected ? "取消全选" : "全选"}
                        </Button>
                        <span className="self-center text-[11px] text-[color:var(--wg-studio-muted)]">已选 {selectedCount} 条</span>
                        <Button size="small" danger icon={<Trash2 className="size-3.5" />} disabled={!selectedCount} onClick={onDeleteSelected}>
                            删除（{selectedCount}）
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
                {!logs.length ? <div className="flex min-h-48 items-center justify-center rounded-lg border border-dashed border-stone-300 text-center text-sm text-stone-500 dark:border-stone-700">暂无生成记录</div> : null}
            </div>
        </>
    );
}

function LogCard({ log, managing, selected, active, onSelectedChange, onClick }: { log: GenerationLog; managing: boolean; selected: boolean; active: boolean; onSelectedChange: (checked: boolean) => void; onClick: () => void }) {
    const hailuo = isMiniMaxHailuoModel(modelOptionName(log.model));
    return (
        <div className={active ? "wg-media-history-card is-active" : "wg-media-history-card"}>
            {managing ? <Checkbox className="absolute right-2 top-2 z-10" checked={selected} onClick={(event) => event.stopPropagation()} onChange={(event) => onSelectedChange(event.target.checked)} /> : null}
            <button type="button" className="block w-full text-left focus-visible:outline-none" onClick={onClick}>
                <div className="flex gap-2.5">
                    <div className="wg-media-history-thumb is-video">
                        {log.video?.url ? <video src={log.video.url} muted preload="metadata" /> : <VideoIcon className="size-5" />}
                        <span className={log.status === "失败" ? "is-failed" : ""}>{log.status}</span>
                    </div>
                    <div className="min-w-0 flex-1 py-0.5">
                        <div className="truncate pr-5 text-[12px] font-semibold">{log.title}</div>
                        <div className="mt-1 truncate text-[10px] text-[color:var(--wg-studio-muted)]">{log.model || "视频模型"}</div>
                        <div className="mt-2 flex flex-wrap gap-x-2 gap-y-1 text-[10px] text-[color:var(--wg-studio-muted)]">
                            <span>{log.size || "自适应"}</span>
                            <span>{log.resolution}p</span>
                            <span>{log.seconds}s</span>
                            {hailuo ? <span>{log.references.length ? "首帧" : "文生"}</span> : null}
                            {hailuo ? <span>{log.config.minimaxVideoPromptOptimizer === "false" ? "原始提示词" : "提示词优化"}</span> : null}
                            {hailuo && log.config.minimaxVideoFastPretreatment === "true" ? <span>快速预处理</span> : null}
                            {hailuo && log.config.videoWatermark === "true" ? <span>水印</span> : null}
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
        const logs: GenerationLog[] = [];
        const cancellations = readSynchronousCancellationJournal();
        await retryVideoLogStorage(() =>
            cancelledJobStore.iterate<CancelledVideoJob, void>((value, key) => {
                const recovery = cancellations.get(key);
                cancellations.set(key, recovery ? mergeVideoCancellationJournalEntry(value, recovery) : value);
            }),
        );
        await logStore.iterate<GenerationLog, void>((value) => {
            logs.push(value);
        });
        const normalized = await Promise.all(
            logs
                .filter((log) => !log.deletedAt && !cancellations.get(log.id)?.hidden && videoGenerationLogVisibility.isVisible(log.id))
                .map((log) => {
                    const retirementReason = videoGenerationLogVisibility.retirementReason(log.id) || cancellations.get(log.id)?.reason;
                    return retirementReason
                        ? {
                              ...markStaleVideoLogCancelled(log),
                              error: retirementReason,
                              durationMs: Date.now() - log.createdAt,
                          }
                        : log;
                })
                .map(normalizeLog),
        );
        return normalized.filter((log) => !log.deletedAt && !cancellations.get(log.id)?.hidden && videoGenerationLogVisibility.isVisible(log.id)).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    } catch {
        return [];
    }
}

async function retryVideoLogStorage<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
    return retryAsyncOperation(operation, attempts, (attempt) => delay(Math.min(2_000, 50 * 2 ** Math.min(attempt, 6))));
}

async function normalizeLog(log: Partial<GenerationLog>): Promise<GenerationLog> {
    const video = log.video
        ? {
              ...log.video,
              url: log.video.storageKey ? await resolveMediaUrl(log.video.storageKey, log.video.url) : log.video.url,
              lastFrame: log.video.lastFrame
                  ? { ...log.video.lastFrame, url: await resolveImageUrl(log.video.lastFrame.storageKey, log.video.lastFrame.url) }
                  : undefined,
          }
        : undefined;
    const videoReferences = await Promise.all(
        (log.videoReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const audioReferences = await Promise.all(
        (log.audioReferences || []).map(async (item) => ({
            ...item,
            url: item.storageKey ? await resolveMediaUrl(item.storageKey, item.url) : item.url,
        })),
    );
    const references = await Promise.all(
        (log.references || []).map(async (item) => ({
            ...item,
            dataUrl: await resolveImageUrl(item.storageKey, item.dataUrl),
        })),
    );
    const config = normalizeLogConfig(log);
    return {
        id: log.id || nanoid(),
        runId: log.runId,
        createdAt: log.createdAt || Date.now(),
        title: log.title || log.model || "未命名",
        prompt: log.prompt || "",
        time: log.time || new Date().toLocaleString("zh-CN", { hour12: false }),
        model: log.model || config.videoModel || "",
        config,
        references,
        videoReferences,
        audioReferences,
        durationMs: log.durationMs || 0,
        size: log.size || config.size || "",
        resolution: normalizeResolution(log.resolution || config.vquality || ""),
        seconds: log.seconds || config.videoSeconds || "",
        status: log.status || "成功",
        task: log.task,
        video,
        error: log.error,
        deletedAt: log.deletedAt,
    };
}

function serializeLog(log: GenerationLog): GenerationLog {
    return {
        ...log,
        references: log.references.map((item) => ({ ...item, dataUrl: item.storageKey ? "" : item.dataUrl })),
        videoReferences: log.videoReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        audioReferences: log.audioReferences.map((item) => (item.storageKey ? { ...item, url: "" } : item)),
        video: log.video
            ? {
                  ...log.video,
                  url: log.video.storageKey ? "" : log.video.url,
                  lastFrame: log.video.lastFrame?.storageKey ? { ...log.video.lastFrame, url: "" } : log.video.lastFrame,
              }
            : undefined,
    };
}

function isSupportedAudioFile(file: File) {
    return file.type === "audio/mpeg" || file.type === "audio/mp3" || file.type === "audio/wav" || file.type === "audio/x-wav" || /\.(mp3|wav)$/i.test(file.name);
}

function miniMaxVideoReferenceError(videos: ReferenceVideo[]) {
    if (videos.length > 3) return "MiniMax H3 最多支持 3 个参考视频";
    let totalDurationMs = 0;
    for (let index = 0; index < videos.length; index += 1) {
        const video = videos[index];
        const label = `视频${index + 1}`;
        if (!SEEDANCE_VIDEO_MIME_TYPES.includes(video.type)) return `${label} 仅支持 mp4/mov 格式`;
        if (video.bytes && video.bytes > 50 * 1024 * 1024) return `${label} 超过 50MB，请压缩后再上传`;
        if (video.durationMs) {
            if (video.durationMs < 2000 || video.durationMs > 15_000) return `${label} 时长需要在 2-15 秒之间`;
            totalDurationMs += video.durationMs;
        }
    }
    return totalDurationMs > 15_000 ? "MiniMax H3 参考视频总时长不能超过 15 秒" : "";
}

function miniMaxAudioReferenceError(audios: ReferenceAudio[]) {
    if (audios.length > 3) return "MiniMax H3 最多支持 3 个参考音频";
    let totalDurationMs = 0;
    for (let index = 0; index < audios.length; index += 1) {
        const audio = audios[index];
        if (audio.durationMs) {
            if (audio.durationMs < 2000 || audio.durationMs > 15_000) return `音频${index + 1} 时长需要在 2-15 秒之间`;
            totalDurationMs += audio.durationMs;
        }
    }
    return totalDurationMs > 15_000 ? "MiniMax H3 参考音频总时长不能超过 15 秒" : "";
}

function filterMiniMaxVideoReferencesByDuration(existing: ReferenceVideo[], next: ReferenceVideo[], enabled: boolean, warn: (content: string) => void) {
    if (!enabled) return next;
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceVideo[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > 15_000 || total + item.durationMs > 15_000)) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn("已忽略不符合时长要求的参考视频：单个 2-15 秒，总时长不超过 15 秒");
    return accepted;
}

function filterAudioReferencesByDuration(existing: ReferenceAudio[], next: ReferenceAudio[], warn: (content: string) => void, maxDurationMs = 15_000, maxTotalDurationMs = 15_000) {
    let total = existing.reduce((sum, item) => sum + (item.durationMs || 0), 0);
    const accepted: ReferenceAudio[] = [];
    let skipped = false;
    for (const item of next) {
        if (item.durationMs && (item.durationMs < 2000 || item.durationMs > maxDurationMs)) {
            skipped = true;
            continue;
        }
        if (item.durationMs && total + item.durationMs > maxTotalDurationMs) {
            skipped = true;
            continue;
        }
        total += item.durationMs || 0;
        accepted.push(item);
    }
    if (skipped) warn(`已忽略不符合时长要求的参考音频：单个 2-${maxDurationMs / 1000} 秒，总时长不超过 ${maxTotalDurationMs / 1000} 秒`);
    return accepted;
}

function moveListItem<T>(items: T[], index: number, offset: number) {
    const targetIndex = index + offset;
    if (targetIndex < 0 || targetIndex >= items.length) return items;
    const next = [...items];
    [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
    return next;
}

function ReferenceOrderButtons({ label, index, total, onMove }: { label: string; index: number; total: number; onMove: (offset: number) => void }) {
    if (total <= 1) return null;
    return (
        <div className="absolute inset-x-1 bottom-1 flex justify-between">
            <Button aria-label={`将${label}移到前一位`} size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowLeft className="size-3" />} disabled={index <= 0} onClick={() => onMove(-1)} />
            <Button aria-label={`将${label}移到后一位`} size="small" className="!h-6 !w-6 !min-w-6 !rounded-full !bg-white/85 !p-0 !shadow-sm" icon={<ArrowRight className="size-3" />} disabled={index >= total - 1} onClick={() => onMove(1)} />
        </div>
    );
}

function normalizeLogConfig(log: Partial<GenerationLog>): GenerationLogConfig {
    return {
        model: log.config?.model || log.model || "",
        videoModel: log.config?.videoModel || log.model || "",
        size: log.config?.size || log.size || "",
        vquality: normalizeResolution(log.config?.vquality || log.resolution || ""),
        videoSeconds: log.config?.videoSeconds || log.seconds || "",
        videoGenerateAudio: log.config?.videoGenerateAudio || "true",
        videoWatermark: log.config?.videoWatermark || "false",
        seedance25TaskMode: normalizeSeedance25TaskMode(log.config?.seedance25TaskMode),
        seedance25Continuation: normalizeSeedance25Continuation(log.config?.seedance25Continuation),
        seedance25OutputFormat: normalizeSeedance25OutputFormat(log.config?.seedance25OutputFormat),
        seedance25InputMode: normalizeSeedance25InputMode(log.config?.seedance25InputMode),
        seedance25Seed: String(normalizeSeedance25Seed(log.config?.seedance25Seed)),
        seedance25ReturnLastFrame: log.config?.seedance25ReturnLastFrame === "false" ? "false" : "true",
        seedance25WebSearch: log.config?.seedance25WebSearch === "true" ? "true" : "false",
        seedance25CameraFixed: log.config?.seedance25CameraFixed === "true" ? "true" : "false",
        minimaxVideoInputMode: normalizeMiniMaxVideoInputMode(log.config?.minimaxVideoInputMode),
        minimaxVideoPromptOptimizer: log.config?.minimaxVideoPromptOptimizer || "true",
        minimaxVideoFastPretreatment: log.config?.minimaxVideoFastPretreatment || "false",
    };
}

function buildLog({
    id,
    runId,
    prompt,
    model,
    config,
    references,
    videoReferences,
    audioReferences,
    durationMs,
    status,
    task,
    video,
    error,
}: {
    id?: string;
    runId?: string;
    prompt: string;
    model: string;
    config: AiConfig;
    references: ReferenceImage[];
    videoReferences: ReferenceVideo[];
    audioReferences: ReferenceAudio[];
    durationMs: number;
    status: GenerationLog["status"];
    task?: VideoGenerationTask;
    video?: GeneratedVideo;
    error?: string;
}): GenerationLog {
    const logConfig = {
        model: config.model,
        videoModel: config.videoModel,
        size: config.size,
        vquality: normalizeResolution(config.vquality),
        videoSeconds: config.videoSeconds,
        videoGenerateAudio: config.videoGenerateAudio,
        videoWatermark: config.videoWatermark,
        seedance25TaskMode: normalizeSeedance25TaskMode(config.seedance25TaskMode),
        seedance25Continuation: normalizeSeedance25Continuation(config.seedance25Continuation),
        seedance25OutputFormat: normalizeSeedance25OutputFormat(config.seedance25OutputFormat),
        seedance25InputMode: normalizeSeedance25InputMode(config.seedance25InputMode),
        seedance25Seed: String(normalizeSeedance25Seed(config.seedance25Seed)),
        seedance25ReturnLastFrame: String(boolConfig(config.seedance25ReturnLastFrame, true)),
        seedance25WebSearch: String(boolConfig(config.seedance25WebSearch, false)),
        seedance25CameraFixed: String(boolConfig(config.seedance25CameraFixed, false)),
        minimaxVideoInputMode: normalizeMiniMaxVideoInputMode(config.minimaxVideoInputMode),
        minimaxVideoPromptOptimizer: String(boolConfig(config.minimaxVideoPromptOptimizer, true)),
        minimaxVideoFastPretreatment: String(boolConfig(config.minimaxVideoFastPretreatment, false)),
    };
    return {
        id: id || nanoid(),
        runId,
        createdAt: Date.now(),
        title: prompt.slice(0, 12) || "未命名",
        prompt,
        time: new Date().toLocaleString("zh-CN", { hour12: false }),
        model,
        config: logConfig,
        references,
        videoReferences,
        audioReferences,
        durationMs,
        size: logConfig.size,
        resolution: logConfig.vquality,
        seconds: logConfig.videoSeconds,
        status,
        task,
        video,
        error,
    };
}

function buildVideoConfig(config: AiConfig, model: string, referenceCounts = { images: 0, videos: 0, audios: 0 }): AiConfig {
    const seedance = isSeedanceVideoConfig({ ...config, model });
    const seedance25 = isSeedance25Model(modelOptionName(model));
    const seedance25TaskMode = normalizeSeedance25TaskMode(config.seedance25TaskMode);
    const seedance25InputMode = normalizeSeedance25InputMode(config.seedance25InputMode);
    const requestConfig = resolveModelRequestConfig({ ...config, model, videoModel: model }, model);
    const experience = modelExperienceKind(requestConfig.apiFormat, modelOptionName(model), "video");
    const minimax = experience === "minimax-video";
    const hailuo = experience === "minimax-hailuo-video";
    const minimaxMode = normalizeMiniMaxVideoInputMode(config.minimaxVideoInputMode);
    const resolvedMiniMaxMode = resolveMiniMaxVideoInputMode(minimaxMode, referenceCounts);
    const miniMaxFrameMode = resolvedMiniMaxMode === "first-frame" || resolvedMiniMaxMode === "last-frame" || resolvedMiniMaxMode === "first-last";
    const hasMiniMaxReference = referenceCounts.images + referenceCounts.videos + referenceCounts.audios > 0;
    const hailuoOptions = normalizeMiniMaxHailuoVideoOptions(config.vquality, Number(config.videoSeconds));
    return {
        ...config,
        model,
        videoModel: model,
        size:
            seedance25 && (seedance25TaskMode !== "generate" || seedance25InputMode !== "reference")
                ? "adaptive"
                : seedance
                  ? normalizeSeedanceRatio(config.size)
                  : hailuo
                    ? "adaptive"
                    : minimax
                      ? miniMaxFrameMode
                          ? "adaptive"
                          : normalizeMiniMaxVideoRatio(config.size, hasMiniMaxReference)
                      : normalizeVideoSize(config.size),
        videoSeconds: seedance25
            ? String(normalizeSeedance25Duration(config.videoSeconds, seedance25TaskMode))
            : hailuo
              ? String(hailuoOptions.duration)
              : minimax
                ? String(Math.max(4, Math.min(15, Math.floor(Number(config.videoSeconds) || 6))))
                : normalizeVideoSeconds(config.videoSeconds),
        vquality: seedance25 ? (normalizeVideoResolutionValue(config.vquality) === "480" ? "480" : "720") : hailuo ? hailuoOptions.resolution : minimax ? normalizeMiniMaxVideoResolution(config.vquality) : normalizeResolution(config.vquality),
        videoGenerateAudio: String(boolConfig(config.videoGenerateAudio, true)),
        videoWatermark: String(boolConfig(config.videoWatermark, false)),
        seedance25TaskMode,
        seedance25Continuation: normalizeSeedance25Continuation(config.seedance25Continuation),
        seedance25OutputFormat: normalizeSeedance25OutputFormat(config.seedance25OutputFormat),
        seedance25InputMode,
        seedance25Seed: String(normalizeSeedance25Seed(config.seedance25Seed)),
        seedance25ReturnLastFrame: String(boolConfig(config.seedance25ReturnLastFrame, true)),
        seedance25WebSearch: String(boolConfig(config.seedance25WebSearch, false)),
        seedance25CameraFixed: String(boolConfig(config.seedance25CameraFixed, false)),
        minimaxVideoInputMode: minimaxMode,
        minimaxVideoPromptOptimizer: String(boolConfig(config.minimaxVideoPromptOptimizer, true)),
        minimaxVideoFastPretreatment: String(boolConfig(config.minimaxVideoFastPretreatment, false)),
    };
}

function normalizeVideoSeconds(value: string) {
    if (String(value).trim() === "-1") return "-1";
    const seconds = Math.floor(Number(value) || 6);
    return String(Math.max(1, Math.min(20, seconds)));
}

function normalizeVideoSize(value: string) {
    return normalizeVideoSizeValue(value);
}

function normalizeResolution(value: string) {
    return normalizeVideoResolutionValue(value);
}

function delay(ms: number, signal?: AbortSignal) {
    return new Promise<void>((resolve, reject) => {
        if (signal?.aborted) {
            reject(new DOMException("Aborted", "AbortError"));
            return;
        }
        const timeoutId = window.setTimeout(resolve, ms);
        signal?.addEventListener(
            "abort",
            () => {
                window.clearTimeout(timeoutId);
                reject(new DOMException("Aborted", "AbortError"));
            },
            { once: true },
        );
    });
}
