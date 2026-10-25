import type {
    ArtifactKind, ArtifactStatus, DramaArtifact, DramaAspect, DramaChapter, DramaCover, DramaEntity, DramaEpisode, DramaExport, DramaPalette, DramaProject, DramaRelation,
    DramaRun, DramaShot, DramaSnapshot, DramaSourceType, DramaStyle, DramaSummary, EpisodeSnapshot, ExportOptions, LedgerEntry, ProposalIssue, RunProposal, RunScope, RunStage,
} from "@/lib/drama/types";

/** Client for /api/dramas*. Every function maps to one route in server/src/drama. */

export class DramaApiError extends Error {
    readonly status: number;
    /** Only set on 422: what the model (or user) has to fix. */
    readonly issues: ProposalIssue[];
    constructor(message: string, status: number, issues: ProposalIssue[] = []) {
        super(message);
        this.status = status;
        this.issues = issues;
    }
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) });
    if (!response.ok) {
        const payload = (await response.json().catch(() => null)) as { error?: string; issues?: ProposalIssue[] } | null;
        throw new DramaApiError(payload?.error || `请求失败（${response.status}）`, response.status, payload?.issues ?? []);
    }
    return response.status === 204 ? (undefined as T) : ((await response.json()) as T);
}

/** Mutable fields of a row; updates carry the `rev` they were read at (409 on mismatch). */
type Patch<T> = Partial<Omit<T, "id" | "label" | "updatedAt" | "createdAt" | "rev" | "runId" | "progress">> & { rev: number };
type EntityInput = Partial<Pick<DramaEntity, "aliases" | "description" | "appearance" | "parentId" | "sort" | "sourceNote">> & Pick<DramaEntity, "kind" | "name">;

const drama = (id: string) => `/api/dramas/${id}`;

export const listDramas = () => call<DramaSummary[]>("GET", "/api/dramas");
export const createDrama = (input: { title: string; sourceType: DramaSourceType; brief: string; aspect: DramaAspect; chapters?: Array<{ title: string; body: string }> }) => call<DramaProject>("POST", "/api/dramas", input);
export const getDrama = (id: string) => call<DramaSnapshot>("GET", drama(id));
export const updateDrama = (id: string, patch: { rev: number; title?: string; brief?: string; aspect?: DramaAspect; style?: DramaStyle | null; palette?: DramaPalette | null; cover?: DramaCover | null }) =>
    call<DramaProject>("PATCH", drama(id), patch);
export const deleteDrama = (id: string) => call<void>("DELETE", drama(id));

export const createChapter = (dramaId: string, input: { title: string; body: string; ord?: number }) => call<DramaChapter>("POST", `${drama(dramaId)}/chapters`, input);
export const updateChapter = (cid: string, patch: Patch<DramaChapter>) => call<DramaChapter>("PATCH", `/api/drama-chapters/${cid}`, patch);
export const deleteChapter = (cid: string) => call<void>("DELETE", `/api/drama-chapters/${cid}`);

export const putLedger = (dramaId: string, entries: Array<Omit<LedgerEntry, "id"> & { id?: string }>) => call<LedgerEntry[]>("PUT", `${drama(dramaId)}/ledger`, { entries });

export const createEntity = (dramaId: string, input: EntityInput) => call<DramaEntity>("POST", `${drama(dramaId)}/entities`, input);
export const updateEntity = (eid: string, patch: Patch<DramaEntity>) => call<DramaEntity>("PATCH", `/api/drama-entities/${eid}`, patch);
export const deleteEntity = (eid: string) => call<void>("DELETE", `/api/drama-entities/${eid}`);

export const createRelation = (dramaId: string, input: Omit<DramaRelation, "id">) => call<DramaRelation>("POST", `${drama(dramaId)}/relations`, input);
export const updateRelation = (rid: string, patch: Partial<Omit<DramaRelation, "id">>) => call<DramaRelation>("PATCH", `/api/drama-relations/${rid}`, patch);
export const deleteRelation = (rid: string) => call<void>("DELETE", `/api/drama-relations/${rid}`);

