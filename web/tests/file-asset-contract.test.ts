import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generic files are first-class assets and canvas resources", () => {
    const assetStore = source("../src/stores/use-asset-store.ts");
    const nodeTypes = source("../src/types/canvas.ts");
    const builtins = source("../src/components/canvas/nodes/builtin-nodes.tsx");

    assert.match(assetStore, /AssetKind = "text" \| "image" \| "video" \| "audio" \| "file" \| "character" \| "scene"/u);
    assert.match(nodeTypes, /File = "file"/u);
    assert.match(builtins, /kind: "file", storageKey:/u);
});

test("server generic files are stored separately and only served as attachments", () => {
    const serverStorage = source("../server/src/storage.rs");

    assert.match(serverStorage, /if bucket == "files" \{\s*"application\/octet-stream"/u);
    assert.match(serverStorage, /CONTENT_DISPOSITION, "attachment"/u);
    assert.match(serverStorage, /is_safe_storage_mime\(&bucket, &mime_type\)/u);
});
