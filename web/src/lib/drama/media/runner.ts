/**
 * Media generation for the drama feature. Every output is a server-side artifact: it is created
 * `pending` before any provider is called, and ends `ready` or `failed`, so progress survives
 * navigation and a failed attempt stays visible as a card.
 *
 * Per-call model override: the global config is copied with `model` (and the matching
 * imageModel/videoModel/audioModel) replaced by the job's `channel::model`, plus the job's params.
 * The provider services resolve the channel from that value; nothing global is written.
 *   sheet/image  params.quality -> quality, params.aspect -> size ("16:9"), count 1
 *   video        params.aspect -> size, params.resolution -> vquality, params.seconds -> videoSeconds,
 *                params.generateAudio -> videoGenerateAudio
 *   audio        params.voice -> audioVoice, params.format -> audioFormat, params.speed -> audioSpeed
 */
import { captureVideoLastFrame } from "@/lib/video-frame";
import { readImageMeta } from "@/lib/image-utils";
import { ARTIFACT_KIND_LABELS } from "@/lib/drama/labels";
import type { ArtifactKind, DramaArtifact } from "@/lib/drama/types";
import { createArtifact, updateArtifact, type ArtifactPatch } from "@/services/drama-api";
import { requestEdit, requestGeneration } from "@/services/api/image";
import { requestAudioGeneration, storeGeneratedAudio } from "@/services/api/audio";
import { createVideoGenerationTask, isVideoGenerationPendingError, pollVideoGenerationUntilComplete, storeGeneratedVideo, type VideoGenerationTask } from "@/services/api/video";
import { readAudioMeta, readVideoMeta, publishUploadedMedia, uploadMediaFile, type UploadedFile } from "@/services/file-storage";
import { imageToDataUrl, publishUploadedImage, uploadImage } from "@/services/image-storage";
import { withWorkspaceActivity } from "@/services/workspace-activity";
import { useConfigStore, type AiConfig } from "@/stores/use-config-store";
import type { WorkspaceWorkStatus } from "@/lib/agent/workspace-status";
import type { ReferenceImage } from "@/types/image";
import { toReferenceImages, type RefImage, type ReferencePlan } from "./references";
import { humanError, requestPlan, requestPrompt } from "./state";

export { runQueue } from "./queue";

export type Owner = { entityId: string } | { shotId: string };

export type GenerationJob = {
    dramaId: string;
    owner: Owner;
    kind: ArtifactKind;
    /** Shown in the status bar. */
    title: string;
    /** The prompt body, without reference notes (those are appended from `references`). */
    prompt: string;
    references: ReferencePlan;
    firstFrame?: RefImage;
    /** `channel::model` */
    model: string;
    params: Record<string, unknown>;
    inputHash: string;
    /** Where the status bar sends the user back to. */
    route: string;
    /** Called once the pending artifact exists, so the caller can show it right away. */
    onCreated?: (artifact: DramaArtifact) => void;
};

type Result = { patch: Omit<ArtifactPatch, "status">; publish: () => void };
type Update = (status: WorkspaceWorkStatus) => void;

const ownerFields = (owner: Owner) => ("entityId" in owner ? { entityId: owner.entityId } : { shotId: owner.shotId });

/** Artifact ids this session already runs or has given up on; each is resumed at most once. */
const handled = new Set<string>();
/** A pending artifact with no provider task and no live job is a leftover of a closed page, once this old. */
const ORPHAN_AFTER_MS = 30_000;

const text = (value: unknown, fallback: string) => (typeof value === "string" && value ? value : fallback);

function requestConfig(kind: ArtifactKind, model: string, params: Record<string, unknown>): AiConfig {
    const base = { ...useConfigStore.getState().config, channelMode: "local" as const, model };
    if (kind === "video")
        return { ...base, videoModel: model, size: text(params.aspect, "auto"), vquality: text(params.resolution, "720p"), videoSeconds: String(params.seconds ?? 5), videoGenerateAudio: String(params.generateAudio !== false) };
    if (kind === "audio") return { ...base, audioModel: model, audioVoice: text(params.voice, base.audioVoice), audioFormat: text(params.format, base.audioFormat), audioSpeed: text(params.speed, base.audioSpeed) };
    return { ...base, imageModel: model, quality: text(params.quality, "auto"), size: text(params.aspect, "auto"), count: "1" };
}

