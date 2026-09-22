import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import type { AssetFileCategory } from "@/lib/asset-file";
import { hydrateStructuredAssetMedia, shouldRefreshStoredAssetCover } from "@/lib/asset-media";
import { synchronizeStructuredAssetRelationships, removeStructuredAssetRelationships } from "@/lib/structured-asset-relationships";
import { serverStateStorage } from "@/lib/server-state-storage";
import { cleanupUnusedAssetFiles } from "@/services/asset-file-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";

export type AssetKind = "text" | "image" | "video" | "audio" | "file" | "character" | "scene";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; durationMs?: number; bytes: number; mimeType: string } };
export type FileAsset = AssetBase<"file"> & { data: { storageKey: string; fileName: string; bytes: number; mimeType: string; extension: string; category: AssetFileCategory } };
export type StructuredAssetKind = "character" | "scene";
export type StructuredAssetImage = {
    id: string;
    title: string;
    prompt?: string;
    partId?: string;
    versionId?: string;
    createdAt?: string;
    isCurrent?: boolean;
    dataUrl: string;
    storageKey?: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};
export type StructuredAssetAudio = {
    id: string;
    title: string;
    partId?: string;
    url: string;
    storageKey?: string;
    durationMs?: number;
    bytes: number;
    mimeType: string;
    isCurrent?: boolean;
};
export type StructuredAssetPart = {
    id: string;
    groupId: string;
    title: string;
    description: string;
    expectedOutput: string;
    prompt: string;
    enabled?: boolean;
};
export type StructuredAssetRelationship = {
    id: string;
    targetAssetId: string;
    targetName: string;
    label: string;
    /** Original direction of the label; mirrored endpoints preserve this identity. */
    sourceAssetId?: string;
    sourceName?: string;
};
export type StructuredAsset = AssetBase<StructuredAssetKind> & {
    data: {
        collectionVersion?: 1;
        avatarImageId?: string;
        relationships?: StructuredAssetRelationship[];
        description: string;
        /** Stable references use part/image IDs or relationships; absent on legacy assets. */
        referencePrompt?: string;
        fields: Record<string, string>;
        images: StructuredAssetImage[];
        audios?: StructuredAssetAudio[];
        parts?: StructuredAssetPart[];
        activePartId?: string;
    };
};
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset | FileAsset | StructuredAsset;

export function isStructuredAsset(asset: Asset): asset is StructuredAsset {
    return asset.kind === "character" || asset.kind === "scene";
}

type AssetBase<T extends AssetKind> = {
    id: string;
    kind: T;
    title: string;
    coverUrl: string;
    tags: string[];
    source?: string;
    note?: string;
    createdAt: string;
    updatedAt: string;
    metadata?: Record<string, unknown>;
};

