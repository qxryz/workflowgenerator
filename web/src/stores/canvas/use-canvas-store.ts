import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { localForageStorage } from "@/lib/localforage-storage";
import { commitDesktopValues, getDesktopValue, isDesktopApp, markLegacyImport, wasLegacyValueImported } from "@/services/desktop-storage";
import type { CanvasBackgroundMode } from "@/lib/canvas-theme";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from "@/types/canvas";
import { createDebouncedWriteQueue } from "@/lib/debounced-write-queue";

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
let legacyCanvasStore: Promise<LocalForage> | null = null;
const getLegacyCanvasStore = () => {
    legacyCanvasStore ||= import("localforage").then((module) => {
        const localforage = ((module as unknown as { default?: LocalForage }).default || module) as LocalForage;
        return localforage.createInstance({ name: "infinite-canvas", storeName: "app_state" });
    });
    return legacyCanvasStore;
};
let nativeProjectRefs = new Map<string, CanvasProject>();
let nativeWriteQueue = Promise.resolve();
const webWriteQueue = createDebouncedWriteQueue<{ name: string; value: StorageValue<CanvasStore> }>(
    async ({ name, value }) => {
        await localForageStorage.setItem(name, JSON.stringify(value));
    },
    400,
);

const canvasStorage: PersistStorage<CanvasStore> = {
    getItem: async (name) => {
        if (isDesktopApp()) {
            const indexValue = await getDesktopValue(PROJECT_META_NAMESPACE, PROJECT_INDEX_KEY);
            if (indexValue != null) {
                const projectIds = parseProjectIndex(indexValue);
                const projects = (
                    await Promise.all(
                        projectIds.map(async (id) => {
                            const saved = await getDesktopValue(PROJECT_NAMESPACE, id);
                            return saved ? parseProject(saved) : null;
                        }),
                    )
                ).filter((project): project is CanvasProject => Boolean(project));
                nativeProjectRefs = new Map(projects.map((project) => [project.id, project]));
                return { state: { projects } as CanvasStore };
            }
            if (await wasLegacyValueImported(PROJECT_NAMESPACE, name)) return null;
            const nativeLegacy = await getDesktopValue("zustand-v1", name);
            const webLegacy = nativeLegacy || (await (await getLegacyCanvasStore()).getItem<string>(name)) || window.localStorage.getItem(name);
            if (!webLegacy) {
                await commitDesktopValues([
                    { namespace: PROJECT_META_NAMESPACE, key: PROJECT_INDEX_KEY, value: "[]" },
                    { namespace: "legacy-import-v1", key: `${PROJECT_NAMESPACE}::${name}`, value: "1" },
                ]);
                return null;
            }
            const parsed = JSON.parse(webLegacy) as StorageValue<CanvasStore>;
            const projects = ((parsed.state as PersistedCanvasState).projects || []).filter(Boolean);
            await persistNativeProjects(projects);
            await markLegacyImport(PROJECT_NAMESPACE, name);
            return parsed;
        }
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<CanvasStore>;
        queuedPersistState = parsed.state as PersistedCanvasState;
        return parsed;
    },
    setItem: (name, value) => {
        const nextState = value.state as PersistedCanvasState;
        if (isDesktopApp()) {
            const projects = nextState.projects || [];
            nativeWriteQueue = nativeWriteQueue.catch(() => undefined).then(() => persistNativeProjects(projects));
            return nativeWriteQueue;
        }
        if (queuedPersistState && queuedPersistState.projects === nextState.projects) return;
        queuedPersistState = nextState;
        webWriteQueue.schedule({ name, value });
    },
    removeItem: async (name) => {
        if (!isDesktopApp()) {
            webWriteQueue.cancelPending();
            await webWriteQueue.waitForIdle().catch(() => undefined);
            queuedPersistState = null;
            return localForageStorage.removeItem(name);
        }
        const projectIds = Array.from(nativeProjectRefs.keys());
        await commitDesktopValues([...projectIds.map((id) => ({ namespace: PROJECT_NAMESPACE, key: id, value: null })), { namespace: PROJECT_META_NAMESPACE, key: PROJECT_INDEX_KEY, value: null }]);
        await markLegacyImport(PROJECT_NAMESPACE, name);
        nativeProjectRefs = new Map();
    },
};

async function persistNativeProjects(projects: CanvasProject[]) {
    const nextById = new Map(projects.map((project) => [project.id, project]));
    const changed = projects.filter((project) => nativeProjectRefs.get(project.id) !== project);
    const removed = Array.from(nativeProjectRefs.keys()).filter((id) => !nextById.has(id));
    await commitDesktopValues([
        ...changed.map((project) => ({ namespace: PROJECT_NAMESPACE, key: project.id, value: JSON.stringify(project) })),
        ...removed.map((id) => ({ namespace: PROJECT_NAMESPACE, key: id, value: null })),
        { namespace: PROJECT_META_NAMESPACE, key: PROJECT_INDEX_KEY, value: JSON.stringify(projects.map((project) => project.id)) },
    ]);
    nativeProjectRefs = nextById;
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
        return JSON.parse(value) as CanvasProject;
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
                const project: CanvasProject = {
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
                };
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

export async function flushCanvasStoreWrites() {
    if (isDesktopApp()) {
        await nativeWriteQueue;
        return;
    }
    await webWriteQueue.flush();
}
