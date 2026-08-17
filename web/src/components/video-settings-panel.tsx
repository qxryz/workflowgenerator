import { type ReactNode } from "react";
import { Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { boolConfig, isSeedanceVideoConfig, normalizeSeedanceDuration, normalizeSeedanceRatio, normalizeSeedanceResolution, seedanceDurationOptions, seedancePixelLabel, seedanceRatioOptions, seedanceResolutionOptions } from "@/lib/seedance-video";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { modelExperienceKind } from "@/lib/model-providers";
import { ModelExperienceHeader } from "@/components/model-experience-header";
import { resolveModelUi } from "@/lib/model-ui-adaptation";
import { ModelParamPanel } from "@/components/model-param-panel";
import {
    isSeedance25Model,
    normalizeSeedance25Continuation,
    normalizeSeedance25Duration,
    normalizeSeedance25InputMode,
    normalizeSeedance25OutputFormat,
    normalizeSeedance25Seed,
    normalizeSeedance25TaskMode,
    seedance25DurationOptions,
    seedance25InputModeError,
    seedance25ReferenceError,
    SEEDANCE_25_CONTINUATIONS,
    SEEDANCE_25_INPUT_MODES,
    SEEDANCE_25_OUTPUT_FORMATS,
    SEEDANCE_25_TASKS,
    type Seedance25TaskMode,
} from "@/lib/seedance-2-5";
import {
    MINIMAX_HAILUO_DURATIONS,
    MINIMAX_HAILUO_RESOLUTIONS,
    MINIMAX_VIDEO_INPUT_MODES,
    MINIMAX_VIDEO_RATIOS,
    MINIMAX_VIDEO_RESOLUTIONS,
    isMiniMaxHailuoFastModel,
    miniMaxVideoInputModeError,
    normalizeMiniMaxHailuoVideoOptions,
    normalizeMiniMaxVideoInputMode,
    normalizeMiniMaxVideoRatio,
    normalizeMiniMaxVideoResolution,
    resolveMiniMaxVideoInputMode,
    type MiniMaxVideoInputMode,
    type MiniMaxVideoReferenceCounts,
} from "@/lib/minimax-contract";

const resolutionOptions = [
    { value: "720", label: "720p" },
    { value: "480", label: "480p" },
];

const sizeOptions = [
    { value: "1280x720", label: "横屏", width: 1280, height: 720 },
    { value: "720x1280", label: "竖屏", width: 720, height: 1280 },
    { value: "1024x1024", label: "方形", width: 1024, height: 1024 },
    { value: "1792x1024", label: "宽屏", width: 1792, height: 1024 },
    { value: "1024x1792", label: "长图", width: 1024, height: 1792 },
    { value: "auto", label: "auto", width: 0, height: 0 },
];

const secondOptions = [6, 10, 12, 16, 20];

export const videoResolutionOptions = resolutionOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSizeOptions = sizeOptions.map((item) => ({ value: item.value, label: item.label }));
export const videoSecondOptions = secondOptions.map((value) => String(value));

type VideoSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (
        key:
            | "vquality"
            | "size"
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
            | "minimaxVideoFastPretreatment",
        value: string,
    ) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    miniMaxReferenceCounts?: MiniMaxVideoReferenceCounts;
};