/** Providers read bytes from `dataUrl`; the plan only carries storage keys. */
const loadImages = (images: RefImage[]): Promise<ReferenceImage[]> =>
    Promise.all(
        toReferenceImages(images).map(async (image) => {
            const dataUrl = await imageToDataUrl(image);
            // Providers validate the declared type, so replace the "image/*" placeholder with the real one.
            return { ...image, dataUrl, type: dataUrl.match(/^data:(image\/[^;,]+)/i)?.[1] ?? image.type };
        }),
    );

const fileResult = (file: UploadedFile): Result => ({
    patch: { mediaKey: file.storageKey, mediaUrl: file.url, mime: file.mimeType, width: file.width, height: file.height, durationMs: file.durationMs },
    publish: () => publishUploadedMedia(file),
});

async function produceImage(config: AiConfig, body: string, plan: ReferencePlan): Promise<Result> {
    const images = plan.images.length ? await requestEdit(config, body, await loadImages(plan.images)) : await requestGeneration(config, body);
    if (!images[0]) throw new Error("接口没有返回图片");
    const image = await uploadImage(images[0].dataUrl);
    return {
        patch: { mediaKey: image.storageKey, mediaUrl: image.url, mime: image.mimeType, width: image.width, height: image.height },
        publish: () => publishUploadedImage(image),
    };
}

async function finishVideo(config: AiConfig, task: VideoGenerationTask, update: Update): Promise<Result> {
    const result = await pollVideoGenerationUntilComplete(config, task);
    update("uploading");
    return fileResult(await storeGeneratedVideo(result));
}

async function produceAudio(config: AiConfig, body: string, update: Update): Promise<Result> {
    const audio = await requestAudioGeneration(config, body);
    update("uploading");
    return fileResult(await storeGeneratedAudio(audio, config.audioFormat));
}

async function produce(artifact: DramaArtifact, job: GenerationJob, update: Update): Promise<Result> {
    const plan = requestPlan(job.references, job.firstFrame, useConfigStore.getState().config.language === "en-US");
    const body = requestPrompt(job.prompt, plan);
    const config = requestConfig(job.kind, job.model, job.params);
    if (job.kind === "audio") return produceAudio(config, body, update);
    if (job.kind !== "video") return produceImage(config, body, plan);
    const task = await createVideoGenerationTask(config, body, await loadImages(plan.images));
    // The task is billable from here on: record it so a restart can pick it up instead of paying twice.
    await updateArtifact(artifact.id, { status: "pending", providerTask: task });
    return finishVideo(config, task, update);
}

/** Finishes `artifact` as ready or failed. A provider that is merely slow leaves it pending for the next session to resume. */
async function settle(artifact: DramaArtifact, work: () => Promise<Result>): Promise<DramaArtifact> {
    try {
        const { patch, publish } = await work();
        const done = await updateArtifact(artifact.id, { status: "ready", ...patch });
        publish();
        return done;
    } catch (error) {
        if (isVideoGenerationPendingError(error)) return artifact;
        return updateArtifact(artifact.id, { status: "failed", error: humanError(error) });
    }
}

const activity = (artifact: DramaArtifact, title: string, route: string) => ({ id: `drama-media:${artifact.id}`, title, status: "generating" as const, route });

/** Resolves with the final artifact; a provider failure resolves as a `failed` artifact rather than throwing. */
export async function generate(job: GenerationJob): Promise<DramaArtifact> {
    const artifact = await createArtifact(job.dramaId, { ...ownerFields(job.owner), kind: job.kind, prompt: job.prompt, model: job.model, params: job.params, inputHash: job.inputHash });
    handled.add(artifact.id);
    job.onCreated?.(artifact);
    return withWorkspaceActivity(activity(artifact, job.title, job.route), (update) => settle(artifact, () => produce(artifact, job, update)));
}

