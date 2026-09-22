import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { commitCanvasProjects, getStoredValue } from "@/services/server-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createDebouncedWriteQueue } from "@/lib/debounced-write-queue";
import { normalizeCanvasProject } from "@/lib/canvas/canvas-portability";
import { mergeCanvasValues } from "@/lib/canvas/canvas-save-merge";

export type CanvasProject = {
    id: string;
    title: string;
    createdAt: string;
    updatedAt: string;
    nodes: CanvasNodeData[];
    connections: CanvasConnection[];
    chatSessions: CanvasAssistantSession[];
    activeChatId: string | null;
    backgroundMode: CanvasBackgroundMode;
    showImageInfo: boolean;
    viewport: ViewportTransform;
};

type CanvasStore = {
    hydrated: boolean;
    projects: CanvasProject[];
    createProject: (title?: string) => string;
    importProject: (project: Partial<CanvasProject>) => string;
    openProject: (id: string) => CanvasProject | null;
    renameProject: (id: string, title: string) => void;
    deleteProjects: (ids: string[]) => void;
    replaceProjects: (projects: CanvasProject[]) => void;
    updateProject: (id: string, patch: Partial<Pick<CanvasProject, "nodes" | "connections" | "chatSessions" | "activeChatId" | "backgroundMode" | "showImageInfo" | "viewport">>) => void;
};

const initialViewport: ViewportTransform = { x: 0, y: 0, k: 1 };
const CANVAS_STORE_KEY = "infinite-canvas:canvas_store";
type PersistedCanvasState = Pick<CanvasStore, "projects">;
let queuedPersistState: PersistedCanvasState | null = null;
const PROJECT_NAMESPACE = "canvas-project-v1";
const PROJECT_META_NAMESPACE = "canvas-project-meta-v1";
const PROJECT_INDEX_KEY = "projects";
// Projects are stored one row per project plus an index row, so a debounced
// write only has to touch the projects that actually changed.
let storedProjectRefs = new Map<string, CanvasProject>();
const storedProjectValues = new Map<string, string>();
const projectOrigins = new WeakMap<CanvasProject, string | null>();
const projectParents = new WeakMap<CanvasProject, CanvasProject>();
const ownCommits = new Map<string, { draft: CanvasProject; saved: CanvasProject | null; raw: string | null }>();
function descendsFrom(project: CanvasProject, ancestor: CanvasProject) {
    let current: CanvasProject | undefined = project;
    while (current) { if (current === ancestor) return true; current = projectParents.get(current); }
    return false;
}
type PendingProjects = { projects: CanvasProject[]; removed: Array<{ id: string; expected: string | null; draft?: CanvasProject }> };
let scheduledVersion = 0;
const strictProjects = new Map<string, number>();
const projectWriteQueue = createDebouncedWriteQueue<PendingProjects>(persistStoredProjects, 400);
export const CANVAS_RECONCILED_EVENT = "wg:canvas-reconciled";
export type CanvasReconciledEvent = { projectId: string; previous: CanvasProject | null; project: CanvasProject | null; conflicted: boolean; backupId?: string };
export class CanvasSaveConflictError extends Error {}

function scheduleProjects(projects: CanvasProject[], previousProjects: CanvasProject[] = []) {
    for (const project of projects) if (!projectOrigins.has(project)) projectOrigins.set(project, storedProjectValues.get(project.id) ?? null);
    const ids = new Set(projects.map((project) => project.id));
    const previous = new Map(previousProjects.map((project) => [project.id, project]));
    const removed = [...new Set([...storedProjectRefs.keys(), ...previous.keys()])].filter((id) => !ids.has(id)).map((id) => ({ id, expected: storedProjectValues.get(id) ?? null, draft: previous.get(id) }));
    scheduledVersion++;
    projectWriteQueue.schedule({ projects, removed });
}

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async () => {
        const indexValue = await getStoredValue(PROJECT_META_NAMESPACE, PROJECT_INDEX_KEY);
        if (indexValue == null) return null;
        const projectIds = parseProjectIndex(indexValue);
        const projects = (
            await Promise.all(
                projectIds.map(async (id) => {
                    const saved = await getStoredValue(PROJECT_NAMESPACE, id);
                    if (!saved) return null;
                    const project = parseProject(saved);
                    if (project) { storedProjectValues.set(id, saved); projectOrigins.set(project, saved); }
                    return project;
                }),
            )
        ).filter((project): project is CanvasProject => Boolean(project));
        storedProjectRefs = new Map(projects.map((project) => [project.id, project]));
        queuedPersistState = { projects };
        return { state: { projects } as CanvasStore };
    },
    setItem: (_name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        const previousProjects = queuedPersistState?.projects ?? [];
        const previous = new Map(previousProjects.map((project) => [project.id, project]));
        for (const project of nextState.projects) { const parent = previous.get(project.id); if (parent && parent !== project && !projectParents.has(project)) projectParents.set(project, parent); }
        queuedPersistState = nextState;
        scheduleProjects(nextState.projects || [], previousProjects);
    },
    removeItem: async () => {
        projectWriteQueue.cancelPending();
        await projectWriteQueue.waitForIdle().catch(() => undefined);
        queuedPersistState = null;
        await persistStoredProjects({ projects: [], removed: [...storedProjectRefs.keys()].map((id) => ({ id, expected: storedProjectValues.get(id) ?? null })) });
    },
};