export function VideoSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", miniMaxReferenceCounts }: VideoSettingsPanelProps) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.videoModel);
    const modelName = modelOptionName(config.model || config.videoModel);
    const ui = resolveModelUi(requestConfig.apiFormat, modelName, "video");
    if (ui.kind === "generic") {
        return <ModelParamPanel schema={ui.schema} config={config} onConfigChange={onConfigChange as (key: keyof AiConfig, value: string) => void} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (ui.experience === "grok-video" || ui.experience === "agnes-video") {
        return <CreatorVideoSettingsPanel experience={ui.experience} config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (ui.experience === "minimax-video") {
        return <MiniMaxVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} miniMaxReferenceCounts={miniMaxReferenceCounts} />;
    }
    if (ui.experience === "minimax-hailuo-video") {
        return <MiniMaxHailuoVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} miniMaxReferenceCounts={miniMaxReferenceCounts} />;
    }
    if (isSeedance25Model(modelName)) {
        return <Seedance25SettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} miniMaxReferenceCounts={miniMaxReferenceCounts} />;
    }
    if (isSeedanceVideoConfig(config)) {
        return <SeedanceVideoSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} />;
    }

    const seconds = config.videoSeconds || "6";
    const size = normalizeVideoSizeValue(config.size);
    const dimensions = readSizeDimensions(size);
    const resolution = normalizeVideoResolutionValue(config.vquality);
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 720));
        onConfigChange("size", `${key === "width" ? next : dimensions.width}x${key === "height" ? next : dimensions.height}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <SettingGroup title="清晰度" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {resolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                        <ResolutionInput value={resolution} theme={theme} onChange={(value) => onConfigChange("vquality", value)} />
                    </div>
                </SettingGroup>
                <SettingGroup title="尺寸" color={theme.node.muted}>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={size === "auto"} theme={theme} onChange={(value) => updateDimension("height", value)} />
                    </div>
                    <div className="grid grid-cols-3 gap-2.5">
                        {sizeOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[78px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: size === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                                {item.value === "auto" ? null : <span className="text-[11px] leading-none opacity-55">{item.value}</span>}
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="秒数" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {secondOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === String(value)} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                        <NumberInput value={seconds} min={1} max={20} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function MiniMaxHailuoVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, miniMaxReferenceCounts }: VideoSettingsPanelProps) {
    const model = modelOptionName(config.model || config.videoModel);
    const fast = isMiniMaxHailuoFastModel(model);
    const options = normalizeMiniMaxHailuoVideoOptions(config.vquality, Number(config.videoSeconds));
    const promptOptimizer = boolConfig(config.minimaxVideoPromptOptimizer, true);
    const fastPretreatment = promptOptimizer && boolConfig(config.minimaxVideoFastPretreatment, false);
    const watermark = boolConfig(config.videoWatermark, false);
    const imageCount = miniMaxReferenceCounts?.images || 0;
    const setResolution = (resolution: string) => {
        if (resolution === "1080P" && options.duration === 10) onConfigChange("videoSeconds", "6");
        onConfigChange("vquality", resolution);
    };
    const setDuration = (duration: number) => {
        if (duration === 10 && options.resolution === "1080P") onConfigChange("vquality", "768P");
        onConfigChange("videoSeconds", String(duration));
    };
    const setPromptOptimizer = (enabled: boolean) => {
        onConfigChange("minimaxVideoPromptOptimizer", String(enabled));
        if (!enabled) onConfigChange("minimaxVideoFastPretreatment", "false");
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <div className="rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {fast ? (imageCount === 1 ? "已添加首帧图片。" : "Fast 模型需要一张首帧图片。") : imageCount === 1 ? "将从这张首帧图片开始生成。" : "当前为文生视频；也可添加一张首帧图片。"}
                </div>
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {MINIMAX_HAILUO_RESOLUTIONS.map((value) => (
                            <OptionPill key={value} selected={options.resolution === value} theme={theme} onClick={() => setResolution(value)}>
                                {value}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title={`时长 · ${options.duration} 秒`} color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {MINIMAX_HAILUO_DURATIONS.map((value) => (
                            <OptionPill key={value} selected={options.duration === value} theme={theme} onClick={() => setDuration(value)}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                    <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                        10 秒使用 768P；1080P 使用 6 秒。
                    </div>
                </SettingGroup>
                <SettingGroup title="生成选项" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="提示词优化" checked={promptOptimizer} theme={theme} onChange={setPromptOptimizer} />
                        <SwitchRow label="快速预处理" checked={fastPretreatment} disabled={!promptOptimizer} theme={theme} onChange={(checked) => onConfigChange("minimaxVideoFastPretreatment", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function MiniMaxVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className, miniMaxReferenceCounts }: VideoSettingsPanelProps) {
    const resolution = normalizeMiniMaxVideoResolution(config.vquality);
    const counts = miniMaxReferenceCounts || { images: 0, videos: 0, audios: 0 };
    const inputMode = normalizeMiniMaxVideoInputMode(config.minimaxVideoInputMode);
    const resolvedMode = resolveMiniMaxVideoInputMode(inputMode, counts);
    const modeError = miniMaxVideoInputModeError(inputMode, counts);
    const hasReference = counts.images + counts.videos + counts.audios > 0;
    const followsFrame = resolvedMode === "first-frame" || resolvedMode === "last-frame" || resolvedMode === "first-last";
    const ratio = followsFrame ? "adaptive" : normalizeMiniMaxVideoRatio(config.size, hasReference);
    const duration = Math.max(4, Math.min(15, Math.floor(Number(config.videoSeconds) || 6)));
    const watermark = boolConfig(config.videoWatermark, false);
    const ratioLabels: Record<(typeof MINIMAX_VIDEO_RATIOS)[number], string> = {
        adaptive: "素材自适应",
        "21:9": "宽银幕",
        "16:9": "横屏",
        "4:3": "标准横屏",
        "1:1": "方形",
        "3:4": "标准竖屏",
        "9:16": "竖屏",
    };
    const modeLabels: Record<MiniMaxVideoInputMode, string> = {
        auto: "自动",
        "first-frame": "首帧",
        "last-frame": "尾帧",
        "first-last": "首尾帧",
        reference: "参考素材",
    };
    const modeHint = miniMaxModeHint(inputMode, resolvedMode, counts, modeError);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <div className="rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    选择素材用途后再生成；自动模式会按素材组合匹配首帧、首尾帧或参考素材。
                </div>
                <SettingGroup title="素材模式" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {MINIMAX_VIDEO_INPUT_MODES.map((mode) => {
                            const unavailable = Boolean(miniMaxVideoInputModeError(mode, counts));
                            return (
                                <OptionPill key={mode} selected={inputMode === mode} disabled={unavailable} theme={theme} onClick={() => onConfigChange("minimaxVideoInputMode", mode)}>
                                    {modeLabels[mode]}
                                </OptionPill>
                            );
                        })}
                    </div>
                    <div className="text-[11px] leading-5" style={{ color: modeError ? theme.node.text : theme.node.muted }} role={modeError ? "alert" : undefined}>
                        {modeHint}
                    </div>
                </SettingGroup>
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {MINIMAX_VIDEO_RESOLUTIONS.map((value) => (
                            <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>
                                {value}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="画面比例" color={theme.node.muted}>
                    {followsFrame ? (
                        <div className="rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                            {resolvedMode === "first-last" ? "首尾帧模式会跟随素材画幅，比例固定为素材自适应。" : resolvedMode === "last-frame" ? "尾帧模式会跟随素材画幅，比例固定为素材自适应。" : "首帧模式会跟随素材画幅，比例固定为素材自适应。"}
                        </div>
                    ) : (
                        <div className="grid grid-cols-3 gap-2">
                            {MINIMAX_VIDEO_RATIOS.filter((value) => hasReference || value !== "adaptive").map((value) => (
                                <button
                                    key={value}
                                    type="button"
                                    className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-xs transition hover:opacity-80"
                                    style={{ borderColor: ratio === value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onMouseDown={(event) => event.stopPropagation()}
                                    onClick={() => onConfigChange("size", value)}
                                >
                                    {value === "adaptive" ? null : <SizePreview width={Number(value.split(":")[0])} height={Number(value.split(":")[1])} color={theme.node.text} />}
                                    <span>{ratioLabels[value]}</span>
                                    <span className="text-[10px] opacity-55">{value}</span>
                                </button>
                            ))}
                        </div>
                    )}
                    <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>
                        {followsFrame ? "帧模式始终使用素材自适应。" : hasReference ? "参考素材模式可使用素材自适应或指定比例。" : "纯文字生成不能使用素材自适应。"}
                    </div>
                </SettingGroup>
                <SettingGroup title={`时长 · ${duration} 秒`} color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {[4, 6, 8, 10, 12, 15].map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                    <NumberInput value={String(duration)} min={4} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function miniMaxModeHint(inputMode: MiniMaxVideoInputMode, resolvedMode: Exclude<MiniMaxVideoInputMode, "auto">, counts: MiniMaxVideoReferenceCounts, error: string) {
    if (error) return `${error}，请调整素材或切换模式。`;
    if (inputMode === "reference") return `${counts.images} 张图片、${counts.videos} 个视频、${counts.audios} 个音频将作为参考素材；1–2 张图片也不会转为首尾帧。`;
    if (inputMode === "first-frame") return "图片将固定为首帧。";
    if (inputMode === "last-frame") return "图片将固定为尾帧。";
    if (inputMode === "first-last") return "第 1 张图是首帧，第 2 张图是尾帧，可用箭头调整顺序。";
    if (resolvedMode === "first-frame") return "检测到 1 张图片，将自动作为首帧。";
    if (resolvedMode === "first-last") return "检测到 2 张图片，将自动作为首帧和尾帧。";
    if (counts.images + counts.videos + counts.audios > 0) return "当前素材将自动作为参考素材。";
    return "当前为纯文字生成；添加素材后会自动匹配用途。";
}

function Seedance25SettingsPanel({ config, onConfigChange, theme, showTitle, className, miniMaxReferenceCounts }: VideoSettingsPanelProps) {
    const mode = normalizeSeedance25TaskMode(config.seedance25TaskMode);
    const continuation = normalizeSeedance25Continuation(config.seedance25Continuation);
    const counts = miniMaxReferenceCounts || { images: 0, videos: 0, audios: 0 };
    const inputMode = normalizeSeedance25InputMode(config.seedance25InputMode);
    const duration = normalizeSeedance25Duration(config.videoSeconds, mode);
    const resolution = normalizeSeedanceResolution(config.vquality) === "480p" ? "480p" : "720p";
    const followsFrame = mode === "generate" && inputMode !== "reference";
    const ratio = followsFrame ? "adaptive" : normalizeSeedanceRatio(config.size);
    const outputFormat = normalizeSeedance25OutputFormat(config.seedance25OutputFormat);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);
    const taskInputError =
        mode === "generate"
            ? seedance25InputModeError(mode, inputMode, counts)
            : seedance25ReferenceError(
                  mode,
                  Array.from({ length: counts.videos }, (_, index) => ({ id: String(index), name: `视频${index + 1}`, type: "video/mp4", url: "" })),
              );
    const hasReferences = counts.images + counts.videos + counts.audios > 0;
    const pureTextOnly = mode === "generate" && inputMode === "reference" && !hasReferences;
    const setMode = (nextMode: Seedance25TaskMode) => {
        onConfigChange("seedance25TaskMode", nextMode);
        onConfigChange("videoSeconds", String(normalizeSeedance25Duration(config.videoSeconds, nextMode)));
        if (nextMode !== "generate") {
            onConfigChange("size", "adaptive");
            onConfigChange("seedance25InputMode", "reference");
        }
    };
    const setInputMode = (nextMode: (typeof SEEDANCE_25_INPUT_MODES)[number]["value"]) => {
        onConfigChange("seedance25InputMode", nextMode);
        if (nextMode !== "reference") {
            onConfigChange("size", "adaptive");
            onConfigChange("seedance25WebSearch", "false");
            onConfigChange("seedance25CameraFixed", "false");
        }
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">Seedance 2.5 设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <SettingGroup title="任务" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {SEEDANCE_25_TASKS.map((item) => (
                            <OptionPill key={item.value} selected={mode === item.value} theme={theme} onClick={() => setMode(item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                    <div className="text-[11px] leading-5" style={{ color: taskInputError ? theme.node.text : theme.node.muted }} role={taskInputError ? "status" : undefined}>
                        {mode === "generate"
                            ? taskInputError ||
                              (inputMode === "first-frame"
                                  ? "添加 1 张开场图片后生成。"
                                  : inputMode === "first-last"
                                    ? "依次添加开始和结束两张图片后生成。"
                                    : "可直接写文字，也可添加图片、视频或音频参考。")
                            : taskInputError || (mode === "extend" ? "会从原片结尾继续生成，并保持人物、运动与声音连贯。" : "只修改提示词中指定的内容，其余时间线保持不变。")}
                    </div>
                </SettingGroup>

                {mode === "generate" ? (
                    <SettingGroup title="画面如何开始" color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2">
                            {SEEDANCE_25_INPUT_MODES.map((item) => (
                                <OptionPill key={item.value} selected={inputMode === item.value} theme={theme} onClick={() => setInputMode(item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                        <div className="text-[11px] leading-5" style={{ color: theme.node.muted }}>{SEEDANCE_25_INPUT_MODES.find((item) => item.value === inputMode)?.description}</div>
                    </SettingGroup>
                ) : null}

                {mode !== "edit" ? (
                    <SettingGroup title={mode === "extend" ? "延长时长" : duration === -1 ? "总时长 · 智能" : `总时长 · ${duration} 秒`} color={theme.node.muted}>
                        <div className="grid grid-cols-3 gap-2">
                            <OptionPill selected={duration === -1} theme={theme} onClick={() => onConfigChange("videoSeconds", "-1")}>
                                智能
                            </OptionPill>
                            {seedance25DurationOptions(mode).map((value) => (
                                <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                    {value}s
                                </OptionPill>
                            ))}
                        </div>
                        {duration === -1 ? null : <NumberInput value={String(duration)} min={4} max={30} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />}
                    </SettingGroup>
                ) : null}

                {mode === "extend" ? (
                    <SettingGroup title="衔接方式" color={theme.node.muted}>
                        <div className="grid grid-cols-2 gap-2">
                            {SEEDANCE_25_CONTINUATIONS.map((item) => (
                                <OptionPill key={item.value} selected={continuation === item.value} theme={theme} onClick={() => onConfigChange("seedance25Continuation", item.value)}>
                                    {item.label}
                                </OptionPill>
                            ))}
                        </div>
                    </SettingGroup>
                ) : null}

                {mode === "generate" ? (
                    <SettingGroup title="画面比例" color={theme.node.muted}>
                        {followsFrame ? (
                            <div className="rounded-xl border px-3 py-2.5 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>跟随所选图片画幅，比例固定为素材自适应。</div>
                        ) : (
                            <div className="grid grid-cols-3 gap-2">
                                {seedanceRatioOptions.map((item) => (
                                    <button
                                        key={item.value}
                                        type="button"
                                        className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border bg-transparent text-xs transition hover:opacity-80"
                                        style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                        onClick={() => onConfigChange("size", item.value)}
                                    >
                                        <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                        <span>{item.label}</span>
                                    </button>
                                ))}
                            </div>
                        )}
                    </SettingGroup>
                ) : null}

                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2.5">
                        {["480p", "720p"].map((value) => (
                            <OptionPill key={value} selected={resolution === value} theme={theme} onClick={() => onConfigChange("vquality", value)}>
                                {value}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid grid-cols-2 gap-2">
                        {SEEDANCE_25_OUTPUT_FORMATS.map((item) => (
                            <OptionPill key={item.value} selected={outputFormat === item.value} theme={theme} onClick={() => onConfigChange("seedance25OutputFormat", item.value)}>
                                {item.label} · {item.description}
                            </OptionPill>
                        ))}
                    </div>
                    <div className="mt-2 grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                        <SwitchRow label="保存尾帧" checked={config.seedance25ReturnLastFrame !== "false"} theme={theme} onChange={(checked) => onConfigChange("seedance25ReturnLastFrame", String(checked))} />
                        <SwitchRow label="联网检索 · 仅纯文字" checked={config.seedance25WebSearch === "true"} disabled={!pureTextOnly} theme={theme} onChange={(checked) => onConfigChange("seedance25WebSearch", String(checked))} />
                        <SwitchRow label="固定机位 · 仅纯文字" checked={config.seedance25CameraFixed === "true"} disabled={!pureTextOnly} theme={theme} onChange={(checked) => onConfigChange("seedance25CameraFixed", String(checked))} />
                    </div>
                </SettingGroup>
                <SettingGroup title="随机种子 · -1 为随机" color={theme.node.muted}>
                    <NumberInput value={String(normalizeSeedance25Seed(config.seedance25Seed))} min={-1} max={4_294_967_295} theme={theme} onChange={(value) => onConfigChange("seedance25Seed", String(normalizeSeedance25Seed(value)))} />
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function SeedanceVideoSettingsPanel({ config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps) {
    const resolution = normalizeSeedanceResolution(config.vquality);
    const ratio = normalizeSeedanceRatio(config.size);
    const duration = normalizeSeedanceDuration(config.videoSeconds);
    const generateAudio = boolConfig(config.videoGenerateAudio, true);
    const watermark = boolConfig(config.videoWatermark, false);

    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <div className="rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    连接图片、视频或音频后会自动作为参考素材；提示词中可用“图片1”“视频1”准确指代。
                </div>
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceResolutionOptions.map((item) => (
                            <OptionPill key={item.value} selected={resolution === item.value} theme={theme} onClick={() => onConfigChange("vquality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2.5">
                        {seedanceRatioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[68px] cursor-pointer flex-col items-center justify-center gap-1 rounded-xl border bg-transparent px-1 text-sm transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={ratioPreview(item.value).width} height={ratioPreview(item.value).height} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] leading-none opacity-55">{item.value === "adaptive" ? "adaptive" : seedancePixelLabel(resolution, item.value)}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="时长" color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2.5">
                        {seedanceDurationOptions.map((value) => (
                            <OptionPill key={value} selected={duration === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value === -1 ? "智能" : `${value}s`}
                            </OptionPill>
                        ))}
                    </div>
                    <NumberInput value={String(duration)} min={-1} max={15} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title="输出" color={theme.node.muted}>
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        <SwitchRow label="生成声音" checked={generateAudio} theme={theme} onChange={(checked) => onConfigChange("videoGenerateAudio", String(checked))} />
                        <SwitchRow label="添加水印" checked={watermark} theme={theme} onChange={(checked) => onConfigChange("videoWatermark", String(checked))} />
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function CreatorVideoSettingsPanel({ experience, config, onConfigChange, theme, showTitle, className }: VideoSettingsPanelProps & { experience: "grok-video" | "agnes-video" }) {
    const grok = experience === "grok-video";
    const seconds = Math.max(grok ? 1 : 3, Math.min(grok ? 15 : 18, Math.floor(Number(config.videoSeconds) || 6)));
    const ratio = normalizeCreatorRatio(config.size);
    const resolution = normalizeVideoResolution(config.vquality);
    const durationOptions = grok ? [3, 5, 6, 8, 10, 12, 15] : [3, 6, 9, 12, 18];
    const ratioOptions = grok
        ? [
              { value: "16:9", label: "横屏" },
              { value: "9:16", label: "竖屏" },
              { value: "1:1", label: "方形" },
              { value: "4:3", label: "标准横屏" },
              { value: "3:4", label: "标准竖屏" },
              { value: "3:2", label: "照片横幅" },
              { value: "2:3", label: "照片竖幅" },
          ]
        : [
              { value: "16:9", label: "横屏" },
              { value: "9:16", label: "竖屏" },
              { value: "1:1", label: "方形" },
          ];
    const resolutionChoices = grok ? ["480p", "720p", ...(modelOptionName(config.model || config.videoModel).includes("1.5") ? ["1080p"] : [])] : ["720p"];
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">视频设置</div> : null}
                <ModelExperienceHeader config={config} capability="video" theme={theme} />
                <div className="rounded-xl border px-3 py-2 text-xs leading-5" style={{ borderColor: theme.node.stroke, color: theme.node.muted }}>
                    {grok ? "一张图片会作为首帧；多张图片会用于人物、物体和风格引导。" : "不添加图片时从文字创作，添加一张图片时会从这张画面开始运动。"}
                </div>
                <SettingGroup title={`时长 · ${seconds} 秒`} color={theme.node.muted}>
                    <div className="grid grid-cols-4 gap-2">
                        {durationOptions.map((value) => (
                            <OptionPill key={value} selected={seconds === value} theme={theme} onClick={() => onConfigChange("videoSeconds", String(value))}>
                                {value}s
                            </OptionPill>
                        ))}
                    </div>
                    <NumberInput value={String(seconds)} min={grok ? 1 : 3} max={grok ? 15 : 18} theme={theme} onChange={(value) => onConfigChange("videoSeconds", value)} />
                </SettingGroup>
                <SettingGroup title="画面比例" color={theme.node.muted}>
                    <div className="grid grid-cols-3 gap-2">
                        {ratioOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs transition hover:opacity-80"
                                style={{ borderColor: ratio === item.value ? theme.node.text : theme.node.stroke }}
                                onClick={() => onConfigChange("size", item.value)}
                            >
                                <SizePreview width={Number(item.value.split(":")[0])} height={Number(item.value.split(":")[1])} color={theme.node.text} />
                                <span>{item.label}</span>
                                <span className="text-[10px] opacity-55">{item.value}</span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
                <SettingGroup title="分辨率" color={theme.node.muted}>
                    <div className={`grid gap-2.5 ${resolutionChoices.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                        {resolutionChoices.map((value) => (
                            <button
                                key={value}
                                type="button"
                                className="rounded-xl border px-3 py-2 text-left transition hover:opacity-80"
                                style={{ borderColor: resolution === value ? theme.node.text : theme.node.stroke }}
                                onClick={() => onConfigChange("vquality", value)}
                            >
                                <span className="block text-sm font-semibold">{value}</span>
                                <span className="mt-0.5 block text-[11px]" style={{ color: theme.node.muted }}>
                                    {value === "480p" ? "更快预览" : value === "1080p" ? "仅图生视频" : "清晰输出"}
                                </span>
                            </button>
                        ))}
                    </div>
                </SettingGroup>
            </div>
        </ImageSettingsTheme>
    );
}

