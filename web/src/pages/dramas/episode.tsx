import { useQueryClient } from "@tanstack/react-query";
import { Select } from "antd";
import { AudioLines, Check, Clapperboard, FileText, Film, Image as ImageIcon, LayoutList } from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import { useCallback, useEffect, useMemo, type ReactNode } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { DramaPageHeader } from "@/components/drama/page-header";
import { DramaTabs, type DramaTabItem } from "@/components/drama/drama-tabs";
import { RunPanelButton } from "@/components/drama/run-panel";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, episodeKey, useDrama, useEpisode } from "@/hooks/use-drama";
import { defaultStep, isEpisodeStep, pendingShots, stepProgress, type EpisodeStep, type ShotMediaKind, type StepProgress } from "@/lib/drama/episode-steps";
import { resumePending } from "@/lib/drama/media/runner";
import type { DramaRun, EpisodeSnapshot } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { adoptedSheets, entityMap, type EpisodeCtx } from "./episode/context";
import { ExportStep } from "./episode/export-step";
import { MediaStep } from "./episode/media-step";
import { ScriptStep } from "./episode/script-step";
import { ShotsStep } from "./episode/shots-step";

const STEPS: Array<{ value: EpisodeStep; label: string; icon: DramaTabItem<EpisodeStep>["icon"] }> = [
    { value: "script", label: "剧本", icon: FileText },
    { value: "shots", label: "分镜", icon: LayoutList },
    { value: "image", label: "画面", icon: ImageIcon },
    { value: "video", label: "视频", icon: Film },
    { value: "audio", label: "声音", icon: AudioLines },
    { value: "export", label: "成片", icon: Clapperboard },
];

export default function EpisodePage() {
    const { t } = useAppTranslation();
    const { id, eid } = useParams();
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const client = useQueryClient();
    const drama = useDrama(id);
    const episodeQuery = useEpisode(eid);
    const { data: snapshot } = drama;
    const data = episodeQuery.data;

    const base = `/dramas/${id}/episodes/${eid}`;
    const refresh = useCallback(() => void client.invalidateQueries({ queryKey: episodeKey(eid ?? "") }), [client, eid]);
    const refetchEpisode = episodeQuery.refetch;

    // Keep generating work moving: pick up videos that were left running, and watch pending ones until they settle.
    useEffect(() => {
        if (data) resumePending(data.artifacts, base);
    }, [data, base]);
    const generating = Boolean(data?.artifacts.some((artifact) => artifact.status === "pending"));
    useEffect(() => {
        if (!generating) return;
        const timer = window.setInterval(() => void refetchEpisode(), 2000);
        return () => window.clearInterval(timer);
    }, [generating, refetchEpisode]);

    const update = useCallback(
        (next: Record<string, string | null>) =>
            setParams(
                (current) => {
                    const merged = new URLSearchParams(current);
                    for (const [key, value] of Object.entries(next)) {
                        if (value === null) merged.delete(key);
                        else merged.set(key, value);
                    }
                    return merged;
                },
                { replace: true },
            ),
        [setParams],
    );

    const progress = useMemo(() => (data ? stepProgress({ script: data.episode.script, shots: data.shots, artifacts: data.artifacts, exports: data.exports }) : undefined), [data]);
    const rawStep = params.get("step");
    const step: EpisodeStep = isEpisodeStep(rawStep) ? rawStep : progress ? defaultStep(progress) : "script";
    // Land on the first unfinished step once, then stay put as work completes.
    useEffect(() => {
        if (progress && !isEpisodeStep(rawStep)) update({ step: defaultStep(progress) });
    }, [progress, rawStep, update]);

    const ctx = useMemo<EpisodeCtx | undefined>(() => {
        if (!snapshot || !data) return undefined;
        const wanted = params.get("shot");
        return {
            snapshot,
            episode: data.episode,
            shots: data.shots,
            artifacts: data.artifacts,
            exports: data.exports,
            entities: entityMap(snapshot),
            sheets: adoptedSheets(snapshot.artifacts),
            base,
            selectedId: data.shots.find((shot) => shot.id === wanted)?.id ?? data.shots[0]?.id,
            select: (shotId) => update({ shot: shotId }),
            go: (next, shotId) => update({ step: next, ...(shotId ? { shot: shotId } : {}) }),
            refresh,
        };
    }, [snapshot, data, params, base, update, refresh]);

    if (drama.isPending || episodeQuery.isPending) return <div className="h-full bg-[color:var(--wg-home-bg)]" aria-busy="true" />;
    const episode = snapshot?.episodes.find((item) => item.id === eid);
    if (!snapshot || !episode || !ctx || !progress) {
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4 text-sm text-[color:var(--wg-home-muted)]">
                <p>{t("没有找到这一集")}</p>
                <Link to={`/dramas/${id}?tab=episodes`} className="wg-primary-button">
                    {t("回到分集列表")}
                </Link>
            </main>
        );
    }

    const episodes = [...snapshot.episodes].sort((a, b) => a.ord - b.ord);
    const items = STEPS.map<DramaTabItem<EpisodeStep>>((item) => ({ ...item, badge: <StepBadge step={item.value} progress={progress[item.value]} runs={snapshot.runs} episodeId={episode.id} data={data!} /> }));
    return (
        <main className="flex h-full min-h-0 flex-col bg-[color:var(--wg-home-bg)] text-[color:var(--wg-home-text)]">
            <DramaPageHeader backTo={`/dramas/${id}?tab=episodes`} backLabel="返回剧目" actions={<RunPanelButton snapshot={snapshot} />}>
                <Select
                    className="w-64"
                    value={episode.id}
                    onChange={(next) => navigate(`/dramas/${id}/episodes/${next}${isEpisodeStep(rawStep) ? `?step=${rawStep}` : ""}`)}
                    options={episodes.map((item) => ({ value: item.id, label: t("第 {count} 集 · {title}", { count: item.ord, title: item.title }) }))}
                    aria-label={t("切换分集")}
                />
                <span className="shrink-0 text-[12px] tabular-nums text-[color:var(--wg-home-muted)]">{t("目标 {seconds} 秒", { seconds: ctx.episode.targetSeconds })}</span>
            </DramaPageHeader>
            <DramaTabs className="px-5" items={items} value={step} onChange={(next) => update({ step: next })} ariaLabel="分集步骤" />
            <Body key={`${eid}:${step}`}>{renderStep(step, ctx)}</Body>
        </main>
    );
}

