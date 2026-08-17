export const DEFAULT_DIRECTOR_INSTANCE_ID = "default";
export const DEFAULT_DIRECTOR_RETURN_TO = "/workbench";

export type DirectorCapturePayload = {
    id?: string;
    dataUrl: string;
    fileName: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    contentHash?: string;
};

export function resolveDirectorInstanceId(search: string) {
    const candidate = new URLSearchParams(search).get("instanceId")?.trim() || "";
    return /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(candidate) ? candidate : DEFAULT_DIRECTOR_INSTANCE_ID;
}

export function resolveDirectorReturnTo(search: string, origin: string) {
    const candidate = new URLSearchParams(search).get("returnTo")?.trim();
    if (!candidate || !candidate.startsWith("/") || candidate.startsWith("//")) return DEFAULT_DIRECTOR_RETURN_TO;
    try {
        const resolved = new URL(candidate, origin);
        if (resolved.origin !== origin) return DEFAULT_DIRECTOR_RETURN_TO;
        return `${resolved.pathname}${resolved.search}${resolved.hash}`;
    } catch {
        return DEFAULT_DIRECTOR_RETURN_TO;
    }
}

export function isDirectorCapturePayload(value: unknown): value is DirectorCapturePayload {
    if (!value || typeof value !== "object") return false;
    const capture = value as Partial<DirectorCapturePayload>;
    const hasInlineImage = typeof capture.dataUrl === "string" && /^data:image\/[a-z0-9.+-]+(?:;|,)/i.test(capture.dataUrl);
    const hasStoredImage = typeof capture.storageKey === "string" && /^image:[a-zA-Z0-9_-]+$/.test(capture.storageKey) && typeof capture.dataUrl === "string";
    return (hasInlineImage || hasStoredImage) && typeof capture.fileName === "string";
}

export function directorCaptureTitle(fileName: string, index: number) {
    const name = fileName
        .split(/[\\/]/)
        .pop()
        ?.replace(/\.[^.]+$/, "")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, 80);
    return name || `导演台截图 ${index + 1}`;
}
