#!/usr/bin/env node
// Packages a signed macOS release of the current commit, or checks a published one.
//
//   node scripts/package-release.mjs --notes "一句话更新说明" [--out <dir>]
//   node scripts/package-release.mjs --verify-remote
//
// Packaging builds the app with the updater key, verifies the update signature
// against the public key in tauri.conf.json (the same check the in-app updater
// makes), then writes DMG, ZIP, updater archive + signature, source archive,
// latest.json and SHA256SUMS.txt. The key comes from TAURI_SIGNING_PRIVATE_KEY
// or the macOS Keychain item "WorkflowGenerator Updater Key"; it is never printed.
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const web = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const repo = resolve(web, "..");
const REPO = "qxryz/workflowgenerator";
const PLATFORM = "darwin-aarch64";
const KEYCHAIN_SERVICE = "WorkflowGenerator Updater Key";

const args = process.argv.slice(2);
const option = (name) => {
    const index = args.indexOf(name);
    return index >= 0 ? args[index + 1] : undefined;
};
const run = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { stdio: "inherit", ...options });
const output = (command, commandArgs, options = {}) => execFileSync(command, commandArgs, { encoding: "utf8", ...options }).trim();
const fail = (message) => {
    console.error(`✗ ${message}`);
    process.exit(1);
};

const tauriConfig = JSON.parse(readFileSync(join(web, "src-tauri/tauri.conf.json"), "utf8"));

/** Every place that names the version must agree before anything is built. */
function releaseVersion() {
    const cargo = (path) => readFileSync(join(web, path), "utf8").match(/^version = "([^"]+)"/m)?.[1];
    const found = {
        "web/package.json": JSON.parse(readFileSync(join(web, "package.json"), "utf8")).version,
        "web/src-tauri/tauri.conf.json": tauriConfig.version,
        "web/server/Cargo.toml": cargo("server/Cargo.toml"),
        "web/src-tauri/Cargo.toml": cargo("src-tauri/Cargo.toml"),
        VERSION: readFileSync(join(repo, "VERSION"), "utf8").trim().replace(/^v/, ""),
    };
    const versions = new Set(Object.values(found));
    if (versions.size !== 1) fail(`版本号不一致：${JSON.stringify(found)}`);
    return [...versions][0];
}

