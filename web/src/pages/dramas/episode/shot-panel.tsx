import { ChevronLeft, ChevronRight } from "lucide-react";
import { useMemo, type ReactNode } from "react";

import { GenerationWorkbench } from "@/components/drama/generation-workbench";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { neighbourShot, spokenText, subtitleLines, type ShotMediaKind } from "@/lib/drama/episode-steps";
import { ARTIFACT_KIND_LABELS } from "@/lib/drama/labels";
import { lookAvailable } from "@/lib/drama/media/prompts";
import type { DramaShot } from "@/lib/drama/types";
import { shotNumber, type EpisodeCtx } from "./context";
import { FirstFrameOption, useFirstFrame } from "./first-frame";
import { prepareShot, type PrepareEnv } from "./prepare";

type Props = { ctx: EpisodeCtx; kind: ShotMediaKind; shot: DramaShot; env: PrepareEnv };

/** Right column of the picture / video / voice steps: the selected shot and its workbench. */
export function ShotPanel(props: Props) {
    const { ctx, kind, shot } = props;
    const { t } = useAppTranslation();
    const at = shotNumber(ctx.shots, shot.id);
    const step = (delta: number) => {
        const next = neighbourShot(ctx.shots, shot.id, delta);
        if (next) ctx.select(next);
    };
    return (
        <section className="flex min-h-0 flex-1 flex-col">
            <header className="shrink-0 border-b border-[color:var(--wg-home-line)] px-4 pb-3 pt-3.5">
                <div className="flex items-center gap-1.5">
                    <h2 className="text-[14px] font-semibold">{t("第 {count} 镜", { count: at })}</h2>
                    <span className="text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{[t("{seconds} 秒", { seconds: shot.seconds }), shot.size && t(shot.size), shot.camera && t(shot.camera)].filter(Boolean).join(" · ")}</span>
                    <span className="ml-auto flex items-center gap-0.5">
                        <button type="button" className="wg-icon-button !size-7" disabled={at <= 1} title={t("上一镜（←）")} aria-label={t("上一镜")} onClick={() => step(-1)}>
                            <ChevronLeft strokeWidth={1.6} />
                        </button>
                        <button type="button" className="wg-icon-button !size-7" disabled={at >= ctx.shots.length} title={t("下一镜（→）")} aria-label={t("下一镜")} onClick={() => step(1)}>
                            <ChevronRight strokeWidth={1.6} />
                        </button>
                    </span>
                </div>
                <p className="mt-1.5 line-clamp-3 text-[12px] leading-5 text-[color:var(--wg-home-muted)]">{shot.description || "—"}</p>
                {kind === "audio" ? <Subtitles ctx={ctx} shot={shot} /> : null}
            </header>
            <div key={shot.id} className="flex min-h-0 flex-1 flex-col px-4 pt-4">{kind === "video" ? <VideoBench {...props} /> : <Bench {...props} disabledReason={kind === "audio" && !spokenText(shot) ? "这一镜没有对白和旁白" : undefined} />}</div>
        </section>
    );
}

function Subtitles({ ctx, shot }: { ctx: EpisodeCtx; shot: DramaShot }) {
    const { t } = useAppTranslation();
    const lines = subtitleLines(shot, (id) => ctx.entities.get(id)?.name);
    return (
        <div className="mt-3 rounded-lg bg-[color:var(--wg-home-ghost)] px-3 py-2">
            <p className="mb-1 text-[11px] text-[color:var(--wg-home-muted)]">{t("成片字幕")}</p>
            {lines.length ? lines.map((line, index) => <p key={index} className="text-[13px] leading-6">{line}</p>) : <p className="text-[13px] text-[color:var(--wg-home-muted)]">{t("这一镜没有对白")}</p>}
            {shot.narration.trim() ? <p className="mt-1 text-[11px] leading-4 text-[color:var(--wg-home-muted)]">{t("旁白会被配音，但不出现在字幕里")}</p> : null}
        </div>
    );
}

function VideoBench(props: Props) {
    const { ctx, shot, env } = props;
    const frame = useFirstFrame(ctx.shots, ctx.artifacts, shot, env.storyboards.get(shot.id));
    return <Bench {...props} firstFrame={frame.firstFrame} disabledReason={frame.reason} extra={<FirstFrameOption source={frame.source} tailAllowed={frame.tailAllowed} onChange={frame.setSource} />} />;
}

type BenchProps = Props & { firstFrame?: ReturnType<typeof useFirstFrame>["firstFrame"]; extra?: ReactNode; disabledReason?: string };

function Bench({ ctx, kind, shot, env, firstFrame, extra, disabledReason }: BenchProps) {
    const { t } = useAppTranslation();
    const { project } = ctx.snapshot;
    const mine = useMemo(() => ctx.artifacts.filter((artifact) => artifact.shotId === shot.id && artifact.kind === kind), [ctx.artifacts, shot.id, kind]);
    return (
        <GenerationWorkbench
            dramaId={project.id}
            owner={{ shotId: shot.id }}
            kind={kind}
            title={t("第 {count} 镜 · {kind}", { count: shotNumber(ctx.shots, shot.id), kind: t(ARTIFACT_KIND_LABELS[kind]) })}
            route={`${ctx.base}?step=${kind}&shot=${shot.id}`}
            artifacts={mine}
            prepare={(look) => prepareShot(kind, env, shot, look, firstFrame)}
            {...lookAvailable(project)}
            extraOptions={extra}
            disabledReason={disabledReason}
            onChange={ctx.refresh}
        />
    );
}
