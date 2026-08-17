import { discardUploadedMedia, publishUploadedMedia, uploadMediaFile } from "@/services/file-storage";
import { discardUploadedImage, publishUploadedImage, uploadImage } from "@/services/image-storage";
import { isDesktopApp } from "@/services/desktop-storage";
import type { RawPrompt } from "@/services/api/prompt-source-runtime";
import type { InstalledSkill } from "@/services/skills/skill-presets";
import { useAssetStore, type Asset } from "@/stores/use-asset-store";
import { useAuthorPromptStore, type InstalledAuthorPrompt } from "@/stores/use-author-prompt-store";
import { useSkillStore } from "@/stores/use-skill-store";
import type { AuthorAssetItem, AuthorLibraryItem, AuthorPromptItem, AuthorSkillItem } from "./contract";

export type AuthorLibraryInstallResult = {
    destination: "skill" | "prompt" | "asset";
    id: string;
    title: string;
};

const maxSkillBytes = 1024 * 1024;
const maxPromptBytes = 1024 * 1024;
const maxAssetBytes = {
    text: 4 * 1024 * 1024,
    image: 25 * 1024 * 1024,
    audio: 100 * 1024 * 1024,
    video: 256 * 1024 * 1024,
} as const;

export async function installAuthorLibraryItem(item: AuthorLibraryItem, publisher: string): Promise<AuthorLibraryInstallResult> {
    if (item.kind === "skill") {
        const skill = await downloadAuthorSkill(item, publisher);
        useSkillStore.getState().save(skill);
        return { destination: "skill", id: skill.id, title: skill.name };
    }
    if (item.kind === "prompt") {
        const prompt = await downloadAuthorPrompt(item, publisher);
        useAuthorPromptStore.getState().save(prompt);
        return { destination: "prompt", id: prompt.id, title: prompt.title };
    }
    const id = await downloadAuthorAsset(item, publisher);
    return { destination: "asset", id, title: item.title };
}

export function installedAuthorAsset(itemId: string) {
    return useAssetStore.getState().assets.find((asset) => asset.metadata?.authorLibraryId === itemId);
}

async function downloadAuthorSkill(item: AuthorSkillItem, publisher: string): Promise<InstalledSkill> {
    const bytes = await fetchVerifiedBytes(item, maxSkillBytes);
    const body = decodeUtf8(bytes, `「${item.title}」内容不是有效文本`).trim();
    if (!body) throw new Error(`「${item.title}」内容为空`);
    const now = new Date().toISOString();
    const existing = useSkillStore.getState().skills.find((skill) => skill.id === item.id && skill.catalogSource === "author");
    return {
        id: item.id,
        name: item.title,
        version: item.version,
        description: item.description,
        authorNote: item.authorNote,
        body,
        capabilities: item.capabilities,
        tags: item.tags,
        source: "registry",
        catalogSource: "author",
        sourceUrl: item.contentUrl,
        homepage: item.homepage,
        checksum: item.sha256,
        publisher,
        license: item.license,
        category: item.category,
        enabled: existing?.enabled ?? true,
        priority: existing?.priority ?? 100,
        zodiacOnly: existing?.zodiacOnly ?? item.zodiacOnly,
        installedAt: existing?.installedAt || now,
        updatedAt: now,
    };
}

async function downloadAuthorPrompt(item: AuthorPromptItem, publisher: string): Promise<InstalledAuthorPrompt> {
    const bytes = await fetchVerifiedBytes(item, maxPromptBytes);
    let value: unknown;
    try {
        value = JSON.parse(decodeUtf8(bytes, `「${item.title}」内容不是有效文本`));
    } catch (error) {
        if (error instanceof SyntaxError) throw new Error(`「${item.title}」提示词文件不是有效 JSON`);
        throw error;
    }
    const record = asRecord(value);
    const prompt = stringValue(record.prompt).trim();
    if (!prompt) throw new Error(`「${item.title}」缺少提示词正文`);
    const now = new Date().toISOString();
    const existing = useAuthorPromptStore.getState().prompts.find((entry) => entry.id === item.id);
    const raw: RawPrompt = {
        id: item.id,
        title: item.title,
        prompt,
        description: item.description || stringValue(record.description),
        authorNote: item.authorNote,
        coverUrl: absoluteOptionalUrl(stringValue(record.coverUrl), item.contentUrl),
        referenceImageUrls: stringArray(record.referenceImageUrls)
            .map((url) => absoluteOptionalUrl(url, item.contentUrl))
            .filter(Boolean),
        tags: Array.from(new Set([...item.tags, ...stringArray(record.tags)])),
        preview: stringValue(record.preview),
        createdAt: stringValue(record.createdAt) || item.updatedAt || now,
        updatedAt: item.updatedAt || stringValue(record.updatedAt) || now,
        author: publisher,
        sourceUrl: item.contentUrl,
        imageMode: optionalString(record.imageMode),
        imageModel: optionalString(record.imageModel),
        imageSize: optionalString(record.imageSize),
        imageCount: optionalNumber(record.imageCount),
    };
    return {
        ...raw,
        version: item.version,
        checksum: item.sha256,
        contentUrl: item.contentUrl,
        installedAt: existing?.installedAt || now,
    };
}

