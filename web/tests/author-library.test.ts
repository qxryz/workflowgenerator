import assert from "node:assert/strict";
import test from "node:test";

import { parseAuthorLibraryCatalog } from "../src/services/author-library/contract.ts";

const sha256 = "a".repeat(64);

function catalog() {
    return {
        schemaVersion: 1,
        updatedAt: "2026-08-12T00:00:00.000Z",
        publisher: { name: "作者" },
        items: [
            {
                id: "author.skill.storyboard",
                kind: "skill",
                version: "1.0.0",
                title: "分镜 Skill",
                authorNote: "  适合先把长故事拆成可执行镜头。  ",
                contentUrl: "./skills/storyboard.md",
                sha256,
                capabilities: ["workflow", "writing"],
            },
            {
                id: "author.prompt.portrait",
                kind: "prompt",
                version: "2.1.0",
                title: "人像提示词",
                authorNote: "我会在需要稳定人物气质时使用。",
                contentUrl: "./prompts/portrait.json",
                sha256,
            },
            {
                id: "author.asset.reference",
                kind: "asset",
                version: "1",
                title: "参考图",
                authorNote: "适合作为低饱和构图参考。",
                contentUrl: "./assets/reference.png",
                sha256,
                assetKind: "image",
                mimeType: "image/png",
            },
        ],
    };
}

test("author catalog normalizes a private publisher's public distribution output", () => {
    const parsed = parseAuthorLibraryCatalog(catalog(), "https://raw.example.test/library/catalog.json");
    assert.equal(parsed.items.length, 3);
    assert.equal(parsed.items[0].contentUrl, "https://raw.example.test/library/skills/storyboard.md");
    assert.equal(parsed.items[0].kind, "skill");
    assert.equal(parsed.items[0].authorNote, "适合先把长故事拆成可执行镜头。");
    assert.equal(parsed.items[1].kind, "prompt");
    assert.equal(parsed.items[1].authorNote, "我会在需要稳定人物气质时使用。");
    assert.equal(parsed.items[2].kind, "asset");
    assert.equal(parsed.items[2].authorNote, "适合作为低饱和构图参考。");
});

test("author catalog rejects entries that can collide with non-author content", () => {
    const value = catalog();
    value.items[0].id = "official.storyboard";
    assert.throws(() => parseAuthorLibraryCatalog(value, "https://raw.example.test/library/catalog.json"), /author\./u);
});

test("author catalog rejects duplicate ids, invalid hashes, and mismatched asset media", () => {
    const duplicate = catalog();
    duplicate.items[1].id = duplicate.items[0].id;
    assert.throws(() => parseAuthorLibraryCatalog(duplicate, "https://raw.example.test/library/catalog.json"), /重复 ID/u);

    const invalidHash = catalog();
    invalidHash.items[0].sha256 = "unsafe";
    assert.throws(() => parseAuthorLibraryCatalog(invalidHash, "https://raw.example.test/library/catalog.json"), /校验值无效/u);

    const invalidMime = catalog();
    invalidMime.items[2].mimeType = "text/html";
    assert.throws(() => parseAuthorLibraryCatalog(invalidMime, "https://raw.example.test/library/catalog.json"), /不匹配/u);

    const oversizedNote = catalog();
    oversizedNote.items[0].authorNote = "长".repeat(2_001);
    assert.throws(() => parseAuthorLibraryCatalog(oversizedNote, "https://raw.example.test/library/catalog.json"), /作者备注不能超过 2000 个字符/u);
});
