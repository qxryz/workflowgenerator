import { Checkbox, Segmented } from "antd";
import { useMemo, useState } from "react";

import { GenerationWorkbench, type Look, type Prepared } from "@/components/drama/generation-workbench";
import { MediaPreview } from "@/components/drama/media-preview";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { ARTIFACT_KIND_LABELS } from "@/lib/drama/labels";
import { inputHash, sheetPrompt } from "@/lib/drama/media/prompts";
import { refImage, sheetReferences, type ReferencePlan } from "@/lib/drama/media/references";
import { adoptedArtifact } from "@/lib/drama/media/state";
import { sheetsOf } from "@/lib/drama/settings-view";
import type { DramaEntity, DramaProject, DramaSnapshot } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { KIND_ICON, useRefresh } from "./common";

const VIEWS = ["正面", "侧面", "背面"];

/** The adopted sheet, large. A character sheet is three full-body views side by side, labelled under each third. */
function SheetPreview({ entity, url }: { entity: DramaEntity; url?: string }) {
    const { t } = useAppTranslation();
    const [zoom, setZoom] = useState(false);
    const Icon = KIND_ICON[entity.kind];
    const triple = entity.kind === "character";
    return (
        <div className="overflow-hidden rounded-xl border border-[color:var(--wg-home-line)]">
            <div className={cn("relative grid place-items-center bg-[color:var(--wg-home-ghost)]", triple ? "aspect-video" : entity.kind === "prop" ? "aspect-square" : "aspect-video")}>
                {url ? (
                    <button type="button" className="size-full cursor-zoom-in" aria-label={t("查看大图")} onClick={() => setZoom(true)}>
                        <img src={url} alt={entity.name} draggable={false} className="size-full object-contain" />
                    </button>
                ) : (
                    <div className="flex flex-col items-center gap-2 text-[12px] text-[color:var(--wg-home-muted)]">
                        <Icon className="size-8 opacity-50" strokeWidth={1.3} />
                        {t("还没有采用的设定图")}
                    </div>
                )}
                {triple && !url ? <div aria-hidden className="pointer-events-none absolute inset-y-4 left-1/3 right-1/3 border-x border-dashed border-[color:var(--wg-home-line)]" /> : null}
            </div>
            {triple ? (
                <div className="grid grid-cols-3 border-t border-[color:var(--wg-home-line)] text-center text-[12px] text-[color:var(--wg-home-muted)]">
                    {VIEWS.map((view, index) => (
                        <span key={view} className={cn("py-1.5", index > 0 && "border-l border-[color:var(--wg-home-line)]")}>
                            {t(view)}
                        </span>
                    ))}
                </div>
            ) : null}
            <MediaPreview target={zoom && url ? { kind: "sheet", url, title: entity.name } : null} onClose={() => setZoom(false)} />
        </div>
    );
}

type Props = { entity: DramaEntity; project: DramaProject; artifacts: DramaSnapshot["artifacts"] };

export function SheetPanel({ entity, project, artifacts }: Props) {
    const { t } = useAppTranslation();
    const refresh = useRefresh(project.id);
    const [side, setSide] = useState<"left" | "right">("left");
    const [useAdopted, setUseAdopted] = useState(false);
    const sheets = useMemo(() => sheetsOf(artifacts, entity.id), [artifacts, entity.id]);
    const adopted = adoptedArtifact(sheets);
    const style = project.style;
    const hasStyle = Boolean(style && (style.prompt.trim() || style.promptEn?.trim()));
    const hasPalette = Boolean(project.palette?.colors.length);

    // The adopted sheet as an identity reference never enters the hash, so adopting a new sheet does not age the old ones.
    const prepare = (look: Look): Prepared => {
        const { prompt, aspect } = sheetPrompt({ entity, style, palette: project.palette, useStyle: look.useStyle, usePalette: look.usePalette, language: look.language, aspect: project.aspect, sideView: side });
        const plan = adopted && useAdopted ? sheetReferences([refImage(adopted, entity.name)], look.language) : { images: [], notes: [] };
        const identity = look.language === "en-US" ? "the current approved design sheet of this subject; keep the same identity, outfit and proportions" : "这个设定当前采用的设定图，保持同一主体的外观、服装与比例";
        const references: ReferencePlan = { images: plan.images, notes: plan.notes.map((note) => `${note.split("：")[0]}：${identity}`) };
        return { prompt, references, inputHash: inputHash({ prompt, aspect, model: look.model }), aspect };
    };

    return (
        <section className="flex flex-col gap-3">
            <h4 className="text-[13px] font-semibold">{t(ARTIFACT_KIND_LABELS.sheet)}</h4>
            <SheetPreview entity={entity} url={adopted?.mediaUrl} />
            <GenerationWorkbench
                key={entity.id}
                dramaId={project.id}
                owner={{ entityId: entity.id }}
                kind="sheet"
                title={`${t(ARTIFACT_KIND_LABELS.sheet)} · ${entity.name}`}
                route={`/dramas/${project.id}?tab=settings`}
                artifacts={sheets}
                prepare={prepare}
                hasStyle={hasStyle}
                hasPalette={hasPalette}
                onChange={() => void refresh()}
                extraOptions={
                    adopted || entity.kind === "character" ? (
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-[color:var(--wg-home-muted)]">
                            {adopted ? (
                                <Checkbox checked={useAdopted} onChange={(event) => setUseAdopted(event.target.checked)}>
                                    {t("参考已采用的设定图")}
                                </Checkbox>
                            ) : null}
                            {entity.kind === "character" ? (
                                <label className="flex items-center gap-1.5">
                                    {t("侧面朝向")}
                                    <Segmented
                                        size="small"
                                        value={side}
                                        onChange={setSide}
                                        options={[
                                            { value: "left", label: t("左") },
                                            { value: "right", label: t("右") },
                                        ]}
                                    />
                                </label>
                            ) : null}
                        </div>
                    ) : null
                }
            />
        </section>
    );
}
