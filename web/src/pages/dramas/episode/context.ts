import type { EpisodeStep } from "@/lib/drama/episode-steps";
import { indexById, type EntityMap, type SheetMap } from "@/lib/drama/media/references";
import type { DramaArtifact, DramaEpisode, DramaExport, DramaShot, DramaSnapshot } from "@/lib/drama/types";

/** Everything a step of the episode page reads. Built once by the page; steps never fetch the episode themselves. */
export type EpisodeCtx = {
    snapshot: DramaSnapshot;
    episode: DramaEpisode;
    /** In shot order. */
    shots: DramaShot[];
    /** Shot-owned artifacts of the episode, newest first. */
    artifacts: DramaArtifact[];
    exports: DramaExport[];
    entities: EntityMap;
    /** Adopted sheet per entity. */
    sheets: SheetMap;
    /** `/dramas/:id/episodes/:eid` */
    base: string;
    selectedId?: string;
    select: (shotId: string) => void;
    go: (step: EpisodeStep, shotId?: string) => void;
    /** Refetch the episode (and the drama it belongs to). */
    refresh: () => void;
};

export function adoptedSheets(artifacts: readonly DramaArtifact[]): SheetMap {
    const map = new Map<string, DramaArtifact>();
    for (const artifact of artifacts) if (artifact.kind === "sheet" && artifact.adopted && artifact.status === "ready" && artifact.entityId && !map.has(artifact.entityId)) map.set(artifact.entityId, artifact);
    return map;
}

export const entityMap = (snapshot: DramaSnapshot): EntityMap => indexById(snapshot.entities);

/** "第 3 镜" style label by position, not by the stored `ord`. */
export const shotNumber = (shots: readonly DramaShot[], id: string) => shots.findIndex((shot) => shot.id === id) + 1;
