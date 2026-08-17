export type SkillCapability = "workflow" | "writing" | "image" | "video" | "audio" | "terminal";
export type SkillCatalogSource = "official" | "author";

export type InstalledSkill = {
    id: string;
    name: string;
    version: string;
    description: string;
    authorNote?: string;
    body: string;
    capabilities: SkillCapability[];
    tags: string[];
    source: "built-in" | "registry" | "personal";
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

const BUILT_IN_DATE = "2026-07-30T00:00:00.000Z";

export const BUILT_IN_SKILLS: InstalledSkill[] = [
    {
        id: "wg.workflow-architect",
        name: "工作流架构师",
        version: "1.0.0",
        description: "把创作目标整理成可执行、可检查且不会重复产出的画布工作流。",
        capabilities: ["workflow", "terminal"],
        tags: ["工作流", "编排", "数据流"],
        source: "built-in",
        enabled: true,
        priority: 10,
        zodiacOnly: true,
        installedAt: BUILT_IN_DATE,
        updatedAt: BUILT_IN_DATE,
        body: `# 工作流架构师

先明确最终交付物，再从结果向前拆出必要步骤。动作使用配置节点或终端节点，数据使用文本、图片、视频或音频节点。

为需要重复执行的流程显式创建产物节点作为输出槽，并保证每条连线的输出类型能被下游接收。用户只是试做时，不预先制造多余分支。

编排完成前检查：入口是否清楚、每个动作是否有输入、预设输出是否唯一、最终产物是否可继续编辑。`,
    },
    {
        id: "wg.creative-director",
        name: "创意导演",
        version: "1.0.0",
        description: "在生成前建立方向、参考与取舍，让多模态资产保持一致。",
        capabilities: ["writing", "image", "video", "audio"],
        tags: ["创意", "视觉", "叙事"],
        source: "built-in",
        enabled: false,
        priority: 20,
        zodiacOnly: true,
        installedAt: BUILT_IN_DATE,
        updatedAt: BUILT_IN_DATE,
        body: `# 创意导演

开始生成前，用一句话锁定受众、情绪与最重要的视觉记忆点。只在会显著改变作品时追问。

把抽象方向翻译成可操作的内容：主体、环境、构图、光线、材质、镜头与节奏。多张图片或多段视频要共享一套连续性约束。

每轮结果只指出最影响目标的差距，并给出下一次可直接执行的修改。`,
    },
];

export function createPersonalSkill(seed?: Partial<InstalledSkill>): InstalledSkill {
    const now = new Date().toISOString();
    return {
        id: seed?.id || `personal.${crypto.randomUUID()}`,
        name: seed?.name || "未命名 Skill",
        version: seed?.version || "0.1.0",
        description: seed?.description || "",
        authorNote: seed?.authorNote,
        body: seed?.body || "# 使用方式\n\n写下这个 Skill 应当遵循的步骤。",
        capabilities: seed?.capabilities || ["workflow"],
        tags: seed?.tags || [],
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
