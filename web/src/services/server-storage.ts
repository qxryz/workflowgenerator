import { dataUrlToBlob } from "@/lib/media-mime";
import { markMediaReferencesChanged } from "@/services/media-retention-policy";

/**
 * Client for the WorkflowGenerator server.
 *
 * This replaces the former Tauri IPC bridge. Every function here maps to one
 * HTTP route in `server/src/routes.rs`, and the payload shapes match the Rust
 * structs one for one.
 *
 * Two things got simpler on the way over from IPC:
 *
 * - Media URLs are now durable HTTP paths, so they survive a page reload and
 *   can be used directly in `<img src>`. The old blob-URL cache, its revoke
 *   bookkeeping, and the migration ladder that read three different stores are
 *   all gone.
 * - The raw upload commands no longer need data-URL or base64 fallbacks. The
 *   `x-wg-*` metadata that WebKit sometimes stripped from IPC request headers
 *   are ordinary HTTP headers now.
 */

export type ServerStoreEntry = {
    key: string;
    value: string;
};

export type ServerStoreMutation = {
    namespace: string;
    key: string;
    value: string | null;
};

export type ServerMediaRecord = {
    key?: string;
    url: string;
    mimeType: string;
    bytes: number;
};

export type ServerModelListPayload = {
    data?: Array<{ id?: string; name?: string }>;
    models?: Array<{ id?: string; name?: string }>;
    error?: { message?: string };
    message?: string;
    msg?: string;
};

export type ServerModelMultipartFile = {
    fieldName?: string;
    fileName: string;
    mimeType: string;
    dataBase64: string;
};

const MEDIA_CHUNK_BYTES = 4 * 1024 * 1024;
const CHUNKED_MEDIA_THRESHOLD = 8 * 1024 * 1024;
const pendingWrites = new Set<Promise<unknown>>();

/** Sends a request and surfaces the server's own error message. The Rust
 * handlers return user-facing Chinese text in the error body, so it is passed
 * through rather than replaced with a generic message. */
export class ServerStorageError extends Error {
    readonly status: number;
    constructor(message: string, status: number) { super(message); this.status = status; }
}

async function request<T>(path: string, body?: unknown, init: RequestInit = {}): Promise<T> {
    const response = await fetch(path, {
        method: body === undefined ? "GET" : "POST",
        ...init,
        ...(body === undefined ? {} : { headers: { "content-type": "application/json", ...(init.headers as Record<string, string>) }, body: JSON.stringify(body) }),
    });
    if (!response.ok) {
        const message = (await response.text()).trim();
        throw new ServerStorageError(message || `请求失败（${response.status}）`, response.status);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
}

export async function getStoredValue(namespace: string, key: string) {
    return request<string | null>("/api/store/get", { namespace, key });
}

export async function setStoredValue(namespace: string, key: string, value: string) {
    await trackWrite(request<void>("/api/store/set", { namespace, key, value }));
}

export async function removeStoredValue(namespace: string, key: string) {
    await trackWrite(request<void>("/api/store/remove", { namespace, key }));
}

export async function listStoredValues(namespace: string) {
    return request<ServerStoreEntry[]>("/api/store/list", { namespace });
}

export async function clearStoredValues(namespace: string) {
    await trackWrite(request<void>("/api/store/clear", { namespace }));
}

export async function commitStoredValues(mutations: ServerStoreMutation[]) {
    if (!mutations.length) return;
    await trackWrite(request<void>("/api/store/batch", { mutations }));
}

export async function putStoredMedia(bucket: string, key: string, blob: Blob) {
    return trackWrite(writeMedia(bucket, key, blob));
}

/** Downloads a provider result URL straight into server storage. Keeping this
 * server-side is what makes it work at all: the browser cannot read most
 * provider CDNs, and the server additionally guards against SSRF, verifies the
 * optional checksum, and refuses to store a JSON error body as media. */
export async function fetchRemoteMedia(bucket: string, key: string, url: string, options: { expectedSha256?: string; maxBytes?: number; allowPrivateNetwork?: boolean } = {}) {
    return trackWrite(
        request<ServerMediaRecord>("/api/media/fetch-remote", {
            bucket,
            key,
            url,
            expectedSha256: options.expectedSha256 || null,
            maxBytes: options.maxBytes || null,
            allowPrivateNetwork: options.allowPrivateNetwork === true,
        }),
    );
}

/** Streams a remote file's bytes through the server without storing them.
 * For provider results on CDNs that send no CORS headers. */
export async function fetchRemoteBytes(url: string, options: { maxBytes?: number; allowPrivateNetwork?: boolean } = {}) {
    const response = await fetch("/api/media/proxy-bytes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url, maxBytes: options.maxBytes ?? null, allowPrivateNetwork: options.allowPrivateNetwork === true }),
    });
    if (!response.ok) {
        const message = (await response.text()).trim();
        throw new Error(message || `请求失败（${response.status}）`);
    }
    return response.blob();
}

