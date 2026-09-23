import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("runtime distribution pulls from the public wg-dist repository", () => {
    // 应用源码在公开仓库 qxryz/workflowgenerator；运行时拉取的官方内容
    // （插件、Skills、提示词源、作者库）全部来自公开分发仓库 qxryz/wg-dist。
    const sources = [readSource("../src/constant/env.ts"), readSource("../src/services/api/prompt-source-presets.ts"), readSource("../src/services/skills/skill-registry.ts"), readSource("../src/services/author-library/catalog.ts")].join("\n");

    assert.match(sources, /qxryz\/wg-dist/u);
    assert.doesNotMatch(sources, /raw\.githubusercontent\.com\/qxryz\/workflowgenerator/u);
    assert.doesNotMatch(sources, /qxryz\/infinite-canvas|basketikun\/infinite-canvas|canvas\.best/u);
});

test("plugin and skill workflows validate artifacts while prompt sync targets its dedicated branch", () => {
    const plugins = readSource("../../.github/workflows/validate-plugins.yml");
    assert.match(plugins, /npm run build/u);
    assert.match(plugins, /actions\/upload-artifact@/u);
    assert.doesNotMatch(plugins, /git push|HEAD:plugins-dist/u);

    const skills = readSource("../../.github/workflows/build-skills-registry.yml");
    assert.match(skills, /npm run build/u);
    assert.match(skills, /actions\/upload-artifact@/u);
    assert.doesNotMatch(skills, /git push|HEAD:skills-dist/u);

    const promptWorkflow = readSource("../../.github/workflows/sync-prompt-sources.yml");
    assert.match(promptWorkflow, /HEAD:wg-prompt-sources/u);
    assert.match(promptWorkflow, /qxryz\/wg-dist\.git/u);
    assert.doesNotMatch(promptWorkflow, /git push\s*$/mu);
});

test("desktop owns a loopback listener and removes connector deployment", () => {
    assert.match(readSource("../src-tauri/src/main.rs"), /TcpListener::bind\("127\.0\.0\.1:0"\)/u);
    assert.equal(existsSync(new URL("../../agent-connector/package.json", import.meta.url)), false);
    assert.equal(existsSync(new URL("../../docker-compose.yml", import.meta.url)), false);
});

test("removed upstream integrations stay removed while README keeps attribution", () => {
    const removedPaths = [
        "../../.agents/plugins/marketplace.json",
        "../../.github/workflows/publish-canvas-agent.yml",
        "../../CLA.md",
        "../../docs/content/docs/development/local-codex-canvas.mdx",
        "../../docs/content/docs/overview/codex-app-plugin.mdx",
        "../../docs/content/docs/progress/local-agent-integration-plan.mdx",
    ];

    for (const path of removedPaths) assert.equal(existsSync(new URL(path, import.meta.url)), false, path);
    assert.match(readSource("../../README.md"), /basketikun\/infinite-canvas/u);
});
