import { copyFile, mkdir, writeFile, chmod, readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
// Build input only. The shipped application uses its own resource, never this path.
const expectedVersion = "1.18.32";
const source = process.env.WG_OPENCODE_BINARY || resolve(homedir(), ".opencode/bin/opencode");
const version = execFileSync(source, ["--version"], { encoding: "utf8" }).trim();
if (version !== expectedVersion) throw new Error(`OpenCode ${expectedVersion} required; received ${version}`);
const target = resolve("src-tauri/runtime");
await mkdir(target, { recursive: true });
await copyFile(source, resolve(target, "opencode"));
await chmod(resolve(target, "opencode"), 0o755);
await copyFile(resolve("third-party/opencode-LICENSE"), resolve(target, "LICENSE"));
const sha256 = createHash("sha256")
    .update(await readFile(source))
    .digest("hex");
await writeFile(resolve(target, "manifest.json"), JSON.stringify({ name: "opencode", version, platform: process.platform, arch: process.arch, sha256 }, null, 2));
console.log(`Prepared OpenCode ${version} (${process.platform}/${process.arch})`);
