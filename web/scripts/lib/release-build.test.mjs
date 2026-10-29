import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { assertPortableBundle, releaseBuildEnvironment } from "./release-build.mjs";

const wrapper = fileURLToPath(new URL("./release-rustc-wrapper.mjs", import.meta.url));
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "release build fixture "));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const home = join(root, "build home");
  const projectRoot = join(home, "project with spaces");
  mkdirSync(projectRoot, { recursive: true });
  return { root, home, projectRoot, env: { ...process.env, CARGO_TARGET_DIR: join(root, "cache") } };
}
function app(t) {
  const f = fixture(t);
  const path = join(f.root, "Fixture.app");
  mkdirSync(join(path, "Contents/MacOS"), { recursive: true });
  return { ...f, path, binary: join(path, "Contents/MacOS/fixture") };
}

test("release environments retain Cargo-selected flags and wrapper chains", (t) => {
  const f = fixture(t);
  const previous = join(f.root, "existing-wrapper.mjs");
  writeFileSync(previous, "#!/usr/bin/env node\nprocess.exit(0);\n");
  chmodSync(previous, 0o755);
  const inherited = { ...f.env, RUSTFLAGS: "--cfg inherited", CARGO_ENCODED_RUSTFLAGS: "--cfg\u001fencoded", RUSTC_WRAPPER: previous, RUSTC_WORKSPACE_WRAPPER: "workspace-wrapper", RETAIN: "yes" };
  const result = releaseBuildEnvironment({ ...f, env: inherited });
  assert.equal(result.RUSTFLAGS, inherited.RUSTFLAGS);
  assert.equal(result.CARGO_ENCODED_RUSTFLAGS, inherited.CARGO_ENCODED_RUSTFLAGS);
  assert.equal(result.RUSTC_WORKSPACE_WRAPPER, "workspace-wrapper");
  assert.equal(result.RETAIN, "yes");
  assert.equal(result.RUSTC_WRAPPER, wrapper);
  assert.equal(JSON.parse(result.RELEASE_BUILD_POLICY).previousWrapper, realpathSync(previous));
  assert.ok(result.CARGO_TARGET_DIR.startsWith(join(f.root, "cache/release-build/")));
  assert.equal(result.CARGO_PROFILE_RELEASE_DEBUG, "0");
  assert.equal(result.CARGO_PROFILE_RELEASE_STRIP, "symbols");
  assert.equal(inherited.RUSTC_WRAPPER, previous);
});

test("build roots select a deterministic isolated cache and cannot recurse", (t) => {
  const f = fixture(t);
  const first = releaseBuildEnvironment(f);
  assert.equal(releaseBuildEnvironment(f).CARGO_TARGET_DIR, first.CARGO_TARGET_DIR);
  assert.notEqual(releaseBuildEnvironment({ ...f, home: join(f.root, "other home") }).CARGO_TARGET_DIR, first.CARGO_TARGET_DIR);
  assert.throws(() => releaseBuildEnvironment({ ...f, env: { ...f.env, RUSTC_WRAPPER: wrapper } }), /cannot wrap itself/);
});

test("Cargo wrapper aliases are chained and explicit empty overrides are respected", (t) => {
  const f = fixture(t);
  const previous = join(f.root, "alias-wrapper.mjs");
  writeFileSync(previous, '#!/usr/bin/env node\nconsole.log("alias-wrapper-called");\n');
  chmodSync(previous, 0o755);
  const inherited = { ...f.env, CARGO_BUILD_RUSTC_WRAPPER: previous };
  delete inherited.RUSTC_WRAPPER;
  const env = releaseBuildEnvironment({ ...f, env: inherited });
  assert.match(execFileSync(env.RUSTC_WRAPPER, ["unused-compiler", "--version"], { env, encoding: "utf8" }), /alias-wrapper-called/);
  const empty = releaseBuildEnvironment({ ...f, env: { ...inherited, RUSTC_WRAPPER: "" } });
  assert.equal(JSON.parse(empty.RELEASE_BUILD_POLICY).previousWrapper, null);
});

