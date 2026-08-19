import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { App, Button, Drawer, Input, Modal, Switch } from "antd";
import { BookOpen, Clapperboard, Download, Film, FolderPlus, GripVertical, ImagePlus, LoaderCircle, Music2, Plus, Sparkles, Trash2, Video as VideoIcon } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { MediaWorkbenchHeader } from "@/components/media-workbench-header";
import { MediaWorkbenchHistory, type MediaWorkbenchHistoryItem } from "@/components/media-workbench-history";
import { MediaWorkbenchModeTabs } from "@/components/media-workbench-mode-tabs";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import {
    isSeedance25Model,
    normalizeSeedance25Continuation,
    normalizeSeedance25Duration,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25RemoteVideoUrl,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    prepareSeedance25GeneratedVideoSource,
    seedance25DurationOptions,
    seedance25InputModeError,
    seedance25MultimodalReferenceError,
    seedance25ReferenceError,
    seedance25TaskLabel,
    SEEDANCE_25_CONTINUATIONS,
    SEEDANCE_25_INPUT_MODES,
    SEEDANCE_25_OUTPUT_FORMATS,
    SEEDANCE_25_REFERENCE_LIMITS,
    SEEDANCE_25_TASKS,
    type Seedance25InputMode,
    type Seedance25TaskMode,
} from "@/lib/seedance-2-5";
import { formatDuration } from "@/lib/image-utils";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import { createDesktopJsonStore, exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { deleteStoredMedia, discardUploadedMedia, getMediaBlob, publishUploadedMedia, resolveMediaUrl, type UploadedFile } from "@/services/file-storage";
import { deleteStoredImages, discardUploadedImage, publishUploadedImage, resolveImageUrl, uploadImage, type UploadedImage } from "@/services/image-storage";
import { requestVideoGeneration, storeGeneratedVideo } from "@/services/api/video";
import { useAssetStore, type AssetKind } from "@/stores/use-asset-store";
import { modelOptionName, selectableModelsByCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import type { ReferenceAudio, ReferenceVideo } from "@/types/media";
import type { ReferenceImage } from "@/types/image";

type Shot = { id: string; title: string; seconds: number; prompt: string };
type BoardRecord = {
    id: string;
    createdAt: number;
    title: string;
    prompt: string;
    mode: Seedance25TaskMode;
    model: string;
    seconds: number;
    outputFormat: "mp4" | "mov";
    inputMode: Seedance25InputMode;
    seed: number;
    returnLastFrame: boolean;
    webSearch: boolean;
    cameraFixed: boolean;
    status: "生成中" | "成功" | "失败";
    references?: ReferenceImage[];
    audioReferences?: ReferenceAudio[];
    sourceVideo?: UploadedFile;
    video?: UploadedFile;
    lastFrame?: UploadedImage;
    remoteLastFrameUrl?: string;
    remoteVideoUrl?: string;
    error?: string;
};

const recordStore = createDesktopJsonStore({
    namespace: "seedance-2-5-records-v1",
    legacy: { name: "infinite-canvas", storeName: "seedance_2_5_records" },
});

const starterDrafts = [
    { id: "rain-alley", title: "雨巷长镜头", prompt: "清晨的旧城区，镜头跟随骑行者穿过潮湿街道，路面倒映暖色灯光，动作自然连贯。" },
    { id: "glass-hall", title: "玻璃展厅", prompt: "镜头缓慢穿过通透的玻璃展厅，产品陈列在自然天光中，人物从远处走近。" },
    { id: "coastal-road", title: "海岸公路", prompt: "傍晚的海岸公路，车辆沿山体行驶，镜头平稳跟随，海面反射最后一束日光。" },
] as const;

const initialShots: Shot[] = [
    { id: "opening", title: "开场", seconds: 8, prompt: "空镜交代旧城区与清晨湿润的街道。" },
    { id: "follow", title: "跟随", seconds: 12, prompt: "镜头贴近骑行者向前移动，人物与环境保持连续。" },
    { id: "closing", title: "收束", seconds: 10, prompt: "骑行者驶向亮起的街口，镜头逐渐放慢。" },
];

const seedanceModeTabs = SEEDANCE_25_TASKS.map((item) => ({
    ...item,
    icon: item.value === "generate" ? Clapperboard : item.value === "extend" ? Film : Sparkles,
}));

export default function Seedance25Page() {
    const { message } = App.useApp();
    const runtimeReferencesRef = useRef<unknown>(null);
    const imageInputRef = useRef<HTMLInputElement>(null);
    const config = useConfigStore((state) => state.config);
    const effectiveConfig = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const modelOptions = useMemo(() => selectableModelsByCapability(config, "video").filter((item) => isSeedance25Model(modelOptionName(item))), [config]);
    const model = isSeedance25Model(modelOptionName(effectiveConfig.videoModel)) ? effectiveConfig.videoModel : modelOptions[0] || "";
    const mode = normalizeSeedance25TaskMode(effectiveConfig.seedance25TaskMode);
    const continuation = normalizeSeedance25Continuation(effectiveConfig.seedance25Continuation);
    const inputMode = normalizeSeedance25InputMode(effectiveConfig.seedance25InputMode);
    const [prompt, setPrompt] = useState<string>(starterDrafts[0].prompt);
    const [shots, setShots] = useState<Shot[]>(initialShots);
    const [selectedShotId, setSelectedShotId] = useState(initialShots[0].id);
    const [selectedDraftId, setSelectedDraftId] = useState<string>(starterDrafts[0].id);
    const [sourceVideo, setSourceVideo] = useState<UploadedFile>();
    const [references, setReferences] = useState<ReferenceImage[]>([]);
    const [audioReferences, setAudioReferences] = useState<ReferenceAudio[]>([]);
    const [sourceVideoUrl, setSourceVideoUrl] = useState("");
    const [sourceVideoDuration, setSourceVideoDuration] = useState(10);
    const [records, setRecords] = useState<BoardRecord[]>([]);
    const [selectedRecordId, setSelectedRecordId] = useState<string>();
    const [running, setRunning] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedRecordIds, setSelectedRecordIds] = useState<string[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const totalSeconds = shots.reduce((sum, shot) => sum + shot.seconds, 0);
    const activeRecord = records.find((item) => item.id === selectedRecordId);
    const activeVideo = activeRecord?.video;
    const selectedShot = shots.find((shot) => shot.id === selectedShotId) || shots[0];
    const taskSeconds = normalizeSeedance25Duration(mode === "generate" ? totalSeconds : effectiveConfig.videoSeconds, mode);
    const taskDurationLabel = taskSeconds === -1 ? "智能时长" : `${taskSeconds} 秒`;
    const actionLabel = seedance25TaskLabel(mode);
    const acceptedAssetKinds = useMemo<AssetKind[]>(() => (mode === "generate" && inputMode !== "reference" ? ["text", "image"] : ["text", "image", "video", "audio"]), [inputMode, mode]);
    const referenceCounts = { images: references.length, videos: sourceVideo ? 1 : 0, audios: audioReferences.length };
    const frameModeError = seedance25InputModeError(mode, inputMode, referenceCounts);
    const visibleFrameModeError = references.length || referenceCounts.videos || referenceCounts.audios ? frameModeError : "";
    const hasReferenceAssets = referenceCounts.images + referenceCounts.videos + referenceCounts.audios > 0;
    const pureTextFeatureConflict = mode === "generate" && hasReferenceAssets && (effectiveConfig.seedance25WebSearch === "true" || effectiveConfig.seedance25CameraFixed === "true");
    const canRun = Boolean(model && prompt.trim() && !running && !frameModeError && !pureTextFeatureConflict && (mode === "generate" || sourceVideo));

    runtimeReferencesRef.current = { references, audioReferences, sourceVideo, records, activeRecord };

    useEffect(() => registerRuntimeMediaReferenceProvider(() => runtimeReferencesRef.current), []);
    useEffect(() => markMediaReferencesChanged(), [activeRecord, audioReferences, records, references, sourceVideo]);
    useEffect(() => {
        void loadRecords().then(setRecords);
    }, []);
    useEffect(() => {
        if (mode === "generate") updateConfig("videoSeconds", String(totalSeconds));
    }, [mode, totalSeconds, updateConfig]);

    const selectMode = (nextMode: Seedance25TaskMode) => {
        updateConfig("seedance25TaskMode", nextMode);
        updateConfig("videoSeconds", String(normalizeSeedance25Duration(effectiveConfig.videoSeconds, nextMode)));
        if (nextMode !== "generate") {
            updateConfig("size", "adaptive");
            updateConfig("seedance25InputMode", "reference");
        }
        setSelectedRecordId(undefined);
    };

    const selectInputMode = (nextMode: Seedance25InputMode) => {
        updateConfig("seedance25InputMode", nextMode);
        if (nextMode !== "reference") {
            setSourceVideo(undefined);
            setSourceVideoUrl("");
            setAudioReferences([]);
            setReferences((items) => items.slice(0, nextMode === "first-frame" ? 1 : 2));
            updateConfig("size", "adaptive");
        }
        setSelectedRecordId(undefined);
    };

    const selectDraft = (draft: (typeof starterDrafts)[number]) => {
        setSelectedDraftId(draft.id);
        setSelectedRecordId(undefined);
        setPrompt(draft.prompt);
        setReferences([]);
        setAudioReferences([]);
        setSourceVideo(undefined);
        setSourceVideoUrl("");
        setSourceVideoDuration(10);
        updateConfig("seedance25TaskMode", "generate");
        updateConfig("seedance25InputMode", "reference");
        updateConfig("videoSeconds", String(totalSeconds));
        setHistoryOpen(false);
    };

    const selectRecord = (record: BoardRecord) => {
        setSelectedRecordId(record.id);
        setSelectedDraftId("");
        setPrompt(record.prompt);
        updateConfig("seedance25TaskMode", record.mode);
        updateConfig("seedance25InputMode", normalizeSeedance25InputMode(record.inputMode));
        updateConfig("videoSeconds", String(record.seconds));
        updateConfig("seedance25OutputFormat", normalizeSeedance25OutputFormat(record.outputFormat));
        updateConfig("seedance25Seed", String(normalizeSeedance25Seed(record.seed)));
        updateConfig("seedance25ReturnLastFrame", String(record.returnLastFrame !== false));
        updateConfig("seedance25WebSearch", String(Boolean(record.webSearch)));
        updateConfig("seedance25CameraFixed", String(Boolean(record.cameraFixed)));
        setReferences(record.references || []);
        setAudioReferences(record.audioReferences || []);
        setSourceVideo(record.sourceVideo);
        setSourceVideoUrl("");
        setSourceVideoDuration(Math.max(2, Math.min(30, Math.round((record.sourceVideo?.durationMs || 10_000) / 1000))));
        setHistoryOpen(false);
    };

    const createSession = () => {
        const nextShots = initialShots.map((shot) => ({ ...shot }));
        setPrompt("");
        setShots(nextShots);
        setSelectedShotId(nextShots[0].id);
        setSelectedDraftId("");
        setSelectedRecordId(undefined);
        setSelectedRecordIds([]);
        setReferences([]);
        setAudioReferences([]);
        setSourceVideo(undefined);
        setSourceVideoUrl("");
        setSourceVideoDuration(10);
        updateConfig("seedance25TaskMode", "generate");
        updateConfig("seedance25InputMode", "reference");
        updateConfig("videoSeconds", String(nextShots.reduce((sum, shot) => sum + shot.seconds, 0)));
        setHistoryOpen(false);
    };

    const deleteSelectedRecords = async () => {
        const deletingIds = selectedRecordIds.filter((id) => records.some((record) => record.id === id && record.status !== "生成中"));
        const targets = records.filter((record) => deletingIds.includes(record.id));
        const mediaKeys = targets.map((record) => record.video?.storageKey).filter((key): key is string => Boolean(key));
        const imageKeys = targets
            .flatMap((record) => [...(record.references || []).map((image) => image.storageKey), record.lastFrame?.storageKey])
            .filter((key): key is string => Boolean(key));
        try {
            for (const id of deletingIds) await recordStore.removeItem(id);
            if (mediaKeys.length) await deleteStoredMedia(mediaKeys);
            if (imageKeys.length) await deleteStoredImages(imageKeys);
            setRecords((items) => items.filter((record) => !deletingIds.includes(record.id)));
            if (selectedRecordId && deletingIds.includes(selectedRecordId)) setSelectedRecordId(undefined);
            markMediaReferencesChanged();
            message.success(`已删除 ${deletingIds.length} 条生成记录`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除生成记录失败");
        } finally {
            setSelectedRecordIds([]);
            setDeleteConfirmOpen(false);
        }
    };

    const addSourceVideoUrl = () => {
        const url = normalizeSeedance25RemoteVideoUrl(sourceVideoUrl);
        if (!url) {
            message.warning("请输入公网 HTTPS 视频链接或方舟素材 ID");
            return;
        }
        const remote: UploadedFile = {
            url,
            storageKey: "",
            bytes: 0,
            mimeType: /\.mov(?:$|[?#])/i.test(url) ? "video/quicktime" : "video/mp4",
            durationMs: Math.max(mode === "edit" ? 4 : 2, Math.min(30, Math.round(sourceVideoDuration) || 10)) * 1000,
        };
        const error = seedance25ReferenceError(mode, [toReferenceVideo(remote, "原片")]);
        if (error) {
            message.error(error);
            return;
        }
        setSourceVideo(remote);
        setSourceVideoUrl("");
        updateConfig("seedance25WebSearch", "false");
        updateConfig("seedance25CameraFixed", "false");
        setSelectedRecordId(undefined);
    };

    const addReferenceImages = async (files: FileList | File[]) => {
        const maxImages = mode === "generate" && inputMode === "first-frame" ? 1 : mode === "generate" && inputMode === "first-last" ? 2 : SEEDANCE_25_REFERENCE_LIMITS.images;
        const candidates = Array.from(files)
            .filter((file) => file.type.startsWith("image/") && file.size <= SEEDANCE_25_REFERENCE_LIMITS.imageMaxBytes)
            .slice(0, Math.max(0, maxImages - references.length));
        if (Array.from(files).some((file) => file.type.startsWith("image/") && file.size > SEEDANCE_25_REFERENCE_LIMITS.imageMaxBytes)) message.warning("已忽略超过 30MB 的图片");
        if (!candidates.length) {
            if (references.length >= maxImages) message.warning(inputMode === "first-frame" ? "首帧模式只能使用 1 张图片" : inputMode === "first-last" ? "首尾帧模式只能使用 2 张图片" : "参考图片已达上限");
            return;
        }
        const staged: UploadedImage[] = [];
        try {
            for (const file of candidates) staged.push(await uploadImage(file));
            const next = staged.map((image, index) => ({
                id: nanoid(),
                name: candidates[index].name,
                type: image.mimeType,
                dataUrl: image.url,
                url: image.url,
                storageKey: image.storageKey,
                bytes: image.bytes,
                width: image.width,
                height: image.height,
            }));
            staged.forEach(publishUploadedImage);
            setReferences((items) => [...items, ...next].slice(0, maxImages));
            updateConfig("seedance25WebSearch", "false");
            updateConfig("seedance25CameraFixed", "false");
            setSelectedRecordId(undefined);
        } catch (error) {
            await Promise.allSettled(staged.map((image) => discardUploadedImage(image)));
            message.error(error instanceof Error ? error.message : "图片添加失败");
        } finally {
            if (imageInputRef.current) imageInputRef.current.value = "";
        }
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            setPrompt(payload.content);
            setAssetPickerOpen(false);
            return;
        }
        if (payload.kind === "image") {
            if (references.length >= referenceImageLimit) {
                message.warning(inputMode === "first-frame" ? "首帧模式只能使用 1 张图片" : inputMode === "first-last" ? "首尾帧模式只能使用 2 张图片" : "参考图片已达上限");
                return;
            }
            let stored: UploadedImage | undefined;
            try {
                stored = await uploadImage(payload.dataUrl);
                const reference: ReferenceImage = {
                    id: nanoid(),
                    name: payload.title,
                    type: stored.mimeType,
                    dataUrl: stored.url,
                    url: stored.url,
                    storageKey: stored.storageKey,
                    bytes: stored.bytes,
                    width: stored.width,
                    height: stored.height,
                };
                const error = seedance25MultimodalReferenceError("generate", [...references, reference], sourceVideo ? [toReferenceVideo(sourceVideo, "原片")] : [], audioReferences);
                if (error) throw new Error(error);
                publishUploadedImage(stored);
                setReferences((items) => [...items, reference].slice(0, referenceImageLimit));
                updateConfig("seedance25WebSearch", "false");
                updateConfig("seedance25CameraFixed", "false");
                setSelectedRecordId(undefined);
                setAssetPickerOpen(false);
            } catch (error) {
                if (stored) await discardUploadedImage(stored);
                message.error(error instanceof Error ? error.message : "图片资产添加失败");
            }
            return;
        }
        if (mode === "generate" && inputMode !== "reference") {
            message.warning("当前画面模式只使用图片，不能添加参考视频或音频");
            return;
        }
        if (payload.kind === "video") {
            const remoteUrl = normalizeSeedance25RemoteVideoUrl(payload.url);
            if (!remoteUrl) {
                message.warning("Seedance 2.5 参考视频需要公网 URL 或方舟素材 ID，本机视频暂不能直接使用");
                return;
            }
            const video: UploadedFile = {
                url: remoteUrl,
                storageKey: "",
                bytes: payload.bytes || 0,
                mimeType: payload.mimeType || (/\.mov(?:$|[?#])/i.test(remoteUrl) ? "video/quicktime" : "video/mp4"),
                width: payload.width,
                height: payload.height,
                durationMs: sourceVideoDuration * 1000,
            };
            const error = seedance25MultimodalReferenceError(mode, references, [toReferenceVideo(video, mode === "generate" ? "参考视频" : "原片")], audioReferences);
            if (error) {
                message.warning(error);
                return;
            }
            setSourceVideo(video);
            setSourceVideoDuration(Math.max(mode === "edit" ? 4 : 2, Math.min(30, Math.round((video.durationMs || 10_000) / 1000))));
            setSourceVideoUrl("");
            updateConfig("seedance25WebSearch", "false");
            updateConfig("seedance25CameraFixed", "false");
            setSelectedRecordId(undefined);
            setAssetPickerOpen(false);
            return;
        }
        if (payload.kind !== "audio") return;
        if (audioReferences.length >= SEEDANCE_25_REFERENCE_LIMITS.audios) {
            message.warning("参考音频已达上限");
            return;
        }
        const audio: ReferenceAudio = { id: nanoid(), name: payload.title, type: payload.mimeType, url: payload.url, storageKey: payload.storageKey, durationMs: payload.durationMs, bytes: payload.bytes };
        const error = seedance25MultimodalReferenceError("generate", references, sourceVideo ? [toReferenceVideo(sourceVideo, "原片")] : [], [...audioReferences, audio]);
        if (error) {
            message.warning(error);
            return;
        }
        setAudioReferences((items) => [...items, audio].slice(0, SEEDANCE_25_REFERENCE_LIMITS.audios));
        updateConfig("seedance25WebSearch", "false");
        updateConfig("seedance25CameraFixed", "false");
        setSelectedRecordId(undefined);
        setAssetPickerOpen(false);
    };

    const useLastFrameAsFirstFrame = (record: BoardRecord) => {
        if (!record.lastFrame) {
            message.warning("这条记录没有可复用的尾帧");
            return;
        }
        const image: ReferenceImage = {
            id: nanoid(),
            name: `${record.title} · 尾帧`,
            type: record.lastFrame.mimeType,
            dataUrl: record.lastFrame.url,
            url: record.lastFrame.url,
            storageKey: record.lastFrame.storageKey,
            bytes: record.lastFrame.bytes,
            width: record.lastFrame.width,
            height: record.lastFrame.height,
        };
        setReferences([image]);
        setAudioReferences([]);
        setSourceVideo(undefined);
        setSourceVideoUrl("");
        setSelectedRecordId(undefined);
        setSelectedDraftId("");
        setSelectedRecordIds([]);
        setPrompt("从首帧自然延续动作与镜头，保持人物、环境、光线和声音连贯。");
        updateConfig("seedance25TaskMode", "generate");
        updateConfig("seedance25InputMode", "first-frame");
        updateConfig("seedance25WebSearch", "false");
        updateConfig("seedance25CameraFixed", "false");
        updateConfig("size", "adaptive");
        setHistoryOpen(false);
        message.success("已将尾帧设为新视频的首帧");
    };

    const addShot = () => {
        if (shots.length >= 8 || shots.length >= Math.floor(totalSeconds)) {
            message.warning("当前故事板无法再添加片段");
            return;
        }
        const next: Shot = { id: nanoid(), title: `片段 ${shots.length + 1}`, seconds: Math.min(4, totalSeconds), prompt: "描述这一段发生的动作与镜头变化。" };
        setShots((items) => redistributeShotDurations([...items, next], totalSeconds));
        setSelectedShotId(next.id);
    };

    const removeShot = (id: string) => {
        if (shots.length <= 1) return;
        const next = redistributeShotDurations(
            shots.filter((shot) => shot.id !== id),
            Math.max(4, totalSeconds - (shots.find((shot) => shot.id === id)?.seconds || 0)),
        );
        setShots(next);
        if (selectedShotId === id) setSelectedShotId(next[0].id);
    };

    const updateShot = (id: string, patch: Partial<Shot>) => setShots((items) => items.map((shot) => (shot.id === id ? { ...shot, ...patch } : shot)));

    const updateShotSeconds = (id: string, requestedSeconds: number) =>
        setShots((items) => {
            const otherSeconds = items.filter((shot) => shot.id !== id).reduce((sum, shot) => sum + shot.seconds, 0);
            const seconds = Math.max(Math.max(1, 4 - otherSeconds), Math.min(30 - otherSeconds, Math.round(requestedSeconds) || 1));
            return items.map((shot) => (shot.id === id ? { ...shot, seconds } : shot));
        });

    const setTotalDuration = (seconds: number) => {
        if (seconds < shots.length) {
            message.warning("请先减少片段数量，再缩短总时长");
            return;
        }
        setShots((items) => redistributeShotDurations(items, seconds));
    };

    const generate = async () => {
        if (!model) {
            message.warning("请先添加 Seedance 2.5 模型");
            openConfigDialog(true);
            return;
        }
        if (!isAiConfigReady(effectiveConfig, model)) {
            message.warning("请先完成 Seedance 2.5 渠道配置");
            openConfigDialog(true);
            return;
        }
        const referenceVideos = sourceVideo ? [toReferenceVideo(sourceVideo, "原片")] : [];
        const referenceError = seedance25MultimodalReferenceError(mode, references, referenceVideos, audioReferences);
        if (referenceError) {
            message.error(referenceError);
            return;
        }
        const modeError = seedance25InputModeError(mode, inputMode, { images: references.length, videos: referenceVideos.length, audios: audioReferences.length });
        if (modeError) {
            message.error(modeError);
            return;
        }
        if (mode === "generate" && (references.length || referenceVideos.length || audioReferences.length) && effectiveConfig.seedance25WebSearch === "true") {
            message.error("联网搜索只能用于纯文字生成，请先移除参考素材");
            return;
        }
        if (mode === "generate" && (references.length || referenceVideos.length || audioReferences.length) && effectiveConfig.seedance25CameraFixed === "true") {
            message.error("固定机位只能用于纯文字生成，请先移除参考素材");
            return;
        }
        const id = nanoid();
        const title = prompt.trim().slice(0, 12) || "未命名创作";
        const requestPrompt = mode === "generate" ? storyboardPrompt(prompt, shots) : prompt.trim();
        const requestConfig: AiConfig = {
            ...effectiveConfig,
            model,
            videoModel: model,
            seedance25TaskMode: mode,
            seedance25Continuation: continuation,
            seedance25InputMode: inputMode,
            videoSeconds: String(taskSeconds),
            size: mode === "generate" && inputMode === "reference" ? effectiveConfig.size : "adaptive",
        };
        const pending: BoardRecord = {
            id,
            createdAt: Date.now(),
            title,
            prompt: prompt.trim(),
            mode,
            model,
            seconds: taskSeconds,
            outputFormat: normalizeSeedance25OutputFormat(requestConfig.seedance25OutputFormat),
            inputMode,
            seed: normalizeSeedance25Seed(requestConfig.seedance25Seed),
            returnLastFrame: requestConfig.seedance25ReturnLastFrame !== "false",
            webSearch: requestConfig.seedance25WebSearch === "true",
            cameraFixed: requestConfig.seedance25CameraFixed === "true",
            status: "生成中",
            references,
            audioReferences,
            sourceVideo,
        };
        setRunning(true);
        setSelectedDraftId("");
        setSelectedRecordId(id);
        setRecords((items) => [pending, ...items]);
        try {
            await persistRecord(pending);
            if (sourceVideo?.storageKey) publishUploadedMedia(sourceVideo);
            const generated = await requestVideoGeneration(requestConfig, requestPrompt, references, referenceVideos, audioReferences);
            const stored = await storeGeneratedVideo(generated);
            let lastFrame: UploadedImage | undefined;
            try {
                lastFrame = generated.lastFrameUrl ? await uploadImage(generated.lastFrameUrl) : undefined;
                const completed: BoardRecord = { ...pending, status: "成功", video: stored, lastFrame, remoteVideoUrl: generated.url, remoteLastFrameUrl: generated.lastFrameUrl };
                await persistRecord(completed);
                if (!publishUploadedMedia(stored)) throw new Error("视频未能完成保存，请重试");
                if (lastFrame && !publishUploadedImage(lastFrame)) throw new Error("尾帧未能完成保存，请重试");
                setRecords((items) => items.map((item) => (item.id === id ? completed : item)));
            } catch (error) {
                await discardUploadedMedia(stored);
                if (lastFrame) await discardUploadedImage(lastFrame);
                throw error;
            }
            message.success(lastFrame ? "视频与尾帧已生成并保存在本机" : "视频已生成并保存在本机");
        } catch (error) {
            const failed: BoardRecord = { ...pending, status: "失败", error: error instanceof Error ? error.message : "生成失败" };
            await recordStore.setItem(id, serializeRecord(failed)).catch(() => undefined);
            setRecords((items) => items.map((item) => (item.id === id ? failed : item)));
            message.error(failed.error);
        } finally {
            setRunning(false);
        }
    };

    const download = async (video: UploadedFile) => {
        const extension = video.mimeType === "video/quicktime" ? "mov" : "mp4";
        const filename = `WorkflowGenerator-SD2.5.${extension}`;
        try {
            if (isDesktopApp() && video.storageKey) {
                await exportDesktopMedia("media", video.storageKey, filename);
                message.success(`已下载：${filename}`);
                return;
            }
            const blob = video.storageKey ? await getMediaBlob(video.storageKey) : await (await fetch(video.url)).blob();
            if (!blob) throw new Error("找不到视频文件");
            saveAs(blob, filename);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "下载失败");
        }
    };

    const saveToAssets = async (video: UploadedFile) => {
        try {
            await addAssetPersisted({
                kind: "video",
                title: activeRecord?.title || "Seedance 2.5 视频",
                coverUrl: "",
                tags: ["Seedance 2.5"],
                source: "SD2.5 专属工作板",
                data: { url: video.url, storageKey: video.storageKey, width: video.width, height: video.height, bytes: video.bytes, mimeType: video.mimeType },
                metadata: { source: "seedance-2-5-workboard", prompt },
            });
            message.success("已保存到我的资产");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存资产失败");
        }
    };

    const useRecordAsSource = (record: BoardRecord, nextMode: "extend" | "edit") => {
        if (record.status !== "成功" || !record.video) {
            message.warning("只有成功生成的视频记录可以设为原片");
            return;
        }
        const prepared = prepareSeedance25GeneratedVideoSource(record.video, record.remoteVideoUrl, nextMode, record.seconds);
        if ("error" in prepared) {
            message.warning(prepared.error);
            return;
        }
        setSourceVideo(prepared.video);
        setSourceVideoDuration(prepared.durationSeconds);
        setSourceVideoUrl("");
        setSelectedRecordId(undefined);
        setSelectedDraftId("");
        setSelectedRecordIds([]);
        setPrompt(nextMode === "extend" ? "自然延续上一段的动作与镜头，保持人物、环境、光线和声音连贯。" : "");
        updateConfig("seedance25TaskMode", nextMode);
        if (nextMode === "extend") updateConfig("seedance25Continuation", "natural");
        updateConfig("videoSeconds", nextMode === "extend" ? "10" : "-1");
        updateConfig("size", "adaptive");
        setHistoryOpen(false);
        message.success(`已将“${record.title}”设为${nextMode === "extend" ? "延长视频" : "编辑视频"}的原片`);
    };

    const promptCopy =
        mode === "generate"
            ? {
                  title: "视频内容（必填）",
                  description: "描述画面中发生什么，以及镜头如何移动。",
                  placeholder: "例如：雨后的旧城区，一名骑行者穿过潮湿街道，镜头平稳跟随，路面倒映暖色灯光。",
              }
            : mode === "extend"
              ? {
                    title: "接下来发生什么（必填）",
                    description: "只描述原片结束后的动作、镜头和声音变化。",
                    placeholder: "例如：骑行者继续向前，镜头缓慢升高，街道尽头逐渐亮起。",
                }
              : {
                    title: "要修改什么（必填）",
                    description: "说明需要修改的内容；没有提到的部分会尽量保持不变。",
                    placeholder: "例如：保留人物动作，把白天改成雨夜，并让镜头保持稳定。",
                };
    const imageCopy =
        mode === "generate"
            ? inputMode === "first-frame"
                ? {
                      title: "开场画面（必填）",
                      description: "视频会从这张图片自然开始。",
                      empty: "选择 1 张开场图片",
                  }
                : inputMode === "first-last"
                  ? {
                        title: "开始与结束画面（必填）",
                        description: "先选择开始画面，再选择结束画面。",
                        empty: "依次选择开始和结束图片",
                    }
                  : {
                        title: "参考图片（可选）",
                        description: "需要保持人物、服装、场景或风格时再添加。",
                        empty: "选择参考图片",
                    }
            : mode === "extend"
              ? {
                    title: "补充参考图（可选）",
                    description: "需要让后续画面保持人物、服装或场景时再添加。",
                    empty: "选择补充参考图",
                }
              : {
                    title: "修改参考图（可选）",
                    description: "添加目标人物、服装或场景，帮助模型理解要改成什么。",
                    empty: "选择修改参考图",
                };
    const referenceImageLimit = mode === "generate" && inputMode === "first-frame" ? 1 : mode === "generate" && inputMode === "first-last" ? 2 : SEEDANCE_25_REFERENCE_LIMITS.images;
    const canAddReferenceImage = references.length < referenceImageLimit;
    const sourceTitle = mode === "generate" ? "参考视频（可选）" : "原片（必填）";
    const sourceDescription = sourceVideo
        ? `${mode === "generate" ? "参考视频" : "原片"}已连接，可在上方预览；粘贴新地址可以替换。`
        : mode === "generate"
          ? "需要参考动作、运镜或节奏时添加；不添加也能生成。"
          : mode === "extend"
            ? "连接需要延长的视频，生成内容会接在它的结尾。"
            : "连接需要修改的视频，未提到的内容会尽量保留。";
    const sourceActionLabel = sourceVideo ? (mode === "generate" ? "替换视频" : "替换原片") : mode === "generate" ? "添加参考视频" : "设为原片";
    const sourcePlaceholder = sourceVideo ? `粘贴新地址以替换${mode === "generate" ? "参考视频" : "原片"}` : "粘贴公网视频链接或方舟素材 ID";

    const settings = (
        <BoardSettings
            config={{ ...effectiveConfig, model, videoModel: model }}
            model={model}
            modelOptions={modelOptions}
            mode={mode}
            inputMode={inputMode}
            referenceCounts={referenceCounts}
            totalSeconds={totalSeconds}
            sourceDurationMs={sourceVideo?.durationMs}
            onModelChange={(value) => updateConfig("videoModel", value)}
            onConfigChange={updateConfig}
            onTotalDurationChange={setTotalDuration}
            onOpenConfig={() => openConfigDialog(true)}
        />
    );

    return (
        <div className="wg-media-workbench">
            <MediaWorkbenchHeader kind="sd25" title="专属工作板" onOpenHistory={() => setHistoryOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
            <main className="wg-media-workbench-grid">
                <aside className="wg-media-workbench-pane wg-media-workbench-history">
                    <div className="thin-scrollbar h-full min-h-0 overflow-y-auto p-4">
                        <HistoryPanel
                            drafts={starterDrafts}
                            records={records}
                            selectedDraftId={selectedDraftId}
                            selectedRecordId={selectedRecordId}
                            selectedRecordIds={selectedRecordIds}
                            onSelectedRecordIdsChange={setSelectedRecordIds}
                            onCreate={createSession}
                            onDeleteSelected={() => setDeleteConfirmOpen(true)}
                            onSelectDraft={selectDraft}
                            onSelectRecord={selectRecord}
                        />
                    </div>
                </aside>

                <section className="wg-media-workbench-pane wg-media-workbench-creation">
                    <MediaWorkbenchModeTabs ariaLabel="Seedance 2.5 创作模式" items={seedanceModeTabs} value={mode} onChange={selectMode} />

                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto p-3 sm:p-4">
                        <div className="wg-media-workbench-preview">
                            {activeVideo ? (
                                <div className="absolute inset-0 flex flex-col bg-black">
                                    <video src={activeVideo.url} controls className="min-h-0 flex-1 object-contain" />
                                    <div className="flex flex-wrap items-center justify-between gap-2 bg-black/75 px-3 py-2 text-white">
                                        <span className="truncate text-xs">{activeRecord?.title}</span>
                                        <div className="flex flex-wrap items-center justify-end gap-1">
                                            {activeRecord?.lastFrame ? (
                                                <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10" onClick={() => useLastFrameAsFirstFrame(activeRecord)}>
                                                    <ImagePlus className="size-3.5" />
                                                    尾帧续作
                                                </button>
                                            ) : null}
                                            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10" onClick={() => activeRecord && useRecordAsSource(activeRecord, "extend")}>
                                                <Film className="size-3.5" />
                                                用于延长
                                            </button>
                                            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10" onClick={() => activeRecord && useRecordAsSource(activeRecord, "edit")}>
                                                <Sparkles className="size-3.5" />
                                                用于编辑
                                            </button>
                                            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10" onClick={() => void download(activeVideo)}>
                                                <Download className="size-3.5" />
                                                下载
                                            </button>
                                            <button type="button" className="inline-flex h-8 items-center gap-1.5 rounded-md px-2 text-xs hover:bg-white/10" onClick={() => void saveToAssets(activeVideo)}>
                                                <FolderPlus className="size-3.5" />
                                                存入资产
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ) : sourceVideo && mode !== "generate" ? (
                                <div className="absolute inset-0 flex flex-col bg-black">
                                    <video src={sourceVideo.url} controls className="min-h-0 flex-1 object-contain" />
                                    <div className="flex items-center justify-between bg-black/75 px-3 py-2 text-white">
                                        <span className="truncate text-xs">{sourceVideo.durationMs ? `原片 · ${formatDuration(sourceVideo.durationMs)}` : "远程原片"}</span>
                                        <button type="button" className="inline-flex h-8 items-center rounded-md px-2 text-xs hover:bg-white/10" onClick={() => setSourceVideo(undefined)}>
                                            更换地址
                                        </button>
                                    </div>
                                </div>
                            ) : activeRecord?.status === "生成中" || running ? (
                                <div className="text-center text-[color:var(--wg-studio-muted)]">
                                    <LoaderCircle className="mx-auto size-7 animate-spin" />
                                    <div className="mt-3 text-sm font-semibold text-[color:var(--wg-studio-text)]">正在{actionLabel}</div>
                                    <div className="mt-1 text-xs">完成后会自动保存在本机</div>
                                </div>
                            ) : activeRecord?.status === "失败" ? (
                                <div className="max-w-sm px-6 text-center">
                                    <VideoIcon className="mx-auto size-7 text-[color:var(--wg-studio-muted)]" />
                                    <div className="mt-3 text-sm font-semibold">这次没有生成成功</div>
                                    <div className="mt-1 text-xs leading-5 text-[color:var(--wg-studio-muted)]">{activeRecord.error}</div>
                                </div>
                            ) : (
                                <div className="text-center">
                                    <span className="mx-auto grid size-14 place-items-center rounded-xl border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)] text-[color:var(--wg-studio-accent-strong)] transition group-hover:border-[color:var(--wg-studio-line-strong)]">
                                        <VideoIcon className="size-6" strokeWidth={1.6} />
                                    </span>
                                    <span className="mt-4 block text-[15px] font-semibold">{mode === "generate" ? "从一个镜头开始" : "连接一段原片"}</span>
                                    <span className="mt-1 block text-xs text-[color:var(--wg-studio-muted)]">
                                        {mode === "generate"
                                            ? inputMode === "first-frame"
                                                ? "添加一张开场图片，让视频从这里自然展开"
                                                : inputMode === "first-last"
                                                  ? "依次添加开始和结束图片，控制视频的起点和终点"
                                                  : "直接描述视频，也可以添加参考图片或视频"
                                            : mode === "extend"
                                              ? "先连接原片，再描述视频结束后发生什么"
                                              : "先连接原片，再说明要保留和修改的内容"}
                                    </span>
                                </div>
                            )}
                        </div>

                        <input ref={imageInputRef} type="file" accept="image/*" multiple={inputMode !== "first-frame"} hidden onChange={(event) => void addReferenceImages(event.target.files || [])} />
                        <div className="wg-sd25-composer">
                            {mode !== "generate" ? (
                                <section className="wg-sd25-composer-block" aria-labelledby="sd25-source-heading">
                                    <div className="wg-sd25-field-heading">
                                        <h3 id="sd25-source-heading">{sourceTitle}</h3>
                                        <p>{sourceDescription}</p>
                                    </div>
                                    <div className="wg-sd25-source-fields">
                                        <label>
                                            <span>视频地址</span>
                                            <Input
                                                value={sourceVideoUrl}
                                                onChange={(event) => setSourceVideoUrl(event.target.value)}
                                                onPressEnter={addSourceVideoUrl}
                                                placeholder={sourcePlaceholder}
                                                aria-label="原片视频地址"
                                            />
                                        </label>
                                        <label>
                                            <span>原片时长</span>
                                            <Input type="number" min={mode === "edit" ? 4 : 2} max={30} suffix="秒" value={sourceVideoDuration} onChange={(event) => setSourceVideoDuration(Number(event.target.value))} aria-label="原片时长" />
                                        </label>
                                        <Button onClick={addSourceVideoUrl}>{sourceActionLabel}</Button>
                                    </div>
                                </section>
                            ) : null}

                            <section className="wg-sd25-composer-block" aria-labelledby="sd25-prompt-heading">
                                <div className="wg-sd25-field-heading wg-sd25-action-heading">
                                    <div>
                                        <h3 id="sd25-prompt-heading">{promptCopy.title}</h3>
                                        <p>{promptCopy.description}</p>
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
                                    value={prompt}
                                    autoSize={{ minRows: 3, maxRows: 6 }}
                                    maxLength={2000}
                                    showCount
                                    placeholder={promptCopy.placeholder}
                                    className="wg-sd25-prompt-input !resize-none !rounded-[10px] !border-[color:var(--wg-studio-line)] !bg-transparent !text-[13px] !leading-6"
                                    onChange={(event) => setPrompt(event.target.value)}
                                />
                            </section>

                            {mode === "generate" ? (
                                <section className="wg-sd25-composer-block" aria-labelledby="sd25-start-heading">
                                    <div className="wg-sd25-field-heading">
                                        <h3 id="sd25-start-heading">画面如何开始</h3>
                                        <p>选择一种方式，下面只显示需要的素材。</p>
                                    </div>
                                    <div className="wg-sd25-start-options">
                                        {SEEDANCE_25_INPUT_MODES.map((item) => (
                                            <button key={item.value} type="button" className={inputMode === item.value ? "is-active" : ""} aria-pressed={inputMode === item.value} onClick={() => selectInputMode(item.value)}>
                                                <strong>{item.label}</strong>
                                                <span>{item.description}</span>
                                            </button>
                                        ))}
                                    </div>
                                </section>
                            ) : null}

                            <section className="wg-sd25-composer-block" aria-labelledby="sd25-image-heading">
                                <div className="wg-sd25-field-heading wg-sd25-image-heading">
                                    <div>
                                        <h3 id="sd25-image-heading">{imageCopy.title}</h3>
                                        <p>{imageCopy.description}</p>
                                    </div>
                                    {references.length && canAddReferenceImage ? (
                                        <Button size="small" icon={<ImagePlus className="size-3.5" />} onClick={() => imageInputRef.current?.click()}>
                                            继续添加
                                        </Button>
                                    ) : null}
                                </div>
                                {references.length ? (
                                    <div className="wg-media-reference-strip">
                                        {references.map((item, index) => (
                                            <div key={item.id} className="wg-media-reference-tile">
                                                <img src={item.dataUrl || item.url} alt={item.name} className="size-full object-cover" />
                                                <span className="wg-media-reference-index">{inputMode === "first-frame" ? "开场" : inputMode === "first-last" ? (index === 0 ? "开始" : "结束") : `图片${index + 1}`}</span>
                                                <button type="button" className="wg-media-reference-remove" onClick={() => setReferences((items) => items.filter((image) => image.id !== item.id))} aria-label={`移除${item.name}`}>
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                ) : (
                                    <button type="button" className="wg-sd25-image-empty" onClick={() => imageInputRef.current?.click()}>
                                        <ImagePlus className="size-4" />
                                        <span>{imageCopy.empty}</span>
                                    </button>
                                )}
                                {visibleFrameModeError ? <div className="wg-sd25-field-error" role="status">{visibleFrameModeError}</div> : null}
                            </section>

                            {(mode !== "generate" || inputMode === "reference") && audioReferences.length ? (
                                <section className="wg-sd25-composer-block" aria-labelledby="sd25-audio-heading">
                                    <div className="wg-sd25-field-heading wg-sd25-action-heading">
                                        <div>
                                            <h3 id="sd25-audio-heading">参考音频（可选）</h3>
                                            <p>用于参考声音、节奏或环境氛围。</p>
                                        </div>
                                    </div>
                                    <div className="wg-media-reference-strip mt-3">
                                        {audioReferences.map((item) => (
                                            <div key={item.id} className="wg-media-reference-tile is-audio">
                                                <Music2 className="size-5" />
                                                <span className="max-w-28 truncate text-[11px]">{item.name}</span>
                                                <button type="button" className="wg-media-reference-remove" onClick={() => setAudioReferences((items) => items.filter((audio) => audio.id !== item.id))} aria-label={`移除${item.name}`}>
                                                    <Trash2 className="size-3.5" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </section>
                            ) : null}

                            {mode === "generate" && inputMode === "reference" ? (
                                <section className="wg-sd25-composer-block" aria-labelledby="sd25-source-heading">
                                    <div className="wg-sd25-field-heading">
                                        <h3 id="sd25-source-heading">{sourceTitle}</h3>
                                        <p>{sourceDescription}</p>
                                    </div>
                                    <div className="wg-sd25-source-fields">
                                        <label>
                                            <span>视频地址</span>
                                            <Input value={sourceVideoUrl} onChange={(event) => setSourceVideoUrl(event.target.value)} onPressEnter={addSourceVideoUrl} placeholder={sourcePlaceholder} aria-label="参考视频地址" />
                                        </label>
                                        <label>
                                            <span>素材时长</span>
                                            <Input type="number" min={2} max={30} suffix="秒" value={sourceVideoDuration} onChange={(event) => setSourceVideoDuration(Number(event.target.value))} aria-label="参考视频时长" />
                                        </label>
                                        <Button onClick={addSourceVideoUrl}>{sourceActionLabel}</Button>
                                    </div>
                                </section>
                            ) : null}
                        </div>

                        {mode === "generate" ? (
                            <div className="mt-4 border-t border-[color:var(--wg-studio-line)] pt-4">
                                <div className="mb-2 flex items-center justify-between gap-3">
                                    <div>
                                        <h2 className="text-[15px] font-semibold">镜头序列</h2>
                                        <p className="mt-0.5 text-[10px] text-[color:var(--wg-studio-muted)]">
                                            {shots.length} 个片段 · 共 {totalSeconds} 秒
                                        </p>
                                    </div>
                                    <Button size="small" icon={<Plus className="size-3.5" />} onClick={addShot}>
                                        添加片段
                                    </Button>
                                </div>
                                <div className="flex min-w-0 gap-2 overflow-x-auto pb-2">
                                    {shots.map((shot, index) => (
                                        <button
                                            key={shot.id}
                                            type="button"
                                            className={`group relative min-w-[150px] flex-1 rounded-[10px] border p-3 text-left transition ${selectedShotId === shot.id ? "border-[color:var(--wg-studio-accent-strong)] bg-[color:var(--wg-studio-accent-soft)]/45" : "border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)]/40 hover:border-[color:var(--wg-studio-line-strong)]"}`}
                                            onClick={() => setSelectedShotId(shot.id)}
                                        >
                                            <div className="flex items-center gap-2 text-xs font-semibold">
                                                <GripVertical className="size-3.5 opacity-45" />
                                                {shot.title}
                                                <span className="ml-auto tabular-nums">{shot.seconds}秒</span>
                                            </div>
                                            <div className="mt-3 h-12 rounded-md border border-dashed border-[color:var(--wg-studio-line)] bg-[radial-gradient(circle_at_center,var(--wg-studio-accent-soft),transparent_70%)]" />
                                            {index < shots.length - 1 ? <span className="absolute -right-2 top-1/2 z-10 h-px w-2 bg-[color:var(--wg-studio-line-strong)]" /> : null}
                                        </button>
                                    ))}
                                </div>
                                {selectedShot ? (
                                    <div className="mt-2 grid gap-2 rounded-[10px] border border-[color:var(--wg-studio-line)] p-3 sm:grid-cols-[110px_86px_minmax(0,1fr)_32px]">
                                        <Input value={selectedShot.title} aria-label="片段名称" onChange={(event) => updateShot(selectedShot.id, { title: event.target.value })} />
                                        <Input type="number" min={1} max={30} suffix="秒" value={selectedShot.seconds} aria-label="片段时长" onChange={(event) => updateShotSeconds(selectedShot.id, Number(event.target.value))} />
                                        <Input value={selectedShot.prompt} aria-label="片段内容" onChange={(event) => updateShot(selectedShot.id, { prompt: event.target.value })} />
                                        <Button type="text" aria-label="删除片段" disabled={shots.length <= 1} icon={<Trash2 className="size-3.5" />} onClick={() => removeShot(selectedShot.id)} />
                                    </div>
                                ) : null}
                            </div>
                        ) : null}
                    </div>

                    <div className="wg-media-mobile-cta">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canRun} onClick={() => void generate()}>
                            {actionLabel}
                            {mode === "edit" ? "" : ` · ${taskDurationLabel}`}
                        </Button>
                    </div>
                </section>

                <aside className="wg-media-workbench-pane wg-media-workbench-inspector">
                    <div className="wg-media-inspector-heading">
                        <h2>创作设置</h2>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">{settings}</div>
                    <div className="wg-media-generate-footer">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canRun} onClick={() => void generate()}>
                            {actionLabel}
                            {mode === "edit" ? "" : ` · ${taskDurationLabel}`}
                        </Button>
                    </div>
                </aside>
            </main>

            <Drawer rootClassName="wg-media-workbench-drawer" title="生成记录" placement="bottom" size="large" open={historyOpen} onClose={() => setHistoryOpen(false)}>
                <HistoryPanel
                    drafts={starterDrafts}
                    records={records}
                    selectedDraftId={selectedDraftId}
                    selectedRecordId={selectedRecordId}
                    selectedRecordIds={selectedRecordIds}
                    onSelectedRecordIdsChange={setSelectedRecordIds}
                    onCreate={createSession}
                    onDeleteSelected={() => setDeleteConfirmOpen(true)}
                    onSelectDraft={selectDraft}
                    onSelectRecord={selectRecord}
                />
            </Drawer>
            <Drawer rootClassName="wg-media-workbench-drawer" title="创作设置" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="pb-24">{settings}</div>
                <div className="fixed inset-x-0 bottom-0 border-t border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)]/95 p-4 backdrop-blur">
                    <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canRun} onClick={() => void generate()}>
                        {actionLabel}
                        {mode === "edit" ? "" : ` · ${taskDurationLabel}`}
                    </Button>
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setPrompt} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" acceptedKinds={acceptedAssetKinds} onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={() => void deleteSelectedRecords()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedRecordIds.length} 条生成记录吗？
            </Modal>
        </div>
    );
}

function HistoryPanel({
    drafts,
    records,
    selectedDraftId,
    selectedRecordId,
    selectedRecordIds,
    onSelectedRecordIdsChange,
    onCreate,
    onDeleteSelected,
    onSelectDraft,
    onSelectRecord,
}: {
    drafts: typeof starterDrafts;
    records: BoardRecord[];
    selectedDraftId: string;
    selectedRecordId?: string;
    selectedRecordIds: string[];
    onSelectedRecordIdsChange: (ids: string[]) => void;
    onCreate: () => void;
    onDeleteSelected: () => void;
    onSelectDraft: (draft: (typeof starterDrafts)[number]) => void;
    onSelectRecord: (record: BoardRecord) => void;
}) {
    const items: MediaWorkbenchHistoryItem[] = records.map((record) => ({
        id: record.id,
        title: record.title,
        model: modelOptionName(record.model) || "Seedance 2.5",
        details: [seedance25TaskLabel(record.mode), record.seconds === -1 ? "智能时长" : `${record.seconds}秒`, record.outputFormat.toUpperCase()],
        time: new Date(record.createdAt).toLocaleString(),
        badge: record.status,
        badgeTone: record.status === "失败" ? "failed" : record.status === "生成中" ? "pending" : "default",
        preview: record.video?.url ? { kind: "video", src: record.video.url } : undefined,
        icon: <VideoIcon className="size-5" />,
        selectionDisabled: record.status === "生成中",
    }));

    return (
        <MediaWorkbenchHistory
            countLabel={`${records.length} 条 SD2.5 创作`}
            items={items}
            activeId={selectedRecordId}
            selectedIds={selectedRecordIds}
            onSelectedIdsChange={onSelectedRecordIdsChange}
            onCreate={onCreate}
            onDeleteSelected={onDeleteSelected}
            onOpen={(id) => {
                const record = records.find((item) => item.id === id);
                if (record) onSelectRecord(record);
            }}
        >
            <div className="mt-4 space-y-2.5 border-t border-[color:var(--wg-studio-line)] pt-4">
                {drafts.map((draft) => (
                    <div key={draft.id} className={`wg-media-history-card ${selectedDraftId === draft.id ? "is-active" : ""}`}>
                        <button type="button" className="block w-full text-left focus-visible:outline-none" onClick={() => onSelectDraft(draft)}>
                            <div className="flex gap-2.5">
                                <div className="wg-media-history-thumb" aria-label="创作草稿">
                                    <Film className="size-5" />
                                    <span>草稿</span>
                                </div>
                                <div className="min-w-0 flex-1 py-0.5">
                                    <div className="truncate text-[12px] font-semibold">{draft.title}</div>
                                    <div className="mt-1 text-[10px] text-[color:var(--wg-studio-muted)]">Seedance 2.5</div>
                                    <div className="mt-2 text-[10px] text-[color:var(--wg-studio-muted)]">创作草稿</div>
                                </div>
                            </div>
                        </button>
                    </div>
                ))}
            </div>
        </MediaWorkbenchHistory>
    );
}

function BoardSettings({
    config,
    model,
    modelOptions,
    mode,
    inputMode,
    referenceCounts,
    totalSeconds,
    sourceDurationMs,
    onModelChange,
    onConfigChange,
    onTotalDurationChange,
    onOpenConfig,
}: {
    config: AiConfig;
    model: string;
    modelOptions: string[];
    mode: Seedance25TaskMode;
    inputMode: Seedance25InputMode;
    referenceCounts: { images: number; videos: number; audios: number };
    totalSeconds: number;
    sourceDurationMs?: number;
    onModelChange: (value: string) => void;
    onConfigChange: <K extends keyof AiConfig>(key: K, value: AiConfig[K]) => void;
    onTotalDurationChange: (seconds: number) => void;
    onOpenConfig: () => void;
}) {
    const duration = normalizeSeedance25Duration(config.videoSeconds, mode);
    const resolution = config.vquality === "480" || config.vquality === "480p" ? "480p" : "720p";
    const ratio = ["16:9", "4:3", "1:1", "3:4", "9:16", "21:9", "adaptive"].includes(config.size) ? config.size : "adaptive";
    const outputFormat = normalizeSeedance25OutputFormat(config.seedance25OutputFormat);
    const followsFrame = mode === "generate" && inputMode !== "reference";
    const hasReferences = referenceCounts.images + referenceCounts.videos + referenceCounts.audios > 0;
    const pureTextOnly = mode === "generate" && inputMode === "reference" && !hasReferences;
    return (
        <div className="space-y-5">
            <label className="block">
                <span className="mb-2 block text-sm font-semibold">模型</span>
                <ModelPicker config={config} value={model} options={modelOptions} onChange={onModelChange} capability="video" fullWidth placeholder="选择 Seedance 2.5" onMissingConfig={onOpenConfig} />
                {!modelOptions.length ? (
                    <button type="button" className="mt-2 text-xs font-medium text-[color:var(--wg-studio-accent-strong)]" onClick={onOpenConfig}>
                        添加 Seedance 2.5 模型
                    </button>
                ) : null}
            </label>
            {mode === "generate" ? (
                <SettingBlock label="画面比例">
                    {followsFrame ? (
                        <div className="rounded-[9px] border border-[color:var(--wg-studio-line)] px-3 py-2.5 text-xs text-[color:var(--wg-studio-muted)]">跟随所选图片画幅</div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {["adaptive", "16:9", "4:3", "1:1", "3:4", "9:16", "21:9"].map((value) => (
                                <SettingButton key={value} active={ratio === value} onClick={() => onConfigChange("size", value)}>
                                    {value === "adaptive" ? "智能" : value}
                                </SettingButton>
                            ))}
                        </div>
                    )}
                </SettingBlock>
            ) : (
                <SettingBlock label="画面比例">
                    <div className="rounded-[9px] border border-[color:var(--wg-studio-line)] px-3 py-2.5 text-xs text-[color:var(--wg-studio-muted)]">跟随原片</div>
                </SettingBlock>
            )}
            <SettingBlock label="分辨率">
                <div className="grid grid-cols-2 gap-2">
                    {["480p", "720p"].map((value) => (
                        <SettingButton key={value} active={resolution === value} onClick={() => onConfigChange("vquality", value)}>
                            {value}
                        </SettingButton>
                    ))}
                </div>
            </SettingBlock>
            <SettingBlock label={mode === "extend" ? "延长时长" : "总时长"}>
                {mode === "edit" ? (
                    <div className="rounded-[9px] border border-[color:var(--wg-studio-line)] px-3 py-2.5 text-xs text-[color:var(--wg-studio-muted)]">{sourceDurationMs ? formatDuration(sourceDurationMs) : "跟随原片"}</div>
                ) : (
                    <div className="grid grid-cols-3 gap-2">
                        {mode === "extend" ? (
                            <SettingButton active={duration === -1} onClick={() => onConfigChange("videoSeconds", "-1")}>
                                智能
                            </SettingButton>
                        ) : null}
                        {seedance25DurationOptions(mode).map((value) => (
                            <SettingButton key={value} active={(mode === "generate" ? totalSeconds : duration) === value} onClick={() => (mode === "generate" ? onTotalDurationChange(value) : onConfigChange("videoSeconds", String(value)))}>
                                {value}秒
                            </SettingButton>
                        ))}
                    </div>
                )}
            </SettingBlock>
            {mode === "extend" ? (
                <SettingBlock label="衔接方式">
                    <div className="grid grid-cols-2 gap-2">
                        {SEEDANCE_25_CONTINUATIONS.map((item) => (
                            <SettingButton key={item.value} active={config.seedance25Continuation === item.value} onClick={() => onConfigChange("seedance25Continuation", item.value)}>
                                {item.label}
                            </SettingButton>
                        ))}
                    </div>
                </SettingBlock>
            ) : null}
            <SettingBlock label="输出格式">
                <div className="grid grid-cols-2 gap-2">
                    {SEEDANCE_25_OUTPUT_FORMATS.map((item) => (
                        <SettingButton key={item.value} active={outputFormat === item.value} onClick={() => onConfigChange("seedance25OutputFormat", item.value)}>
                            {item.label} · {item.description}
                        </SettingButton>
                    ))}
                </div>
            </SettingBlock>
            <SettingBlock label="随机种子">
                <Input
                    type="number"
                    min={-1}
                    max={4_294_967_295}
                    value={config.seedance25Seed}
                    onChange={(event) => onConfigChange("seedance25Seed", String(normalizeSeedance25Seed(event.target.value)))}
                    aria-label="随机种子"
                />
                <div className="mt-1.5 text-[11px] text-[color:var(--wg-studio-muted)]">-1 每次随机；填写相同数字可复现相近结果</div>
            </SettingBlock>
            <div className="space-y-3 border-t border-[color:var(--wg-studio-line)] pt-4">
                <SwitchSetting label="生成声音" checked={config.videoGenerateAudio !== "false"} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                <SwitchSetting label="添加水印" checked={config.videoWatermark === "true"} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                <SwitchSetting label="保存尾帧" checked={config.seedance25ReturnLastFrame !== "false"} onChange={(checked) => onConfigChange("seedance25ReturnLastFrame", String(checked))} />
                <SwitchSetting label="联网检索" hint="仅纯文字生成" checked={config.seedance25WebSearch === "true"} disabled={!pureTextOnly} onChange={(checked) => onConfigChange("seedance25WebSearch", String(checked))} />
                <SwitchSetting label="固定机位" hint="仅纯文字生成" checked={config.seedance25CameraFixed === "true"} disabled={!pureTextOnly} onChange={(checked) => onConfigChange("seedance25CameraFixed", String(checked))} />
            </div>
        </div>
    );
}

function SettingBlock({ label, children }: { label: string; children: ReactNode }) {
    return (
        <div>
            <div className="mb-2 text-sm font-semibold">{label}</div>
            {children}
        </div>
    );
}

function SettingButton({ active, children, onClick }: { active: boolean; children: ReactNode; onClick: () => void }) {
    return (
        <button
            type="button"
            className={`min-h-9 rounded-[9px] border px-2 text-xs font-medium transition ${active ? "border-[color:var(--wg-studio-accent-strong)] bg-[color:var(--wg-studio-accent-soft)]/55 text-[color:var(--wg-studio-accent-strong)]" : "border-[color:var(--wg-studio-line)] hover:border-[color:var(--wg-studio-line-strong)]"}`}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SwitchSetting({ label, hint, checked, disabled = false, onChange }: { label: string; hint?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex items-center justify-between gap-3" style={{ opacity: disabled ? 0.52 : 1 }}>
            <span>
                <span className="block text-sm font-semibold">{label}</span>
                {hint ? <span className="mt-0.5 block text-[10px] text-[color:var(--wg-studio-muted)]">{hint}</span> : null}
            </span>
            <Switch checked={checked} disabled={disabled} onChange={onChange} />
        </div>
    );
}

function storyboardPrompt(prompt: string, shots: Shot[]) {
    const sequence = shots.map((shot, index) => `${index + 1}. ${shot.title}（${shot.seconds}秒）：${shot.prompt}`).join("\n");
    return `${prompt.trim()}\n\n镜头序列：\n${sequence}`;
}

function redistributeShotDurations(shots: Shot[], requestedTotal: number) {
    if (!shots.length) return shots;
    const target = Math.max(4, shots.length, Math.min(30, Math.round(requestedTotal)));
    const currentTotal = Math.max(
        1,
        shots.reduce((sum, shot) => sum + shot.seconds, 0),
    );
    const durations = shots.map((shot) => Math.max(1, Math.min(30, Math.round((shot.seconds / currentTotal) * target))));
    let delta = target - durations.reduce((sum, seconds) => sum + seconds, 0);
    let cursor = 0;
    while (delta !== 0 && cursor < shots.length * 60) {
        const index = cursor % shots.length;
        if (delta > 0 && durations[index] < 30) {
            durations[index] += 1;
            delta -= 1;
        } else if (delta < 0 && durations[index] > 1) {
            durations[index] -= 1;
            delta += 1;
        }
        cursor += 1;
    }
    return shots.map((shot, index) => ({ ...shot, seconds: durations[index] }));
}

function toReferenceVideo(video: UploadedFile, name: string): ReferenceVideo {
    return { id: video.storageKey || name, name, type: video.mimeType, url: video.url, storageKey: video.storageKey, bytes: video.bytes, width: video.width, height: video.height, durationMs: video.durationMs };
}

function serializeRecord(record: BoardRecord): BoardRecord {
    return {
        ...record,
        references: record.references?.map((image) => (image.storageKey ? { ...image, dataUrl: "", url: "" } : image)),
        audioReferences: record.audioReferences?.map((audio) => (audio.storageKey ? { ...audio, url: "" } : audio)),
        sourceVideo: record.sourceVideo?.storageKey ? { ...record.sourceVideo, url: "" } : record.sourceVideo,
        video: record.video?.storageKey ? { ...record.video, url: "" } : record.video,
        lastFrame: record.lastFrame?.storageKey ? { ...record.lastFrame, url: "" } : record.lastFrame,
    };
}

async function persistRecord(record: BoardRecord) {
    await recordStore.setItem(record.id, serializeRecord(record));
    const saved = await recordStore.getItem<BoardRecord>(record.id);
    if (!saved || saved.status !== record.status || saved.video?.storageKey !== record.video?.storageKey) throw new Error("创作记录未能保存，请重试");
}

async function loadRecords() {
    const records: BoardRecord[] = [];
    await recordStore.iterate<BoardRecord, void>((record) => records.push(record));
    return Promise.all(
        records
            .sort((a, b) => b.createdAt - a.createdAt)
            .map(async (record) => {
                const restored: BoardRecord = record.status === "生成中" ? { ...record, status: "失败", error: "上次创作未完成，请重新生成" } : record;
                if (restored !== record) await recordStore.setItem(restored.id, serializeRecord(restored));
                return {
                    ...restored,
                    inputMode: normalizeSeedance25InputMode(restored.inputMode),
                    seed: normalizeSeedance25Seed(restored.seed),
                    returnLastFrame: restored.returnLastFrame !== false,
                    webSearch: Boolean(restored.webSearch),
                    cameraFixed: Boolean(restored.cameraFixed),
                    references: await Promise.all(
                        (restored.references || []).map(async (image) => {
                            const url = await resolveImageUrl(image.storageKey, image.dataUrl || image.url || "");
                            return { ...image, dataUrl: url, url };
                        }),
                    ),
                    audioReferences: await Promise.all(
                        (restored.audioReferences || []).map(async (audio) => ({
                            ...audio,
                            url: await resolveMediaUrl(audio.storageKey, audio.url),
                        })),
                    ),
                    sourceVideo: restored.sourceVideo ? { ...restored.sourceVideo, url: await resolveMediaUrl(restored.sourceVideo.storageKey, restored.sourceVideo.url) } : undefined,
                    video: restored.video ? { ...restored.video, url: await resolveMediaUrl(restored.video.storageKey, restored.video.url) } : undefined,
                    lastFrame: restored.lastFrame ? { ...restored.lastFrame, url: await resolveImageUrl(restored.lastFrame.storageKey, restored.lastFrame.url) } : undefined,
                };
            }),
    );
}
