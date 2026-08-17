import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("official downloads and operational links use the WorkflowGenerator repository", () => {
    const sources = [
        readSource("../src/constant/env.ts"),
        readSource("../src/services/api/prompt-source-presets.ts"),
        readSource("../src/services/skills/skill-registry.ts"),
        readSource("../../docs/src/lib/shared.ts"),
    ].join("\n");

    assert.match(sources, /qxryz\/workflowgenerator/u);
    assert.doesNotMatch(sources, /qxryz\/infinite-canvas|basketikun\/infinite-canvas|canvas\.best/u);
});

test("distribution workflows publish only to their dedicated branches", () => {
    assert.match(readSource("../../.github/workflows/publish-plugins.yml"), /HEAD:plugins-dist/u);
    assert.match(readSource("../../.github/workflows/build-skills-registry.yml"), /HEAD:skills-dist/u);
    const promptWorkflow = readSource("../../.github/workflows/sync-prompt-sources.yml");
    assert.match(promptWorkflow, /HEAD:wg-prompt-sources/u);
    assert.doesNotMatch(promptWorkflow, /git push\s*$/mu);
});

test("container publishing stays removed and Pages stays opt-in", () => {
    assert.equal(existsSync(new URL("../../Dockerfile", import.meta.url)), false);
    assert.equal(existsSync(new URL("../../.github/workflows/docker-image.yml", import.meta.url)), false);
    assert.equal(existsSync(new URL("../../.github/workflows/docs-docker-image.yml", import.meta.url)), false);
    const pagesWorkflow = readSource("../../.github/workflows/github-pages.yml");
    assert.match(pagesWorkflow, /workflow_dispatch:/u);
    assert.doesNotMatch(pagesWorkflow, /tags:\s*\["v\*"\]/u);
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
