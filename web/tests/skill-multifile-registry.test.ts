import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

import { assertSafeSkillFilePath, downloadRegistrySkill, parseSkillRegistry, type SkillRegistryFile } from "../src/services/skills/skill-registry.ts";
import { createPersonalSkill, pruneInstalledSkills } from "../src/services/skills/skill-presets.ts";

const INDEX_URL = "https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist/official-skills.json";
const SKILL_BODY = "# 示例技能\n\n按步骤执行。";
const REFERENCE = "# 参考\n\n补充说明。";

const sha256 = (value: string) => createHash("sha256").update(value, "utf8").digest("hex");
const fileMeta = (path: string, content: string): SkillRegistryFile => ({ path, bytes: Buffer.byteLength(content, "utf8"), sha256: sha256(content) });

function sampleRegistry(overrides: Record<string, unknown> = {}) {
    return {
        schemaVersion: 2,
        updatedAt: "2026-09-17T00:00:00.000Z",
        skills: [
            {
                id: "sample-skill",
                name: "示例技能",
                nameEn: "Sample Skill",
                version: "1.0.0",
                description: "示例",
                descriptionEn: "Sample",
                author: "MiniMax Design",
                source: "official-featured",
                tags: { zh: ["示例", "动画"], en: ["Sample"] },
                triggerWords: ["示例"],
                entry: "SKILL.md",
                fileCount: 2,
                bytes: 100,
                baseUrl: "https://cdn.example.com/skills/sample-skill/",
                files: [fileMeta("SKILL.md", SKILL_BODY), fileMeta("references/notes.md", REFERENCE)],
                ...overrides,
            },
        ],
    };
}

/** 只拦截下载请求，索引解析走真实实现。 */
function serveFiles(files: Record<string, string>) {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL) => {
        const url = String(input);
        if (!(url in files)) return new Response("not found", { status: 404 });
        return new Response(files[url], { status: 200 });
    }) as typeof fetch;
    return () => {
        globalThis.fetch = original;
    };
}

test("parses schemaVersion 2 multi-file skill packages", () => {
    const registry = parseSkillRegistry(JSON.parse(JSON.stringify(sampleRegistry())), INDEX_URL);
    const entry = registry.skills[0];

    assert.equal(registry.schemaVersion, 2);
    assert.deepEqual(
        entry.files.map((file) => file.path),
        ["SKILL.md", "references/notes.md"],
    );
    assert.equal(entry.entry, "SKILL.md");
    assert.equal(entry.contentUrl, "https://cdn.example.com/skills/sample-skill/SKILL.md");
    assert.equal(entry.sha256, sha256(SKILL_BODY));
    assert.equal(entry.publisher, "MiniMax Design");
    assert.deepEqual(entry.tags, ["示例", "动画"]);
    assert.deepEqual(entry.triggerWords, ["示例"]);
});

test("keeps trusted preview metadata and drops untrusted media URLs", () => {
    const structuredInfo = { "zh-CN": { summary: "把故事做成短片", bestFor: ["故事短片"], howToUse: "输入脚本", outputs: "视频" } };
    const registry = parseSkillRegistry(
        sampleRegistry({
            coverUrl: "https://cdn.hailuoai.com/cover.mp4?token=secret",
            showcase: ["https://cdn.hailuoai.video/demo.webp", "https://example.com/tracker.mp4"],
            downloads: 12743.8,
            structuredInfo,
        }),
        INDEX_URL,
    );
    const entry = registry.skills[0];

    assert.equal(entry.coverUrl, "https://cdn.hailuoai.com/cover.mp4");
    assert.deepEqual(entry.showcase, ["https://cdn.hailuoai.video/demo.webp"]);
    assert.equal(entry.downloads, 12743);
    assert.deepEqual(entry.structuredInfo, structuredInfo);

    const unsafe = parseSkillRegistry(sampleRegistry({ coverUrl: "http://cdn.hailuoai.com/cover.mp4", showcase: ["https://evil.example/demo.mp4"] }), INDEX_URL).skills[0];
    assert.equal(unsafe.coverUrl, undefined);
    assert.equal(unsafe.showcase, undefined);
});

test("resolves package files next to the index when baseUrl is missing", () => {
    const registry = parseSkillRegistry(sampleRegistry({ baseUrl: undefined }), INDEX_URL);
    assert.equal(registry.skills[0].contentUrl, "https://raw.githubusercontent.com/qxryz/wg-dist/skills-dist/skills/sample-skill/SKILL.md");
});

test("still parses schemaVersion 1 as a single SKILL.md package", async () => {
    const body = "# 旧技能";
    const legacy = {
        schemaVersion: 1,
        skills: [{ id: "wg.legacy", name: "旧技能", version: "1.0.0", description: "", contentUrl: "https://cdn.example.com/legacy.md", sha256: sha256(body), capabilities: ["workflow"], tags: ["旧"] }],
    };
    const registry = parseSkillRegistry(legacy, INDEX_URL);

    assert.equal(registry.schemaVersion, 1);
    assert.deepEqual(registry.skills[0].files, [{ path: "SKILL.md", sha256: sha256(body) }]);
    assert.equal(registry.skills[0].entry, "SKILL.md");

    const restore = serveFiles({ "https://cdn.example.com/legacy.md": body });
    try {
        const installed = await downloadRegistrySkill(registry.skills[0]);
        assert.equal(installed.body, body);
        assert.deepEqual(installed.files, [{ path: "SKILL.md", content: body }]);
    } finally {
        restore();
    }
});

