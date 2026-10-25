import type { AppLanguage } from "@/lib/i18n";
import { buildImageReferencePromptText, imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import type { DramaArtifact, DramaEntity, DramaShot, EntityKind } from "../types";

export type RefImage = { artifactId: string; url: string; storageKey: string; name: string };
/** `images` and `notes` line up by index; the same plan feeds the preview and the request. */
export type ReferencePlan = { images: RefImage[]; notes: string[]; firstFrame?: RefImage };
export type EntityMap = ReadonlyMap<string, DramaEntity>;
/** Adopted sheet per entity id. */
export type SheetMap = ReadonlyMap<string, DramaArtifact>;
export type FirstFrameSource = "storyboard" | "tail";

export const indexById = <T extends { id: string }>(list: readonly T[]): Map<string, T> => new Map(list.map((item) => [item.id, item]));

const CAST_ORDER: EntityKind[] = ["character", "scene", "prop"];

/**
 * Entities that appear in a shot. "start" is the opening instant (props hidden at the start are
 * left out); "any" also keeps props that only appear later. A prop with no recorded state is shown.
 */
export function shotCast(shot: DramaShot, entities: EntityMap, phase: "start" | "any"): DramaEntity[] {
    const ids = [...new Set([...shot.entityIds, ...shot.props.map((prop) => prop.entityId)])];
    return ids
        .flatMap((id) => {
            const entity = entities.get(id);
            if (!entity || entity.kind === "world") return [];
            if (entity.kind === "prop") {
                const state = shot.props.find((prop) => prop.entityId === id);
                if (state && !(phase === "start" ? state.startVisible : state.startVisible || state.endVisible)) return [];
            }
            return [entity];
        })
        .sort((a, b) => CAST_ORDER.indexOf(a.kind) - CAST_ORDER.indexOf(b.kind));
}

const ROLES: Record<Exclude<EntityKind, "world">, (name: string, en: boolean) => string> = {
    character: (name, en) => (en ? `character "${name}" turnaround sheet; use for appearance consistency only` : `人物「${name}」三视图，仅用于外观一致`),
    prop: (name, en) => (en ? `prop "${name}" design sheet; use for shape and material consistency only` : `道具「${name}」三视图，仅用于形制一致`),
    scene: (name, en) => (en ? `scene "${name}" keyframe; use for the same space and layout only` : `场景「${name}」基准图，仅用于保持同一场景与空间结构`),
};

export const refImage = (artifact: DramaArtifact, name: string): RefImage => ({ artifactId: artifact.id, url: artifact.mediaUrl, storageKey: artifact.mediaKey, name });

function sheetRefs(cast: DramaEntity[], sheets: SheetMap, language: AppLanguage): ReferencePlan {
    const plan: ReferencePlan = { images: [], notes: [] };
    for (const entity of cast) {
        const sheet = sheets.get(entity.id);
        if (entity.kind === "world" || !sheet || sheet.status !== "ready" || !sheet.mediaUrl) continue;
        plan.images.push(refImage(sheet, entity.name));
        plan.notes.push(`${imageReferenceLabel(plan.images.length - 1)}：${ROLES[entity.kind](entity.name, language === "en-US")}`);
    }
    return plan;
}

export type ShotReferenceInput = { shot: DramaShot; entities: EntityMap; sheets: SheetMap; language: AppLanguage };

export const shotImageReferences = ({ shot, entities, sheets, language }: ShotReferenceInput): ReferencePlan => sheetRefs(shotCast(shot, entities, "start"), sheets, language);

/** `firstFrame` is the storyboard image or the previous shot's tail frame, passed separately from the sheets. */
export function shotVideoReferences(input: ShotReferenceInput, firstFrame?: RefImage): ReferencePlan {
    const plan = sheetRefs(shotCast(input.shot, input.entities, "any"), input.sheets, input.language);
    return firstFrame ? { ...plan, firstFrame } : plan;
}

export function pickFirstFrame(source: FirstFrameSource, storyboard?: DramaArtifact, tail?: RefImage): RefImage | undefined {
    if (source === "tail") return tail;
    return storyboard?.status === "ready" && storyboard.mediaUrl ? refImage(storyboard, "本镜分镜图") : undefined;
}

/** Images the user picked for an entity sheet (uploads, library, other sheets). */
export function sheetReferences(images: RefImage[], language: AppLanguage): ReferencePlan {
    const en = language === "en-US";
    return {
        images,
        notes: images.map((image, index) => `${imageReferenceLabel(index)}：${en ? `reference "${image.name}"; specified details only, never replaces the subject identity` : `参考图「${image.name}」，仅用于指定细节，不替代主体身份`}`),
    };
}

/** dataUrl stays empty until the runner loads the bytes. */
export const toReferenceImages = (images: RefImage[]): ReferenceImage[] => images.map((image) => ({ id: image.artifactId, name: image.name, type: "image/*", dataUrl: "", url: image.url, storageKey: image.storageKey }));

/** The exact text sent to the model, so preview and request cannot drift apart. */
export function withReferenceNotes(prompt: string, plan: ReferencePlan): string {
    return buildImageReferencePromptText([prompt, ...plan.notes].join("\n\n"), toReferenceImages(plan.images));
}
