import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import test from "node:test";

import {
    ALL,
    SKILL_CATEGORIES,
    UNCATEGORIZED,
    catalogSource,
    fileBadgeCount,
    filterCatalog,
    groupBySource,
    matchesKeyword,
    normalizeSkillCategory,
    skillAuthor,
    skillAuthorLabel,
    skillCategoryLabel,
    skillDownloads,
    skillFiles,
    skillFileGroups,
    skillName,
    skillSource,
    skillSourceLabel,
    skillShowcase,
    skillStructured,
    skillSummary,
    sortCatalog,
    stripLocalPaths,
} from "../src/components/skills/skill-catalog.ts";
import { translate } from "../src/lib/i18n.ts";

const SOURCES = ["official-featured", "official", "community", "unknown"] as const;
const CHINESE_ONLY = /[\u4e00-\u9fff]/u;

/** 真实注册表里出现过的全部 tag-cn 取值（53 个），归一表必须全部有归属。 */
const REAL_TAGS = [
    "创意实验 / 创作生成",
    "动画 / 创作生成",
    "商业广告 / 创作生成",
    "电商 / 创作生成",
    "创意实验 / 后期处理",
    "专业影视 / 成片制作",
    "音频音乐 / 创作生成",
    "商业广告 / 成片制作",
    "短剧漫剧 / 创作生成",
    "教育 / 创作生成",
    "视频",
    "商业广告 / 计划制定",
    "平台工具",
    "专业影视 / 创作生成",
    "短剧漫剧 / 计划制定",
    "动画 / 计划制定",
    "动画 / 成片制作",
    "专业影视 / 意图脑爆",
    "图片",
    "教育 / 计划制定",
    "动画 / 后期处理",
    "播客",
    "喜剧",
    "动物",
    "AI视频",
    "商业广告 / 后期处理",
    "导出",
    "剪映",
    "CapCut",
    "音频音乐 / 成片制作",
    "电商",
    "广告",
    "教育 / 成片制作",
    "短剧漫剧 / 后期处理",
    "电商 / 成片制作",
    "创意",
    "风格迁移",
    "混搭",
    "设计",
    "教育 / 意图脑爆",
    "教育 / 后期处理",
    "专业影视 / 计划制定",
    "音频音乐 / 计划制定",
    "营销",
    "推广",
    "流程",
    "文字",
    "编剧",
    "剧情",
    "写作",
    "音频音乐 / 后期处理",
    "创意实验 / 成片制作",
    "创意实验 / 计划制定",
];

/** 注册表 v2 条目；字段名按 v2 契约，缺字段时用 undefined 兜底。 */
function entry(overrides: Record<string, unknown> = {}) {
    return {
        id: "sample-skill",
        name: "示例技能",
        version: "1.0.0",
        description: "一句话简介",
        entry: "SKILL.md",
        files: [],
        catalogSource: "official",
        capabilities: [],
        tags: ["创意实验 / 创作生成"],
        triggerWords: [],
        ...overrides,
    } as never;
}

const item = (overrides: Record<string, unknown> = {}) => ({ entry: entry(overrides) });
const installedSkill = (overrides: Record<string, unknown> = {}) =>
    ({
        id: "sample-skill",
        name: "示例技能",
        version: "1.0.0",
        description: "一句话简介",
        body: "# 正文",
        capabilities: [],
        tags: [],
        source: "registry",
        enabled: true,
        priority: 10,
        installedAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
    }) as never;

function readRegistry() {
    const artifact = new URL("../../skills/registry/dist/official-skills.json", import.meta.url);
    const fromEnv = process.env.SKILLS_REGISTRY_JSON ? new URL("file://" + process.env.SKILLS_REGISTRY_JSON) : null;
    const path = fromEnv && existsSync(fromEnv) ? fromEnv : existsSync(artifact) ? artifact : null;
    if (!path) return null;
    const raw = JSON.parse(readFileSync(path, "utf8"));
    if (raw.schemaVersion !== 2 || !Array.isArray(raw.skills)) return null;
    return (raw.skills as Record<string, unknown>[]).map((value) => ({ entry: value as never }));
}

