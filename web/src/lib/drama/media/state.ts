import { buildImageReferencePromptText, imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { MediaState } from "@/lib/drama/labels";
import type { ArtifactKind, DramaArtifact } from "@/lib/drama/types";
import { toReferenceImages, type RefImage, type ReferencePlan } from "./references.ts";

/** Artifacts the user brought in rather than generated; they never go stale. */
const IMPORT_MODELS = ["upload", "library"] as const;
const isImported = (artifact: DramaArtifact) => (IMPORT_MODELS as readonly string[]).includes(artifact.model);

/**
 * `currentHash` is what the same inputs hash to today; a generated artifact with another hash was made from older inputs.
 * An empty `inputHash` means the inputs are unknown (migrated or imported work), which is not the same as out of date.
 */
export function isStale(artifact: DramaArtifact, currentHash: string | undefined): boolean {
    return artifact.status === "ready" && !isImported(artifact) && Boolean(artifact.inputHash) && Boolean(currentHash) && artifact.inputHash !== currentHash;
}

export function artifactState(artifact: DramaArtifact, currentHash?: string): MediaState {
    if (artifact.status === "pending") return "pending";
    if (artifact.status === "failed") return "failed";
    if (isStale(artifact, currentHash)) return "stale";
    return artifact.adopted ? "adopted" : "ready";
}

/** State of one owner+kind as a whole (storyboard cards): the adopted artifact wins, then work in flight, then drafts. `artifacts` is newest first. */
export function ownerState(artifacts: readonly DramaArtifact[], currentHash?: string): MediaState {
    const adopted = artifacts.find((artifact) => artifact.adopted && artifact.status === "ready");
    if (adopted) return artifactState(adopted, currentHash);
    if (artifacts.some((artifact) => artifact.status === "pending")) return "pending";
    if (artifacts.some((artifact) => artifact.status === "ready")) return "ready";
    return artifacts.length ? "failed" : "none";
}

export const adoptedArtifact = (artifacts: readonly DramaArtifact[]) => artifacts.find((artifact) => artifact.adopted && artifact.status === "ready");

/**
 * What the model actually receives: the first frame (if any) goes first because video providers read the first
 * image as the opening frame; sheet notes shift by one so "图片N" keeps pointing at the right picture.
 * The workbench preview and the runner both go through this function.
 */
export function requestPlan(plan: ReferencePlan, firstFrame: RefImage | undefined, english: boolean): ReferencePlan {
    const frame = firstFrame ?? plan.firstFrame;
    if (!frame) return plan;
    const shifted = plan.notes.map((note) => note.replace(/^图片(\d+)/, (_, n: string) => imageReferenceLabel(Number(n))));
    const note = `${imageReferenceLabel(0)}：${english ? "opening frame; the video starts from this picture" : "首帧画面，视频从这张画面开始"}`;
    return { images: [frame, ...plan.images], notes: [note, ...shifted] };
}

/** The text sent as the prompt: the prompt plus one line per reference. Image requests prepend their own numbering header. */
export const requestPrompt = (prompt: string, plan: ReferencePlan) => [prompt.trim(), ...plan.notes].filter(Boolean).join("\n\n");

/**
 * The text the model receives, as shown in the prompt preview. Pictures go through the edit endpoint, which numbers the
 * reference images in front; video and voice requests carry the prompt and notes as they are.
 */
export function sentPrompt(kind: ArtifactKind, prompt: string, plan: ReferencePlan): string {
    const body = requestPrompt(prompt, plan);
    return (kind === "sheet" || kind === "image") && plan.images.length ? buildImageReferencePromptText(body, toReferenceImages(plan.images)) : body;
}

/** One short, plain sentence for the card: no keys, URLs or stack traces. */
export function humanError(error: unknown): string {
    if (error instanceof DOMException && error.name === "AbortError") return "已取消";
    const raw = error instanceof Error ? error.message : typeof error === "string" ? error : "";
    const text = raw
        .replace(/https?:\/\/\S+/gi, "")
        .replace(/\b(sk|key|token|bearer)[-_ ]?[\w-]{8,}/gi, "")
        .replace(/\s+/g, " ")
        .trim();
    if (!text) return "生成失败，请重试";
    return text.length > 120 ? `${text.slice(0, 117)}…` : text;
}