function renderStep(step: EpisodeStep, ctx: EpisodeCtx): ReactNode {
    if (step === "script") return <ScriptStep ctx={ctx} />;
    if (step === "shots") return <ShotsStep ctx={ctx} />;
    if (step === "export") return <ExportStep ctx={ctx} />;
    return <MediaStep ctx={ctx} kind={step} />;
}

function Body({ children }: { children: ReactNode }) {
    const reduce = useReducedMotion();
    return (
        <motion.div className="min-h-0 flex-1 overflow-hidden" initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18 }}>
            {children}
        </motion.div>
    );
}

const dot = "size-1.5 animate-pulse rounded-full bg-[color:var(--wg-home-accent)]";

/** What a step has to say at a glance: work in flight, results waiting, or how far along it is. */
function StepBadge({ step, progress, runs, episodeId, data }: { step: EpisodeStep; progress: StepProgress; runs: readonly DramaRun[]; episodeId: string; data: EpisodeSnapshot }) {
    const { t } = useAppTranslation();
    if (step === "script" || step === "shots") {
        const mine = runs.filter((run) => run.stage === step && run.episodeId === episodeId);
        if (mine.some((run) => run.status === "running")) return <span className={dot} title={t("运行中")} />;
        const waiting = mine.filter((run) => run.status === "review").length;
        if (waiting)
            return (
                <span className="grid h-4 min-w-4 place-items-center rounded-full bg-[color:var(--wg-home-accent)] px-1 text-[10px] font-semibold tabular-nums text-[color:var(--wg-home-accent-text)]" title={t("待你确认")}>
                    {waiting}
                </span>
            );
    }
    const kind = step === "image" || step === "video" || step === "audio" ? (step as ShotMediaKind) : undefined;
    const busy = kind ? pendingShots(data.artifacts, kind).size > 0 : false;
    return (
        <>
            {busy ? <span className={dot} title={t("生成中")} /> : null}
            {kind && progress.total > 0 ? (
                <span className={cn("text-[11px] font-normal tabular-nums", progress.complete ? "text-[color:var(--wg-home-text)]" : "text-[color:var(--wg-home-muted)]")}>{progress.done}/{progress.total}</span>
            ) : progress.complete ? (
                <Check className="size-3.5 text-[color:var(--wg-home-muted)]" strokeWidth={1.8} aria-label={t("已完成")} />
            ) : null}
        </>
    );
}