/** Minisign verification of a Tauri update signature (base64 of the .sig text). */
function verifyUpdateSignature(file, signatureBase64) {
    const decode = (text) => Buffer.from(text.trim(), "base64");
    const keyLines = decode(tauriConfig.plugins.updater.pubkey).toString("utf8").split("\n");
    const key = decode(keyLines[1]);
    const lines = decode(signatureBase64).toString("utf8").split("\n");
    const signature = decode(lines[1]);
    const trusted = lines[2].replace(/^trusted comment: /, "");
    const globalSignature = decode(lines[3]);
    if (!key.subarray(2, 10).equals(signature.subarray(2, 10))) fail("更新包签名所用的密钥与配置中的公钥不匹配");
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10, 42)]), format: "der", type: "spki" });
    const body = readFileSync(file);
    const message = signature.subarray(0, 2).toString() === "ED" ? createHash("blake2b512").update(body).digest() : body;
    if (!verify(null, message, publicKey, signature.subarray(10, 74))) fail(`更新包签名验证失败：${file}`);
    if (!verify(null, Buffer.concat([signature.subarray(10, 74), Buffer.from(trusted)]), publicKey, globalSignature)) fail("更新包签名的附带说明验证失败");
    return Buffer.from(key.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

function signingKey() {
    if (process.env.TAURI_SIGNING_PRIVATE_KEY) return process.env.TAURI_SIGNING_PRIVATE_KEY;
    try {
        return output("security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
    } catch {
        fail(`找不到更新签名私钥：设置 TAURI_SIGNING_PRIVATE_KEY，或在钥匙串中保存“${KEYCHAIN_SERVICE}”`);
    }
}

async function verifyRemote() {
    const version = releaseVersion();
    const response = await fetch(`https://github.com/${REPO}/releases/latest/download/latest.json`);
    if (!response.ok) fail(`读取线上更新清单失败（${response.status}）`);
    const manifest = await response.json();
    if (manifest.version !== version) fail(`线上最新版本是 ${manifest.version}，本地是 ${version}`);
    const entry = manifest.platforms?.[PLATFORM];
    if (!entry?.url || !entry.signature) fail(`更新清单缺少 ${PLATFORM}`);
    const archive = await fetch(entry.url);
    if (!archive.ok) fail(`下载更新包失败（${archive.status}）`);
    const scratch = mkdtempSync(join(tmpdir(), "wg-release-"));
    const file = join(scratch, "update.tar.gz");
    writeFileSync(file, Buffer.from(await archive.arrayBuffer()));
    const keyId = verifyUpdateSignature(file, entry.signature);
    rmSync(scratch, { recursive: true, force: true });
    console.log(`✓ 线上 v${version} 更新清单与更新包签名有效（密钥 ${keyId}）`);
}

function packageRelease() {
    const version = releaseVersion();
    const notes = option("--notes");
    if (!notes) fail("请用 --notes 提供更新清单里的一句话说明");
    if (output("git", ["status", "--porcelain"], { cwd: repo })) fail("工作区有未提交的修改；发布包必须对应一个提交");
    const out = resolve(option("--out") || join(repo, "..", "snapshots", `release-v${version}`));
    mkdirSync(out, { recursive: true });

    run("npm", ["run", "desktop:build"], { cwd: web, env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: signingKey(), TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" } });
    const bundle = join(web, "src-tauri/target/release/bundle/macos");
    const app = join(bundle, "WorkflowGenerator.app");
    for (const path of [app, join(app, "Contents/Resources/runtime/opencode"), join(app, "Contents/Resources/runtime/media/ffmpeg"), `${app}.tar.gz`, `${app}.tar.gz.sig`]) {
        if (!existsSync(path)) fail(`构建产物缺失：${path}`);
    }

    const name = `WorkflowGenerator-${version}-macos-arm64`;
    const updater = join(out, `${name}.updater.tar.gz`);
    cpSync(`${app}.tar.gz`, updater);
    const signature = readFileSync(`${app}.tar.gz.sig`, "utf8").trim();
    writeFileSync(`${updater}.sig`, signature);
    const keyId = verifyUpdateSignature(updater, signature);

    rmSync(join(out, `${name}.zip`), { force: true });
    run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, join(out, `${name}.zip`)]);
    const staging = mkdtempSync(join(tmpdir(), "wg-dmg-"));
    run("ditto", [app, join(staging, "WorkflowGenerator.app")]);
    symlinkSync("/Applications", join(staging, "Applications"));
    run("hdiutil", ["create", "-quiet", "-volname", "WorkflowGenerator", "-srcfolder", staging, "-ov", "-format", "UDZO", join(out, `${name}.dmg`)]);
    rmSync(staging, { recursive: true, force: true });
    run("git", ["archive", "--format=tar.gz", `--prefix=workflowgenerator-${version}/`, "-o", join(out, `WorkflowGenerator-${version}-source.tar.gz`), "HEAD"], { cwd: repo });

    const manifest = {
        version,
        notes,
        pub_date: new Date().toISOString(),
        platforms: { [PLATFORM]: { signature, url: `https://github.com/${REPO}/releases/download/v${version}/${name}.updater.tar.gz` } },
    };
    writeFileSync(join(out, "latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    const assets = [`${name}.dmg`, `${name}.zip`, `${name}.updater.tar.gz`, `${name}.updater.tar.gz.sig`, `WorkflowGenerator-${version}-source.tar.gz`, "latest.json"];
    const sums = assets.map((asset) => `${createHash("sha256").update(readFileSync(join(out, asset))).digest("hex")}  ${asset}`);
    writeFileSync(join(out, "SHA256SUMS.txt"), `${sums.join("\n")}\n`);

    console.log(`✓ v${version}（${output("git", ["rev-parse", "--short", "HEAD"], { cwd: repo })}）已打包到 ${out}`);
    console.log(`  更新签名有效，密钥 ${keyId}；附件：${[...assets, "SHA256SUMS.txt"].join("、")}`);
}

if (args.includes("--verify-remote")) await verifyRemote();
else packageRelease();
