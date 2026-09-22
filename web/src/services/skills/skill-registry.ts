import type { InstalledSkill, SkillCapability, SkillCatalogSource, SkillFile, SkillRegistrySource } from "./skill-presets";

const skillRegistryEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const SKILL_REGISTRY_URL = skillRegistryEnv?.VITE_SKILL_REGISTRY_URL || "https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist/official-skills.json";

/** 仓库索引里一个技能文件的元数据；正文要下载后才拿到。 */
export type SkillRegistryFile = {
    path: string;
    /** 索引声明的字节数；v1 索引不提供，只校验 sha256。 */
    bytes?: number;
    sha256: string;
};

export type SkillStructuredInfo = Record<
    string,
    { summary?: string; bestFor?: string[]; howToUse?: string; outputs?: string }
>;

export type SkillRegistryEntry = {
    id: string;
    name: string;
    nameEn?: string;
    version: string;
    description: string;
    descriptionEn?: string;
    author?: string;
    authorNote?: string;
    /** 技能市场封面与案例。只接受可信媒体域名的 HTTPS 地址。 */
    coverUrl?: string;
    showcase?: string[];
    downloads?: number;
    structuredInfo?: SkillStructuredInfo;
    /** 清单声明的署名来源，必须透传：界面按它分组并展示「官方精选 / 官方 / 社区 / 来源未知」。 */
    source?: SkillRegistrySource;
    /** 清单的英文标签，与 tags（中文）并存。 */
    tagsEn?: string[];
    /** 入口文件在技能包内的相对路径，通常是 SKILL.md，它的正文就是 InstalledSkill.body。 */
    entry: string;
    /** 技能包内的全部文件；v1 条目视为只有 SKILL.md。 */
    files: SkillRegistryFile[];
    /** 入口文件的下载地址：v1 用索引里的 contentUrl，v2 用 baseUrl + entry。 */
    contentUrl: string;
    /** 入口文件的 sha256，用于「可更新」判断。 */
    sha256: string;
    /** v2 技能包目录地址；v1 没有。 */
    baseUrl?: string;
    homepage?: string;
    publisher?: string;
    license?: string;
    category?: string;
    capabilities: SkillCapability[];
    tags: string[];
    triggerWords: string[];
    catalogSource: SkillCatalogSource;
};

export type SkillRegistry = {
    schemaVersion: 1 | 2;
    updatedAt?: string;
    skills: SkillRegistryEntry[];
    /** 被丢弃的条目及原因：单条坏数据不能拖垮整份索引（技能库来自第三方内容，格式不一定守规矩）。 */
    warnings?: string[];
};

export async function fetchSkillRegistry(url = SKILL_REGISTRY_URL): Promise<SkillRegistry> {
    const indexUrl = assertRemoteUrl(url);
    const response = await fetch(indexUrl, { cache: "no-store" });
    if (!response.ok) throw new Error(`Skill 仓库暂时不可用（${response.status}）`);
    return parseSkillRegistry(await response.json(), indexUrl);
}

/**
 * 解析仓库索引：v2 是多文件技能包，v1 视为只有一个 SKILL.md 的旧格式。
 *
 * 逐条隔离失败：技能库是第三方内容，只要有一条不守规矩（非法路径、哈希缺失、字段类型错），
 * 整份索引都不该失效——跳过该条并记进 warnings，其余照常可用。
 * 安装路径仍然 fail-closed：不安全的路径永远不会被下载或写盘。
 */
