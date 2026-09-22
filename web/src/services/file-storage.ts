import { nanoid } from "nanoid";
import { mediaInputToBlob, normalizeMediaBlob } from "@/lib/media-mime";
import { collectStorageKeys, createProvisionalUploadRegistry, isMediaReferenceEpochCurrent, reserveStorageKey, selectStorageKeysForDeletion, withMediaStorageFence, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { collectVerifiedMediaReferenceSnapshot } from "@/services/media-reference-snapshot";
import { fetchRemoteMedia, getStoredMedia, listStoredMedia, putStoredMedia, readStoredMediaBlob, removeStoredMedia } from "@/services/server-storage";
import { useConfigStore } from "@/stores/use-config-store";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const MEDIA_BUCKET = "media";
const provisionalMedia = createProvisionalUploadRegistry<UploadedFile, string>(
    (file) => file.storageKey,
    (storageKey) => withMediaStorageFence(() => removeStoredMediaKeys([storageKey])),
);

export async function uploadMediaFile(input: string | Blob, prefix = "file", remoteOptions: { expectedSha256?: string; maxBytes?: number; allowPrivateNetwork?: boolean } = {}): Promise<UploadedFile> {
    const storageKey = `${prefix}:${nanoid()}`;
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        // Remote URLs are pulled by the server: provider CDNs generally send no
        // CORS headers, so the browser cannot read these bytes itself.
        if (typeof input === "string" && /^https?:\/\//i.test(input)) {
            const saved = await fetchRemoteMedia(MEDIA_BUCKET, storageKey, input, {
                ...remoteOptions,
                allowPrivateNetwork: remoteOptions.allowPrivateNetwork ?? useConfigStore.getState().config.allowPrivateNetworkMedia,
            });
            if (!saved) throw new Error("媒体未能写入应用存储");
            const meta = saved.mimeType.startsWith("video/") ? await readVideoMeta(saved.url) : saved.mimeType.startsWith("audio/") ? await readAudioMeta(saved.url) : {};
            return provisionalMedia.track({ url: saved.url, storageKey, bytes: saved.bytes, mimeType: saved.mimeType, ...meta });
        }
        const blob = await normalizeMediaBlob(await mediaInputToBlob(input), prefix);
        const url = await saveMediaBlob(storageKey, blob);
        const meta = blob.type.startsWith("video/") ? await readVideoMeta(url) : blob.type.startsWith("audio/") ? await readAudioMeta(url) : {};
        return provisionalMedia.track({ url, storageKey, bytes: blob.size, mimeType: blob.type || "application/octet-stream", ...meta });
    } finally {
        releaseReservation();
    }
}

export function publishUploadedMedia(file: UploadedFile) {
    return provisionalMedia.publish(file);
}

export function discardUploadedMedia(file: UploadedFile) {
    return provisionalMedia.discard(file);
}

/** Resolves a storage key to a durable media URL. The server returns a real
 * HTTP path that supports Range requests, so `<video>` seeking works without
 * the blob-URL cache this used to maintain. */
export async function resolveMediaUrl(storageKey?: string, fallback = "") {
    if (!storageKey) return fallback;
    const record = await getStoredMedia(MEDIA_BUCKET, storageKey);
    return record?.url || fallback;
}

export async function getMediaBlob(storageKey: string) {
    return readStoredMediaBlob(MEDIA_BUCKET, storageKey);
}

export async function setMediaBlob(storageKey: string, blob: Blob) {
    reserveStorageKey(storageKey);
    return saveMediaBlob(storageKey, blob);
}

export async function deleteStoredMedia(keys: Iterable<string>, referenceSnapshot?: VerifiedReferenceSnapshot) {
    await withMediaStorageFence(async () => {
        const verifiedSnapshot = referenceSnapshot || (await tryCollectVerifiedReferenceSnapshot());
        if (!verifiedSnapshot || !isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const deletableKeys = selectStorageKeysForDeletion(keys, verifiedSnapshot, isMediaStorageKey);
        if (!deletableKeys.length) return;
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredMediaKeys(deletableKeys);
    });
}

async function removeStoredMediaKeys(keys: Iterable<string>) {
    await Promise.all(Array.from(new Set(keys)).map((key) => removeStoredMedia(MEDIA_BUCKET, key)));
}

export async function cleanupUnusedMedia(usedData: unknown, referenceSnapshot?: VerifiedReferenceSnapshot) {
    await withMediaStorageFence(async () => {
        const applicationSnapshot = referenceSnapshot || (await tryCollectVerifiedReferenceSnapshot());
        if (!applicationSnapshot || !isMediaReferenceEpochCurrent(applicationSnapshot.epoch)) return;
        const verifiedSnapshot: VerifiedReferenceSnapshot = {
            complete: true,
            data: { application: applicationSnapshot.data, caller: usedData },
            epoch: applicationSnapshot.epoch,
        };
        const usedKeys = collectMediaStorageKeys(verifiedSnapshot.data);
        const storedKeys = new Set(await listStoredMedia(MEDIA_BUCKET));
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const unused = Array.from(storedKeys).filter((key) => !usedKeys.has(key));
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredMediaKeys(unused);
    });
}

export function collectMediaStorageKeys(value: unknown, keys = new Set<string>()) {
    return collectStorageKeys(value, isMediaStorageKey, keys);
}

function isMediaStorageKey(key: string) {
    return key.includes(":") && !key.startsWith("image:");
}

async function tryCollectVerifiedReferenceSnapshot() {
    try {
        return await collectVerifiedMediaReferenceSnapshot();
    } catch {
        return undefined;
    }
}

export function readVideoMeta(url: string) {
    return new Promise<{ width: number; height: number; durationMs?: number }>((resolve) => {
        const video = document.createElement("video");
        const done = () => resolve({ width: video.videoWidth || 1280, height: video.videoHeight || 720, durationMs: Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : undefined });
        video.onloadedmetadata = done;
        video.onerror = done;
        video.src = url;
    });
}

export function readAudioMeta(url: string) {
    return new Promise<{ durationMs?: number }>((resolve) => {
        const audio = document.createElement("audio");
        const done = () => resolve({ durationMs: Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : undefined });
        audio.onloadedmetadata = done;
        audio.onerror = done;
        audio.src = url;
    });
}

function saveMediaBlob(storageKey: string, blob: Blob) {
    return withMediaStorageFence(async () => {
        const saved = await putStoredMedia(MEDIA_BUCKET, storageKey, await normalizeMediaBlob(blob, storageKey));
        if (!saved) throw new Error("媒体未能写入应用存储");
        return saved.url;
    });
}
