import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import process from "node:process";

const catalogPath = resolve(process.argv[2] || "public/author-library/catalog.json");
const catalogRoot = dirname(catalogPath);
const catalog = JSON.parse(await readFile(catalogPath, "utf8"));

if (catalog.schemaVersion !== 1 || !catalog.publisher?.name || !Array.isArray(catalog.items)) fail("catalog.json 格式无效");
if (catalog.items.length > 5_000) fail("catalog.json 条目超过 5000 项");

const ids = new Set();
for (const [index, item] of catalog.items.entries()) {
    const label = `items[${index}]`;
    if (!/^author\.[a-z0-9][a-z0-9._-]{1,126}$/u.test(item.id || "")) fail(`${label}.id 必须以 author. 开头`);
    if (ids.has(item.id)) fail(`${label}.id 与其他条目重复`);
    ids.add(item.id);
    if (!["skill", "prompt", "asset"].includes(item.kind)) fail(`${label}.kind 无效`);
    if (!item.version || !item.title) fail(`${label} 缺少版本或标题`);
    if (item.authorNote !== undefined && typeof item.authorNote !== "string") fail(`${label}.authorNote 必须是文本`);
    if (item.authorNote?.length > 2_000) fail(`${label}.authorNote 不能超过 2000 个字符`);
    if (!/^[a-f0-9]{64}$/iu.test(item.sha256 || "")) fail(`${label}.sha256 无效`);
    if (!item.contentUrl) fail(`${label}.contentUrl 不能为空`);
    if (item.kind === "skill" && (!Array.isArray(item.capabilities) || !item.capabilities.length)) fail(`${label}.capabilities 不能为空`);
    if (item.kind === "asset" && (!["text", "image", "video", "audio"].includes(item.assetKind) || !item.mimeType)) fail(`${label} 缺少有效资产类型`);

    if (/^https:\/\//iu.test(item.contentUrl)) continue;
    if (/^[a-z][a-z0-9+.-]*:/iu.test(item.contentUrl) || isAbsolute(item.contentUrl)) fail(`${label}.contentUrl 只能使用 HTTPS 或相对路径`);
    const contentPath = resolve(catalogRoot, item.contentUrl);
    if (relative(catalogRoot, contentPath).startsWith("..")) fail(`${label}.contentUrl 不能离开发布目录`);
    const bytes = await readFile(contentPath).catch(() => fail(`${label}.contentUrl 指向的文件不存在`));
    const file = await stat(contentPath);
    const digest = createHash("sha256").update(bytes).digest("hex");
    if (digest !== item.sha256.toLowerCase()) fail(`${label}.sha256 与文件内容不一致`);
    if (item.bytes && item.bytes !== file.size) fail(`${label}.bytes 与文件大小不一致`);
}

console.log(`Author Library 校验通过：${catalog.items.length} 项`);

function fail(message) {
    throw new Error(message);
}