function normalizeCreatorRatio(value: string) {
    if (/^\d+:\d+$/.test(value)) return value;
    return normalizeVideoSizeValue(value) === "720x1280" ? "9:16" : "16:9";
}

function normalizeVideoResolution(value: string) {
    const normalized = normalizeVideoResolutionValue(value);
    return /k$/i.test(normalized) ? "720p" : `${normalized}p`;
}

export function videoResolutionLabel(value: string) {
    const normalized = normalizeVideoResolutionValue(value);
    return /k$/i.test(normalized) ? normalized.toUpperCase() : `${normalized}p`;
}

export function videoSizeLabel(value: string) {
    const ratio = normalizeSeedanceRatio(value);
    if (value === "adaptive" || value === "auto") return "自适应";
    if (ratio === value) return seedanceRatioOptions.find((item) => item.value === ratio)?.label || ratio;
    const size = normalizeVideoSizeValue(value);
    return sizeOptions.find((item) => item.value === size)?.label || size;
}

export function videoSecondsLabel(value: string) {
    if (String(value).trim() === "-1") return "智能";
    return `${value || "6"}s`;
}

export function normalizeVideoSizeValue(value: string) {
    if (value === "auto") return "auto";
    if (/^\d+x\d+$/.test(value || "")) return value;
    return ["9:16", "2:3", "3:4"].includes(value) ? "720x1280" : "1280x720";
}

