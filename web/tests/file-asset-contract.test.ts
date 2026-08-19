import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("generic files are first-class assets and canvas resources", () => {
    const assetStore = source("../src/stores/use-asset-store.ts");
    const nodeTypes = source("../src/types/canvas.ts");
    const builtins = source("../src/components/canvas/nodes/builtin-nodes.tsx");
    const terminal = source("../src/services/terminal.ts");

    assert.match(assetStore, /AssetKind = "text" \| "image" \| "video" \| "audio" \| "file"/u);
    assert.match(nodeTypes, /File = "file"/u);
    assert.match(builtins, /kind: "file", storageKey:/u);
    assert.match(terminal, /"text" \| "image" \| "video" \| "audio" \| "file"/u);
    assert.match(terminal, /fileName: reference\.fileName/u);
});

test("native generic files are stored separately and only served as attachments", () => {
    const nativeStorage = source("../src-tauri/src/app_storage.rs");
    const terminal = source("../src-tauri/src/lib.rs");

    assert.match(nativeStorage, /if bucket == "files" \{\s*"application\/octet-stream"/u);
    assert.match(nativeStorage, /CONTENT_DISPOSITION, "attachment"/u);
    assert.match(nativeStorage, /is_safe_storage_mime\(&bucket, &mime_type\)/u);
    assert.match(terminal, /"file" => \("files", "file:"\)/u);
    assert.match(terminal, /terminal_artifact_snapshot_with_depth\(output_dir, 5, true\)/u);
    assert.match(terminal, /terminal_artifact_snapshot_with_depth\(working_dir, 1, false\)/u);
});

test("the in-app reference explains preview, terminal, and safety boundaries", () => {
    const docsIndex = source("../src/pages/model-adaptations/index.tsx");
    const docs = source("../src/pages/model-adaptations/asset-files-doc.tsx");

    assert.match(docsIndex, /label: "资产与文件"/u);
    assert.match(docs, /应用内预览格式/u);
    assert.match(docs, /不限扩展名/u);
    assert.match(docs, /\$WG_INPUT_DIR/u);
    assert.match(docs, /\$WG_OUTPUT_DIR/u);
    assert.match(docs, /不会自动运行脚本、网页或可执行文件/u);
});
