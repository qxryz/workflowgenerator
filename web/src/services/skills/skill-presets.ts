export type SkillCapability = "workflow" | "writing" | "image" | "video" | "audio" | "terminal";
export type SkillCatalogSource = "official" | "author";
/** 注册表清单里声明的署名来源。catalogSource 是「官方目录 / 作者私藏」的分区，两者不是一回事。 */
export type SkillRegistrySource = "official-featured" | "official" | "community" | "unknown";

/** 技能包里的一个文件。path 是技能目录下的 POSIX 相对路径。 */
export type SkillFile = {
    path: string;
    content: string;
};

export type InstalledSkill = {
    id: string;
    name: string;
    version: string;
    description: string;
    authorNote?: string;
    coverUrl?: string;
    showcase?: string[];
    downloads?: number;
    structuredInfo?: Record<string, { summary?: string; bestFor?: string[]; howToUse?: string; outputs?: string }>;
    /** 始终等于入口文件 SKILL.md 的正文；多文件技能同时把全部文件写进 files。 */
    body: string;
    /** 多文件技能的完整文件列表；单文件技能和旧数据没有这个字段。 */
    files?: SkillFile[];
    capabilities: SkillCapability[];
    tags: string[];
    /** 注册表条目的英文标签；旧数据和单文件技能没有。 */
    tagsEn?: string[];
    /** 注册表清单里的触发词：Zodiac 只把它们列进技能清单，不生成新词。 */
    triggerWords?: string[];
    source: "registry" | "personal";
    /** 注册表清单里声明的来源（官方精选 / 官方 / 社区 / 未知），必须原样保留用于署名展示。 */
    registrySource?: SkillRegistrySource;
    catalogSource?: SkillCatalogSource;
    sourceUrl?: string;
    homepage?: string;
    checksum?: string;
    publisher?: string;
    license?: string;
    category?: string;
    enabled: boolean;
    priority: number;
    /** Zodiac 专属技能：只供画布上的 Zodiac Agent 编排使用，不进入终端节点环境。 */
    zodiacOnly?: boolean;
    installedAt: string;
    updatedAt: string;
};

/**
 * 已经从应用中删除的内置技能。老用户的服务端数据里可能还存着这两个 id，
 * 合并持久化数据时必须剔除，不能让它们复活。
 */
const REMOVED_BUILT_IN_SKILL_IDS = ["wg.workflow-architect", "wg.creative-director"];

/** 合并持久化数据前清洗：无 id 的脏数据、已下线的内置技能和 open-design 历史条目都不保留。 */
export function pruneInstalledSkills(skills: InstalledSkill[] | undefined): InstalledSkill[] {
    return (skills || []).filter((skill) => Boolean(skill?.id) && !REMOVED_BUILT_IN_SKILL_IDS.includes(skill.id) && !skill.id.startsWith("open-design."));
}

export function createPersonalSkill(seed?: Partial<InstalledSkill>): InstalledSkill {
    const now = new Date().toISOString();
    return {
        id: seed?.id || `personal.${crypto.randomUUID()}`,
        name: seed?.name || "未命名 Skill",
        version: seed?.version || "0.1.0",
        description: seed?.description || "",
        authorNote: seed?.authorNote,
        body: seed?.body || "# 使用方式\n\n写下这个 Skill 应当遵循的步骤。",
        files: seed?.files,
        capabilities: seed?.capabilities || ["workflow"],
        tags: seed?.tags || [],
        triggerWords: seed?.triggerWords,
        source: seed?.source || "personal",
        catalogSource: seed?.catalogSource,
        sourceUrl: seed?.sourceUrl,
        homepage: seed?.homepage,
        checksum: seed?.checksum,
        publisher: seed?.publisher,
        license: seed?.license,
        category: seed?.category,
        enabled: seed?.enabled ?? true,
        priority: seed?.priority ?? 100,
        zodiacOnly: seed?.zodiacOnly,
        installedAt: seed?.installedAt || now,
        updatedAt: seed?.updatedAt || now,
    };
}