type AssetStore = {
    hydrated: boolean;
    assets: Asset[];
    addAsset: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => string;
    /**
     * Adds an asset and waits until its durable store has acknowledged the
     * complete asset list. Use this from result actions, where a success toast
     * must mean that the asset will still exist after restarting the app.
     */
    addAssetPersisted: (asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    /** Replaces one known asset, or inserts it when no matching asset exists. */
    upsertAssetPersisted: (existingId: string | undefined, asset: Omit<Asset, "id" | "createdAt" | "updatedAt">) => Promise<string>;
    updateAsset: (id: string, patch: Partial<Omit<Asset, "id" | "createdAt">>) => void;
    removeAsset: (id: string) => void;
    replaceAssets: (assets: Asset[]) => void;
    cleanupImages: (extra?: unknown) => void;
};

const ASSET_STORE_KEY = "infinite-canvas:asset_store";

const assetStorage: PersistStorage<AssetStore> = {
    getItem: async (name) => {
        const value = await serverStateStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } } as VideoAsset;
                if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } } as AudioAsset;
                if (isStructuredAsset(asset)) return hydrateStructuredAssetMedia(asset, resolveImageUrl, resolveMediaUrl);
                if (asset.kind !== "image") return asset;
                if (asset.data.storageKey) {
                    const dataUrl = await resolveImageUrl(asset.data.storageKey, asset.data.dataUrl);
                    return {
                        ...asset,
                        coverUrl: shouldRefreshStoredAssetCover(asset.coverUrl, asset.data.dataUrl) ? dataUrl : asset.coverUrl,
                        data: { ...asset.data, dataUrl },
                    };
                }
                if (!asset.data.dataUrl.startsWith("data:image/")) return asset;
                const image = await uploadImage(asset.data.dataUrl);
                return { ...asset, coverUrl: asset.coverUrl.startsWith("data:image/") ? image.url : asset.coverUrl, data: { ...asset.data, dataUrl: image.url, storageKey: image.storageKey, bytes: image.bytes, mimeType: image.mimeType } };
            }),
        );
        parsed.state.assets = synchronizeStructuredAssetRelationships(parsed.state.assets);
        return parsed;
    },
    setItem: (name, value) => serverStateStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => serverStateStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: synchronizeStructuredAssetRelationships([{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets], id) }));
                return id;
            },
            addAssetPersisted: (asset) => get().upsertAssetPersisted(undefined, asset),
            upsertAssetPersisted: (existingId, asset) =>
                queueAssetWrite(async () => {
                    await waitForAssetHydration();
                    const previousAssets = get().assets;
                    const previous = existingId ? previousAssets.find((item) => item.id === existingId) : undefined;
                    const now = new Date().toISOString();
                    const id = previous?.id || nanoid();
                    const nextAsset = { ...asset, id, createdAt: previous?.createdAt || now, updatedAt: now } as Asset;
                    let snapshot = previousAssets;
                    for (;;) {
                        const exists = snapshot.some((item) => item.id === id);
                        if (previous && !exists) throw new Error("资产已被移除，请重新选择");
                        const nextAssets = synchronizeStructuredAssetRelationships(exists ? snapshot.map((item) => (item.id === id ? nextAsset : item)) : [nextAsset, ...snapshot], id);
                        // Publish both endpoints only after the complete snapshot has been written and read back.
                        await assetStorage.setItem(ASSET_STORE_KEY, { state: { assets: nextAssets }, version: 0 } as StorageValue<AssetStore>);
                        const confirmedValue = await serverStateStorage.getItem(ASSET_STORE_KEY);
                        // Ordinary library actions may run while storage is writing. Rebase before publishing.
                        if (get().assets !== snapshot) {
                            snapshot = get().assets;
                            continue;
                        }
                        const confirmed = confirmedValue ? (JSON.parse(confirmedValue) as StorageValue<AssetStore>) : null;
                        if (JSON.stringify(confirmed?.state.assets) !== JSON.stringify(nextAssets)) throw new Error("资产尚未写入本地存储");
                        set({ assets: nextAssets });
                        if (previous) get().cleanupImages({ assets: nextAssets });
                        break;
                    }
                    return id;
                }),
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: synchronizeStructuredAssetRelationships(
                        state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                        id,
                    ),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = removeStructuredAssetRelationships(state.assets, id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets: synchronizeStructuredAssetRelationships(assets) }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedAssetFiles({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                }, 0);
            },
        }),
        {
            name: ASSET_STORE_KEY,
            storage: assetStorage,
            partialize: (state) => ({ assets: state.assets }) as StorageValue<AssetStore>["state"],
            onRehydrateStorage: () => (_state, error) => {
                if (error) return;
                useAssetStore.setState({ hydrated: true });
            },
        },
    ),
);

useAssetStore.subscribe(() => markMediaReferencesChanged());

let assetWriteQueue: Promise<unknown> = Promise.resolve();
function queueAssetWrite<T>(operation: () => Promise<T>): Promise<T> {
    const pending = assetWriteQueue.then(operation, operation);
    assetWriteQueue = pending.catch(() => undefined);
    return pending;
}

async function waitForAssetHydration() {
    if (useAssetStore.persist.hasHydrated()) return;
    await new Promise<void>((resolve, reject) => {
        let unsubscribe: () => void = () => undefined;
        const timeout = globalThis.setTimeout(() => {
            unsubscribe();
            reject(new Error("资产列表尚未加载完成，请稍后重试"));
        }, 5_000);
        unsubscribe = useAssetStore.persist.onFinishHydration(() => {
            globalThis.clearTimeout(timeout);
            unsubscribe();
            resolve();
        });
        if (useAssetStore.persist.hasHydrated()) {
            globalThis.clearTimeout(timeout);
            unsubscribe();
            resolve();
        }
    });
}
