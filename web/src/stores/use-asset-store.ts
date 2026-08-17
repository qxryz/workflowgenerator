import { create } from "zustand";
import { persist, type PersistStorage, type StorageValue } from "zustand/middleware";

import { nanoid } from "nanoid";
import { shouldRefreshStoredAssetCover } from "@/lib/asset-media";
import { localForageStorage } from "@/lib/localforage-storage";
import { cleanupUnusedImages, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { cleanupUnusedMedia, resolveMediaUrl } from "@/services/file-storage";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";

export type AssetKind = "text" | "image" | "video" | "audio";
export type TextAsset = AssetBase<"text"> & { data: { content: string } };
export type ImageAsset = AssetBase<"image"> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<"video"> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type AudioAsset = AssetBase<"audio"> & { data: { url: string; storageKey?: string; durationMs?: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset | AudioAsset;

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
        const value = await localForageStorage.getItem(name);
        if (!value) return null;
        const parsed = JSON.parse(value) as StorageValue<AssetStore>;
        parsed.state.assets = await Promise.all(
            parsed.state.assets.map(async (asset) => {
                if (asset.kind === "video" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } } as VideoAsset;
                if (asset.kind === "audio" && asset.data.storageKey) return { ...asset, data: { ...asset.data, url: await resolveMediaUrl(asset.data.storageKey, asset.data.url) } } as AudioAsset;
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
        return parsed;
    },
    setItem: (name, value) => localForageStorage.setItem(name, JSON.stringify(value)),
    removeItem: (name) => localForageStorage.removeItem(name),
};

export const useAssetStore = create<AssetStore>()(
    persist(
        (set, get) => ({
            hydrated: false,
            assets: [],
            addAsset: (asset) => {
                const now = new Date().toISOString();
                const id = nanoid();
                set((state) => ({ assets: [{ ...asset, id, createdAt: now, updatedAt: now } as Asset, ...state.assets] }));
                return id;
            },
            addAssetPersisted: async (asset) => {
                await waitForAssetHydration();
                const previousAssets = get().assets;
                const id = get().addAsset(asset);
                // Zustand persists state in the background. Write the exact
                // post-update snapshot here as well so callers can reliably
                // report completion only after desktop storage has accepted it.
                try {
                    await assetStorage.setItem(ASSET_STORE_KEY, { state: { assets: get().assets }, version: 0 } as StorageValue<AssetStore>);
                    const confirmed = await assetStorage.getItem(ASSET_STORE_KEY);
                    if (!confirmed?.state.assets.some((item) => item.id === id)) throw new Error("资产尚未写入本地存储");
                    return id;
                } catch (error) {
                    set({ assets: previousAssets });
                    throw error;
                }
            },
            upsertAssetPersisted: async (existingId, asset) => {
                await waitForAssetHydration();
                const previousAssets = get().assets;
                const previous = existingId ? previousAssets.find((item) => item.id === existingId) : undefined;
                const now = new Date().toISOString();
                const id = previous?.id || nanoid();
                const nextAsset = {
                    ...asset,
                    id,
                    createdAt: previous?.createdAt || now,
                    updatedAt: now,
                } as Asset;
                const nextAssets = previous
                    ? previousAssets.map((item) => (item.id === previous.id ? nextAsset : item))
                    : [nextAsset, ...previousAssets];
                set({ assets: nextAssets });
                try {
                    await assetStorage.setItem(ASSET_STORE_KEY, { state: { assets: nextAssets }, version: 0 } as StorageValue<AssetStore>);
                    const confirmed = await assetStorage.getItem(ASSET_STORE_KEY);
                    if (!confirmed?.state.assets.some((item) => item.id === id)) throw new Error("资产尚未写入本地存储");
                    if (previous) get().cleanupImages({ assets: nextAssets });
                    return id;
                } catch (error) {
                    set({ assets: previousAssets });
                    throw error;
                }
            },
            updateAsset: (id, patch) =>
                set((state) => ({
                    assets: state.assets.map((asset) => (asset.id === id ? ({ ...asset, ...patch, updatedAt: new Date().toISOString() } as Asset) : asset)),
                })),
            removeAsset: (id) =>
                set((state) => {
                    const assets = state.assets.filter((asset) => asset.id !== id);
                    get().cleanupImages({ assets });
                    return { assets };
                }),
            replaceAssets: (assets) => set({ assets }),
            cleanupImages: (extra) => {
                window.setTimeout(async () => {
                    const { useCanvasStore } = await import("@/stores/canvas/use-canvas-store");
                    await cleanupUnusedImages({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
                    await cleanupUnusedMedia({ assets: get().assets, projects: useCanvasStore.getState().projects, extra });
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