export function parseSkillRegistry(value: unknown, indexUrl = SKILL_REGISTRY_URL): SkillRegistry {
    const record = (value || {}) as { schemaVersion?: unknown; updatedAt?: unknown; skills?: unknown };
    if (!Array.isArray(record.skills)) throw new Error("Skill 仓库格式不受支持");
    if (record.schemaVersion !== 1 && record.schemaVersion !== 2) throw new Error("Skill 仓库格式不受支持");
    const schemaVersion = record.schemaVersion;
    const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : undefined;
    const skills: SkillRegistryEntry[] = [];
    const warnings: string[] = [];
    for (const entry of record.skills as Partial<SkillRegistryEntry>[]) {
        try {
            skills.push(schemaVersion === 2 ? normalizeMultiFileEntry(entry, indexUrl) : normalizeLegacyEntry(entry));
        } catch (error) {
            const index = skills.length + warnings.length + 1;
            const id = typeof entry?.id === "string" && entry.id.trim() ? entry.id.trim() : "第 " + index + " 条";
            const reason = error instanceof Error ? error.message : "条目无效";
            warnings.push("已跳过「" + id + "」：" + reason);
        }
    }
    return { schemaVersion, updatedAt, skills, ...(warnings.length ? { warnings } : {}) };
}

/**
 * 技能包内的相对路径只允许 A-Z a-z 0-9 . _ - 以及 / 分隔的层级。
 * 绝对路径、.. 、反斜杠、空路径、控制字符和超长路径都会被拒绝，
 * 保证前端拿到的每个文件都只会写到技能目录内。
 */
export function assertSafeSkillFilePath(value: string): string {
    const path = typeof value === "string" ? value.trim() : "";
    if (!path) throw new Error("技能文件路径为空，已停止安装");
    if (path.length > 180) throw new Error(`技能文件路径过长：${path.slice(0, 60)}…`);
    const segments = path.split("/");
    if (segments.some((segment) => segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/u.test(segment))) {
        throw new Error(`技能文件路径不安全：${path}`);
    }
    return segments.join("/");
}

export async function downloadRegistrySkill(entry: SkillRegistryEntry): Promise<InstalledSkill> {
    const files = await Promise.all(entry.files.map((file) => downloadRegistrySkillFile(entry, file)));
    const body = files.find((file) => file.path === entry.entry) || files[0];
    if (!body) throw new Error(`「${entry.name}」技能包没有可安装的文件`);
    const now = new Date().toISOString();
    return {
        ...entry,
        body: body.content,
        files,
        checksum: registryEntryIntegrity(entry),
        source: "registry",
        registrySource: entry.source,
        tagsEn: entry.tagsEn,
        triggerWords: entry.triggerWords,
        sourceUrl: entry.contentUrl,
        enabled: true,
        priority: 100,
        installedAt: now,
        updatedAt: now,
    };
}

export async function fetchRegistrySkillBody(entry: SkillRegistryEntry): Promise<string> {
    const file = entry.files.find((item) => item.path === entry.entry);
    if (!file) throw new Error(`「${entry.name}」技能包缺少入口文件`);
    return (await downloadRegistrySkillFile(entry, file)).content;
}

