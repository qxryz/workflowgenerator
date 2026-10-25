import type { DramaPalette } from "../types";

export const MIN_PALETTE_COLORS = 2;
export const MAX_PALETTE_COLORS = 8;
export type ColourHarmony = "analogous" | "complementary" | "triadic" | "split-complementary" | "shades";
export type HslColour = { h: number; s: number; l: number };

export const COLOUR_PALETTE_PRESETS: readonly DramaPalette[] = [
    { name: "沙漠暮色", colors: ["#EADDC4", "#D2A26A", "#A6634B", "#716A87", "#303A50"] },
    { name: "雨夜城市", colors: ["#172A3A", "#32556B", "#5A8790", "#BECBC7", "#DBAE75"] },
    { name: "春日庭院", colors: ["#F4E9DA", "#A7B594", "#546E59", "#DCA9A0", "#866D60"] },
    { name: "复古胶片", colors: ["#E6D5B3", "#C1A268", "#8D6545", "#6B7861", "#353B36"] },
    { name: "深海微光", colors: ["#152C3B", "#245369", "#438C98", "#A4D2C7", "#E8DBB7"] },
    { name: "清透漫画", colors: ["#F6EBCB", "#E8B385", "#9CC4CB", "#93A892", "#555471"] },
];

/** Accept RGB shorthand or six-digit HEX only; alpha is intentionally unsupported. */
export function normalizeHexColor(value: unknown): string | null {
    if (typeof value !== "string") return null;
    const raw = value.trim().replace(/^#/, "");
    if (/^[\da-f]{3}$/i.test(raw))
        return `#${raw
            .split("")
            .map((char) => char + char)
            .join("")
            .toUpperCase()}`;
    return /^[\da-f]{6}$/i.test(raw) ? `#${raw.toUpperCase()}` : null;
}

/** Normalize and de-duplicate without silently dropping malformed colours. */
export function normalizePaletteColors(colors: readonly string[]): string[] {
    const normalized = colors.map((color) => {
        const hex = normalizeHexColor(color);
        if (!hex) throw new Error("请输入有效的 HEX 颜色代码");
        return hex;
    });
    return [...new Set(normalized)];
}

/** A draft may have fewer colours; call this when saving or exporting. */
export function validateColourPalette(palette: DramaPalette | undefined): DramaPalette | undefined {
    if (!palette) return undefined;
    const colors = normalizePaletteColors(palette.colors);
    if (colors.length < MIN_PALETTE_COLORS || colors.length > MAX_PALETTE_COLORS) throw new Error("色卡需要 2–8 个不同颜色");
    const name = palette.name.trim();
    if (!name) throw new Error("请输入色卡名称");
    if (name.length > 80) throw new Error("色卡名称不能超过 80 个字符");
    return { name, colors };
}

function rgb(hex: string): number[] {
    const normalized = normalizeHexColor(hex);
    if (!normalized) throw new Error("请输入有效的 HEX 颜色代码");
    return [1, 3, 5].map((index) => parseInt(normalized.slice(index, index + 2), 16) / 255);
}

export function hexToHsl(hex: string): HslColour {
    const [r, g, b] = rgb(hex);
    const max = Math.max(r, g, b),
        min = Math.min(r, g, b),
        delta = max - min;
    const l = (max + min) / 2;
    if (!delta) return { h: 0, s: 0, l };
    const h = (max === r ? (g - b) / delta : max === g ? (b - r) / delta + 2 : (r - g) / delta + 4) * 60;
    return { h: (h + 360) % 360, s: delta / (1 - Math.abs(2 * l - 1)), l };
}

export function hslToHex({ h, s, l }: HslColour): string {
    const hue = ((h % 360) + 360) % 360,
        saturation = Math.max(0, Math.min(1, s)),
        lightness = Math.max(0, Math.min(1, l));
    const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
    const x = chroma * (1 - Math.abs(((hue / 60) % 2) - 1)),
        m = lightness - chroma / 2;
    const values = hue < 60 ? [chroma, x, 0] : hue < 120 ? [x, chroma, 0] : hue < 180 ? [0, chroma, x] : hue < 240 ? [0, x, chroma] : hue < 300 ? [x, 0, chroma] : [chroma, 0, x];
    return `#${values
        .map((value) =>
            Math.round((value + m) * 255)
                .toString(16)
                .padStart(2, "0"),
        )
        .join("")
        .toUpperCase()}`;
}

export function createColourHarmony(base: string, harmony: ColourHarmony): string[] {
    const hex = normalizeHexColor(base);
    if (!hex) throw new Error("请输入有效的 HEX 颜色代码");
    const source = hexToHsl(hex);
    const colour = (rotation: number, lightness = source.l, saturation = source.s) => hslToHex({ h: source.h + rotation, s: saturation, l: lightness });
    // Near-neutrals stay neutral instead of acquiring an arbitrary hue.
    if (harmony === "shades" || source.s < 0.08 || source.l < 0.05 || source.l > 0.95) {
        return normalizePaletteColors([colour(0, source.l * 0.45), colour(0, source.l * 0.72), hex, colour(0, source.l + (1 - source.l) * 0.35), colour(0, source.l + (1 - source.l) * 0.7)]);
    }
    if (harmony === "triadic") return normalizePaletteColors([hex, colour(120), colour(240)]);
    if (harmony === "split-complementary") return normalizePaletteColors([hex, colour(150), colour(210)]);
    if (harmony === "complementary") return normalizePaletteColors([colour(0, source.l * 0.65), hex, colour(0, source.l + (1 - source.l) * 0.5), colour(180), colour(180, source.l + (1 - source.l) * 0.35)]);
    return normalizePaletteColors([colour(-30, Math.min(0.88, source.l + 0.12)), colour(-15), hex, colour(15), colour(30, Math.max(0.12, source.l - 0.14))]);
}

/** A light neutral, coloured accents, then a dark neutral; lightness is spaced so even monochrome palettes stay usable. */
export function generateRandomPalette(count = 5, random: () => number = Math.random): DramaPalette {
    const size = Math.max(MIN_PALETTE_COLORS, Math.min(MAX_PALETTE_COLORS, Math.round(count)));
    const hue = random() * 360,
        saturation = 0.28 + random() * 0.36;
    const rotations = [[-24, 0, 24], [0, 180], [0, 150, 210], [0, 120, 240], [0]][Math.floor(random() * 5)];
    const colors = [hslToHex({ h: hue, s: saturation * 0.3, l: 0.89 + random() * 0.05 })];
    for (let index = 0; index < size - 2; index++) {
        const position = size === 3 ? 0.5 : index / (size - 3);
        colors.push(hslToHex({ h: hue + rotations[index % rotations.length] + (random() - 0.5) * 8, s: saturation * (0.8 + random() * 0.4), l: 0.71 - position * 0.34 + (random() - 0.5) * 0.015 }));
    }
    colors.push(hslToHex({ h: hue + rotations.at(-1)!, s: saturation * 0.45, l: 0.13 + random() * 0.06 }));
    return { name: "随机色卡", colors };
}

/** Return whichever of black/white gives the stronger WCAG contrast. */
export function colourTextColor(hex: string): "#000000" | "#FFFFFF" {
    const linear = rgb(hex).map((value) => (value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4));
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return (luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05) ? "#000000" : "#FFFFFF";
}

export function paletteExportData(palette: DramaPalette) {
    const normalized = validateColourPalette(palette)!;
    const width = 1600,
        height = 1000,
        margin = 64,
        top = 170,
        swatchHeight = 650;
    const swatchWidth = (width - margin * 2) / normalized.colors.length;
    return {
        name: normalized.name,
        width,
        height,
        margin,
        colors: normalized.colors.map((hex, index) => {
            const x = margin + Math.round(index * swatchWidth);
            return { hex, textColor: colourTextColor(hex), x, y: top, width: margin + Math.round((index + 1) * swatchWidth) - x, height: swatchHeight };
        }),
    };
}

export async function createPalettePng(palette: DramaPalette): Promise<Blob> {
    const data = paletteExportData(palette),
        canvas = document.createElement("canvas");
    canvas.width = data.width;
    canvas.height = data.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("无法生成色卡图片");
    context.fillStyle = "#FAF9F6";
    context.fillRect(0, 0, data.width, data.height);
    context.fillStyle = "#252720";
    context.font = '500 42px system-ui, -apple-system, "PingFang SC", sans-serif';
    context.textBaseline = "middle";
    context.fillText(data.name, data.margin, 88, data.width - data.margin * 2);
    for (const swatch of data.colors) {
        context.fillStyle = swatch.hex;
        context.fillRect(swatch.x, swatch.y, swatch.width, swatch.height);
        context.fillStyle = swatch.textColor;
        context.font = "24px ui-monospace, SFMono-Regular, monospace";
        context.textAlign = "center";
        context.fillText(swatch.hex, swatch.x + swatch.width / 2, swatch.y + swatch.height - 40, swatch.width - 16);
    }
    return new Promise((resolve, reject) => canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error("无法生成色卡图片"))), "image/png"));
}
