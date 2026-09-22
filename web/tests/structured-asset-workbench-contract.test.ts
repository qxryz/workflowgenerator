import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = (relativePath: string) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

test("人物与场景分别挂载收集工作台，切换时隔离草稿状态", () => {
    const workbench = source("../src/pages/workbench/index.tsx");
    const header = source("../src/components/media-workbench-header.tsx");

    assert.match(workbench, /<StructuredAssetWorkbench key="character" kind="character" \/>/u);
    assert.match(workbench, /<StructuredAssetWorkbench key="scene" kind="scene" \/>/u);
    assert.match(workbench, /return <ImagePage \/>/u);
    assert.doesNotMatch(workbench, /<ImagePage[^>]+assetKind/u);
    assert.match(header, /label: "人物", path: "\/workbench\/character"/u);
    assert.match(header, /label: "场景", path: "\/workbench\/scene"/u);
});

test("收集工作台承接已有草稿和资产，不挂载模型设置或生成任务", () => {
    const structuredWorkbench = source("../src/pages/image/structured-asset-workbench.tsx");

    assert.match(structuredWorkbench, /export default function StructuredAssetWorkbench/u);
    assert.match(structuredWorkbench, /structured-image-workbench-drafts-v1/u);
    assert.match(structuredWorkbench, /upsertAssetPersisted/u);
    assert.match(structuredWorkbench, /registerRuntimeMediaReferenceProvider/u);
    assert.doesNotMatch(structuredWorkbench, /services\/api\/(?:image|video|audio)|use-config-store|use-workbench-agent-store/u);
    assert.doesNotMatch(structuredWorkbench, /requestGeneration|requestEdit|GenerationSettings|ModelPicker|onGenerate|attachGeneratedImages/u);
});

test("普通图片工作台独立保留生成、日志与媒体生命周期", () => {
    const imagePage = source("../src/pages/image/index.tsx");

    assert.doesNotMatch(imagePage, /assetKind|structuredDraft|structured-asset-workbench|structuredAsset/u);
    assert.match(imagePage, /requestGeneration/u);
    assert.match(imagePage, /requestEdit/u);
    assert.match(imagePage, /<GenerationSettings/u);
    assert.match(imagePage, /image-generation-logs-v1/u);
    assert.match(imagePage, /registerRuntimeMediaReferenceProvider/u);
    assert.match(imagePage, /runtimeMediaReferencesRef.current = \{ references, results, logs, previewLog \}/u);
    assert.match(imagePage, /persistBatchLog/u);
    assert.match(imagePage, /persistRetriedLog/u);
    assert.match(imagePage, /invalidateRunningBatch/u);
});

test("收集的结构化资产仍可整组导入画布并导出资产包", () => {
    const store = source("../src/stores/use-asset-store.ts");
    const picker = source("../src/components/canvas/asset-picker-modal.tsx");
    const canvas = source("../src/pages/canvas/project.tsx");
    const factory = source("../src/lib/canvas/canvas-node-factory.ts");
    const assetTransfer = source("../src/pages/assets/asset-transfer.ts");

    assert.match(store, /StructuredAssetKind = "character" \| "scene"/u);
    assert.match(picker, /kind: "structured"/u);
    assert.match(picker, /assetKind: StructuredAssetKind/u);
    assert.match(canvas, /payload\.kind === "structured"/u);
    assert.match(canvas, /createStructuredAssetGroup\(payload, center\)/u);
    assert.match(factory, /groupId: group\.id/u);
    assert.match(assetTransfer, /isStructuredAsset\(asset\)/u);
    assert.match(assetTransfer, /asset\.data\.images\.map/u);
});
