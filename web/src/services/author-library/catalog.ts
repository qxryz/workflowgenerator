import { createDesktopJsonStore } from "@/services/desktop-storage";
import { parseAuthorLibraryCatalog, type AuthorLibraryCatalog } from "./contract";

const authorLibraryEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const AUTHOR_LIBRARY_CATALOG_URL = authorLibraryEnv?.VITE_AUTHOR_LIBRARY_CATALOG_URL || "https://raw.githubusercontent.com/qxryz/workflowgenerator/author-library-dist/catalog.json";

const fallbackCatalogPath = "/author-library/catalog.json";
const maxCatalogBytes = 2 * 1024 * 1024;
const catalogTimeoutMs = 10_000;
const catalogStore = createDesktopJsonStore({
    namespace: "author-library-cache-v1",
    legacy: { name: "infinite-canvas", storeName: "author_library_cache" },
});

type CachedCatalog = {
    catalog: AuthorLibraryCatalog;
    sourceUrl: string;
    fetchedAt: number;
};

export type AuthorLibrarySnapshot = CachedCatalog & {
    stale: boolean;
    warning?: string;
};

export async function fetchAuthorLibraryCatalog(): Promise<AuthorLibrarySnapshot> {
    const remoteUrl = absoluteCatalogUrl(AUTHOR_LIBRARY_CATALOG_URL);
    try {
        const catalog = await requestCatalog(remoteUrl);
        const cached = { catalog, sourceUrl: remoteUrl, fetchedAt: Date.now() };
        await catalogStore.setItem("catalog", cached);
        return { ...cached, stale: false };
    } catch (error) {
        const cached = await catalogStore.getItem<CachedCatalog>("catalog");
        if (cached) {
            return {
                ...cached,
                stale: true,
                warning: `暂时无法检查更新，正在显示上次内容。${errorMessage(error)}`,
            };
        }
        const fallbackUrl = absoluteCatalogUrl(fallbackCatalogPath);
        if (fallbackUrl !== remoteUrl) {
            try {
                const catalog = await requestCatalog(fallbackUrl);
                return { catalog, sourceUrl: fallbackUrl, fetchedAt: 0, stale: false };
            } catch {
                // The remote error is more useful than a bundled fallback error.
            }
        }
        throw new Error(`作者库暂时不可用。${errorMessage(error)}`);
    }
}

async function requestCatalog(url: string) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), catalogTimeoutMs);
    try {
        const response = await fetch(url, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`请求失败（${response.status}）`);
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (declaredLength > maxCatalogBytes) throw new Error("目录文件过大");
        const text = await response.text();
        if (new TextEncoder().encode(text).byteLength > maxCatalogBytes) throw new Error("目录文件过大");
        return parseAuthorLibraryCatalog(JSON.parse(text), url);
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error("目录文件不是有效 JSON");
        if (error instanceof DOMException && error.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

function absoluteCatalogUrl(value: string) {
    const base = typeof window === "undefined" ? "https://workflowgenerator.local/" : window.location.href;
    return new URL(value, base).toString();
}

function errorMessage(error: unknown) {
    return error instanceof Error ? error.message : "请稍后重试";
}
