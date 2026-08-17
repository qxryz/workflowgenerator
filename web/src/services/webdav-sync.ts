import type { WebdavSyncConfig } from "@/stores/use-config-store";
import { readResponseBytes, readResponseText } from "@/lib/limited-response";
import { normalizeCredentialUrl } from "@/lib/secure-url";

export const WEBDAV_MANIFEST_FILE_NAME = "manifest.json";
const WEBDAV_REQUEST_TIMEOUT_MS = 120000;
const WEBDAV_DEFAULT_DOWNLOAD_LIMIT = 256 * 1024 * 1024;
const WEBDAV_ERROR_LIMIT = 8 * 1024;
const ensuredDirectories = new Set<string>();

export async function testWebdavConnection(config: WebdavSyncConfig) {
    await ensureWebdavDirectory(config);
    const response = await webdavFetch(config, "", { method: "PROPFIND", headers: { Depth: "0" } });
    if (response.ok || response.status === 207) return;
    await throwWebdavError(response, "WebDAV 连接测试失败");
}

export async function downloadWebdavSyncFile(config: WebdavSyncConfig) {
    return downloadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME);
}

export async function downloadWebdavFile(config: WebdavSyncConfig, path: string, maxBytes = WEBDAV_DEFAULT_DOWNLOAD_LIMIT) {
    await ensureWebdavDirectory(config);
    const response = await webdavFetch(config, path, { method: "GET" });
    if (response.status === 404) return null;
    if (!response.ok) await throwWebdavError(response, "读取 WebDAV 同步文件失败");
    const bytes = await readResponseBytes(response, maxBytes, "WebDAV 文件过大，已停止下载", WEBDAV_REQUEST_TIMEOUT_MS);
    const file = new Blob([bytes], { type: response.headers.get("content-type") || "application/octet-stream" });
    return file.size ? file : null;
}

export async function uploadWebdavSyncFile(config: WebdavSyncConfig, file: Blob) {
    return uploadWebdavFile(config, WEBDAV_MANIFEST_FILE_NAME, file, "application/json");
}

export async function uploadWebdavFile(config: WebdavSyncConfig, path: string, file: Blob, contentType = "application/octet-stream") {
    if (!file.size) throw new Error("上传文件为空，已取消上传");
    await ensureWebdavDirectory(config);
    await ensureWebdavSubdirectory(config, path);
    const response = await webdavFetch(config, path, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: file,
    });
    if (!response.ok) await throwWebdavError(response, "上传 WebDAV 同步文件失败");
}

async function ensureWebdavDirectory(config: WebdavSyncConfig) {
    assertWebdavConfig(config);
    await ensureWebdavDirectoryPath(config, config.directory);
}

async function ensureWebdavSubdirectory(config: WebdavSyncConfig, path: string) {
    const directory = normalizeWebdavPath(path).split("/").slice(0, -1).join("/");
    if (!directory) return;
    await ensureWebdavDirectoryPath(config, [config.directory, directory].filter(Boolean).join("/"));
}

async function ensureWebdavDirectoryPath(config: WebdavSyncConfig, directory: string) {
    const parts = normalizeWebdavPath(directory).split("/").filter(Boolean);
    const cacheKey = `${config.url}:${parts.join("/")}`;
    if (ensuredDirectories.has(cacheKey)) return;
    let path = "";
    for (const part of parts) {
        path = path ? `${path}/${part}` : part;
        const response = await webdavFetch({ ...config, directory: "" }, path, { method: "MKCOL" });
        if (response.ok || ((response.status === 405 || response.status === 423) && (await webdavDirectoryExists(config, path)))) continue;
        await throwWebdavError(response, "创建 WebDAV 远程目录失败");
    }
    ensuredDirectories.add(cacheKey);
}

async function webdavDirectoryExists(config: WebdavSyncConfig, path: string) {
    const response = await webdavFetch({ ...config, directory: "" }, path, { method: "PROPFIND", headers: { Depth: "0" } });
    return response.ok || response.status === 207;
}

async function webdavFetch(config: WebdavSyncConfig, path: string, init: RequestInit) {
    const headers = new Headers(init.headers);
    if (config.username || config.password) headers.set("Authorization", `Basic ${encodeBasicAuth(`${config.username}:${config.password}`)}`);
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), WEBDAV_REQUEST_TIMEOUT_MS);
    try {
        const url = buildWebdavUrl(config, path);
        return await fetch(url, { ...init, headers, redirect: "error", signal: controller.signal });
    } catch (error) {
        if (error instanceof Error && error.name === "AbortError") throw new Error("WebDAV 请求超时，请检查网络或远端服务状态");
        if (error instanceof TypeError) throw new Error("无法连接 WebDAV，请检查地址、HTTPS 证书、CORS 或网络状态");
        throw error;
    } finally {
        window.clearTimeout(timer);
    }
}

export function buildWebdavUrl(config: WebdavSyncConfig, path: string) {
    const baseUrl = new URL(normalizeCredentialUrl(config.url, "WebDAV 地址"));
    baseUrl.search = "";
    baseUrl.hash = "";
    if (!baseUrl.pathname.endsWith("/")) baseUrl.pathname += "/";
    const remotePath = [normalizeWebdavPath(config.directory), normalizeWebdavPath(path)].filter(Boolean).join("/");
    const encodedPath = remotePath
        .split("/")
        .filter(Boolean)
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    const result = new URL(encodedPath, baseUrl);
    if (result.origin !== baseUrl.origin || !result.pathname.startsWith(baseUrl.pathname)) throw new Error("WebDAV 远程路径不安全");
    return result.toString().replace(/\/$/u, encodedPath ? "" : "/");
}

export function normalizeWebdavPath(path: string) {
    const normalized = path.trim().replace(/^\/+|\/+$/g, "");
    if (!normalized) return "";
    return normalized
        .split("/")
        .map((segment) => {
            let decoded: string;
            try {
                decoded = decodeURIComponent(segment);
            } catch {
                throw new Error("WebDAV 远程路径格式不正确");
            }
            if (!segment || decoded === "." || decoded === ".." || /[\\/\0-\x1f\x7f]/u.test(decoded)) throw new Error("WebDAV 远程路径不安全");
            return segment;
        })
        .join("/");
}

function assertWebdavConfig(config: WebdavSyncConfig) {
    if (!config.url.trim()) throw new Error("请先填写 WebDAV 地址");
    normalizeCredentialUrl(config.url, "WebDAV 地址");
    normalizeWebdavPath(config.directory);
}

async function throwWebdavError(response: Response, fallback: string): Promise<never> {
    const detail = await readResponseText(response, WEBDAV_ERROR_LIMIT, "", 10_000).catch(() => "");
    if (response.status === 401 || response.status === 403) throw new Error("WebDAV 认证失败，请检查用户名、密码或应用密码");
    if (response.status === 404) throw new Error("WebDAV 路径不存在，请检查地址和远程目录");
    throw new Error(`${fallback}：${response.status}${detail ? ` ${detail.slice(0, 120)}` : ""}`);
}

function encodeBasicAuth(value: string) {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });
    return btoa(binary);
}