test("一级分组按来源，官方精选 / 官方 / 社区 / 来源未知各成一组并带数量", () => {
    const items = [item({ id: "a", source: "official-featured" }), item({ id: "b", source: "official" }), item({ id: "c", source: "community" }), item({ id: "d", source: "unknown" })];
    const groups = groupBySource(items);

    assert.deepEqual(
        groups.map((group) => [group.label, group.items.length]),
        [
            ["官方精选", 1],
            ["官方", 1],
            ["社区", 1],
            ["来源未知", 1],
        ],
    );
    assert.equal(groups.flatMap((group) => group.items).length, items.length);
    assert.equal(translate("en-US", "官方精选"), "Official featured");
    assert.equal(translate("en-US", "社区"), "Community");
    assert.equal(translate("en-US", "来源未知"), "Unknown source");
});

test("来源 unknown 不会冒充官方，缺失来源也归入来源未知", () => {
    const unknown = item({ source: "unknown" });
    const missing = item({ source: undefined, catalogSource: undefined });
    const community = item({ source: "community" });
    const legacyOfficial = item({ source: undefined, catalogSource: "official" });
    const legacyAuthor = item({ source: undefined, catalogSource: "author" });

    assert.equal(skillSource(unknown), "unknown");
    assert.equal(skillSourceLabel(unknown), "来源未知");
    assert.equal(translate("en-US", skillSourceLabel(unknown)), "Unknown source");
    assert.notEqual(translate("en-US", skillSourceLabel(unknown)), translate("en-US", "官方"));
    assert.equal(skillSource(missing), "unknown");
    assert.equal(skillSource(community), "community");
    assert.equal(skillSourceLabel(community), "社区");
    // 视图桶与署名来源是两件事：社区/来源未知仍在官方目录下，但标签必须写清真实来源。
    assert.equal(catalogSource(unknown), "official");
    assert.equal(skillSourceLabel(legacyOfficial), "官方");
    assert.equal(skillSource(legacyAuthor), "author");
    assert.equal(skillSourceLabel(legacyAuthor), "作者私藏");
    assert.equal(catalogSource(legacyAuthor), "author");
});

test("来源/作者旧字段兜底，安装渠道 source=registry 不被当作署名来源", () => {
    const registryInstalled = { entry: null, installed: installedSkill({ source: "registry", catalogSource: undefined, publisher: "MiniMax Design" }) };
    const authorInstalled = { entry: null, installed: installedSkill({ source: "registry", catalogSource: "author" }) };
    const personal = { entry: null, installed: installedSkill({ source: "personal" }) };

    assert.equal(skillSource(registryInstalled), "unknown");
    assert.equal(skillSource(authorInstalled), "author");
    assert.equal(skillSource(personal), "personal");
    assert.equal(skillAuthor(registryInstalled), "MiniMax Design");
    assert.equal(skillAuthorLabel(item({ author: "unknown" })), "未署名");
    assert.equal(skillAuthorLabel(item({ author: "  Kido G  " })), "Kido G");
});

test("分类归一表覆盖真实注册表的全部 tag 值，并收敛到 9 个顶层分类", () => {
    // 纯描述性标签不单独决定分类，它们所在技能由「播客」「视频」等标签决定。
    const DESCRIPTIVE_TAGS = ["动物", "喜剧"];
    for (const tag of REAL_TAGS) {
        const category = normalizeSkillCategory([tag]);
        if (DESCRIPTIVE_TAGS.includes(tag)) {
            assert.equal(category, "", "描述性标签不应单独定类：" + tag);
            continue;
        }
        assert.ok(category, "未归一的标签：" + tag);
        assert.ok((SKILL_CATEGORIES as readonly string[]).includes(category), tag + " 落到了分类表外：" + category);
    }
    assert.equal(normalizeSkillCategory(["视频", "播客", "喜剧", "动物", "AI视频"]), "音频");
    // 提案 §4.5 的合并规则：视频并入专业影视、短剧并入短剧漫剧、音频音乐/音频内容并入音频、电商并入商业广告。
    assert.equal(normalizeSkillCategory(["专业影视 / 成片制作"]), "专业影视");
    assert.equal(normalizeSkillCategory(["视频"]), "专业影视");
    assert.equal(normalizeSkillCategory(["短剧"]), "短剧漫剧");
    assert.equal(normalizeSkillCategory(["音频内容 / 创作生成"]), "音频");
    assert.equal(normalizeSkillCategory(["电商 / 创作生成"]), "商业广告");
    assert.equal(normalizeSkillCategory(["视觉创作 / 创作生成"]), "视觉创作");
    // 父级标签优先于裸标签，裸标签按语义优先级兜底。
    assert.equal(normalizeSkillCategory(["动画 / 创作生成", "视频"]), "动画");
    assert.equal(normalizeSkillCategory(["剪映", "视频"]), "平台工具");
    assert.equal(normalizeSkillCategory(["营销", "流程"]), "商业广告");
    assert.equal(normalizeSkillCategory([]), "");
    assert.equal(skillCategoryLabel(item({ tags: [] })), UNCATEGORIZED);
    assert.equal(translate("en-US", UNCATEGORIZED), "Uncategorized");
});

