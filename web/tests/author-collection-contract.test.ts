import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { createPromptSource } from "../src/services/api/prompt-source-presets.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("prompt sources keep author collections separate from public collections", () => {
    assert.equal(createPromptSource().collection, "public");
    assert.equal(createPromptSource({ collection: "author" }).collection, "author");

    const service = readSource("../src/services/api/prompts.ts");
    const page = readSource("../src/pages/prompts/index.tsx");
    assert.match(service, /label: "公开收录", value: "public"/u);
    assert.match(service, /label: "作者私藏", value: "author"/u);
    assert.match(service, /source\.collection === collection/u);
    assert.match(service, /item\.collection !== options\.collection/u);
    assert.match(page, /<PromptCollectionFilter/u);
    assert.match(page, /暂时没有作者私藏/u);
    assert.match(service, /INSTALLED_AUTHOR_PROMPT_SOURCE_ID/u);
    assert.match(service, /useAuthorPromptStore\.getState\(\)\.prompts/u);
    assert.match(page, /已从作者私藏移除/u);
});

test("Skills expose an empty-ready author collection without merging personal Skills", () => {
    const manager = readSource("../src/components/skills/skills-manager.tsx");
    const registry = readSource("../src/services/skills/skill-registry.ts");
    assert.match(manager, /type SkillsView = "official" \| "author" \| "personal"/u);
    assert.match(manager, /options=\{\["官方", "作者私藏", "我的"\]\}/u);
    assert.match(manager, /catalogSource\(item\) === view/u);
    assert.match(manager, /暂时没有作者私藏/u);
    assert.match(registry, /value\.catalogSource === "author" \? "author" : "official"/u);
});

test("the top navigation opens a standalone About Author page", () => {
    const navigation = readSource("../src/components/layout/app-top-nav.tsx");
    const styles = readSource("../src/styles/globals.css");
    const router = readSource("../src/router.tsx");
    const page = readSource("../src/pages/about-author/index.tsx");
    const note = readSource("../src/components/author-library/author-note.tsx");
    assert.match(navigation, /title=\{t\("别点我"\)\}/u);
    assert.match(navigation, /className="hidden text-\[11px\] xl:inline">\{t\("别点我"\)\}/u);
    assert.match(navigation, /label: t\("说了别点"\)/u);
    assert.equal(navigation.match(/type: "divider"/gu)?.length, 2);
    assert.match(navigation, /key: "upcoming", label: "\.\.\.".*disabled: true/u);
    assert.match(navigation, /key: "explore", label: t\("探索"\)/u);
    assert.match(navigation, /const EXPLORE_URL = "https:\/\/web\.zhouzhou\.dev"/u);
    assert.match(navigation, /openExternalUrl\(EXPLORE_URL\)/u);
    assert.doesNotMatch(navigation, /DSH/u);
    assert.doesNotMatch(navigation, /dsh-launcher/u);
    assert.doesNotMatch(navigation, /getDshVersion/u);
    assert.doesNotMatch(navigation, /更多好玩的，正在路上/u);
    assert.match(navigation, /"wg-playful-nav"/u);
    assert.match(styles, /\.wg-playful-nav \{/u);
    assert.match(styles, /--wg-playful-mint: #19785f/u);
    assert.match(styles, /--wg-playful-mint: #74ddbd/u);
    assert.match(navigation, /setPlayfulMenuOpen\(false\)/u);
    assert.match(navigation, /if \(key === "about-author"\) \{\s+navigate\("\/about-author"\)/u);
    assert.match(router, /path: "\/about-author", element: <AboutAuthorPage/u);
    assert.doesNotMatch(router, /\/dsh/u);
    assert.match(page, />关于作者</u);
    assert.match(page, /fetchAuthorLibraryCatalog/u);
    assert.match(page, /installAuthorLibraryItem/u);
    assert.match(page, /<AuthorNote note=\{item\.authorNote/u);
    assert.match(note, />作者备注</u);
    assert.match(note, /作者暂未留下备注/u);
    assert.match(page, /保存到 WorkflowGenerator/u);
    assert.doesNotMatch(page, /<iframe/u);
});

test("author downloads are routed into immutable author collections and durable assets", () => {
    const install = readSource("../src/services/author-library/install.ts");
    const contract = readSource("../src/services/author-library/contract.ts");
    const skillManager = readSource("../src/components/skills/skills-manager.tsx");
    const promptCard = readSource("../src/components/prompts/prompt-card.tsx");
    const promptDetail = readSource("../src/pages/prompts/components/prompt-detail-dialog.tsx");
    const assetsPage = readSource("../src/pages/assets/index.tsx");
    const promptStore = readSource("../src/stores/use-author-prompt-store.ts");
    const assetStore = readSource("../src/stores/use-asset-store.ts");
    const native = readSource("../src-tauri/src/lib.rs");
    assert.match(install, /catalogSource: "author"/u);
    assert.match(contract, /authorNote\?: string/u);
    assert.match(install, /authorNote: item\.authorNote/u);
    assert.match(install, /authorNote: item\.authorNote \|\| item\.note \|\| ""/u);
    assert.match(skillManager, /<AuthorNote note=\{entry\?\.authorNote \|\| installed\?\.authorNote\}/u);
    assert.match(promptCard, /<AuthorNote note=\{item\.authorNote\}/u);
    assert.match(promptDetail, /<AuthorNote note=\{prompt\.authorNote\} expanded/u);
    assert.match(assetsPage, /<AuthorNote note=\{authorLibraryNote\(asset\)\}/u);
    assert.match(install, /useAuthorPromptStore\.getState\(\)\.save/u);
    assert.match(install, /upsertAssetPersisted/u);
    assert.match(promptStore, /workflowgenerator:author-prompts-v1/u);
    assert.match(assetStore, /upsertAssetPersisted/u);
    assert.match(native, /expected_sha256/u);
    assert.match(native, /媒体文件校验失败/u);
});