async function persistStoredProjects({ projects, removed }: PendingProjects) {
    const submitted = new Map(projects.map((project) => [project.id, project]));
    const changes = new Map(projects.filter((project) => storedProjectRefs.get(project.id) !== project).map((project) => [project.id, {
        id: project.id, expected: projectOrigins.get(project) ?? null, value: JSON.stringify(project) as string | null,
    }]));
    for (const item of removed) {
        const prior = ownCommits.get(item.id);
        const expected = item.draft && prior && descendsFrom(item.draft, prior.draft) && JSON.stringify(prior.saved) === JSON.stringify(prior.draft) ? prior.raw : item.expected;
        changes.set(item.id, { id: item.id, expected, value: null });
    }
    if (!changes.size) return;
    const reconciled = new Set<string>();
    const conflicts = new Map<string, string | undefined>();
    const preserveDraft = (id: string, local: CanvasProject | null) => {
        if (conflicts.has(id)) return;
        let backupId: string | undefined;
        if (local) {
            backupId = nanoid();
            const backup = { ...local, id: backupId, title: `${local.title}（冲突副本）`, updatedAt: new Date().toISOString() };
            changes.set(backupId, { id: backupId, expected: null, value: JSON.stringify(backup) });
        }
        conflicts.set(id, backupId);
    };
    // A later keystroke may have been queued before this tab's earlier save
    // completed. Rebase that causal successor rather than treating it as a
    // competing tab edit of the same text.
    for (const project of projects) {
        const prior = ownCommits.get(project.id);
        if (!changes.has(project.id) || !prior || !descendsFrom(project, prior.draft)) continue;
        const merged = mergeCanvasValues<CanvasProject | null>(prior.draft, project, prior.saved);
        if (merged.conflicts.length) preserveDraft(project.id, project);
        if (JSON.stringify(merged.value) !== JSON.stringify(project)) reconciled.add(project.id);
        changes.set(project.id, { id: project.id, expected: prior.raw, value: merged.value ? JSON.stringify(merged.value) : null });
    }
    for (let attempt = 0; attempt < 4; attempt++) {
        const result = await commitCanvasProjects([...changes.values()]);
        if (result.conflict) {
            for (const current of result.projects) {
                const change = changes.get(current.id)!;
                if (change.expected === current.value) continue;
                const before = change.expected ? JSON.parse(change.expected) as CanvasProject : null;
                const local = change.value ? JSON.parse(change.value) as CanvasProject : null;
                const remote = current.value ? JSON.parse(current.value) as CanvasProject : null;
                const strict = strictProjects.has(current.id);
                const merged = strict ? { value: remote, conflicts: ["project"] } : mergeCanvasValues(before, local, remote);
                if (merged.conflicts.length) preserveDraft(current.id, local);
                reconciled.add(current.id);
                changes.set(current.id, { id: current.id, expected: current.value, value: merged.value ? JSON.stringify(merged.value) : null });
            }
            continue;
        }
        const saved = new Map<string, CanvasProject | null>();
        for (const item of result.projects) {
            const project = item.value ? parseProject(item.value) : null;
            saved.set(item.id, project);
            const draft = submitted.get(item.id);
            if (draft) { ownCommits.set(item.id, { draft, saved: project, raw: item.value }); projectParents.delete(draft); }
            else if (!project) ownCommits.delete(item.id);
            if (project && item.value) { storedProjectRefs.set(item.id, project); storedProjectValues.set(item.id, item.value); projectOrigins.set(project, item.value); }
            else { storedProjectRefs.delete(item.id); storedProjectValues.delete(item.id); }
        }
        const state = useCanvasStore.getState();
        const notifications: CanvasReconciledEvent[] = [];
        const nextProjects = state.projects.flatMap((local) => {
            if (!saved.has(local.id)) return [local];
            const committed = saved.get(local.id)!;
            // A newer local edit already has its own queued snapshot and original
            // base. Let its subsequent CAS merge it instead of erasing that edit.
            if (submitted.has(local.id) && local !== submitted.get(local.id)) return [local];
            if (reconciled.has(local.id)) notifications.push({ projectId: local.id, previous: submitted.get(local.id) ?? null, project: committed, conflicted: conflicts.has(local.id), backupId: conflicts.get(local.id) });
            return committed ? [committed] : [];
        });
        for (const [id, project] of saved) if (project && !submitted.has(id) && !nextProjects.some((item) => item.id === id)) nextProjects.unshift(project);
        queuedPersistState = { projects: nextProjects };
        useCanvasStore.setState({ projects: nextProjects });
        for (const detail of notifications) if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent<CanvasReconciledEvent>(CANVAS_RECONCILED_EVENT, { detail }));
        if (conflicts.size) throw new CanvasSaveConflictError([...conflicts.values()].some(Boolean) ? "画布已在其他页面修改；未合并的编辑保留在画布列表的冲突副本中，请检查后重试" : "画布已在其他页面修改，已保留最新内容，请检查后重试");
        return;
    }
    throw new CanvasSaveConflictError("画布正在被其他页面连续修改，当前更改尚未保存，请稍后重试");
}