// 技能条数不写死：注册表增删技能是正常操作，写死会让每次增删都变成"测试失败"。
// 真正要守住的是「注册表里的每一条都必须落到某个来源分组与某个分类里，没有黑洞」。
test("注册表里的每条技能都落到来源分组与 9 个分类里，没有黑洞", () => {
    const items = readRegistry();
    if (!items) return;

    assert.ok(items.length >= 80, `注册表条目太少（${items.length}），可能构建失败`);
    const groups = groupBySource(items);
    // 四个来源各成一组，且顺序固定；数量加总必须等于注册表条目数（没有条目被分组丢掉）。
    assert.deepEqual(
        groups.map((group) => group.label),
        ["官方精选", "官方", "社区", "来源未知"],
    );
    assert.equal(groups.flatMap((group) => group.items).length, items.length);
    // 收录时各来源的构成：官方精选 42 / 官方 20 / 社区 16 / 来源未知 6（移除 control-in-app-browser 后官方 19）。
    assert.deepEqual(
        Object.fromEntries(groups.map((group) => [group.label, group.items.length])),
        { 官方精选: 42, 官方: 19, 社区: 16, 来源未知: 6 },
    );

    const uncategorized = items.filter((candidate) => skillCategoryLabel(candidate) === UNCATEGORIZED);
    assert.equal(uncategorized.length, 0, "存在无分类条目：" + uncategorized.map((candidate) => candidate.entry!.id).join(","));

    const counts = new Map<string, number>();
    for (const candidate of items) counts.set(skillCategoryLabel(candidate), (counts.get(skillCategoryLabel(candidate)) || 0) + 1);
    assert.equal(
        [...counts.values()].reduce((total, value) => total + value, 0),
        items.length,
    );
    assert.equal(counts.size, 9);

    for (const candidate of items) {
        const id = candidate.entry!.id;
        assert.ok(skillName(candidate, "zh-CN"), id + " 缺中文名");
        assert.ok(skillSummary(candidate, "zh-CN"), id + " 缺简介");
        assert.ok(matchesKeyword(candidate, id), id + " 搜不到自己的 slug");
        assert.ok(matchesKeyword(candidate, skillName(candidate, "zh-CN")), id + " 搜不到自己的名称");
    }

    // MiniMax Design 是最大的一组作者，按作者搜索必须能全部命中（移除 control-in-app-browser 后 59 条）。
    assert.equal(items.filter((candidate) => matchesKeyword(candidate, "minimax design")).length, 59);
    assert.equal(items.filter((candidate) => matchesKeyword(candidate, "kido g")).length, 10);

    const single = items.filter((candidate) => !fileBadgeCount(candidate)).length;
    const multi = items.filter((candidate) => fileBadgeCount(candidate) > 0).length;
    assert.deepEqual([single, multi], [37, 46]);
    for (const candidate of items) {
        const files = skillFiles(candidate);
        assert.ok(files.length, candidate.entry!.id + " 缺文件清单");
        assert.equal(files.filter((file) => file.isEntry).length, 1, candidate.entry!.id + " 的入口文件不是唯一");
        assert.equal(files.find((file) => file.isEntry)!.path, "SKILL.md");
        assert.ok(
            files.every((file) => !file.path.startsWith("/") && !file.path.includes("..")),
            candidate.entry!.id + " 出现不安全路径",
        );
        // 目录里可能有 .gitkeep 这类 0 字节占位文件，入口文件必须有内容。
        assert.ok(
            files.every((file) => file.bytes >= 0),
            candidate.entry!.id + " 出现负数文件长度",
        );
        assert.ok(files.find((file) => file.isEntry)!.bytes > 0, candidate.entry!.id + " 的入口文件是空的");
    }

    const categorized = filterCatalog(items, { view: "official", keyword: "", filters: { category: ALL, author: ALL, tag: ALL, status: "all", content: "all", metadata: "all" }, sort: "recommended", language: "zh-CN" });
    // 无筛选时必须一条不漏（等于注册表条目数），且前 42 条都是官方精选（推荐排序按来源权重）。
    assert.equal(categorized.length, items.length);
    assert.deepEqual(
        categorized.slice(0, 42).every((candidate) => skillSource(candidate) === "official-featured"),
        true,
    );
});