export const createEpisode = (dramaId: string, input: { title: string; outline?: string; targetSeconds?: number; sourceChapterIds?: string[] }) => call<DramaEpisode>("POST", `${drama(dramaId)}/episodes`, input);
export const updateEpisode = (eid: string, patch: Patch<DramaEpisode>) => call<DramaEpisode>("PATCH", `/api/drama-episodes/${eid}`, patch);
export const deleteEpisode = (eid: string) => call<void>("DELETE", `/api/drama-episodes/${eid}`);
export const getEpisode = (eid: string) => call<EpisodeSnapshot>("GET", `/api/drama-episodes/${eid}`);

export const createShot = (eid: string, afterOrd?: number) => call<DramaShot>("POST", `/api/drama-episodes/${eid}/shots`, { afterOrd });
export const updateShot = (sid: string, patch: Patch<DramaShot>) => call<DramaShot>("PATCH", `/api/drama-shots/${sid}`, patch);
export const deleteShot = (sid: string) => call<void>("DELETE", `/api/drama-shots/${sid}`);
export const reorderShots = (eid: string, ids: string[]) => call<void>("POST", `/api/drama-episodes/${eid}/shots/reorder`, { ids });

export type ArtifactInput = { entityId?: string; shotId?: string; kind: ArtifactKind; prompt: string; model: string; params: Record<string, unknown>; inputHash: string };
export type ArtifactPatch = { status: ArtifactStatus; mediaKey?: string; mediaUrl?: string; mime?: string; width?: number; height?: number; durationMs?: number; providerTask?: Record<string, unknown> | null; error?: string };
export const createArtifact = (dramaId: string, input: ArtifactInput) => call<DramaArtifact>("POST", `${drama(dramaId)}/artifacts`, input);
export const updateArtifact = (aid: string, patch: ArtifactPatch) => call<DramaArtifact>("PATCH", `/api/drama-artifacts/${aid}`, patch);
export const adoptArtifact = (aid: string) => call<DramaArtifact>("POST", `/api/drama-artifacts/${aid}/adopt`);
export const deleteArtifact = (aid: string) => call<void>("DELETE", `/api/drama-artifacts/${aid}`);

export type RunInput = { stage: RunStage; episodeId?: string; scope: RunScope; instruction: string; model: string; parentId?: string };
export const createRun = (dramaId: string, input: RunInput) => call<DramaRun>("POST", `${drama(dramaId)}/runs`, input);
export const updateRun = (rid: string, patch: { output?: string; status?: "failed" | "stopped"; error?: string }) => call<DramaRun>("PATCH", `/api/drama-runs/${rid}`, patch);
/** Throws DramaApiError with `issues` on 422. */
export const submitProposal = (rid: string, proposal: RunProposal) => call<DramaRun>("POST", `/api/drama-runs/${rid}/proposal`, { proposal });
export const adoptRun = (rid: string) => call<DramaRun>("POST", `/api/drama-runs/${rid}/adopt`);
export const rejectRun = (rid: string) => call<DramaRun>("POST", `/api/drama-runs/${rid}/reject`);
export const deleteRun = (rid: string) => call<void>("DELETE", `/api/drama-runs/${rid}`);
export const getRun = (rid: string) => call<DramaRun>("GET", `/api/drama-runs/${rid}`);

export const createExport = (eid: string, options: ExportOptions) => call<DramaExport>("POST", `/api/drama-episodes/${eid}/exports`, options);
export const getExport = (xid: string) => call<DramaExport>("GET", `/api/drama-exports/${xid}`);
export const cancelExport = (xid: string) => call<DramaExport>("POST", `/api/drama-exports/${xid}/cancel`);

export const listDramaMediaKeys = () => call<string[]>("GET", "/api/drama-media-keys");
