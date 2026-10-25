import type { DramaShot } from "./types.ts";

/** The part of a shot the editor changes. */
export type ShotDraft = Pick<DramaShot, "seconds" | "size" | "camera" | "description" | "dialogue" | "narration" | "entityIds" | "transition" | "startState" | "endState" | "props" | "imagePrompt" | "videoPrompt">;

export const toDraft = (shot: DramaShot): ShotDraft => ({
    seconds: shot.seconds, size: shot.size, camera: shot.camera, description: shot.description, dialogue: shot.dialogue, narration: shot.narration, entityIds: shot.entityIds,
    transition: shot.transition, startState: shot.startState, endState: shot.endState, props: shot.props, imagePrompt: shot.imagePrompt, videoPrompt: shot.videoPrompt,
});

/** Object keys sorted and text trimmed, as the server stores them. */
const settle = (_key: string, value: unknown) =>
    typeof value === "string" ? value.trim() : value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value;

/** Whether two drafts say the same thing: key and binding order do not matter, and dialogue lines without text are dropped on save, so they do not count. */
export const sameDraft = (a: ShotDraft, b: ShotDraft) => {
    const canonical = (draft: ShotDraft) => JSON.stringify({ ...draft, entityIds: [...draft.entityIds].sort(), dialogue: draft.dialogue.filter((line) => line.text.trim()) }, settle);
    return canonical(a) === canonical(b);
};
