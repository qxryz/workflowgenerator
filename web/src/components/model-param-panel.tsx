import { type ReactNode } from "react";
import { Switch } from "antd";

import { ImageSettingsTheme } from "@/components/image-settings-panel";
import { type CanvasTheme } from "@/lib/canvas-theme";
import { numberValue, optionValues, switchValue, type ModelParamSchema, type ParamControl } from "@/lib/model-param-schema";
import type { AiConfig } from "@/stores/use-config-store";

export type ModelParamPanelProps = {
    schema: ModelParamSchema;
    config: AiConfig;
    onConfigChange: (key: keyof AiConfig, value: string) => void;
    theme: CanvasTheme;
    showTitle?: boolean;
    className?: string;
};

/**
 * 参数 schema 通用渲染器：面板控件全部由数据驱动。
 * 新增模型只需要声明 schema，不需要写新的 JSX。
 */
export function ModelParamPanel({ schema, config, onConfigChange, theme, showTitle = true, className = "w-[320px] space-y-4 rounded-2xl px-1 py-0.5" }: ModelParamPanelProps) {
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
                {showTitle ? <div className="text-lg font-semibold">{schema.title || "参数设置"}</div> : null}
                {schema.controls.map((control, index) => (
                    <Control key={`${control.type}-${"key" in control ? String(control.key) : "label" in control ? control.label : index}-${index}`} control={control} config={config} onConfigChange={onConfigChange} theme={theme} />
                ))}
            </div>
        </ImageSettingsTheme>
    );
}

