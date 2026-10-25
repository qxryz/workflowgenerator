import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { registerHooks } from "node:module";
import test from "node:test";

const fixture = globalThis.__installationActivityFixture = {
    activities: new Map(), notices: [], installed: [], skills: [], prompts: [], discarded: [],
    flush: async () => {}, relaunch: async () => {}, upsert: () => {},
    upload: async () => ({ url: "/media/images/fixture", storageKey: "image:fixture", bytes: 12, mimeType: "image/png", width: 10, height: 10 }),
    saveAsset: async () => "asset-fixture",
};
const mocks = new Map([
    ["@/stores/use-agent-store", `const f = globalThis.__installationActivityFixture;
        export const useAgentStore = { getState: () => ({
            setActivity: activity => { f.activities.set(activity.id, activity); f.notices.push({ ...activity }); },
            clearActivity: id => f.activities.delete(id),
        }) };`],
    ["@/services/app-lifecycle", `export const flushAppState = () => globalThis.__installationActivityFixture.flush();`],
    ["@tauri-apps/plugin-process", `export const relaunch = () => globalThis.__installationActivityFixture.relaunch();`],
    ["@tauri-apps/plugin-updater", `export const check = async () => { throw new Error("Unexpected update check"); };`],
    ["@/lib/canvas/node-registry", `export const getNodeDefinition = () => undefined;
        export const getNodePluginId = () => undefined;
        export const isBuiltinNodeType = () => false;
        export const registerNodeDefinitions = () => {};
        export const unregisterPluginNodes = () => {};`],
    ["@/lib/canvas/plugin-registry", `export const isBundledOfficialPluginUrl = url => url === "builtin:fixture";
        export const bundledOfficialPluginId = () => "fixture-plugin";
        export const loadBundledOfficialPluginExport = () => globalThis.__installationActivityFixture.loadBundled();`],
    ["@/lib/canvas/plugin-runtime", `export const getPluginRuntime = () => ({});`],
    ["@/stores/canvas/use-plugin-store", `const f = globalThis.__installationActivityFixture;
        export const usePluginStore = { getState: () => ({ upsert: plugin => { f.upsert(plugin); f.installed.push(plugin); } }) };`],
    ["@/stores/use-skill-store", `const f = globalThis.__installationActivityFixture;
        export const useSkillStore = { getState: () => ({ skills: f.skills, save: skill => f.skills.push(skill) }) };`],
    ["@/stores/use-author-prompt-store", `const f = globalThis.__installationActivityFixture;
        export const useAuthorPromptStore = { getState: () => ({ prompts: f.prompts, save: prompt => f.prompts.push(prompt) }) };`],
    ["@/stores/use-asset-store", `export const useAssetStore = { getState: () => ({ assets: [], upsertAssetPersisted: (...args) => globalThis.__installationActivityFixture.saveAsset(...args) }) };`],
    ["@/services/image-storage", `const f = globalThis.__installationActivityFixture;
        export const uploadImage = (...args) => f.upload(...args);
        export const publishUploadedImage = () => true;
        export const discardUploadedImage = image => { f.discarded.push(image); };`],
    ["@/services/file-storage", `const f = globalThis.__installationActivityFixture;
        export const uploadMediaFile = (...args) => f.upload(...args);
        export const publishUploadedMedia = () => true;
        export const discardUploadedMedia = media => { f.discarded.push(media); };`],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        const source = mocks.get(specifier);
        return source === undefined ? nextResolve(specifier, context) : { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
    },
});

const { installDesktopUpdate } = await import("../src/services/desktop-updater.ts");
const { downloadRegistrySkill, parseSkillRegistry } = await import("../src/services/skills/skill-registry.ts");
const { installPluginFromUrl, updatePlugin } = await import("../src/lib/canvas/plugin-loader.ts");
const { installAuthorLibraryItem } = await import("../src/services/author-library/install.ts");

