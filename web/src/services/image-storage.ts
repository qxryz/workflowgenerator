import { nanoid } from "nanoid";
import { readImageMeta } from "@/lib/image-utils";
import { mediaInputToBlob, normalizeImageBlob } from "@/lib/media-mime";
import { collectStorageKeys, createProvisionalUploadRegistry, isMediaReferenceEpochCurrent, reserveStorageKey, selectStorageKeysForDeletion, withMediaStorageFence, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { collectVerifiedMediaReferenceSnapshot } from "@/services/media-reference-snapshot";
import { fetchRemoteMedia, getStoredMedia, listStoredMedia, putStoredMedia, readStoredMediaBlob, readStoredMediaDataUrl, removeStoredMedia } from "@/services/server-storage";
import { useConfigStore } from "@/stores/use-config-store";

export type UploadedImage = {
    url: string;
    storageKey: string;
    width: number;
    height: number;
    bytes: number;
    mimeType: string;
};

const MEDIA_BUCKET = "images";
const provisionalImages = createProvisionalUploadRegistry<UploadedImage, string>(
    (image) => image.storageKey,
    (storageKey) => withMediaStorageFence(() => removeStoredImages([storageKey])),
);

export async function uploadImage(input: string | Blob, remoteOptions: { expectedSha256?: string; maxBytes?: number; allowPrivateNetwork?: boolean } = {}): Promise<UploadedImage> {
    const storageKey = `image:${nanoid()}`;
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        // Remote URLs are pulled by the server rather than the browser: most
        // provider CDNs send no CORS headers, so a client-side fetch cannot
        // read the bytes at all.
        if (typeof input === "string" && /^https?:\/\//i.test(input)) {
            const saved = await fetchRemoteMedia(MEDIA_BUCKET, storageKey, input, {
                ...remoteOptions,
                allowPrivateNetwork: remoteOptions.allowPrivateNetwork ?? useConfigStore.getState().config.allowPrivateNetworkMedia,
            });
            if (!saved) throw new Error("图片未能写入应用存储");
            const storedDataUrl = await readStoredMediaDataUrl(MEDIA_BUCKET, storageKey);
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

/** Resolves a storage key to a durable media URL. The server returns a real
 * HTTP path, so the result stays valid across reloads and can be used directly
 * as an `<img src>` — the blob-URL cache this used to need is gone. */
export async function resolveImageUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const record = await getStoredMedia(MEDIA_BUCKET, storageKey);
    return record?.url || fallback;
}

export async function getImageBlob(storageKey: string) {
    return readStoredMediaBlob(MEDIA_BUCKET, storageKey);
}

export async function setImageBlob(storageKey: string, blob: Blob) {
    reserveStorageKey(storageKey);
    return saveImageBlob(storageKey, blob);
}

export async function imageToDataUrl(image: { url?: string; dataUrl?: string; storageKey?: string }) {
    if (image.storageKey) {
        const dataUrl = await readStoredMediaDataUrl(MEDIA_BUCKET, image.storageKey);
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
    await Promise.all(Array.from(new Set(keys)).map((key) => removeStoredMedia(MEDIA_BUCKET, key)));
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
        const storedKeys = new Set(await listStoredMedia(MEDIA_BUCKET));
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const unused = Array.from(storedKeys).filter((key) => !usedKeys.has(key));
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

function saveImageBlob(storageKey: string, blob: Blob) {
    return withMediaStorageFence(async () => {
        const saved = await putStoredMedia(MEDIA_BUCKET, storageKey, await normalizeImageBlob(blob));
        if (!saved) throw new Error("图片未能写入应用存储");
        return saved.url;
    });
}
