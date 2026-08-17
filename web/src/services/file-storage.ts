import localforage from "localforage";
import { nanoid } from "nanoid";
import { mediaInputToBlob, normalizeMediaBlob } from "@/lib/media-mime";
import { collectStorageKeys, createProvisionalUploadRegistry, isMediaReferenceEpochCurrent, reserveStorageKey, selectStorageKeysForDeletion, withMediaStorageFence, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { collectVerifiedMediaReferenceSnapshot } from "@/services/media-reference-snapshot";
import { fetchDesktopRemoteMedia, getDesktopMedia, isDesktopApp, listDesktopMedia, markLegacyImport, putDesktopMedia, readDesktopMediaBlob, removeDesktopMedia, wasLegacyValueImported } from "@/services/desktop-storage";

export type UploadedFile = { url: string; storageKey: string; bytes: number; mimeType: string; width?: number; height?: number; durationMs?: number };

const store = localforage.createInstance({ name: "infinite-canvas", storeName: "media_files" });
const objectUrls = new Map<string, string>();
const MEDIA_BUCKET = "media";
const LEGACY_NAMESPACE = "media-v1:files";
const provisionalMedia = createProvisionalUploadRegistry<UploadedFile, string>(
    (file) => file.storageKey,
    (storageKey) => withMediaStorageFence(() => removeStoredMedia([storageKey])),
);

export async function uploadMediaFile(input: string | Blob, prefix = "file", remoteOptions: { expectedSha256?: string; maxBytes?: number } = {}): Promise<UploadedFile> {
    const storageKey = `${prefix}:${nanoid()}`;
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        if (typeof input === "string" && isDesktopApp() && /^https?:\/\//i.test(input)) {
            const saved = await fetchDesktopRemoteMedia(MEDIA_BUCKET, storageKey, input, remoteOptions);
            if (!saved) throw new Error("媒体未能写入应用存储");
            await markLegacyImport(LEGACY_NAMESPACE, storageKey);
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

export async function resolveMediaUrl(storageKey?: string, fallback = "") {
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

export async function getMediaBlob(storageKey: string) {
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
        await removeStoredMedia(deletableKeys);
    });
}

async function removeStoredMedia(keys: Iterable<string>) {
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
        const unused = Array.from(storedKeys).filter((key) => !usedKeys.has(key));
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredMedia(unused);
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

async function saveMediaBlob(storageKey: string, blob: Blob) {
    return withMediaStorageFence(() => saveMediaBlobUnsafe(storageKey, blob));
}

async function saveMediaBlobUnsafe(storageKey: string, blob: Blob) {
    releaseObjectUrl(storageKey);
    const normalizedBlob = await normalizeMediaBlob(blob, storageKey);
    if (isDesktopApp()) {
        const saved = await putDesktopMedia(MEDIA_BUCKET, storageKey, normalizedBlob);
        if (!saved) throw new Error("媒体未能写入应用存储");
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