function gate() {
    let release, reached;
    const pending = new Promise(resolve => { release = resolve; });
    const arrived = new Promise(resolve => { reached = resolve; });
    return { release, arrived, pause: async () => { reached(); await pending; } };
}
const digest = text => createHash("sha256").update(text).digest("hex");
const current = () => [...fixture.activities.values()];
function assertActivity(title, status, route) {
    assert.equal(current().length, 1);
    assert.equal(current()[0].title, title);
    assert.equal(current()[0].status, status);
    assert.equal(current()[0].route, route);
}
test.beforeEach(() => {
    fixture.activities.clear(); fixture.notices.length = 0; fixture.installed.length = 0;
    fixture.skills.length = 0; fixture.prompts.length = 0; fixture.discarded.length = 0;
    fixture.flush = async () => {}; fixture.relaunch = async () => {}; fixture.upsert = () => {};
});

test("desktop update stays active through download, install, flush and relaunch without initiating another check", async () => {
    const download = gate(), install = gate(), save = gate(), restart = gate();
    const calls = [], progress = [];
    fixture.flush = async () => { calls.push("flush"); await save.pause(); };
    fixture.relaunch = async () => { calls.push("relaunch"); await restart.pause(); };
    const operation = installDesktopUpdate({ downloadAndInstall: async callback => {
        calls.push("download");
        callback({ event: "Started", data: { contentLength: 100 } });
        callback({ event: "Progress", data: { chunkLength: 25 } });
        await download.pause();
        callback({ event: "Finished" });
        await install.pause();
    } }, (received, total) => progress.push([received, total]));
    await download.arrived;
    assertActivity("软件更新", "downloading", "/config");
    assert.deepEqual(calls, ["download"]);
    download.release(); await install.arrived;
    assertActivity("软件更新", "running", "/config");
    install.release(); await save.arrived;
    assertActivity("软件更新", "saving", "/config");
    save.release(); await restart.arrived;
    assertActivity("软件更新", "running", "/config");
    restart.release(); await operation;
    assert.deepEqual(calls, ["download", "flush", "relaunch"]);
    assert.deepEqual(progress, [[0, 100], [25, 100], [25, 100]]);
    assert.deepEqual(current(), []);
});

test("failed desktop download or save clears activity and never relaunches", async () => {
    let restarts = 0, saves = 0;
    fixture.relaunch = async () => { restarts++; };
    fixture.flush = async () => { saves++; throw new Error("save unavailable"); };
    await assert.rejects(installDesktopUpdate({ downloadAndInstall: async () => { throw new Error("download unavailable"); } }), /download unavailable/);
    assert.equal(saves, 0);
    assert.deepEqual(current(), []);
    await assert.rejects(installDesktopUpdate({ downloadAndInstall: async () => {} }), /save unavailable/);
    assert.equal(saves, 1);
    assert.equal(restarts, 0);
    assert.deepEqual(current(), []);
});

test("simultaneous update entries share one promise and a failing second updater cannot clear the first download", async () => {
    const download = gate(), firstProgress = [], secondProgress = [];
    let downloads = 0, secondDownloads = 0, restarted = 0;
    fixture.relaunch = async () => { restarted++; };
    const first = installDesktopUpdate({ downloadAndInstall: async callback => {
        downloads++;
        callback({ event: "Started", data: { contentLength: 100 } });
        callback({ event: "Progress", data: { chunkLength: 25 } });
        await download.pause();
        callback({ event: "Progress", data: { chunkLength: 75 } });
        callback({ event: "Finished" });
    } }, (received, total) => firstProgress.push([received, total]));
    const second = installDesktopUpdate({ downloadAndInstall: async () => {
        secondDownloads++;
        throw new Error("second update already installing");
    } }, (received, total) => secondProgress.push([received, total]));
    assert.equal(first, second);
    await download.arrived;
    assertActivity("软件更新", "downloading", "/config");
    assert.equal(downloads, 1);
    assert.equal(secondDownloads, 0);
    const lateProgress = [];
    const joined = installDesktopUpdate({ downloadAndInstall: async () => { throw new Error("Unexpected third download"); } }, (received, total) => lateProgress.push([received, total]));
    assert.equal(joined, first);
    assert.deepEqual(lateProgress, [[25, 100]]);
    download.release(); await Promise.all([first, second, joined]);
    assert.deepEqual(secondProgress, firstProgress);
    assert.deepEqual(lateProgress, [[25, 100], [100, 100], [100, 100]]);
    assert.equal(secondDownloads, 0);
    assert.equal(restarted, 1);
    assert.deepEqual(current(), []);
});

