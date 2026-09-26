import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const mocks = {
    react: `export const useState = value => globalThis.__canvasPromptPanelHarness.useState(value);
        export const useEffect = (effect, deps) => globalThis.__canvasPromptPanelHarness.useEffect(effect, deps);`,
    "react/jsx-runtime": "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
    "lucide-react": "export const ArrowUp='ArrowUp', LoaderCircle='LoaderCircle', Square='Square';",
    antd: "export const Button='Button';",
    "@/components/model-picker": "export const ModelPicker='ModelPicker';",
    "@/stores/use-config-store": "export const useEffectiveConfig=()=>globalThis.__canvasPromptPanelHarness.config; export const useConfigStore=fn=>fn({openConfigDialog:()=>{}});",
    "@/lib/canvas/canvas-generation-helpers": "export const buildGenerationConfig=(...args)=>globalThis.__canvasPromptPanelHarness.buildGenerationConfig(...args);",
    "@/lib/canvas-theme": "export const canvasThemes={test:{toolbar:{},node:{}}};",
    "@/stores/use-theme-store": "export const useThemeStore=fn=>fn({theme:'test'});",
    "@/types/canvas": "export const CanvasNodeType={Image:'image',Text:'text',Video:'video',Audio:'audio'};",
    "./canvas-image-settings-popover": "export const CanvasImageSettingsPopover='CanvasImageSettingsPopover';",
    "./canvas-prompt-library": "export const CanvasPromptLibrary='CanvasPromptLibrary';",
    "./canvas-audio-settings-popover": "export const CanvasAudioSettingsPopover='CanvasAudioSettingsPopover';",
    "./canvas-prompt-chip-input": "export const CanvasPromptChipInput='CanvasPromptChipInput';",
    "./canvas-video-settings-popover": "export const CanvasVideoSettingsPopover='CanvasVideoSettingsPopover';",
    "./canvas-text-settings-popover": "export const CanvasTextSettingsPopover='CanvasTextSettingsPopover';",
};
const compiled = await build({
    entryPoints: [new URL("../src/components/canvas/canvas-node-prompt-panel.tsx", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    plugins: [
        {
            name: "prompt-panel-test",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => (mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined));
                builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
            },
        },
    ],
});
const { CanvasNodePromptPanel } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function allNodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(2).flatMap(allNodes)];
}

function createPanel(node) {
    const hooks = [];
    let cursor = 0;
    let effects = [];
    let dirty = false;
    const generated = [];
    const persisted = [];
    const configChanges = [];
    let props = { node, isRunning: false, onGenerate: (...args) => generated.push(args), onPromptChange: (...args) => persisted.push(args), onConfigChange: (...args) => configChanges.push(args), onStop: () => {} };
    const harness = {
        config: { model: "test-model", videoModel: "doubao-seedance-2-5-260628" },
        buildGenerationConfig: (globalConfig, currentNode) => ({ ...globalConfig, ...currentNode.metadata }),
        useState(initial) {
            const index = cursor++;
            if (!hooks[index]) hooks[index] = { value: typeof initial === "function" ? initial() : initial };
            return [
                hooks[index].value,
                (next) => {
                    const value = typeof next === "function" ? next(hooks[index].value) : next;
                    if (!Object.is(value, hooks[index].value)) {
                        hooks[index].value = value;
                        dirty = true;
                    }
                },
            ];
        },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!hooks[index] || deps.some((value, i) => !Object.is(value, hooks[index].deps[i]))) {
                hooks[index] = { deps };
                effects.push(effect);
            }
        },
    };
    const render = (patch = {}, requestedType = "CanvasPromptChipInput") => {
        props = { ...props, ...patch };
        globalThis.__canvasPromptPanelHarness = harness;
        let tree;
        let renders = 0;
        do {
            cursor = 0;
            effects = [];
            dirty = false;
            tree = CanvasNodePromptPanel(props);
            effects.forEach((effect) => effect());
            assert.ok(++renders < 10, "state updates settle");
        } while (dirty);
        return allNodes(tree).find((item) => item.type === requestedType).props;
    };
    return { render, generated, persisted, configChanges };
}

test("Seedance 2.5 画布选项从节点配置读回，点击任务模式写回同一节点", () => {
    const node = { id: "shot", type: "video", metadata: { model: "doubao-seedance-2-5-260628", seedance25TaskMode: "extend", seedance25InputMode: "first-last", seconds: "10" } };
    const panel = createPanel(node);
    const settings = panel.render({}, "CanvasVideoSettingsPopover");
    assert.equal(settings.config.seedance25TaskMode, "extend");
    assert.equal(settings.config.seedance25InputMode, "first-last");
    settings.onConfigChange("seedance25TaskMode", "edit");
    assert.deepEqual(panel.configChanges.at(-1), ["shot", { seedance25TaskMode: "edit" }]);
    const changed = panel.render({ node: { ...node, metadata: { ...node.metadata, seedance25TaskMode: "edit" } } }, "CanvasVideoSettingsPopover");
    assert.equal(changed.config.seedance25TaskMode, "edit");
});

test("same-node external prompt updates replace stale references in the editor and submitted request", () => {
    const node = { id: "scene", type: "image", metadata: { prompt: "采用 @[node:removed]" } };
    const panel = createPanel(node);
    assert.equal(panel.render().value, node.metadata.prompt);
    const updated = panel.render({ node: { ...node, metadata: { ...node.metadata, prompt: "采用 @[node:character]，保留服装" } } });
    assert.equal(updated.value, "采用 @[node:character]，保留服装");
    updated.onSubmit();
    assert.deepEqual(panel.generated, [["scene", "image", updated.value]]);
});

test("unrelated metadata updates preserve an unsaved edit to existing media", () => {
    const node = { id: "scene", type: "image", metadata: { prompt: "原提示词", content: "data:image/png;base64,YQ==" } };
    const panel = createPanel(node);
    panel.render().onChange("正在编辑的新要求");
    const updated = panel.render({ node: { ...node, metadata: { ...node.metadata, status: "success" } } });
    assert.equal(updated.value, "正在编辑的新要求");
    assert.deepEqual(panel.persisted, []);
    updated.onSubmit();
    assert.deepEqual(panel.generated, [["scene", "image", "正在编辑的新要求"]]);
});

test("external clearing removes the current prompt and prevents submitting stale text", () => {
    const node = { id: "scene", type: "image", metadata: { prompt: "旧提示词" } };
    const panel = createPanel(node);
    panel.render();
    const updated = panel.render({ node: { ...node, metadata: { prompt: "" } } });
    assert.equal(updated.value, "");
    updated.onSubmit();
    assert.deepEqual(panel.generated, []);
});

test("switching nodes restores its saved prompt even when both nodes have the same original text", () => {
    const node = { id: "first", type: "text", metadata: { prompt: "原提示词", content: "已有正文" } };
    const panel = createPanel(node);
    panel.render().onChange("第一张的草稿");
    assert.equal(panel.render().value, "第一张的草稿");
    assert.equal(panel.render({ node: { ...node, id: "second" } }).value, "原提示词");
});
