import { invoke } from "@tauri-apps/api/core";
import { dataUrlToBlob } from "@/lib/media-mime";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";

export type DesktopStoreEntry = {
    key: string;
    value: string;
};

export type DesktopStoreMutation = {
    namespace: string;
    key: string;
    value: string | null;
};

export type NativeMediaRecord = {
    key?: string;
    url: string;
    mimeType: string;
    bytes: number;
};

export type NativeModelListPayload = {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
    error?: { message?: string };
    message?: string;
    msg?: string;
};

export type NativeModelMultipartFile = {
    fieldName?: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
};

export type DesktopStorageLocations = {
    root: string;
    data: string;
    images: string;
    media: string;
    temporary: string;
};

type LegacyStoreOptions = {
    name: string;
    storeName: string;
};
const MIGRATION_NAMESPACE = "legacy-import-v1";
const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const CHUNKED_MEDIA_THRESHOLD = 8 * 1024 * 1024;
const pendingNativeWrites = new Set<Promise<unknown>>();
let desktopStorageLocationsPromise: Promise<DesktopStorageLocations> | null = null;

export function isDesktopApp() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function getDesktopStorageLocations() {
    if (!isDesktopApp()) return null;
    desktopStorageLocationsPromise ||= resolveDesktopStorageLocations().catch((error) => {
        desktopStorageLocationsPromise = null;
        throw error;
    });
    return desktopStorageLocationsPromise;
}

async function resolveDesktopStorageLocations(): Promise<DesktopStorageLocations> {
    const { appDataDir, homeDir, join } = await import("@tauri-apps/api/path");
    const [root, home] = await Promise.all([appDataDir(), homeDir()]);
    const [data, images, media, temporary] = await Promise.all([join(root, "data"), join(root, "media", "images"), join(root, "media", "media"), join(root, "media", ".uploads")]);
    return Object.fromEntries(Object.entries({ root, data, images, media, temporary }).map(([key, value]) => [key, abbreviateHomePath(value, home)])) as DesktopStorageLocations;
}

function abbreviateHomePath(path: string, home: string) {
    const normalizedHome = home.replace(/[\\/]+$/, "");
    if (path === normalizedHome) return "~";
    return path.startsWith(`${normalizedHome}/`) || path.startsWith(`${normalizedHome}\\`) ? `~${path.slice(normalizedHome.length)}` : path;
}

export async function getDesktopValue(namespace: string, key: string) {
    if (!isDesktopApp()) return null;
    return invoke<string | null>("native_store_get", { namespace, key });
}

export async function setDesktopValue(namespace: string, key: string, value: string) {
    if (!isDesktopApp()) return;
    await trackNativeWrite(invoke("native_store_set", { namespace, key, value }));
}

export async function removeDesktopValue(namespace: string, key: string) {
    if (!isDesktopApp()) return;
    await trackNativeWrite(invoke("native_store_remove", { namespace, key }));
}

export async function listDesktopValues(namespace: string) {
    if (!isDesktopApp()) return [] as DesktopStoreEntry[];
    return invoke<DesktopStoreEntry[]>("native_store_list", { namespace });
}

export async function clearDesktopValues(namespace: string) {
    if (!isDesktopApp()) return;
    await trackNativeWrite(invoke("native_store_clear", { namespace }));
}

export async function commitDesktopValues(mutations: DesktopStoreMutation[]) {
    if (!isDesktopApp() || !mutations.length) return;
    await trackNativeWrite(invoke("native_store_batch", { mutations }));
}

export async function putDesktopMedia(bucket: string, key: string, blob: Blob) {
    if (!isDesktopApp()) return null;
    return trackNativeWrite(writeDesktopMedia(bucket, key, blob));
}

export async function fetchDesktopRemoteMedia(bucket: string, key: string, url: string, options: { expectedSha256?: string; maxBytes?: number; allowPrivateNetwork?: boolean } = {}) {
    if (!isDesktopApp()) return null;
    return trackNativeWrite(
        invoke<NativeMediaRecord>("native_fetch_remote_media", {
            bucket,
            key,
            url,
            expectedSha256: options.expectedSha256 || null,
            maxBytes: options.maxBytes || null,
            allowPrivateNetwork: options.allowPrivateNetwork === true,
        }),
    );
}

