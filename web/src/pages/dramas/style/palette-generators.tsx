import { Input, InputNumber, Segmented, Select } from "antd";
import { Plus, Shuffle } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { COLOUR_PALETTE_PRESETS, MAX_PALETTE_COLORS, MIN_PALETTE_COLORS, colourTextColor, createColourHarmony, generateRandomPalette, normalizeHexColor, type ColourHarmony } from "@/lib/drama/style/colour-palettes";
import { sameColours } from "@/lib/drama/style/palette-edit";
import type { DramaPalette } from "@/lib/drama/types";
import { cn } from "@/lib/utils";

type Mode = "preset" | "harmony" | "random";
type Props = { current: DramaPalette | null; full: boolean; onUse: (palette: DramaPalette) => void; onAdd: (color: string) => void };

const HARMONIES: Array<{ value: ColourHarmony; label: string }> = [
    { value: "analogous", label: "类似色" },
    { value: "complementary", label: "互补色" },
    { value: "triadic", label: "三角色" },
    { value: "split-complementary", label: "分裂互补色" },
    { value: "shades", label: "深浅变化" },
];

export const Strip = ({ colors, className }: { colors: readonly string[]; className?: string }) => (
    <span className={cn("flex h-10 overflow-hidden rounded-md", className)} aria-hidden>
        {colors.map((color, index) => (
            <span key={`${color}${index}`} className="flex-1" style={{ backgroundColor: color }} />
        ))}
    </span>
);

/** 推荐 / 协调 / 随机: three ways to start a palette. Each ends in "use this" or a click on one colour to add it. */
export function PaletteGenerators({ current, full, onUse, onAdd }: Props) {
    const { t } = useAppTranslation();
    const [mode, setMode] = useState<Mode>("preset");
    const [base, setBase] = useState(current?.colors[0] ?? "#3B82F6");
    const [baseText, setBaseText] = useState(base);
    const [harmony, setHarmony] = useState<ColourHarmony>("analogous");
    const [count, setCount] = useState(5);
    const [random, setRandom] = useState(() => generateRandomPalette(5));
    const suggestions = createColourHarmony(base, harmony);

    const commitBase = (value: string) => {
        const hex = normalizeHexColor(value);
        if (hex) setBase(hex);
        setBaseText(hex ?? base);
    };
    return (
        <div className="flex flex-col gap-4">
            <Segmented
                block
                size="small"
                value={mode}
                onChange={setMode}
                options={[
                    { value: "preset", label: t("推荐") },
                    { value: "harmony", label: t("协调") },
                    { value: "random", label: t("随机") },
                ]}
            />
            {mode === "preset" ? (
                <div className="grid grid-cols-2 gap-3">
                    {COLOUR_PALETTE_PRESETS.map((preset) => {
                        const active = sameColours(preset.colors, current?.colors);
                        return (
                            <button
                                key={preset.name}
                                type="button"
                                aria-pressed={active}
                                onClick={() => onUse({ name: t(preset.name), colors: [...preset.colors] })}
                                className={cn(
                                    "overflow-hidden rounded-lg border text-left transition-colors",
                                    active ? "border-[color:var(--wg-home-accent)] ring-1 ring-[color:var(--wg-home-accent)]" : "border-[color:var(--wg-home-line)] hover:border-[color:var(--wg-home-line-strong)]",
                                )}
                            >
                                <Strip colors={preset.colors} className="h-12 rounded-none" />
                                <span className="block truncate px-2.5 py-1.5 text-[12px]">{t(preset.name)}</span>
                            </button>
                        );
                    })}
                </div>
            ) : null}
            {mode === "harmony" ? (
                <div className="flex flex-col gap-3">
                    <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-3">
                        <label className="flex flex-col gap-1.5">
                            <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("基础色")}</span>
                            <span className="flex items-center gap-2">
                                <input
                                    type="color"
                                    value={base}
                                    aria-label={t("基础色")}
                                    className="h-8 w-10 shrink-0 cursor-pointer rounded border border-[color:var(--wg-home-line)] bg-transparent p-0.5"
                                    onChange={(event) => {
                                        setBase(event.target.value.toUpperCase());
                                        setBaseText(event.target.value.toUpperCase());
                                    }}
                                />
                                <Input
                                    className="!w-24 font-mono"
                                    maxLength={7}
                                    value={baseText}
                                    aria-label={t("基础色 HEX")}
                                    onChange={(event) => setBaseText(event.target.value)}
                                    onBlur={() => commitBase(baseText)}
                                    onPressEnter={() => commitBase(baseText)}
                                />
                            </span>
                        </label>
                        <label className="flex min-w-0 flex-col gap-1.5">
                            <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("配色方式")}</span>
                            <Select value={harmony} onChange={setHarmony} options={HARMONIES.map((item) => ({ value: item.value, label: t(item.label) }))} />
                        </label>
                    </div>
                    <div className="flex h-20 gap-1.5">
                        {suggestions.map((color) => (
                            <button
                                key={color}
                                type="button"
                                disabled={full}
                                title={t("添加到色卡")}
                                aria-label={t("添加颜色 {color}", { color })}
                                onClick={() => onAdd(color)}
                                className="group flex flex-1 flex-col items-center justify-end gap-1 rounded-md pb-1.5 disabled:cursor-not-allowed"
                                style={{ backgroundColor: color, color: colourTextColor(color) }}
                            >
                                <Plus className="size-3.5 opacity-0 transition-opacity group-hover:opacity-100" strokeWidth={1.8} />
                                <span className="font-mono text-[10px]">{color}</span>
                            </button>
                        ))}
                    </div>
                    <button type="button" className="wg-text-button !h-9 justify-center !border !border-[color:var(--wg-home-line)]" onClick={() => onUse({ name: t("协调色卡"), colors: suggestions })}>
                        {t("整组使用")}
                    </button>
                </div>
            ) : null}
            {mode === "random" ? (
                <div className="flex flex-col gap-3">
                    <div className="flex items-center gap-3">
                        <label className="flex items-center gap-2 text-[12px] text-[color:var(--wg-home-muted)]">
                            {t("颜色数量")}
                            <InputNumber
                                size="small"
                                min={MIN_PALETTE_COLORS}
                                max={MAX_PALETTE_COLORS}
                                value={count}
                                onChange={(value) => {
                                    if (!value) return;
                                    setCount(value);
                                    setRandom(generateRandomPalette(value));
                                }}
                            />
                        </label>
                        <button type="button" className="wg-text-button !h-8 ml-auto !border !border-[color:var(--wg-home-line)]" onClick={() => setRandom(generateRandomPalette(count))}>
                            <Shuffle className="size-4" strokeWidth={1.6} />
                            {t("换一组")}
                        </button>
                    </div>
                    <Strip colors={random.colors} className="h-20" />
                    <button type="button" className="wg-text-button !h-9 justify-center !border !border-[color:var(--wg-home-line)]" onClick={() => onUse({ name: t("随机色卡"), colors: random.colors })}>
                        {t("使用这组")}
                    </button>
                </div>
            ) : null}
        </div>
    );
}