test("shared update failure reaches both callers and unlocks one fresh retry", async () => {
    const download = gate();
    let downloads = 0;
    const failingUpdate = { downloadAndInstall: async () => {
        downloads++;
        await download.pause();
        throw new Error("shared download unavailable");
    } };
    const first = installDesktopUpdate(failingUpdate);
    const second = installDesktopUpdate(failingUpdate);
    const firstRejected = assert.rejects(first, /shared download unavailable/);
    const secondRejected = assert.rejects(second, /shared download unavailable/);
    await download.arrived;
    assert.equal(first, second);
    assertActivity("软件更新", "downloading", "/config");
    download.release(); await Promise.all([firstRejected, secondRejected]);
    assert.equal(downloads, 1);
    assert.deepEqual(current(), []);
    let retried = 0;
    const retry = installDesktopUpdate({ downloadAndInstall: async callback => {
        retried++;
        callback({ event: "Started", data: { contentLength: 50 } });
    } }, () => { throw new Error("observer unavailable"); });
    assert.notEqual(retry, first);
    await retry;
    assert.equal(retried, 1);
    assert.deepEqual(current(), []);
});

const bodies = { "SKILL.md": "# Fixture\n\nUse a reference.", "references/notes.md": "Reference notes." };
function skillEntry() {
    return parseSkillRegistry({ schemaVersion: 2, skills: [{
        id: "fixture-skill", name: "Fixture skill", version: "1.0.0", entry: "SKILL.md",
        baseUrl: "https://fixture.invalid/skill/", files: Object.entries(bodies).map(([path, body]) => ({ path, bytes: Buffer.byteLength(body), sha256: digest(body) })),
    }] }).skills[0];
}

test("a multi-file skill is one activity until every verified download finishes", async t => {
    const originalFetch = globalThis.fetch, first = gate(), second = gate();
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async input => {
        const path = new URL(input).pathname.slice("/skill/".length);
        await (path === "SKILL.md" ? first : second).pause();
        return new Response(bodies[path]);
    };
    const operation = downloadRegistrySkill(skillEntry());
    await Promise.all([first.arrived, second.arrived]);
    assertActivity("技能安装", "downloading", "/skills");
    first.release(); await new Promise(resolve => setImmediate(resolve));
    assert.equal(current().length, 1);
    second.release(); const installed = await operation;
    assert.deepEqual(installed.files.map(file => file.path), Object.keys(bodies));
    assert.equal(installed.body, bodies["SKILL.md"]);
    assert.deepEqual(current(), []);
});

test("skill failure keeps the batch active until siblings settle and preserves the first rejection", async t => {
    const originalFetch = globalThis.fetch, delayed = gate();
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async input => {
        if (String(input).endsWith("SKILL.md")) { await delayed.pause(); return new Response("second failure", { status: 503 }); }
        return new Response("first failure", { status: 404 });
    };
    const operation = downloadRegistrySkill(skillEntry());
    const rejected = assert.rejects(operation, /references\/notes.md（404）/);
    await delayed.arrived; await new Promise(resolve => setImmediate(resolve));
    assertActivity("技能安装", "downloading", "/skills");
    delayed.release(); await rejected;
    assert.deepEqual(current(), []);
});