export function normalizeVideoResolutionValue(value: string) {
    if (value === "480p" || value === "low") return "480";
    if (value === "720p" || value === "auto" || value === "high" || value === "medium") return "720";
    return value.replace(/p$/i, "") || "720";
}

function OptionPill({ selected, disabled = false, theme, onClick, children }: { selected: boolean; disabled?: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            disabled={disabled}
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80 disabled:cursor-not-allowed disabled:opacity-35"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function SettingGroup({ title, color, children }: { title: string; color: string; children: ReactNode }) {
    return (
        <div className="space-y-2.5">
            <div className="text-xs font-medium" style={{ color }}>
                {title}
            </div>
            {children}
        </div>
    );
}

function ResolutionInput({ value, theme, onChange }: { value: string; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value}
                onChange={(event) => onChange(event.target.value)}
                onMouseDown={(event) => event.stopPropagation()}
            />
            <span className="grid w-7 place-items-center pr-1" style={{ color: theme.node.muted }}>
                p
            </span>
        </label>
    );
}

function DimensionInput({ prefix, value, disabled, theme, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text, opacity: disabled ? 0.55 : 1 }}>
            <span className="grid w-9 place-items-center" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                disabled={disabled}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function NumberInput({ value, min, max, theme, onChange }: { value: string; min: number; max: number; theme: CanvasTheme; onChange: (value: string) => void }) {
    return (
        <input
            type="number"
            min={min}
            max={max}
            className="h-9 rounded-full border bg-transparent px-3 text-center text-sm outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
            style={{ borderColor: theme.node.stroke, color: theme.node.text, WebkitTextFillColor: theme.node.text }}
            value={value}
            onChange={(event) => onChange(event.target.value)}
            onMouseDown={(event) => event.stopPropagation()}
        />
    );
}

