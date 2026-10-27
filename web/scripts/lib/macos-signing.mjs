import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import {
  closeSync, existsSync, lstatSync, mkdirSync, openSync, readFileSync,
  readdirSync, readSync, renameSync, unlinkSync, writeFileSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

const RUNTIME = Symbol("macos-signing-runtime");
const LOCAL_CONFIG = ".macos-signing.local.json";
const CONFIG_FIELDS = ["identity", "teamId", "notaryProfile", "keychain"];
const MACHO_MAGIC = new Set(["feedface", "feedfacf", "cefaedfe", "cffaedfe", "cafebabe", "bebafeca", "cafebabf", "bfbafeca"]);

const sha256 = (value) => createHash("sha256").update(value).digest("hex");
const fileHash = (path) => sha256(readFileSync(path));
const loadJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.partial-${process.pid}`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  renameSync(temporary, path);
}

function verifyCheckpoint(name, verify) {
  const output = verify();
  requireValue(!output || typeof output.then !== "function", "Release checkpoint verifiers must be synchronous");
  requireValue(output !== false, `Release checkpoint validation failed: ${name}`);
}

function defaultRunner(command, args) {
  return spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
}

function result(config, label, command, args, allowed = [0]) {
  const runner = config[RUNTIME]?.runner ?? defaultRunner;
  const response = runner(command, args) ?? {};
  if (response.error || !allowed.includes(response.status)) {
    // Captured output/arguments can contain credentials owned by a caller.
    throw new Error(`${label} failed (exit ${response.status ?? response.error?.code ?? "unknown"})`);
  }
  return { status: response.status, stdout: String(response.stdout ?? ""), stderr: String(response.stderr ?? "") };
}

function auth(config) {
  const args = ["--keychain-profile", config.notaryProfile];
  if (config.keychain) args.push("--keychain", config.keychain);
  return args;
}

function metadata(target, config) {
  const output = result(config, "Code signature metadata", "/usr/bin/codesign", ["-dvvv", target]);
  const text = `${output.stdout}\n${output.stderr}`;
  return { text, cdHash: text.match(/^CDHash=([a-f0-9]+)$/mi)?.[1] };
}

function validateMetadata(target, config, runtime) {
  const value = metadata(target, config);
  requireValue(value.text.includes("Authority=Developer ID Application:"), "A Developer ID Application signature is required");
  requireValue(value.text.includes(`TeamIdentifier=${config.teamId}`), "The signature belongs to a different Apple team");
  requireValue(/^Timestamp=.+$/m.test(value.text), "A secure signing timestamp is required");
  if (runtime) requireValue(/flags=0x[0-9a-f]+\([^)]*\bruntime\b/i.test(value.text), "Hardened runtime is required");
  return value;
}

function relativeCodePath(value) {
  requireValue(typeof value === "string" && value && !isAbsolute(value) && !value.includes("\0"), "Nested code paths must be relative to the app");
  requireValue(!value.split(/[\\/]/).some((part) => part === ".." || part === "."), "Nested code paths cannot leave the app");
  return value.split("/").join(sep);
}

function headerMagic(path) {
  const descriptor = openSync(path, "r");
  try {
    const bytes = Buffer.alloc(4);
    return readSync(descriptor, bytes, 0, 4, 0) === 4 ? bytes.toString("hex") : null;
  } finally { closeSync(descriptor); }
}

function isMachO(path) { return MACHO_MAGIC.has(headerMagic(path)); }

function machOFiles(app) {
  const files = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && isMachO(path)) files.push(relative(app, path));
    }
  }
  visit(app);
  return files.sort();
}

function mainExecutable(app, config) {
  const name = result(config, "App executable lookup", "/usr/bin/plutil", ["-extract", "CFBundleExecutable", "raw", "-o", "-", join(app, "Contents/Info.plist")]).stdout.trim();
  requireValue(name && basename(name) === name && !name.includes("\\"), "The app has an invalid main executable");
  const path = join("Contents", "MacOS", name);
  requireValue(existsSync(join(app, path)) && lstatSync(join(app, path)).isFile(), "The app main executable is missing");
  return path;
}

function checkConfig(config) {
  requireValue(config && typeof config === "object", "Signing configuration is required");
  for (const field of ["teamId", "notaryProfile"]) {
    requireValue(typeof config[field] === "string" && config[field].trim(), `Missing signing configuration: ${field}`);
  }
  requireValue(/^[A-Z0-9]{10}$/.test(config.teamId), "Apple teamId must contain ten uppercase letters or digits");
  requireValue(config.identity !== "-", "Ad-hoc signing is not allowed for a release");
  if (config.identity) requireValue(/^[a-f0-9]{40}$/i.test(config.identity) || config.identity.startsWith("Developer ID Application:"), "A Developer ID Application identity is required");
  for (const field of CONFIG_FIELDS) {
    if (config[field] != null) requireValue(typeof config[field] === "string" && !/[\r\n\0]/.test(config[field]), `Invalid signing configuration: ${field}`);
  }
}

export function loadSigningConfig(projectRoot) {
  const path = join(resolve(projectRoot), LOCAL_CONFIG);
  const local = existsSync(path) ? loadJson(path) : {};
  requireValue(local && typeof local === "object" && !Array.isArray(local), "The local signing configuration must be an object");
  for (const field of Object.keys(local)) requireValue(CONFIG_FIELDS.includes(field), `Unsupported local signing field: ${field}`);
  const config = { ...local };
  for (const [field, name] of Object.entries({ identity: "APPLE_SIGNING_IDENTITY", teamId: "APPLE_TEAM_ID", notaryProfile: "APPLE_NOTARY_PROFILE", keychain: "APPLE_KEYCHAIN" })) {
    if (process.env[name] !== undefined) config[field] = process.env[name];
  }
  checkConfig(config);
  return config;
}

export function preflightSigning(config, { runner = defaultRunner, platform = process.platform } = {}) {
  checkConfig(config);
  requireValue(platform === "darwin", "Official macOS releases must be prepared on macOS");
  const resolved = { ...config };
  Object.defineProperty(resolved, RUNTIME, { value: { runner, platform } });
  result(resolved, "notarytool availability", "/usr/bin/xcrun", ["--find", "notarytool"]);
  result(resolved, "stapler availability", "/usr/bin/xcrun", ["--find", "stapler"]);
  const identityArgs = ["find-identity", "-v", "-p", "codesigning"];
  if (config.keychain) identityArgs.push(config.keychain);
  const identities = result(resolved, "Signing identity lookup", "/usr/bin/security", identityArgs).stdout;
  const matches = [...identities.matchAll(/^\s*\d+\)\s+([A-F0-9]{40})\s+"([^"]+)"/gmi)]
    .map((match) => ({ fingerprint: match[1].toUpperCase(), name: match[2] }))
    .filter((item) => item.name.startsWith("Developer ID Application:") && item.name.endsWith(`(${config.teamId})`))
    .filter((item) => !config.identity || item.fingerprint === config.identity.toUpperCase() || item.name === config.identity);
  requireValue(matches.length === 1, "Choose exactly one valid Developer ID Application identity for the configured team");
  resolved.identity = matches[0].fingerprint;
  resolved.identityName = matches[0].name;
  const history = result(resolved, "Notarization authorization", "/usr/bin/xcrun", ["notarytool", "history", ...auth(resolved), "--output-format", "json"]);
  JSON.parse(history.stdout);
  return resolved;
}

function sign(target, config, { entitlements, diskImage = false } = {}) {
  requireValue(typeof config.identity === "string" && config.identity, "Run signing preflight before signing a release");
  const args = ["--force", "--timestamp", "--sign", config.identity];
  if (!diskImage) args.push("--options", "runtime");
  if (config.keychain) args.push("--keychain", config.keychain);
  if (entitlements) args.push("--entitlements", entitlements);
  args.push(target);
  result(config, "Developer ID signing", "/usr/bin/codesign", args);
}

export function signApplication(app, config, { nested = [], afterNestedSigning } = {}) {
  checkConfig(config);
  app = resolve(app);
  const main = mainExecutable(app, config);
  const discovered = machOFiles(app);
  requireValue(discovered.includes(main), "The app main executable is not a Mach-O binary");
  const policy = nested.map((item) => ({ ...item, path: relativeCodePath(item.path) }));
  const names = policy.map((item) => item.path);
  requireValue(new Set(names).size === names.length && !names.includes(main), "Nested signing policies must be unique and exclude the app main executable");
  const actual = discovered.filter((path) => path !== main);
  requireValue(actual.length === names.length && actual.every((path) => names.includes(path)), "Nested Mach-O code differs from the explicit signing policy");
  for (const item of policy) {
    requireValue(lstatSync(join(app, item.path)).isFile(), "Nested signing targets must be regular files");
    if (item.entitlements) {
      requireValue(existsSync(item.entitlements) && lstatSync(item.entitlements).isFile(), "The nested signing entitlement file is missing");
      const entitlements = JSON.parse(result(config, "Entitlement validation", "/usr/bin/plutil", ["-convert", "json", "-o", "-", item.entitlements]).stdout);
      requireValue(!entitlements["com.apple.security.get-task-allow"] && !entitlements["com.apple.security.cs.debugger"], "Debug entitlements are not allowed in a release");
    }
  }
  policy.sort((left, right) => right.path.split(sep).length - left.path.split(sep).length || left.path.localeCompare(right.path));
  for (const item of policy) sign(join(app, item.path), config, item);
  if (afterNestedSigning) {
    const output = afterNestedSigning();
    requireValue(!output || typeof output.then !== "function", "The nested signing callback must be synchronous");
  }
  sign(app, config);
  verifyApplication(app, config);
}

export function signDiskImage(dmg, config) {
  checkConfig(config);
  sign(resolve(dmg), config, { diskImage: true });
  verifyDiskImage(dmg, config);
}

export function verifyApplication(app, config, { notarized = false } = {}) {
  app = resolve(app);
  result(config, "Strict application signature verification", "/usr/bin/codesign", ["--verify", "--deep", "--strict", app]);
  validateMetadata(app, config, true);
  for (const file of machOFiles(app)) validateMetadata(join(app, file), config, true);
  if (notarized) {
    result(config, "Application notarization ticket", "/usr/bin/xcrun", ["stapler", "validate", app]);
    result(config, "Application Gatekeeper assessment", "/usr/sbin/spctl", ["--assess", "--type", "execute", app]);
  }
  return true;
}

export function verifyDiskImage(dmg, config, { notarized = false } = {}) {
  dmg = resolve(dmg);
  result(config, "Strict disk-image signature verification", "/usr/bin/codesign", ["--verify", "--strict", dmg]);
  validateMetadata(dmg, config, false);
  if (notarized) {
    result(config, "Disk-image notarization ticket", "/usr/bin/xcrun", ["stapler", "validate", dmg]);
    result(config, "Disk-image Gatekeeper assessment", "/usr/sbin/spctl", ["--assess", "--type", "open", "--context", "context:primary-signature", dmg]);
  }
  return true;
}

function notary(config, operation, args, allowed = [0]) {
  const response = result(config, `Apple notarization ${operation}`, "/usr/bin/xcrun", ["notarytool", operation, ...args, ...auth(config), "--output-format", "json"], allowed);
  if (response.status === 124) return { timeout: true };
  return JSON.parse(response.stdout);
}

export function notarizeAndStaple(target, config, { stateDir }) {
  checkConfig(config);
  target = resolve(target);
  stateDir = resolve(stateDir);
  const app = target.endsWith(".app");
  requireValue(app || target.endsWith(".dmg"), "Notarization supports an app bundle or a signed DMG");
  if (app) verifyApplication(target, config); else verifyDiskImage(target, config);
  const executable = app ? join(target, mainExecutable(target, config)) : null;
  const cdHash = app ? metadata(target, config).cdHash : null;
  if (app) requireValue(cdHash, "The signed app has no CodeDirectory hash");
  // A universal executable's default CDHash covers only the selected slice.
  const contentId = app ? `${cdHash}:${fileHash(executable)}` : fileHash(target);
  const key = sha256([basename(target), config.teamId, config.identity, contentId].join("\n"));
  const receiptPath = join(stateDir, `${key}.json`);
  let receipt = existsSync(receiptPath) ? loadJson(receiptPath) : null;
  if (receipt) requireValue(receipt.contentId === contentId && receipt.teamId === config.teamId && /^[a-f0-9-]{36}$/i.test(receipt.id), "The saved notarization receipt is invalid");
  const ticket = result(config, "Existing notarization ticket lookup", "/usr/bin/xcrun", ["stapler", "validate", target], [0, 65]);
  const universal = app && ["cafebabe", "bebafeca", "cafebabf", "bfbafeca"].includes(headerMagic(executable));
  if (ticket.status === 0 && (!universal || receipt?.status === "Accepted")) {
    if (app) verifyApplication(target, config, { notarized: true });
    else verifyDiskImage(target, config, { notarized: true });
    return { status: "Accepted", alreadyStapled: true };
  }
  mkdirSync(stateDir, { recursive: true });
  if (!receipt) {
    let archive = target;
    if (app) {
      archive = join(stateDir, `${key}.zip`);
      result(config, "Notarization app archive", "/usr/bin/ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", target, archive]);
    }
    const submitted = notary(config, "submit", [archive]);
    requireValue(/^[a-f0-9-]{36}$/i.test(submitted.id ?? ""), "Apple did not return a notarization submission ID");
    receipt = { id: submitted.id, teamId: config.teamId, contentId, ...(cdHash ? { cdHash } : {}), archiveSha256: fileHash(archive), submittedAt: new Date().toISOString() };
    atomicJson(receiptPath, receipt);
  }
  let info = notary(config, "info", [receipt.id]);
  for (;;) {
    receipt.status = info.status;
    atomicJson(receiptPath, receipt);
    if (info.status === "Accepted") break;
    if (info.status !== "In Progress") {
      const log = result(config, "Notarization rejection log", "/usr/bin/xcrun", ["notarytool", "log", receipt.id, ...auth(config), "--output-format", "json"]);
      const logPath = join(stateDir, `${key}.log.json`);
      writeFileSync(logPath, log.stdout, { mode: 0o600 });
      throw new Error(`Apple notarization ${info.status ?? "failed"}; inspect ${logPath}`);
    }
    console.log(`Waiting for Apple notarization ${receipt.id}; an interrupted run can resume without resubmitting.`);
    let waitError;
    try { notary(config, "wait", [receipt.id, "--timeout", "15m"], [0, 124]); }
    catch (error) { waitError = error; }
    // A rejection can make `wait` exit nonzero; info remains authoritative.
    info = notary(config, "info", [receipt.id]);
    if (waitError && info.status === "In Progress") throw waitError;
  }
  result(config, "Notarization ticket stapling", "/usr/bin/xcrun", ["stapler", "staple", target]);
  if (app) verifyApplication(target, config, { notarized: true });
  else verifyDiskImage(target, config, { notarized: true });
  return { id: receipt.id, status: "Accepted", receiptPath };
}

function releaseLock(outDir) {
  const path = join(outDir, ".release-lock.json");
  const token = randomUUID();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      writeFileSync(path, JSON.stringify({ pid: process.pid, token }) + "\n", { flag: "wx", mode: 0o600 });
      let released = false;
      function release() {
        if (released) return;
        released = true;
        process.removeListener("exit", release);
        if (existsSync(path) && loadJson(path).token === token) unlinkSync(path);
      }
      process.once("exit", release);
      return release;
    } catch (error) {
      if (error.code !== "EEXIST") throw error;
      const owner = loadJson(path);
      requireValue(Number.isInteger(owner.pid) && owner.pid > 0 && typeof owner.token === "string", "The release output lock is invalid");
      let alive = true;
      try { process.kill(owner.pid, 0); }
      catch (signalError) { if (signalError.code === "ESRCH") alive = false; else if (signalError.code !== "EPERM") throw signalError; }
      requireValue(!alive, "Another release process is already using this output directory");
      const observed = loadJson(path);
      if (observed.pid === owner.pid && observed.token === owner.token) unlinkSync(path);
    }
  }
  throw new Error("The release output lock changed concurrently; retry the command");
}

export function createReleaseSession({ outDir, version, sourceCommit, resume = true }) {
  requireValue(typeof version === "string" && version && typeof sourceCommit === "string" && sourceCommit, "Release version and source commit are required");
  outDir = resolve(outDir);
  const statePath = join(outDir, ".release-state.json");
  mkdirSync(outDir, { recursive: true });
  const unlock = releaseLock(outDir);
  let state;
  try {
    if (existsSync(statePath)) {
      requireValue(resume, "The output directory already contains a release session");
      state = loadJson(statePath);
      requireValue(state.schemaVersion === 1 && state.version === version && state.sourceCommit === sourceCommit, "The release output belongs to another version or source commit");
      requireValue(Array.isArray(state.completed), "The release session checkpoint is invalid");
    } else {
      requireValue(readdirSync(outDir).every((name) => name === ".release-lock.json"), "Refusing to use an existing output directory without a release checkpoint");
      state = { schemaVersion: 1, version, sourceCommit, status: "BUILDING", completed: [] };
      atomicJson(statePath, state);
    }
  } catch (error) { unlock(); throw error; }
  const workDir = join(outDir, "work");
  const assetsDir = join(outDir, "assets");
  const stateDir = join(outDir, ".notary");
  try { for (const path of [workDir, assetsDir, stateDir]) mkdirSync(path, { recursive: true }); }
  catch (error) { unlock(); throw error; }
  let closed = false;
  return {
    workDir, assetsDir, stateDir,
    close() { if (!closed) { closed = true; unlock(); } },
    step(name, operation, verify) {
      requireValue(!closed, "The release session has been closed");
      requireValue(typeof name === "string" && name && typeof operation === "function", "A named synchronous release operation is required");
      if (state.completed.includes(name)) {
        requireValue(typeof verify === "function", `A verifier is required to resume ${name}`);
        verifyCheckpoint(name, verify);
        return;
      }
      const output = operation();
      requireValue(!output || typeof output.then !== "function", "Release steps must be synchronous");
      if (verify) verifyCheckpoint(name, verify);
      state.completed.push(name);
      atomicJson(statePath, state);
      return output;
    },
    markReady(files) {
      requireValue(!closed, "The release session has been closed");
      requireValue(Array.isArray(files) && files.length > 0, "Release assets must be an explicit non-empty list");
      const paths = files.map((path) => resolve(path));
      requireValue(new Set(paths).size === paths.length, "Release assets cannot contain duplicate files");
      for (const path of paths) requireValue(dirname(path) === assetsDir && existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink(), "Only regular files directly inside assets may be published");
      requireValue(readdirSync(assetsDir).length === paths.length, "The release assets directory contains files outside the publication whitelist");
      const manifest = { status: "READY", version, sourceCommit, assets: paths.map((path) => ({ name: basename(path), sha256: fileHash(path), size: lstatSync(path).size })) };
      atomicJson(join(outDir, "release-assets.json"), manifest);
      state.status = "READY";
      atomicJson(statePath, state);
      return manifest;
    },
  };
}