test("搜索覆盖 slug、中英名称、简介、作者与标签，中文允许拆词命中", () => {
    const sample = item({
        id: "houdini-workflow",
        name: "Houdini 程序化工作流",
        nameEn: "Houdini Procedural Workflow",
        description: "用程序化节点搭建特效工作流",
        descriptionEn: "Build procedural FX workflows",
        author: "Kido G",
        tags: { zh: ["创意实验 / 创作生成"], en: ["Creative experiments / Creation"] },
    });

    for (const keyword of ["houdini-workflow", "程序化", "procedural", "特效", "kido", "创意实验", "creative experiments"]) {
        assert.ok(matchesKeyword(sample, keyword), "搜索未命中：" + keyword);
    }
    assert.ok(matchesKeyword(sample, "程序化 工作流"), "中文拆词未命中");
    assert.ok(matchesKeyword(sample, "houdini workflow"), "英文拆词未命中");
    assert.ok(!matchesKeyword(sample, "不存在的关键词"));
    assert.ok(matchesKeyword(sample, ""));
});

test("排序与筛选：推荐顺序按来源权重，其余维度只做筛选条件", () => {
    const items = [item({ id: "c", source: "community", name: "C" }), item({ id: "f", source: "official-featured", name: "F" }), item({ id: "o", source: "official", name: "O" })];
    assert.deepEqual(
        sortCatalog(items, "recommended", "zh-CN").map((candidate) => candidate.entry!.id),
        ["f", "o", "c"],
    );

    const withFiles = item({
        id: "multi",
        fileCount: 3,
        files: [
            { path: "SKILL.md", bytes: 10 },
            { path: "references/a.md", bytes: 20 },
            { path: "scripts/b.sh", bytes: 30 },
        ],
    });
    const base = { category: ALL, author: ALL, tag: ALL, status: "all", content: "all", metadata: "all" } as const;
    const run = (filters: Partial<typeof base>) => filterCatalog([withFiles], { view: "official", keyword: "", filters: { ...base, ...filters }, sort: "recommended", language: "zh-CN" }).length;

    assert.equal(run({}), 1);
    assert.equal(run({ content: "single" }), 0);
    assert.equal(run({ content: "references" }), 1);
    assert.equal(run({ content: "scripts" }), 1);
    assert.equal(run({ content: "tests" }), 0);
    assert.equal(run({ author: "未署名" }), 1);
    assert.equal(run({ author: "MiniMax Design" }), 0);
    assert.equal(run({ category: "创意实验" }), 1);
    assert.equal(run({ category: "动画" }), 0);
    assert.equal(run({ tag: "创作生成" }), 1);
    assert.equal(run({ metadata: "complete" }), 0);
    assert.equal(run({ metadata: "incomplete" }), 1);
});