function SizePreview({ width, height, color }: { width: number; height: number; color: string }) {
    if (!width || !height) return null;
    const longSide = Math.max(width, height);
    const previewWidth = Math.max(10, Math.round((width / longSide) * 26));
    const previewHeight = Math.max(10, Math.round((height / longSide) * 26));
    return <span className="rounded-[3px] border-2" style={{ width: previewWidth, height: previewHeight, borderColor: color }} />;
}

function ratioPreview(ratio: string) {
    if (ratio === "9:16") return { width: 9, height: 16 };
    if (ratio === "1:1") return { width: 1, height: 1 };
    if (ratio === "4:3") return { width: 4, height: 3 };
    if (ratio === "3:4") return { width: 3, height: 4 };
    if (ratio === "21:9") return { width: 21, height: 9 };
    if (ratio === "adaptive") return { width: 0, height: 0 };
    return { width: 16, height: 9 };
}

function SwitchRow({ label, checked, disabled = false, theme, onChange }: { label: string; checked: boolean; disabled?: boolean; theme: CanvasTheme; onChange: (checked: boolean) => void }) {
    return (
        <div className="flex h-8 items-center justify-between gap-3" style={{ opacity: disabled ? 0.5 : 1 }}>
            <span className="text-sm" style={{ color: theme.node.text }}>
                {label}
            </span>
            <span onMouseDown={(event) => event.stopPropagation()}>
                <Switch size="small" checked={checked} disabled={disabled} onChange={onChange} />
            </span>
        </div>
    );
}

function readSizeDimensions(size: string) {
    if (size === "auto") return { width: 0, height: 0 };
    const match = size.match(/^(\d+)x(\d+)$/);
    return { width: Number(match?.[1]) || 1280, height: Number(match?.[2]) || 720 };
}
