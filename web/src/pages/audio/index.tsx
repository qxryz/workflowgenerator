import { useEffect, useMemo, useRef, useState } from "react";
import { App, Button, Drawer, Input, InputNumber, Modal, Select, Switch, Tag } from "antd";
import { BookOpen, Check, Copy, Download, FileAudio, FolderPlus, LoaderCircle, Mic2, Sparkles, Speech, Trash2, Upload, WandSparkles } from "lucide-react";
import { nanoid } from "nanoid";
import { saveAs } from "file-saver";

import { AssetPickerModal, type InsertAssetPayload } from "@/components/canvas/asset-picker-modal";
import { MediaWorkbenchHeader } from "@/components/media-workbench-header";
import { MediaWorkbenchHistory, type MediaWorkbenchHistoryItem } from "@/components/media-workbench-history";
import { MediaWorkbenchModeTabs } from "@/components/media-workbench-mode-tabs";
import { ModelPicker } from "@/components/model-picker";
import { PromptSelectDialog } from "@/components/prompts/prompt-select-dialog";
import { cn } from "@/lib/utils";
import { formatBytes, formatDuration } from "@/lib/image-utils";
import { qwenAudioLanguageOptions, qwenAudioNativeRoute } from "@/lib/qwen-audio-contract";
import { miniMaxNativeRoute, normalizeMiniMaxVoiceId } from "@/lib/minimax-contract";
import { isMiniMaxAdapter } from "@/lib/model-adapters";
import { createDesktopJsonStore } from "@/services/desktop-storage";
import { deleteStoredMedia, discardUploadedMedia, getMediaBlob, publishUploadedMedia, resolveMediaUrl, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import { assertMiniMaxCloneAudioDuration, assertMiniMaxCloneAudioFile, isMiniMaxAudioModelForTask, requestMiniMaxSpeech, requestMiniMaxVoiceClone } from "@/services/api/minimax-audio";
import { requestQwenSpeech, requestQwenTranscription, requestQwenVoiceClone, isQwenAudioModelForTask, type QwenAudioTask } from "@/services/api/qwen-audio";
import { useAssetStore, type AssetKind } from "@/stores/use-asset-store";
import { encodeChannelModel, modelOptionName, resolveModelRequestConfig, useConfigStore } from "@/stores/use-config-store";

type AudioWorkbenchLog = {
    id: string;
    createdAt: number;
    task: QwenAudioTask;
    title: string;
    model: string;
    input: string;
    status: "成功" | "失败";
    durationMs: number;
    error?: string;
    outputText?: string;
    voiceId?: string;
    audio?: UploadedFile;
};

const logStore = createDesktopJsonStore({
    namespace: "audio-generation-logs-v1",
    legacy: { name: "infinite-canvas", storeName: "audio_generation_logs" },
});

const taskOptions = [
    { value: "speech" as const, label: "语音生成", detail: "文字转成自然语音", icon: Speech },
    { value: "voice-clone" as const, label: "声音克隆", detail: "从声音样本创建音色", icon: Mic2 },
    { value: "transcription" as const, label: "语音转录", detail: "把录音整理为文本", icon: FileAudio },
];

export default function AudioPage() {
    const { message } = App.useApp();
    const config = useConfigStore((state) => state.config);
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef<AbortController | null>(null);
    const pendingVoiceRef = useRef<{ model: string; voice: string } | null>(null);
    const [task, setTask] = useState<QwenAudioTask>("speech");
    const [model, setModel] = useState(config.audioModel);
    const [text, setText] = useState("");
    const [voice, setVoice] = useState(config.audioVoice && config.audioVoice !== "alloy" ? config.audioVoice : "longanhuan_v3.6");
    const [format, setFormat] = useState<"mp3" | "wav" | "flac">(normalizeWorkbenchAudioFormat(config.audioFormat));
    const [language, setLanguage] = useState("auto");
    const [instruction, setInstruction] = useState(config.audioInstructions);
    const [sampleRate, setSampleRate] = useState(24_000);
    const [speechRate, setSpeechRate] = useState(clampSpeechRate(config.audioSpeed));
    const [pitch, setPitch] = useState(1);
    const [volume, setVolume] = useState(50);
    const [speechWatermark, setSpeechWatermark] = useState(false);
    const [sample, setSample] = useState<File | null>(null);
    const [cloneName, setCloneName] = useState("myvoice01");
    const [emotion, setEmotion] = useState("auto");
    const [transcriptHint, setTranscriptHint] = useState("");
    const [enableItn, setEnableItn] = useState(true);
    const [context, setContext] = useState("");
    const [running, setRunning] = useState(false);
    const [result, setResult] = useState<AudioWorkbenchLog | null>(null);
    const [logs, setLogs] = useState<AudioWorkbenchLog[]>([]);
    const [logsOpen, setLogsOpen] = useState(false);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [promptDialogOpen, setPromptDialogOpen] = useState(false);
    const [assetPickerOpen, setAssetPickerOpen] = useState(false);
    const [selectedLogIds, setSelectedLogIds] = useState<string[]>([]);
    const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
    const acceptedAssetKinds = useMemo<AssetKind[]>(() => (task === "speech" ? ["text"] : ["audio"]), [task]);

    const configuredModels = useMemo(() => config.channels.flatMap((channel) => channel.models.filter((entry) => entry.capability === "audio").map((entry) => encodeChannelModel(channel.id, entry.name))), [config.channels]);
    const taskModels = useMemo(
        () =>
            configuredModels.filter((value) => {
                if (isQwenAudioModelForTask(value, task)) return true;
                if (!isMiniMaxAudioModelForTask(value, task)) return false;
                return true;
            }),
        [config, configuredModels, task],
    );
    const isMiniMaxModel = useMemo(() => isMiniMaxAudioModel(config, model), [config, model]);

    useEffect(() => {
        setModel((current) => {
            if (taskModels.includes(current)) return current;
            if (task === "speech" && taskModels.includes(config.audioModel)) return config.audioModel;
            return taskModels[0] || "";
        });
    }, [config.audioModel, task, taskModels]);

    useEffect(() => {
        if (!model) return;
        const requestedVoice = pendingVoiceRef.current?.model === model ? pendingVoiceRef.current.voice : "";
        if (requestedVoice) pendingVoiceRef.current = null;
        const useSavedDefaults = task === "speech" && model === config.audioModel;
        if (isMiniMaxModel) {
            setVoice(requestedVoice || (useSavedDefaults && config.audioVoice && config.audioVoice !== "alloy" ? config.audioVoice : "male-qn-qingse"));
            setLanguage("auto");
            setSampleRate(32_000);
            setSpeechRate(useSavedDefaults ? clampSpeechRate(config.audioSpeed) : 1);
            setFormat(useSavedDefaults ? normalizeWorkbenchAudioFormat(config.audioFormat) : "mp3");
            setInstruction("");
            setPitch(0);
            setVolume(1);
            setEmotion("auto");
            setCloneName("myvoice01");
            return;
        }
        setVoice((current) => requestedVoice || (useSavedDefaults && config.audioVoice && config.audioVoice !== "alloy" ? config.audioVoice : current && current !== "male-qn-qingse" ? current : "longanhuan_v3.6"));
        setLanguage("auto");
        setSampleRate(24_000);
        setSpeechRate(useSavedDefaults ? clampSpeechRate(config.audioSpeed) : 1);
        setPitch(1);
        setVolume(50);
        setEmotion("auto");
        setFormat((current) => (useSavedDefaults ? normalizeWorkbenchAudioFormat(config.audioFormat) : current === "flac" ? "mp3" : current));
        setInstruction(useSavedDefaults ? config.audioInstructions : "");
        setCloneName((current) => current.slice(0, 16).replace(/[^a-zA-Z0-9_]/g, "") || "myvoice01");
    }, [isMiniMaxModel, model, task]);

    useEffect(() => {
        void loadLogs().then(setLogs);
        return () => abortRef.current?.abort();
    }, []);

    useEffect(() => {
        markMediaReferencesChanged();
    }, [logs, result]);

    const canRun = Boolean(model && (task === "speech" ? text.trim() && voice.trim() : task === "voice-clone" ? sample && cloneName.trim() : sample));

    const chooseTask = (next: QwenAudioTask) => {
        if (running) return;
        setTask(next);
        setResult(null);
        setSample(null);
    };

    const chooseModel = (next: string) => {
        setModel(next);
        if (task !== "speech") return;
        const miniMax = isMiniMaxAudioModel(config, next);
        const nextVoice = miniMax ? "male-qn-qingse" : "longanhuan_v3.6";
        updateConfig("audioModel", next);
        updateConfig("audioVoice", nextVoice);
        updateConfig("audioFormat", "mp3");
        updateConfig("audioSpeed", "1");
        updateConfig("audioInstructions", "");
    };

    const changeSpeechDefault = (key: "audioVoice" | "audioFormat" | "audioSpeed" | "audioInstructions", value: string) => {
        if (task === "speech" && model === config.audioModel) updateConfig(key, value);
    };

    const run = async () => {
        if (!model) {
            message.warning("请先在渠道里添加当前任务需要的音频模型");
            openConfigDialog(false, "channels");
            return;
        }
        if (!canRun || running) return;
        const controller = new AbortController();
        abortRef.current = controller;
        const begun = Date.now();
        setRunning(true);
        setResult(null);
        let uploaded: UploadedFile | undefined;
        let completed: AudioWorkbenchLog | undefined;
        try {
            if (task === "speech") {
                const url = isMiniMaxModel
                    ? await requestMiniMaxSpeech(
                          config,
                          model,
                          { text: text.trim(), voiceId: voice.trim(), format, language: language === "auto" ? undefined : language, sampleRate, speed: speechRate, pitch, volume, emotion, watermark: speechWatermark },
                          controller.signal,
                      )
                    : await requestQwenSpeech(
                          config,
                          model,
                          { text: text.trim(), voice: voice.trim(), format: format === "flac" ? "mp3" : format, language: language === "auto" ? undefined : language, sampleRate, instruction, rate: speechRate, pitch, volume, aigcTag: speechWatermark },
                          controller.signal,
                      );
                uploaded = await uploadMediaFile(url, "audio");
                completed = makeLog({ task, model, input: text.trim(), durationMs: Date.now() - begun, audio: uploaded });
            } else if (task === "voice-clone") {
                if (!sample) throw new Error("请先添加声音样本");
                if (isMiniMaxModel) {
                    assertMiniMaxCloneAudioFile(sample);
                    await assertMiniMaxCloneAudioDuration(sample);
                } else assertAudioFile(sample);
                const cloned = isMiniMaxModel
                    ? await requestMiniMaxVoiceClone(config, model, { file: sample, voiceId: cloneName, previewText: transcriptHint }, controller.signal)
                    : await requestQwenVoiceClone(config, model, { audioDataUrl: await fileToDataUrl(sample), name: cloneName, transcript: transcriptHint, language: language === "auto" ? undefined : language }, controller.signal);
                if ("previewUrl" in cloned && cloned.previewUrl) uploaded = await uploadMediaFile(cloned.previewUrl, "audio");
                completed = makeLog({ task, model, input: sample.name, durationMs: Date.now() - begun, voiceId: cloned.voice, outputText: cloned.voice, audio: uploaded });
                setVoice(cloned.voice);
            } else {
                if (!sample) throw new Error("请先添加要转录的音频");
                assertAudioFile(sample);
                const transcribed = await requestQwenTranscription(config, model, { audioDataUrl: await fileToDataUrl(sample), language, enableItn, context }, controller.signal);
                completed = makeLog({ task, model, input: sample.name, durationMs: Date.now() - begun, outputText: transcribed.text });
            }
            await logStore.setItem(completed.id, serializeLog(completed));
            if (uploaded) publishUploadedMedia(uploaded);
            setLogs((current) => [completed!, ...current.filter((item) => item.id !== completed!.id)]);
            setResult(completed);
            message.success(task === "voice-clone" ? "新音色已创建" : task === "transcription" ? "转录完成" : "音频已生成并保存");
        } catch (error) {
            if (uploaded) await discardUploadedMedia(uploaded);
            const detail = error instanceof Error ? error.message : "任务失败，请重试";
            const failed = makeLog({ task, model, input: sample?.name || text.trim(), durationMs: Date.now() - begun, status: "失败", error: detail });
            await logStore.setItem(failed.id, failed).catch(() => undefined);
            setLogs((current) => [failed, ...current]);
            setResult(failed);
            message.error(detail);
        } finally {
            if (abortRef.current === controller) abortRef.current = null;
            setRunning(false);
        }
    };

    const saveToAssets = async (item: AudioWorkbenchLog) => {
        try {
            if (item.audio) {
                await addAssetPersisted({
                    kind: "audio",
                    title: "生成语音",
                    coverUrl: "",
                    tags: [taskLabel(item.task)],
                    source: "音频工作台",
                    data: { url: item.audio.url, storageKey: item.audio.storageKey, durationMs: item.audio.durationMs, bytes: item.audio.bytes, mimeType: item.audio.mimeType },
                    metadata: { source: "audio-workbench", task: item.task, model: modelOptionName(item.model), input: item.input },
                });
            } else if (item.outputText) {
                await addAssetPersisted({
                    kind: "text",
                    title: item.task === "transcription" ? "语音转录" : "克隆音色",
                    coverUrl: "",
                    tags: [taskLabel(item.task)],
                    source: "音频工作台",
                    data: { content: item.outputText },
                    metadata: { source: "audio-workbench", task: item.task, model: modelOptionName(item.model) },
                });
            }
            message.success("已保存到我的资产，可在工作流中直接使用");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "保存资产失败");
        }
    };

    const download = async (item: AudioWorkbenchLog) => {
        if (!item.audio) return;
        const blob = await getMediaBlob(item.audio.storageKey);
        if (!blob) return message.error("本地音频文件不存在");
        const extension = item.audio.mimeType.includes("flac") ? "flac" : item.audio.mimeType.includes("wav") ? "wav" : "mp3";
        saveAs(blob, `speech-${item.id}.${extension}`);
    };

    const insertPickedAsset = async (payload: InsertAssetPayload) => {
        if (payload.kind === "text") {
            if (task !== "speech") {
                message.warning("当前任务需要音频资产");
                return;
            }
            setText(payload.content);
            setAssetPickerOpen(false);
            return;
        }
        if (payload.kind !== "audio") {
            message.warning(task === "speech" ? "语音生成只能使用文本资产" : "当前任务只能使用音频资产");
            return;
        }
        if (task === "speech") {
            message.warning("声音样本请在声音克隆或语音转录中使用");
            return;
        }
        let staged: UploadedFile | undefined;
        try {
            if (!payload.storageKey) staged = await uploadMediaFile(payload.url, "audio-import");
            const blob = await getMediaBlob(payload.storageKey || staged?.storageKey || "");
            if (!blob) throw new Error("找不到这条音频资产的本地文件");
            const file = new File([blob], audioAssetFilename(payload.title, payload.mimeType || blob.type), { type: payload.mimeType || blob.type || "audio/mpeg" });
            if (isMiniMaxModel && task === "voice-clone") {
                assertMiniMaxCloneAudioFile(file);
                await assertMiniMaxCloneAudioDuration(file);
            } else assertAudioFile(file);
            setSample(file);
            setResult(null);
            setAssetPickerOpen(false);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "音频资产读取失败");
        } finally {
            if (staged) await discardUploadedMedia(staged).catch(() => undefined);
        }
    };

    const createSession = () => {
        abortRef.current?.abort();
        setText("");
        setSample(null);
        setResult(null);
        setSelectedLogIds([]);
    };

    const previewLog = (item: AudioWorkbenchLog) => {
        setResult(item);
        setTask(item.task);
        setModel(item.model);
        setLogsOpen(false);
    };

    const deleteSelectedLogs = async () => {
        const deletingIds = [...selectedLogIds];
        const targets = logs.filter((item) => deletingIds.includes(item.id));
        const mediaKeys = targets.map((item) => item.audio?.storageKey).filter((key): key is string => Boolean(key));
        try {
            for (const id of deletingIds) await logStore.removeItem(id);
            if (mediaKeys.length) await deleteStoredMedia(mediaKeys);
            setLogs((current) => current.filter((item) => !deletingIds.includes(item.id)));
            setResult((current) => (current && deletingIds.includes(current.id) ? null : current));
            markMediaReferencesChanged();
            message.success(`已删除 ${deletingIds.length} 条生成记录`);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "删除生成记录失败");
        } finally {
            setSelectedLogIds([]);
            setDeleteConfirmOpen(false);
        }
    };

    const inspector = (
        <AudioInspector
            task={task}
            config={config}
            model={model}
            models={taskModels}
            onModelChange={chooseModel}
            onMissingModel={() => openConfigDialog(false, "channels")}
            voice={voice}
            onVoiceChange={(value) => {
                setVoice(value);
                changeSpeechDefault("audioVoice", value);
            }}
            format={format}
            onFormatChange={(value) => {
                setFormat(value);
                changeSpeechDefault("audioFormat", value);
            }}
            language={language}
            onLanguageChange={setLanguage}
            cloneName={cloneName}
            onCloneNameChange={setCloneName}
            transcriptHint={transcriptHint}
            onTranscriptHintChange={setTranscriptHint}
            enableItn={enableItn}
            onEnableItnChange={setEnableItn}
            context={context}
            onContextChange={setContext}
            instruction={instruction}
            onInstructionChange={(value) => {
                setInstruction(value);
                changeSpeechDefault("audioInstructions", value);
            }}
            sampleRate={sampleRate}
            onSampleRateChange={setSampleRate}
            speechRate={speechRate}
            onSpeechRateChange={(value) => {
                setSpeechRate(value);
                changeSpeechDefault("audioSpeed", String(value));
            }}
            pitch={pitch}
            onPitchChange={setPitch}
            volume={volume}
            onVolumeChange={setVolume}
            speechWatermark={speechWatermark}
            onSpeechWatermarkChange={setSpeechWatermark}
            emotion={emotion}
            onEmotionChange={setEmotion}
        />
    );

    return (
        <div className="wg-media-workbench">
            <MediaWorkbenchHeader kind="audio" title="音频创作" onOpenHistory={() => setLogsOpen(true)} onOpenSettings={() => setSettingsOpen(true)} />
            <main className="wg-media-workbench-grid">
                <aside className="wg-media-workbench-pane wg-media-workbench-history">
                    <div className="thin-scrollbar h-full min-h-0 overflow-y-auto p-4">
                        <AudioLogPanel logs={logs} activeId={result?.id} selectedIds={selectedLogIds} onSelectedIdsChange={setSelectedLogIds} onCreate={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onSelect={previewLog} />
                    </div>
                </aside>
                <section className="wg-media-workbench-pane wg-media-workbench-creation">
                    <MediaWorkbenchModeTabs ariaLabel="音频创作模式" items={taskOptions} value={task} onChange={chooseTask} />
                    <div className="thin-scrollbar flex min-h-0 flex-1 flex-col overflow-y-auto">
                        <div className="p-3 sm:p-4">
                            <div className="wg-media-workbench-preview">
                                <AudioResult
                                    result={result}
                                    running={running}
                                    onSave={saveToAssets}
                                    onDownload={download}
                                    onUseVoice={(voiceId, voiceModel) => {
                                        if (model !== voiceModel) pendingVoiceRef.current = { model: voiceModel, voice: voiceId };
                                        setVoice(voiceId);
                                        setModel(voiceModel);
                                        chooseTask("speech");
                                        message.success("已带入对应模型的语音生成");
                                    }}
                                />
                            </div>
                        </div>
                        <div className="wg-media-composer">
                            <div className="wg-media-composer-heading">
                                <div>
                                    <h2>{composerTitle(task)}</h2>
                                    <p>{composerHint(task)}</p>
                                </div>
                                <div className="flex flex-wrap justify-end gap-2">
                                    {task === "speech" ? (
                                        <Button size="small" icon={<BookOpen className="size-3.5" />} onClick={() => setPromptDialogOpen(true)}>
                                            提示词库
                                        </Button>
                                    ) : null}
                                    <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => setAssetPickerOpen(true)}>
                                        我的资产
                                    </Button>
                                </div>
                            </div>
                            {task === "speech" ? (
                                <Input.TextArea
                                    className="wg-media-prompt-input"
                                    value={text}
                                    onChange={(event) => setText(event.target.value)}
                                    autoSize={{ minRows: 4, maxRows: 9 }}
                                    maxLength={isMiniMaxModel ? 9999 : 6000}
                                    showCount
                                    placeholder="输入要朗读的文字…"
                                />
                            ) : null}
                            {task === "voice-clone" || task === "transcription" ? (
                                <AudioDropZone
                                    file={sample}
                                    onChoose={() => fileInputRef.current?.click()}
                                    onClear={() => setSample(null)}
                                    hint={isMiniMaxModel && task === "voice-clone" ? "WAV、MP3 或 M4A，10 秒–5 分钟，不超过 20 MB" : "WAV、MP3 或 M4A，不超过 10 MB"}
                                />
                            ) : null}
                        </div>
                    </div>
                    <div className="wg-media-mobile-cta">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canRun || running} onClick={() => void run()}>
                            {runLabel(task)}
                        </Button>
                    </div>
                </section>
                <aside className="wg-media-workbench-pane wg-media-workbench-inspector">
                    <div className="wg-media-inspector-heading">
                        <div>
                            <h2>模型与参数</h2>
                            <p>按当前模型与任务调整可用选项</p>
                        </div>
                    </div>
                    <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-4 py-4">
                        <div className="grid grid-cols-2 gap-4">{inspector}</div>
                    </div>
                    <div className="wg-media-generate-footer">
                        <Button type="primary" size="large" block icon={<Sparkles className="size-4" />} loading={running} disabled={!canRun || running} onClick={() => void run()}>
                            {runLabel(task)}
                        </Button>
                    </div>
                </aside>
            </main>
            <input
                ref={fileInputRef}
                type="file"
                accept="audio/wav,audio/mpeg,audio/mp4,audio/x-m4a,.wav,.mp3,.m4a"
                className="hidden"
                onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) {
                        void (async () => {
                            try {
                                if (isMiniMaxModel && task === "voice-clone") {
                                    assertMiniMaxCloneAudioFile(file);
                                    await assertMiniMaxCloneAudioDuration(file);
                                } else assertAudioFile(file);
                                setSample(file);
                            } catch (error) {
                                message.error(error instanceof Error ? error.message : "音频无效");
                            }
                        })();
                    }
                }}
            />
            <Drawer rootClassName="wg-media-workbench-drawer" title="生成记录" placement="bottom" size="large" open={logsOpen} onClose={() => setLogsOpen(false)}>
                <AudioLogPanel logs={logs} activeId={result?.id} selectedIds={selectedLogIds} onSelectedIdsChange={setSelectedLogIds} onCreate={createSession} onDeleteSelected={() => setDeleteConfirmOpen(true)} onSelect={previewLog} />
            </Drawer>
            <Drawer rootClassName="wg-media-workbench-drawer" title="模型与参数" placement="bottom" size="82vh" open={settingsOpen} onClose={() => setSettingsOpen(false)}>
                <div className="grid grid-cols-2 gap-4 pb-24">{inspector}</div>
                <div className="fixed inset-x-0 bottom-0 border-t border-stone-200 bg-white/95 p-4 backdrop-blur dark:border-stone-800 dark:bg-stone-950/95">
                    <Button type="primary" size="large" block loading={running} disabled={!canRun || running} onClick={() => void run()}>
                        {runLabel(task)}
                    </Button>
                </div>
            </Drawer>
            <PromptSelectDialog open={promptDialogOpen} onOpenChange={setPromptDialogOpen} onSelect={setText} />
            <AssetPickerModal open={assetPickerOpen} defaultTab="my-assets" acceptedKinds={acceptedAssetKinds} onInsert={(payload) => void insertPickedAsset(payload)} onClose={() => setAssetPickerOpen(false)} />
            <Modal title="删除生成记录" open={deleteConfirmOpen} onCancel={() => setDeleteConfirmOpen(false)} onOk={() => void deleteSelectedLogs()} okText="删除" okButtonProps={{ danger: true }} cancelText="取消">
                确定删除选中的 {selectedLogIds.length} 条生成记录吗？已保存到“我的资产”的内容不受影响。
            </Modal>
        </div>
    );
}