type ImportSource = File | { storageKey: string; url: string; mime?: string };

async function uploadFile(kind: ArtifactKind, file: File): Promise<Result> {
    const expected = kind === "video" ? "video/" : kind === "audio" ? "audio/" : "image/";
    if (!file.type.startsWith(expected)) throw new Error(kind === "video" ? "请选择视频文件" : kind === "audio" ? "请选择音频文件" : "请选择图片文件");
    if (expected !== "image/") return fileResult(await uploadMediaFile(file, kind));
    const image = await uploadImage(file);
    return {
        patch: { mediaKey: image.storageKey, mediaUrl: image.url, mime: image.mimeType, width: image.width, height: image.height },
        publish: () => publishUploadedImage(image),
    };
}

/** Library media is already stored; only its size and duration need reading. */
async function libraryResult(kind: ArtifactKind, source: { storageKey: string; url: string; mime?: string }): Promise<Result> {
    const base = { mediaKey: source.storageKey, mediaUrl: source.url, mime: source.mime || (kind === "video" ? "video/mp4" : kind === "audio" ? "audio/mpeg" : "image/png") };
    const meta = kind === "video" ? await readVideoMeta(source.url) : kind === "audio" ? await readAudioMeta(source.url) : await readImageMeta(source.url);
    return { patch: { ...base, ...("width" in meta ? { width: meta.width, height: meta.height } : {}), ...("durationMs" in meta ? { durationMs: meta.durationMs } : {}) }, publish: () => undefined };
}

/** Puts an existing file or library item straight into the candidates as a ready artifact. */
export async function importMedia(input: { dramaId: string; owner: Owner; kind: ArtifactKind; source: ImportSource }): Promise<DramaArtifact> {
    const { dramaId, owner, kind, source } = input;
    const imported = source instanceof File;
    const media = imported ? await uploadFile(kind, source) : await libraryResult(kind, source);
    const artifact = await createArtifact(dramaId, { ...ownerFields(owner), kind, prompt: "", model: imported ? "upload" : "library", params: {}, inputHash: "" });
    const done = await updateArtifact(artifact.id, { status: "ready", ...media.patch });
    media.publish();
    return done;
}

async function resumeVideo(artifact: DramaArtifact, route: string): Promise<DramaArtifact> {
    const config = requestConfig("video", artifact.model, artifact.params);
    const task = artifact.providerTask as VideoGenerationTask;
    return withWorkspaceActivity(activity(artifact, ARTIFACT_KIND_LABELS.video, route), (update) => settle(artifact, () => finishVideo(config, task, update)));
}

/**
 * Call with the artifacts of whatever is on screen. Videos whose provider task was recorded keep being
 * polled after a reload; anything else left pending by a closed page is marked failed. Once per artifact per session.
 */
export function resumePending(artifacts: DramaArtifact[], route: string): void {
    for (const artifact of artifacts) {
        if (artifact.status !== "pending" || handled.has(artifact.id)) continue;
        if (artifact.kind === "video" && artifact.providerTask) {
            handled.add(artifact.id);
            resumeVideo(artifact, route).catch(() => undefined);
        } else if (Date.now() - artifact.updatedAt > ORPHAN_AFTER_MS) {
            handled.add(artifact.id);
            updateArtifact(artifact.id, { status: "failed", error: "页面关闭，生成中断，请重新生成" }).catch(() => undefined);
        }
    }
}

const tails = new Map<string, Promise<RefImage>>();

/** Last frame of a (saved) video as an uploaded image, ready to be the next shot's first frame. Cached per video. */
export function captureTailFrame(video: DramaArtifact): Promise<RefImage> {
    let tail = tails.get(video.id);
    if (!tail) {
        tail = captureVideoLastFrame(video.mediaUrl)
            .then((blob) => uploadImage(blob))
            .then((image) => ({ artifactId: video.id, url: image.url, storageKey: image.storageKey, name: "上一镜尾帧" }));
        tails.set(video.id, tail);
        tail.catch(() => tails.delete(video.id));
    }
    return tail;
}
