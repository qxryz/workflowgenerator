import { App, Input } from "antd";
import { Copy, Download, Droplets } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { createPalettePng, normalizeHexColor } from "@/lib/drama/style/colour-palettes";
import { addColour, moveColour, paletteProblem, removeColour, sameColours, storedPalette } from "@/lib/drama/style/palette-edit";
import type { DramaPalette, DramaProject } from "@/lib/drama/types";
import { downloadFile } from "@/services/download-file";
import { AdoptBar } from "./adopt-bar";
import { PaletteGenerators } from "./palette-generators";
import { PaletteSwatches } from "./palette-swatches";
import { useAdopt } from "./use-adopt";

const copy = async (text: string) => navigator.clipboard.writeText(text);

/** 色彩: a draft palette you edit freely, then adopt for the whole drama. */
export function PalettePanel({ project }: { project: DramaProject }) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const { busy, adoptPalette } = useAdopt(project);
    const adopted = project.palette;
    const [draft, setDraft] = useState<DramaPalette | null>(adopted);
    const [selected, setSelected] = useState(0);
    const [hex, setHex] = useState("");
    const [exporting, setExporting] = useState(false);
    const colors = draft?.colors ?? [];

    const adoptedKey = adopted ? `${adopted.name}|${adopted.colors.join()}` : "";
    useEffect(() => {
        if (adopted) setDraft(adopted);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the adopted content
    }, [adoptedKey]);
    const current = Math.min(selected, Math.max(0, colors.length - 1));
    useEffect(() => setHex(colors[current] ?? ""), [colors, current]);

    const update = (next: Partial<DramaPalette>) => setDraft((value) => ({ name: value?.name ?? t("自定义色卡"), colors: value?.colors ?? [], ...next }));
    const commitHex = () => {
        const normalized = normalizeHexColor(hex);
        if (normalized && draft) update({ colors: colors.map((color, index) => (index === current ? normalized : color)) });
        else setHex(colors[current] ?? "");
    };
    const done = async (action: () => Promise<unknown>, success?: string) => {
        try {
            await action();
            if (success) message.success(success);
        } catch (error) {
            message.error(error instanceof Error ? t(error.message) : t("操作没有成功，请重试"));
        }
    };
    const exportPng = async () => {
        if (!draft) return;
        setExporting(true);
        await done(async () => {
            const name =
                draft.name
                    .trim()
                    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
                    .slice(0, 80) || "palette";
            await downloadFile(await createPalettePng(storedPalette(draft)), `${name}.png`);
        }, t("已导出色卡图片"));
        setExporting(false);
    };

    const problem = draft ? paletteProblem(draft) : "先选一组颜色";
    const isAdopted = Boolean(adopted && draft && adopted.name === draft.name.trim() && sameColours(adopted.colors, draft.colors));
    const action = "wg-text-button !h-9 !border !border-[color:var(--wg-home-line)]";

    return (
        <div className="flex h-full min-h-0">
            <div className="thin-scrollbar flex min-w-0 flex-1 flex-col gap-5 overflow-y-auto p-5">
                {draft && colors.length ? (
                    <>
                        <PaletteSwatches
                            colors={colors}
                            selected={current}
                            onSelect={setSelected}
                            onChange={(index, color) => update({ colors: colors.map((value, position) => (position === index ? color : value)) })}
                            onMove={(from, to) => {
                                update({ colors: moveColour(colors, from, to) });
                                setSelected(to);
                            }}
                            onRemove={(index) => update({ colors: removeColour(colors, index) })}
                            onAdd={() => {
                                update({ colors: addColour(colors) });
                                setSelected(colors.length);
                            }}
                            onCopy={(color) => void done(() => copy(color), t("已复制 {color}", { color }))}
                        />
                        <div className="grid grid-cols-[minmax(0,1fr)_9rem] gap-3">
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("色卡名称")}</span>
                                <Input value={draft.name} maxLength={80} status={draft.name.trim() ? undefined : "error"} onChange={(event) => update({ name: event.target.value })} />
                            </label>
                            <label className="flex flex-col gap-1.5">
                                <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("第 {n} 色 HEX", { n: current + 1 })}</span>
                                <Input className="font-mono" maxLength={7} value={hex} status={hex && !normalizeHexColor(hex) ? "error" : undefined} onChange={(event) => setHex(event.target.value)} onBlur={commitHex} onPressEnter={commitHex} />
                            </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                            <button type="button" className={action} onClick={() => void done(() => copy(colors.join(", ")), t("已复制全部 HEX"))}>
                                <Copy className="size-4" strokeWidth={1.6} />
                                {t("复制全部 HEX")}
                            </button>
                            <button type="button" className={action} disabled={Boolean(problem) || exporting} onClick={() => void exportPng()}>
                                <Download className="size-4" strokeWidth={1.6} />
                                {t("导出 PNG")}
                            </button>
                        </div>
                    </>
                ) : (
                    <div className="flex min-h-64 flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-[color:var(--wg-home-line-strong)] text-center text-[13px] text-[color:var(--wg-home-muted)]">
                        <Droplets className="size-8" strokeWidth={1.3} />
                        <p className="!mb-0 max-w-xs">{t("还没有色卡。在右侧选一组推荐色，或随机生成一组。")}</p>
                    </div>
                )}
            </div>
            <aside className="thin-scrollbar flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-4 max-[1240px]:w-[360px]">
                <PaletteGenerators
                    current={draft}
                    full={colors.length >= 8}
                    onUse={(palette) => {
                        setDraft(palette);
                        setSelected(0);
                    }}
                    onAdd={(color) => {
                        update({ colors: [...colors, color] });
                        setSelected(colors.length);
                    }}
                />
                <div className="mt-auto flex flex-col gap-3 border-t border-[color:var(--wg-home-line)] pt-4">
                    <AdoptBar adopted={isAdopted} elsewhere={adopted?.name} canAdopt={!problem} busy={busy} reason={problem} onAdopt={() => draft && void adoptPalette(storedPalette(draft))} onClear={() => void adoptPalette(null)} />
                </div>
            </aside>
        </div>
    );
}
