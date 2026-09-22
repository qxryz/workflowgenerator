import { nanoid } from "nanoid";

import { inferAssetFileMimeType, safeOriginalFileName } from "@/lib/asset-file";
import { collectStorageKeys, createProvisionalUploadRegistry, isMediaReferenceEpochCurrent, reserveStorageKey, withMediaStorageFence, type VerifiedReferenceSnapshot } from "@/services/media-retention-policy";
import { collectVerifiedMediaReferenceSnapshot } from "@/services/media-reference-snapshot";
import { getStoredMedia, listStoredMedia, putStoredMedia, readStoredMediaBlob, removeStoredMedia } from "@/services/server-storage";

export type UploadedAssetFile = {
    storageKey: string;
    fileName: string;
    bytes: number;
    mimeType: string;
};

const FILE_BUCKET = "files";
const provisionalFiles = createProvisionalUploadRegistry<UploadedAssetFile, string>(
    (file) => file.storageKey,
    (storageKey) => withMediaStorageFence(() => removeStoredAssetFiles([storageKey])),
);

export async function uploadAssetFile(file: File | Blob, fileName = typeof File !== "undefined" && file instanceof File ? file.name : "文件") {
    const safeName = safeOriginalFileName(fileName);
    const mimeType = inferAssetFileMimeType({ name: safeName, type: file.type });
    const typedBlob = file.type === mimeType ? file : file.slice(0, file.size, mimeType);
    const storageKey = `file:${nanoid()}`;
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        await saveAssetFileBlob(storageKey, typedBlob);
        return provisionalFiles.track({ storageKey, fileName: safeName, bytes: typedBlob.size, mimeType });
    } finally {
        releaseReservation();
    }
}

export function publishUploadedAssetFile(file: UploadedAssetFile) {
    return provisionalFiles.publish(file);
}

export function discardUploadedAssetFile(file: UploadedAssetFile) {
    return provisionalFiles.discard(file);
}

export async function getAssetFileBlob(storageKey: string) {
    return readStoredMediaBlob(FILE_BUCKET, storageKey);
}

export async function setAssetFileBlob(storageKey: string, blob: Blob) {
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        await saveAssetFileBlob(storageKey, blob);
    } finally {
        releaseReservation();
    }
}

export async function cleanupUnusedAssetFiles(usedData: unknown, referenceSnapshot?: VerifiedReferenceSnapshot) {
    await withMediaStorageFence(async () => {
        const applicationSnapshot = referenceSnapshot || (await tryCollectVerifiedReferenceSnapshot());
        if (!applicationSnapshot || !isMediaReferenceEpochCurrent(applicationSnapshot.epoch)) return;
        const verifiedSnapshot: VerifiedReferenceSnapshot = { complete: true, data: { application: applicationSnapshot.data, caller: usedData }, epoch: applicationSnapshot.epoch };
        const usedKeys = collectStorageKeys(verifiedSnapshot.data, isAssetFileStorageKey);
        const storedKeys = new Set(await listStoredMedia(FILE_BUCKET));
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        const unused = Array.from(storedKeys).filter((key) => !usedKeys.has(key));
        await Promise.resolve();
        if (!isMediaReferenceEpochCurrent(verifiedSnapshot.epoch)) return;
        await removeStoredAssetFiles(unused);
    });
}

async function saveAssetFileBlob(storageKey: string, blob: Blob) {
    await withMediaStorageFence(async () => {
        const saved = await putStoredMedia(FILE_BUCKET, storageKey, blob);
        if (!saved) throw new Error("文件未能写入应用存储");
    });
}

async function removeStoredAssetFiles(keys: Iterable<string>) {
    await Promise.all(Array.from(new Set(keys)).map((key) => removeStoredMedia(FILE_BUCKET, key)));
}

async function tryCollectVerifiedReferenceSnapshot() {
    try {
        return await collectVerifiedMediaReferenceSnapshot();
    } catch {
        return undefined;
    }
}

function isAssetFileStorageKey(key: string) {
    return key.startsWith("file:");
}

export async function hasStoredAssetFile(storageKey: string) {
    return Boolean(await getStoredMedia(FILE_BUCKET, storageKey));
}
