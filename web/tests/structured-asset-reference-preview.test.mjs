import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

const source = await readFile(new URL("../src/pages/image/structured-asset-reference-preview.tsx", import.meta.url), "utf8");
const result = await build({
    stdin: { contents: source, resolveDir: new URL("../src/pages/image/", import.meta.url).pathname, loader: "tsx" },
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    plugins: [
        {
            name: "preview-test",
            setup(builder) {
                const mocks = {
                    "react/jsx-runtime": `export const jsx = (type, props) => typeof type === 'function' ? type(props) : ({type, props}); export const jsxs = jsx; export const Fragment = 'Fragment';`,
                    antd: `export const Image = 'Image';`,
                    "@/hooks/use-app-translation": `export const useAppTranslation = () => ({t: text => text});`,
                };
                builder.onResolve({ filter: /.*/ }, (args) => (mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined));
                builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
            },
        },
    ],
});
const { StructuredAssetReferencePreview } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
const nodes = (node) => (!node || typeof node !== "object" ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)]);
const text = (node) => (typeof node === "string" ? node : !node || typeof node !== "object" ? "" : [node.props?.children].flat(Infinity).map(text).join(""));
const images = [
    { id: "front", title: "主视图", dataUrl: "media:front" },
    { id: "side", title: "侧视图", dataUrl: "media:side" },
];

test("resolved preview preserves prose and displays every image in token order", () => {
    const tree = StructuredAssetReferencePreview({ prompt: "人物设定：\n@[node:side]然后@[node:front]结束。", images });
    const media = nodes(tree).filter((node) => node.type === "Image");
    assert.deepEqual(
        media.map((node) => node.props.src),
        ["media:side", "media:front"],
    );
    assert.ok(media.every((node) => node.props.preview !== false));
    assert.equal(text(tree), "人物设定：\n然后结束。");
    assert.doesNotMatch(text(tree), /@\[node:|侧视图|主视图/u);
});

test("preview keeps image, audio and prose order and audio has native playback controls", () => {
    const tree = StructuredAssetReferencePreview({ prompt: "先@[node:front]听@[node:voice]最后@[node:side]", images, audios: [{ id: "voice", title: "温柔声线", url: "media:voice" }] });
    assert.deepEqual(
        nodes(tree)
            .filter((node) => node.type === "Image" || node.type === "audio")
            .map((node) => node.props.src),
        ["media:front", "media:voice", "media:side"],
    );
    const audio = nodes(tree).find((node) => node.type === "audio");
    assert.equal(audio.props.controls, true);
    assert.equal(audio.props.preload, "metadata");
    assert.match(text(tree), /温柔声线/u);
});

test("missing and unavailable media render a clear invalid reference without leaking raw tokens", () => {
    const tree = StructuredAssetReferencePreview({ prompt: "@[node:missing] @[node:empty-image] @[node:empty-audio]", images: [{ id: "empty-image", title: "未加载", dataUrl: "" }], audios: [{ id: "empty-audio", title: "未加载", url: "" }] });
    assert.equal(text(tree).match(/引用已失效/gu)?.length, 3);
    assert.doesNotMatch(text(tree), /@\[node:|missing|empty-image|empty-audio/u);
    assert.equal(nodes(tree).filter((node) => node.type === "Image" || node.type === "audio").length, 0);
});

test("text-only and repeated media references remain intact", () => {
    const prose = "噜噜 → 噜妹：恋人\n保持日常服装。";
    assert.equal(text(StructuredAssetReferencePreview({ prompt: prose, images: [] })), prose);
    const tree = StructuredAssetReferencePreview({ prompt: "@[node:front]中间@[node:front]", images });
    assert.equal(nodes(tree).filter((node) => node.type === "Image").length, 2);
    assert.equal(text(tree), "中间");
});
