import type { AppLanguage } from "@/lib/i18n";
import type { InstalledSkill } from "@/services/skills/skill-presets";
import type { SkillRegistryEntry } from "@/services/skills/skill-registry";

/** 卡片与详情共用的条目：注册表条目和本地安装态至少有一个。 */
export type CatalogItem = { entry: SkillRegistryEntry | null; installed?: InstalledSkill };
export type SkillsView = "official" | "author" | "personal";
/** 署名来源；"unknown" 是「来源未知」，绝不兜底成官方。 */
export type SkillSourceKind = "official-featured" | "official" | "community" | "unknown" | "author" | "personal";
export type SkillSort = "recommended" | "name" | "version" | "updated" | "files";
export type SkillStatusFilter = "all" | "installed" | "enabled" | "disabled";
export type SkillContentFilter = "all" | "single" | "references" | "scripts" | "tests";
export type SkillMetadataFilter = "all" | "complete" | "incomplete";

export type SkillFilters = {
    category: string;
    author: string;
    tag: string;
    status: SkillStatusFilter;
    content: SkillContentFilter;
    metadata: SkillMetadataFilter;
};

export const ALL = "全部";
export const UNCATEGORIZED = "无分类";
export const NO_AUTHOR = "未署名";
export const ENTRY_FILE = "SKILL.md";

export const SOURCE_LABELS: Record<SkillSourceKind, string> = {
    "official-featured": "官方精选",
    official: "官方",
    community: "社区",
    unknown: "来源未知",
    author: "作者私藏",
    personal: "我的",
};

/** 一级分组顺序：先按可信度分官方精选 / 官方 / 社区 / 来源未知，再看作者私藏与我的。 */
export const SOURCE_ORDER: SkillSourceKind[] = ["official-featured", "official", "community", "unknown", "author", "personal"];

/** 提案 §4.5 的归一表：原始 tag 值收敛到 9 个顶层分类。 */
export const SKILL_CATEGORIES = ["商业广告", "创意实验", "动画", "专业影视", "音频", "教育", "短剧漫剧", "平台工具", "视觉创作"] as const;

const CATEGORY_OF_TAG: Record<string, string> = {
    商业广告: "商业广告",
    电商: "商业广告",
    广告: "商业广告",
    营销: "商业广告",
    推广: "商业广告",
    带货: "商业广告",
    创意实验: "创意实验",
    创意: "创意实验",
    风格迁移: "创意实验",
    混搭: "创意实验",
    动画: "动画",
    专业影视: "专业影视",
    视频: "专业影视",
    AI视频: "专业影视",
    影视: "专业影视",
    音频: "音频",
    音频音乐: "音频",
    音频内容: "音频",
    播客: "音频",
    音乐: "音频",
    配音: "音频",
    教育: "教育",
    课程: "教育",
    教学: "教育",
    短剧漫剧: "短剧漫剧",
    短剧: "短剧漫剧",
    编剧: "短剧漫剧",
    剧情: "短剧漫剧",
    写作: "短剧漫剧",
    文字: "短剧漫剧",
    平台工具: "平台工具",
    工具: "平台工具",
    流程: "平台工具",
    剪映: "平台工具",
    CapCut: "平台工具",
    导出: "平台工具",
    视觉创作: "视觉创作",
    图片: "视觉创作",
    设计: "视觉创作",
};

/** 裸标签（没有 "父级 / 子级" 结构）按语义优先级兜底归类。 */
const FLAT_TAG_RULES: [string[], string][] = [
    [["平台工具", "工具", "剪映", "CapCut", "导出", "插件"], "平台工具"],
    [["电商", "广告", "营销", "推广", "带货", "品牌"], "商业广告"],
    [["短剧", "编剧", "剧情", "写作", "文字", "漫剧"], "短剧漫剧"],
    [["播客", "音频", "音乐", "配音", "语音", "声音"], "音频"],
    [["图片", "设计", "视觉", "海报", "风格迁移", "混搭"], "视觉创作"],
    [["视频", "AI视频", "影视", "镜头"], "专业影视"],
    [["课程", "教学", "教育", "知识"], "教育"],
    [["创意", "实验", "脑爆"], "创意实验"],
];

type Loose = Record<string, unknown>;

