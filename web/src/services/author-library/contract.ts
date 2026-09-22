export type AuthorLibraryKind = "skill" | "prompt" | "asset";
export type AuthorAssetKind = "text" | "image" | "video" | "audio";

type AuthorLibraryItemBase = {
    id: string;
    kind: AuthorLibraryKind;
    version: string;
    title: string;
    description: string;
    authorNote?: string;
    tags: string[];
    category?: string;
    coverUrl?: string;
    contentUrl: string;
    sha256: string;
    bytes?: number;
    updatedAt?: string;
};

export type AuthorSkillItem = AuthorLibraryItemBase & {
    kind: "skill";
    capabilities: Array<"workflow" | "writing" | "image" | "video" | "audio" | "terminal">;
    license?: string;
    homepage?: string;
    zodiacOnly?: boolean;
};

export type AuthorPromptItem = AuthorLibraryItemBase & {
    kind: "prompt";
};

export type AuthorAssetItem = AuthorLibraryItemBase & {
    kind: "asset";
    assetKind: AuthorAssetKind;
    mimeType: string;
    note?: string;
};

export type AuthorLibraryItem = AuthorSkillItem | AuthorPromptItem | AuthorAssetItem;

export type AuthorLibraryCatalog = {
    schemaVersion: 1;
    updatedAt: string;
    publisher: {
        name: string;
        homepage?: string;
    };
    items: AuthorLibraryItem[];
};

const capabilities = new Set(["workflow", "writing", "image", "video", "audio", "terminal"]);
const assetKinds = new Set<AuthorAssetKind>(["text", "image", "video", "audio"]);
const sha256Pattern = /^[a-f0-9]{64}$/u;
const idPattern = /^author\.[a-z0-9][a-z0-9._-]{1,126}$/u;
const versionPattern = /^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/u;
const maxCatalogItems = 5_000;
const maxAuthorNoteLength = 2_000;

export function parseAuthorLibraryCatalog(value: unknown, sourceUrl: string): AuthorLibraryCatalog {
    const record = asRecord(value);
    if (record.schemaVersion !== 1 || !Array.isArray(record.items)) throw new Error("作者库格式不受支持");
    if (record.items.length > maxCatalogItems) throw new Error("作者库条目过多");

    const publisherRecord = asRecord(record.publisher);
    const publisherName = requiredString(publisherRecord.name, "作者库发布者");
    const publisherHomepage = optionalUrl(publisherRecord.homepage, sourceUrl, "发布者主页");
    const seen = new Set<string>();
    const items = record.items.map((item, index) => normalizeItem(item, index, sourceUrl));
    items.forEach((item) => {
        if (seen.has(item.id)) throw new Error(`作者库存在重复 ID：${item.id}`);
        seen.add(item.id);
    });

    return {
        schemaVersion: 1,
        updatedAt: optionalString(record.updatedAt) || new Date(0).toISOString(),
        publisher: { name: publisherName, ...(publisherHomepage ? { homepage: publisherHomepage } : {}) },
        items,
    };
}