async function downloadAuthorAsset(item: AuthorAssetItem, publisher: string) {
    const existing = installedAuthorAsset(item.id);
    if (existing?.metadata?.authorLibraryChecksum === item.sha256) return existing.id;
    if (item.bytes && item.bytes > maxAssetBytes[item.assetKind]) throw new Error(`「${item.title}」文件过大，无法保存`);
    const metadata = {
        authorLibraryId: item.id,
        authorLibraryVersion: item.version,
        authorLibraryChecksum: item.sha256,
        authorLibraryContentUrl: item.contentUrl,
        authorNote: item.authorNote || item.note || "",
        publisher,
        mimeType: item.mimeType,
    };
    const base = {
        title: item.title,
        tags: Array.from(new Set(["作者私藏", ...item.tags])),
        source: "作者私藏",
        note: item.authorNote || item.note || item.description,
        metadata,
    };
    if (item.assetKind === "text") {
        const bytes = await fetchVerifiedBytes(item, maxAssetBytes.text);
        return useAssetStore.getState().upsertAssetPersisted(existing?.id, {
            ...base,
            kind: "text",
            coverUrl: item.coverUrl || "",
            data: { content: decodeUtf8(bytes, `「${item.title}」内容不是有效文本`) },
        });
    }
    if (isImageAsset(item)) return installImageAsset(item, existing, base);
    if (isMediaAsset(item)) return installMediaAsset(item, existing, base);
    throw new Error(`「${item.title}」资产类型不受支持`);
}

async function installImageAsset(item: AuthorAssetItem & { assetKind: "image" }, existing: Asset | undefined, base: AssetBaseInput) {
    const input = isDesktopApp() ? item.contentUrl : await verifiedBlob(item, maxAssetBytes.image);
    const uploaded = await uploadImage(input, { expectedSha256: item.sha256, maxBytes: maxAssetBytes.image });
    try {
        const id = await useAssetStore.getState().upsertAssetPersisted(existing?.id, {
            ...base,
            kind: "image",
            coverUrl: uploaded.url,
            data: { dataUrl: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width, height: uploaded.height, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
        });
        publishUploadedImage(uploaded);
        return id;
    } catch (error) {
        await discardUploadedImage(uploaded);
        throw error;
    }
}

async function installMediaAsset(item: AuthorAssetItem & { assetKind: "video" | "audio" }, existing: Asset | undefined, base: AssetBaseInput) {
    const limit = maxAssetBytes[item.assetKind];
    const input = isDesktopApp() ? item.contentUrl : await verifiedBlob(item, limit);
    const uploaded = await uploadMediaFile(input, item.assetKind, { expectedSha256: item.sha256, maxBytes: limit });
    try {
        const asset =
            item.assetKind === "video"
                ? {
                      ...base,
                      kind: "video" as const,
                      coverUrl: item.coverUrl || "",
                      data: { url: uploaded.url, storageKey: uploaded.storageKey, width: uploaded.width || 1280, height: uploaded.height || 720, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
                  }
                : {
                      ...base,
                      kind: "audio" as const,
                      coverUrl: item.coverUrl || "",
                      data: { url: uploaded.url, storageKey: uploaded.storageKey, durationMs: uploaded.durationMs, bytes: uploaded.bytes, mimeType: uploaded.mimeType },
                  };
        const id = await useAssetStore.getState().upsertAssetPersisted(existing?.id, asset);
        publishUploadedMedia(uploaded);
        return id;
    } catch (error) {
        await discardUploadedMedia(uploaded);
        throw error;
    }
}

async function verifiedBlob(item: AuthorLibraryItem, maxBytes: number) {
    const bytes = await fetchVerifiedBytes(item, maxBytes);
    return new Blob([bytes], { type: item.kind === "asset" ? item.mimeType : "application/octet-stream" });
}

async function fetchVerifiedBytes(item: AuthorLibraryItem, maxBytes: number) {
    if (item.bytes && item.bytes > maxBytes) throw new Error(`「${item.title}」文件过大，无法保存`);
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), 120_000);
    try {
        const response = await fetch(item.contentUrl, { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error(`「${item.title}」下载失败（${response.status}）`);
        const declaredLength = Number(response.headers.get("content-length") || 0);
        if (declaredLength > maxBytes) throw new Error(`「${item.title}」文件过大，无法保存`);
        const bytes = new Uint8Array(await response.arrayBuffer());
        if (bytes.byteLength > maxBytes) throw new Error(`「${item.title}」文件过大，无法保存`);
        if ((await digestHex(bytes)) !== item.sha256) throw new Error(`「${item.title}」校验失败，已停止保存`);
        return bytes;
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new Error(`「${item.title}」下载超时`);
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}

async function digestHex(bytes: Uint8Array) {
    const input = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(input).set(bytes);
    const digest = await crypto.subtle.digest("SHA-256", input);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeUtf8(bytes: Uint8Array, message: string) {
    try {
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
        throw new Error(message);
    }
}

function absoluteOptionalUrl(value: string, baseUrl: string) {
    if (!value) return "";
    try {
        const url = new URL(value, baseUrl);
        return url.protocol === "https:" || (url.protocol === "http:" && ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)) ? url.toString() : "";
    } catch {
        return "";
    }
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function stringValue(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

function stringArray(value: unknown) {
    return Array.isArray(value)
        ? value
              .map(stringValue)
              .map((item) => item.trim())
              .filter(Boolean)
        : [];
}

function optionalString(value: unknown) {
    const result = stringValue(value).trim();
    return result || undefined;
}

function optionalNumber(value: unknown) {
    const result = Number(value);
    return Number.isFinite(result) && result > 0 ? result : undefined;
}

type AssetBaseInput = {
    title: string;
    tags: string[];
    source: string;
    note: string;
    metadata: Record<string, unknown>;
};

function isImageAsset(item: AuthorAssetItem): item is AuthorAssetItem & { assetKind: "image" } {
    return item.assetKind === "image";
}

function isMediaAsset(item: AuthorAssetItem): item is AuthorAssetItem & { assetKind: "video" | "audio" } {
    return item.assetKind === "video" || item.assetKind === "audio";
}
