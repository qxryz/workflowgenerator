import { adoptedByShot, needsTail, type ShotMediaKind } from "@/lib/drama/episode-steps";
import { normalizeQuality, qualityChoices, supportsGenerateAudio } from "@/lib/drama/media/model-options";
import { lookAvailable } from "@/lib/drama/media/prompts";
import { pickFirstFrame, type RefImage } from "@/lib/drama/media/references";
import { captureTailFrame, generate, runQueue } from "@/lib/drama/media/runner";
import { humanError } from "@/lib/drama/media/state";
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

/** `skipped` shots were left alone on purpose; `note` says why the first shot that produced nothing did (when no result card can). */
export type BatchOutcome = { made: number; failed: number; skipped: number; stopped: boolean; note?: string };

/** A shot the batch leaves alone, with the reason to show. Not a failure: nothing was paid for. */
class Skipped extends Error {}

export const batchKey = (episodeId: string, kind: BatchRequest["kind"]) => `${episodeId}:${kind}`;

function paramsFor(kind: BatchRequest["kind"], config: AiConfig, model: string, shot: DramaShot, aspect: string): Record<string, unknown> {
    if (kind === "image") return { aspect, ...(qualityChoices(config, model).length ? { quality: normalizeQuality(config, model, undefined) } : {}) };
    return { aspect, seconds: shot.seconds, resolution: "720p", ...(supportsGenerateAudio(config, model) ? { generateAudio: true } : {}) };
}

/** Generates the listed shots with the default look. Each result is a normal result card; nothing here pays twice for a shot that is already in flight. */
export async function runEpisodeBatch(request: BatchRequest): Promise<BatchOutcome> {
    const { ctx, kind, shotIds, model, config, language, autoAdopt, concurrency } = request;
    const { project } = ctx.snapshot;
    const episodeId = ctx.episode.id;
    const key = batchKey(episodeId, kind);
    const store = useEpisodeBatches.getState();
    const controller = new AbortController();
    store.start(key, { total: shotIds.length, done: 0, failed: 0, stopping: false, abort: () => { useEpisodeBatches.getState().stopping(key); controller.abort(); } });

    const { hasStyle, hasPalette } = lookAvailable(project);
    const look = { useStyle: hasStyle, usePalette: hasPalette, language, model };
    const route = `${ctx.base}?step=${kind}`;

    let made = 0;
    let failed = 0;
    let skipped = 0;
    let note: string | undefined;
    const makeJob = (shotId: string) => async () => {
        let result: "made" | "failed" | "skipped" = "failed";
        try {
            // Videos may depend on what earlier jobs just finished, so read the episode as it is now.
            const current = await getEpisode(episodeId);
            const shot = current.shots.find((item) => item.id === shotId);
            if (!shot) return;
            const env = prepareEnv(project, ctx.entities, ctx.sheets, current.shots, current.artifacts);
            let frame: RefImage | undefined;
            if (kind === "video") {
                const prev = current.shots[current.shots.findIndex((item) => item.id === shotId) - 1];
                if (needsTail(shot, prev)) {
                    // A continuous shot starts where the previous one ended; it never quietly starts from its own picture instead.
                    const before = adoptedByShot(current.artifacts, "video").get(prev.id);
                    if (!before) throw new Skipped("有镜头接着上一镜，但上一镜还没有采用的视频，已跳过");
                    frame = await captureTailFrame(before).catch(() => {
                        throw new Error("读不到上一镜的结尾画面，请稍后重试");
                    });
                } else {
                    frame = pickFirstFrame("storyboard", env.storyboards.get(shot.id));
                    if (!frame) throw new Error("先采用本镜画面");
                }
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
            result = artifact.status === "ready" ? "made" : "failed";
            if (result === "made" && autoAdopt) {
                const latest = await getEpisode(episodeId);
                if (!adoptedByShot(latest.artifacts, kind).has(shotId)) await adoptArtifact(artifact.id);
            }
        } catch (error) {
            result = error instanceof Skipped ? "skipped" : "failed";
            note ??= error instanceof Skipped ? error.message : humanError(error);
        } finally {
            if (result === "made") made += 1;
            else if (result === "skipped") skipped += 1;
            else failed += 1;
            useEpisodeBatches.getState().advance(key, result === "failed");
            ctx.refresh();
        }
    };

    await runQueue(shotIds.map(makeJob), concurrency, controller.signal);
    useEpisodeBatches.getState().finish(key);
    ctx.refresh();
    return { made, failed, skipped, stopped: controller.signal.aborted, note };
}