test("installs every file and keeps body equal to the entry file", async () => {
    const registry = parseSkillRegistry(sampleRegistry(), INDEX_URL);
    assert.equal(registry.skills[0].source, "official-featured");
    const restore = serveFiles({
        "https://cdn.example.com/skills/sample-skill/SKILL.md": SKILL_BODY,
        "https://cdn.example.com/skills/sample-skill/references/notes.md": REFERENCE,
    });
    try {
        const installed = await downloadRegistrySkill(registry.skills[0]);
        assert.equal(installed.body, SKILL_BODY);
        assert.deepEqual(installed.files, [
            { path: "SKILL.md", content: SKILL_BODY },
            { path: "references/notes.md", content: REFERENCE },
        ]);
        assert.equal(installed.checksum, sha256(SKILL_BODY));
        assert.equal(installed.source, "registry");
        // 署名来源不能被安装渠道覆盖：source 记安装渠道，registrySource 记清单声明的来源。
        assert.equal(installed.registrySource, "official-featured");
    } finally {
        restore();
    }
});

test("stops the install and names the file whose sha256 does not match", async () => {
    const registry = parseSkillRegistry(sampleRegistry(), INDEX_URL);
    const restore = serveFiles({
        "https://cdn.example.com/skills/sample-skill/SKILL.md": SKILL_BODY,
        "https://cdn.example.com/skills/sample-skill/references/notes.md": REFERENCE.replace("。", "！"),
    });
    try {
        await assert.rejects(downloadRegistrySkill(registry.skills[0]), (error: Error) => error.message.includes("references/notes.md") && error.message.includes("校验失败，已停止安装"));
    } finally {
        restore();
    }
});

test("stops the install when a declared byte count does not match", async () => {
    const raw = sampleRegistry();
    raw.skills[0].files[1].bytes += 1;
    const registry = parseSkillRegistry(raw, INDEX_URL);
    const restore = serveFiles({
        "https://cdn.example.com/skills/sample-skill/SKILL.md": SKILL_BODY,
        "https://cdn.example.com/skills/sample-skill/references/notes.md": REFERENCE,
    });
    try {
        await assert.rejects(downloadRegistrySkill(registry.skills[0]), (error: Error) => error.message.includes("references/notes.md") && error.message.includes("字节数"));
    } finally {
        restore();
    }
});

test("names the failing file when its download fails", async () => {
    const registry = parseSkillRegistry(sampleRegistry(), INDEX_URL);
    const restore = serveFiles({ "https://cdn.example.com/skills/sample-skill/SKILL.md": SKILL_BODY });
    try {
        await assert.rejects(downloadRegistrySkill(registry.skills[0]), (error: Error) => error.message.includes("无法下载") && error.message.includes("references/notes.md") && error.message.includes("404"));
    } finally {
        restore();
    }
});

test("rejects unsafe, absolute, traversal and over-long file paths", () => {
    // 路径校验本身永远 fail-closed：不安全就抛错，绝不返回。
    const unsafe = ["../evil.md", "/etc/passwd", "references/../../evil.md", "a\\b.md", "", "   ", "references/", "C:/windows/evil.md", "a".repeat(190) + ".md", "ref erences/note.md", "./SKILL.md", "notes\u0000.md"];
    for (const path of unsafe) {
        assert.throws(() => assertSafeSkillFilePath(path), /技能文件路径/u, "应拒绝路径：" + path);
        // 索引解析逐条隔离：带不安全路径的条目被丢弃并记警告，其余条目照常可用（单条坏数据不拖垮整份索引）。
        const registry = parseSkillRegistry(sampleRegistry({ files: [fileMeta("SKILL.md", SKILL_BODY), { path, bytes: 1, sha256: sha256("x") }] }), INDEX_URL);
        assert.equal(registry.skills.length, 0, "不安全路径的条目必须被丢弃：" + path);
        assert.equal(registry.warnings?.length, 1, "丢弃要留下警告：" + path);
        assert.match(registry.warnings![0], /技能文件路径/u);
    }

    assert.equal(assertSafeSkillFilePath("references/notes.md"), "references/notes.md");
    // 入口文件与重复路径同样只丢该条，不炸整份索引。
    const badEntry = parseSkillRegistry(sampleRegistry({ entry: "../SKILL.md" }), INDEX_URL);
    assert.equal(badEntry.skills.length, 0);
    assert.match(badEntry.warnings![0], /技能文件路径/u);
    const dupFiles = parseSkillRegistry(sampleRegistry({ files: [fileMeta("SKILL.md", SKILL_BODY), fileMeta("SKILL.md", REFERENCE)] }), INDEX_URL);
    assert.equal(dupFiles.skills.length, 0);
    assert.match(dupFiles.warnings![0], /无效条目/u);
});

