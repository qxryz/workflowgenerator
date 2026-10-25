import { Input } from "antd";
import { Palette } from "lucide-react";
import { useEffect, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { getStylePresetPreview } from "@/lib/drama/style/style-preset-previews";
import { STYLE_PRESETS } from "@/lib/drama/style/style-presets";
import type { DramaProject } from "@/lib/drama/types";
import { StylePresetCard } from "@/components/drama/style-preset-card";
import { cn } from "@/lib/utils";
import { AdoptBar } from "./adopt-bar";
import { useAdopt } from "./use-adopt";

const CUSTOM = "custom";

/** 画风: pick a preset (or write your own), adjust the description, adopt. */
export function StylePanel({ project }: { project: DramaProject }) {
    const { t, language } = useAppTranslation();
    const { busy, adoptStyle } = useAdopt(project);
    const adopted = project.style;
    const [selected, setSelected] = useState<string | null>(adopted ? (adopted.presetId ?? CUSTOM) : null);
    const [prompt, setPrompt] = useState(adopted?.prompt ?? "");
    const preset = STYLE_PRESETS.find((item) => item.id === selected);
    const preview = getStylePresetPreview(preset?.id);

    // Follow changes made elsewhere (another tab, clearing) when this tab is showing the adopted style.
    const adoptedKey = adopted ? `${adopted.presetId ?? CUSTOM}|${adopted.prompt}` : "";
    useEffect(() => {
        if (!adopted) return;
        setSelected(adopted.presetId ?? CUSTOM);
        setPrompt(adopted.prompt);
        // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed on the adopted content
    }, [adoptedKey]);

    const choose = (id: string) => {
        setSelected(id);
        const next = STYLE_PRESETS.find((item) => item.id === id);
        setPrompt(adopted && (adopted.presetId ?? CUSTOM) === id ? adopted.prompt : (next?.prompt ?? ""));
    };
    const text = prompt.trim();
    const isAdopted = Boolean(adopted && selected && (adopted.presetId ?? CUSTOM) === selected && adopted.prompt === text);
    const problem = !selected ? "先选一个画风" : !text && selected === CUSTOM ? "请写下画风描述" : null;
    const adopt = () =>
        void adoptStyle({
            ...(preset ? { presetId: preset.id } : {}),
            prompt: text,
            ...(preset && preset.promptEn && text === preset.prompt.trim() ? { promptEn: preset.promptEn } : {}),
        });
    const presetName = (id: string) => {
        const item = STYLE_PRESETS.find((entry) => entry.id === id);
        return item ? (language === "en-US" ? item.nameEn : item.name) : t("自定义画风");
    };
    const edited = Boolean(preset && text !== preset.prompt.trim());

    return (
        <div className="flex h-full min-h-0">
            <div className="thin-scrollbar min-w-0 flex-1 overflow-y-auto p-5">
                <div className="grid grid-cols-[repeat(auto-fill,minmax(168px,1fr))] gap-3.5">
                    <button
                        type="button"
                        aria-pressed={selected === CUSTOM}
                        onClick={() => choose(CUSTOM)}
                        className={cn(
                            "flex min-h-[8.5rem] flex-col items-center justify-center gap-2 rounded-lg border border-dashed text-xs transition-colors",
                            selected === CUSTOM
                                ? "border-[color:var(--wg-home-accent)] text-[color:var(--wg-home-text)] ring-1 ring-[color:var(--wg-home-accent)]"
                                : "border-[color:var(--wg-home-line-strong)] text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]",
                        )}
                    >
                        <Palette className="size-5" strokeWidth={1.5} />
                        {t("自定义画风")}
                    </button>
                    {STYLE_PRESETS.map((item) => (
                        <div key={item.id} className="relative">
                            <StylePresetCard preset={item} selected={selected === item.id} onSelect={() => choose(item.id)} />
                            {adopted?.presetId === item.id ? <span className="pointer-events-none absolute left-1.5 top-1.5 rounded-full bg-[color:var(--wg-panel)]/90 px-2 py-0.5 text-[10px] font-medium">{t("已采用")}</span> : null}
                        </div>
                    ))}
                </div>
            </div>
            <aside className="thin-scrollbar flex w-[400px] shrink-0 flex-col gap-4 overflow-y-auto border-l border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-4 max-[1240px]:w-[360px]">
                {selected ? (
                    <>
                        {preview ? (
                            <div className="aspect-[16/10] overflow-hidden rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-ghost)]">
                                <img src={preview.src} alt="" draggable={false} className="size-full object-cover" style={{ objectPosition: preview.position }} />
                            </div>
                        ) : null}
                        <h3 className="text-[15px] font-semibold">{selected === CUSTOM ? t("自定义画风") : language === "en-US" ? preset!.nameEn : preset!.name}</h3>
                        <label className="flex flex-col gap-1.5">
                            <span className="flex items-center justify-between text-[12px] text-[color:var(--wg-home-muted)]">
                                {t("画风描述")}
                                {edited ? (
                                    <button type="button" className="underline-offset-2 hover:text-[color:var(--wg-home-text)] hover:underline" onClick={() => setPrompt(preset!.prompt)}>
                                        {t("恢复预设")}
                                    </button>
                                ) : null}
                            </span>
                            <Input.TextArea value={prompt} maxLength={4000} autoSize={{ minRows: 7, maxRows: 14 }} placeholder={t("描述想要的画面风格，例如：水墨淡彩，留白，细线勾勒")} onChange={(event) => setPrompt(event.target.value)} />
                        </label>
                        <AdoptBar
                            adopted={isAdopted}
                            elsewhere={adopted ? (adopted.presetId ? presetName(adopted.presetId) : t("自定义画风")) : undefined}
                            canAdopt={!problem}
                            busy={busy}
                            reason={problem}
                            onAdopt={adopt}
                            onClear={() => void adoptStyle(null)}
                        />
                        {preview ? (
                            <p className="!mb-0 text-[11px] leading-4 text-[color:var(--wg-home-muted)]">
                                {t("配图")}：
                                <a className="underline-offset-2 hover:underline" href={preview.sourceUrl} target="_blank" rel="noreferrer">
                                    {preview.author}
                                </a>{" "}
                                · {preview.license}
                            </p>
                        ) : null}
                    </>
                ) : (
                    <p className="!mb-0 my-auto text-center text-[13px] text-[color:var(--wg-home-muted)]">{t("选一个画风，或自己写一段描述")}</p>
                )}
            </aside>
        </div>
    );
}