export async function fetchModelList(url: string, apiKey: string) {
    return request<ServerModelListPayload>("/api/model/list", { url, apiKey });
}

/** Runs a provider JSON request server-side. Credentials travel in the request
 * body and are never persisted by this bridge.
 *
 * `headers` carries provider protocol headers such as `anthropic-version`. The
 * server validates them against a whitelist, so an unlisted name is rejected
 * rather than silently dropped. */
export async function postModelJson<T>(url: string, apiKey: string, body: Record<string, unknown>, auth?: "x-goog-api-key", headers?: Record<string, string>, signal?: AbortSignal) {
    return request<T>("/api/model/json-post", { url, apiKey, body, ...(auth ? { auth } : {}), ...(headers ? { headers } : {}) }, { signal });
}

/**
 * Opens a streaming provider request through the server and returns the live
 * `Response` so existing SSE parsing works unchanged.
 *
 * This exists because the whole-JSON routes buffer the reply, which would
 * defeat streaming. Provider errors arrive as a normal response body here
 * rather than a thrown error, because a failed stream is still a stream the
 * caller should inspect with full context.
 */
export async function proxyModelPost(url: string, apiKey: string, body: Record<string, unknown>, auth?: "x-goog-api-key", headers?: Record<string, string>, signal?: AbortSignal) {
    // The signal must reach fetch: cancelling a reply has to drop the request,
    // not merely stop the caller reading the response. The server aborts the
    // upstream provider call when the client goes away, because dropping the
    // forwarded body stream drops the pending reqwest response with it.
    const response = await fetch("/api/model/proxy-post", {
        method: "POST",
        headers: { "content-type": "application/json" },
        signal,
        body: JSON.stringify({ url, apiKey, body, ...(auth ? { auth } : {}), ...(headers ? { headers } : {}) }),
    });
    return response;
}

/** Sends a pre-serialized JSON body so integer tokens never round-trip through
 * JavaScript's number type — `file_id: 9007199254740993` has to reach the
 * provider byte-for-byte. */
export async function postModelRawJson(url: string, apiKey: string, body: string) {
    return request<string>("/api/model/raw-json-post", { url, apiKey, body });
}

export async function getModelJson<T>(url: string, apiKey: string) {
    return request<T>("/api/model/json-get", { url, apiKey });
}

/** Sends one file plus string fields through the server's HTTP client. The
 * file payload must be raw base64 without a data-URL prefix. */
export async function postModelMultipart(url: string, apiKey: string, file: ServerModelMultipartFile, fields: Record<string, string> = {}) {
    return request<string>("/api/model/multipart-post", {
        url,
        apiKey,
        fileField: file.fieldName || "file",
        fileName: file.fileName,
        mimeType: file.mimeType,
        dataBase64: file.dataBase64,
        fields,
    });
}

export async function getStoredMedia(bucket: string, key: string) {
    return request<ServerMediaRecord | null>("/api/media/get", { bucket, key });
}

export async function readStoredMediaDataUrl(bucket: string, key: string) {
    return request<string | null>("/api/media/read-data-url", { bucket, key });
}

export async function readStoredMediaBlob(bucket: string, key: string) {
    const dataUrl = await readStoredMediaDataUrl(bucket, key);
    return dataUrl ? dataUrlToBlob(dataUrl) : null;
}

