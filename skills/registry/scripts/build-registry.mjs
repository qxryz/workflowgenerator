import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse as parseYamlDocument } from "yaml";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const library = path.join(root, "..", "library");
const dist = path.join(root, "dist");
const repository = "https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist";
const maxFiles = 35;
const inlineLimit = 400 * 1024;
// 只跳过操作系统生成的垃圾文件：技能目录里的 .gitkeep 之类的占位文件要跟着一起发布，
// 否则空目录（references/、agents/）在 skills-dist 分支上会消失。
const ignoredFiles = new Set([".DS_Store", "Thumbs.db"]);

const slugs = (await readdir(library, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => entry.name)
    .sort();
if (!slugs.length) throw new Error(`技能库为空：${library}`);

await rm(dist, { recursive: true, force: true });

const records = [];
for (const slug of slugs) {
    const source = path.join(library, slug);
    const files = (await listFiles(source)).sort();
    if (!files.includes("SKILL.md")) throw new Error(`技能 ${slug} 缺少 SKILL.md`);
    if (files.length > maxFiles) throw new Error(`技能 ${slug} 含 ${files.length} 个文件，超过 ${maxFiles} 个上限`);

    const frontMatter = parseFrontMatter(await readFile(path.join(source, "SKILL.md"), "utf8"));
    const meta = files.includes("meta.yaml") ? parseYamlBlock(await readFile(path.join(source, "meta.yaml"), "utf8")) : {};
    const manifest = [];
    let bytes = 0;
    for (const relative of files) {
        const body = await readFile(path.join(source, relative));
        const target = path.join(dist, "skills", slug, relative);
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, body);
        bytes += body.byteLength;
        manifest.push({ path: relative, bytes: body.byteLength, sha256: createHash("sha256").update(body).digest("hex") });
    }

    const nameEn = readText(meta["tag-en"]);
    const descriptionEn = readText(meta["summary-en"]) ?? readText(frontMatter["summary-en"]);
    const coverUrl = readMediaUrl(meta.cover);
    const showcase = readMediaUrls(meta.showcase);
    const structuredInfo = readStructuredInfo(meta["structured-info"]);
    const licensed = files.some((relative) => /^LICENSE(\.|$)/iu.test(relative));
    const baseUrl = `${repository}/skills/${slug}/`;
    records.push({
        id: slug,
        name: readText(meta["display-name-zh"]) ?? readText(frontMatter["display-name-zh"]) ?? readText(frontMatter.name) ?? slug,
        ...(nameEn ? { nameEn } : {}),
        version: readText(meta.version) ?? readText(frontMatter.version) ?? "1.0.0",
        description: readText(meta["summary-cn"]) ?? readText(frontMatter["summary-cn"]) ?? firstSentence(frontMatter.description),
        ...(descriptionEn ? { descriptionEn } : {}),
        author: readText(meta["author-en"]) ?? readText(meta["author-cn"]) ?? "unknown",
        source: normalizeSource(meta.source),
        tags: {
            zh: readTags(meta["complete-tags-cn"] ?? meta["tag-cn"] ?? frontMatter["tags-cn"]),
            en: readTags(meta["complete-tags-en"] ?? meta["tag-en"] ?? frontMatter.tags),
        },
        triggerWords: readTriggerWords(frontMatter["trigger-words"]),
        ...(coverUrl ? { coverUrl } : {}),
        ...(showcase.length ? { showcase } : {}),
        ...(structuredInfo ? { structuredInfo } : {}),
        entry: "SKILL.md",
        baseUrl,
        fileCount: manifest.length,
        bytes,
        files: manifest,
        ...(licensed ? { license: "见各技能目录内 LICENSE（如有）" } : {}),
    });
}

const updatedAt = new Date().toISOString();
const header = { schemaVersion: 2, updatedAt, source: { label: "MiniMax Hub", note: "官方与社区作者技能，作者信息见各条目" } };
const inline = `${JSON.stringify({ ...header, skills: records }, null, 2)}\n`;
const useManifests = Buffer.byteLength(inline) > inlineLimit;
let skills = records;
if (useManifests) {
    skills = [];
    for (const record of records) {
        const { files, license, ...rest } = record;
        const target = path.join(dist, "skills", record.id, "skill.json");
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, `${JSON.stringify({ schemaVersion: 2, id: record.id, entry: record.entry, baseUrl: record.baseUrl, fileCount: record.fileCount, bytes: record.bytes, files }, null, 2)}\n`);
        skills.push({ ...rest, manifestUrl: `${record.baseUrl}skill.json`, ...(license ? { license } : {}) });
    }
}