function parseProjectIndex(value: string) {
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
        return [];
    }
}

function parseProject(value: string) {
    try {
        return normalizeCanvasProject(JSON.parse(value) as CanvasProject);
    } catch {
        return null;
    }
}

export const useCanvasStore = create<CanvasStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            projects: [],
            createProject: (title = "未命名画布") => {
                const now = new Date().toISOString();
                const id = nanoid();
                const project: CanvasProject = {
                    id,
                    title,
                    createdAt: now,
                    updatedAt: now,
                    nodes: [],
                    connections: [],
                    chatSessions: [],
                    activeChatId: null,
                    backgroundMode: "lines",
                    showImageInfo: false,
                    viewport: initialViewport,
                };
                set((state) => ({ projects: [project, ...state.projects] }));
                return id;
            },
            importProject: (source) => {
                const now = new Date().toISOString();
                const project: CanvasProject = normalizeCanvasProject({
                    id: nanoid(),
                    title: source.title || "导入画布",
                    createdAt: source.createdAt || now,
                    updatedAt: now,
                    nodes: source.nodes || [],
                    connections: source.connections || [],
                    chatSessions: source.chatSessions || [],
                    activeChatId: source.activeChatId || null,
                    backgroundMode: source.backgroundMode || "lines",
                    showImageInfo: source.showImageInfo || false,
                    viewport: source.viewport || initialViewport,
                });
                set((state) => ({ projects: [project, ...state.projects] }));
                return project.id;
            },
            openProject: (id) => {
                return get().projects.find((item) => item.id === id) || null;
            },
            renameProject: (id, title) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, title: title.trim() || project.title, updatedAt: new Date().toISOString() } : project)),
                })),
            deleteProjects: (ids) =>
                set((state) => {
                    const projects = state.projects.filter((project) => !ids.includes(project.id));
                    return { projects };
                }),
            replaceProjects: (projects) => set({ projects }),
            updateProject: (id, patch) =>
                set((state) => ({
                    projects: state.projects.map((project) => (project.id === id ? { ...project, ...patch, updatedAt: new Date().toISOString() } : project)),
                })),
        }),
        {
            name: CANVAS_STORE_KEY,
            storage: canvasStorage,
            partialize: (state) =>
                ({
                    projects: state.projects,
                }) as StorageValue<CanvasStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) return;
                useCanvasStore.setState({ hydrated: true });
            },
        },
    ),
);

useCanvasStore.subscribe(() => markMediaReferencesChanged());

export async function flushCanvasStoreWrites(options: { strictProjectId?: string } = {}) {
    const id = options.strictProjectId;
    if (id) strictProjects.set(id, (strictProjects.get(id) || 0) + 1);
    try {
        for (let attempt = 0; attempt < 8; attempt++) {
            const version = scheduledVersion;
            await projectWriteQueue.flush();
            if (version === scheduledVersion) return;
        }
        throw new Error("画布仍在更新，请稍后重试保存");
    } finally {
        if (id) { const count = (strictProjects.get(id) || 1) - 1; if (count) strictProjects.set(id, count); else strictProjects.delete(id); }
    }
}
