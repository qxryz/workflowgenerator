#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { fstatSync, realpathSync } from "node:fs";
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
function compilerStdio() {
  const descriptors = new Set();
  const flags = process.env.CARGO_MAKEFLAGS ?? "";
  const pairs = flags.matchAll(/(?:^|\s)--jobserver-(?:auth|fds)(?:=|\s+)(\d+),(\d+)(?=\s|$)/g);
  for (const match of pairs) {
    const pair = [Number(match[1]), Number(match[2])];
    if (pair[0] === pair[1] || pair.some((fd) => !Number.isSafeInteger(fd) || fd < 3 || fd > 64)) continue;
    try {
      if (pair.every((fd) => fstatSync(fd).isFIFO())) pair.forEach((fd) => descriptors.add(fd));
    } catch { /* An unavailable descriptor must not be inherited. */ }
  }
  if (!descriptors.size) return "inherit";
  const stdio = Array(Math.max(...descriptors) + 1).fill("ignore");
  stdio.splice(0, 3, "inherit", "inherit", "inherit");
  for (const fd of descriptors) stdio[fd] = fd;
  return stdio;
}
const result = spawnSync(command, childArgs, { stdio: compilerStdio(), env: process.env });
if (result.error) {
  console.error("The release compiler could not be started");
  process.exit(1);
}
if (result.signal) {
  try { process.kill(process.pid, result.signal); } catch { process.exit(1); }
} else process.exit(result.status ?? 1);