/**
 * Model catalog requests need to bypass WebView CORS restrictions in desktop
 * builds. The native command keeps the key in process memory only and returns
 * the provider's JSON payload without persisting it.
 */
export async function fetchDesktopModelList(url: string, apiKey: string) {
    if (!isDesktopApp()) return null;
    return invoke<NativeModelListPayload>("native_fetch_model_list", { url, apiKey });
}

/** Runs a provider JSON request outside WebKit so desktop generation is not
 * blocked by browser CORS. Credentials stay inside the native invocation and
 * are never persisted by this bridge. */
export async function postDesktopModelJson<T>(url: string, apiKey: string, body: Record<string, unknown>) {
    if (!isDesktopApp()) return null;
    return invoke<T>("native_model_json_post", { url, apiKey, body });
}

/** Sends a pre-serialized JSON body without routing integer tokens through the
 * WebView IPC JSON codec. The provider response is returned as raw JSON text. */
export async function postDesktopModelRawJson(url: string, apiKey: string, body: string) {
    if (!isDesktopApp()) return null;
    return invoke<string>("native_model_raw_json_post", { url, apiKey, body });
}

export async function getDesktopModelJson<T>(url: string, apiKey: string) {
    if (!isDesktopApp()) return null;
    return invoke<T>("native_model_json_get", { url, apiKey });
}

/** Sends one file plus string fields through the native HTTP client. The file
 * payload must be raw base64 without a data-URL prefix. */
export async function postDesktopModelMultipart(url: string, apiKey: string, file: NativeModelMultipartFile, fields: Record<string, string> = {}) {
    if (!isDesktopApp()) return null;
    return invoke<string>("native_model_multipart_post", {
        url,
        apiKey,
        fileField: file.fieldName || "file",
        fileName: file.fileName,
        mimeType: file.mimeType,
        dataBase64: file.dataBase64,
        fields,
    });
}

export async function getDesktopMedia(bucket: string, key: string) {
    if (!isDesktopApp()) return null;
    return invoke<NativeMediaRecord | null>("native_media_get", { bucket, key });
}

export async function readDesktopMediaDataUrl(bucket: string, key: string) {
    if (!isDesktopApp()) return null;
    return invoke<string | null>("native_media_read_data_url", { bucket, key });
}

export async function readDesktopMediaBlob(bucket: string, key: string) {
    const dataUrl = await readDesktopMediaDataUrl(bucket, key);
    return dataUrl ? dataUrlToBlob(dataUrl) : null;
}

export async function exportDesktopMedia(bucket: string, key: string, suggestedName: string) {
    if (!isDesktopApp()) return null;
    return invoke<string>("native_media_export_to_downloads", { bucket, key, suggestedName });
}

export async function removeDesktopMedia(bucket: string, key: string) {
    if (!isDesktopApp()) return;
    await trackNativeWrite(invoke("native_media_remove", { bucket, key }));
}

export async function listDesktopMedia(bucket: string) {
    if (!isDesktopApp()) return [] as string[];
    return (await invoke<Array<NativeMediaRecord & { key: string }>>("native_media_list", { bucket })).map((record) => record.key);
}

/**
 * A small localforage-compatible repository. Desktop builds write only to the
 * native store; the WebView database is retained as a read-only migration
 * source for one release so a failed migration remains recoverable.
 */
