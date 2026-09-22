import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { build } from "esbuild";

class ElementStub {
    constructor(tagName) {
        this.tagName = tagName.toUpperCase();
        this.nodeType = 1;
        this.childNodes = [];
        this.dataset = {};
        this.style = {};
        this.listeners = {};
    }
    append(...nodes) {
        this.childNodes.push(...nodes);
    }
    appendChild(node) {
        this.append(node);
        return node;
    }
    addEventListener(name, callback) {
        this.listeners[name] = callback;
    }
    querySelectorAll() {
        return this.childNodes.flatMap((node) => (node instanceof ElementStub ? [...(node.dataset.refLabel ? [node] : []), ...node.querySelectorAll()] : []));
    }
    set textContent(value) {
        this.childNodes = value ? [{ nodeType: 3, textContent: value }] : [];
    }
    get textContent() {
        return this.childNodes.map((node) => node.textContent).join("");
    }
}
globalThis.Node = { TEXT_NODE: 3 };
globalThis.HTMLElement = ElementStub;
globalThis.document = { activeElement: null, createElement: (tag) => new ElementStub(tag), createTextNode: (value) => ({ nodeType: 3, textContent: value }) };
const harness = { effects: [], refs: 0, editor: null, refValues: [] };
globalThis.__canvasPromptUiHarness = harness;
const theme = { toolbar: { panel: "#222" }, node: { stroke: "#333", text: "#fff" } };
const mocks = {
    react: `export const useMemo = fn => fn(); export const useEffect = fn => globalThis.__canvasPromptUiHarness.effects.push(fn);
        export const useRef = value => { const h = globalThis.__canvasPromptUiHarness; const index = h.refs++; return h.refValues[index] ||= { current: index === 0 ? h.editor : value }; };
        export const useState = value => [typeof value === 'function' ? value() : value, () => {}];`,
    "react/jsx-runtime": `export const jsx = (type, props) => ({type, props}); export const jsxs = jsx;`,
    "react-dom": "export const createPortal = x => x;",
    antd: "export const Image = 'Image'; export const Button = 'Button';",
    "lucide-react": "export const FileText='FileText', Image='Image', Music2='Music2', Video='Video', X='X';",
    "@/lib/canvas-theme": `export const canvasThemes = { test: ${JSON.stringify(theme)} };`,
    "@/stores/use-theme-store": `export const useThemeStore = fn => fn({theme: 'test'});`,
    "@/lib/keyboard-event": "export const isImeComposing = () => false; export const isPlainEnterKey = () => false;",
};
async function loadEditor(file) {
    const source = await readFile(new URL(`../src/components/canvas/${file}.tsx`, import.meta.url), "utf8");
    const result = await build({
        stdin: { contents: `${source}\nexport { createReferenceChip as testCreateReferenceChip, serializeEditor as testSerializeEditor };`, resolveDir: new URL("../src/components/canvas/", import.meta.url).pathname, loader: "tsx" },
        bundle: true,
        write: false,
        format: "esm",
        platform: "node",
        jsx: "automatic",
        plugins: [
            {
                name: "editor-test",
                setup(builder) {
                    builder.onResolve({ filter: /.*/ }, (args) => (mocks[args.path] ? { path: args.path, namespace: "mock" } : args.path.startsWith("@/") ? { path: new URL(`../src/${args.path.slice(2)}.ts`, import.meta.url).pathname } : undefined));
                    builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
                },
            },
        ],
    });
    return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`);
}
const chip = await loadEditor("canvas-prompt-chip-input");
const composer = await loadEditor("canvas-config-composer");
const portrait = { id: "portrait", nodeId: "portrait", kind: "image", label: "图片1", title: "主视觉", ready: true, active: true, previewUrl: "data:image/png;base64,AAAA" };
const cast = { id: "cast", nodeId: "cast", kind: "text", bindingKind: "character", label: "角色1", title: "噜噜妹", text: "很长的角色提示词不应作为chip标题", ready: true, active: true, members: [portrait] };
function render(component, props, reuse = false) {
    if (!reuse) {
        harness.editor = new ElementStub("div");
        harness.refValues = [];
    }
    harness.refs = 0;
    harness.effects = [];
    const tree = component(props);
    harness.effects.forEach((effect) => effect());
    return { tree, editor: harness.editor };
}
function allNodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(2).flatMap(allNodes)];
}

test("canvas stable chips serialize identity and display the short whole-character label", () => {
    const element = chip.testCreateReferenceChip(cast, theme, () => {}, true);
    const editor = new ElementStub("div");
    editor.append(element);
    assert.equal(chip.testSerializeEditor(editor), "@[node:cast]");
    assert.equal(element.textContent, "角色1 · 噜噜妹");
});

test("ordinary media workbench chips retain the plain 图片1 protocol", () => {
    const editor = new ElementStub("div");
    editor.append(chip.testCreateReferenceChip(portrait, theme, () => {}));
    assert.equal(chip.testSerializeEditor(editor), "图片1");
});

test("canvas prompt rebuild keeps unknown tokens as visible missing-reference chips", () => {
    const value = "使用 @[node:cast]，保留 @[node:missing]";
    const { editor } = render(chip.CanvasPromptChipInput, { value, references: [cast], tokenMode: true, onChange: () => {} });
    assert.deepEqual(
        editor.childNodes.filter((node) => node.dataset).map((node) => node.dataset.referenceNodeId),
        ["cast", "missing"],
    );
    assert.match(editor.textContent, /引用已失效/u);
    assert.equal(chip.testSerializeEditor(editor), value);
});

test("config composer menu shows whole choices while old leaf and missing tokens survive editing", () => {
    const value = "整体 @[node:cast]，旧引用 @[node:portrait]，待恢复 @[node:missing]";
    const inputs = [{ nodeId: "portrait", type: "image", title: "主视觉", ready: true, image: { dataUrl: portrait.previewUrl } }];
    const { editor, tree } = render(composer.CanvasConfigComposer, { value, inputs, references: [cast], onChange: () => {}, onClose: () => {} });
    assert.equal(composer.testSerializeEditor(editor), value);
    assert.match(editor.textContent, /引用已失效/u);
    const choices = allNodes(tree).filter((node) => node.type === "button" && node.props["aria-pressed"] !== undefined);
    assert.equal(choices.length, 1);
    assert.equal(choices[0].props.title, "噜噜妹");
    assert.equal(choices[0].props["aria-pressed"], true);
});

test("video counts use selected whole-group members, deduplicate leaves and ignore unselected groups", async () => {
    const { selectedCanvasReferenceCounts } = await import("../src/components/canvas/canvas-prompt-references.ts");
    const shared = { ...portrait, id: "shared", nodeId: "shared" };
    const clip = { ...portrait, kind: "video", id: "clip", nodeId: "clip" };
    const scene = { ...cast, id: "scene", nodeId: "scene", bindingKind: "scene", members: [shared, clip] };
    const character = { ...cast, members: [portrait, shared] };
    assert.deepEqual(selectedCanvasReferenceCounts([character, scene], "使用 @[node:cast]"), { images: 2, videos: 0, audios: 0 });
    assert.deepEqual(selectedCanvasReferenceCounts([character, scene], "使用 @[node:scene] @[node:cast] @[node:shared]"), { images: 2, videos: 1, audios: 0 });
    assert.deepEqual(selectedCanvasReferenceCounts([character, scene], "使用 @[node:missing]"), { images: 0, videos: 0, audios: 0 });
    assert.deepEqual(selectedCanvasReferenceCounts([{ ...character, members: [portrait, { ...shared, ready: false }] }], "使用 @[node:cast]"), { images: 0, videos: 0, audios: 0 });
});

test("legacy leaf tokens still display their media inside a whole-character reference menu", () => {
    const value = "之前选择 @[node:portrait]";
    const { editor } = render(chip.CanvasPromptChipInput, { value, references: [cast], tokenMode: true, onChange: () => {} });
    const reference = editor.childNodes.find((node) => node.dataset?.referenceNodeId === "portrait");
    assert.equal(reference.dataset.referenceMissing, undefined);
    assert.equal(reference.childNodes[0].tagName, "IMG");
    assert.equal(chip.testSerializeEditor(editor), value);
});

test("stable IDs keep the same asset after display labels are renumbered", () => {
    const value = "选择 @[node:cast]，图片1只是普通文字";
    const { editor } = render(chip.CanvasPromptChipInput, { value, references: [{ ...cast, label: "角色2" }], tokenMode: true, onChange: () => {} });
    assert.match(editor.textContent, /角色2 · 噜噜妹/u);
    assert.equal(chip.testSerializeEditor(editor), value);
});

test("config composer without whole references retains its existing leaf choices", () => {
    const value = "选择 @[node:portrait]";
    const inputs = [{ nodeId: "portrait", type: "image", title: "主视觉", ready: true, image: { dataUrl: portrait.previewUrl } }];
    const { tree, editor } = render(composer.CanvasConfigComposer, { value, inputs, onChange: () => {}, onClose: () => {} });
    assert.equal(composer.testSerializeEditor(editor), value);
    assert.equal(allNodes(tree).find((node) => node.type === "button" && node.props["aria-pressed"] !== undefined).props.title, "主视觉");
});

function domNodes(element) {
    return [element, ...(element.childNodes || []).flatMap(domNodes)];
}

test("expanded material chips render every image and text while preserving one token", () => {
    const images = Array.from({ length: 8 }, (_, index) => ({ ...portrait, nodeId: `image-${index}`, previewUrl: `data:image/png;base64,${index}` }));
    const material = { ...cast, title: "服装", text: "蓝色雨衣和雨靴。", members: images };
    const materialGroup = chip.testCreateReferenceChip({ ...material, bindingKind: undefined }, theme, () => {}, true, true);
    assert.equal(materialGroup.textContent.match(/服装/gu)?.length, 1);
    assert.equal(materialGroup.textContent.match(/蓝色雨衣和雨靴。/gu)?.length, 1);
    const previews = [];
    const element = chip.testCreateReferenceChip(material, theme, (url) => previews.push(url), true, true);
    const editor = new ElementStub("div");
    editor.append(element);
    const thumbnails = domNodes(element).filter((node) => node.tagName === "IMG");
    assert.equal(thumbnails.length, 8);
    assert.match(element.textContent, /蓝色雨衣和雨靴/u);
    thumbnails[7].listeners.click({ preventDefault() {}, stopPropagation() {} });
    assert.deepEqual(previews, [images[7].previewUrl]);
    assert.equal(element.contentEditable, "false");
    assert.equal(chip.testSerializeEditor(editor), "@[node:cast]");
    const titleOnly = chip.testCreateReferenceChip({ ...material, text: material.title }, theme, () => {}, true, true);
    assert.equal(titleOnly.textContent, "角色1 · 服装");
});

test("focused editor refreshes material contents without replacing text or chip boundaries", () => {
    const value = "保持 @[node:cast] 的样子";
    const props = { value, references: [cast], tokenMode: true, expandReferences: true, onChange() {} };
    const { editor } = render(chip.CanvasPromptChipInput, props);
    const originalNodes = [...editor.childNodes];
    document.activeElement = editor;
    render(chip.CanvasPromptChipInput, { ...props, references: [{ ...cast, text: "新服装", members: [portrait, { ...portrait, nodeId: "second" }] }] }, true);
    assert.deepEqual(editor.childNodes, originalNodes);
    assert.match(editor.textContent, /新服装/u);
    assert.equal(domNodes(editor).filter((node) => node.tagName === "IMG").length, 2);
    assert.equal(chip.testSerializeEditor(editor), value);
    document.activeElement = null;
});

test("composition defers a reference refresh until composition ends", () => {
    const value = "使用 @[node:cast]";
    const props = { value, references: [cast], tokenMode: true, expandReferences: true, onChange() {} };
    let result = render(chip.CanvasPromptChipInput, props);
    document.activeElement = result.editor;
    const editorProps = (tree) => allNodes(tree).find((node) => node.props?.contentEditable).props;
    editorProps(result.tree).onCompositionStart();
    result = render(chip.CanvasPromptChipInput, { ...props, references: [{ ...cast, text: "更新后的设定" }] }, true);
    assert.doesNotMatch(result.editor.textContent, /更新后的设定/u);
    globalThis.window = { getSelection: () => null };
    editorProps(result.tree).onCompositionEnd();
    assert.match(result.editor.textContent, /更新后的设定/u);
    assert.equal(chip.testSerializeEditor(result.editor), value);
    document.activeElement = null;
});
