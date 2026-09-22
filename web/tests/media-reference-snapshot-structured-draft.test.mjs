import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { collectStorageKeys } from "../src/services/media-retention-policy.ts";

const source = readFileSync(new URL("../src/services/media-reference-snapshot.ts", import.meta.url), "utf8");

test("媒体完整快照包含结构化工作台草稿", () => {
    assert.match(source, /createServerJsonStore\("structured-image-workbench-drafts-v1"\)/u);
    assert.match(source, /readStoreValues\(structuredImageWorkbenchDraftStore\)/u);
    assert.match(source, /structuredImage: structuredImageWorkbenchDrafts/u);
});

test("结构化草稿以未知值读取，允许纯文本草稿参与快照", () => {
    assert.match(source, /const structuredImageWorkbenchDraftStore = createServerJsonStore/u);
    assert.match(source, /async function readStoreValues\(store: ReturnType<typeof createServerJsonStore>\)/u);
    assert.match(source, /const values: unknown\[\] = \[\]/u);
});

test("structured drafts and saved collections retain all audio files, including unselected voices", () => {
    const draft = { kind: "character", audios: [{ storageKey: "audio:draft", isCurrent: false }] };
    const saved = { kind: "character", data: { audios: [{ storageKey: "audio:saved" }] } };
    const snapshot = { workbenchHistory: { structuredImage: [draft] }, assets: [saved] };
    assert.deepEqual([...collectStorageKeys(snapshot, (key) => key.startsWith("audio:"))].sort(), ["audio:draft", "audio:saved"]);
});
