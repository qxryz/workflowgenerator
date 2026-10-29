#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { realpathSync } from "node:fs";
import { delimiter, join, resolve } from "node:path";

// Cargo supplies the selected compiler (or workspace wrapper) as the first arg.
const [compiler, ...args] = process.argv.slice(2);
function stop() {
  console.error("The release compiler configuration is invalid");
  process.exit(1);
}
if (!compiler) stop();
let policy;
try { policy = JSON.parse(process.env.RELEASE_BUILD_POLICY); } catch { stop(); }
if (!policy || !Array.isArray(policy.mappings) || policy.mappings.some((entry) =>
  !Array.isArray(entry) || entry.length !== 2 || entry.some((value) => typeof value !== "string" || !value || value.includes("\0")))) stop();
const ownPath = realpathSync(fileURLToPath(import.meta.url));
const previous = policy.previousWrapper;
if (previous !== null && typeof previous !== "string") stop();
if (previous) {
  const candidates = previous.includes("/") ? [resolve(previous)] : (process.env.PATH ?? "").split(delimiter).map((directory) => join(directory || ".", previous));
  for (const candidate of candidates) {
    try { if (realpathSync(candidate) === ownPath) stop(); } catch { /* Try another PATH entry. */ }
  }
}
const query = args.includes("-vV") || args.includes("--version");
const remaps = query ? [] : policy.mappings.map(([from, to]) => `--remap-path-prefix=${from}=${to}`);
const command = previous || compiler;
const childArgs = previous ? [compiler, ...args, ...remaps] : [...args, ...remaps];
const result = spawnSync(command, childArgs, { stdio: "inherit", env: process.env });
if (result.error) {
  console.error("The release compiler could not be started");
  process.exit(1);
}
if (result.signal) {
  try { process.kill(process.pid, result.signal); } catch { process.exit(1); }
} else process.exit(result.status ?? 1);
