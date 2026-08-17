export type GeneratedVideoPayload = {
    blob?: Blob;
    url?: string;
    mimeType?: string;
};

export type PersistedVideoFile = {
    url: string;
    storageKey: string;
    bytes: number;
    mimeType: string;
    width?: number;
    height?: number;
    durationMs?: number;
};

export async function persistGeneratedVideo<T extends PersistedVideoFile>(
    result: GeneratedVideoPayload,
    upload: (input: string | Blob, prefix: string) => Promise<T>,
    desktop: boolean,
): Promise<T | PersistedVideoFile> {
    if (result.blob) return upload(result.blob, "video");
    if (result.url) {
        try {
            return await upload(result.url, "video");
        } catch (error) {
            if (desktop) {
                const detail = error instanceof Error && error.message ? `：${error.message}` : "";
                throw new Error(`视频已生成，但无法保存到本地${detail}`);
            }
            return { url: result.url, storageKey: "", bytes: 0, mimeType: result.mimeType || "video/mp4" };
        }
    }
    throw new Error("视频接口没有返回可播放的视频");
}

/**
 * Transfer a freshly uploaded video from provisional storage to a plugin result.
 * Plugin callers must never receive an unowned remote URL: a durable storage key
 * is required before ownership is published, and rejected files are discarded.
 */
export async function finalizePluginVideoResult<T extends PersistedVideoFile>(
    file: T,
    publish: (file: T) => boolean,
    discard: (file: T) => Promise<boolean>,
): Promise<PersistedVideoFile> {
    try {
        if (!file.storageKey) throw new Error("视频未能保存到本地，请重试");
        const result: PersistedVideoFile = {
            url: file.url,
            storageKey: file.storageKey,
            bytes: file.bytes,
            mimeType: file.mimeType,
            width: file.width,
            height: file.height,
            durationMs: file.durationMs,
        };
        if (!publish(file)) throw new Error("视频未能完成保存，请重试");
        return result;
    } catch (error) {
        try {
            await discard(file);
        } catch {
            // Preserve the actionable generation/storage error for the caller.
        }
        throw error;
    }
}
