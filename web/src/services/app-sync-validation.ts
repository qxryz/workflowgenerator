import { normalizeWebdavPath } from "@/services/webdav-sync";

export type AppSyncFile = {
    storageKey: string;
    path: string;
    mimeType: string;
    bytes: number;
};

const storageKeyPattern = /^(image|video|audio|file|video-reference|audio-reference):[A-Za-z0-9_-]{1,128}$/u;
const MAX_SYNC_FILE_BYTES = 256 * 1024 * 1024;
const MAX_SYNC_FILES = 10_000;

export function validateRemoteSyncFiles(domain: "canvas" | "assets", value: unknown): AppSyncFile[] {
    if (!Array.isArray(value)) return [];
    if (value.length > MAX_SYNC_FILES) throw new Error(`${domain} 同步清单包含过多文件`);
    const seenKeys = new Set<string>();
    const seenPaths = new Set<string>();
    return value.map((raw) => {
        if (!raw || typeof raw !== "object") throw new Error(`${domain} 同步清单包含无效文件记录`);
        const item = raw as Record<string, unknown>;
        const storageKey = typeof item.storageKey === "string" ? item.storageKey : "";
        const path = typeof item.path === "string" ? item.path : "";
        const mimeType = typeof item.mimeType === "string" ? item.mimeType : "";
        const bytes = Number(item.bytes);
        if (!storageKeyPattern.test(storageKey)) throw new Error(`${domain} 同步清单包含无效存储标识`);
        const normalizedPath = normalizeWebdavPath(path);
        if (normalizedPath !== path || !normalizedPath.startsWith(`${domain}/files/`)) throw new Error(`${domain} 同步清单包含越界文件路径`);
        if (!Number.isSafeInteger(bytes) || bytes <= 0 || bytes > MAX_SYNC_FILE_BYTES) throw new Error(`${domain} 同步清单包含无效文件大小`);
        if (!/^[a-z0-9][a-z0-9.+-]*\/[a-z0-9][a-z0-9.+-]*$/iu.test(mimeType) || mimeType.length > 100) throw new Error(`${domain} 同步清单包含无效文件类型`);
        if (seenKeys.has(storageKey) || seenPaths.has(normalizedPath)) throw new Error(`${domain} 同步清单包含重复文件记录`);
        seenKeys.add(storageKey);
        seenPaths.add(normalizedPath);
        return { storageKey, path: normalizedPath, mimeType, bytes };
    });
}
