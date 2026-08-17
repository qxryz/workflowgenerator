import type { InstalledSkill, SkillCapability, SkillCatalogSource } from "./skill-presets";

const skillRegistryEnv = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
export const SKILL_REGISTRY_URL = skillRegistryEnv?.VITE_SKILL_REGISTRY_URL || "https://raw.githubusercontent.com/qxryz/workflowgenerator/skills-dist/official-skills.json";

export type SkillRegistryEntry = {
    id: string;
    name: string;
    version: string;
    description: string;
    authorNote?: string;
    contentUrl: string;
    sha256: string;
    homepage?: string;
    publisher?: string;
    license?: string;
    category?: string;
    capabilities: SkillCapability[];
    tags: string[];
    catalogSource: SkillCatalogSource;
};

export type SkillRegistry = {
    schemaVersion: 1;
    updatedAt?: string;
    skills: SkillRegistryEntry[];
};

export async function fetchSkillRegistry(url = SKILL_REGISTRY_URL): Promise<SkillRegistry> {
    const response = await fetch(assertRemoteUrl(url), { cache: "no-store" });
    if (!response.ok) throw new Error(`Skill 仓库暂时不可用（${response.status}）`);
    const value = (await response.json()) as Partial<SkillRegistry>;
    if (value.schemaVersion !== 1 || !Array.isArray(value.skills)) throw new Error("Skill 仓库格式不受支持");
    return {
        schemaVersion: 1,
        updatedAt: typeof value.updatedAt === "string" ? value.updatedAt : undefined,
        skills: value.skills.map(normalizeEntry),
    };
}

export async function downloadRegistrySkill(entry: SkillRegistryEntry): Promise<InstalledSkill> {
    const body = await fetchRegistrySkillBody(entry);
    const now = new Date().toISOString();
    return {
        ...entry,
        body,
        checksum: registryEntryIntegrity(entry),
        source: "registry",
        sourceUrl: entry.contentUrl,
        enabled: true,
        priority: 100,
        installedAt: now,
        updatedAt: now,
    };
}

export async function fetchRegistrySkillBody(entry: SkillRegistryEntry): Promise<string> {
    const response = await fetch(assertRemoteUrl(entry.contentUrl), { cache: "no-store" });
    if (!response.ok) throw new Error(`无法下载「${entry.name}」（${response.status}）`);
    const body = await response.text();
    if ((await digestHex("SHA-256", new TextEncoder().encode(body))) !== entry.sha256.toLowerCase()) {
        throw new Error(`「${entry.name}」校验失败，已停止安装`);
    }
    return body;
}

export function registryEntryIntegrity(entry: SkillRegistryEntry) {
    return entry.sha256.toLowerCase();
}

function normalizeEntry(value: Partial<SkillRegistryEntry>): SkillRegistryEntry {
    if (!value.id?.trim() || !value.name?.trim() || !value.version?.trim() || !value.contentUrl?.trim() || !/^[a-f0-9]{64}$/iu.test(value.sha256 || "")) {
        throw new Error("Skill 仓库中存在无效条目");
    }
    return {
        id: value.id.trim(),
        name: value.name.trim(),
        version: value.version.trim(),
        description: String(value.description || ""),
        authorNote: value.authorNote ? String(value.authorNote).trim() : undefined,
        contentUrl: assertRemoteUrl(value.contentUrl),
        sha256: value.sha256!.toLowerCase(),
        homepage: value.homepage ? assertRemoteUrl(value.homepage) : undefined,
        publisher: value.publisher ? String(value.publisher) : undefined,
        license: value.license ? String(value.license) : undefined,
        category: value.category ? String(value.category) : undefined,
        capabilities: Array.isArray(value.capabilities) ? value.capabilities : [],
        tags: Array.isArray(value.tags) ? value.tags.map(String) : [],
        catalogSource: value.catalogSource === "author" ? "author" : "official",
    };
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