export function createDesktopJsonStore(options: { namespace: string; legacy: LegacyStoreOptions }) {
    let legacyStore: Promise<LocalForage> | null = null;
    const getLegacyStore = () => {
        legacyStore ||= loadLocalForage().then((localforage) => localforage.createInstance(options.legacy));
        return legacyStore;
    };
    let namespaceImport: Promise<void> | null = null;

    const importLegacyNamespace = () => {
        if (!isDesktopApp()) return Promise.resolve();
        if (namespaceImport) return namespaceImport;
        namespaceImport = (async () => {
            if (await getDesktopValue(MIGRATION_NAMESPACE, migrationKey(options.namespace, "*"))) return;
            const nativeKeys = new Set((await listDesktopValues(options.namespace)).map((entry) => entry.key));
            const entries: Array<{ key: string; value: unknown }> = [];
            await (
                await getLegacyStore()
            ).iterate((value, key) => {
                entries.push({ key, value });
            });
            for (const entry of entries) {
                if (!nativeKeys.has(entry.key) && !(await wasLegacyValueImported(options.namespace, entry.key))) {
                    await setDesktopValue(options.namespace, entry.key, JSON.stringify(entry.value));
                    nativeKeys.add(entry.key);
                }
                await markLegacyImport(options.namespace, entry.key);
            }
            await markLegacyImport(options.namespace, "*");
        })().catch((error) => {
            namespaceImport = null;
            throw error;
        });
        return namespaceImport;
    };

    const read = async <T>(key: string): Promise<T | null> => {
        if (!isDesktopApp()) return (await getLegacyStore()).getItem<T>(key);
        const saved = await getDesktopValue(options.namespace, key);
        if (saved != null) return parseStoredValue<T>(saved);
        if ((await getDesktopValue(MIGRATION_NAMESPACE, migrationKey(options.namespace, key))) || (await getDesktopValue(MIGRATION_NAMESPACE, migrationKey(options.namespace, "*")))) return null;
        const oldValue = await (await getLegacyStore()).getItem<T>(key);
        if (oldValue == null) {
            await markLegacyImport(options.namespace, key);
            return null;
        }
        await setDesktopValue(options.namespace, key, JSON.stringify(oldValue));
        await markLegacyImport(options.namespace, key);
        return oldValue;
    };

    return {
        getItem: read,
        async setItem<T>(key: string, value: T) {
            markMediaReferencesChanged();
            const serialized = JSON.stringify(value);
            try {
                try {
                    if (!isDesktopApp()) return await (await getLegacyStore()).setItem(key, value);
                    await commitDesktopValues([
                        { namespace: options.namespace, key, value: serialized },
                        { namespace: MIGRATION_NAMESPACE, key: migrationKey(options.namespace, key), value: "1" },
                    ]);
                } catch (error) {
                    try {
                        const stored = await read<unknown>(key);
                        if (stored == null) throw error;
                        // An exact read-back confirms the owner. A different or
                        // unreadable record is uncertain, so retain media by
                        // treating the write as conservatively committed.
                        if (JSON.stringify(stored) !== serialized) return value;
                    } catch (readError) {
                        if (readError === error) throw error;
                        return value;
                    }
                }
                return value;
            } finally {
                markMediaReferencesChanged();
            }
        },
        async removeItem(key: string) {
            markMediaReferencesChanged();
            try {
                try {
                    if (!isDesktopApp()) return await (await getLegacyStore()).removeItem(key);
                    await commitDesktopValues([
                        { namespace: options.namespace, key, value: null },
                        { namespace: MIGRATION_NAMESPACE, key: migrationKey(options.namespace, key), value: "1" },
                    ]);
                } catch (error) {
                    let stored: unknown;
                    try {
                        stored = await read<unknown>(key);
                    } catch {
                        throw error;
                    }
                    if (stored != null) throw error;
                }
            } finally {
                markMediaReferencesChanged();
            }
        },
        async clear() {
            markMediaReferencesChanged();
            try {
                if (!isDesktopApp()) return (await getLegacyStore()).clear();
                await importLegacyNamespace();
                const keys = (await listDesktopValues(options.namespace)).map((entry) => entry.key);
                await commitDesktopValues([...keys.map((key) => ({ namespace: options.namespace, key, value: null })), { namespace: MIGRATION_NAMESPACE, key: migrationKey(options.namespace, "*"), value: "1" }]);
            } finally {
                markMediaReferencesChanged();
            }
        },
        async iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U | void): Promise<U | undefined> {
            if (!isDesktopApp()) {
                let result: U | undefined;
                await (
                    await getLegacyStore()
                ).iterate<T, void>((value, key, iterationNumber) => {
                    const next = iterator(value, key, iterationNumber);
                    if (next !== undefined && result === undefined) result = next;
                });
                return result;
            }
            await importLegacyNamespace();
            const entries = await listDesktopValues(options.namespace);
            for (let index = 0; index < entries.length; index += 1) {
                const result = iterator(parseStoredValue<T>(entries[index].value), entries[index].key, index + 1);
                if (result !== undefined) return result;
            }
            return undefined;
        },
        async keys() {
            if (!isDesktopApp()) return (await getLegacyStore()).keys();
            await importLegacyNamespace();
            return (await listDesktopValues(options.namespace)).map((entry) => entry.key);
        },
    };
}

async function loadLocalForage() {
    const module = await import("localforage");
    return ((module as unknown as { default?: LocalForage }).default || module) as LocalForage;
}