function Control({ control, config, onConfigChange, theme }: { control: ParamControl; config: AiConfig; onConfigChange: ModelParamPanelProps["onConfigChange"]; theme: CanvasTheme }) {
    if (control.type === "group") {
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{control.label}</SettingTitle>
                {control.controls.map((child, index) => (
                    <Control key={`${child.type}-${"key" in child ? String(child.key) : index}`} control={child} config={config} onConfigChange={onConfigChange} theme={theme} />
                ))}
            </div>
        );
    }
    if (control.type === "options") {
        const active = optionValues(control, config);
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{control.label}</SettingTitle>
                <div className={`grid gap-2.5 ${gridColumns(control.columns)}`}>
                    {control.options.map((option) => (
                        <button
                            key={option.value}
                            type="button"
                            className="rounded-xl border px-3 py-2 text-left transition hover:opacity-80"
                            style={{ borderColor: active === option.value ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                            onClick={() => onConfigChange(control.key, option.value)}
                        >
                            <span className="block text-sm font-medium">{option.label}</span>
                            {option.hint ? (
                                <span className="mt-0.5 block text-[11px]" style={{ color: theme.node.muted }}>
                                    {option.hint}
                                </span>
                            ) : null}
                        </button>
                    ))}
                </div>
            </div>
        );
    }
    if (control.type === "switch") {
        const checked = switchValue(control, config);
        return (
            <div className="flex items-center justify-between gap-3">
                <span>
                    <span className="block text-sm font-medium">{control.label}</span>
                    {control.hint ? (
                        <span className="block text-[11px]" style={{ color: theme.node.muted }}>
                            {control.hint}
                        </span>
                    ) : null}
                </span>
                <Switch size="small" checked={checked} onChange={(next) => onConfigChange(control.key, next ? control.onValue ?? "true" : control.offValue ?? "false")} />
            </div>
        );
    }
    if (control.type === "textarea") {
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{control.label}</SettingTitle>
                <textarea
                    className="thin-scrollbar min-h-16 w-full resize-none rounded-xl border bg-transparent px-3 py-2 text-sm leading-5 outline-none focus-visible:ring-2"
                    style={{ borderColor: theme.node.stroke, color: theme.node.text }}
                    placeholder={control.placeholder}
                    value={String(config[control.key] || "")}
                    onChange={(event) => onConfigChange(control.key, event.target.value)}
                    onMouseDown={(event) => event.stopPropagation()}
                />
            </div>
        );
    }
    if (control.type === "dimension") {
        const raw = String(config[control.key] || "");
        const match = raw.match(/^(\d+)x(\d+)$/);
        const width = match ? Number(match[1]) : undefined;
        const height = match ? Number(match[2]) : undefined;
        const align = (value: number) => (control.step ? Math.max(1, Math.round(value / control.step) * control.step) : value);
        const commit = (nextWidth: number, nextHeight: number) => onConfigChange(control.key, `${align(nextWidth)}x${align(nextHeight)}`);
        return (
            <div className="space-y-2.5">
                <SettingTitle color={theme.node.muted}>{control.label}</SettingTitle>
                {control.options?.length ? (
                    <div className="grid grid-cols-4 gap-1.5">
                        {control.options.map((option) => {
                            const selected = raw === option.value;
                            return (
                                <button
                                    key={option.value}
                                    type="button"
                                    className="rounded-md border px-1 py-1.5 text-[11px] transition hover:opacity-80"
                                    style={{ borderColor: selected ? theme.node.text : theme.node.stroke, color: theme.node.text }}
                                    onClick={() => onConfigChange(control.key, option.value)}
                                >
                                    {option.label}
                                </button>
                            );
                        })}
                    </div>
                ) : null}
                <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                    <DimensionInput prefix="W" value={width ?? 1024} theme={theme} onChange={(value) => commit(value, height ?? 1024)} />
                    <span className="text-sm opacity-45">×</span>
                    <DimensionInput prefix="H" value={height ?? 1024} theme={theme} onChange={(value) => commit(width ?? 1024, value)} />
                </div>
            </div>
        );
    }
    const value = numberValue(control, config);
    return (
        <div className="space-y-2.5">
            <SettingTitle color={theme.node.muted}>{control.label}</SettingTitle>
            <label className="flex h-9 overflow-hidden rounded-full border text-sm" style={{ borderColor: theme.node.stroke, color: theme.node.text }}>
                <input
                    type="number"
                    min={control.min}
                    max={control.max}
                    step={control.step}
                    className="min-w-0 flex-1 bg-transparent px-3 text-center outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                    style={{ color: theme.node.text, WebkitTextFillColor: theme.node.text }}
                    value={value || ""}
                    onChange={(event) => onConfigChange(control.key, String(Number(event.target.value) || control.min || 1))}
                    onBlur={(event) => {
                        if (control.normalize) onConfigChange(control.key, control.normalize(event.target.value));
                    }}
                    onMouseDown={(event) => event.stopPropagation()}
                />
                {control.suffix ? (
                    <span className="grid shrink-0 place-items-center pr-3 text-xs" style={{ color: theme.node.muted }}>
                        {control.suffix}
                    </span>
                ) : null}
            </label>
        </div>
    );
}

function DimensionInput({ prefix, value, theme, onChange }: { prefix: string; value: number; theme: CanvasTheme; onChange: (value: number) => void }) {
    return (
        <label className="flex h-9 overflow-hidden rounded-xl text-sm" style={{ background: theme.node.fill, color: theme.node.text }}>
            <span className="grid w-9 place-items-center text-xs" style={{ color: theme.node.muted }}>
                {prefix}
            </span>
            <input
                type="number"
                min={1}
                className="min-w-0 flex-1 bg-transparent px-2 outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                style={{ color: theme.node.text }}
                value={value || ""}
                onChange={(event) => onChange(Math.max(1, Math.floor(Number(event.target.value) || 1)))}
                onMouseDown={(event) => event.stopPropagation()}
            />
        </label>
    );
}

function SettingTitle({ color, children }: { color: string; children: ReactNode }) {
    return <div className="text-sm font-medium" style={{ color }}>{children}</div>;
}

function gridColumns(columns: 2 | 3 | 4 | 5 | undefined) {
    if (columns === 5) return "grid-cols-5";
    if (columns === 4) return "grid-cols-4";
    if (columns === 3) return "grid-cols-3";
    return "grid-cols-2";
}