const loose = (value: unknown): Loose => (value && typeof value === "object" ? (value as Loose) : {});
const text = (value: unknown) => (typeof value === "string" && value.trim() ? value.trim() : undefined);
const list = (value: unknown) =>
    Array.isArray(value)
        ? value
              .map(String)
              .map((item) => item.trim())
              .filter(Boolean)
        : [];

/** 新字段优先、旧字段兜底：注册表 v2 与历史数据的差异只在这里消化。 */
function field(item: CatalogItem, key: string): unknown {
    const entry = loose(item.entry);
    if (entry[key] !== undefined && entry[key] !== null) return entry[key];
    return loose(item.installed)[key];
}

export function skillId(item: CatalogItem) {
    return text(item.entry?.id) || item.installed?.id || "";
}

export function skillVersion(item: CatalogItem) {
    return text(field(item, "version")) || item.installed?.version || "-";
}

export function skillName(item: CatalogItem, language: AppLanguage) {
    const zh = text(field(item, "name"));
    const en = text(field(item, "nameEn"));
    if (language === "en-US") return en || zh || skillId(item);
    return zh || en || skillId(item);
}

/** 另一种语言的名称，用于详情里并排显示；相同或缺失时返回空。 */
export function skillAltName(item: CatalogItem, language: AppLanguage) {
    const primary = skillName(item, language);
    const other = language === "en-US" ? text(field(item, "name")) : text(field(item, "nameEn"));
    return other && other !== primary ? other : undefined;
}

export function skillSummary(item: CatalogItem, language: AppLanguage) {
    const zh = text(field(item, "description")) || item.installed?.description;
    const en = text(field(item, "descriptionEn"));
    if (language === "en-US") return en || zh || "";
    return zh || en || "";
}

export function skillCoverUrl(item: CatalogItem) {
    return text(field(item, "coverUrl"));
}

export function skillShowcase(item: CatalogItem) {
    const cover = skillCoverUrl(item);
    const media = list(field(item, "showcase"));
    return [...new Set([cover, ...media].filter((url): url is string => Boolean(url)))];
}

export function skillDownloads(item: CatalogItem) {
    const count = Number(field(item, "downloads"));
    return Number.isFinite(count) && count >= 0 ? Math.floor(count) : undefined;
}

/** 英文界面缺英文元数据时给回退角标用。 */
export function hasEnglishMeta(item: CatalogItem) {
    return Boolean(text(field(item, "descriptionEn")) || text(field(item, "nameEn")));
}

const UNKNOWN_AUTHORS = new Set(["unknown", "未知", "n/a", "none", "-", "无"]);

export function skillAuthor(item: CatalogItem) {
    const raw = text(field(item, "author")) || text(field(item, "publisher"));
    if (!raw || UNKNOWN_AUTHORS.has(raw.toLocaleLowerCase())) return undefined;
    return raw;
}

export function skillAuthorLabel(item: CatalogItem) {
    return skillAuthor(item) || NO_AUTHOR;
}

/** 数据侧来源：官方精选 / 官方 / 社区 / 来源未知 / 作者私藏 / 我的。 */
export function skillSource(item: CatalogItem): SkillSourceKind {
    const entry = loose(item.entry);
    const installed = loose(item.installed);
    if (installed.source === "personal" || entry.source === "personal") return "personal";
    const entrySource = text(entry.source);
    if (entrySource && entrySource in SOURCE_LABELS) return entrySource as SkillSourceKind;
    // installed.source 的历史值 "registry" 表示安装渠道，不是署名来源，不能当来源用。
    const installedSource = text(installed.source);
    if (installedSource && installedSource in SOURCE_LABELS) return installedSource as SkillSourceKind;
    // 安装后 source 会被安装渠道（"registry"）占用，署名来源单独存在 registrySource。
    const installedRegistrySource = text(installed.registrySource);
    if (installedRegistrySource && installedRegistrySource in SOURCE_LABELS) return installedRegistrySource as SkillSourceKind;
    const catalogSource = text(entry.catalogSource) || text(installed.catalogSource);
    if (catalogSource === "author") return "author";
    if (catalogSource === "official") return "official";
    return "unknown";
}

