// Pure helpers behind the episode page: step progress, first-frame rules, batch selection, reading the script.
import type { DramaArtifact, DramaExport, DramaShot, ArtifactKind } from "./types.ts";

export type EpisodeStep = "script" | "shots" | "image" | "video" | "audio" | "export";
const EPISODE_STEPS: readonly EpisodeStep[] = ["script", "shots", "image", "video", "audio", "export"];
export const isEpisodeStep = (value: string | null | undefined): value is EpisodeStep => EPISODE_STEPS.includes(value as EpisodeStep);

export type StepProgress = { done: number; total: number; complete: boolean };
export type ShotMediaKind = Extract<ArtifactKind, "image" | "video" | "audio">;

const ready = (artifact: DramaArtifact) => artifact.status === "ready" && Boolean(artifact.mediaUrl);

/** Adopted, finished artifact of `kind` per shot id. */
export function adoptedByShot(artifacts: readonly DramaArtifact[], kind: ShotMediaKind): Map<string, DramaArtifact> {
    const map = new Map<string, DramaArtifact>();
    for (const artifact of artifacts) if (artifact.kind === kind && artifact.adopted && ready(artifact) && artifact.shotId && !map.has(artifact.shotId)) map.set(artifact.shotId, artifact);
    return map;
}

export function pendingShots(artifacts: readonly DramaArtifact[], kind: ShotMediaKind): Set<string> {
    return new Set(artifacts.filter((artifact) => artifact.kind === kind && artifact.status === "pending" && artifact.shotId).map((artifact) => artifact.shotId!));
}

type ProgressInput = { script: string; shots: readonly DramaShot[]; artifacts: readonly DramaArtifact[]; exports: readonly DramaExport[] };

export function stepProgress({ script, shots, artifacts, exports }: ProgressInput): Record<EpisodeStep, StepProgress> {
    const count = (kind: ShotMediaKind) => {
        const adopted = adoptedByShot(artifacts, kind);
        return shots.filter((shot) => adopted.has(shot.id)).length;
    };
    const media = (kind: ShotMediaKind): StepProgress => {
        const done = count(kind);
        return { done, total: shots.length, complete: shots.length > 0 && done === shots.length };
    };
    const exported = exports.some((item) => item.status === "ready");
    return {
        script: { done: script.trim() ? 1 : 0, total: 1, complete: Boolean(script.trim()) },
        shots: { done: shots.length, total: shots.length, complete: shots.length > 0 },
        image: media("image"),
        video: media("video"),
        audio: media("audio"),
        export: { done: exported ? 1 : 0, total: 1, complete: exported },
    };
}

/** First step that still needs work. Voice is optional, so it is never the place to land; once the video is done the cut is next. */
export function defaultStep(progress: Record<EpisodeStep, StepProgress>): EpisodeStep {
    return (["script", "shots", "image", "video"] as const).find((step) => !progress[step].complete) ?? "export";
}

export type FirstFrameSource = "storyboard" | "tail";

/** A continuous shot picks up where the previous shot ended, so by default it starts from that shot's last frame. */
export const needsTail = (shot: Pick<DramaShot, "transition">, prev: Pick<DramaShot, "id"> | undefined): boolean => shot.transition === "continuous" && Boolean(prev);

/** The tail frame of the previous shot only continues a continuous shot, and only once that shot has an adopted video. */
export function canUseTail(shot: Pick<DramaShot, "transition">, prev: Pick<DramaShot, "id"> | undefined, videos: ReadonlyMap<string, DramaArtifact>): boolean {
    return needsTail(shot, prev) && videos.has(prev!.id);
}

export const defaultFirstFrame = (shot: Pick<DramaShot, "transition">, prev: Pick<DramaShot, "id"> | undefined, videos: ReadonlyMap<string, DramaArtifact>): FirstFrameSource =>
    canUseTail(shot, prev, videos) ? "tail" : "storyboard";

export type ImageBatch = { mode: "first" | "missing"; shotIds: string[] };

/** Nothing adopted yet: only shot 1, so the look is settled on one picture first. Otherwise every shot with no adopted picture and none in flight. */
export function planImageBatch(shots: readonly DramaShot[], artifacts: readonly DramaArtifact[]): ImageBatch {
    const adopted = adoptedByShot(artifacts, "image");
    const busy = pendingShots(artifacts, "image");
    if (!shots.some((shot) => adopted.has(shot.id))) return { mode: "first", shotIds: shots[0] && !busy.has(shots[0].id) ? [shots[0].id] : [] };
    return { mode: "missing", shotIds: shots.filter((shot) => !adopted.has(shot.id) && !busy.has(shot.id)).map((shot) => shot.id) };
}

