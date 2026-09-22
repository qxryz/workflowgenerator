import { useState } from "react";
import { ChevronDown, CirclePlus, Clock3, Image as ImageIcon, LoaderCircle, MessageSquare, Music2, Play, Settings2, Square, Video } from "lucide-react";
import { Button, Dropdown } from "antd";

import { ModelPicker } from "@/components/model-picker";
import { defaultConfig, resolveModelForCapability, useConfigStore, useEffectiveConfig, type AiConfig } from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";
import { CanvasImageSettingsPopover } from "./canvas-image-settings-popover";
import { CanvasAudioSettingsPopover, type CanvasAudioSettingKey } from "./canvas-audio-settings-popover";
import { CanvasVideoSettingsPopover } from "./canvas-video-settings-popover";
import { CanvasTextSettingsPopover } from "./canvas-text-settings-popover";
import type { CanvasGenerationMode, CanvasNodeData, CanvasNodeMetadata } from "@/types/canvas";

type CanvasWorkflowMode = "guided" | "automatic";

const GENERATION_MODES = [
    { value: "image", label: "图片生成", icon: ImageIcon },
    { value: "text", label: "文本生成", icon: MessageSquare },
    { value: "video", label: "视频生成", icon: Video },
    { value: "audio", label: "音频生成", icon: Music2 },
] satisfies readonly { value: CanvasGenerationMode; label: string; icon: typeof ImageIcon }[];