/** 左栏「来源」视图桶：官方（含社区与来源未知）/ 作者私藏 / 我的。 */
export function catalogSource(item: CatalogItem): SkillsView {
    const source = skillSource(item);
    return source === "personal" ? "personal" : source === "author" ? "author" : "official";
}

export function skillSourceLabel(item: CatalogItem) {
    return SOURCE_LABELS[skillSource(item)];
}

export function skillTags(item: CatalogItem, language: AppLanguage): string[] {
    const tags = field(item, "tags");
    const flat = list(Array.isArray(tags) ? tags : undefined);
    const zh = list(loose(tags).zh);
    const en = list(loose(tags).en).length ? list(loose(tags).en) : list(field(item, "tagsEn"));
    const primary = language === "en-US" ? (en.length ? en : zh.length ? zh : flat) : zh.length ? zh : flat.length ? flat : en;
    return [...new Set(primary)];
}

/** 二级标签（"父级 / 子级" 的后半段）只做筛选。 */
export function skillSubTags(item: CatalogItem, language: AppLanguage) {
    return [
        ...new Set(
            skillTags(item, language)
                .map((tag) => tag.split("/").slice(1).join("/").trim())
                .filter(Boolean),
        ),
    ];
}

export function normalizeSkillCategory(tags: string[]): string {
    const normalized = tags.map((tag) => tag.trim()).filter(Boolean);
    for (const tag of normalized) {
        const [top, sub] = tag.split("/");
        if (!sub) continue;
        const mapped = CATEGORY_OF_TAG[top.trim()];
        if (mapped) return mapped;
    }
    for (const [keywords, category] of FLAT_TAG_RULES) {
        if (normalized.some((tag) => !tag.includes("/") && keywords.includes(tag))) return category;
    }
    for (const tag of normalized) {
        const mapped = CATEGORY_OF_TAG[tag];
        if (mapped) return mapped;
    }
    return "";
}

/** 归一后的顶层分类；返回空串表示「无分类」。 */
export function skillCategory(item: CatalogItem) {
    return normalizeSkillCategory(skillTags(item, "zh-CN"));
}

export function skillCategoryLabel(item: CatalogItem) {
    return skillCategory(item) || UNCATEGORIZED;
}

export function skillTriggerWords(item: CatalogItem) {
    return list(field(item, "triggerWords"));
}

export type SkillFileEntry = { path: string; bytes: number; isEntry: boolean };

export function skillEntryPath(item: CatalogItem) {
    return text(field(item, "entry")) || ENTRY_FILE;
}

/** 文件清单（path + 字节数）；安装态优先，未安装时用注册表索引里的字节数。 */
export function skillFiles(item: CatalogItem): SkillFileEntry[] {
    const entryPath = skillEntryPath(item);
    const installedFiles = Array.isArray(loose(item.installed).files) ? (loose(item.installed).files as unknown[]) : [];
    const files = installedFiles.length ? installedFiles : Array.isArray(loose(item.entry).files) ? (loose(item.entry).files as unknown[]) : [];
    const mapped = files
        .map((file) => {
            const record = loose(file);
            const path = text(record.path);
            if (!path) return null;
            const bytes = Number(record.bytes);
            return { path, bytes: Number.isFinite(bytes) && bytes > 0 ? bytes : utf8Bytes(text(record.content) || ""), isEntry: path === entryPath };
        })
        .filter((file): file is SkillFileEntry => Boolean(file))
        // meta.yaml 只是打包清单，不算技能内容，否则「含 N 个文件」几乎每张卡片都亮。
        .filter((file) => file.path !== "meta.yaml");
    if (mapped.length) return mapped;
    const body = item.installed?.body;
    return body ? [{ path: entryPath, bytes: utf8Bytes(body), isEntry: true }] : [];
}

export function skillFileCount(item: CatalogItem) {
    const declared = Number(field(item, "fileCount"));
    const files = skillFiles(item);
    return files.length || (Number.isFinite(declared) ? declared : 0);
}

export type SkillFileGroup = { dir: string; files: SkillFileEntry[]; bytes: number };

