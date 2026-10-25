import type { Look, Prepared } from "@/components/drama/generation-workbench";
import { adoptedByShot, spokenText, type ShotMediaKind } from "@/lib/drama/episode-steps";
import { inputHash, shotImagePrompt, shotInputs, shotVideoPrompt, type ShotContext } from "@/lib/drama/media/prompts";
import { shotImageReferences, shotVideoReferences, type EntityMap, type RefImage, type SheetMap } from "@/lib/drama/media/references";
import { referenceCapacity, renderedVideoSeconds } from "@/lib/drama/media/model-options";
import type { DramaArtifact, DramaProject, DramaShot } from "@/lib/drama/types";
import { useConfigStore } from "@/stores/use-config-store";

/** What a shot's media is made from. Prompts, references and the staleness hash all come from here, so the workbench, the strip and batches agree. */
export type PrepareEnv = {
    project: DramaProject;
    entities: EntityMap;
    sheets: SheetMap;
    /** In shot order; the previous shot is found here. */
    shots: readonly DramaShot[];
    /** Adopted storyboard picture per shot id. */
    storyboards: ReadonlyMap<string, DramaArtifact>;
};

const NO_REFERENCES = { images: [], notes: [] };

function context(env: PrepareEnv, shot: DramaShot, look: Look): ShotContext {
    const index = env.shots.findIndex((item) => item.id === shot.id);
    return { shot, prev: env.shots[index - 1], entities: env.entities, aspect: env.project.aspect, style: env.project.style, palette: env.project.palette, ...look };
}

function prepareImage(env: PrepareEnv, shot: DramaShot, look: Look): Prepared {
    const { aspect } = env.project;
    const ctx = context(env, shot, look);
    const prompt = shotImagePrompt(ctx);
    const capacity = referenceCapacity(useConfigStore.getState().config, "image", look.model);
    const references = shotImageReferences({ shot, entities: env.entities, sheets: env.sheets, language: look.language, capacity });
    return { prompt, references, aspect, inputHash: inputHash({ inputs: shotInputs(ctx, "image"), refs: references.images.map((image) => image.artifactId), model: look.model, aspect }) };
}

/** The hash follows the storyboard picture but not which first frame is chosen, so switching the source never makes finished videos look out of date. */
function prepareVideo(env: PrepareEnv, shot: DramaShot, look: Look, firstFrame?: RefImage): Prepared {
    const { aspect } = env.project;
    const seconds = renderedVideoSeconds(useConfigStore.getState().config, look.model, shot.seconds);
    const ctx = { ...context(env, shot, look), videoSeconds: seconds };
    const prompt = shotVideoPrompt(ctx);
    const capacity = referenceCapacity(useConfigStore.getState().config, "video", look.model);
    const references = shotVideoReferences({ shot, entities: env.entities, sheets: env.sheets, language: look.language, capacity }, firstFrame);
    const hash = inputHash({ inputs: shotInputs(ctx, "video"), refs: references.images.map((image) => image.artifactId), board: env.storyboards.get(shot.id)?.id ?? "", model: look.model, aspect });
    return { prompt, references, firstFrame, aspect, inputHash: hash, params: { seconds } };
}

function prepareAudio(env: PrepareEnv, shot: DramaShot, look: Look): Prepared {
    const prompt = spokenText(shot);
    return { prompt, references: NO_REFERENCES, aspect: env.project.aspect, inputHash: inputHash({ kind: "audio", prompt, model: look.model }) };
}

export function prepareShot(kind: ShotMediaKind, env: PrepareEnv, shot: DramaShot, look: Look, firstFrame?: RefImage): Prepared {
    return kind === "image" ? prepareImage(env, shot, look) : kind === "video" ? prepareVideo(env, shot, look, firstFrame) : prepareAudio(env, shot, look);
}

export const prepareEnv = (project: DramaProject, entities: EntityMap, sheets: SheetMap, shots: readonly DramaShot[], artifacts: readonly DramaArtifact[]): PrepareEnv => ({
    project, entities, sheets, shots, storyboards: adoptedByShot(artifacts, "image"),
});