export type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number; videoCount: number; audioCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onStop: (nodeId: string) => void;
    onComposerToggle: () => void;
    workflowMode?: CanvasWorkflowMode;
    workflowStatus?: string;
    pendingInputs?: number | readonly unknown[];
    onAddResultSlot?: (nodeId: string) => void;
};

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onStop, onComposerToggle, workflowMode, workflowStatus = "idle", pendingInputs = 0, onAddResultSlot }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const [detailsOpen, setDetailsOpen] = useState(false);
    const openConfigDialog = useConfigStore((state) => state.openConfigDialog);
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const mode = node.metadata?.generationMode || "image";
    const config = buildNodeConfig(globalConfig, node, mode);
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount || inputSummary.videoCount || inputSummary.audioCount);
    const inputCount = inputSummary.textCount + inputSummary.imageCount + inputSummary.videoCount + inputSummary.audioCount;
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const canGenerate = hasComposerContent || (mode === "audio" ? inputSummary.textCount > 0 : hasAnyInput);
    const pendingInputCount = typeof pendingInputs === "number" ? pendingInputs : pendingInputs.length;
    const isWaitingForReview = workflowStatus === "waiting_review";
    const isWorkflowRunning = ["queued", "running", "persisting"].includes(workflowStatus);
    const isBusy = isRunning || isWorkflowRunning;
    const isWaitingForInputs = pendingInputCount > 0 || workflowStatus === "waiting_inputs" || workflowStatus === "blocked";
    const canGenerateStep = canGenerate && !isWaitingForInputs && !isWaitingForReview;
    const statusText = workflowStatusText(workflowStatus, workflowMode, pendingInputCount);
    const ModeIcon = GENERATION_MODES.find((item) => item.value === mode)?.icon || ImageIcon;

    return (
        <div className="flex h-full w-full cursor-move flex-col px-3 pb-3 pt-7 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="mb-2 flex items-center justify-between gap-3">
                <Dropdown
                    trigger={["click"]}
                    menu={{
                        selectable: true,
                        selectedKeys: [mode],
                        items: GENERATION_MODES.map((item) => ({ key: item.value, label: item.label, icon: <item.icon className="size-3.5" /> })),
                        onClick: ({ key, domEvent }) => {
                            domEvent.stopPropagation();
                            onConfigChange(node.id, { generationMode: key as CanvasGenerationMode });
                        },
                    }}
                >
                    <button
                        type="button"
                        className="inline-flex h-8 min-w-0 cursor-pointer items-center gap-1.5 rounded-md px-1.5 text-sm font-semibold transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={(event) => event.stopPropagation()}
                        aria-label="切换生成类型"
                    >
                        <ModeIcon className="size-4 shrink-0" />
                        <span className="truncate">{generationModeTitle(mode)}</span>
                        <ChevronDown className="size-3.5 shrink-0" style={{ color: theme.node.muted }} />
                    </button>
                </Dropdown>
            </div>

            <div className="mb-2 flex flex-wrap gap-1.5">
                <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border px-2 text-[11px]"
                    style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={onComposerToggle}
                >
                    <Settings2 className="size-3.5" />
                    <span>输入与提示词</span>
                    {inputCount ? (
                        <span className="ml-0.5 font-medium" style={{ color: theme.node.muted }}>
                            · {inputCount} 项
                        </span>
                    ) : null}
                </button>
                <button
                    type="button"
                    className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md px-2 text-[11px] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                    style={{ color: theme.node.muted }}
                    onMouseDown={(event) => event.stopPropagation()}
                    onClick={() => setDetailsOpen((open) => !open)}
                    aria-expanded={detailsOpen}
                >
                    {detailsOpen ? "收起参数" : "模型与参数"}
                </button>
            </div>

            {detailsOpen ? (
                <div className="mb-2 grid min-w-0 cursor-default grid-cols-[minmax(0,1fr)_148px] items-center gap-2" onMouseDown={(event) => event.stopPropagation()}>
                    <ModelPicker className="canvas-compact-control h-10" config={config} value={config.model} onChange={(model) => onConfigChange(node.id, { model })} capability={mode} onMissingConfig={() => openConfigDialog(true)} fullWidth />
                    {mode === "video" ? (
                        <CanvasVideoSettingsPopover
                            config={config}
                            referenceCounts={{ images: inputSummary.imageCount, videos: inputSummary.videoCount, audios: inputSummary.audioCount }}
                            placement="topRight"
                            buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                            onConfigChange={(key, value) => onConfigChange(node.id, videoConfigPatch(key, value))}
                        />
                    ) : mode === "image" ? (
                        <CanvasImageSettingsPopover
                            config={config}
                            placement="topRight"
                            autoAdjustOverflow={false}
                            buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                            onConfigChange={(key, value) => onConfigChange(node.id, key === "count" ? { count: Number(value) || 1 } : { [key]: value })}
                        />
                    ) : mode === "audio" ? (
                        <CanvasAudioSettingsPopover
                            config={config}
                            placement="topRight"
                            buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                            onConfigChange={(key, value) => onConfigChange(node.id, audioConfigPatch(key, value))}
                        />
                    ) : (
                        <CanvasTextSettingsPopover
                            config={config}
                            placement="topRight"
                            buttonClassName="canvas-compact-control !h-10 !w-full !justify-start !rounded-lg !px-2"
                            onConfigChange={(_, value) => onConfigChange(node.id, { reasoningEffort: value })}
                        />
                    )}
                </div>
            ) : null}

            <div className="mt-auto flex cursor-default flex-col gap-1.5" onMouseDown={(event) => event.stopPropagation()}>
                {statusText ? (
                    <div className="flex min-h-5 items-center gap-1.5 px-0.5 text-[11px]" role="status" aria-live="polite" style={{ color: theme.node.muted }}>
                        {isBusy ? <LoaderCircle className="size-3.5 animate-spin" /> : <Clock3 className="size-3.5" />}
                        <span>{statusText}</span>
                    </div>
                ) : null}

                {onAddResultSlot ? (
                    <button
                        type="button"
                        className="inline-flex h-7 w-fit items-center gap-1 rounded-md px-1 text-[11px] transition-colors hover:bg-black/5 dark:hover:bg-white/10"
                        style={{ color: theme.node.muted }}
                        onClick={() => onAddResultSlot(node.id)}
                    >
                        <CirclePlus className="size-3.5" />
                        <span>添加{generationModeLabel(mode)}结果槽</span>
                    </button>
                ) : null}

                {isBusy ? (
                    <Button type="primary" className="!h-9 !w-full !cursor-pointer !rounded-lg" danger onClick={() => onStop(node.id)}>
                        <span className="inline-flex items-center gap-1.5">
                            <Square className="size-3.5 fill-current" />
                            <span>停止</span>
                        </span>
                    </Button>
                ) : (
                    <Button type="primary" className="!h-9 !w-full !cursor-pointer !rounded-lg" disabled={!canGenerateStep} onClick={() => onGenerate(node.id)}>
                        <span className="inline-flex items-center gap-1.5">
                            <Play className="size-4" />
                            <span>生成这一步</span>
                        </span>
                    </Button>
                )}
            </div>
        </div>
    );
}