/** 按子目录分组，根目录文件排在最前；单文件技能也返回一组。 */
export function skillFileGroups(item: CatalogItem): SkillFileGroup[] {
    const groups = new Map<string, SkillFileEntry[]>();
    for (const file of skillFiles(item)) {
        const dir = file.path.includes("/") ? file.path.split("/")[0] : "";
        groups.set(dir, [...(groups.get(dir) || []), file]);
    }
    return [...groups.entries()].map(([dir, files]) => ({ dir, files, bytes: files.reduce((total, file) => total + file.bytes, 0) })).sort((a, b) => (a.dir ? (b.dir ? a.dir.localeCompare(b.dir) : 1) : -1));
}

export function hasSubdirectory(item: CatalogItem, dir: string) {
    return skillFiles(item).some((file) => file.path.startsWith(dir + "/"));
}

export function isMultiFileSkill(item: CatalogItem) {
    return skillFileCount(item) > 1;
}

/** 元数据不全 = 没有署名来源或没有作者或没有标签，界面要如实标注。 */
export function hasCompleteMeta(item: CatalogItem) {
    return skillSource(item) !== "unknown" && Boolean(skillAuthor(item)) && skillTags(item, "zh-CN").length > 0;
}

export function skillSearchText(item: CatalogItem) {
    return [
        skillId(item),
        skillName(item, "zh-CN"),
        skillName(item, "en-US"),
        text(field(item, "description")),
        text(field(item, "descriptionEn")),
        skillAuthor(item),
        ...skillTags(item, "zh-CN"),
        ...skillTags(item, "en-US"),
        ...skillTriggerWords(item),
        skillCategoryLabel(item),
    ]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase();
}

/** 搜索覆盖 id/slug、中英名称、中英简介、作者、标签与触发词；中文允许拆词命中。 */
export function matchesKeyword(item: CatalogItem, keyword: string) {
    const needle = keyword.trim().toLocaleLowerCase();
    if (!needle) return true;
    const haystack = skillSearchText(item);
    if (haystack.includes(needle)) return true;
    // 「工作流 架构师」要能命中「工作流架构师」，slug 的空格/连字符差别也一并忽略。
    const flatten = (value: string) => value.replace(/[\s\-_/]+/gu, "");
    return flatten(haystack).includes(flatten(needle));
}

export function matchesFilters(item: CatalogItem, filters: SkillFilters) {
    if (filters.category !== ALL && skillCategoryLabel(item) !== filters.category) return false;
    if (filters.author !== ALL && skillAuthorLabel(item) !== filters.author) return false;
    if (filters.tag !== ALL && !skillSubTags(item, "zh-CN").includes(filters.tag)) return false;
    const installed = item.installed;
    if (filters.status === "installed" && !installed) return false;
    if (filters.status === "enabled" && !installed?.enabled) return false;
    if (filters.status === "disabled" && (!installed || installed.enabled)) return false;
    if (filters.content === "single" && isMultiFileSkill(item)) return false;
    if (filters.content === "references" && !hasSubdirectory(item, "references")) return false;
    if (filters.content === "scripts" && !hasSubdirectory(item, "scripts")) return false;
    if (filters.content === "tests" && !hasSubdirectory(item, "tests")) return false;
    if (filters.metadata === "complete" && !hasCompleteMeta(item)) return false;
    if (filters.metadata === "incomplete" && hasCompleteMeta(item)) return false;
    return true;
}

const collators: Partial<Record<AppLanguage, Intl.Collator>> = {};

function nameCollator(language: AppLanguage) {
    if (!collators[language]) collators[language] = new Intl.Collator(language === "en-US" ? "en" : "zh-Hans-CN");
    return collators[language]!;
}

function compareVersions(left: string, right: string) {
    const segments = (value: string) =>
        value
            .split(/[^\d]+/u)
            .filter(Boolean)
            .map(Number);
    const a = segments(left);
    const b = segments(right);
    for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
        const diff = (b[index] || 0) - (a[index] || 0);
        if (diff) return diff;
    }
    return 0;
}

