import { ArrowLeft, ArrowRight, Copy, Plus, X } from "lucide-react";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { MAX_PALETTE_COLORS, MIN_PALETTE_COLORS, colourTextColor } from "@/lib/drama/style/colour-palettes";
import { cn } from "@/lib/utils";

type Props = {
    colors: string[];
    selected: number;
    onSelect: (index: number) => void;
    onChange: (index: number, color: string) => void;
    onMove: (from: number, to: number) => void;
    onRemove: (index: number) => void;
    onAdd: () => void;
    onCopy: (color: string) => void;
};

/** The palette being edited. Click a swatch to change its colour, use the arrows to reorder. */
export function PaletteSwatches({ colors, selected, onSelect, onChange, onMove, onRemove, onAdd, onCopy }: Props) {
    const { t } = useAppTranslation();
    const mini = "grid size-6 place-items-center rounded-md bg-black/10 transition hover:bg-black/20 disabled:opacity-30 disabled:hover:bg-black/10";
    return (
        <div className="flex h-56 gap-2" role="group" aria-label={t("当前色卡")}>
            {colors.map((color, index) => {
                const ink = colourTextColor(color);
                return (
                    <div
                        key={index}
                        className={cn("group relative flex min-w-0 flex-1 flex-col justify-between rounded-xl p-2.5 transition-shadow", selected === index && "shadow-[0_0_0_2px_var(--wg-panel),0_0_0_4px_var(--wg-home-text)]")}
                        style={{ backgroundColor: color, color: ink }}
                    >
                        <label className="absolute inset-0 cursor-pointer rounded-xl">
                            <input
                                type="color"
                                value={color}
                                aria-label={t("修改颜色 {color}", { color })}
                                className="absolute inset-0 size-full cursor-pointer opacity-0"
                                onFocus={() => onSelect(index)}
                                onClick={() => onSelect(index)}
                                onChange={(event) => onChange(index, event.target.value.toUpperCase())}
                            />
                        </label>
                        <div className="relative flex items-center justify-between text-[11px] opacity-80">
                            <span className="tabular-nums">{String(index + 1).padStart(2, "0")}</span>
                            <button
                                type="button"
                                className={cn(mini, "opacity-0 focus-visible:opacity-100 group-hover:opacity-100")}
                                style={{ color: ink }}
                                disabled={colors.length <= MIN_PALETTE_COLORS}
                                title={t("移除颜色")}
                                aria-label={t("移除颜色")}
                                onClick={() => onRemove(index)}
                            >
                                <X className="size-3.5" strokeWidth={1.8} />
                            </button>
                        </div>
                        <div className="relative flex flex-col gap-1.5">
                            <div className="flex items-center gap-1 opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100" style={{ color: ink }}>
                                <button type="button" className={mini} disabled={index === 0} title={t("左移")} aria-label={t("左移颜色")} onClick={() => onMove(index, index - 1)}>
                                    <ArrowLeft className="size-3.5" strokeWidth={1.8} />
                                </button>
                                <button type="button" className={mini} disabled={index === colors.length - 1} title={t("右移")} aria-label={t("右移颜色")} onClick={() => onMove(index, index + 1)}>
                                    <ArrowRight className="size-3.5" strokeWidth={1.8} />
                                </button>
                                <button type="button" className={cn(mini, "ml-auto")} title={t("复制 HEX")} aria-label={t("复制 HEX")} onClick={() => onCopy(color)}>
                                    <Copy className="size-3.5" strokeWidth={1.8} />
                                </button>
                            </div>
                            <span className="truncate font-mono text-[12px]">{color}</span>
                        </div>
                    </div>
                );
            })}
            {colors.length < MAX_PALETTE_COLORS ? (
                <button
                    type="button"
                    className="flex w-14 shrink-0 flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-[color:var(--wg-home-line-strong)] text-[11px] text-[color:var(--wg-home-muted)] transition hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)]"
                    onClick={onAdd}
                >
                    <Plus className="size-4" strokeWidth={1.6} />
                    {t("添加")}
                </button>
            ) : null}
        </div>
    );
}