function normalizeItem(value: unknown, index: number, sourceUrl: string): AuthorLibraryItem {
    const record = asRecord(value);
    const label = `作者库第 ${index + 1} 项`;
    const id = requiredString(record.id, `${label} ID`).toLowerCase();
    if (!idPattern.test(id)) throw new Error(`${label} ID 必须以 author. 开头`);
    const kind = requiredString(record.kind, `${label}类型`) as AuthorLibraryKind;
    if (kind !== "skill" && kind !== "prompt" && kind !== "asset") throw new Error(`${label}类型无效`);
    const version = requiredString(record.version, `${label}版本`);
    if (!versionPattern.test(version)) throw new Error(`${label}版本无效`);
    const sha256 = requiredString(record.sha256, `${label}校验值`).toLowerCase();
    if (!sha256Pattern.test(sha256)) throw new Error(`${label}校验值无效`);
    const contentUrl = requiredUrl(record.contentUrl, sourceUrl, `${label}下载地址`);
    const coverUrl = optionalUrl(record.coverUrl, sourceUrl, `${label}封面地址`);
    const bytes = optionalPositiveInteger(record.bytes);
    const authorNote = normalizeAuthorNote(record.authorNote, label);
    const base = {
        id,
        kind,
        version,
        title: requiredString(record.title, `${label}标题`),
        description: optionalString(record.description),
        ...(authorNote ? { authorNote } : {}),
        tags: stringArray(record.tags).slice(0, 24),
        ...(optionalString(record.category) ? { category: optionalString(record.category) } : {}),
        ...(coverUrl ? { coverUrl } : {}),
        contentUrl,
        sha256,
        ...(bytes ? { bytes } : {}),
        ...(optionalString(record.updatedAt) ? { updatedAt: optionalString(record.updatedAt) } : {}),
    };

    if (kind === "skill") {
        const normalizedCapabilities = stringArray(record.capabilities).filter((item) => capabilities.has(item)) as AuthorSkillItem["capabilities"];
        if (!normalizedCapabilities.length) throw new Error(`${label}至少需要一个 Skill 能力`);
        return {
            ...base,
            kind,
            capabilities: normalizedCapabilities,
            ...(optionalString(record.license) ? { license: optionalString(record.license) } : {}),
            ...(optionalUrl(record.homepage, sourceUrl, `${label}来源主页`) ? { homepage: optionalUrl(record.homepage, sourceUrl, `${label}来源主页`) } : {}),
            ...(typeof record.zodiacOnly === "boolean" ? { zodiacOnly: record.zodiacOnly } : {}),
        };
    }
    if (kind === "asset") {
        const assetKind = requiredString(record.assetKind, `${label}资产类型`) as AuthorAssetKind;
        if (!assetKinds.has(assetKind)) throw new Error(`${label}资产类型无效`);
        const mimeType = requiredString(record.mimeType, `${label}媒体类型`).toLowerCase();
        if (!mimeMatchesAssetKind(mimeType, assetKind)) throw new Error(`${label}媒体类型与资产类型不匹配`);
        return {
            ...base,
            kind,
            assetKind,
            mimeType,
            ...(optionalString(record.note) ? { note: optionalString(record.note) } : {}),
        };
    }
    return { ...base, kind };
}

function requiredUrl(value: unknown, baseUrl: string, label: string) {
    const result = optionalUrl(value, baseUrl, label);
    if (!result) throw new Error(`${label}不能为空`);
    return result;
}

function optionalUrl(value: unknown, baseUrl: string, label: string) {
    const raw = optionalString(value);
    if (!raw) return "";
    try {
        const url = new URL(raw, baseUrl);
        if (url.protocol === "https:" || isLoopbackHttp(url)) return url.toString();
    } catch {
        // Fall through to the shared validation message.
    }
    throw new Error(`${label}必须使用 HTTPS`);
}

function isLoopbackHttp(url: URL) {
    return url.protocol === "http:" && (url.hostname === "127.0.0.1" || url.hostname === "localhost" || url.hostname === "[::1]");
}

function mimeMatchesAssetKind(mimeType: string, kind: AuthorAssetKind) {
    if (kind === "text") return mimeType.startsWith("text/") || mimeType === "application/json";
    return mimeType.startsWith(`${kind}/`);
}

function asRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function requiredString(value: unknown, label: string) {
    const result = optionalString(value);
    if (!result) throw new Error(`${label}不能为空`);
    return result;
}

function optionalString(value: unknown) {
    return typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
}

function normalizeAuthorNote(value: unknown, label: string) {
    if (value === undefined || value === null) return "";
    if (typeof value !== "string") throw new Error(`${label}作者备注必须是文本`);
    const result = value.trim();
    if (result.length > maxAuthorNoteLength) throw new Error(`${label}作者备注不能超过 ${maxAuthorNoteLength} 个字符`);
    return result;
}

function stringArray(value: unknown) {
    if (!Array.isArray(value)) return [];
    return Array.from(new Set(value.map(optionalString).filter(Boolean)));
}

function optionalPositiveInteger(value: unknown) {
    const result = Number(value);
    return Number.isSafeInteger(result) && result > 0 ? result : undefined;
}
