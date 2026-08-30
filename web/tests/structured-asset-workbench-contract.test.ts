import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";


const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("人物和场景以结构化资产保存，并在工作台中提供并列入口", () => {
    const store = source("../src/stores/use-asset-store.ts");
    const workbench = source("../src/pages/workbench/index.tsx");
    const header = source("../src/components/media-workbench-header.tsx");
    const imagePage = source("../src/pages/image/index.tsx");
    const structuredWorkbench = source("../src/pages/image/structured-asset-workbench.tsx");

    assert.match(store, /StructuredAssetKind = "character" \| "scene"/u);
    assert.match(store, /parts\?: StructuredAssetPart\[\]/u);
    assert.match(store, /activePartId\?: string/u);
    assert.match(workbench, /<ImagePage assetKind="character" \/>/u);
    assert.match(workbench, /<ImagePage assetKind="scene" \/>/u);
    assert.match(header, /label: "人物", path: "\/workbench\/character"/u);
    assert.match(header, /label: "场景", path: "\/workbench\/scene"/u);
    assert.match(imagePage, /structured-image-workbench-drafts-v1/u);
    assert.match(structuredWorkbench, /function StructuredAssetLibraryPanel/u);
    assert.match(structuredWorkbench, /function StructuredAssetBoard/u);
    assert.match(imagePage, /attachGeneratedImagesToStructuredPart/u);
    assert.match(imagePage, /saveReferenceToStructuredPart/u);
    assert.match(imagePage, /upsertAssetPersisted\(draft\.assetId, structuredAssetPayload/u);
});

test("人物和场景采用代码编写的原生面板，并复用图片工作台的真实生成链路", () => {
    const imagePage = source("../src/pages/image/index.tsx");
    const structuredWorkbench = source("../src/pages/image/structured-asset-workbench.tsx");

    assert.match(imagePage, /requestGeneration/u);
    assert.match(imagePage, /requestEdit/u);
    assert.match(imagePage, /<GenerationSettings/u);
    assert.match(imagePage, /await attachGeneratedImagesToStructuredPart\(logImages, completedLog\.id, text\)/u);
    assert.match(structuredWorkbench, /生成成功后会自动保存到当前部件，并保留旧版本/u);
    assert.match(structuredWorkbench, /STRUCTURED_WORKFLOW_DEFINITIONS/u);
});

test("人物与场景路由切换时先隔离上一页草稿，避免跨类型部件崩溃", () => {
    const imagePage = source("../src/pages/image/index.tsx");
    const structuredWorkbench = source("../src/pages/image/structured-asset-workbench.tsx");

    assert.match(structuredWorkbench, /kind: StructuredAssetKind/u);
    assert.match(structuredWorkbench, /\.\.\.draft,\s*kind,/u);
    assert.match(imagePage, /structuredDraft\.kind !== assetKind \? createStructuredAssetDraft\(assetKind\)/u);
    assert.match(imagePage, /structuredDraftReady && structuredDraft\.kind === assetKind/u);
    const boardSource = structuredWorkbench.slice(structuredWorkbench.indexOf("export function StructuredAssetBoard"));
    assert.ok(boardSource.indexOf("if (!ready) return") < boardSource.indexOf("const activePart ="));
});

test("结构化资产可在画布中作为完整分组导入，并参与资产包导出", () => {
    const picker = source("../src/components/canvas/asset-picker-modal.tsx");
    const canvas = source("../src/pages/canvas/project.tsx");
    const factory = source("../src/lib/canvas/canvas-node-factory.ts");
    const assetTransfer = source("../src/pages/assets/asset-transfer.ts");

    assert.match(picker, /kind: "structured"/u);
    assert.match(picker, /assetKind: StructuredAssetKind/u);
    assert.match(canvas, /payload\.kind === "structured"/u);
    assert.match(canvas, /createStructuredAssetGroup\(payload, center\)/u);
    assert.match(factory, /groupId: group\.id/u);
    assert.match(assetTransfer, /isStructuredAsset\(asset\)/u);
    assert.match(assetTransfer, /asset\.data\.images\.map/u);
});
