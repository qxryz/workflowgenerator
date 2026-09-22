import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = readFileSync(new URL("../src/components/canvas/canvas-side-panel.tsx", import.meta.url), "utf8");
const ast = ts.createSourceFile("canvas-side-panel.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const fn = ast.statements.find((statement) => ts.isFunctionDeclaration(statement) && statement.name?.text === "buildInsertPayload");
const code = ts.transpileModule(`const isStructuredAsset = asset => ['character','scene'].includes(asset.kind); export ${fn.getText(ast)}`, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } }).outputText;
const { buildInsertPayload } = await import(`data:text/javascript,${encodeURIComponent(code)}`);

test("canvas sidebar carries collection authority, avatar and relationships into both asset kinds", () => {
    for (const kind of ["character", "scene"]) {
        const data = {
            collectionVersion: 1,
            avatarImageId: "avatar-only",
            description: "Display only",
            fields: {},
            images: [],
            audios: [{ id: "voice", title: "Voice", url: "wg-media://voice", storageKey: "audio:voice", bytes: 1, mimeType: "audio/wav" }],
            parts: [{ id: "outfit", enabled: false }],
            relationships: [{ id: "r", targetAssetId: "other", targetName: "Other", label: "Friend" }],
            referencePrompt: "@[node:relationships]",
        };
        const payload = buildInsertPayload({ id: "source", kind, title: "Identity", data });
        assert.equal(payload.collectionVersion, 1);
        assert.equal(payload.avatarImageId, "avatar-only");
        assert.deepEqual(payload.relationships, data.relationships);
        assert.deepEqual(payload.audios, data.audios);
        assert.deepEqual(payload.parts, data.parts);
        assert.equal(payload.referencePrompt, data.referencePrompt);
        assert.equal(payload.sourceAssetId, "source");
    }
});

test("legacy sidebar inputs remain legacy without inventing collection metadata", () => {
    const payload = buildInsertPayload({ id: "legacy", kind: "character", title: "Old", data: { description: "", fields: {}, images: [] } });
    assert.equal(payload.collectionVersion, undefined);
    assert.equal(payload.avatarImageId, undefined);
});
