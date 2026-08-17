import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { isNewerVersion, parseChangelog } from "../src/lib/release.ts";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

test("version comparison accepts release tags and rejects older or invalid versions", () => {
    assert.equal(isNewerVersion("v0.2.0", "0.1.0"), true);
    assert.equal(isNewerVersion("0.1.1", "0.1.0"), true);
    assert.equal(isNewerVersion("0.1.0", "0.1.0"), false);
    assert.equal(isNewerVersion("0.0.9", "0.1.0"), false);
    assert.equal(isNewerVersion("latest", "0.1.0"), false);
});

test("release notes accept the repository changelog bullet format", () => {
    assert.deepEqual(parseChangelog("## v0.2.0 - 2026-08-17\n\n- [新增] 下载统计\n+ [修复] 更新日志\n"), [
        {
            version: "v0.2.0",
            date: "2026-08-17",
            items: [
                { type: "新增", content: "下载统计" },
                { type: "修复", content: "更新日志" },
            ],
        },
    ]);
});

test("desktop updater checks this repository and saves state before installation", () => {
    const hook = readSource("../src/hooks/use-version-check.ts");
    const settings = readSource("../src/components/layout/app-update-settings.tsx");
    const configPanel = readSource("../src/components/layout/app-config-modal.tsx");
    const navigation = readSource("../src/components/layout/app-top-nav.tsx");
    const native = readSource("../src-tauri/src/lib.rs");
    const cargo = readSource("../src-tauri/Cargo.toml");
    const capability = JSON.parse(readSource("../src-tauri/capabilities/default.json")) as { permissions: string[] };
    const config = JSON.parse(readSource("../src-tauri/tauri.conf.json")) as {
        bundle: { macOS: { signingIdentity: string } };
        plugins: { updater: { pubkey: string; endpoints: string[] } };
    };

    assert.match(hook, /raw\.githubusercontent\.com\/qxryz\/workflowgenerator\/main/u);
    assert.doesNotMatch(hook, /basketikun\/infinite-canvas/u);
    assert.match(hook, /await update\.download/u);
    assert.match(hook, /await update\.install\(\)/u);
    assert.match(hook, /await relaunch\(\)/u);
    assert.ok(hook.indexOf("await flushDesktopState()") < hook.indexOf("await update.install()"));
    assert.match(settings, /下载并安装/u);
    assert.match(settings, />\s*Star\s*</u);
    assert.match(hook, /APP_REPOSITORY_URL = "https:\/\/github\.com\/qxryz\/workflowgenerator"/u);
    assert.match(settings, /前往 Tags/u);
    assert.match(settings, /更新日志/u);
    assert.match(settings, /累计下载/u);
    assert.match(settings, /手动安装/u);
    assert.match(settings, /更新包/u);
    assert.match(hook, /fetchReleaseDownloadStats/u);
    assert.match(hook, /staleTime: 30 \* 60 \* 1000/u);
    assert.match(configPanel, /label: "软件更新"/u);
    assert.match(configPanel, /<AppUpdateSettings/u);
    assert.doesNotMatch(navigation, /VersionRelease|APP_VERSION/u);
    assert.match(cargo, /tauri-plugin-updater = "2"/u);
    assert.match(cargo, /tauri-plugin-process = "2"/u);
    assert.match(native, /tauri_plugin_updater::Builder::new\(\)\.build\(\)/u);
    assert.match(native, /tauri_plugin_process::init\(\)/u);
    assert.ok(capability.permissions.includes("updater:default"));
    assert.ok(capability.permissions.includes("process:allow-restart"));
    assert.equal(config.bundle.macOS.signingIdentity, "-");
    assert.equal(config.plugins.updater.endpoints[0], "https://github.com/qxryz/workflowgenerator/releases/latest/download/latest.json");
    assert.ok(config.plugins.updater.pubkey.length > 80);
});

test("version tags build downloadable and signed updater artifacts", () => {
    const workflow = readSource("../../.github/workflows/release-desktop.yml");
    const releaseConfig = JSON.parse(readSource("../src-tauri/tauri.release.conf.json")) as { bundle: { createUpdaterArtifacts: boolean } };
    assert.match(workflow, /tags: \["v\*"\]/u);
    assert.match(workflow, /id: release_meta/u);
    assert.match(workflow, /\(dev\|alpha\|beta\|rc\)/u);
    assert.match(workflow, /prerelease: \$\{\{ steps\.release_meta\.outputs\.prerelease \}\}/u);
    assert.doesNotMatch(workflow, /prerelease: false/u);
    assert.match(workflow, /cat \.\.\/VERSION/u);
    assert.match(workflow, /tauri-apps\/tauri-action@[0-9a-f]{40} # v1/u);
    assert.doesNotMatch(workflow, /tauri-apps\/tauri-action@v1(?:\s|$)/u);
    assert.match(workflow, /TAURI_SIGNING_PRIVATE_KEY/u);
    assert.match(workflow, /--bundles app,dmg/u);
    assert.match(workflow, /uploadUpdaterJson: true/u);
    assert.match(workflow, /attestations: write/u);
    assert.match(workflow, /actions\/attest-build-provenance@[0-9a-f]{40} # v3/u);
    assert.match(workflow, /SHA256SUMS/u);
    assert.match(workflow, /gh release download/u);
    assert.match(workflow, /release-assets/u);
    assert.match(workflow, /shasum -a 256/u);
    assert.equal(releaseConfig.bundle.createUpdaterArtifacts, true);
});

test("README stays a short personal download page", () => {
    const readme = readSource("../../README.md");
    assert.match(readme, /这是作者自用工具/u);
    assert.match(readme, /github\.com\/qxryz\/workflowgenerator\/tags/u);
    assert.match(readme, /Gatekeeper/u);
    assert.match(readme, /xattr -dr com\.apple\.quarantine/u);
    assert.match(readme, /AGPL-3\.0-or-later/u);
    assert.doesNotMatch(readme, /bun install|desktop:dev|项目结构|开始开发/u);
});