/** 逐个文件下载并校验 sha256 与字节数，任一不符都停止安装并指出是哪个文件。 */
async function downloadRegistrySkillFile(entry: SkillRegistryEntry, file: SkillRegistryFile): Promise<SkillFile> {
    const path = assertSafeSkillFilePath(file.path);
    const response = await fetch(registryFileUrl(entry, file), { cache: "no-store" });
    if (!response.ok) throw new Error(`无法下载「${entry.name}」的 ${path}（${response.status}）`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (typeof file.bytes === "number" && bytes.byteLength !== file.bytes) {
        throw new Error(`「${entry.name}」的 ${path} 校验失败（字节数应为 ${file.bytes}，实际 ${bytes.byteLength}），已停止安装`);
    }
    if ((await digestHex("SHA-256", bytes)) !== file.sha256.toLowerCase()) {
        throw new Error(`「${entry.name}」的 ${path} 校验失败，已停止安装`);
    }
    return { path, content: new TextDecoder().decode(bytes) };
}

function registryFileUrl(entry: SkillRegistryEntry, file: SkillRegistryFile) {
    if (entry.baseUrl) return assertRemoteUrl(entry.baseUrl + file.path);
    if (file.path === entry.entry) return assertRemoteUrl(entry.contentUrl);
    throw new Error(`技能包缺少下载地址：${file.path}`);
}

export function registryEntryIntegrity(entry: SkillRegistryEntry) {
    return entry.sha256.toLowerCase();
}

function normalizeMultiFileEntry(value: Partial<SkillRegistryEntry>, indexUrl: string): SkillRegistryEntry {
    const id = String(value.id || "").trim();
    const name = String(value.name || "").trim();
    const version = String(value.version || "").trim();
    if (!id || !name || !version || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/u.test(id) || !Array.isArray(value.files)) throw new Error("Skill 仓库中存在无效条目");
    const entry = value.entry?.trim() ? assertSafeSkillFilePath(value.entry.trim()) : "SKILL.md";
    const files = value.files.map((file) => {
        const path = assertSafeSkillFilePath(String(file?.path || ""));
        if (!/^[a-f0-9]{64}$/iu.test(file?.sha256 || "")) throw new Error(`Skill 仓库中存在无效条目：${id} 的 ${path} 缺少 sha256`);
        if (!Number.isInteger(file?.bytes) || Number(file?.bytes) < 0) throw new Error(`Skill 仓库中存在无效条目：${id} 的 ${path} 缺少字节数`);
        return { path, bytes: Number(file?.bytes), sha256: file.sha256.toLowerCase() };
    });
    if (!files.length || new Set(files.map((file) => file.path)).size !== files.length) throw new Error(`Skill 仓库中存在无效条目：${id} 的文件列表无效`);
    const body = files.find((file) => file.path === entry);
    if (!body) throw new Error(`Skill 仓库中存在无效条目：${id} 缺少入口文件 ${entry}`);
    const baseUrl = value.baseUrl?.trim() ? ensureTrailingSlash(assertRemoteUrl(value.baseUrl.trim())) : new URL(`skills/${id}/`, indexUrl).toString();
    return {
        id,
        name,
        nameEn: optionalText(value.nameEn),
        version,
        description: String(value.description || ""),
        descriptionEn: optionalText(value.descriptionEn),
        author: optionalText(value.author),
        authorNote: optionalText(value.authorNote),
        coverUrl: normalizeSkillMediaUrl(value.coverUrl),
        showcase: normalizeSkillMediaUrls(value.showcase),
        downloads: normalizeCount(value.downloads),
        structuredInfo: normalizeStructuredInfo(value.structuredInfo),
        source: normalizeRegistrySource(value.source),
        tagsEn: normalizeTagsEn(value.tags),
        entry,
        files,
        contentUrl: assertRemoteUrl(baseUrl + entry),
        sha256: body.sha256,
        baseUrl,
        homepage: value.homepage ? assertRemoteUrl(value.homepage) : undefined,
        publisher: optionalText(value.author) || optionalText(value.publisher),
        license: optionalText(value.license),
        category: optionalText(value.category),
        capabilities: Array.isArray(value.capabilities) ? value.capabilities : [],
        tags: normalizeTags(value.tags),
        triggerWords: Array.isArray(value.triggerWords) ? value.triggerWords.map(String) : [],
        catalogSource: value.catalogSource === "author" ? "author" : "official",
    };
}

function normalizeLegacyEntry(value: Partial<SkillRegistryEntry>): SkillRegistryEntry {
    if (!value.id?.trim() || !value.name?.trim() || !value.version?.trim() || !value.contentUrl?.trim() || !/^[a-f0-9]{64}$/iu.test(value.sha256 || "")) {
        throw new Error("Skill 仓库中存在无效条目");
    }
    const sha256 = value.sha256!.toLowerCase();
    return {
        id: value.id.trim(),
        name: value.name.trim(),
        version: value.version.trim(),
        description: String(value.description || ""),
        authorNote: value.authorNote ? String(value.authorNote).trim() : undefined,
        coverUrl: normalizeSkillMediaUrl(value.coverUrl),
        showcase: normalizeSkillMediaUrls(value.showcase),
        downloads: normalizeCount(value.downloads),
        structuredInfo: normalizeStructuredInfo(value.structuredInfo),
        entry: "SKILL.md",
        files: [{ path: "SKILL.md", sha256 }],
        contentUrl: assertRemoteUrl(value.contentUrl),
        sha256,
        homepage: value.homepage ? assertRemoteUrl(value.homepage) : undefined,
        publisher: value.publisher ? String(value.publisher) : undefined,
        license: value.license ? String(value.license) : undefined,
        category: value.category ? String(value.category) : undefined,
        capabilities: Array.isArray(value.capabilities) ? value.capabilities : [],
        tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
        triggerWords: [],
        catalogSource: value.catalogSource === "author" ? "author" : "official",
    };
}

/** v2 的 tags 是 { zh, en }，v1 是字符串数组；界面只展示一种语言，优先中文。 */
function normalizeTags(tags: unknown): string[] {
    if (Array.isArray(tags)) return tags.map(String);
    const record = (tags || {}) as { zh?: unknown; en?: unknown };
    const zh = Array.isArray(record.zh) ? record.zh.map(String) : [];
    return zh.length ? zh : Array.isArray(record.en) ? record.en.map(String) : [];
}

function normalizeRegistrySource(value: unknown): SkillRegistrySource | undefined {
    return value === "official-featured" || value === "official" || value === "community" || value === "unknown" ? value : undefined;
}

function normalizeTagsEn(tags: unknown): string[] | undefined {
    const en = Array.isArray((tags as { en?: unknown } | null)?.en) ? ((tags as { en: unknown[] }).en.map(String)) : [];
    return en.length ? en : undefined;
}

function optionalText(value: unknown) {
    const text = typeof value === "string" ? value.trim() : "";
    return text || undefined;
}

const SKILL_MEDIA_HOSTS = new Set(["cdn.hailuoai.com", "cdn.hailuoai.video"]);

function normalizeSkillMediaUrl(value: unknown) {
    if (typeof value !== "string" || !value.trim()) return undefined;
    try {
        const url = new URL(value.trim());
        if (url.protocol !== "https:" || url.username || url.password || url.port || !SKILL_MEDIA_HOSTS.has(url.hostname)) return undefined;
        if (!/\.(?:mp4|webm|mov|gif|png|jpe?g|webp|jfif)$/iu.test(url.pathname)) return undefined;
        url.search = "";
        url.hash = "";
        return url.toString();
    } catch {
        return undefined;
    }
}

function normalizeSkillMediaUrls(value: unknown) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    const urls = values.map(normalizeSkillMediaUrl).filter((url): url is string => Boolean(url));
    return urls.length ? [...new Set(urls)] : undefined;
}