export type VideoBatch = { shotIds: string[]; seconds: number; /** No adopted storyboard picture to start from. */ skipped: number; /** Continuous shots whose previous shot has no adopted video and will not get one in this batch. */ waiting: number; chained: boolean };

/**
 * Shots without an adopted video that have a first frame to start from: a continuous shot starts from the tail of the
 * previous shot's video (adopted already, or made earlier in this batch and adopted on arrival), any other shot from its
 * adopted storyboard picture. A continuous shot never falls back to its picture silently: it waits for the previous video.
 * `chained` = some shot needs the previous shot's result, so the batch must run one at a time.
 */
export function planVideoBatch(shots: readonly DramaShot[], artifacts: readonly DramaArtifact[], autoAdopt = true): VideoBatch {
    const images = adoptedByShot(artifacts, "image");
    const videos = adoptedByShot(artifacts, "video");
    const busy = pendingShots(artifacts, "video");
    const queued = new Set<string>();
    const picked: DramaShot[] = [];
    let skipped = 0;
    let waiting = 0;
    let chained = false;
    shots.forEach((shot, index) => {
        if (videos.has(shot.id) || busy.has(shot.id)) return;
        const prev = shots[index - 1];
        if (needsTail(shot, prev)) {
            const comesLater = autoAdopt && queued.has(prev.id);
            if (!videos.has(prev.id) && !comesLater) return void waiting++;
            chained ||= comesLater;
        } else if (!images.has(shot.id)) return void skipped++;
        queued.add(shot.id);
        picked.push(shot);
    });
    return { shotIds: picked.map((shot) => shot.id), seconds: picked.reduce((sum, shot) => sum + shot.seconds, 0), skipped, waiting, chained };
}

/** Shots the cut cannot include yet. */
export const shotsMissingVideo = (shots: readonly DramaShot[], artifacts: readonly DramaArtifact[]): DramaShot[] => {
    const videos = adoptedByShot(artifacts, "video");
    return shots.filter((shot) => !videos.has(shot.id));
};

type Name = (id: string) => string | undefined;

/** What the voice actor says: dialogue then narration, no speaker names. */
export function spokenText(shot: Pick<DramaShot, "dialogue" | "narration">): string {
    return [...shot.dialogue.map((line) => line.text.trim()), shot.narration.trim()].filter(Boolean).join("\n");
}

/** The subtitle lines an export will show for this shot (dialogue only, speaker first), as the server writes them. */
export function subtitleLines(shot: Pick<DramaShot, "dialogue">, nameOf: Name): string[] {
    return shot.dialogue.flatMap((line) => {
        const text = line.text.trim();
        if (!text) return [];
        const name = line.speaker ? nameOf(line.speaker) : undefined;
        return [name ? `${name}：${text}` : text];
    });
}

/** `ids` with `id` moved by `delta` places; unchanged when it would fall off either end. */
export function moveId(ids: readonly string[], id: string, delta: number): string[] {
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return [...ids];
    const next = [...ids];
    next.splice(to, 0, next.splice(from, 1)[0]);
    return next;
}

/** Neighbour of the selected shot, or the first shot when nothing valid is selected. */
export function neighbourShot(shots: readonly Pick<DramaShot, "id">[], selectedId: string | null | undefined, delta: number): string | undefined {
    const at = shots.findIndex((shot) => shot.id === selectedId);
    if (at < 0) return shots[0]?.id;
    return shots[Math.min(shots.length - 1, Math.max(0, at + delta))]?.id;
}

export type ScriptBlock = { type: "scene" | "line" | "action" | "gap"; speaker?: string; text: string };

const SPEAKER = /^([^\s：:（(【]{1,12})[：:]\s*(.*)$/;

/** Splits a script into scene headings (【场景 1】…), spoken lines (林夏：…) and action lines. */
export function scriptBlocks(script: string): ScriptBlock[] {
    return script.split(/\r?\n/).map<ScriptBlock>((raw) => {
        const text = raw.trim();
        if (!text) return { type: "gap", text: "" };
        if (text.startsWith("【")) return { type: "scene", text };
        const spoken = SPEAKER.exec(text);
        if (spoken) return { type: "line", speaker: spoken[1], text: spoken[2] };
        return { type: "action", text };
    });
}

/** The server's reason, minus any raw tool output it may have appended after a colon. */
export function exportErrorText(error: string): string {
    const text = error.trim();
    if (!text) return "导出失败，请重试";
    const [head, ...rest] = text.split("：");
    return rest.length && /^[\x20-\x7e]+$/.test(rest.join("：")) ? head : text;
}
