import { type ReactNode, useState } from "react";
import { ConfigProvider, Switch } from "antd";

import { type CanvasTheme } from "@/lib/canvas-theme";
import { modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { modelExperienceKind, supportsArkPromptOptimization } from "@/lib/model-providers";
import { ModelExperienceHeader } from "@/components/model-experience-header";
import { resolveModelUi } from "@/lib/model-ui-adaptation";
import { ModelParamPanel } from "@/components/model-param-panel";

const qualityOptions = [
    { value: "auto", label: "自动" },
    { value: "high", label: "高" },
    { value: "medium", label: "中" },
    { value: "low", label: "低" },
];
const DIMENSION_STEP = 16;

const aspectOptions = [
    { value: "1:1", label: "1:1", width: 1024, height: 1024, icon: "square" },
    { value: "3:2", label: "3:2", width: 1536, height: 1024, icon: "landscape" },
    { value: "2:3", label: "2:3", width: 1024, height: 1536, icon: "portrait" },
    { value: "4:3", label: "4:3", width: 1360, height: 1024, icon: "landscape" },
    { value: "3:4", label: "3:4", width: 1024, height: 1360, icon: "portrait" },
    { value: "16:9", label: "16:9", width: 1824, height: 1024, icon: "landscape" },
    { value: "9:16", label: "9:16", width: 1024, height: 1824, icon: "portrait" },
    { value: "1:1-2k", label: "1:1(2k)", size: "2048x2048", width: 2048, height: 2048, icon: "square" },
    { value: "16:9-2k", label: "16:9(2k)", size: "2048x1152", width: 2048, height: 1152, icon: "landscape" },
    { value: "9:16-2k", label: "9:16(2k)", size: "1152x2048", width: 1152, height: 2048, icon: "portrait" },
    { value: "16:9-4k", label: "16:9(4k)", size: "3840x2160", width: 3840, height: 2160, icon: "landscape" },
    { value: "9:16-4k", label: "9:16(4k)", size: "2160x3840", width: 2160, height: 3840, icon: "portrait" },
    { value: "auto", label: "auto", width: 0, height: 0, icon: "auto" },
];

export const imageQualityOptions = qualityOptions.map((item) => ({ value: item.value, label: item.label }));
export const imageAspectOptions = aspectOptions.map((item) => ({ value: item.size || item.value, label: item.label }));

type ImageSettingsPanelProps = {
    config: AiConfig;
    onConfigChange: (key: "quality" | "size" | "count" | "background" | "imageWatermark" | "imageOptimizePrompt", value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
    maxCount?: number;
    quickCount?: number;
};

export function ImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const requestConfig = resolveModelRequestConfig(config, config.model || config.imageModel);
    const modelName = modelOptionName(config.model || config.imageModel);
    const ui = resolveModelUi(requestConfig.apiFormat, modelName, "image");
    if (ui.kind === "generic") {
        return <ModelParamPanel schema={ui.schema} config={config} onConfigChange={onConfigChange as (key: keyof AiConfig, value: string) => void} theme={theme} showTitle={showTitle} className={className} />;
    }
    if (ui.experience === "grok-image" || ui.experience === "agnes-image" || ui.experience === "seedream-image" || ui.experience === "minimax-image") {
        return (
            <CreatorImageSettingsPanel
                experience={ui.experience}
                config={config}
                onConfigChange={onConfigChange}
                theme={theme}
                showTitle={showTitle}
                className={className}
                maxCount={ui.experience === "minimax-image" ? Math.min(9, maxCount) : ui.experience === "grok-image" ? Math.min(10, maxCount) : maxCount}
                quickCount={ui.experience === "minimax-image" ? Math.min(9, quickCount) : Math.min(4, quickCount)}
            />
        );
    }

    return <DefaultImageSettingsPanel config={config} onConfigChange={onConfigChange} theme={theme} showTitle={showTitle} className={className} maxCount={maxCount} quickCount={quickCount} />;
}

function DefaultImageSettingsPanel({ config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5", maxCount = 15, quickCount = 10 }: ImageSettingsPanelProps) {
    const [snapDimensionToStep, setSnapDimensionToStep] = useState(true);
    const quality = config.quality || "auto";
    const count = Math.max(1, Math.min(maxCount, Math.floor(Math.abs(Number(config.count)) || 1)));
    const activeSize = config.size || "auto";
    const transparentBackground = config.background === "transparent";
    const selectedAspect = aspectOptions.find((item) => (item.size || item.value) === activeSize || item.value === activeSize);
    const dimensions = readSizeDimensions(activeSize, selectedAspect || aspectOptions[0]);
    const selectAspect = (value: string) => {
        const option = aspectOptions.find((item) => item.value === value);
        onConfigChange("size", option?.size || option?.value || "auto");
    };
    const updateDimension = (key: "width" | "height", value: number | null) => {
        const next = Math.max(1, Math.floor(value || dimensions[key] || 1024));
        const width = key === "width" ? next : dimensions.width;
        const height = key === "height" ? next : dimensions.height;
        onConfigChange("size", `${alignDimension(width, snapDimensionToStep)}x${alignDimension(height, snapDimensionToStep)}`);
    };

    return (
        <ImageSettingsTheme theme={theme}>
            <div
                className={className}
                style={{ color: theme.node.text }}
                onMouseDown={(event) => {
                    event.stopPropagation();
                    if (event.target instanceof HTMLInputElement) return;
                    if (document.activeElement instanceof HTMLInputElement && event.currentTarget.contains(document.activeElement)) document.activeElement.blur();
                }}
            >
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <ModelExperienceHeader config={config} capability="image" theme={theme} />
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>质量</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {qualityOptions.map((item) => (
                            <OptionPill key={item.value} selected={quality === item.value} theme={theme} onClick={() => onConfigChange("quality", item.value)}>
                                {item.label}
                            </OptionPill>
                        ))}
                    </div>
                </div>
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between gap-3">
                        <SettingTitle color={theme.node.muted}>尺寸</SettingTitle>
                        <div className="flex items-center gap-2">
                            <span className="text-xs font-medium" style={{ color: theme.node.muted }}>
                                16倍数对齐
                            </span>
                            <span title="输入完成后自动向上补成 16 的倍数" onMouseDown={(event) => event.stopPropagation()}>
                                <Switch size="small" checked={snapDimensionToStep} onChange={setSnapDimensionToStep} />
                            </span>
                        </div>
                    </div>
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2.5">
                        <DimensionInput prefix="W" value={dimensions.width} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("width", value)} />
                        <span className="text-lg opacity-45">↔</span>
                        <DimensionInput prefix="H" value={dimensions.height} disabled={activeSize === "auto"} theme={theme} alignToStep={snapDimensionToStep} onChange={(value) => updateDimension("height", value)} />
                    </div>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>宽高比</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {aspectOptions.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-[72px] cursor-pointer flex-col items-center justify-center gap-1.5 rounded-xl border bg-transparent text-sm transition hover:opacity-80"
                                style={{ borderColor: selectedAspect?.value === item.value ? theme.node.text : theme.node.stroke, background: "transparent", color: theme.node.text }}
                                onMouseDown={(event) => event.stopPropagation()}
                                onClick={() => selectAspect(item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                <div className="flex items-center justify-between gap-3">
                    <div className="space-y-0.5">
                        <SettingTitle color={theme.node.muted}>透明背景</SettingTitle>
                        <div className="text-xs" style={{ color: theme.node.muted, opacity: 0.75 }}>
                            开启后生成无背景的透明图像(仅部分模型可用)
                        </div>
                    </div>
                    <span onMouseDown={(event) => event.stopPropagation()}>
                        <Switch size="small" checked={transparentBackground} onChange={(checked) => onConfigChange("background", checked ? "transparent" : "")} />
                    </span>
                </div>
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                        <CountInput value={count} max={maxCount} theme={theme} onChange={(value) => onConfigChange("count", String(value || 1))} />
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

function CreatorImageSettingsPanel({ experience, config, onConfigChange, theme, showTitle, className, maxCount, quickCount }: ImageSettingsPanelProps & { experience: "grok-image" | "agnes-image" | "seedream-image" | "minimax-image" }) {
    const modelName = modelOptionName(config.model || config.imageModel);
    const quality = config.quality || "auto";
    const activeSize = config.size || "auto";
    const count = Math.max(1, Math.min(maxCount || 10, Math.floor(Math.abs(Number(config.count)) || 1)));
    const ratios =
        experience === "minimax-image"
            ? creatorAspectOptions.filter((item) => item.value !== "adaptive")
            : experience === "grok-image"
              ? creatorAspectOptions.filter((item) => item.value !== "adaptive" && item.value !== "21:9")
              : creatorAspectOptions.filter((item) => item.value !== "21:9");
    const qualityChoices =
        experience === "grok-image"
            ? [
                  { value: "1k", label: "1K", hint: "更快" },
                  { value: "2k", label: "2K", hint: "细节更多" },
              ]
            : experience === "seedream-image"
              ? [
                    { value: "1k", label: "1K", hint: "快速" },
                    { value: "2k", label: "2K", hint: "高清" },
                    { value: "4k", label: "4K", hint: "精细输出" },
                ]
              : [];
    return (
        <ImageSettingsTheme theme={theme}>
            <div className={className} style={{ color: theme.node.text }} onMouseDown={(event) => event.stopPropagation()}>
                {showTitle ? <div className="text-lg font-semibold">图像设置</div> : null}
                <ModelExperienceHeader config={config} capability="image" theme={theme} />
                {experience === "minimax-image" ? (
                    <div className="rounded-xl border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.node.fill }}>
                        <span className="block text-sm font-semibold">人物参考</span>
                        <span className="mt-1 block text-xs leading-5" style={{ color: theme.node.muted }}>
                            可添加 1 张包含清晰人物的参考图，用于保持人物特征；当前不支持蒙版编辑。
                        </span>
                    </div>
                ) : null}
                {qualityChoices.length ? (
                    <div className="space-y-2.5">
                        <SettingTitle color={theme.node.muted}>清晰度</SettingTitle>
                        <div className={`grid gap-2.5 ${qualityChoices.length === 2 ? "grid-cols-2" : "grid-cols-3"}`}>
                            {qualityChoices.map((item) => (
                                <button
                                    key={item.value}
                                    type="button"
                                    className="rounded-xl border px-3 py-2 text-left transition hover:opacity-80"
                                    style={{ borderColor: quality.toLowerCase() === item.value ? theme.node.text : theme.node.stroke }}
                                    onClick={() => onConfigChange("quality", item.value)}
                                >
                                    <span className="block text-sm font-semibold">{item.label}</span>
                                    <span className="mt-0.5 block text-[11px]" style={{ color: theme.node.muted }}>
                                        {item.hint}
                                    </span>
                                </button>
                            ))}
                        </div>
                    </div>
                ) : null}
                <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                        <SettingTitle color={theme.node.muted}>画面比例</SettingTitle>
                        <span className="text-[11px]" style={{ color: theme.node.muted }}>
                            {activeSize === "auto" || activeSize === "adaptive" ? "跟随内容" : activeSize}
                        </span>
                    </div>
                    <div className="grid grid-cols-4 gap-2">
                        {ratios.map((item) => (
                            <button
                                key={item.value}
                                type="button"
                                className="flex h-16 flex-col items-center justify-center gap-1 rounded-xl border text-xs transition hover:opacity-80"
                                style={{ borderColor: activeSize === item.value || (item.value === "adaptive" && activeSize === "auto") ? theme.node.text : theme.node.stroke }}
                                onClick={() => onConfigChange("size", item.value === "adaptive" ? "auto" : item.value)}
                            >
                                <AspectIcon type={item.icon} width={item.width} height={item.height} color={theme.node.text} />
                                <span>{item.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
                {experience === "seedream-image" || experience === "minimax-image" ? (
                    <div className="grid gap-2 rounded-xl border p-2.5" style={{ borderColor: theme.node.stroke }}>
                        {experience === "minimax-image" || supportsArkPromptOptimization(modelName) ? <CreatorSwitch label="优化提示词" hint="让画面描述更完整" checked={config.imageOptimizePrompt !== "false"} onChange={(checked) => onConfigChange("imageOptimizePrompt", String(checked))} theme={theme} /> : null}
                        <CreatorSwitch label="添加水印" hint="在图片角落保留标识" checked={config.imageWatermark === "true"} onChange={(checked) => onConfigChange("imageWatermark", String(checked))} theme={theme} />
                    </div>
                ) : null}
                <div className="space-y-2.5">
                    <SettingTitle color={theme.node.muted}>生成张数</SettingTitle>
                    <div className="grid grid-cols-4 gap-2.5">
                        {Array.from({ length: quickCount || 4 }, (_, index) => index + 1).map((value) => (
                            <OptionPill key={value} selected={count === value} theme={theme} onClick={() => onConfigChange("count", String(value))}>
                                {value} 张
                            </OptionPill>
                        ))}
                    </div>
                </div>
            </div>
        </ImageSettingsTheme>
    );
}

const creatorAspectOptions = [
    { value: "16:9", label: "横屏", width: 16, height: 9, icon: "landscape" },
    { value: "9:16", label: "竖屏", width: 9, height: 16, icon: "portrait" },
    { value: "1:1", label: "方形", width: 1, height: 1, icon: "square" },
    { value: "4:3", label: "经典横幅", width: 4, height: 3, icon: "landscape" },
    { value: "3:4", label: "经典竖幅", width: 3, height: 4, icon: "portrait" },
    { value: "3:2", label: "照片横幅", width: 3, height: 2, icon: "landscape" },
    { value: "2:3", label: "照片竖幅", width: 2, height: 3, icon: "portrait" },
    { value: "21:9", label: "超宽画幅", width: 21, height: 9, icon: "landscape" },
    { value: "adaptive", label: "自适应", width: 0, height: 0, icon: "auto" },
];

function CreatorSwitch({ label, hint, checked, onChange, theme }: { label: string; hint: string; checked: boolean; onChange: (checked: boolean) => void; theme: CanvasTheme }) {
    return (
        <div className="flex items-center justify-between gap-3">
            <span>
                <span className="block text-sm font-medium">{label}</span>
                <span className="block text-[11px]" style={{ color: theme.node.muted }}>
                    {hint}
                </span>
            </span>
            <Switch size="small" checked={checked} onChange={onChange} />
        </div>
    );
}

export function ImageSettingsTheme({ theme, children }: { theme: CanvasTheme; children: ReactNode }) {
    return (
        <ConfigProvider
            theme={{
                token: { colorBgContainer: theme.toolbar.panel, colorBgElevated: theme.toolbar.panel, colorBorder: theme.node.stroke, colorPrimary: theme.node.activeStroke, colorText: theme.node.text, colorTextLightSolid: theme.node.panel },
                components: { Button: { defaultBg: theme.toolbar.panel, defaultBorderColor: theme.node.stroke, defaultColor: theme.node.text } },
            }}
        >
            {children}
        </ConfigProvider>
    );
}

export function imageQualityLabel(value: string) {
    return ({ auto: "自动", high: "高", medium: "中", low: "低", "1k": "1K", "2k": "2K", "4k": "4K" } as Record<string, string>)[value.toLowerCase()] || value;
}

export function imageSizeLabel(size: string) {
    return aspectOptions.find((item) => (item.size || item.value) === size || item.value === size)?.label || size;
}

function OptionPill({ selected, theme, onClick, children }: { selected: boolean; theme: CanvasTheme; onClick: () => void; children: ReactNode }) {
    return (
        <button
            type="button"
            className="h-9 cursor-pointer rounded-full border px-2 text-sm transition hover:opacity-80"
            style={{ background: "transparent", borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
            onMouseDown={(event) => event.stopPropagation()}
            onClick={onClick}
        >
            {children}
        </button>
    );
}

function DimensionInput({ prefix, value, disabled, theme, alignToStep, onChange }: { prefix: string; value: number; disabled: boolean; theme: CanvasTheme; alignToStep: boolean; onChange: (value: number | null) => void }) {
    const commit = (input: HTMLInputElement) => {
        const next = alignDimension(Math.max(1, Math.floor(Number(input.value) || value || 1024)), alignToStep);
        input.value = String(next);
        onChange(next);
    };

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
                defaultValue={value || ""}
                key={`${prefix}-${value}`}
                onBlur={(event) => commit(event.currentTarget)}
                onKeyDown={(event) => {
                    if (event.key === "Enter") event.currentTarget.blur();
                }}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function CountInput({ value, max, theme, onChange }: { value: number; max: number; theme: CanvasTheme; onChange: (value: number | null) => void }) {
    return (
        <label className="col-span-2 flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
            <input
                type="number"
                min={1}
                max={max}
                className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Number(event.target.value) || null)}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function AspectIcon({ type, width, height, color }: { type: string; width: number; height: number; color: string }) {
    if (type === "auto") return null;
    const ratio = width / Math.max(1, height);
    const boxWidth = ratio >= 1 ? 24 : Math.max(10, 24 * ratio);
    const boxHeight = ratio >= 1 ? Math.max(10, 24 / ratio) : 24;
    return (
        <span className="grid h-7 w-9 place-items-center">
            <span className="border-2" style={{ width: boxWidth, height: boxHeight, borderColor: color }} />
        </span>
    );
}

function SettingTitle({ children, color }: { children: string; color: string }) {
    return (
        <div className="text-xs font-medium" style={{ color }}>
            {children}
        </div>
    );
}

function readSizeDimensions(size: string, fallback: { width: number; height: number }) {
    const match = size?.match(/^(\d+)x(\d+)$/);
    return {
        width: match ? Number(match[1]) : fallback.width,
        height: match ? Number(match[2]) : fallback.height,
    };
}

function alignDimension(value: number, enabled: boolean) {
    return enabled ? Math.ceil(value / DIMENSION_STEP) * DIMENSION_STEP : value;
}
