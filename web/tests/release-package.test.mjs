import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

import {
    appBuildEnvironment,
    assertReadyAssets,
    assertSourceUnchanged,
    markReadyForSource,
    createUpdateManifest,
    copyPreservedSource,
    preservedSourceInput,
    releaseVersion,
    signReleaseApplication,
    updateRuntimeManifests,
    validateBaseManifest,
    writeReleaseChecksums,
} from "../scripts/package-release.mjs";

const VERSION = "0.9.4";
const RUNTIME = "Contents/Resources/runtime";
const NESTED_PATHS = [`${RUNTIME}/opencode`, `${RUNTIME}/media/ffmpeg`, `${RUNTIME}/media/ffprobe`];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function fixture(t) {
    const root = mkdtempSync(join(tmpdir(), "wg-release-package-test-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    return root;
}

function write(root, relative, contents) {
    const path = join(root, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, contents);
    return path;
}

function versionFixture(root, overrides = {}) {
    const versions = {
        package: VERSION,
        tauri: VERSION,
        server: VERSION,
        desktop: VERSION,
        versionFile: VERSION,
        ...overrides,
    };
    write(root, "web/package.json", JSON.stringify({ version: versions.package }));
    write(root, "web/src-tauri/tauri.conf.json", JSON.stringify({ version: versions.tauri }));
    write(root, "web/server/Cargo.toml", `[package]\nname = "fixture-server"\nversion = "${versions.server}"\n`);
    write(root, "web/src-tauri/Cargo.toml", `[package]\nname = "fixture-desktop"\nversion = "${versions.desktop}"\n`);
    write(root, "VERSION", `v${versions.versionFile}\n`);
}

function runtimeFixture(root) {
    const app = join(root, "WorkflowGenerator.app");
    const runtimeManifest = {
        name: "opencode",
        version: "1.18.32",
        platform: "darwin",
        arch: "arm64",
        sha256: "old-opencode-digest",
        retained: { channel: "fixture" },
    };
    const mediaManifest = {
        signature: "retain-build-input-signature",
        sha256: "old-ffmpeg-digest",
        ffprobeSha256: "old-ffprobe-digest",
        platform: "darwin",
        arch: "arm64",
        sources: [{ name: "ffmpeg", version: "8.0.1" }],
    };
    for (const path of NESTED_PATHS) write(app, path, `unsigned:${path}`);
    write(app, `${RUNTIME}/manifest.json`, JSON.stringify(runtimeManifest));
    write(app, `${RUNTIME}/media/manifest.json`, JSON.stringify(mediaManifest));
    return { app, runtimeManifest, mediaManifest };
}

function assertRuntimeChecksums(app, originals) {
    assert.deepEqual(json(join(app, RUNTIME, "manifest.json")), {
        ...originals.runtimeManifest,
        sha256: sha256(readFileSync(join(app, NESTED_PATHS[0]))),
    });
    assert.deepEqual(json(join(app, RUNTIME, "media/manifest.json")), {
        ...originals.mediaManifest,
        sha256: sha256(readFileSync(join(app, NESTED_PATHS[1]))),
        ffprobeSha256: sha256(readFileSync(join(app, NESTED_PATHS[2]))),
    });
}

test("releaseVersion accepts five matching version declarations", (t) => {
    const root = fixture(t);
    versionFixture(root);
    assert.equal(releaseVersion(root), VERSION);
});

test("releaseVersion rejects a mismatch in each version declaration", async (t) => {
    for (const field of ["package", "tauri", "server", "desktop", "versionFile"]) {
        await t.test(field, (t) => {
            const root = fixture(t);
            versionFixture(root, { [field]: "0.9.5" });
            assert.throws(() => releaseVersion(root));
        });
    }
});

test("createUpdateManifest binds the signature and URL to the requested version", () => {
    for (const version of [VERSION, "1.2.3"]) {
        const pubDate = "2026-01-02T03:04:05.000Z";
        const signature = `fixture-signature-${version}`;
        assert.deepEqual(createUpdateManifest({ version, notes: "Mac release fixture", signature, pubDate }), {
            version,
            notes: "Mac release fixture",
            pub_date: pubDate,
            platforms: {
                "darwin-aarch64": {
                    signature,
                    url: `https://github.com/qxryz/workflowgenerator/releases/download/v${version}/WorkflowGenerator-${version}-macos-arm64.updater.tar.gz`,
                },
            },
        });
    }
});

function manifestFixture() {
    return {
        version: VERSION,
        notes: "Retain the existing release notes",
        pub_date: "2026-01-02T03:04:05.000Z",
        metadata: { channel: "stable", retained: true },
        platforms: {
            "darwin-aarch64": {
                signature: "existing-mac-signature",
                url: `https://github.com/qxryz/workflowgenerator/releases/download/v${VERSION}/WorkflowGenerator-${VERSION}-macos-arm64.updater.tar.gz`,
                retained: { minimumSystemVersion: "13.0" },
            },
            "windows-x86_64": {
                signature: "existing-windows-signature",
                url: `https://github.com/qxryz/workflowgenerator/releases/download/v${VERSION}/installer.exe`,
                retained: true,
            },
        },
    };
}

test("a same-version manifest changes only the Mac signature and leaves its input untouched", () => {
    const base = manifestFixture();
    const original = structuredClone(base);
    const actual = createUpdateManifest({ version: VERSION, signature: "replacement-mac-signature", base });
    const expected = structuredClone(original);
    expected.platforms["darwin-aarch64"].signature = "replacement-mac-signature";
    assert.deepEqual(actual, expected);
    assert.deepEqual(base, original);
    assert.notEqual(actual.platforms, base.platforms);
});

test("a same-version manifest cannot change notes or use a different version", () => {
    const base = manifestFixture();
    assert.throws(() => createUpdateManifest({ version: VERSION, notes: "Changed notes", signature: "replacement", base }));
    assert.throws(() => createUpdateManifest({ version: "0.9.5", signature: "replacement", base }));
    assert.deepEqual(validateBaseManifest(base, VERSION), base);
});

test("an existing manifest rejects incomplete and mismatched platform metadata", async (t) => {
    const mutations = {
        "missing Mac": (base) => { delete base.platforms["darwin-aarch64"]; },
        "non-HTTPS": (base) => { base.platforms["windows-x86_64"].url = "http://example.invalid/setup.exe"; },
        "wrong tag": (base) => { base.platforms["windows-x86_64"].url = "https://github.com/qxryz/workflowgenerator/releases/download/v0.9.5/setup.exe"; },
        "empty signature": (base) => { base.platforms["windows-x86_64"].signature = ""; },
        "invalid date": (base) => { base.pub_date = "not-a-date"; },
    };
    for (const [name, mutate] of Object.entries(mutations)) {
        await t.test(name, () => {
            const base = manifestFixture();
            mutate(base);
            assert.throws(() => validateBaseManifest(base, VERSION));
        });
    }
});

test("the App build retains the helper-selected target directory", () => {
    const inherited = {
        CARGO_ENCODED_RUSTFLAGS: "-C\x1fopt-level=2",
        APPLE_ID: "fixture-account",
        TAURI_SIGNING_PRIVATE_KEY: "fixture-signing-input",
        CARGO_BUILD_TARGET: "fixture-target",
    };
    const env = appBuildEnvironment(inherited);
    assert.match(env.CARGO_TARGET_DIR, /[/\\]release-build[/\\][a-f0-9]+$/);
    assert.equal(env.CARGO_ENCODED_RUSTFLAGS, inherited.CARGO_ENCODED_RUSTFLAGS);
    assert.equal(env.APPLE_ID, undefined);
    assert.equal(env.TAURI_SIGNING_PRIVATE_KEY, undefined);
    assert.equal(env.CARGO_BUILD_TARGET, undefined);
    assert.deepEqual(inherited, {
        CARGO_ENCODED_RUSTFLAGS: "-C\x1fopt-level=2",
        APPLE_ID: "fixture-account",
        TAURI_SIGNING_PRIVATE_KEY: "fixture-signing-input",
        CARGO_BUILD_TARGET: "fixture-target",
    });
});

test("updateRuntimeManifests replaces all three binary hashes and preserves other metadata", (t) => {
    const originals = runtimeFixture(fixture(t));
    for (const path of NESTED_PATHS) write(originals.app, path, `signed:${path}`);
    updateRuntimeManifests(originals.app);
    assertRuntimeChecksums(originals.app, originals);
});

test("release signing refreshes runtime checksums after nested signing and before the outer seal", (t) => {
    const root = fixture(t);
    const originals = runtimeFixture(root);
    const entitlementsPath = write(root, "bun-release.plist", "fixture-entitlements");
    const resolvedConfig = Object.freeze({ fixture: "resolved signing configuration" });
    const events = [];
    const signingApi = {
        signApplication(app, config, options) {
            assert.equal(app, originals.app);
            assert.equal(config, resolvedConfig);
            assert.deepEqual(options.nested.map(({ path }) => path), NESTED_PATHS);
            assert.equal(options.nested[0].entitlements, entitlementsPath);
            assert.equal(options.nested[1].entitlements, undefined);
            assert.equal(options.nested[2].entitlements, undefined);
            assert.equal(typeof options.afterNestedSigning, "function");

            for (const item of options.nested) {
                write(app, item.path, `signed-by-mock:${item.path}`);
                events.push(`nested:${item.path}`);
            }
            assert.equal(json(join(app, RUNTIME, "manifest.json")).sha256, originals.runtimeManifest.sha256);
            assert.equal(json(join(app, RUNTIME, "media/manifest.json")).sha256, originals.mediaManifest.sha256);
            options.afterNestedSigning();
            events.push("runtime-checksums-updated");

            // The mock outer signer sees the final bytes before it would seal them.
            assertRuntimeChecksums(app, originals);
            events.push("outer-seal");
        },
    };

    signReleaseApplication(originals.app, resolvedConfig, signingApi, entitlementsPath);
    assert.deepEqual(events, [...NESTED_PATHS.map((path) => `nested:${path}`), "runtime-checksums-updated", "outer-seal"]);
});

function sourceArchiveFixture(t, { packageVersion = VERSION, versionFile = VERSION, outsideMember = false } = {}) {
    const root = fixture(t);
    const contents = join(root, "archive-input");
    const prefix = `workflowgenerator-${VERSION}`;
    write(contents, `${prefix}/VERSION`, `v${versionFile}\n`);
    write(contents, `${prefix}/web/package.json`, JSON.stringify({ version: packageVersion }));
    write(contents, `${prefix}/LICENSE`, "Fixture source license\n");
    const members = [prefix];
    if (outsideMember) {
        write(contents, "outside.txt", "not part of the source root\n");
        members.push("outside.txt");
    }
    const source = join(root, `WorkflowGenerator-${VERSION}-source.tar.gz`);
    execFileSync("tar", ["-czf", source, "-C", contents, ...members], {
        stdio: ["ignore", "pipe", "pipe"], env: { ...process.env, COPYFILE_DISABLE: "1" },
    });
    return { root, source, sha256: sha256(readFileSync(source)) };
}

test("a verified same-version source archive is copied byte for byte", (t) => {
    const original = sourceArchiveFixture(t);
    const input = preservedSourceInput({ source: original.source, version: VERSION, sha256: original.sha256 });
    assert.deepEqual(input, {
        path: realpathSync(original.source), name: basename(original.source), sha256: original.sha256,
    });
    const destination = join(original.root, "output", basename(original.source));
    mkdirSync(dirname(destination));
    assert.equal(copyPreservedSource(input, destination), true);
    assert.deepEqual(readFileSync(destination), readFileSync(original.source));
});

test("a preserved source archive requires its expected digest and versioned filename", (t) => {
    const original = sourceArchiveFixture(t);
    assert.throws(() => preservedSourceInput({ source: original.source, version: VERSION, sha256: "0".repeat(64) }));
    assert.throws(() => preservedSourceInput({ source: original.source, version: VERSION }));
    const renamed = write(original.root, "other-source.tar.gz", readFileSync(original.source));
    assert.throws(() => preservedSourceInput({ source: renamed, version: VERSION, sha256: original.sha256 }));
});

test("a preserved source archive rejects mismatched embedded versions", async (t) => {
    for (const field of ["packageVersion", "versionFile"]) {
        await t.test(field, (t) => {
            const original = sourceArchiveFixture(t, { [field]: "0.9.5" });
            assert.throws(() => preservedSourceInput({ source: original.source, version: VERSION, sha256: original.sha256 }));
        });
    }
});

test("a preserved source archive rejects members outside its versioned root", (t) => {
    const original = sourceArchiveFixture(t, { outsideMember: true });
    assert.throws(() => preservedSourceInput({ source: original.source, version: VERSION, sha256: original.sha256 }));
});

test("a preserved source input cannot change after validation", (t) => {
    const original = sourceArchiveFixture(t);
    const input = preservedSourceInput({ source: original.source, version: VERSION, sha256: original.sha256 });
    writeFileSync(original.source, Buffer.concat([readFileSync(original.source), Buffer.from("changed input")]));
    const destination = join(original.root, "output", basename(original.source));
    mkdirSync(dirname(destination));
    assert.throws(() => copyPreservedSource(input, destination));
    assert.equal(existsSync(destination), false);
});

function readyResult(names) {
    return {
        status: "READY",
        version: VERSION,
        sourceCommit: "a".repeat(40),
        assets: names.map((name) => ({ name, sha256: "b".repeat(64), size: 0 })),
    };
}

test("assertReadyAssets accepts an exact READY asset set", () => {
    const expected = ["app.zip", "app.dmg", "latest.json"];
    assert.doesNotThrow(() => assertReadyAssets(readyResult([...expected].reverse()), expected));
});

test("assertReadyAssets rejects pending results and incomplete or unexpected asset sets", async (t) => {
    const expected = ["app.zip", "app.dmg", "latest.json"];
    const cases = [
        ["pending", { ...readyResult(expected), status: "PENDING" }],
        ["notarization still in progress", { ...readyResult(expected), status: "In Progress" }],
        ["missing asset", readyResult(expected.slice(1))],
        ["extra asset", readyResult([...expected, "source.tar.gz"])],
        ["duplicate asset", readyResult([...expected, expected[0]])],
        ["relative path", readyResult(["../app.zip", ...expected.slice(1)])],
        ["absolute path", readyResult(["/app.zip", ...expected.slice(1)])],
        ["nested path", readyResult(["folder/app.zip", ...expected.slice(1)])],
    ];
    for (const [name, result] of cases) {
        await t.test(name, () => assert.throws(() => assertReadyAssets(result, expected)));
    }
});

function checksumEntries(path) {
    return Object.fromEntries(readFileSync(path, "utf8").trim().split("\n").map((line) => {
        const match = line.match(/^([a-f0-9]{64})\s+(.+)$/);
        assert.ok(match, "checksum row must contain a SHA256 and filename");
        return [match[2], match[1]];
    }));
}

test("writeReleaseChecksums hashes the final asset bytes after they change", (t) => {
    const root = fixture(t);
    const assets = ["release.dmg", "latest.json"];
    write(root, assets[0], "before-notarization-ticket");
    write(root, assets[1], '{"version":"0.9.4"}\n');
    const first = writeReleaseChecksums(root, assets);
    assert.equal(first, join(root, "SHA256SUMS.txt"));
    const before = checksumEntries(first);
    assert.deepEqual(before, Object.fromEntries(assets.map((name) => [name, sha256(readFileSync(join(root, name)))])));

    write(root, assets[0], "after-notarization-ticket");
    const second = writeReleaseChecksums(root, assets);
    const after = checksumEntries(second);
    assert.equal(second, first);
    assert.equal(after[assets[0]], sha256(readFileSync(join(root, assets[0]))));
    assert.notEqual(after[assets[0]], before[assets[0]]);
    assert.equal(after[assets[1]], before[assets[1]]);
});

const GIT_FIXTURE_OPTIONS = [
    "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false",
    "-c", "user.name=Release Test Fixture",
    "-c", "user.email=release-fixture@example.invalid",
];

function git(root, ...args) {
    return execFileSync("git", [...GIT_FIXTURE_OPTIONS, "-C", root, ...args], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" },
    }).trim();
}

function sourceFixture(t) {
    const workspace = fixture(t);
    const repo = join(workspace, "source");
    mkdirSync(repo);
    git(repo, "init", "--quiet");
    git(repo, "config", "--local", "core.hooksPath", "/dev/null");
    git(repo, "config", "--local", "core.fsmonitor", "false");
    git(repo, "config", "--local", "commit.gpgsign", "false");
    write(repo, "tracked.txt", "baseline source\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "--quiet", "-m", "fixture: baseline");
    return { workspace, repo, sourceCommit: git(repo, "rev-parse", "HEAD") };
}

test("post-build source changes stop the pre-signing guard before signing or READY", (t) => {
    const { repo, sourceCommit } = sourceFixture(t);
    const calls = { sign: 0, markReady: 0 };
    const session = { markReady() { calls.markReady++; return readyResult(["release.zip"]); } };
    write(repo, "tracked.txt", "source changed during build\n");

    assert.throws(() => {
        assertSourceUnchanged(repo, sourceCommit);
        calls.sign++; // The offline stand-in for the pipeline's next signing step.
        markReadyForSource(session, repo, sourceCommit, [], ["release.zip"]);
    });
    assert.deepEqual(calls, { sign: 0, markReady: 0 });
});

test("a clean new HEAD after waiting cannot mark the previous source READY", (t) => {
    const { repo, sourceCommit } = sourceFixture(t);
    write(repo, "tracked.txt", "new committed source\n");
    git(repo, "add", "tracked.txt");
    git(repo, "commit", "--quiet", "-m", "fixture: source advanced while waiting");
    assert.equal(git(repo, "status", "--porcelain"), "");
    assert.notEqual(git(repo, "rev-parse", "HEAD"), sourceCommit);
    let readyCalls = 0;
    const session = { markReady() { readyCalls++; return readyResult(["release.zip"]); } };

    assert.throws(() => markReadyForSource(session, repo, sourceCommit, [], ["release.zip"]));
    assert.equal(readyCalls, 0);
});

test("uncommitted source added while waiting cannot be marked READY", (t) => {
    const { repo, sourceCommit } = sourceFixture(t);
    write(repo, "new-source.mjs", "export const changed = true;\n");
    assert.equal(git(repo, "rev-parse", "HEAD"), sourceCommit);
    let readyCalls = 0;
    const session = { markReady() { readyCalls++; return readyResult(["release.zip"]); } };

    assert.throws(() => markReadyForSource(session, repo, sourceCommit, [], ["release.zip"]));
    assert.equal(readyCalls, 0);
});

test("unchanged source permits READY only after passing the exact asset whitelist", (t) => {
    const { workspace, repo, sourceCommit } = sourceFixture(t);
    const names = ["release.zip", "latest.json"];
    const paths = names.map((name) => write(workspace, `assets/${name}`, `fixture:${name}`));
    const calls = [];
    const session = {
        markReady(assetPaths) {
            calls.push(assetPaths);
            return {
                status: "READY",
                version: VERSION,
                sourceCommit,
                assets: assetPaths.map((path) => ({
                    name: basename(path),
                    sha256: sha256(readFileSync(path)),
                    size: readFileSync(path).length,
                })),
            };
        },
    };

    const app = join(workspace, "WorkflowGenerator.app");
    write(app, "Contents/MacOS/fixture", "portable application bytes\n");
    assert.equal(assertSourceUnchanged(repo, sourceCommit), true);
    assert.doesNotThrow(() => markReadyForSource(session, repo, sourceCommit, paths, names, { app }));
    assert.deepEqual(calls, [paths]);
});

test("unchanged source cannot mark a bundle with host paths READY", (t) => {
    const { workspace, repo, sourceCommit } = sourceFixture(t);
    const home = join(workspace, "build-home");
    const app = join(workspace, "WorkflowGenerator.app");
    mkdirSync(home);
    write(app, "Contents/MacOS/fixture", `source location: ${home}/.cargo/registry/src/fixture/src/lib.rs\n`);
    let readyCalls = 0;
    const session = { markReady() { readyCalls++; return readyResult(["release.zip"]); } };

    assert.equal(assertSourceUnchanged(repo, sourceCommit), true);
    assert.throws(() => markReadyForSource(session, repo, sourceCommit, [], ["release.zip"], { app, home }));
    assert.equal(readyCalls, 0);
});

test("the release CLI runs through direct, symlink, and available /var entry paths", async (t) => {
    const script = fileURLToPath(new URL("../scripts/package-release.mjs", import.meta.url));
    const root = realpathSync(fixture(t));
    const symlink = join(root, "release-cli-alias.mjs");
    symlinkSync(script, symlink);
    const varAlias = symlink.startsWith("/private/var/") ? symlink.slice("/private".length) : undefined;
    const entries = [["direct", script], ["symlink", symlink], ["/var alias", varAlias]];
    for (const [name, entry] of entries) {
        await t.test(name, (t) => {
            if (!entry || !existsSync(entry)) return t.skip("A /var alias is not available on this host");
            for (const flag of ["--help", "-h"]) {
                const help = spawnSync(process.execPath, [entry, flag], {
                    encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
                });
                assert.ifError(help.error);
                assert.equal(help.status, 0, `${name} ${flag} must succeed`);
                assert.match(help.stdout, /usage/i, `${name} ${flag} must not silently skip the CLI`);
            }
            const unsupported = spawnSync(process.execPath, [entry, "--unsupported-fixture"], {
                encoding: "utf8", timeout: 10_000, stdio: ["ignore", "pipe", "pipe"],
            });
            assert.ifError(unsupported.error);
            assert.equal(unsupported.status, 1, `${name} must reject unsupported arguments`);
            assert.match(unsupported.stderr, /\S/, `${name} must explain the rejected argument`);
        });
    }
});
