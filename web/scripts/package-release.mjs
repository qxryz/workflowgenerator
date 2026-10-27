#!/usr/bin/env node
// Local release entry point. Upload only the READY session's assets whitelist.
import { createHash, createPublicKey, verify } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { fileURLToPath } from "node:url";

const scripts = dirname(fileURLToPath(import.meta.url));
const web = resolve(scripts, "..");
const repo = resolve(web, "..");
const REPOSITORY = "qxryz/workflowgenerator";
const PLATFORM = "darwin-aarch64";
const KEYCHAIN_SERVICE = "WorkflowGenerator Updater Key";
const APP_NAME = "WorkflowGenerator.app";
const RUNTIME_PATHS = ["Contents/Resources/runtime/opencode", "Contents/Resources/runtime/media/ffmpeg", "Contents/Resources/runtime/media/ffprobe"];
const fail = (message) => { throw new Error(message); };
const hashFile = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));

function capture(label, command, args, options = {}) {
    try {
        return execFileSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024, ...options }).trim();
    } catch (error) {
        // Signer stdout/stderr and its environment are deliberately not logged.
        fail(`${label}失败（退出码 ${error.status ?? error.code ?? "unknown"}）`);
    }
}

function run(command, args, options = {}) {
    execFileSync(command, args, { stdio: "inherit", ...options });
}

export function releaseVersion(repoRoot = repo) {
    const cargo = (path) => readFileSync(join(repoRoot, path), "utf8").match(/^version\s*=\s*"([^"]+)"/m)?.[1];
    const versions = {
        "web/package.json": json(join(repoRoot, "web/package.json")).version,
        "web/src-tauri/tauri.conf.json": json(join(repoRoot, "web/src-tauri/tauri.conf.json")).version,
        "web/server/Cargo.toml": cargo("web/server/Cargo.toml"),
        "web/src-tauri/Cargo.toml": cargo("web/src-tauri/Cargo.toml"),
        VERSION: readFileSync(join(repoRoot, "VERSION"), "utf8").trim().replace(/^v/, ""),
    };
    const values = Object.values(versions);
    if (values.some((value) => typeof value !== "string" || !value) || new Set(values).size !== 1) fail(`版本号不一致：${JSON.stringify(versions)}`);
    return values[0];
}

export function verifyUpdateSignature(file, signatureBase64, publicKeyBase64) {
    const decode = (value) => Buffer.from(value.trim(), "base64");
    const keyLines = decode(publicKeyBase64).toString("utf8").split(/\r?\n/);
    const lines = decode(signatureBase64).toString("utf8").split(/\r?\n/);
    if (keyLines.length < 2 || lines.length < 4 || !lines[2].startsWith("trusted comment: ")) fail("更新签名格式无效");
    const key = decode(keyLines[1]);
    const signature = decode(lines[1]);
    const globalSignature = decode(lines[3]);
    if (key.length !== 42 || signature.length !== 74 || globalSignature.length !== 64 || !key.subarray(2, 10).equals(signature.subarray(2, 10))) fail("更新签名与配置中的公钥不匹配");
    const algorithm = signature.subarray(0, 2).toString();
    if (!["Ed", "ED"].includes(algorithm)) fail("不支持的更新签名算法");
    const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), key.subarray(10, 42)]), format: "der", type: "spki" });
    const body = readFileSync(file);
    const message = algorithm === "ED" ? createHash("blake2b512").update(body).digest() : body;
    const trusted = lines[2].slice("trusted comment: ".length);
    if (!verify(null, message, publicKey, signature.subarray(10, 74))) fail("更新包签名验证失败");
    if (!verify(null, Buffer.concat([signature.subarray(10, 74), Buffer.from(trusted)]), publicKey, globalSignature)) fail("更新签名的附带说明验证失败");
    return Buffer.from(key.subarray(2, 10)).reverse().toString("hex").toUpperCase();
}

