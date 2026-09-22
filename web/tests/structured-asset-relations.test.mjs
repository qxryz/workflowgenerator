import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

const mocks = {
    react: "export const useState = initial => globalThis.__relationsTest.useState(initial); export const useEffect = (effect, deps) => globalThis.__relationsTest.useEffect(effect, deps);",
    "react/jsx-runtime": "export const jsx = (type, props) => ({ type, props }); export const jsxs = jsx; export const Fragment = 'Fragment';",
    "lucide-react": "export const MapPin='MapPin', Plus='Plus', Search='Search', Trash2='Trash2', UserRound='UserRound', X='X';",
    nanoid: "export const nanoid = () => 'new-relation';",
    "@/hooks/use-app-translation": "export const useAppTranslation = () => ({ language: 'zh-CN' });",
    "@/stores/use-asset-store": "export const useAssetStore = selector => selector({ assets: globalThis.__relationsTest.assets });",
};
const compiled = await build({
    entryPoints: [new URL("../src/pages/image/structured-asset-relations.tsx", import.meta.url).pathname],
    bundle: true,
    write: false,
    format: "esm",
    platform: "node",
    jsx: "automatic",
    plugins: [
        {
            name: "relations-test",
            setup(builder) {
                builder.onResolve({ filter: /.*/ }, (args) => (mocks[args.path] ? { path: args.path, namespace: "mock" } : undefined));
                builder.onLoad({ filter: /.*/, namespace: "mock" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
            },
        },
    ],
});
const { StructuredAssetRelations } = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`);

function nodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(2).flatMap(nodes)];
}
function text(tree) {
    if (typeof tree === "string") return tree;
    if (!tree || typeof tree !== "object") return "";
    return [tree.props?.children].flat(2).map(text).join("");
}
function panel(assets, relationships = [], kind = "character") {
    let cursor = 0;
    const state = [];
    let effects = [];
    let dirty = false;
    const changes = [];
    let tree;
    let props = {
        kind,
        assetId: "self",
        title: "当前资产",
        relationships,
        onChange: (next) => {
            changes.push(next);
            props = { ...props, relationships: next };
        },
    };
    const harness = {
        assets,
        useState(initial) {
            const index = cursor++;
            if (!(index in state)) state[index] = initial;
            return [
                state[index],
                (next) => {
                    const value = typeof next === "function" ? next(state[index]) : next;
                    dirty ||= !Object.is(value, state[index]);
                    state[index] = value;
                },
            ];
        },
        useEffect(effect, deps) {
            const index = cursor++;
            if (!state[index] || deps.some((value, i) => !Object.is(value, state[index][i]))) {
                state[index] = deps;
                effects.push(effect);
            }
        },
    };
    const render = (patch = {}) => {
        props = { ...props, ...patch };
        globalThis.__relationsTest = harness;
        do {
            cursor = 0;
            dirty = false;
            effects = [];
            tree = StructuredAssetRelations(props);
            effects.forEach((effect) => effect());
        } while (dirty);
        return tree;
    };
    render();
    return {
        render,
        changes,
        all: () => nodes(tree),
        button: (name) => nodes(tree).find((node) => node.type === "button" && text(node) === name),
        input: (placeholder) => nodes(tree).find((node) => node.type === "input" && node.props.placeholder === placeholder),
        submit: () =>
            nodes(tree)
                .find((node) => node.type === "form")
                .props.onSubmit({ preventDefault() {} }),
    };
}
const asset = (id, title, kind = "character") => ({ id, title, kind, coverUrl: `${id}.png` });

test("relationship picker searches only other same-kind assets and excludes existing links", () => {
    const view = panel([asset("self", "当前资产"), asset("friend", "噜噜"), asset("related", "已关联"), asset("scene", "噜噜的家", "scene")], [{ id: "r", targetAssetId: "related", targetName: "已关联", label: "朋友" }]);
    view.button("添加关系").props.onClick();
    view.render();
    view.input("搜索人物库").props.onChange({ target: { value: "噜噜" } });
    view.render();
    assert.ok(view.button("噜噜"));
    assert.equal(view.button("当前资产"), undefined);
    assert.equal(view.button("噜噜的家"), undefined);
    assert.equal(
        view.all().find((node) => node.type === "button" && node.props["aria-pressed"] !== undefined && text(node) === "已关联"),
        undefined,
    );
    view.button("噜噜").props.onClick();
    view.render();
    assert.equal(view.button("保存关系").props.disabled, true);
    view.input("如：朋友、家人、同事").props.onChange({ target: { value: "  朋友  " } });
    view.render();
    view.submit();
    assert.deepEqual(view.changes[0][1], { id: "new-relation", targetAssetId: "friend", targetName: "噜噜", label: "朋友" });
});

test("linked cards show current library names and edit labels without opening another asset", () => {
    const view = panel([asset("friend", "新名字")], [{ id: "r", targetAssetId: "friend", targetName: "旧名字", label: "朋友" }]);
    assert.ok(view.all().find((node) => node.type === "path"));
    const card = view.all().find((node) => node.props?.["aria-label"] === "编辑关系 · 新名字");
    assert.ok(card);
    card.props.onClick();
    view.render();
    view.input("如：朋友、家人、同事").props.onChange({ target: { value: "家人" } });
    view.render();
    view.submit();
    assert.deepEqual(view.changes, [[{ id: "r", targetAssetId: "friend", targetName: "新名字", label: "家人" }]]);
});

test("missing targets keep their name and can be unlinked without deleting library assets", () => {
    const assets = [asset("friend", "噜噜")];
    const view = panel(assets, [{ id: "missing", targetAssetId: "removed", targetName: "噜妹", label: "恋人" }]);
    const card = view.all().find((node) => node.props?.["aria-label"] === "编辑关系 · 噜妹");
    assert.equal(text(card), "噜妹");
    assert.equal(card.props.title, "资产已移除");
    card.props.onClick();
    view.render();
    view.button("移除关系").props.onClick();
    assert.deepEqual(view.changes, [[]]);
    assert.deepEqual(assets, [asset("friend", "噜噜")]);
});

test("scene relationships select scenes and cancel without modifying the draft", () => {
    const view = panel([asset("room", "客厅", "scene"), asset("character", "噜噜")], [], "scene");
    view.button("添加关系").props.onClick();
    view.render();
    assert.ok(view.input("搜索场景库"));
    assert.ok(view.button("客厅"));
    assert.equal(view.button("噜噜"), undefined);
    view.button("客厅").props.onClick();
    view.render();
    view.input("如：相邻、位于室内、通往").props.onChange({ target: { value: "通往" } });
    view.render();
    view.button("取消").props.onClick();
    view.render();
    assert.deepEqual(view.changes, []);
    assert.equal(
        view.all().some((node) => node.type === "form"),
        false,
    );
});

test("switching assets closes unfinished relation editing instead of carrying it into another draft", () => {
    const view = panel([asset("friend", "噜噜")]);
    view.button("添加关系").props.onClick();
    view.render();
    view.button("噜噜").props.onClick();
    view.render();
    view.input("如：朋友、家人、同事").props.onChange({ target: { value: "家人" } });
    view.render({ assetId: "another-asset" });
    assert.deepEqual(view.changes, []);
    assert.equal(
        view.all().some((node) => node.type === "form"),
        false,
    );
});

test("topology nodes contain only names and avatars; labels belong to edges", () => {
    const view = panel([asset("friend", "噜噜")], [{ id: "r", targetAssetId: "friend", targetName: "噜噜", label: "朋友" }]);
    const card = view.all().find((node) => node.props?.["aria-label"] === "编辑关系 · 噜噜");
    assert.equal(text(card), "噜噜");
    assert.ok(view.all().find((node) => node.props?.["data-relationship-edge"] === "r" && text(node) === "朋友"));
});
