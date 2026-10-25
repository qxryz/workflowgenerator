import type { DramaPalette } from "../types.ts";
import { MAX_PALETTE_COLORS, MIN_PALETTE_COLORS, hexToHsl, hslToHex, normalizeHexColor } from "./colour-palettes.ts";

/** Moves the colour at `from` to position `to`; out-of-range moves leave the list as it is. */
export function moveColour(colors: readonly string[], from: number, to: number): string[] {
    if (from === to || from < 0 || to < 0 || from >= colors.length || to >= colors.length) return [...colors];
    const next = [...colors];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

export function removeColour(colors: readonly string[], index: number): string[] {
    return colors.filter((_, position) => position !== index);
}

/** A new colour for "add": the last one turned 40 degrees around the wheel, so it sits next to it without repeating it. */
export function nextColour(colors: readonly string[]): string {
    const last = colors.at(-1);
    if (!last) return "#C9A66B";
    const { h, s, l } = hexToHsl(last);
    return hslToHex({ h: h + 40, s: Math.max(s, 0.25), l: Math.min(0.78, Math.max(0.3, l)) });
}

export function addColour(colors: readonly string[]): string[] {
    return colors.length >= MAX_PALETTE_COLORS ? [...colors] : [...colors, nextColour(colors)];
}

/** Same colours in the same order; the name does not matter. */
export const sameColours = (a: readonly string[] | undefined, b: readonly string[] | undefined) => (a ?? []).join().toUpperCase() === (b ?? []).join().toUpperCase();

/** Why a draft cannot be adopted yet, or null when it can. */
export function paletteProblem(palette: DramaPalette): string | null {
    if (!palette.name.trim()) return "请输入色卡名称";
    if (palette.colors.length < MIN_PALETTE_COLORS) return "色卡至少需要 2 个颜色";
    if (palette.colors.some((color) => !normalizeHexColor(color))) return "请输入有效的 HEX 颜色代码";
    return null;
}

/** The palette as it is stored: trimmed name, upper-case #RRGGBB. */
export const storedPalette = (palette: DramaPalette): DramaPalette => ({ name: palette.name.trim(), colors: palette.colors.map((color) => normalizeHexColor(color) ?? color) });