export function sortCatalog(items: CatalogItem[], sort: SkillSort, language: AppLanguage) {
    const collator = nameCollator(language);
    const byName = (left: CatalogItem, right: CatalogItem) => collator.compare(skillName(left, language), skillName(right, language));
    return [...items].sort((left, right) => {
        if (sort === "name") return byName(left, right);
        if (sort === "version") return compareVersions(skillVersion(left), skillVersion(right)) || byName(left, right);
        if (sort === "updated") return (Date.parse(right.installed?.updatedAt || "") || 0) - (Date.parse(left.installed?.updatedAt || "") || 0) || byName(left, right);
        if (sort === "files") return skillFileCount(right) - skillFileCount(left) || byName(left, right);
        return SOURCE_ORDER.indexOf(skillSource(left)) - SOURCE_ORDER.indexOf(skillSource(right)) || byName(left, right);
    });
}

export type CatalogGroup = { kind: SkillSourceKind; label: string; items: CatalogItem[] };

/** 一级分组按来源，只保留有内容的组。 */
export function groupBySource(items: CatalogItem[]): CatalogGroup[] {
    return SOURCE_ORDER.map((kind) => ({ kind, label: SOURCE_LABELS[kind], items: items.filter((item) => skillSource(item) === kind) })).filter((group) => group.items.length > 0);
}

export function filterCatalog(items: CatalogItem[], options: { view: SkillsView; keyword: string; filters: SkillFilters; sort: SkillSort; language: AppLanguage }) {
    return sortCatalog(
        items.filter((item) => catalogSource(item) === options.view && matchesFilters(item, options.filters) && matchesKeyword(item, options.keyword)),
        options.sort,
        options.language,
    );
}

export function utf8Bytes(value: string) {
    return new TextEncoder().encode(value).byteLength;
}

export function formatBytes(bytes: number) {
    if (bytes >= 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + " MB";
    if (bytes >= 1024) return (bytes / 1024).toFixed(1) + " KB";
    return bytes + " B";
}

/**
 * 本机绝对路径不能进入产品界面：/Users/、/home/、C:\、file:/// 这类片段
 * 在渲染正文前统一替换掉，保留其余 Markdown 原文。
 */
const LOCAL_PATH_PATTERNS = [
    /(?<![\w.:/])\/(?:Users|home|Volumes|private|root|opt|var|tmp)\/[A-Za-z0-9._~:/\\%@+=&#?$!-]+/gu,
    /file:\/\/\/[A-Za-z0-9._~:/\\%@+=&#?$!-]+/gu,
    /[A-Za-z]:\\[A-Za-z0-9._~:/\\%@+=&#?$!-]+/gu,
    /\\\\[A-Za-z0-9._~:/\\%@+=&#?$!-]+/gu,
];

export function stripLocalPaths(value: string, replacement: string) {
    return LOCAL_PATH_PATTERNS.reduce((text, pattern) => text.replace(pattern, replacement), value);
}

/** 「含 32 个文件」这类徽标只标多文件技能。 */
export function fileBadgeCount(item: CatalogItem) {
    return isMultiFileSkill(item) ? skillFileCount(item) : 0;
}

export type SkillStructured = { summary?: string; bestFor: string[]; howToUse?: string; outputs?: string };

/** 结构化介绍（meta.yaml 的 structured-info）；没有就返回 null，界面整段不渲染。 */
export function skillStructured(item: CatalogItem, language: AppLanguage): SkillStructured | null {
    const value = loose(field(item, "structuredInfo"));
    const localized = loose(value[language === "en-US" ? "en-US" : "zh-CN"]);
    const other = loose(value[language === "en-US" ? "zh-CN" : "en-US"]);
    const legacy = loose(value[language === "en-US" ? "zh" : "en"]);
    const source = [localized, other, legacy, value].find((candidate) => Object.keys(candidate).length) || value;
    const structured: SkillStructured = {
        summary: text(source.summary),
        bestFor: list(source.bestFor).length ? list(source.bestFor) : list(source["best-for"]),
        howToUse: text(source.howToUse) || text(source["how-to-use"]),
        outputs: text(source.outputs),
    };
    return structured.summary || structured.bestFor.length || structured.howToUse || structured.outputs ? structured : null;
}

/** 「查看来源」地址：注册表 homepage / 安装记录 sourceUrl / 技能包目录依次兜底。 */
export function skillSourceUrl(item: CatalogItem) {
    return text(field(item, "homepage")) || text(field(item, "sourceUrl")) || text(field(item, "baseUrl"));
}
