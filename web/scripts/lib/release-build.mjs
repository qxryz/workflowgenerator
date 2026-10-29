import { createHash } from "node:crypto";
import { accessSync, closeSync, constants, existsSync, lstatSync, openSync, readFileSync, readlinkSync, readSync, readdirSync, realpathSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { basename, delimiter, dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ownFile = fileURLToPath(import.meta.url);
const wrapper = join(dirname(ownFile), "release-rustc-wrapper.mjs");

function aliases(path) {
  const values = [resolve(path)];
  try { values.push(realpathSync(path)); } catch { /* A later build may create it. */ }
  for (const value of [...values]) {
    if (value.startsWith("/private/var/")) values.push(value.slice("/private".length));
    if (value.startsWith("/var/")) values.push(`/private${value}`);
    if (value === "/private/tmp" || value.startsWith("/private/tmp/")) values.push(value.slice("/private".length));
    if (value === "/tmp" || value.startsWith("/tmp/")) values.push(`/private${value}`);
  }
  return [...new Set(values)];
}

function roots({ projectRoot, env = process.env, home = homedir(), cargoHome, rustupHome, temporaryRoot = tmpdir() }) {
  if (!projectRoot || !isAbsolute(projectRoot) || resolve(projectRoot) === "/") throw new Error("A release project root is required");
  const records = [
    [home, "/build/home"],
    [temporaryRoot, "/build/tmp"],
    [cargoHome ?? env.CARGO_HOME ?? join(home, ".cargo"), "/cargo"],
    [rustupHome ?? env.RUSTUP_HOME ?? join(home, ".rustup"), "/rustup"],
    [projectRoot, "/src"],
  ];
  return records.flatMap(([from, to]) => {
    if (!from || !isAbsolute(from) || resolve(from) === "/") throw new Error("Invalid release build root");
    return aliases(from).map((value) => [value, to]);
  });
}

function configuredWrapper(options, env) {
  if (Object.hasOwn(env, "RUSTC_WRAPPER")) return env.RUSTC_WRAPPER || null;
  if (Object.hasOwn(env, "CARGO_BUILD_RUSTC_WRAPPER")) return env.CARGO_BUILD_RUSTC_WRAPPER || null;
  const directories = new Set();
  for (const start of [options.projectRoot, options.cargoDirectory, process.cwd()].filter(Boolean)) {
    for (let current = resolve(start); ; current = dirname(current)) {
      directories.add(current);
      if (dirname(current) === current) break;
    }
  }
  const paths = [...directories].flatMap((directory) => [join(directory, ".cargo/config"), join(directory, ".cargo/config.toml")]);
  const cargoHome = options.cargoHome ?? env.CARGO_HOME ?? join(options.home ?? homedir(), ".cargo");
  paths.push(join(cargoHome, "config"), join(cargoHome, "config.toml"));
  for (const path of new Set(paths)) {
    if (!existsSync(path)) continue;
    const lines = readFileSync(path, "utf8").split(/\r?\n/).filter((line) => !line.trim().startsWith("#"));
    if (lines.some((line) => /rustc-wrapper["']?\s*=/.test(line))) {
      throw new Error("Cargo config selects a compiler wrapper; set RUSTC_WRAPPER explicitly for this release");
    }
  }
  return null;
}

function resolveWrapper(command, env) {
  if (!command) return null;
  if (typeof command !== "string" || command.includes("\0")) throw new Error("Invalid compiler wrapper");
  const candidates = command.includes("/") ? [resolve(command)] : (env.PATH ?? "").split(delimiter).map((directory) => join(directory || ".", command));
  for (const candidate of candidates) {
    try {
      accessSync(candidate, constants.X_OK);
      if (lstatSync(candidate).isDirectory()) continue;
      return realpathSync(candidate);
    } catch { /* Try the next PATH entry. */ }
  }
  throw new Error("The configured compiler wrapper is unavailable");
}

export function releaseBuildEnvironment(options) {
  const inherited = options.env ?? process.env;
  const env = { ...inherited };
  const mappings = roots({ ...options, env: inherited });
  const previousWrapper = resolveWrapper(configuredWrapper(options, inherited), inherited);
  if (previousWrapper && previousWrapper === realpathSync(wrapper)) throw new Error("The release compiler wrapper cannot wrap itself");
  const policy = { mappings, previousWrapper };
  const hash = createHash("sha256")
    .update(JSON.stringify(policy)).update(readFileSync(ownFile)).update(readFileSync(wrapper)).digest("hex").slice(0, 20);
  const target = inherited.CARGO_TARGET_DIR ? resolve(inherited.CARGO_TARGET_DIR) : join(resolve(options.projectRoot), "target");
  env.CARGO_TARGET_DIR = join(target, "release-build", hash);
  env.RUSTC_WRAPPER = wrapper;
  env.RELEASE_BUILD_POLICY = JSON.stringify(policy);
  env.CARGO_PROFILE_RELEASE_DEBUG = "0";
  env.CARGO_PROFILE_RELEASE_STRIP = "symbols";
  env.CARGO_PROFILE_RELEASE_INCREMENTAL = "false";
  return env;
}

function needlesFor(options) {
  const values = roots(options).map(([from]) => from)
    .filter((path) => !["/tmp", "/private/tmp"].includes(path));
  const username = basename(options.home ?? homedir());
  values.push(`/Users/${username}/`, `/home/${username}/`, `C:\\Users\\${username}\\`);
  return [...new Set(values)].flatMap((value) => {
    const utf16 = Buffer.from(value, "utf16le");
    return [Buffer.from(value), utf16, Buffer.from(utf16).swap16()];
  });
}

function invalid(bytes, needles) {
  return needles.some((needle) => bytes.includes(needle));
}

export function assertPortableBundle(bundle, options) {
  const needles = needlesFor(options);
  const reject = (relative) => {
    const entry = invalid(Buffer.from(relative), needles) ? "bundle entry" : relative || "bundle";
    throw new Error(`The release bundle contains a host-specific path in ${entry}`);
  };
  const scanFile = (path, relative) => {
    const file = openSync(path, "r");
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let carry = Buffer.alloc(0);
    try {
      for (;;) {
        const length = readSync(file, buffer, 0, buffer.length, null);
        if (!length) break;
        const bytes = Buffer.concat([carry, buffer.subarray(0, length)]);
        if (invalid(bytes, needles)) reject(relative);
        carry = Buffer.from(bytes.subarray(Math.max(0, bytes.length - Math.max(1024, ...needles.map((needle) => needle.length)))));
      }
    } finally { closeSync(file); }
  };
  const visit = (path, relative) => {
    if (invalid(Buffer.from(relative), needles)) reject(relative);
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) {
      if (invalid(Buffer.from(readlinkSync(path)), needles)) reject(relative);
    } else if (stat.isDirectory()) {
      for (const name of readdirSync(path)) visit(join(path, name), join(relative, name));
    } else if (stat.isFile()) scanFile(path, relative);
    else throw new Error("The release bundle contains an unsupported entry");
  };
  if (!lstatSync(bundle).isDirectory() || lstatSync(bundle).isSymbolicLink()) throw new Error("The release bundle is not a directory");
  visit(bundle, "");
  return true;
}
