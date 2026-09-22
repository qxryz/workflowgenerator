import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { transform } from "esbuild";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read("../src/pages/assets/index.tsx");
const side = read("../src/components/canvas/canvas-side-panel.tsx");
const reference = read("../src/lib/structured-asset-reference.ts").replace(/^import type .*;\n/mu, "");
const componentSource = [
    reference,
    page.slice(page.indexOf("function AssetCard(")),
    side.slice(side.indexOf("function buildInsertPayload("), side.indexOf("const CanvasAssetsTab =")),
    side.slice(side.indexOf("function AssetCover("), side.indexOf("// ---------------------------------------------------------------------------", side.indexOf("function AssetCover("))),
].join("\n");
const prelude = `
const h = (type, props, ...children) => typeof type === "function" ? type({ ...props, children }) : ({ type, props: { ...props, children } });
const isStructuredAsset = asset => asset.kind === 'character' || asset.kind === 'scene';
const useAppTranslation = () => ({ t: value => value });
const Image = Object.assign('Image', { PreviewGroup: 'PreviewGroup' });
const Typography = { Title: 'Title', Text: 'Text', Paragraph: 'Paragraph' };
const Card='Card', Drawer='Drawer', Space='Space', Tag='Tag', Button='Button', AuthorNote='AuthorNote';
const FileIcon='FileIcon', File='File', Music2='Music2', Copy='Copy', Download='Download', Trash2='Trash2', PencilLine='PencilLine';
const formatBytes = String, formatDuration = String, assetFileCategoryLabel = String;
`;
const compiled = await transform(`${prelude}\n${componentSource}\nexport { AssetCard, AssetDrawer, AssetCover, assetSearchText, buildInsertPayload };`, { loader: "tsx", format: "esm", jsxFactory: "h" });
const { AssetCard, AssetDrawer, AssetCover, assetSearchText, buildInsertPayload, resolveStructuredAssetReferencePrompt } = await import(`data:text/javascript;base64,${Buffer.from(compiled.code).toString("base64")}`);
const nodes = (node) => (!node || typeof node !== "object" ? [] : [node, ...[node.props?.cover, node.props?.children].flat(Infinity).flatMap(nodes)]);
const text = (node) => (typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join(" "));
const image = (id, partId, isCurrent = true) => ({ id, partId, isCurrent, title: `${id}图`, dataUrl: `media:${id}`, width: 1, height: 1, bytes: 1, mimeType: "image/png" });
const asset = () => ({
    id: "character-1",
    kind: "character",
    title: "松果",
    coverUrl: "",
    tags: [],
    data: {
        collectionVersion: 1,
        description: "展示用简介",
        fields: {},
        avatarImageId: "avatar",
        parts: [
            { id: "overview", title: "人物总览", prompt: "森林邮递员", enabled: true },
            { id: "outfit", title: "雨衣", prompt: "黄色雨衣", enabled: false },
        ],
        images: [image("avatar", "avatar"), image("front", "overview"), image("alternate", "overview", false), image("coat", "outfit")],
        relationships: [{ id: "friend", targetAssetId: "other", targetName: "小橡", label: "搭档" }],
        referencePrompt: "@[node:overview]\n@[node:relationships]",
    },
});

test("collection details show collected text, set selection, relationships and readable resolved references", () => {
    const tree = AssetDrawer({ asset: asset() });
    const content = text(tree);
    for (const expected of ["森林邮递员", "黄色雨衣", "雨衣", "未启用", "未选用", "小橡", "搭档", "引用提示词", "【front图】"]) assert.ok(content.includes(expected), expected);
    assert.doesNotMatch(content, /@\[node:/u);
    const previews = nodes(tree).filter((node) => node.type?.toString() === "Image");
    assert.equal(previews.filter((node) => node.props.src === "media:avatar").length, 0);
    assert.equal(previews.filter((node) => node.props.src === "media:alternate").length, 1);
});

test("collection search includes collected notes and relationships", () => {
    const searchable = assetSearchText(asset());
    for (const term of ["森林邮递员", "黄色雨衣", "小橡", "搭档"]) assert.ok(searchable.includes(term), term);
});

test("empty collection cover stays empty in library and canvas while legacy covers fall back", () => {
    for (const render of [AssetCard, AssetDrawer, AssetCover]) {
        assert.equal(nodes(render({ asset: asset() })).filter((node) => node.type === "img" && node.props.src === "media:avatar").length, 0);
        const legacy = asset();
        delete legacy.data.collectionVersion;
        assert.ok(nodes(render({ asset: legacy })).some((node) => node.props.src === "media:avatar"));
    }
});

test("canvas sidebar preserves collection semantics and selections when inserting", () => {
    const original = asset();
    const payload = buildInsertPayload(original);
    assert.equal(payload.collectionVersion, 1);
    assert.equal(payload.avatarImageId, "avatar");
    assert.deepEqual(payload.relationships, original.data.relationships);
    assert.equal(payload.parts[1].enabled, false);
    assert.equal(payload.images[2].isCurrent, false);
    const prompt = resolveStructuredAssetReferencePromptForTest(payload);
    assert.doesNotMatch(prompt, /展示用简介|node:avatar|黄色雨衣|node:alternate/u);
});

function resolveStructuredAssetReferencePromptForTest(payload) {
    return resolveStructuredAssetReferencePrompt({ ...payload, kind: payload.assetKind });
}