type InspectorProps = {
    task: QwenAudioTask;
    config: ReturnType<typeof useConfigStore.getState>["config"];
    model: string;
    models: string[];
    onModelChange: (value: string) => void;
    onMissingModel: () => void;
    voice: string;
    onVoiceChange: (value: string) => void;
    format: "mp3" | "wav" | "flac";
    onFormatChange: (value: "mp3" | "wav" | "flac") => void;
    language: string;
    onLanguageChange: (value: string) => void;
    cloneName: string;
    onCloneNameChange: (value: string) => void;
    transcriptHint: string;
    onTranscriptHintChange: (value: string) => void;
    enableItn: boolean;
    onEnableItnChange: (value: boolean) => void;
    context: string;
    onContextChange: (value: string) => void;
    instruction: string;
    onInstructionChange: (value: string) => void;
    sampleRate: number;
    onSampleRateChange: (value: number) => void;
    speechRate: number;
    onSpeechRateChange: (value: number) => void;
    pitch: number;
    onPitchChange: (value: number) => void;
    volume: number;
    onVolumeChange: (value: number) => void;
    speechWatermark: boolean;
    onSpeechWatermarkChange: (value: boolean) => void;
    emotion: string;
    onEmotionChange: (value: string) => void;
};

function AudioInspector(props: InspectorProps) {
    const modelName = modelOptionName(props.model);
    const miniMax = isMiniMaxAudioModel(props.config, props.model);
    const qwenAudioTts = modelName.startsWith("qwen-audio-");
    const request = props.model ? (resolveModelRequestConfig(props.config, props.model) as ReturnType<typeof resolveModelRequestConfig> & { minimaxBillingMode?: "token-plan" | "payg" }) : null;
    const miniMaxBillingMode = request?.minimaxBillingMode || "payg";
    const miniMaxRoute = miniMaxNativeRoute(props.task === "voice-clone" ? "voice-clone" : "speech");
    const qwenRoute = qwenAudioNativeRoute(props.task, modelName);
    const route: { label: string; path: string; docsUrl: string; note: string } = miniMax
        ? {
              label: props.task === "voice-clone" ? "MiniMax 快速声音复刻" : miniMaxRoute.label,
              path: props.task === "voice-clone" ? "/v1/files/upload → /v1/voice_clone" : miniMaxRoute.path,
              docsUrl: miniMaxRoute.docsUrl,
              note: props.task === "voice-clone" ? "先上传声音样本，再创建可直接用于语音生成的音色 ID。" : `当前使用${miniMaxBillingMode === "token-plan" ? " Token Plan" : " API 计费"}线路生成语音。`,
          }
        : qwenRoute;
    const languageOptions = miniMax ? miniMaxLanguageOptions : qwenAudioLanguageOptions(props.task, modelName);
    const cloneVoiceError = miniMax ? miniMaxVoiceIdError(props.cloneName) : "";
    return (
        <>
            <label className="col-span-2 block min-w-0 sm:col-span-1">
                <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">模型</span>
                <ModelPicker config={props.config} value={props.model} options={props.models} onChange={props.onModelChange} capability="audio" fullWidth placeholder="选择音频模型" onMissingConfig={props.onMissingModel} />
            </label>
            <div className="col-span-2 rounded-lg border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)]/55 px-3 py-2.5">
                <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                            <div className="text-xs font-semibold text-[color:var(--wg-studio-text)]">{route.label}</div>
                            {miniMax ? (
                                <Tag className="m-0 border-0 bg-[color:var(--wg-studio-accent-soft)] px-1.5 py-0 text-[10px] text-[color:var(--wg-studio-accent-strong)]">{miniMaxBillingMode === "token-plan" ? "Token Plan" : "API 计费"}</Tag>
                            ) : null}
                        </div>
                        <code className="mt-1 block break-all text-[10px] leading-4 text-[color:var(--wg-studio-muted)]">POST {route.path}</code>
                    </div>
                    <a className="shrink-0 text-[11px] font-medium text-[color:var(--wg-studio-accent-strong)] hover:underline" href={route.docsUrl} target="_blank" rel="noreferrer">
                        接口文档 ↗
                    </a>
                </div>
                <p className="mt-1.5 text-[11px] leading-5 text-[color:var(--wg-studio-muted)]">{route.note}</p>
            </div>
            {props.task === "speech" ? (
                <>
                    <Field label={miniMax ? "音色 ID" : "音色"} wide>
                        <Input value={props.voice} onChange={(event) => props.onVoiceChange(event.target.value)} placeholder="系统音色或克隆后的 voice ID" />
                    </Field>
                    <Field label="语言" wide>
                        <Select className="w-full" value={props.language} options={languageOptions} onChange={props.onLanguageChange} />
                    </Field>
                    {miniMax ? (
                        <>
                            <Field label="情绪" wide>
                                <Select className="w-full" value={props.emotion} options={miniMaxEmotionOptions} onChange={props.onEmotionChange} />
                            </Field>
                            <div className="col-span-2 grid grid-cols-3 gap-2">
                                <Field label="语速">
                                    <InputNumber className="w-full" min={0.5} max={2} step={0.1} value={props.speechRate} onChange={(value) => props.onSpeechRateChange(value || 1)} />
                                </Field>
                                <Field label="音调">
                                    <InputNumber className="w-full" min={-12} max={12} step={1} value={props.pitch} onChange={(value) => props.onPitchChange(value ?? 0)} />
                                </Field>
                                <Field label="音量">
                                    <InputNumber className="w-full" min={0} max={10} step={0.1} value={props.volume} onChange={(value) => props.onVolumeChange(value ?? 1)} />
                                </Field>
                            </div>
                            <Field label="输出格式" wide>
                                <div className="grid grid-cols-2 gap-2">
                                    <Select
                                        value={props.format}
                                        options={[
                                            { value: "mp3", label: "MP3" },
                                            { value: "wav", label: "WAV" },
                                            { value: "flac", label: "FLAC" },
                                        ]}
                                        onChange={props.onFormatChange}
                                    />
                                    <Select value={props.sampleRate} options={[8000, 16000, 22050, 24000, 32000, 44100].map((value) => ({ value, label: `${value / 1000} kHz` }))} onChange={props.onSampleRateChange} />
                                </div>
                            </Field>
                            <Toggle label="AIGC 音频标识" detail="在生成的音频中嵌入 AI 内容标识" checked={props.speechWatermark} onChange={props.onSpeechWatermarkChange} />
                        </>
                    ) : qwenAudioTts ? (
                        <>
                            <Field label="声音指令" wide>
                                <Input.TextArea value={props.instruction} onChange={(event) => props.onInstructionChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：温暖、沉稳的纪录片旁白" />
                            </Field>
                            <div className="col-span-2 grid grid-cols-3 gap-2">
                                <Field label="语速">
                                    <InputNumber className="w-full" min={0.5} max={2} step={0.1} value={props.speechRate} onChange={(value) => props.onSpeechRateChange(value || 1)} />
                                </Field>
                                <Field label="音调">
                                    <InputNumber className="w-full" min={0.5} max={2} step={0.1} value={props.pitch} onChange={(value) => props.onPitchChange(value || 1)} />
                                </Field>
                                <Field label="音量">
                                    <InputNumber className="w-full" min={0} max={100} step={1} value={props.volume} onChange={(value) => props.onVolumeChange(value ?? 50)} />
                                </Field>
                            </div>
                            <Field label="输出格式" wide>
                                <div className="grid grid-cols-2 gap-2">
                                    <Select
                                        value={props.format}
                                        options={[
                                            { value: "mp3", label: "MP3" },
                                            { value: "wav", label: "WAV" },
                                        ]}
                                        onChange={props.onFormatChange}
                                    />
                                    <Select value={props.sampleRate} options={[8000, 16000, 22050, 24000, 44100, 48000].map((value) => ({ value, label: `${value / 1000} kHz` }))} onChange={props.onSampleRateChange} />
                                </div>
                            </Field>
                            <Toggle label="AIGC 音频标识" detail="在支持的 MP3/WAV 中嵌入 AI 内容标识" checked={props.speechWatermark} onChange={props.onSpeechWatermarkChange} />
                        </>
                    ) : (
                        <div className="col-span-2 rounded-lg border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)]/55 p-3 text-xs leading-5 text-[color:var(--wg-studio-muted)]">
                            克隆音色模型使用创建音色时绑定的声音特征，当前接口不接收语速、音调或格式参数。
                        </div>
                    )}
                </>
            ) : null}
            {props.task === "voice-clone" ? (
                <>
                    <Field label={miniMax ? "音色 ID" : "音色名称"}>
                        <Input
                            status={cloneVoiceError ? "error" : undefined}
                            value={props.cloneName}
                            maxLength={miniMax ? 256 : 16}
                            onChange={(event) => props.onCloneNameChange(miniMax ? event.target.value.replace(/[^a-zA-Z0-9_-]/g, "") : event.target.value.replace(/[^a-zA-Z0-9_]/g, ""))}
                            placeholder="如 narrator01"
                        />
                        <p className={cn("mt-1 text-[11px]", cloneVoiceError ? "text-red-500" : "text-[color:var(--wg-studio-muted)]")}>{miniMax ? cloneVoiceError || "8–256 位，以英文字母开头，不能以 - 或 _ 结尾" : "仅字母、数字和下划线，最多 16 位"}</p>
                    </Field>
                    {miniMax ? null : (
                        <Field label="样本语言">
                            <Select className="w-full" value={props.language} options={languageOptions} onChange={props.onLanguageChange} />
                        </Field>
                    )}
                    <Field label={miniMax ? "试听文本（可选）" : "样本文本（可选）"} wide>
                        <Input.TextArea
                            value={props.transcriptHint}
                            onChange={(event) => props.onTranscriptHintChange(event.target.value)}
                            autoSize={{ minRows: 2, maxRows: 5 }}
                            maxLength={miniMax ? 1000 : undefined}
                            showCount={miniMax}
                            placeholder={miniMax ? "创建音色时生成一段试听语音" : "填写样本中实际说的话，有助于提高克隆质量"}
                        />
                        {miniMax ? <p className="mt-1 text-[11px] text-[color:var(--wg-studio-muted)]">填写后会一并返回试听音频，并按试听文本字符数计费。</p> : null}
                    </Field>
                    {miniMax ? (
                        <div className="col-span-2 rounded-lg border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)]/55 p-3 text-xs leading-5 text-[color:var(--wg-studio-muted)]">
                            样本需为 10 秒–5 分钟的单人清晰语音，且不超过 20 MB。创建后的临时音色请在 7 天内至少用于一次正式语音生成。
                        </div>
                    ) : null}
                </>
            ) : null}
            {props.task === "transcription" ? (
                <>
                    <Field label="识别语言" wide>
                        <Select className="w-full" value={props.language} options={languageOptions} onChange={props.onLanguageChange} />
                    </Field>
                    <Toggle label="数字与日期规范化" detail="把口语数字整理成易读格式" checked={props.enableItn} onChange={props.onEnableItnChange} />
                    <Field label="专有词提示（可选）" wide>
                        <Input.TextArea value={props.context} onChange={(event) => props.onContextChange(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} placeholder="例如：人名、品牌名、行业术语" />
                    </Field>
                </>
            ) : null}
        </>
    );
}

function Field({ label, children, wide = false }: { label: string; children: React.ReactNode; wide?: boolean }) {
    return (
        <label className={wide ? "col-span-2 block min-w-0" : "block min-w-0"}>
            <span className="mb-1.5 block text-sm font-semibold sm:mb-2 sm:text-base">{label}</span>
            {children}
        </label>
    );
}
function Toggle({ label, detail, checked, onChange }: { label: string; detail: string; checked: boolean; onChange: (value: boolean) => void }) {
    return (
        <div className="col-span-2 flex items-center justify-between gap-4 rounded-lg border border-[color:var(--wg-studio-line)] bg-[color:var(--wg-studio-raised)]/35 p-3">
            <div>
                <div className="text-sm font-medium">{label}</div>
                <div className="mt-0.5 text-[11px] text-[color:var(--wg-studio-muted)]">{detail}</div>
            </div>
            <Switch checked={checked} onChange={onChange} />
        </div>
    );
}

function AudioDropZone({ file, onChoose, onClear, hint }: { file: File | null; onChoose: () => void; onClear: () => void; hint: string }) {
    return (
        <div className="rounded-xl border border-dashed border-stone-300 p-5 text-center dark:border-stone-700">
            {file ? (
                <div className="flex items-center gap-3 text-left">
                    <div className="grid size-11 place-items-center rounded-full bg-violet-50 text-violet-600 dark:bg-violet-950">
                        <FileAudio className="size-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-medium">{file.name}</div>
                        <div className="text-xs text-stone-500">{formatBytes(file.size)}</div>
                    </div>
                    <Button size="small" icon={<Trash2 className="size-3.5" />} onClick={onClear}>
                        移除
                    </Button>
                </div>
            ) : (
                <button type="button" className="w-full py-6 text-stone-500" onClick={onChoose}>
                    <Upload className="mx-auto mb-2 size-5" />
                    <span className="block text-sm font-medium text-stone-700 dark:text-stone-200">添加音频文件</span>
                    <span className="mt-1 block text-xs">{hint}</span>
                </button>
            )}
        </div>
    );
}

function AudioResult({
    result,
    running,
    onSave,
    onDownload,
    onUseVoice,
}: {
    result: AudioWorkbenchLog | null;
    running: boolean;
    onSave: (item: AudioWorkbenchLog) => void;
    onDownload: (item: AudioWorkbenchLog) => void;
    onUseVoice: (voice: string, model: string) => void;
}) {
    if (running)
        return (
            <div className="wg-media-result-empty">
                <div className="wg-media-result-empty-icon">
                    <LoaderCircle className="size-7 animate-spin" strokeWidth={1.6} />
                </div>
                <h3>正在生成音频</h3>
                <p>任务完成后会自动保存并显示在这里</p>
            </div>
        );
    if (!result)
        return (
            <div className="wg-media-result-empty">
                <div className="wg-media-result-empty-icon">
                    <WandSparkles className="size-7" strokeWidth={1.6} />
                </div>
                <h3>从一个声音想法开始</h3>
                <p>选择任务并填写内容，生成结果会显示在这里</p>
            </div>
        );
    if (result.status === "失败")
        return (
            <div className="overflow-hidden rounded-lg border border-red-200 bg-red-50 dark:border-red-950 dark:bg-red-950/20">
                <div className="flex min-h-56 flex-col items-center justify-center gap-3 p-5 text-center">
                    <div className="text-sm font-medium text-red-600 dark:text-red-300">生成失败</div>
                    <div className="text-xs text-red-500 dark:text-red-300">{result.error}</div>
                </div>
            </div>
        );
    return (
        <div className="wg-media-result-card overflow-hidden rounded-lg border border-stone-200 bg-background dark:border-stone-800">
            <div className="wg-media-result-card-preview block p-4">
                <div className="mb-4 flex items-center gap-3">
                    <div className="grid size-10 place-items-center rounded-full bg-emerald-50 text-emerald-600 dark:bg-emerald-950">
                        <Check className="size-5" />
                    </div>
                    <div>
                        <div className="text-sm font-semibold">{result.title}</div>
                        <div className="text-xs text-stone-500">
                            {modelOptionName(result.model)} · {formatDuration(result.durationMs)}
                        </div>
                    </div>
                </div>
                {result.audio ? <audio className="w-full" controls preload="metadata" src={result.audio.url} /> : null}
                {result.outputText ? <div className="max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-stone-50 p-4 text-sm leading-7 dark:bg-stone-900">{result.outputText}</div> : null}
            </div>
            <div className="wg-media-result-card-actions flex flex-wrap justify-end gap-2 border-t border-stone-200 px-3 py-2.5 dark:border-stone-800">
                {result.voiceId ? (
                    <Button size="small" icon={<Speech className="size-3.5" />} onClick={() => onUseVoice(result.voiceId!, result.model)}>
                        用于语音生成
                    </Button>
                ) : null}
                {result.outputText ? (
                    <Button size="small" icon={<Copy className="size-3.5" />} onClick={() => void navigator.clipboard.writeText(result.outputText!)}>
                        复制文本
                    </Button>
                ) : null}
                <Button size="small" icon={<FolderPlus className="size-3.5" />} onClick={() => void onSave(result)}>
                    保存到我的资产
                </Button>
                {result.audio ? (
                    <Button size="small" icon={<Download className="size-3.5" />} onClick={() => void onDownload(result)}>
                        下载
                    </Button>
                ) : null}
            </div>
        </div>
    );
}

function AudioLogPanel({
    logs,
    activeId,
    selectedIds,
    onSelectedIdsChange,
    onCreate,
    onDeleteSelected,
    onSelect,
}: {
    logs: AudioWorkbenchLog[];
    activeId?: string;
    selectedIds: string[];
    onSelectedIdsChange: (ids: string[]) => void;
    onCreate: () => void;
    onDeleteSelected: () => void;
    onSelect: (item: AudioWorkbenchLog) => void;
}) {
    const items: MediaWorkbenchHistoryItem[] = logs.map((item) => ({
        id: item.id,
        title: item.input || item.title,
        model: modelOptionName(item.model) || "音频模型",
        details: [taskLabel(item.task), audioResultTypeLabel(item), formatDuration(item.durationMs)],
        time: new Date(item.createdAt).toLocaleString(),
        badge: item.status,
        badgeTone: item.status === "失败" ? "failed" : "default",
        icon: item.task === "transcription" ? <FileAudio className="size-5" /> : item.task === "voice-clone" ? <Mic2 className="size-5" /> : <Speech className="size-5" />,
    }));

    return (
        <MediaWorkbenchHistory
            countLabel={`${logs.length} 条音频创作`}
            items={items}
            activeId={activeId}
            selectedIds={selectedIds}
            onSelectedIdsChange={onSelectedIdsChange}
            onCreate={onCreate}
            onDeleteSelected={onDeleteSelected}
            onOpen={(id) => {
                const item = logs.find((log) => log.id === id);
                if (item) onSelect(item);
            }}
        />
    );
}

function audioResultTypeLabel(item: AudioWorkbenchLog) {
    if (item.audio?.mimeType.includes("flac")) return "FLAC";
    if (item.audio?.mimeType.includes("wav")) return "WAV";
    if (item.audio) return "MP3";
    if (item.voiceId) return "音色 ID";
    return "文本";
}

function makeLog(input: Omit<AudioWorkbenchLog, "id" | "createdAt" | "title" | "status"> & { status?: AudioWorkbenchLog["status"] }): AudioWorkbenchLog {
    return { id: nanoid(), createdAt: Date.now(), title: taskLabel(input.task), status: input.status || "成功", ...input };
}
function serializeLog(log: AudioWorkbenchLog) {
    return { ...log, audio: log.audio ? { ...log.audio, url: "" } : undefined };
}
async function loadLogs() {
    const values: AudioWorkbenchLog[] = [];
    await logStore.iterate<AudioWorkbenchLog, void>((value) => {
        if (["speech", "voice-clone", "transcription"].includes(value.task)) values.push(value);
    });
    return (await Promise.all(values.map(async (item) => (item.audio?.storageKey ? { ...item, audio: { ...item.audio, url: await resolveMediaUrl(item.audio.storageKey, item.audio.url) } } : item)))).sort((a, b) => b.createdAt - a.createdAt);
}
function assertAudioFile(file: File) {
    if (file.size > 10 * 1024 * 1024) throw new Error("音频文件不能超过 10 MB");
    if (!/\.(?:wav|mp3|m4a)$/i.test(file.name) && !["audio/wav", "audio/mpeg", "audio/mp4", "audio/x-m4a"].includes(file.type)) throw new Error("请使用 WAV、MP3 或 M4A 音频");
}
function audioAssetFilename(title: string, mimeType: string) {
    const base = title.trim() || "音频素材";
    if (/\.(?:wav|mp3|m4a)$/i.test(base)) return base;
    const normalizedMime = mimeType.toLowerCase();
    const extension = normalizedMime.includes("wav") ? "wav" : normalizedMime.includes("mp4") || normalizedMime.includes("m4a") ? "m4a" : "mp3";
    return `${base}.${extension}`;
}
function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("无法读取音频文件"));
        reader.readAsDataURL(file);
    });
}
function taskLabel(task: QwenAudioTask) {
    return taskOptions.find((item) => item.value === task)?.label || "音频任务";
}
function composerTitle(task: QwenAudioTask) {
    if (task === "speech") return "输入要朗读的内容";
    if (task === "voice-clone") return "添加清晰的声音样本";
    return "添加要转录的录音";
}
function composerHint(task: QwenAudioTask) {
    if (task === "speech") return "可使用系统音色，也可粘贴克隆后的 voice ID";
    if (task === "voice-clone") return "建议 10–20 秒、单人清晰说话、无背景音乐";
    return "短音频不超过 5 分钟、10 MB";
}
function runLabel(task: QwenAudioTask) {
    if (task === "voice-clone") return "创建克隆音色";
    if (task === "transcription") return "开始转录";
    return "生成语音";
}