const output = `${JSON.stringify({ ...header, skills }, null, 2)}\n`;
await writeFile(path.join(dist, "official-skills.json"), output);
console.log(
    `官方 Skills 注册表：${skills.length} 个技能，${skills.reduce((total, skill) => total + skill.fileCount, 0)} 个文件，索引 ${(Buffer.byteLength(output) / 1024).toFixed(1)} KB，` +
        (useManifests ? "条目 files 已拆分为 skills/<slug>/skill.json（manifestUrl）" : "条目 files 内联在索引中"),
);

async function listFiles(directory, prefix = "") {
    const files = [];
    for (const entry of await readdir(directory, { withFileTypes: true })) {
        if (ignoredFiles.has(entry.name)) continue;
        const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
        if (entry.isDirectory()) files.push(...(await listFiles(path.join(directory, entry.name), relative)));
        else if (entry.isFile()) files.push(relative);
    }
    return files;
}

function parseFrontMatter(markdown) {
    const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/u.exec(markdown.replace(/^\uFEFF/u, ""));
    return match ? parseYamlBlock(match[1]) : {};
}

/**
 * 元数据解析交给成熟 YAML 库：meta.yaml 里存在多行折叠标量（summary-en/desc-cn 换行续写）
 * 与块标量，手写解析器会在续行处中断，导致后续 author/source 字段整段丢失
 * （design-after-effects 就这么丢过署名）。failsafe schema 保证标量按原文读取，不猜类型。
 */
function parseYamlBlock(source) {
    return parseYamlDocument(String(source), { schema: "failsafe" }) ?? {};
}

function readText(value) {
    if (typeof value !== "string") return undefined;
    const text = value.trim();
    if (!text || text === "~" || text.toLowerCase() === "null") return undefined;
    return text;
}

function readTags(value) {
    const items = Array.isArray(value) ? value : typeof value === "string" ? [value] : [];
    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function readTriggerWords(value) {
    const items = Array.isArray(value) ? value : typeof value === "string" ? value.split(/[,，、;；\n]/u) : [];
    return [...new Set(items.map((item) => String(item).trim()).filter(Boolean))];
}

function readMediaUrl(value) {
    const text = readText(value);
    if (!text) return undefined;
    try {
        const url = new URL(text);
        if (url.protocol !== "https:" || !["cdn.hailuoai.com", "cdn.hailuoai.video"].includes(url.hostname)) return undefined;
        if (!/\.(mp4|webm|mov|gif|png|jpe?g|webp|jfif)$/iu.test(url.pathname)) return undefined;
        url.search = "";
        url.hash = "";
        return url.href;
    } catch {
        return undefined;
    }
}

function readMediaUrls(value) {
    const values = Array.isArray(value) ? value : value ? [value] : [];
    return [...new Set(values.map(readMediaUrl).filter(Boolean))];
}

function readStructuredInfo(value) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
    const result = {};
    for (const [locale, raw] of Object.entries(value)) {
        if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
        const summary = readText(raw.summary);
        const bestFor = readTags(raw["best-for"] ?? raw.bestFor ?? raw.best_for);
        const howToUse = readText(raw["how-to-use"] ?? raw.howToUse ?? raw.how_to_use);
        const outputs = readText(raw.outputs);
        if (summary || bestFor.length || howToUse || outputs) result[locale] = { ...(summary ? { summary } : {}), ...(bestFor.length ? { bestFor } : {}), ...(howToUse ? { howToUse } : {}), ...(outputs ? { outputs } : {}) };
    }
    return Object.keys(result).length ? result : undefined;
}

function firstSentence(value) {
    const text = readText(value);
    if (!text) return "";
    const collapsed = text.replace(/\s+/gu, " ").trim();
    return (/^(.+?[。！？!?])(?:\s|$)/u.exec(collapsed)?.[1] ?? collapsed).trim();
}

function normalizeSource(value) {
    const text = readText(value)?.toLowerCase() ?? "";
    if (text.includes("featured")) return "official-featured";
    if (text.includes("community")) return "community";
    if (text.includes("official")) return "official";
    return "unknown";
}