export async function removeStoredMedia(bucket: string, key: string) {
    await trackWrite(request<void>("/api/media/remove", { bucket, key }));
}

export async function listStoredMedia(bucket: string) {
    return (await request<Array<ServerMediaRecord & { key: string }>>("/api/media/list", { bucket })).map((record) => record.key);
}

/**
 * A zustand-persist-shaped view over one server namespace.
 *
 * Twelve call sites used the desktop version of this to talk to the native
 * store. The shape is kept so they did not have to change, but every branch is
 * gone: there is one store now, and it lives on the server.
 */
export function createServerJsonStore(namespace: string) {
    const read = async <T>(key: string): Promise<T | null> => {
        const saved = await getStoredValue(namespace, key);
        return saved == null ? null : parseStoredValue<T>(saved);
    };

    return {
        getItem: read,
        async setItem<T>(key: string, value: T) {
            markMediaReferencesChanged();
            try {
                await setStoredValue(namespace, key, JSON.stringify(value));
                return value;
            } finally {
                markMediaReferencesChanged();
            }
        },
        async removeItem(key: string) {
            markMediaReferencesChanged();
            try {
                await removeStoredValue(namespace, key);
            } finally {
                markMediaReferencesChanged();
            }
        },
        async clear() {
            markMediaReferencesChanged();
            try {
                await clearStoredValues(namespace);
            } finally {
                markMediaReferencesChanged();
            }
        },
        async iterate<T, U>(iterator: (value: T, key: string, iterationNumber: number) => U | void): Promise<U | undefined> {
            const entries = await listStoredValues(namespace);
            for (let index = 0; index < entries.length; index += 1) {
                const result = iterator(parseStoredValue<T>(entries[index].value), entries[index].key, index + 1);
                if (result !== undefined) return result;
            }
            return undefined;
        },
        async keys() {
            return (await listStoredValues(namespace)).map((entry) => entry.key);
        },
    };
}

function parseStoredValue<T>(value: string) {
    try {
        return JSON.parse(value) as T;
    } catch {
        return value as T;
    }
}

/**
 * Waits for every in-flight write to settle, then rethrows the first failure.
 *
 * The desktop build needed this to flush native writes before the window
 * closed. On the server the same ordering still matters when a page navigates
 * away mid-generation, so callers keep using it.
 */
export async function flushPendingWrites() {
    const failures: unknown[] = [];
    while (pendingWrites.size) {
        const results = await Promise.allSettled(Array.from(pendingWrites));
        results.forEach((result) => {
            if (result.status === "rejected") failures.push(result.reason);
        });
    }
    if (failures.length) throw failures[0];
}

function trackWrite<T>(write: Promise<T>) {
    const tracked = write.finally(() => pendingWrites.delete(tracked));
    pendingWrites.add(tracked);
    return tracked;
}

/**
 * Stores a blob, switching to the chunked endpoint past 8 MB.
 *
 * The chunking remains because the server bounds a single request body; the
 * two fallback ladders the desktop build carried (data-URL, then base64) are
 * gone because plain HTTP bodies do not lose their headers the way WebKit's
 * IPC did.
 */