export function updateRuntimeManifests(app) {
    const runtime = join(app, "Contents/Resources/runtime");
    const manifestPath = join(runtime, "manifest.json");
    const mediaPath = join(runtime, "media/manifest.json");
    const manifest = { ...json(manifestPath), sha256: hashFile(join(runtime, "opencode")) };
    const media = { ...json(mediaPath), sha256: hashFile(join(runtime, "media/ffmpeg")), ffprobeSha256: hashFile(join(runtime, "media/ffprobe")) };
    writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    writeFileSync(mediaPath, `${JSON.stringify(media, null, 2)}\n`);
}

export function signReleaseApplication(app, config, signingApi, entitlements = join(scripts, "entitlements-bun.plist")) {
    return signingApi.signApplication(app, config, {
        nested: RUNTIME_PATHS.map((path, index) => index === 0 ? { path, entitlements } : { path }),
        afterNestedSigning: () => updateRuntimeManifests(app),
    });
}

function verifyRuntimeManifests(app) {
    const runtime = join(app, "Contents/Resources/runtime");
    const manifest = json(join(runtime, "manifest.json"));
    const media = json(join(runtime, "media/manifest.json"));
    if (manifest.sha256 !== hashFile(join(runtime, "opencode")) || media.sha256 !== hashFile(join(runtime, "media/ffmpeg")) || media.ffprobeSha256 !== hashFile(join(runtime, "media/ffprobe"))) fail("内嵌运行组件的校验值不匹配");
    return true;
}

export function createUpdateManifest({ version, notes, signature, pubDate = new Date().toISOString() }) {
    if (!version || !notes || !signature || Number.isNaN(Date.parse(pubDate))) fail("更新清单缺少版本、说明、签名或有效日期");
    return {
        version, notes, pub_date: pubDate,
        platforms: { [PLATFORM]: { signature, url: `https://github.com/${REPOSITORY}/releases/download/v${version}/WorkflowGenerator-${version}-macos-arm64.updater.tar.gz` } },
    };
}

function assetNames(names) {
    if (!Array.isArray(names) || !names.length || new Set(names).size !== names.length || names.some((name) => typeof name !== "string" || !name || basename(name) !== name || name.includes("\\") || name === "." || name === "..")) fail("发布附件必须是唯一的直接子文件名");
    return names;
}

const checksumContents = (directory, names) => `${assetNames(names).map((name) => `${hashFile(join(directory, name))}  ${name}`).join("\n")}\n`;

export function writeReleaseChecksums(directory, names) {
    const path = join(directory, "SHA256SUMS.txt");
    writeFileSync(path, checksumContents(directory, names));
    return path;
}

export function assertReadyAssets(result, expectedNames) {
    assetNames(expectedNames);
    if (result?.status !== "READY" || !Array.isArray(result.assets)) fail("发布会话尚未 READY，不可上传附件");
    const actualNames = assetNames(result.assets.map((asset) => asset?.name));
    if (!isDeepStrictEqual([...actualNames].sort(), [...expectedNames].sort()) || result.assets.some((asset) => !/^[a-f0-9]{64}$/.test(asset.sha256 ?? "") || !Number.isSafeInteger(asset.size) || asset.size < 0)) fail("READY 附件与发布白名单不一致");
    return result;
}

export function assertSourceUnchanged(repoRoot, sourceCommit) {
    if (typeof sourceCommit !== "string" || !sourceCommit) fail("发布会话缺少已捕获的源码提交");
    const head = capture("复核源码提交", "git", ["rev-parse", "--verify", "HEAD"], { cwd: repoRoot });
    if (head !== sourceCommit) fail("源码提交已在发布期间改变；停止签名或标记 READY，请恢复对应提交后继续");
    const changes = capture("复核源码工作区", "git", ["status", "--porcelain"], { cwd: repoRoot });
    if (changes) fail("源码工作区已在发布期间改变；停止签名或标记 READY，请清理对应修改后继续");
    return true;
}

