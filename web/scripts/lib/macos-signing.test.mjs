import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import {
  createReleaseSession, loadSigningConfig, notarizeAndStaple, preflightSigning,
  signApplication, verifyApplication,
} from "./macos-signing.mjs";

const TEAM = "ABCDE12345";
const IDENTITY = "A".repeat(40);
const SUBMISSION = "11111111-1111-4111-8111-111111111111";
const GOOD = { identity: IDENTITY, teamId: TEAM, notaryProfile: "fixture-notary" };

function fixture(t, { nested = [], identities, statuses = ["Accepted"], gatekeeper = 0, ticket = false } = {}) {
  const directory = mkdtempSync(join(tmpdir(), "macos-signing-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const app = join(directory, "Fixture.app");
  for (const relative of ["Contents/MacOS/fixture", ...nested]) {
    const path = join(app, relative);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, Buffer.from("cffaedfe0000000000000000", "hex"));
  }
  writeFileSync(join(app, "Contents/Info.plist"), "fixture plist");
  const calls = [];
  const state = { submits: 0, staples: 0, ticket, statuses: [...statuses], waitStatus: 0, gatekeeper };
  function runner(command, args) {
    calls.push({ command, args });
    const ok = (stdout = "", stderr = "") => ({ status: 0, stdout, stderr });
    if (command.endsWith("/security")) return ok(identities ?? `  1) ${IDENTITY} "Developer ID Application: Fixture (${TEAM})"\n`);
    if (command.endsWith("/plutil")) return ok(args.includes("-extract") ? "fixture\n" : "{}");
    if (command.endsWith("/codesign")) {
      if (args.includes("-dvvv")) return ok("", `Authority=Developer ID Application: Fixture (${TEAM})\nTeamIdentifier=${TEAM}\nTimestamp=fixture secure timestamp\nCodeDirectory flags=0x10000(runtime)\nCDHash=0123456789abcdef\n`);
      return ok();
    }
    if (command.endsWith("/spctl")) return { status: state.gatekeeper, stdout: "", stderr: "" };
    if (command.endsWith("/ditto")) {
      writeFileSync(args.at(-1), "fixture submission archive");
      return ok();
    }
    if (command.endsWith("/xcrun")) {
      if (args[0] === "--find") return ok("fixture-tool");
      if (args[0] === "stapler") {
        if (args[1] === "staple") { state.ticket = true; state.staples++; return ok(); }
        return { status: state.ticket ? 0 : 65, stdout: "", stderr: "" };
      }
      const operation = args[1];
      if (operation === "history") return ok(JSON.stringify({ history: [] }));
      if (operation === "submit") { state.submits++; return ok(JSON.stringify({ id: SUBMISSION })); }
      if (operation === "info") {
        const status = state.statuses.length > 1 ? state.statuses.shift() : state.statuses[0];
        return ok(JSON.stringify({ id: SUBMISSION, status }));
      }
      if (operation === "wait") return { status: state.waitStatus, stdout: state.waitStatus ? "" : JSON.stringify({ status: "Accepted" }), stderr: "" };
      if (operation === "log") return ok(JSON.stringify({ issues: [{ code: 4000, message: "Fixture rejected" }] }));
    }
    throw new Error("Unexpected fixture command");
  }
  const config = preflightSigning(GOOD, { runner, platform: "darwin" });
  return { directory, app, calls, state, config, runner };
}

test("local configuration contains only non-secret fields and permits environment overrides", (t) => {
  const names = ["APPLE_SIGNING_IDENTITY", "APPLE_TEAM_ID", "APPLE_NOTARY_PROFILE", "APPLE_KEYCHAIN"];
  const environment = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  for (const name of names) delete process.env[name];
  t.after(() => {
    for (const name of names) {
      if (environment[name] === undefined) delete process.env[name];
      else process.env[name] = environment[name];
    }
  });
  const directory = mkdtempSync(join(tmpdir(), "macos-signing-config-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  writeFileSync(join(directory, ".macos-signing.local.json"), JSON.stringify(GOOD));
  assert.equal(loadSigningConfig(directory).teamId, TEAM);
  process.env.APPLE_NOTARY_PROFILE = "environment-notary";
  assert.equal(loadSigningConfig(directory).notaryProfile, "environment-notary");
  writeFileSync(join(directory, ".macos-signing.local.json"), JSON.stringify({ ...GOOD, password: "must-not-be-stored" }));
  assert.throws(() => loadSigningConfig(directory), /Unsupported local signing field/);
});

test("application verification requires the release team, timestamp, and hardened runtime", (t) => {
  for (const change of [
    { replace: (value) => value.replace("flags=0x10000(runtime)", "flags=0x0(none)"), expected: /Hardened runtime/ },
    { replace: (value) => value.replace(/^Timestamp=.+\n/m, ""), expected: /secure signing timestamp/ },
    { replace: (value) => value.replace(`TeamIdentifier=${TEAM}`, "TeamIdentifier=OTHER12345"), expected: /different Apple team/ },
  ]) {
    const f = fixture(t);
    const config = preflightSigning(GOOD, { platform: "darwin", runner(command, args) {
      const response = f.runner(command, args);
      return command.endsWith("/codesign") && args.includes("-dvvv") ? { ...response, stderr: change.replace(response.stderr) } : response;
    } });
    assert.throws(() => verifyApplication(f.app, config), change.expected);
  }
});

test("release preflight rejects ad-hoc, development identities, and the wrong team", (t) => {
  assert.throws(() => preflightSigning({ ...GOOD, identity: "-" }), /Ad-hoc/);
  assert.throws(() => preflightSigning({ ...GOOD, identity: "Apple Development: Fixture" }), /Developer ID Application/);
  const f = fixture(t);
  const wrong = `  1) ${IDENTITY} "Developer ID Application: Fixture (OTHER12345)"\n`;
  assert.throws(() => preflightSigning(GOOD, { platform: "darwin", runner(command, args) {
    if (command.endsWith("/security")) return { status: 0, stdout: wrong, stderr: "" };
    return f.runner(command, args);
  } }), /exactly one valid/);
});

test("unknown nested executable is rejected before any signing mutation", (t) => {
  const f = fixture(t, { nested: ["Contents/Resources/new-helper"] });
  assert.throws(() => signApplication(f.app, f.config), /explicit signing policy/);
  assert.equal(f.calls.filter((call) => call.args.includes("--force")).length, 0);
});

test("nested code is signed before checksum updates and the outer seal", (t) => {
  const relative = "Contents/Resources/runtime/helper";
  const f = fixture(t, { nested: [relative] });
  signApplication(f.app, f.config, { nested: [{ path: relative }], afterNestedSigning() { f.calls.push({ callback: true }); } });
  const ordered = f.calls.filter((call) => call.callback || call.args.includes("--force"));
  assert.equal(ordered[0].args.at(-1), join(f.app, relative));
  assert.equal(ordered[1].callback, true);
  assert.equal(ordered[2].args.at(-1), f.app);
  for (const call of [ordered[0], ordered[2]]) {
    assert.ok(call.args.includes("--timestamp"));
    assert.ok(call.args.includes("runtime"));
    assert.ok(!call.args.includes("--deep"));
  }
});

test("debug entitlements are rejected before signing nested code", (t) => {
  const relative = "Contents/Resources/helper";
  const f = fixture(t, { nested: [relative] });
  const entitlement = join(f.directory, "debug.plist");
  writeFileSync(entitlement, "fixture");
  const config = preflightSigning(GOOD, { platform: "darwin", runner(command, args) {
    if (command.endsWith("/plutil") && args[0] === "-convert") return { status: 0, stdout: JSON.stringify({ "com.apple.security.get-task-allow": true }), stderr: "" };
    return f.runner(command, args);
  } });
  assert.throws(() => signApplication(f.app, config, { nested: [{ path: relative, entitlements: entitlement }] }), /Debug entitlements/);
  assert.equal(f.calls.filter((call) => call.args.includes("--force")).length, 0);
});

test("an interrupted wait resumes the saved Apple submission without re-uploading", (t) => {
  const f = fixture(t, { statuses: ["In Progress"] });
  const stateDir = join(f.directory, "notary");
  f.state.waitStatus = 130;
  assert.throws(() => notarizeAndStaple(f.app, f.config, { stateDir }), /wait failed/);
  assert.equal(f.state.submits, 1);
  assert.equal(readdirSync(stateDir).filter((name) => name.endsWith(".json")).length, 1);
  f.state.waitStatus = 0;
  f.state.statuses = ["Accepted"];
  assert.equal(notarizeAndStaple(f.app, f.config, { stateDir }).status, "Accepted");
  assert.equal(f.state.submits, 1);
  assert.equal(f.state.staples, 1);
});

test("a timed-out wait continues the same request automatically", (t) => {
  const f = fixture(t, { statuses: ["In Progress", "Accepted"] });
  f.state.waitStatus = 124;
  notarizeAndStaple(f.app, f.config, { stateDir: join(f.directory, "notary") });
  assert.equal(f.state.submits, 1);
  assert.equal(f.calls.filter((call) => call.args[0] === "notarytool" && call.args[1] === "wait").length, 1);
});

test("a nonzero wait result still fetches and saves Apple's rejection log", (t) => {
  const f = fixture(t, { statuses: ["In Progress", "Invalid"] });
  f.state.waitStatus = 65;
  const stateDir = join(f.directory, "notary");
  assert.throws(() => notarizeAndStaple(f.app, f.config, { stateDir }), /notarization Invalid/);
  assert.equal(f.state.staples, 0);
  assert.ok(readdirSync(stateDir).some((name) => name.endsWith(".log.json")));
});

test("universal executable changes cannot reuse a default-architecture CDHash receipt", (t) => {
  const f = fixture(t);
  const executable = join(f.app, "Contents/MacOS/fixture");
  writeFileSync(executable, Buffer.from("cafebabe0000000200000001", "hex"));
  const stateDir = join(f.directory, "notary");
  notarizeAndStaple(f.app, f.config, { stateDir });
  assert.equal(f.state.submits, 1);
  // Metadata intentionally retains the same selected-slice CDHash and ticket.
  writeFileSync(executable, Buffer.from("cafebabe0000000200000002", "hex"));
  notarizeAndStaple(f.app, f.config, { stateDir });
  assert.equal(f.state.submits, 2);
});

test("Apple rejection writes its log and never staples or reports success", (t) => {
  const f = fixture(t, { statuses: ["Invalid"] });
  const stateDir = join(f.directory, "notary");
  assert.throws(() => notarizeAndStaple(f.app, f.config, { stateDir }), /notarization Invalid/);
  assert.equal(f.state.staples, 0);
  assert.ok(readdirSync(stateDir).some((name) => name.endsWith(".log.json")));
});

test("an existing ticket cannot bypass a failed Gatekeeper assessment", (t) => {
  const f = fixture(t, { ticket: true, gatekeeper: 3 });
  assert.throws(() => notarizeAndStaple(f.app, f.config, { stateDir: join(f.directory, "notary") }), /Gatekeeper assessment failed/);
  assert.equal(f.state.submits, 0);
  assert.throws(() => verifyApplication(f.app, f.config, { notarized: true }), /Gatekeeper assessment failed/);
});

test("resuming checkpoints skips the build but revalidates its output", (t) => {
  const f = fixture(t);
  const options = { outDir: join(f.directory, "release"), version: "1.0.0", sourceCommit: "source-a" };
  let builds = 0;
  let validations = 0;
  const first = createReleaseSession(options);
  first.step("build", () => { builds++; }, () => { validations++; });
  first.close();
  const resumed = createReleaseSession(options);
  resumed.step("build", () => { builds++; }, () => { validations++; });
  assert.equal(builds, 1);
  assert.equal(validations, 2);
  assert.throws(() => resumed.step("build", () => {}, () => false), /checkpoint validation failed/);
  resumed.close();
  assert.throws(() => createReleaseSession({ ...options, sourceCommit: "source-b" }), /another version or source commit/);
});

test("an active output session is exclusive and a closed session releases its lock", (t) => {
  const f = fixture(t);
  const options = { outDir: join(f.directory, "release"), version: "1", sourceCommit: "source" };
  const first = createReleaseSession(options);
  assert.throws(() => createReleaseSession(options), /Another release process/);
  first.close();
  assert.throws(() => first.step("build", () => {}), /session has been closed/);
  const second = createReleaseSession(options);
  second.close();
  assert.equal(existsSync(join(options.outDir, ".release-lock.json")), false);
});

test("a dead process lock is recovered without rebuilding a completed step", (t) => {
  const f = fixture(t);
  const options = { outDir: join(f.directory, "release"), version: "1", sourceCommit: "source" };
  const first = createReleaseSession(options);
  first.step("build", () => {}, () => true);
  first.close();
  const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"]);
  assert.equal(dead.status, 0);
  writeFileSync(join(options.outDir, ".release-lock.json"), JSON.stringify({ pid: dead.pid, token: "previous-process" }));
  const resumed = createReleaseSession(options);
  let rebuilt = false;
  resumed.step("build", () => { rebuilt = true; }, () => true);
  assert.equal(rebuilt, false);
  resumed.close();
});

test("failed operations and asynchronous verifiers never produce a completed checkpoint", (t) => {
  const f = fixture(t);
  const session = createReleaseSession({ outDir: join(f.directory, "release"), version: "1", sourceCommit: "source" });
  assert.throws(() => session.step("build", () => { throw new Error("build failed"); }), /build failed/);
  assert.throws(() => session.step("verify", () => {}, async () => true), /must be synchronous/);
  const state = JSON.parse(readFileSync(join(f.directory, "release/.release-state.json"), "utf8"));
  assert.deepEqual(state.completed, []);
});

test("READY requires an exact asset whitelist and excludes state/outside files", (t) => {
  const f = fixture(t);
  const outDir = join(f.directory, "release");
  const session = createReleaseSession({ outDir, version: "1", sourceCommit: "source" });
  const asset = join(session.assetsDir, "Fixture.zip");
  writeFileSync(asset, "fixture package");
  assert.throws(() => session.markReady([join(outDir, ".release-state.json")]), /directly inside assets/);
  const stray = join(session.assetsDir, "unlisted.txt");
  writeFileSync(stray, "not in the asset list");
  assert.throws(() => session.markReady([asset]), /outside the publication whitelist/);
  rmSync(stray);
  const ready = session.markReady([asset]);
  assert.equal(ready.status, "READY");
  assert.deepEqual(ready.assets, [{ name: "Fixture.zip", sha256: createHash("sha256").update("fixture package").digest("hex"), size: 15 }]);
  assert.ok(existsSync(join(outDir, "release-assets.json")));
});