async function writeMedia(bucket: string, key: string, blob: Blob) {
    const mimeType = (blob.type || "application/octet-stream").trim().toLowerCase();
    if (blob.size <= CHUNKED_MEDIA_THRESHOLD) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        return request<ServerMediaRecord>("/api/media/put-raw", undefined, {
            method: "POST",
            headers: { "content-type": mimeType, "x-wg-bucket": bucket, "x-wg-key": encodeURIComponent(key) },
            body: bytes,
        });
    }

    let uploadId: string | null = null;
    try {
        uploadId = await request<string>("/api/media/upload/begin", { bucket, key, mimeType, expectedBytes: blob.size });
        for (let offset = 0; offset < blob.size; offset += MEDIA_CHUNK_BYTES) {
            const chunk = blob.slice(offset, Math.min(offset + MEDIA_CHUNK_BYTES, blob.size));
            const bytes = new Uint8Array(await chunk.arrayBuffer());
            await request<number>("/api/media/upload/chunk", undefined, {
                method: "POST",
                headers: {
                    "content-type": "application/octet-stream",
                    "x-wg-bucket": bucket,
                    "x-wg-key": encodeURIComponent(key),
                    "x-wg-mime-type": mimeType,
                    "x-wg-upload-id": uploadId,
                    "x-wg-total-bytes": String(blob.size),
                    "x-wg-offset": String(offset),
                },
                body: bytes,
            });
        }
        return await request<ServerMediaRecord>("/api/media/upload/commit", { bucket, key, mimeType, expectedBytes: blob.size, uploadId });
    } catch (error) {
        if (uploadId) {
            await request<void>("/api/media/upload/abort", { bucket, key, mimeType, expectedBytes: blob.size, uploadId }).catch(() => undefined);
        }
        throw error;
    }
}

// Stage plans live in dedicated SQLite tables; model tools use planner commands only.
export async function listZodiacPlans(projectId: string) {
    return request<import("@/lib/agent/zodiac-stage-plan").ZodiacStagePlan[]>("/api/zodiac/plans/list", { projectId });
}
export async function getZodiacPlan(planId: string) {
    return request<import("@/lib/agent/zodiac-stage-plan").ZodiacStagePlan>("/api/zodiac/plans/get", { planId });
}
export async function createZodiacPlan(input: import("@/lib/agent/zodiac-stage-plan").ZodiacPlanCreate) {
    return trackWrite(request<import("@/lib/agent/zodiac-stage-plan").ZodiacPlanReply>("/api/zodiac/plans/create", input).then((reply) => { markMediaReferencesChanged(); return reply; }));
}
export async function mutateZodiacPlan(input: import("@/lib/agent/zodiac-stage-plan").ZodiacPlanMutation) {
    const planner = ["write_stage", "replan"].includes(input.command.type);
    const execution = ["begin_documents", "claim_item", "record_item", "finish"].includes(input.command.type);
    return trackWrite(request<import("@/lib/agent/zodiac-stage-plan").ZodiacPlanReply>(`/api/zodiac/plans/${planner ? "author" : execution ? "execute" : "review"}`, input).then((reply) => { markMediaReferencesChanged(); return reply; }));
}

export async function importZodiacPlans(projectId: string, plans: import("@/lib/agent/zodiac-stage-plan").ZodiacStagePlan[]) {
    return trackWrite(request<import("@/lib/agent/zodiac-stage-plan").ZodiacStagePlan[]>("/api/zodiac/plans/import", { projectId, plans }).then((reply) => { markMediaReferencesChanged(); return reply; }));
}

export type CanvasProjectChange = { id: string; expected: string | null; value: string | null };
export type CanvasCommitResult = { conflict: boolean; cleanupPending?: string[]; projects: Array<{ id: string; value: string | null }>; ids: string[] };
/** Canvas writes never use the unguarded generic store endpoints. */
export function commitCanvasProjects(changes: CanvasProjectChange[]): Promise<CanvasCommitResult> {
    return trackWrite((async () => {
        const response = await fetch("/api/canvas/commit", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ changes }) });
        if (!response.ok && response.status !== 409) throw new ServerStorageError((await response.text()).trim() || "画布保存失败", response.status);
        return { ...(await response.json()), conflict: response.status === 409 } as CanvasCommitResult;
    })());
}

export async function completeDesktopClose() { await request<void>("/api/desktop/close-ready", {}); }

export async function revealWorkspace() { await request<void>("/api/desktop/workspace", {}); }

export type ZodiacRuntimeMonitor = {
    name: string; capacity: number; workspace: string; dataDirectory: string;
    sessions: { sessionId: string; pid: number | null; status: string; approvals: number; pendingTools: number; waitingUser: boolean; directory: string }[];
};
export function getZodiacRuntimeMonitor() { return request<ZodiacRuntimeMonitor>("/api/agent/monitor", {}); }
export function revealAppData() { return request<void>("/api/desktop/data", {}); }