export function markReadyForSource(session, repoRoot, sourceCommit, assets, expectedNames) {
    assertSourceUnchanged(repoRoot, sourceCommit);
    return assertReadyAssets(session.markReady(assets), expectedNames);
}

function updaterSigner(config, version) {
    const cli = join(web, "node_modules/.bin/tauri");
    if (!existsSync(cli)) fail("缺少已安装的 Tauri CLI；请按现有锁文件安装依赖");
    const supportsVersion = capture("检查 Tauri 签名能力", cli, ["signer", "sign", "--help"], { cwd: web }).includes("--app-version");
    return (file) => {
        const env = { ...process.env };
        delete env.TAURI_SIGNING_PRIVATE_KEY_PATH;
        env.TAURI_SIGNING_PRIVATE_KEY = process.env.TAURI_SIGNING_PRIVATE_KEY || capture("读取现有更新签名密钥", "security", ["find-generic-password", "-s", KEYCHAIN_SERVICE, "-w"]);
        env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "";
        if (!env.TAURI_SIGNING_PRIVATE_KEY) fail("现有更新签名密钥不可用");
        const args = ["signer", "sign"];
        if (supportsVersion) args.push("--app-version", version);
        args.push(file);
        try { capture("更新包签名", cli, args, { cwd: web, env }); }
        finally { delete env.TAURI_SIGNING_PRIVATE_KEY; delete env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD; }
        const signature = readFileSync(`${file}.sig`, "utf8").trim();
        verifyUpdateSignature(file, signature, config.plugins.updater.pubkey);
        return signature;
    };
}

