import { getMediaReferenceEpoch, getProvisionalStorageKeys, markMediaReferencesChanged, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { createDesktopJsonStore } from "@/services/desktop-storage";
import { readAllDirectorStoredProjects } from "@/services/director-project-storage";

type RuntimeReferenceProvider = () => unknown | Promise<unknown>;
type HydratableStore = {
    getState: () => { hydrated?: boolean };
    persist?: {
        hasHydrated: () => boolean;
        onFinishHydration: (listener: () => void) => () => void;
    };
};

const runtimeProviders = new Map<symbol, RuntimeReferenceProvider>();
const imageGenerationLogStore = createDesktopJsonStore({ namespace: "image-generation-logs-v1", legacy: { name: "infinite-canvas", storeName: "image_generation_logs" } });
const videoGenerationLogStore = createDesktopJsonStore({ namespace: "video-generation-logs-v1", legacy: { name: "infinite-canvas", storeName: "video_generation_logs" } });
const audioGenerationLogStore = createDesktopJsonStore({ namespace: "audio-generation-logs-v1", legacy: { name: "infinite-canvas", storeName: "audio_generation_logs" } });
let snapshotQueue = Promise.resolve();

export function registerRuntimeMediaReferenceProvider(provider: RuntimeReferenceProvider) {
    const id = Symbol("runtime-media-references");
    runtimeProviders.set(id, provider);
    markMediaReferencesChanged();
    return () => {
        if (!runtimeProviders.delete(id)) return;
        markMediaReferencesChanged();
    };
}

export function collectVerifiedMediaReferenceSnapshot() {
    const snapshot = snapshotQueue.catch(() => undefined).then(buildVerifiedMediaReferenceSnapshot);
    snapshotQueue = snapshot.then(
        () => undefined,
        () => undefined,
    );
    return snapshot;
}

async function buildVerifiedMediaReferenceSnapshot(): Promise<VerifiedReferenceSnapshot> {
    const [{ useAssetStore }, { useCanvasStore }] = await Promise.all([import("@/stores/use-asset-store"), import("@/stores/canvas/use-canvas-store")]);
    await Promise.all([waitForHydration(useAssetStore), waitForHydration(useCanvasStore)]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
        const epoch = getMediaReferenceEpoch();
        const [runtimeReferences, imageGenerationLogs, videoGenerationLogs, audioGenerationLogs, directorProjects] = await Promise.all([
            Promise.all(Array.from(runtimeProviders.values()).map((provider) => provider())),
            readStoreValues(imageGenerationLogStore),
            readStoreValues(videoGenerationLogStore),
            readStoreValues(audioGenerationLogStore),
            readAllDirectorStoredProjects(),
        ]);
        const data = {
            assets: useAssetStore.getState().assets,
            projects: useCanvasStore.getState().projects,
            runtimeReferences,
            directorProjects,
            workbenchHistory: { image: imageGenerationLogs, video: videoGenerationLogs, audio: audioGenerationLogs },
            provisionalUploads: getProvisionalStorageKeys(),
        };
        if (epoch === getMediaReferenceEpoch()) return { complete: true, data, epoch };
    }
    throw new Error("媒体引用正在变化");
}

async function readStoreValues(store: ReturnType<typeof createDesktopJsonStore>) {
    const values: unknown[] = [];
    await store.iterate<unknown, void>((value) => {
        values.push(value);
    });
    return values;
}

async function waitForHydration(store: HydratableStore) {
    if (store.persist?.hasHydrated()) return;
    if (!store.persist) throw new Error("媒体引用来源尚未加载");

    await new Promise<void>((resolve, reject) => {
        let unsubscribe: () => void = () => undefined;
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            globalThis.clearTimeout(timeout);
            unsubscribe();
            resolve();
        };
        const timeout = globalThis.setTimeout(() => {
            if (settled) return;
            settled = true;
            unsubscribe();
            reject(new Error("媒体引用来源加载超时"));
        }, 5_000);
        unsubscribe = store.persist!.onFinishHydration(finish);
        if (store.persist!.hasHydrated()) finish();
    });
    if (!store.persist.hasHydrated()) throw new Error("媒体引用来源加载失败");
}
