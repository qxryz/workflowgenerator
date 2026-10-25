// Wire types for /api/dramas. Field names match the Rust serde structs in
// server/src/drama/model.rs one for one; the server is the only validator.

export type DramaSourceType = "original" | "novel" | "script";
export type DramaAspect = "16:9" | "9:16" | "1:1";

export type DramaStyle = { presetId?: string; prompt: string; promptEn?: string };
export type DramaPalette = { name: string; colors: string[] };
export type DramaCover = { variant: number; seed: number } | { mediaKey: string; mediaUrl: string };

export type DramaProject = {
    id: string;
    title: string;
    sourceType: DramaSourceType;
    brief: string;
    aspect: DramaAspect;
    style: DramaStyle | null;
    palette: DramaPalette | null;
    cover: DramaCover | null;
    createdAt: number;
    updatedAt: number;
    rev: number;
};

export type DramaSummary = Pick<DramaProject, "id" | "title" | "sourceType" | "aspect" | "cover" | "updatedAt"> & {
    counts: { chapters: number; entities: number; episodes: number };
};

export type ChapterOrigin = "imported" | "written" | "manual";
export type DramaChapter = {
    id: string;
    label: string;
    ord: number;
    title: string;
    body: string;
    summary: string;
    endState: string;
    /** Body length in characters; the drama snapshot omits `body` (empty string). */
    chars: number;
    origin: ChapterOrigin;
    runId: string | null;
    updatedAt: number;
    rev: number;
};

export type LedgerKind = "character" | "place" | "item" | "world" | "thread";
export type LedgerEntry = {
    id: string;
    kind: LedgerKind;
    name: string;
    note: string;
    chapterOrds: number[];
    status: "open" | "resolved";
};

export type EntityKind = "character" | "scene" | "prop" | "world";
export type DramaEntity = {
    id: string;
    label: string;
    kind: EntityKind;
    name: string;
    aliases: string[];
    description: string;
    appearance: string;
    parentId: string | null;
    sort: number;
    sourceNote: string;
    runId: string | null;
    updatedAt: number;
    rev: number;
};

export type RelationKind = "family" | "ally" | "mentor" | "enemy" | "love" | "belong" | "rival" | "other";
export type DramaRelation = {
    id: string;
    fromId: string;
    toId: string;
    kind: RelationKind;
    label: string;
    note: string;
};

export type DramaEpisode = {
    id: string;
    label: string;
    ord: number;
    title: string;
    outline: string;
    targetSeconds: number;
    sourceChapterIds: string[];
    script: string;
    updatedAt: number;
    rev: number;
    /** Only in snapshot listings. */
    progress?: { shots: number; images: number; videos: number };
};

export type ShotTransition = "continuous" | "cut" | "time_jump";
export type DialogueLine = { speaker: string; text: string };
export type PropState = {
    entityId: string;
    quantity: number;
    startVisible: boolean;
    endVisible: boolean;
    startHolder: string;
    endHolder: string;
    note: string;
};
export type DramaShot = {
    id: string;
    ord: number;
    seconds: number;
    size: string;
    camera: string;
    description: string;
    dialogue: DialogueLine[];
    narration: string;
    transition: ShotTransition;
    startState: string;
    endState: string;
    props: PropState[];
    imagePrompt: string;
    videoPrompt: string;
    entityIds: string[];
    updatedAt: number;
    rev: number;
};

export type ArtifactKind = "sheet" | "image" | "video" | "audio";
export type ArtifactStatus = "pending" | "ready" | "failed";
export type DramaArtifact = {
    id: string;
    entityId: string | null;
    shotId: string | null;
    kind: ArtifactKind;
    status: ArtifactStatus;
    mediaKey: string;
    mediaUrl: string;
    mime: string;
    width: number | null;
    height: number | null;
    durationMs: number | null;
    prompt: string;
    model: string;
    params: Record<string, unknown>;
    inputHash: string;
    providerTask: Record<string, unknown> | null;
    error: string;
    adopted: boolean;
    createdAt: number;
    updatedAt: number;
};

export type RunStage = "chapter" | "settings" | "episodes" | "script" | "shots" | "review";
export type RunStatus = "running" | "review" | "accepted" | "rejected" | "failed" | "stopped";
export type DramaRun = {
    id: string;
    episodeId: string | null;
    stage: RunStage;
    scope: RunScope;
    instruction: string;
    model: string;
    status: RunStatus;
    parentId: string | null;
    error: string;
    createdAt: number;
    finishedAt: number | null;
    /** Present on GET /api/drama-runs/:id only. */
    output?: string;
    proposal?: RunProposal | null;
};

/** `ord` targets one chapter; `target` scopes a review. Empty for drama-wide stages. */
export type RunScope = { ord?: number; target?: "chapters" | "settings"; chapterOrds?: number[] };

export type ChapterProposal = {
    title: string;
    body: string;
    summary: string;
    endState: string;
    ledger: Array<{ op: "add" | "update" | "resolve"; kind: LedgerKind; name: string; note: string }>;
};
export type SettingsProposal = {
    entities: Array<{ ref?: string; kind: EntityKind; name: string; aliases: string[]; description: string; appearance: string; parent?: string; sourceNote: string }>;
    relations: Array<{ from: string; to: string; kind: RelationKind; label: string; note: string }>;
};
export type EpisodesProposal = { episodes: Array<{ ref?: string; title: string; outline: string; targetSeconds: number; sourceChapters: number[] }> };
export type ScriptProposal = { script: string };
export type ShotProposalItem = {
    seconds: number;
    size: string;
    camera: string;
    description: string;
    dialogue: DialogueLine[];
    narration: string;
    entities: string[];
    transition: ShotTransition;
    startState: string;
    endState: string;
    props: Array<{ entity: string; quantity: number; startVisible: boolean; endVisible: boolean; startHolder: string; endHolder: string; note: string }>;
    imagePrompt: string;
    videoPrompt: string;
};
export type ShotsProposal = { shots: ShotProposalItem[] };
export type ReviewCriterion = "consistency" | "character" | "plot" | "ai_tone" | "style" | "foreshadowing" | "pacing";
export type ReviewProposal = { items: Array<{ criterion: ReviewCriterion; verdict: "pass" | "issue" | "unknown"; note: string; suggestion: string }> };
export type RunProposal = ChapterProposal | SettingsProposal | EpisodesProposal | ScriptProposal | ShotsProposal | ReviewProposal;

export type ProposalIssue = { path: string; message: string };

export type DramaExport = {
    id: string;
    status: "queued" | "encoding" | "ready" | "failed" | "cancelled";
    options: ExportOptions;
    mediaKey: string;
    mediaUrl: string;
    srtKey: string;
    error: string;
    createdAt: number;
    finishedAt: number | null;
};
export type ExportOptions = { resolution: "720p" | "1080p"; keepOriginalAudio: boolean; includeVoice: boolean; musicKey?: string; musicVolume?: number };

export type DramaSnapshot = {
    project: DramaProject;
    /** Without bodies; fetch with getChapter / listChapters. */
    chapters: DramaChapter[];
    ledger: LedgerEntry[];
    entities: DramaEntity[];
    relations: DramaRelation[];
    episodes: DramaEpisode[];
    /** Entity-owned artifacts. */
    artifacts: DramaArtifact[];
    runs: DramaRun[];
};

export type EpisodeSnapshot = {
    episode: DramaEpisode;
    shots: DramaShot[];
    /** Shot-owned artifacts. */
    artifacts: DramaArtifact[];
    exports: DramaExport[];
    runs: DramaRun[];
};