test("removed built-in skills never come back from persisted data", () => {
    const persisted = [
        { ...legacySkill("wg.workflow-architect"), source: "built-in" },
        { ...legacySkill("wg.creative-director"), source: "built-in" },
        legacySkill("open-design.legacy"),
        { ...legacySkill("personal.1"), source: "personal" },
        { ...legacySkill("sample-skill"), files: [{ path: "SKILL.md", content: "x" }] },
    ];

    const skills = pruneInstalledSkills(persisted);

    assert.deepEqual(
        skills.map((skill) => skill.id),
        ["personal.1", "sample-skill"],
    );
    assert.deepEqual(skills[1].files, [{ path: "SKILL.md", content: "x" }]);
    assert.deepEqual(pruneInstalledSkills(undefined), []);
    assert.deepEqual(pruneInstalledSkills([{ id: "" }]), []);
});

test("personal skills keep their files through the store normalizer", () => {
    const files = [
        { path: "SKILL.md", content: "# 个人" },
        { path: "notes/a.md", content: "备注" },
    ];
    assert.deepEqual(createPersonalSkill({ id: "personal.1", body: "# 个人", files }).files, files);
});

test("registry trigger words survive into the installed skill used by the Zodiac skill list", () => {
    // 技能清单只展示注册表里已有的描述与触发词，不凭空生成。
    assert.deepEqual(createPersonalSkill({ id: "personal.2", triggerWords: ["分镜", "运镜"] }).triggerWords, ["分镜", "运镜"]);
    const registry = readFileSync(new URL("../src/services/skills/skill-registry.ts", import.meta.url), "utf8");
    assert.match(registry, /triggerWords: entry\.triggerWords/u);
});

test("built-in presets and their store special cases stay removed", () => {
    const presets = readFileSync(new URL("../src/services/skills/skill-presets.ts", import.meta.url), "utf8");
    const store = readFileSync(new URL("../src/stores/use-skill-store.ts", import.meta.url), "utf8");

    assert.doesNotMatch(presets, /BUILT_IN_SKILLS|工作流架构师|创意导演/u);
    assert.doesNotMatch(store, /BUILT_IN_SKILLS|built-in/u);
    assert.match(store, /skills: \[\]/u);
    assert.match(store, /pruneInstalledSkills/u);
});

test("parses the published registry artifact when it is present", () => {
    const artifact = new URL("../../skills/registry/dist/official-skills.json", import.meta.url);
    if (!existsSync(artifact)) return;
    const raw = JSON.parse(readFileSync(artifact, "utf8"));
    if (raw.schemaVersion !== 2) return;

    const registry = parseSkillRegistry(raw, INDEX_URL);

    assert.equal(registry.schemaVersion, 2);
    assert.equal(registry.skills.length, raw.skills.length);
    assert.ok(registry.skills.length > 0);
    for (const entry of registry.skills) {
        assert.ok(
            entry.files.some((file) => file.path === entry.entry),
            `${entry.id} 缺少入口文件`,
        );
        assert.equal(entry.contentUrl, `${entry.baseUrl}${entry.entry}`);
        assert.match(entry.sha256, /^[a-f0-9]{64}$/u);
        for (const file of entry.files) assert.equal(assertSafeSkillFilePath(file.path), file.path);
    }
    assert.ok(registry.skills[0].files.length > 1);
    assert.ok(registry.skills.filter((entry) => entry.coverUrl).length >= 55);
    assert.ok(registry.skills.filter((entry) => entry.showcase?.length).length >= 40);
    assert.ok(registry.skills.filter((entry) => entry.structuredInfo).length >= 70);
});

function legacySkill(id: string) {
    return { id, name: id, version: "1.0.0", description: "", body: "# 正文", capabilities: [], tags: [], source: "registry", enabled: true, priority: 10, installedAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" };
}

test("单条坏数据只丢该条，其余技能照常可用并给出警告", () => {
    const payload = {
        schemaVersion: 2,
        skills: [
            sampleRegistry().skills[0],
            // 非法路径：绝对路径 + 目录穿越，解析时必须被拒绝
            { ...sampleRegistry().skills[0], id: "bad-skill", name: "坏技能", files: [{ path: "/etc/passwd", bytes: 1, sha256: "a".repeat(64) }] },
            { ...sampleRegistry().skills[0], id: "good-skill-2", name: "另一个好技能" },
        ],
    };
    const registry = parseSkillRegistry(payload, INDEX_URL);

    assert.equal(registry.skills.length, 2);
    assert.deepEqual(registry.skills.map((skill) => skill.id), ["sample-skill", "good-skill-2"]);
    assert.equal(registry.warnings?.length, 1);
    assert.match(registry.warnings![0], /bad-skill/u);

    // 规格外的 schemaVersion 仍然整体拒绝（不是"每条都跳过"就变成静默空列表）
    assert.throws(() => parseSkillRegistry({ schemaVersion: 3, skills: [] }, INDEX_URL), /不受支持/u);
    assert.throws(() => parseSkillRegistry({ skills: [] }, INDEX_URL), /不受支持/u);
});