function normalizeCount(value: unknown) {
    const count = Number(value);
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : undefined;
}

function normalizeStructuredInfo(value: unknown): SkillStructuredInfo | undefined {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const result: SkillStructuredInfo = {};
    for (const [locale, raw] of Object.entries(value)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const record = raw as Record<string, unknown>;
        const best = record.bestFor ?? record["best-for"] ?? record.best_for;
        const info = {
            summary: optionalText(record.summary),
            bestFor: Array.isArray(best) ? best.map(String).map((item) => item.trim()).filter(Boolean) : undefined,
            howToUse: optionalText(record.howToUse ?? record["how-to-use"] ?? record.how_to_use),
            outputs: optionalText(record.outputs),
        };
        if (info.summary || info.bestFor?.length || info.howToUse || info.outputs) result[locale] = info;
    }
    return Object.keys(result).length ? result : undefined;
}

function ensureTrailingSlash(value: string) {
    return value.endsWith("/") ? value : `${value}/`;
}

function assertRemoteUrl(value: string) {
    const url = new URL(value);
    if (url.protocol !== "https:") throw new Error("Skill 来源必须使用 HTTPS");
    return url.toString();
}

async function digestHex(algorithm: "SHA-256", bytes: Uint8Array) {
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const digest = await crypto.subtle.digest(algorithm, buffer);
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