function preflightUpdater(config, version) {
    const signer = updaterSigner(config, version);
    const temporary = mkdtempSync(join(tmpdir(), "wg-updater-preflight-"));
    try {
        const fixture = join(temporary, "fixture.txt");
        writeFileSync(fixture, "WorkflowGenerator updater signing preflight\n", { mode: 0o600 });
        signer(fixture);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    return signer;
}

function verifyBuiltApp(app, version) {
    for (const relative of ["Contents/Info.plist", "Contents/MacOS/workflowgenerator-desktop", ...RUNTIME_PATHS, "Contents/Resources/runtime/manifest.json", "Contents/Resources/runtime/media/manifest.json"]) {
        if (!existsSync(join(app, relative))) fail(`构建产物缺失：${relative}`);
    }
    const actualVersion = capture("检查应用版本", "/usr/libexec/PlistBuddy", ["-c", "Print :CFBundleShortVersionString", join(app, "Contents/Info.plist")]);
    if (actualVersion !== version) fail("应用版本与源码版本不一致");
    const architectures = capture("检查应用架构", "lipo", ["-archs", join(app, "Contents/MacOS/workflowgenerator-desktop")]).split(/\s+/);
    if (!isDeepStrictEqual(architectures, ["arm64"])) fail("正式发布应用必须是 Apple Silicon arm64 构建");
    return true;
}

function appContentsHash(app) {
    const digest = createHash("sha256");
    const visit = (relative) => {
        for (const name of readdirSync(join(app, relative)).sort()) {
            const path = join(relative, name);
            const absolute = join(app, path);
            const stat = lstatSync(absolute);
            if (stat.isSymbolicLink()) digest.update(`link:${path}:${readlinkSync(absolute)}\n`);
            else if (stat.isDirectory()) visit(path);
            else if (stat.isFile()) digest.update(`file:${path}:${hashFile(absolute)}\n`);
            else fail("应用包含不支持的文件类型");
        }
    };
    visit("");
    return digest.digest("hex");
}

function verifyArchive(archive, app, format, config, api, version) {
    const temporary = mkdtempSync(join(tmpdir(), "wg-release-verify-"));
    try {
        const zip = format === "zip";
        const members = capture("检查压缩包路径", zip ? "unzip" : "tar", zip ? ["-Z1", archive] : ["-tzf", archive]).split("\n").filter(Boolean);
        if (!members.length) fail("发布压缩包为空");
        for (const member of members) {
            const name = member.replace(/^\.\//, "");
            const metadata = zip ? name === "__MACOSX/" || name.startsWith("__MACOSX/") : name === `._${APP_NAME}`;
            if (name.startsWith("/") || name.includes("\0") || name.split("/").includes("..") || !(name === APP_NAME || name.startsWith(`${APP_NAME}/`) || metadata)) fail("发布压缩包包含无效路径");
        }
        if (zip) capture("解包 ZIP 验证", "ditto", ["-xk", archive, temporary]);
        else {
            const env = { ...process.env };
            delete env.COPYFILE_DISABLE;
            capture("解包更新包验证", "tar", ["--mac-metadata", "--xattrs", "-xzf", archive, "-C", temporary], { env });
        }
        const extracted = join(temporary, APP_NAME);
        verifyBuiltApp(extracted, version);
        api.verifyApplication(extracted, config, { notarized: true });
        if (appContentsHash(extracted) !== appContentsHash(app)) fail("压缩包内的应用与最终公证应用不一致");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
    return true;
}

function appBuildEnvironment() {
    const env = { ...process.env };
    // This build only prepares an ad-hoc App; the explicit release pipeline owns
    // all Developer ID signing and notarization after the isolated copy is made.
    for (const key of ["TAURI_SIGNING_PRIVATE_KEY", "TAURI_SIGNING_PRIVATE_KEY_PATH", "TAURI_SIGNING_PRIVATE_KEY_PASSWORD", "APPLE_SIGNING_IDENTITY", "APPLE_CERTIFICATE", "APPLE_CERTIFICATE_PASSWORD", "APPLE_API_ISSUER", "APPLE_API_KEY", "APPLE_API_KEY_PATH", "APPLE_ID", "APPLE_PASSWORD", "APPLE_ID_PASSWORD", "APPLE_TEAM_ID"]) delete env[key];
    return env;
}

function createDmg(app, destination, workDir, config, api) {
    const temporary = mkdtempSync(join(workDir, "dmg-"));
    try {
        const contents = join(temporary, "contents");
        mkdirSync(contents);
        const copy = join(contents, APP_NAME);
        capture("暂存公证应用", "ditto", [app, copy]);
        api.verifyApplication(copy, config, { notarized: true });
        if (appContentsHash(copy) !== appContentsHash(app)) fail("磁盘映像中的应用副本不一致");
        symlinkSync("/Applications", join(contents, "Applications"));
        const dmg = join(temporary, "release.dmg");
        capture("创建磁盘映像", "hdiutil", ["create", "-quiet", "-volname", "WorkflowGenerator", "-srcfolder", contents, "-format", "UDZO", dmg]);
        api.signDiskImage(dmg, config);
        renameSync(dmg, destination);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}

async function verifyRemote() {
    const version = releaseVersion();
    const config = json(join(web, "src-tauri/tauri.conf.json"));
    const response = await fetch(`https://github.com/${REPOSITORY}/releases/latest/download/latest.json`);
    if (!response.ok) fail(`读取线上更新清单失败（${response.status}）`);
    const manifest = await response.json();
    if (manifest.version !== version) fail(`线上最新版本是 ${manifest.version}，本地是 ${version}`);
    const entry = manifest.platforms?.[PLATFORM];
    if (!entry?.url || !entry.signature) fail(`更新清单缺少 ${PLATFORM}`);
    const archive = await fetch(entry.url);
    if (!archive.ok) fail(`下载更新包失败（${archive.status}）`);
    const temporary = mkdtempSync(join(tmpdir(), "wg-remote-release-"));
    try {
        const file = join(temporary, "update.tar.gz");
        writeFileSync(file, Buffer.from(await archive.arrayBuffer()));
        const keyId = verifyUpdateSignature(file, entry.signature, config.plugins.updater.pubkey);
        console.log(`✓ 线上 v${version} 更新清单与更新包签名有效（密钥 ${keyId}）`);
    } finally { rmSync(temporary, { recursive: true, force: true }); }
}

function packageRelease(api, { version, sourceCommit, config, signing, signer, notes, outDir }) {
    const session = api.createReleaseSession({ outDir, version, sourceCommit, resume: true });
    try {
        assertSourceUnchanged(repo, sourceCommit);
        const app = join(session.workDir, APP_NAME);
        const name = `WorkflowGenerator-${version}-macos-arm64`;
        const names = [`${name}.dmg`, `${name}.zip`, `${name}.updater.tar.gz`, `${name}.updater.tar.gz.sig`, `WorkflowGenerator-${version}-source.tar.gz`, "latest.json"];
        const path = (asset) => join(session.assetsDir, asset);
        const updater = path(names[2]);
        const signature = () => readFileSync(`${updater}.sig`, "utf8").trim();

        session.step("build-app", () => {
            const env = appBuildEnvironment();
            env.CARGO_TARGET_DIR = join(web, "src-tauri/target");
            run("npm", ["run", "desktop:build", "--", "--config", join(scripts, "tauri.release-build.json"), "--target", "aarch64-apple-darwin", "--bundles", "app"], { cwd: web, env });
            const built = join(env.CARGO_TARGET_DIR, "aarch64-apple-darwin/release/bundle/macos", APP_NAME);
            verifyBuiltApp(built, version);
            rmSync(app, { recursive: true, force: true });
            capture("复制构建应用到发布会话", "ditto", [built, app]);
        }, () => verifyBuiltApp(app, version));
        // Building can take long enough for another process to edit or commit.
        assertSourceUnchanged(repo, sourceCommit);
        session.step("sign-app", () => signReleaseApplication(app, signing, api), () => {
            verifyRuntimeManifests(app);
            api.verifyApplication(app, signing, { notarized: false });
            return true;
        });
        session.step("notarize-app", () => api.notarizeAndStaple(app, signing, { stateDir: join(session.stateDir, "app") }), () => {
            api.verifyApplication(app, signing, { notarized: true });
            return true;
        });
        session.step("zip", () => capture("创建 ZIP", "ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, path(names[1])]), () => verifyArchive(path(names[1]), app, "zip", signing, api, version));
        session.step("updater", () => {
            const env = { ...process.env };
            delete env.COPYFILE_DISABLE;
            capture("创建最终更新包", "tar", ["--format", "pax", "--mac-metadata", "--xattrs", "--uid", "0", "--gid", "0", "--uname", "root", "--gname", "wheel", "-czf", updater, "-C", session.workDir, APP_NAME], { env });
            signer(updater);
        }, () => {
            verifyUpdateSignature(updater, signature(), config.plugins.updater.pubkey);
            return verifyArchive(updater, app, "tar.gz", signing, api, version);
        });
        session.step("dmg", () => createDmg(app, path(names[0]), session.workDir, signing, api), () => {
            api.verifyDiskImage(path(names[0]), signing, { notarized: false });
            return true;
        });
        session.step("notarize-dmg", () => api.notarizeAndStaple(path(names[0]), signing, { stateDir: join(session.stateDir, "dmg") }), () => {
            api.verifyDiskImage(path(names[0]), signing, { notarized: true });
            return true;
        });
        const sourceProof = join(session.workDir, "source-archive-proof.json");
        session.step("metadata-and-source", () => {
            const manifest = createUpdateManifest({ version, notes, signature: signature() });
            writeFileSync(path("latest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
            capture("导出当前提交源码", "git", ["archive", "--format=tar.gz", `--prefix=workflowgenerator-${version}/`, "-o", path(names[4]), sourceCommit], { cwd: repo });
            writeFileSync(sourceProof, `${JSON.stringify({ sourceCommit, sha256: hashFile(path(names[4])) })}\n`);
        }, () => {
            const manifest = json(path("latest.json"));
            if (!isDeepStrictEqual(manifest, createUpdateManifest({ version, notes, signature: signature(), pubDate: manifest.pub_date }))) fail("更新清单与最终更新包不一致");
            const proof = json(sourceProof);
            if (proof.sourceCommit !== sourceCommit || proof.sha256 !== hashFile(path(names[4]))) fail("源码附件与本发布会话记录不一致");
            return true;
        });
        session.step("checksums", () => writeReleaseChecksums(session.assetsDir, names), () => {
            if (readFileSync(path("SHA256SUMS.txt"), "utf8") !== checksumContents(session.assetsDir, names)) fail("最终附件的 SHA256 不一致");
            return true;
        });
        const whitelist = [...names, "SHA256SUMS.txt"];
        // Apple may have processed this session for a long time. Bind READY to
        // the same clean source captured before the build, not the current HEAD.
        const ready = markReadyForSource(session, repo, sourceCommit, whitelist.map(path), whitelist);
        console.log(`✓ v${version}（${sourceCommit.slice(0, 12)}）已 READY：${session.assetsDir}`);
        console.log(`  只上传 release-assets.json 白名单中的 ${ready.assets.length} 个附件；此命令不会推送或发布。`);
        return ready;
    } finally { session.close?.(); }
}

function releaseArguments(args) {
    const options = {};
    for (let index = 0; index < args.length; index++) {
        const argument = args[index];
        if (argument === "--help" || argument === "-h") options.help = true;
        else if (argument === "--check") options.checkOnly = true;
        else if (argument === "--verify-remote") options.verifyRemote = true;
        else if (argument === "--notes" || argument === "--out") {
            const value = args[++index];
            if (!value || value.startsWith("--")) fail(`${argument} 需要参数`);
            options[argument.slice(2)] = value;
        } else fail("存在不支持的发布参数");
    }
    if (options.checkOnly && options.verifyRemote) fail("不能同时执行本机预检和远端验证");
    return options;
}

async function main(args) {
    const options = releaseArguments(args);
    if (options.help) {
        console.log('Usage: npm run release:package -- --notes "更新说明" [--out <输出目录>]');
        console.log("npm run release:check 进行本机预检；相同源码/版本/out 的打包命令可恢复发布会话。");
        return;
    }
    if (options.verifyRemote) return verifyRemote();
    if (process.platform === "darwin" && process.arch !== "arm64") fail("正式发布需使用 Apple Silicon 原生环境，不能打包其他架构的内嵌运行组件");
    const checkOnly = options.checkOnly;
    const version = releaseVersion();
    const config = json(join(web, "src-tauri/tauri.conf.json"));
    const sourceCommit = capture("读取源码提交", "git", ["rev-parse", "--verify", "HEAD"], { cwd: repo });
    const dirty = capture("检查源码工作区", "git", ["status", "--porcelain"], { cwd: repo });
    const notes = options.notes;
    if (!checkOnly && !notes) fail("请用 --notes 提供更新清单中的说明");
    if (!checkOnly && dirty) fail("工作区有未提交的修改；正式发布包必须对应源码提交");
    const api = await import("./lib/macos-signing.mjs");
    const signing = api.preflightSigning(api.loadSigningConfig(repo));
    const signer = preflightUpdater(config, version);
    if (checkOnly) {
        console.log(`✓ v${version} 的 Developer ID、公证授权及现有更新密钥预检通过。`);
        if (dirty) console.log("  工作区有修改；正式打包前需提交源码。本次未构建或提交公证。");
        return;
    }
    const outDir = resolve(options.out || join(repo, "..", "snapshots", `release-v${version}`));
    return packageRelease(api, { version, sourceCommit, config, signing, signer, notes, outDir });
}

function calledAsProgram() {
    if (!process.argv[1]) return false;
    try { return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)); }
    catch { return false; }
}

if (calledAsProgram()) {
    main(process.argv.slice(2)).catch((error) => { console.error(`✗ ${error.message}`); process.exitCode = 1; });
}
