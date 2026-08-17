import localforage from "localforage";

import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { mediaInputToBlob, normalizeImageBlob } from "@/lib/media-mime";
import { collectStorageKeys, createProvisionalUploadRegistry, isMediaReferenceEpochCurrent, reserveStorageKey, selectStorageKeysForDeletion, withMediaStorageFence, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { collectVerifiedMediaReferenceSnapshot } from "@/services/media-reference-snapshot";
import { fetchDesktopRemoteMedia, getDesktopMedia, isDesktopApp, listDesktopMedia, markLegacyImport, putDesktopMedia, readDesktopMediaBlob, readDesktopMediaDataUrl, removeDesktopMedia, wasLegacyValueImported } from "@/services/desktop-storage";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "image_files" });
const objectUrls = new Map<string, string>();
const MEDIA_BUCKET = "images";
const LEGACY_NAMESPACE = "media-v1:images";
const provisionalImages = createProvisionalUploadRegistry<UploadedImage, string>(
    (image) => image.storageKey,
    (storageKey) => withMediaStorageFence(() => removeStoredImages([storageKey])),
);

export async function uploadImage(input: string | Blob, remoteOptions: { expectedSha256?: string; maxBytes?: number } = {}): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        if (typeof input === "string" && isDesktopApp() && /^https?:\/\//i.test(input)) {
            const saved = await fetchDesktopRemoteMedia(MEDIA_BUCKET, storageKey, input, remoteOptions);
            if (!saved) throw new Error("图片未能写入应用存储");
            await markLegacyImport(LEGACY_NAMESPACE, storageKey);
            const storedDataUrl = await readDesktopMediaDataUrl(MEDIA_BUCKET, storageKey);
            const meta = storedDataUrl ? await readImageMeta(storedDataUrl) : { width: 1024, height: 1024, mimeType: saved.mimeType || "image/png" };
            return provisionalImages.track({
                url: saved.url,
                storageKey,
                width: meta.width,
                height: meta.height,
                bytes: saved.bytes,
                mimeType: saved.mimeType || meta.mimeType,
            });
        }
        const blob = await normalizeImageBlob(await mediaInputToBlob(input));
        const url = await saveImageBlob(storageKey, blob);
        const meta = await readImageMeta(url);
        return provisionalImages.track({ url, storageKey, width: meta.width, height: meta.height, bytes: blob.size, mimeType: blob.type || meta.mimeType });
    } finally {
        releaseReservation();
    }
}

export function publishUploadedImage(image: UploadedImage) {
    return provisionalImages.publish(image);
}

export function discardUploadedImage(image: UploadedImage) {
    return provisionalImages.discard(image);
}

export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    if (isDesktopApp()) {
        const native = await getDesktopMedia(MEDIA_BUCKET, storageKey);
        if (native) return native.url;
        if (await wasLegacyValueImported(LEGACY_NAMESPACE, storageKey)) return fallback;
        const legacy = await store.getItem<Blob>(storageKey);
        if (!legacy) {
            await markLegacyImport(LEGACY_NAMESPACE, storageKey);
            return fallback;
        }
        const migrated = await putDesktopMedia(MEDIA_BUCKET, storageKey, legacy);
        if (migrated) await markLegacyImport(LEGACY_NAMESPACE, storageKey);
        return migrated?.url || fallback;
    }
    const cached = objectUrls.get(storageKey);
    if (cached) return cached;
    const blob = await store.getItem<Blob>(storageKey);
    if (!blob) return fallback;
    const url = URL.createObjectURL(blob);
    objectUrls.set(storageKey, url);
    return url;
}