export async function wasLegacyValueImported(namespace: string, key: string) {
    if (!isDesktopApp()) return false;
    return Boolean(await getDesktopValue(MIGRATION_NAMESPACE, migrationKey(namespace, key)));
}

export async function markLegacyImport(namespace: string, key: string) {
    if (!isDesktopApp()) return;
    await setDesktopValue(MIGRATION_NAMESPACE, migrationKey(namespace, key), "1");
}

function migrationKey(namespace: string, key: string) {
    return `${namespace}::${key}`;
}

function parseStoredValue<T>(value: string) {
    try {
        return JSON.parse(value) as T;
    } catch {
        return value as T;
    }
}

export async function flushDesktopWrites() {
    const failures: unknown[] = [];
    while (pendingNativeWrites.size) {
        const results = await Promise.allSettled(Array.from(pendingNativeWrites));
        results.forEach((result) => {
            if (result.status === "rejected") failures.push(result.reason);
        });
    }
    if (failures.length) throw failures[0];
}

function trackNativeWrite<T>(write: Promise<T>) {
    const tracked = write.finally(() => pendingNativeWrites.delete(tracked));
    pendingNativeWrites.add(tracked);
    return tracked;
}

async function writeDesktopMedia(bucket: string, key: string, blob: Blob) {
    const mimeType = (blob.type || "application/octet-stream").trim().toLowerCase();
    if (blob.size <= CHUNKED_MEDIA_THRESHOLD) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        try {
            return await invoke<NativeMediaRecord>("native_media_put_raw", bytes, {
                headers: {
                    "x-wg-bucket": bucket,
                    "x-wg-key": encodeURIComponent(key),
                    "content-type": mimeType,
                },
            });
        } catch {
            // Some release WebViews strip custom headers from raw IPC bodies.
            // Keep the streamed path as the fast default, with the stable JSON
            // command as a bounded fallback for ordinary images and short clips.
            return invoke<NativeMediaRecord>("native_media_put", {
                bucket,
                key,
                dataUrl: await blobToDataUrl(blob),
            });
        }
    }

    let uploadId: string | null = null;
    try {
        uploadId = await invoke<string>("native_media_upload_begin", {
            bucket,
            key,
            mimeType,
            expectedBytes: blob.size,
        });
        for (let offset = 0; offset < blob.size; offset += MEDIA_CHUNK_BYTES) {
            const chunk = blob.slice(offset, Math.min(offset + MEDIA_CHUNK_BYTES, blob.size));
            const bytes = new Uint8Array(await chunk.arrayBuffer());
            try {
                await invoke<number>("native_media_upload_chunk", bytes, {
                    headers: {
                        "x-wg-bucket": bucket,
                        "x-wg-key": encodeURIComponent(key),
                        "x-wg-mime-type": mimeType,
                        "x-wg-upload-id": uploadId,
                        "x-wg-total-bytes": String(blob.size),
                        "x-wg-offset": String(offset),
                    },
                });
            } catch {
                // Release WebViews can drop raw-IPC headers. Retry the same
                // chunk through the bounded JSON/base64 command so generated
                // images remain durable regardless of their provider.
                await invoke<number>("native_media_upload_chunk_base64", {
                    bucket,
                    key,
                    mimeType,
                    uploadId,
                    expectedBytes: blob.size,
                    offset,
                    dataBase64: uint8ArrayToBase64(bytes),
                });
            }
        }
        return await invoke<NativeMediaRecord>("native_media_upload_commit", {
            bucket,
            key,
            mimeType,
            expectedBytes: blob.size,
            uploadId,
        });
    } catch (error) {
        if (uploadId) {
            await invoke("native_media_upload_abort", {
                bucket,
                key,
                mimeType,
                expectedBytes: blob.size,
                uploadId,
            }).catch(() => undefined);
        }
        throw error;
    }
}

function uint8ArrayToBase64(bytes: Uint8Array) {
    const chunkSize = 0x8000;
    let binary = "";
    for (let offset = 0; offset < bytes.length; offset += chunkSize) {
        binary += String.fromCharCode(...bytes.subarray(offset, Math.min(offset + chunkSize, bytes.length)));
    }
    return btoa(binary);
}

function blobToDataUrl(blob: Blob) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error("无法读取所选文件"));
        reader.readAsDataURL(blob);
    });
}
