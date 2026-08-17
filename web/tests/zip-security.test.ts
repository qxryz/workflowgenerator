import assert from "node:assert/strict";
import test from "node:test";
import { zipSync } from "fflate";

import { readZip } from "../src/lib/zip.ts";

test("ZIP import rejects traversal paths before exposing entries", async () => {
    const archive = zipSync({ "../outside.txt": new TextEncoder().encode("no") });
    await assert.rejects(() => readZip(new Blob([archive])), /越界文件路径/u);
});

test("ZIP import rejects suspicious expansion ratios before inflation", async () => {
    const archive = zipSync({ "files/zeros.bin": new Uint8Array(1024 * 1024) }, { level: 9 });
    await assert.rejects(() => readZip(new Blob([archive])), /压缩比例异常/u);
});

test("ZIP import still accepts ordinary application packages", async () => {
    const archive = zipSync({ "assets.json": new TextEncoder().encode('{"app":"infinite-canvas"}') }, { level: 6 });
    const files = await readZip(new Blob([archive]));
    assert.equal(await files.get("assets.json")?.text(), '{"app":"infinite-canvas"}');
});