export async function getImageBlob(storageKey: string) {
    if (isDesktopApp()) {
        const nativeBlob = await readDesktopMediaBlob(MEDIA_BUCKET, storageKey);
        if (nativeBlob) return nativeBlob;
        if (await wasLegacyValueImported(LEGACY_NAMESPACE, storageKey)) return null;
        const legacy = await store.getItem<Blob>(storageKey);
        if (!legacy) {
            await markLegacyImport(LEGACY_NAMESPACE, storageKey);
            return null;
        }
        await putDesktopMedia(MEDIA_BUCKET, storageKey, legacy);
        await markLegacyImport(LEGACY_NAMESPACE, storageKey);
        return legacy;
    }
    return store.getItem<Blob>(storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    reserveStorageKey(storageKey);
    return saveImageBlob(storageKey, blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    if (isDesktopApp() && image.storageKey) {
        const dataUrl = await readDesktopMediaDataUrl(MEDIA_BUCKET, image.storageKey);
        if (dataUrl) return dataUrl;
    }
    const url = image.dataUrl || (await resolveImageUrl(image.storageKey, image.url || ""));
    if (!url || url.startsWith("data:")) return url;
    return blobToDataUrl(await (await fetch(url)).blob());
}

export async function deleteStoredImages(keys: Iterable<string>, referenceSnapshot?: VerifiedReferenceSnapshot) {
    await withMediaStorageFence(async () => {
        const verifiedSnapshot = referenceSnapshot || (await tryCollectVerifiedReferenceSnapshot());
        if (!verifiedSnapshot || !isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const deletableKeys = selectStorageKeysForDeletion(keys, verifiedSnapshot, isImageStorageKey);
        if (!deletableKeys.length) return;
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredImages(deletableKeys);
    });
}

async function removeStoredImages(keys: Iterable<string>) {
    await Promise.all(
        Array.from(new Set(keys)).map(async (key) => {
            releaseObjectUrl(key);
            if (isDesktopApp()) {
                await Promise.all([removeDesktopMedia(MEDIA_BUCKET, key), markLegacyImport(LEGACY_NAMESPACE, key)]);
            } else {
                await store.removeItem(key);
            }
        }),
    );
}

export async function cleanupUnusedImages(usedData: unknown, referenceSnapshot?: VerifiedReferenceSnapshot) {
    await withMediaStorageFence(async () => {
        const applicationSnapshot = referenceSnapshot || (await tryCollectVerifiedReferenceSnapshot());
        if (!applicationSnapshot || !isMediaReferenceEpochCurrent(applicationSnapshot.epoch)) return;
        const verifiedSnapshot: VerifiedReferenceSnapshot = {
            complete: true,
            data: { application: applicationSnapshot.data, caller: usedData },
            epoch: applicationSnapshot.epoch,
        };
        const usedKeys = collectImageStorageKeys(verifiedSnapshot.data);
        const storedKeys = new Set(isDesktopApp() ? await listDesktopMedia(MEDIA_BUCKET) : []);
        const legacyKeys: string[] = [];
        await store.iterate((_value, key) => {
            legacyKeys.push(key);
        });
        const imported = isDesktopApp() ? await Promise.all(legacyKeys.map((key) => wasLegacyValueImported(LEGACY_NAMESPACE, key))) : [];
        legacyKeys.forEach((key, index) => {
            if (!isDesktopApp() || !imported[index]) storedKeys.add(key);
        });
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const unused: string[] = [];
        storedKeys.forEach((key) => {
            if (!usedKeys.has(key)) unused.push(key);
        });
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredImages(unused);
    });
}

export function collectImageStorageKeys(value: unknown, keys = new Set<string>()) {
    return collectStorageKeys(value, isImageStorageKey, keys);
}

function isImageStorageKey(key: string) {
    return key.startsWith("image:");
}

async function tryCollectVerifiedReferenceSnapshot() {
    try {
        return await collectVerifiedMediaReferenceSnapshot();
    } catch {
        return undefined;
    }
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("读取图片失败"));
        reader.readAsDataURL(blob);
    });
}

async function saveImageBlob(storageKey: string, blob: Blob) {
    return withMediaStorageFence(() => saveImageBlobUnsafe(storageKey, blob));
}

async function saveImageBlobUnsafe(storageKey: string, blob: Blob) {
    releaseObjectUrl(storageKey);
    const normalizedBlob = await normalizeImageBlob(blob);
    if (isDesktopApp()) {
        const saved = await putDesktopMedia(MEDIA_BUCKET, storageKey, normalizedBlob);
        if (!saved) throw new Error("图片未能写入应用存储");
        await markLegacyImport(LEGACY_NAMESPACE, storageKey);
        return saved.url;
    }
    await store.setItem(storageKey, normalizedBlob);
    const url = URL.createObjectURL(normalizedBlob);
    objectUrls.set(storageKey, url);
    return url;
}

function releaseObjectUrl(storageKey: string) {
    const previous = objectUrls.get(storageKey);
    if (previous) URL.revokeObjectURL(previous);
    objectUrls.delete(storageKey);
}