test("plugin update uses one installation activity and clears it after activation failure", async () => {
    const loading = gate();
    fixture.loadBundled = async () => {
        await loading.pause();
        return { id: "fixture-plugin", name: "Fixture", nodes: [{ type: "fixture-plugin:node" }], setup: () => { throw new Error("activation unavailable"); } };
    };
    const operation = updatePlugin({ id: "fixture-plugin", url: "builtin:fixture", official: true, enabled: true });
    const rejected = assert.rejects(operation, /activation unavailable/);
    await loading.arrived;
    assertActivity("插件安装", "running", "/canvas");
    loading.release(); await rejected;
    assert.equal(fixture.installed.length, 0);
    assert.deepEqual(current(), []);
});

test("plugin integrity failure remains active during its download and leaves nothing installed", async t => {
    const originalFetch = globalThis.fetch, download = gate();
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => { await download.pause(); return new Response("export default {};"); };
    const operation = installPluginFromUrl("https://fixture.invalid/plugin.js", { official: true, expectedSha256: "a".repeat(64) });
    const rejected = assert.rejects(operation, /插件文件校验失败/);
    await download.arrived;
    assertActivity("插件安装", "downloading", "/canvas");
    download.release(); await rejected;
    assert.equal(fixture.installed.length, 0);
    assert.deepEqual(current(), []);
});

test("bundled plugin installation transitions to saving and cleans up on success", async () => {
    fixture.loadBundled = async () => ({ id: "fixture-plugin", name: "Fixture", nodes: [{ type: "fixture-plugin:node" }] });
    const installed = await installPluginFromUrl("builtin:fixture", { official: true, enabled: false });
    assert.equal(installed.id, "fixture-plugin");
    assert.equal(fixture.installed.length, 1);
    assert.deepEqual(fixture.notices.map(notice => notice.status), ["running", "running", "saving"]);
    assert.deepEqual(current(), []);
});

function authorItem(kind) {
    return { id: "author-fixture", title: "Fixture", kind, version: "1.0.0", contentUrl: "https://fixture.invalid/author", sha256: digest("# Author fixture"), capabilities: [], tags: [] };
}
test("author skill download is visible until verification and save, and clears on download failure", async t => {
    const originalFetch = globalThis.fetch, download = gate();
    t.after(() => { globalThis.fetch = originalFetch; });
    globalThis.fetch = async () => { await download.pause(); return new Response("# Author fixture"); };
    const operation = installAuthorLibraryItem(authorItem("skill"), "Fixture publisher");
    await download.arrived;
    assertActivity("作者库保存", "downloading", "/about-author");
    download.release(); await operation;
    assert.equal(fixture.skills.length, 1);
    assert.equal(fixture.notices.at(-1).status, "saving");
    assert.deepEqual(current(), []);
    globalThis.fetch = async () => new Response("missing", { status: 404 });
    await assert.rejects(installAuthorLibraryItem(authorItem("skill"), "Fixture publisher"), /404/);
    assert.deepEqual(current(), []);
});

test("author media save failure discards its provisional upload and clears the activity", async () => {
    const upload = gate(), save = gate();
    fixture.upload = async () => { await upload.pause(); return { url: "/media/images/fixture", storageKey: "image:fixture", bytes: 12, mimeType: "image/png", width: 10, height: 10 }; };
    fixture.saveAsset = async () => { await save.pause(); throw new Error("asset save unavailable"); };
    const operation = installAuthorLibraryItem({ ...authorItem("asset"), assetKind: "image" }, "Fixture publisher");
    const rejected = assert.rejects(operation, /asset save unavailable/);
    await upload.arrived;
    assertActivity("作者库保存", "downloading", "/about-author");
    upload.release(); await save.arrived;
    assert.equal(current().length, 1);
    save.release(); await rejected;
    assert.equal(fixture.discarded.length, 1);
    assert.deepEqual(current(), []);
});