test("config-only wrappers cannot be silently discarded", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.projectRoot, ".cargo"));
  writeFileSync(join(f.projectRoot, ".cargo/config.toml"), '[build]\nrustc-wrapper="configured-sentinel"\n');
  const env = { ...f.env };
  delete env.RUSTC_WRAPPER;
  delete env.CARGO_BUILD_RUSTC_WRAPPER;
  assert.throws(() => releaseBuildEnvironment({ ...f, env }), /set RUSTC_WRAPPER explicitly/);
  assert.equal(JSON.parse(releaseBuildEnvironment({ ...f, env: { ...env, RUSTC_WRAPPER: "" } }).RELEASE_BUILD_POLICY).previousWrapper, null);
});

test("a wrapper selected through PATH or a symlink cannot chain itself", (t) => {
  const f = fixture(t);
  const env = { ...f.env, PATH: `${dirname(wrapper)}:${f.env.PATH}`, RUSTC_WRAPPER: "release-rustc-wrapper.mjs" };
  assert.throws(() => releaseBuildEnvironment({ ...f, env }), /cannot wrap itself/);
  const alias = join(f.root, "wrapper-alias");
  symlinkSync(wrapper, alias);
  const aliasEnv = { ...f.env, CARGO_BUILD_RUSTC_WRAPPER: alias };
  delete aliasEnv.RUSTC_WRAPPER;
  assert.throws(() => releaseBuildEnvironment({ ...f, env: aliasEnv }), /cannot wrap itself/);
});

test("a real compiler preserves an existing wrapper and maps file locations with spaces", (t) => {
  const rustc = spawnSync("rustc", ["--version"], { encoding: "utf8" });
  assert.equal(rustc.status, 0, "The release toolchain must provide rustc");
  const f = app(t);
  const source = join(f.projectRoot, "main file.rs");
  writeFileSync(source, 'fn main() { println!("{}", file!()); }\n');
  const previous = join(f.root, "previous wrapper.mjs");
  const log = join(f.root, "wrapper-log.jsonl");
  writeFileSync(previous, '#!/usr/bin/env node\nimport {appendFileSync} from "node:fs"; import {spawnSync} from "node:child_process"; const [compiler,...args]=process.argv.slice(2); appendFileSync(process.env.WRAPPER_TEST_LOG,JSON.stringify(args)+"\\n"); const child=spawnSync(compiler,args,{stdio:"inherit"}); process.exit(child.status??1);\n');
  chmodSync(previous, 0o755);
  const env = releaseBuildEnvironment({ ...f, env: { ...f.env, RUSTC_WRAPPER: previous, WRAPPER_TEST_LOG: log } });
  execFileSync(env.RUSTC_WRAPPER, ["rustc", "--crate-name", "fixture", source, "-o", f.binary, "-C", "strip=symbols"], { env, stdio: ["ignore", "pipe", "pipe"] });
  assert.equal(execFileSync(f.binary, { encoding: "utf8" }).trim(), "/src/main file.rs");
  assert.equal(assertPortableBundle(f.path, f), true);
  execFileSync(env.RUSTC_WRAPPER, ["rustc", "-vV"], { env, stdio: ["ignore", "pipe", "pipe"] });
  const calls = readFileSync(log, "utf8").trim().split("\n").map(JSON.parse);
  assert.ok(calls[0].some((arg) => arg === `--remap-path-prefix=${f.projectRoot}=/src`));
  assert.deepEqual(calls[1], ["-vV"]);
});