test("多文件技能详情给出 path + 大小，SKILL.md 标为入口，meta.yaml 不计入内容文件", () => {
    const multi = item({
        fileCount: 3,
        files: [
            { path: "SKILL.md", bytes: 8542 },
            { path: "meta.yaml", bytes: 2940 },
            { path: "references/qc-checklist.md", bytes: 12246 },
        ],
    });

    assert.deepEqual(
        skillFiles(multi).map((file) => [file.path, file.bytes, file.isEntry]),
        [
            ["SKILL.md", 8542, true],
            ["references/qc-checklist.md", 12246, false],
        ],
    );
    assert.equal(fileBadgeCount(multi), 2);
    assert.deepEqual(
        skillFileGroups(multi).map((group) => [group.dir, group.files.length, group.bytes]),
        [
            ["", 1, 8542],
            ["references", 1, 12246],
        ],
    );

    const single = item({
        files: [
            { path: "SKILL.md", bytes: 100 },
            { path: "meta.yaml", bytes: 10 },
        ],
    });
    assert.equal(fileBadgeCount(single), 0);

    // 已安装技能用文件正文估算字节数。
    const installed = { entry: entry({ files: undefined, fileCount: undefined }), installed: installedSkill({ files: [{ path: "SKILL.md", content: "abc" }], body: "abc" }) };
    assert.deepEqual(
        skillFiles(installed).map((file) => [file.path, file.bytes, file.isEntry]),
        [["SKILL.md", 3, true]],
    );

    // 只有 body 的历史数据仍能给出入口文件。
    const legacy = { entry: null, installed: installedSkill({ body: "abcd", files: undefined }) };
    assert.deepEqual(
        skillFiles(legacy).map((file) => [file.path, file.bytes, file.isEntry]),
        [["SKILL.md", 4, true]],
    );
});

test("正文渲染前过滤本机绝对路径，公网地址保持原样", () => {
    const body = "读取 /Users/alice/.hub/skills/x.md 和 file:///Users/alice/skills/y.md，还有 C:\\Users\\bob\\z.md、\\\\server\\share\\a.md，参考 /home/carol/notes.md。";
    const cleaned = stripLocalPaths(body, "[隐藏]");

    assert.doesNotMatch(cleaned, /Users|alice|bob|carol|home|server/iu);
    assert.equal((cleaned.match(/\[隐藏\]/gu) || []).length, 5);
    assert.equal(stripLocalPaths("见 https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist/x.md", "[隐藏]"), "见 https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist/x.md");
    assert.equal(stripLocalPaths("- /Users/x/a.md", "[隐藏]"), "- [隐藏]");
});

test("结构化介绍缺失时整段不渲染，存在时按语言取值", () => {
    assert.equal(skillStructured(item({ structuredInfo: undefined }), "zh-CN"), null);
    const structured = item({ structuredInfo: { "zh-CN": { summary: "这是什么", "best-for": ["商业广告"], "how-to-use": "照做", outputs: "成片" } } });
    assert.deepEqual(skillStructured(structured, "zh-CN"), { summary: "这是什么", bestFor: ["商业广告"], howToUse: "照做", outputs: "成片" });
    assert.deepEqual(skillStructured(structured, "en-US"), { summary: "这是什么", bestFor: ["商业广告"], howToUse: "照做", outputs: "成片" });
});

test("详情预览合并封面与案例并去重，使用次数只接受非负数", () => {
    const preview = item({ coverUrl: "https://cdn.hailuoai.com/cover.mp4", showcase: ["https://cdn.hailuoai.com/cover.mp4", "https://cdn.hailuoai.video/demo.webp"], downloads: 12743.8 });
    assert.deepEqual(skillShowcase(preview), ["https://cdn.hailuoai.com/cover.mp4", "https://cdn.hailuoai.video/demo.webp"]);
    assert.equal(skillDownloads(preview), 12743);
    assert.equal(skillDownloads(item({ downloads: -1 })), undefined);
    assert.deepEqual(skillShowcase(item({ coverUrl: undefined, showcase: undefined })), []);
});

test("英文界面缺英文元数据时回退原文，不翻译用户内容", () => {
    const withoutEnglish = item({ nameEn: undefined, descriptionEn: undefined });
    const withEnglish = item({ nameEn: "Sample Skill", descriptionEn: "Sample summary" });

    assert.equal(skillName(withoutEnglish, "en-US"), "示例技能");
    assert.equal(skillName(withEnglish, "en-US"), "Sample Skill");
    assert.equal(skillSummary(withoutEnglish, "en-US"), "一句话简介");
    assert.equal(skillSummary(withEnglish, "en-US"), "Sample summary");
    assert.ok(CHINESE_ONLY.test(skillName(withoutEnglish, "en-US")));
});

