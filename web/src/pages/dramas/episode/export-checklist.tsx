import { Check, Film } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { adoptedByShot } from "@/lib/drama/episode-steps";
import { cn } from "@/lib/utils";
import type { EpisodeCtx } from "./context";

/** Every shot in order, with whether its video is ready for the cut. Missing ones jump to the 视频 step. */
export function ExportChecklist({ ctx }: { ctx: EpisodeCtx }) {
    const { t } = useAppTranslation();
    const videos = adoptedByShot(ctx.artifacts, "video");
    const images = adoptedByShot(ctx.artifacts, "image");
    const missing = ctx.shots.filter((shot) => !videos.has(shot.id)).length;
    return (
        <section className="flex min-h-0 flex-1 flex-col">
            <header className="flex shrink-0 items-center gap-2 px-4 pb-2 pt-4">
                <h3 className="text-[14px] font-semibold">{t("镜头")}</h3>
                <span className="text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("{done}/{total} 镜已有视频", { done: ctx.shots.length - missing, total: ctx.shots.length })}</span>
            </header>
            <ul className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-2">
                {ctx.shots.map((shot, index) => {
                    const ready = videos.has(shot.id);
                    const cover = images.get(shot.id);
                    return (
                        <li key={shot.id}>
                            <button
                                type="button"
                                disabled={ready}
                                className={cn("flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition", ready ? "cursor-default" : "hover:bg-[color:var(--wg-home-hover)]")}
                                title={ready ? undefined : t("去为这一镜生成视频")}
                                onClick={() => ctx.go("video", shot.id)}
                            >
                                <span className="grid h-9 w-14 shrink-0 place-items-center overflow-hidden rounded-md bg-[color:var(--wg-home-ghost)] text-[color:var(--wg-home-muted-strong)]">
                                    {cover?.mediaUrl ? <img src={cover.mediaUrl} alt="" loading="lazy" className="size-full object-cover" /> : <Film className="size-4" strokeWidth={1.4} />}
                                </span>
                                <span className="min-w-0 flex-1">
                                    <span className="block text-[12px] font-semibold tabular-nums">
                                        {t("第 {count} 镜", { count: index + 1 })}
                                        <span className="ml-2 font-normal text-[color:var(--wg-home-muted)]">{t("{seconds} 秒", { seconds: shot.seconds })}</span>
                                    </span>
                                    <span className="block truncate text-[12px] text-[color:var(--wg-home-muted)]">{shot.description || "—"}</span>
                                </span>
                                {ready ? (
                                    <Check className="size-4 shrink-0 text-[color:var(--wg-home-muted)]" strokeWidth={1.8} aria-label={t("已有视频")} />
                                ) : (
                                    <span className="shrink-0 rounded-full border border-dashed border-[color:var(--wg-home-line-strong)] px-2 py-0.5 text-[11px] text-[color:var(--wg-home-accent)]">{t("缺视频 · 去生成")}</span>
                                )}
                            </button>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