test("Cargo config flags and workspace wrappers survive a complete fixture build", (t) => {
  const f = fixture(t);
  mkdirSync(join(f.projectRoot, "src"));
  mkdirSync(join(f.projectRoot, ".cargo"));
  writeFileSync(join(f.projectRoot, "Cargo.toml"), '[package]\nname="release_fixture"\nversion="0.1.0"\nedition="2021"\n');
  writeFileSync(join(f.projectRoot, ".cargo/config.toml"), '[build]\nrustflags=["--cfg", "from_config"]\n');
  writeFileSync(join(f.projectRoot, "src/main.rs"), '#[cfg(not(from_config))] compile_error!("config flag was lost");\nfn main(){println!("{}",file!());}\n');
  const workspaceWrapper = join(f.root, "workspace-wrapper.mjs");
  writeFileSync(workspaceWrapper, '#!/usr/bin/env node\nimport {spawnSync} from "node:child_process"; const [compiler,...args]=process.argv.slice(2); const child=spawnSync(compiler,args,{stdio:"inherit"}); process.exit(child.status??1);\n');
  chmodSync(workspaceWrapper, 0o755);
  const inherited = { ...f.env, RUSTC_WORKSPACE_WRAPPER: workspaceWrapper };
  delete inherited.RUSTFLAGS;
  delete inherited.CARGO_ENCODED_RUSTFLAGS;
  delete inherited.RUSTC_WRAPPER;
  const env = releaseBuildEnvironment({ ...f, env: inherited });
  execFileSync("cargo", ["build", "--offline", "--release"], { cwd: f.projectRoot, env, stdio: ["ignore", "pipe", "pipe"] });
  const binary = join(env.CARGO_TARGET_DIR, "release/release_fixture");
  assert.doesNotMatch(execFileSync(binary, { encoding: "utf8" }), new RegExp(f.home.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

for (const encoding of ["utf8", "utf16le", "utf16be"]) {
  test(`bundle checks reject host paths in ${encoding} without printing their contents`, (t) => {
    const f = app(t);
    const value = `${f.home}/.cargo/registry/src/dependency/src/lib.rs`;
    let bytes = Buffer.from(value, encoding === "utf16be" ? "utf16le" : encoding);
    if (encoding === "utf16be") bytes.swap16();
    writeFileSync(f.binary, Buffer.concat([Buffer.from([1]), bytes]));
    assert.throws(() => assertPortableBundle(f.path, f), (error) => {
      assert.match(error.message, /host-specific/);
      assert.equal(error.message.includes(f.home), false);
      return true;
    });
  });
}

test("a path spanning read chunks is still rejected", (t) => {
  const f = app(t);
  writeFileSync(f.binary, Buffer.concat([Buffer.alloc(1024 * 1024 - 7, 42), Buffer.from(`${f.home}/src/lib.rs`)]));
  assert.throws(() => assertPortableBundle(f.path, f), /host-specific/);
});

test("a nested resource or link cannot bypass bundle checks", (t) => {
  const f = app(t);
  writeFileSync(f.binary, "portable executable\n");
  mkdirSync(join(f.path, "Contents/Resources"));
  const resource = join(f.path, "Contents/Resources/configuration.txt");
  writeFileSync(resource, `${f.projectRoot}/generated/output`);
  assert.throws(() => assertPortableBundle(f.path, f), /host-specific/);
  rmSync(resource);
  symlinkSync(join(f.home, "hidden-file"), resource);
  assert.throws(() => assertPortableBundle(f.path, f), /host-specific/);
  rmSync(resource);
  symlinkSync("/usr/lib", resource);
  assert.equal(assertPortableBundle(f.path, f), true);
});

test("vendor sample locations remain allowed while host locations do not", (t) => {
  const f = app(t);
  writeFileSync(f.binary, "/Users/vendor-example/workspace/src/main.rs\n/home/ci-example/build/file.rs");
  assert.equal(assertPortableBundle(f.path, f), true);
  writeFileSync(f.binary, `vendor sample\n${f.home}/src/main.rs`);
  assert.throws(() => assertPortableBundle(f.path, f), /host-specific/);
});