function buildNodeConfig(globalConfig: AiConfig, node: CanvasNodeData, mode: CanvasGenerationMode): AiConfig {
    return {
        ...globalConfig,
        model: resolveModelForCapability(globalConfig, node.metadata?.model, mode),
        reasoningEffort: node.metadata?.reasoningEffort || globalConfig.reasoningEffort || defaultConfig.reasoningEffort,
        quality: node.metadata?.quality || globalConfig.quality || defaultConfig.quality,
        size: node.metadata?.size || globalConfig.size || defaultConfig.size,
        background: node.metadata?.background ?? globalConfig.background ?? defaultConfig.background,
        imageWatermark: node.metadata?.imageWatermark ?? globalConfig.imageWatermark ?? defaultConfig.imageWatermark,
        imageOptimizePrompt: node.metadata?.imageOptimizePrompt ?? globalConfig.imageOptimizePrompt ?? defaultConfig.imageOptimizePrompt,
        videoSeconds: node.metadata?.seconds || globalConfig.videoSeconds || defaultConfig.videoSeconds,
        vquality: node.metadata?.vquality || globalConfig.vquality || defaultConfig.vquality,
        videoGenerateAudio: node.metadata?.generateAudio || globalConfig.videoGenerateAudio || defaultConfig.videoGenerateAudio,
        videoWatermark: node.metadata?.watermark || globalConfig.videoWatermark || defaultConfig.videoWatermark,
        seedance25TaskMode: node.metadata?.seedance25TaskMode || globalConfig.seedance25TaskMode || defaultConfig.seedance25TaskMode,
        seedance25Continuation: node.metadata?.seedance25Continuation || globalConfig.seedance25Continuation || defaultConfig.seedance25Continuation,
        seedance25OutputFormat: node.metadata?.seedance25OutputFormat || globalConfig.seedance25OutputFormat || defaultConfig.seedance25OutputFormat,
        seedance25InputMode: node.metadata?.seedance25InputMode || globalConfig.seedance25InputMode || defaultConfig.seedance25InputMode,
        seedance25Seed: node.metadata?.seedance25Seed || globalConfig.seedance25Seed || defaultConfig.seedance25Seed,
        seedance25ReturnLastFrame: node.metadata?.seedance25ReturnLastFrame || globalConfig.seedance25ReturnLastFrame || defaultConfig.seedance25ReturnLastFrame,
        seedance25WebSearch: node.metadata?.seedance25WebSearch || globalConfig.seedance25WebSearch || defaultConfig.seedance25WebSearch,
        seedance25CameraFixed: node.metadata?.seedance25CameraFixed || globalConfig.seedance25CameraFixed || defaultConfig.seedance25CameraFixed,
        minimaxVideoInputMode: node.metadata?.minimaxVideoInputMode || globalConfig.minimaxVideoInputMode || defaultConfig.minimaxVideoInputMode,
        minimaxVideoPromptOptimizer: node.metadata?.minimaxVideoPromptOptimizer || globalConfig.minimaxVideoPromptOptimizer || defaultConfig.minimaxVideoPromptOptimizer,
        minimaxVideoFastPretreatment: node.metadata?.minimaxVideoFastPretreatment || globalConfig.minimaxVideoFastPretreatment || defaultConfig.minimaxVideoFastPretreatment,
        audioVoice: node.metadata?.audioVoice || globalConfig.audioVoice || defaultConfig.audioVoice,
        audioFormat: node.metadata?.audioFormat || globalConfig.audioFormat || defaultConfig.audioFormat,
        audioSpeed: node.metadata?.audioSpeed || globalConfig.audioSpeed || defaultConfig.audioSpeed,
        audioInstructions: node.metadata?.audioInstructions || globalConfig.audioInstructions || defaultConfig.audioInstructions,
        count: String(node.metadata?.count || (mode === "image" ? globalConfig.canvasImageCount || globalConfig.count : globalConfig.count) || defaultConfig.count),
    };
}

function videoConfigPatch(key: keyof AiConfig, value: string) {
    if (key === "videoSeconds") return { seconds: value };
    if (key === "videoGenerateAudio") return { generateAudio: value };
    if (key === "videoWatermark") return { watermark: value };
    return { [key]: value };
}

function audioConfigPatch(key: CanvasAudioSettingKey, value: string) {
    if (key === "audioVoice") return { audioVoice: value };
    if (key === "audioFormat") return { audioFormat: value };
    if (key === "audioSpeed") return { audioSpeed: value };
    return { audioInstructions: value };
}

function generationModeLabel(mode: CanvasGenerationMode) {
    if (mode === "image") return "图片";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "文本";
}

function generationModeTitle(mode: CanvasGenerationMode) {
    return GENERATION_MODES.find((item) => item.value === mode)?.label || "图片生成";
}

function workflowStatusText(status: string, mode: CanvasWorkflowMode | undefined, pendingInputCount: number) {
    if (pendingInputCount > 0) return `等待 ${pendingInputCount} 个上游结果`;
    if (status === "waiting_inputs" || status === "blocked") return "等待上游结果";
    if (status === "queued") return "准备运行";
    if (status === "running") return mode === "automatic" ? "正在自动运行" : "正在逐步运行";
    if (status === "persisting") return "正在保存结果";
    if (status === "waiting_review") return "等待检查结果";
    return "";
}