function normalizeWorkbenchAudioFormat(value: string): "mp3" | "wav" | "flac" {
    return value === "wav" || value === "flac" ? value : "mp3";
}

function clampSpeechRate(value: string | number) {
    return Math.max(0.5, Math.min(2, Number(value) || 1));
}

const miniMaxLanguageOptions = [
    { value: "auto", label: "自动识别" },
    { value: "Chinese", label: "中文" },
    { value: "English", label: "英文" },
    { value: "Chinese,Yue", label: "粤语" },
    { value: "Japanese", label: "日语" },
    { value: "Korean", label: "韩语" },
    { value: "French", label: "法语" },
    { value: "German", label: "德语" },
    { value: "Spanish", label: "西班牙语" },
    { value: "Russian", label: "俄语" },
    { value: "Portuguese", label: "葡萄牙语" },
    { value: "Italian", label: "意大利语" },
    { value: "Arabic", label: "阿拉伯语" },
    { value: "Turkish", label: "土耳其语" },
    { value: "Vietnamese", label: "越南语" },
    { value: "Indonesian", label: "印尼语" },
    { value: "Thai", label: "泰语" },
];

const miniMaxEmotionOptions = [
    { value: "auto", label: "自动" },
    { value: "calm", label: "平静" },
    { value: "happy", label: "开心" },
    { value: "sad", label: "悲伤" },
    { value: "angry", label: "生气" },
    { value: "fearful", label: "害怕" },
    { value: "disgusted", label: "厌恶" },
    { value: "surprised", label: "惊讶" },
    { value: "fluent", label: "流畅" },
    { value: "whipser", label: "耳语" },
];

function isMiniMaxAudioModel(config: ReturnType<typeof useConfigStore.getState>["config"], value: string) {
    if (!value || !isMiniMaxAudioModelForTask(value, "speech")) return false;
    return isMiniMaxAdapter(resolveModelRequestConfig(config, value).adapter);
}

function miniMaxVoiceIdError(value: string) {
    try {
        normalizeMiniMaxVoiceId(value);
        return "";
    } catch (error) {
        return error instanceof Error ? error.message : "MiniMax 音色 ID 格式无效";
    }
}
