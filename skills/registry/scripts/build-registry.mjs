import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "dist");
const repository = "https://raw.githubusercontent.com/qxryz/workflowgenerator/skills-dist";

const packages = [
    {
        id: "wg.workflow-architect",
        name: "工作流架构师",
        version: "1.0.0",
        description: "把创作目标整理成可执行、可检查且不会重复产出的画布工作流。",
        capabilities: ["workflow", "terminal"],
        tags: ["工作流", "编排", "数据流"],
        homepage: "https://github.com/qxryz/workflowgenerator",
        slug: "workflow-architect",
        file: "workflow-architect/SKILL.md",
    },
    {
        id: "wg.creative-director",
        name: "创意导演",
        version: "1.0.0",
        description: "在生成前建立方向、参考与取舍，让多模态资产保持一致。",
        capabilities: ["writing", "image", "video", "audio"],
        tags: ["创意", "视觉", "叙事"],
        homepage: "https://github.com/qxryz/workflowgenerator",
        slug: "creative-director",
        file: "creative-director/SKILL.md",
    },
];

await rm(dist, { recursive: true, force: true });
await mkdir(path.join(dist, "packages"), { recursive: true });
const skills = [];
for (const entry of packages) {
    const body = await readFile(path.join(root, "packages", entry.file), "utf8");
    const outputPath = `${entry.slug}.md`;
    const target = path.join(dist, outputPath);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, body);
    skills.push({
        id: entry.id,
        name: entry.name,
        version: entry.version,
        description: entry.description,
        contentUrl: `${repository}/${outputPath}`,
        sha256: createHash("sha256").update(body).digest("hex"),
        homepage: entry.homepage,
        capabilities: entry.capabilities,
        tags: entry.tags,
    });
}
await writeFile(
    path.join(dist, "official-skills.json"),
    `${JSON.stringify({ schemaVersion: 1, updatedAt: new Date().toISOString(), skills }, null, 2)}\n`,
);
