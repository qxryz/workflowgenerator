import { adoptedByShot, defaultFirstFrame, type ShotMediaKind } from "@/lib/drama/episode-steps";
import { normalizeQuality, qualityChoices, supportsGenerateAudio } from "@/lib/drama/media/model-options";
import { pickFirstFrame, type RefImage } from "@/lib/drama/media/references";
import { captureTailFrame, generate, runQueue } from "@/lib/drama/media/runner";
import type { DramaShot } from "@/lib/drama/types";
import type { AppLanguage } from "@/lib/i18n";
import { adoptArtifact, getEpisode } from "@/services/drama-api";
import type { AiConfig } from "@/stores/use-config-store";
import { useEpisodeBatches } from "@/stores/use-episode-batches";
import type { EpisodeCtx } from "./context";
import { prepareEnv, prepareShot } from "./prepare";

export type BatchRequest = {
    ctx: EpisodeCtx;
    kind: Extract<ShotMediaKind, "image" | "video">;
    shotIds: string[];
    /** `channel::model` */
    model: string;
    config: AiConfig;
    language: AppLanguage;
    /** Adopt each result when its shot still has none of that kind. */
    autoAdopt: boolean;
    /** 1 when a shot may start from the previous shot's result. */
    concurrency: number;
    /** Status-bar title for shot number n. */
    title: (n: number) => string;
};

export type BatchOutcome = { made: number; failed: number; stopped: boolean };

export const batchKey = (episodeId: string, kind: BatchRequest["kind"]) => `${episodeId}:${kind}`;

function paramsFor(kind: BatchRequest["kind"], config: AiConfig, model: string, shot: DramaShot, aspect: string): Record<string, unknown> {
    if (kind === "image") return { aspect, ...(qualityChoices(config, model).length ? { quality: normalizeQuality(config, model, undefined) } : {}) };
    return { aspect, seconds: shot.seconds, resolution: "720p", ...(supportsGenerateAudio(config, model) ? { generateAudio: true } : {}) };
}

/** Generates the listed shots with the default look. Each result is a normal candidate; nothing here pays twice for a shot that is already in flight. */
export async function runEpisodeBatch(request: BatchRequest): Promise<BatchOutcome> {
    const { ctx, kind, shotIds, model, config, language, autoAdopt, concurrency } = request;
    const { project } = ctx.snapshot;
    const episodeId = ctx.episode.id;
    const key = batchKey(episodeId, kind);
    const store = useEpisodeBatches.getState();
    const controller = new AbortController();
    store.start(key, { total: shotIds.length, done: 0, failed: 0, stopping: false, abort: () => { useEpisodeBatches.getState().stopping(key); controller.abort(); } });

    const hasStyle = Boolean(project.style && (project.style.prompt || project.style.promptEn));
    const look = { useStyle: hasStyle, usePalette: Boolean(project.palette?.colors.length), language, model };
    const route = `${ctx.base}?step=${kind}`;

    const makeJob = (shotId: string) => async () => {
        let failed = true;
        try {
            // Videos may depend on what earlier jobs just finished, so read the episode as it is now.
            const current = await getEpisode(episodeId);
            const shot = current.shots.find((item) => item.id === shotId);
            if (!shot) return;
            const env = prepareEnv(project, ctx.entities, ctx.sheets, current.shots, current.artifacts);
            let frame: RefImage | undefined;
            if (kind === "video") {
                const index = current.shots.findIndex((item) => item.id === shotId);
                const prev = current.shots[index - 1];
                const videos = adoptedByShot(current.artifacts, "video");
                if (defaultFirstFrame(shot, prev, videos) === "tail") frame = await captureTailFrame(videos.get(prev.id)!).catch(() => undefined);
                frame ??= pickFirstFrame("storyboard", env.storyboards.get(shot.id));
                if (!frame) throw new Error("先采用本镜画面");
            }
            const prepared = prepareShot(kind, env, shot, look, frame);
            const artifact = await generate({
                dramaId: project.id,
                owner: { shotId },
                kind,
                title: request.title(current.shots.findIndex((item) => item.id === shotId) + 1),
                route,
                model,
                params: { ...prepared.params, ...paramsFor(kind, config, model, shot, project.aspect) },
                prompt: prepared.prompt,
                references: prepared.references,
                firstFrame: prepared.firstFrame,
                inputHash: prepared.inputHash,
                onCreated: ctx.refresh,
            });
            failed = artifact.status !== "ready";
            if (!failed && autoAdopt) {
                const latest = await getEpisode(episodeId);
                if (!adoptedByShot(latest.artifacts, kind).has(shotId)) await adoptArtifact(artifact.id);
            }
        } catch {
            failed = true;
        } finally {
            useEpisodeBatches.getState().advance(key, failed);
            ctx.refresh();
        }
    };

    const results = await runQueue(shotIds.map(makeJob), concurrency, controller.signal);
    const outcome = useEpisodeBatches.getState().batches[key];
    useEpisodeBatches.getState().finish(key);
    ctx.refresh();
    return { made: (outcome?.done ?? results.length) - (outcome?.failed ?? 0), failed: outcome?.failed ?? 0, stopped: controller.signal.aborted };
}