test("技能界面用到的 i18n key 全部有英文对照，终端相关 key 已移除", () => {
    const dir = new URL("../src/components/skills/", import.meta.url);
    const keys = new Set<string>();
    for (const file of readdirSync(dir)) {
        if (!file.endsWith(".tsx")) continue;
        const source = readFileSync(new URL(file, dir), "utf8");
        for (const match of source.matchAll(/\bt\("([^"]+)"\)/gu)) keys.add(match[1]);
    }
    for (const label of [
        ...SKILL_CATEGORIES,
        UNCATEGORIZED,
        "官方精选",
        "社区",
        "来源未知",
        "作者私藏",
        "我的",
        "全部",
        "已安装",
        "已启用",
        "未启用",
        "单文件",
        "含参考文档",
        "含脚本",
        "含测试",
        "元数据完整",
        "元数据不全",
        "推荐",
        "按名称",
        "按版本",
        "按最近更新",
        "按文件数",
        "来源",
        "分类",
        "筛选",
        "作者",
        "标签",
        "启用状态",
        "内容形态",
        "元数据",
        "更多筛选",
        "排序",
    ]) {
        keys.add(label);
    }

    assert.ok(keys.size > 20);
    for (const key of keys) assert.notEqual(translate("en-US", key), key, "缺少英文对照：" + key);

    const catalog = readFileSync(new URL("../src/components/skills/skills-manager.tsx", import.meta.url), "utf8");
    const i18n = readFileSync(new URL("../src/lib/i18n.ts", import.meta.url), "utf8");
    assert.match(catalog, /<Streamdown className="agent-streamdown text-sm">\{stripLocalPaths\(body, t\("（本机路径已隐藏）"\)\)\}<\/Streamdown>/u);
    assert.doesNotMatch(catalog, /"terminal"|终端可用/u);
    assert.doesNotMatch(i18n, /"终端可用"|"可在画布终端节点的设置中启用"/u);
});

test("技能管理界面保留既有契约：视图、来源筛选、作者备注与编辑器导出", () => {
    const source = readFileSync(new URL("../src/components/skills/skills-manager.tsx", import.meta.url), "utf8");

    assert.match(source, /type SkillsView = "official" \| "author" \| "personal"/u);
    assert.match(source, /options=\{\["官方", "作者私藏", "我的"\]\}/u);
    assert.match(source, /catalogSource\(item\) === view/u);
    assert.match(source, /暂时没有作者私藏/u);
    assert.match(source, /<AuthorNote note=\{entry\?\.authorNote \|\| installed\?\.authorNote\}/u);
    assert.match(source, /export \{ PersonalSkillEditorModal \}/u);
    assert.match(source, /groupBySource/u);
    assert.match(source, /updateAvailable=\{isUpdateAvailable\(item\)\}/u);
    // 安装 / 启停 / 排序 / 删除 / Zodiac 归属都还在。
    for (const action of ["onInstall", "onEnabledChange", "onOwnershipChange", "onMove", "onRemove", "检查更新", "导入", "新建"]) assert.match(source, new RegExp(action, "u"));
});

test("技能列表卡片从首屏展示封面，视频跳过黑色首帧并持续静音播放", () => {
    const source = readFileSync(new URL("../src/components/skills/skill-catalog-card.tsx", import.meta.url), "utf8");
    assert.match(source, /cover=\{/u);
    assert.match(source, /skillShowcase\(item\)\[0\]/u);
    assert.match(source, /<video[\s\S]*preload="metadata"/u);
    assert.match(source, /autoPlay/u);
    assert.match(source, /video\.currentTime = Math\.min\(1 \/ 30/u);
    assert.doesNotMatch(source, /onMouseLeave|\.pause\(\)/u);
});

test("署名来源不会被安装渠道吞掉，界面按 registrySource / entry.source 显示真实来源", () => {
    // 未安装：来源取注册表条目
    assert.equal(skillSource({ entry: { source: "community" } }), "community");
    assert.equal(skillSource({ entry: { source: "official-featured" } }), "official-featured");
    // 已安装：installed.source 是安装渠道 "registry"，必须回落到 registrySource 而不是算成官方
    assert.equal(skillSource({ installed: { source: "registry", registrySource: "community" } }), "community");
    assert.equal(skillSource({ installed: { source: "registry", registrySource: "unknown" } }), "unknown");
    // 作者私藏分区仍然走 catalogSource
    assert.equal(skillSource({ installed: { source: "registry", catalogSource: "author" } }), "author");
    // 数据里完全没有来源信息时才回落成「来源未知」，绝不默认官方
    assert.equal(skillSource({ installed: { source: "registry" } }), "unknown");
});
