import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const mocks = new Map([
    ["@/types/canvas", 'export const CanvasNodeType = { Image: "image", Text: "text", File: "file", Config: "config", Video: "video", Audio: "audio", Terminal: "terminal", Group: "group" };'],
    [
        "@/constant/canvas",
        `export const NODE_DEFAULT_SIZE = { image: { width: 340, height: 240 }, video: { width: 420, height: 236 } };
        export const getNodeSpec = (type) => ({ width: type === "group" ? 760 : 340, height: type === "group" ? 480 : 240, title: type, metadata: { status: "idle" } });`,
    ],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        const source = mocks.get(specifier);
        if (source !== undefined) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return nextResolve(specifier, context);
    },
});

const { createStructuredAssetGroup, refreshStructuredAssetGroup } = await import("../src/lib/canvas/canvas-node-factory.ts");
const { STRUCTURED_PART_EXAMPLE_PROMPTS } = await import("../src/lib/structured-asset-reference.ts");
const geometry = await import("../src/lib/canvas/canvas-node-geometry.ts");
const { getCanvasInputSources } = await import("../src/lib/canvas/canvas-group-inputs.ts");

const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 320, height: 240, metadata });
const image = (id, extra = {}) => ({ id, title: id, dataUrl: `data:image/png;base64,${id}`, storageKey: `image:${id}`, width: 512, height: 768, bytes: 2048, mimeType: "image/png", ...extra });

test("imported character assets collapse to one card while retaining current media and full setting leaves", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "character",
            title: "雪狐",
            description: "白色短毛",
            fields: { 一致性规则: "始终戴绿围巾" },
            images: [image("old", { isCurrent: false }), image("hero", { isCurrent: true, prompt: "正面全身" }), image("legacy")],
            parts: [{ id: "hero", groupId: "appearance", title: "主视觉", description: "标准形象", expectedOutput: "全身照", prompt: "圆耳朵，尾巴短" }],
            activePartId: "hero",
        },
        { x: 500, y: 400 },
    );
    const [group, profile, ...images] = nodes;
    assert.equal(group.type, "group");
    assert.equal(group.metadata.assetKind, "character");
    assert.equal(group.metadata.groupCollapsed, true);
    assert.equal(group.width, 320);
    assert.equal(group.height, 240);
    assert.ok(group.metadata.groupExpandedWidth > group.width);
    assert.ok(group.metadata.groupExpandedHeight > group.height);
    assert.equal(profile.metadata.groupId, group.id);
    assert.match(profile.metadata.content, /白色短毛/);
    assert.match(profile.metadata.content, /始终戴绿围巾/);
    assert.match(profile.metadata.content, /圆耳朵，尾巴短/);
    assert.deepEqual(
        images.map((item) => item.metadata.storageKey),
        ["image:hero", "image:legacy"],
    );
    assert.equal(images[0].metadata.prompt, "正面全身");
    for (const child of nodes.slice(1)) {
        assert.ok(child.position.x >= group.position.x);
        assert.ok(child.position.x + child.width <= group.position.x + group.metadata.groupExpandedWidth);
        assert.ok(child.position.y + child.height <= group.position.y + group.metadata.groupExpandedHeight);
    }
});

test("scene imports carry an explicit kind without classifying unrelated old groups by title", () => {
    const [scene] = createStructuredAssetGroup({ assetKind: "scene", title: "小屋", description: "木质空间", fields: {}, images: [] }, { x: 0, y: 0 });
    assert.equal(scene.metadata.assetKind, "scene");
    assert.equal(scene.metadata.groupCollapsed, true);
    const oldGroup = node("old", "group");
    oldGroup.title = "人物 · 旧组";
    const child = node("child", "text", { groupId: oldGroup.id });
    assert.equal(geometry.isHiddenBatchChild(child, [oldGroup, child]), false);
});

test("groups provide whole-asset outgoing edges and cannot accept incoming edges", () => {
    const nodes = [node("group", "group"), node("other", "group"), node("action", "config"), node("terminal", "terminal")];
    assert.deepEqual(geometry.normalizeConnection("group", "action", nodes, "source"), { fromNodeId: "group", toNodeId: "action" });
    assert.deepEqual(geometry.normalizeConnection("group", "terminal", nodes, "source"), { fromNodeId: "group", toNodeId: "terminal" });
    assert.deepEqual(geometry.normalizeConnection("action", "group", nodes, "target"), { fromNodeId: "group", toNodeId: "action" });
    assert.equal(geometry.normalizeConnection("action", "group", nodes, "source"), null);
    assert.equal(geometry.normalizeConnection("group", "other", nodes, "source"), null);
});

test("individual assets respect the input handle when a wire is drawn backwards", () => {
    const nodes = [node("image", "image"), node("audio", "audio"), node("action", "config")];
    assert.deepEqual(geometry.normalizeConnection("image", "audio", nodes, "target"), { fromNodeId: "audio", toNodeId: "image" });
    assert.deepEqual(geometry.normalizeConnection("image", "action", nodes, "target"), { fromNodeId: "action", toNodeId: "image" });
    assert.deepEqual(geometry.normalizeConnection("image", "action", nodes, "source"), { fromNodeId: "image", toNodeId: "action" });
});

test("collapsed groups hide descendants and redirect external edges to the outer visible group", () => {
    const outer = node("outer", "group", { groupCollapsed: true });
    const inner = node("inner", "group", { groupId: "outer", groupCollapsed: true });
    const photo = node("photo", "image", { groupId: "inner" });
    const nodes = [outer, inner, photo];
    assert.equal(geometry.isHiddenBatchChild(outer, nodes), false);
    assert.equal(geometry.isHiddenBatchChild(inner, nodes), true);
    assert.equal(geometry.isHiddenBatchChild(photo, nodes), true);
    assert.equal(geometry.getVisibleCanvasNodeId(photo.id, nodes), "outer");
    outer.metadata.groupCollapsed = false;
    assert.equal(geometry.getVisibleCanvasNodeId(photo.id, nodes), "inner");
    inner.metadata.groupCollapsed = false;
    assert.equal(geometry.getVisibleCanvasNodeId(photo.id, nodes), "photo");
});

test("group visibility remains authoritative during batch animation and malformed cycles terminate", () => {
    const group = node("group", "group", { groupCollapsed: true });
    const batch = node("batch", "image", { groupId: group.id, imageBatchExpanded: false });
    const child = node("child", "image", { batchRootId: batch.id });
    assert.equal(geometry.isHiddenBatchChild(child, [group, batch, child], new Set([batch.id])), true);
    assert.equal(geometry.getVisibleCanvasNodeId(child.id, [group, batch, child]), group.id);
    const cycle = [node("a", "group", { groupId: "b", groupCollapsed: true }), node("b", "group", { groupId: "a", groupCollapsed: true })];
    assert.equal(typeof geometry.getVisibleCanvasNodeId("a", cycle), "string");
    assert.equal(geometry.getVisibleCanvasNodeId("missing", cycle), "missing");
});

test("ordinary batch visibility preserves its opening and closing behavior", () => {
    const root = node("root", "image", { imageBatchExpanded: false });
    const child = node("child", "image", { batchRootId: root.id });
    assert.equal(geometry.isHiddenBatchChild(child, [root, child]), true);
    assert.equal(geometry.isHiddenBatchChild(child, [root, child], new Set([root.id])), false);
    assert.equal(geometry.isHiddenBatchConnectionEndpoint(child, [root, child]), true);
});

test("group collapse restores expanded dimensions without moving its stored content", () => {
    const group = { ...node("group", "group"), width: 980, height: 620, position: { x: 120, y: 180 } };
    const collapsed = geometry.getCanvasGroupTogglePatch(group);
    assert.deepEqual(collapsed, { width: 320, height: 240, metadata: { groupCollapsed: true, groupExpandedWidth: 980, groupExpandedHeight: 620 } });
    const expanded = geometry.getCanvasGroupTogglePatch({ ...group, ...collapsed });
    assert.equal(expanded.width, 980);
    assert.equal(expanded.height, 620);
    assert.equal(expanded.metadata.groupCollapsed, false);
    assert.deepEqual(group.position, { x: 120, y: 180 });
});

test("saved reference prompts map stable asset image ids and keep explicitly selected historical images", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "character",
            title: "雪狐",
            description: "白色短毛",
            fields: {},
            images: [image("old", { isCurrent: false }), image("unused-old", { isCurrent: false }), image("current", { isCurrent: true })],
            referencePrompt: "@[node:old] 保留最初服装，@[node:current] 作为脸部参考；@[node:missing]",
        },
        { x: 0, y: 0 },
    );
    const imported = nodes.filter((item) => item.type === "image");
    assert.deepEqual(
        imported.map((item) => item.metadata.storageKey),
        ["image:old", "image:current"],
    );
    assert.equal(nodes[0].metadata.groupPrompt, `@[node:${imported[0].id}] 保留最初服装，@[node:${imported[1].id}] 作为脸部参考；@[node:missing]`);
});

test("an absent prompt gets setting and reference bindings while an explicit empty prompt remains empty", () => {
    const source = { assetKind: "scene", title: "小屋", description: "木质空间", fields: {}, images: [image("room")] };
    const defaults = createStructuredAssetGroup(source, { x: 0, y: 0 });
    assert.match(defaults[0].metadata.groupPrompt, /木质空间/);
    assert.ok(defaults[0].metadata.groupPrompt.includes(`@[node:${defaults[1].id}]`));
    assert.ok(defaults[0].metadata.groupPrompt.includes(`@[node:${defaults[2].id}]`));
    assert.equal(createStructuredAssetGroup({ ...source, referencePrompt: "" }, { x: 0, y: 0 })[0].metadata.groupPrompt, "");
});

test("unused built-in part examples never become character facts but authored text parts are retained", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "character",
            title: "雪狐",
            description: "白色短毛",
            fields: {},
            images: [],
            parts: [
                { id: "hero", groupId: "appearance", title: "主视觉", description: "", expectedOutput: "", prompt: STRUCTURED_PART_EXAMPLE_PROMPTS.character.hero },
                { id: "identity-profile", groupId: "identity", title: "身份", description: "", expectedOutput: "", prompt: "森林里的邮差，性格勇敢" },
            ],
        },
        { x: 0, y: 0 },
    );
    assert.match(nodes[1].metadata.content, /森林里的邮差/);
    assert.doesNotMatch(nodes[1].metadata.content, /电影感人物主视觉/);
});

test("collection groups import only the materials selected by the authored reference", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "character",
            title: "展示名",
            description: "仅展示简介",
            fields: { 旧字段: "不引用" },
            collectionVersion: 1,
            avatarImageId: "avatar",
            parts: [
                { id: "overview", groupId: "overview", title: "总览", description: "", expectedOutput: "", prompt: "圆耳朵" },
                { id: "outfit", groupId: "outfit", title: "服装", description: "", expectedOutput: "", prompt: "红色披风", enabled: false },
            ],
            images: [image("avatar", { partId: "avatar" }), image("hero"), image("red", { partId: "outfit" })],
            referencePrompt: "@[node:overview] @[node:outfit] @[node:red] @[node:avatar]",
        },
        { x: 0, y: 0 },
    );
    assert.equal(nodes[0].metadata.assetCollectionVersion, 1);
    assert.doesNotMatch(JSON.stringify(nodes), /仅展示简介|不引用|红色披风|image:avatar/u);
    assert.match(nodes[0].metadata.groupPrompt, /圆耳朵/u);
    assert.doesNotMatch(nodes[0].metadata.groupPrompt, /node:red|node:outfit|node:avatar/u);
    assert.deepEqual(
        nodes.filter((item) => item.type === "image").map((item) => item.metadata.storageKey),
        [],
    );
    const input = getCanvasInputSources("next", nodes, [{ fromNodeId: nodes[0].id, toNodeId: "next" }]);
    assert.deepEqual(
        input.map((item) => item.node.type),
        ["text"],
    );
    const cleared = [{ ...nodes[0], metadata: { ...nodes[0].metadata, groupPrompt: "" } }, ...nodes.slice(1)];
    assert.equal(getCanvasInputSources("next", cleared, [{ fromNodeId: nodes[0].id, toNodeId: "next" }])[0].node.metadata.status, "error");
});

test("collection part-image templates are expanded before importing stable image bindings", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "scene",
            title: "小屋",
            description: "仅展示",
            fields: {},
            collectionVersion: 1,
            parts: [{ id: "views", groupId: "views", title: "视角", description: "", expectedOutput: "", prompt: "窗户在左侧" }],
            images: [image("front", { partId: "views" })],
            referencePrompt: "@[node:views] @[node:missing]",
        },
        { x: 0, y: 0 },
    );
    const imported = nodes.find((item) => item.type === "image");
    assert.equal(nodes[0].metadata.groupPrompt, `视角：窗户在左侧\nfront：@[node:${imported.id}] @[node:missing]`);
});

test("unselected collection images do not enter the group or its downstream inputs", () => {
    const nodes = createStructuredAssetGroup(
        {
            assetKind: "character",
            title: "小狸",
            description: "",
            fields: {},
            collectionVersion: 1,
            parts: [{ id: "hero", groupId: "appearance", title: "主视图", description: "", expectedOutput: "", prompt: "戴蓝围巾，@[node:unused]" }],
            images: [image("selected", { partId: "hero", isCurrent: true }), image("unused", { partId: "hero", isCurrent: false })],
            referencePrompt: "@[node:hero] @[node:unused]",
        },
        { x: 0, y: 0 },
    );
    const imported = nodes.filter((item) => item.type === "image");
    assert.deepEqual(
        imported.map((item) => item.metadata.storageKey),
        ["image:selected"],
    );
    assert.doesNotMatch(nodes[0].metadata.groupPrompt, /unused/);
    assert.doesNotMatch(nodes.find((item) => item.type === "text").metadata.content, /unused/);
    const inputs = getCanvasInputSources("next", nodes, [{ fromNodeId: nodes[0].id, toNodeId: "next" }]);
    assert.deepEqual(
        inputs.filter(({ node }) => node.type === "image").map(({ node }) => node.id),
        [imported[0].id],
    );
});

test("collected voice recordings become independently connectable audio nodes and mapped group references", () => {
    const audios = [
        { id: "voice", title: "日常音色", partId: "voice-profile", url: "wg-media://voice", storageKey: "audio:voice", durationMs: 2400, bytes: 24, mimeType: "audio/wav", isCurrent: true },
        { id: "voice-old", title: "备用音色", partId: "voice-profile", url: "wg-media://old", storageKey: "audio:old", bytes: 12, mimeType: "audio/mpeg", isCurrent: false },
    ];
    const nodes = createStructuredAssetGroup({ assetKind: "character", collectionVersion: 1, title: "角色", description: "", fields: {}, images: [], audios, referencePrompt: "温柔的声音 @[node:voice]" }, { x: 300, y: 300 });
    const voices = nodes.filter((item) => item.type === "audio");
    assert.equal(voices.length, 1);
    assert.equal(voices[0].metadata.content, audios[0].url);
    assert.equal(voices[0].metadata.durationMs, 2400);
    assert.equal(voices[0].metadata.storageKey, "audio:voice");
    assert.equal(voices[0].metadata.groupId, nodes[0].id);
    assert.equal(nodes[0].metadata.groupPrompt, `温柔的声音 @[node:${voices[0].id}]`);
    assert.doesNotMatch(nodes[0].metadata.groupPrompt, /voice-old/);
    for (const voice of voices) assert.ok(voice.position.y + voice.height <= nodes[0].position.y + nodes[0].metadata.groupExpandedHeight);
});

test("saving a workbench asset refreshes its group without retaining removed references", () => {
    const original = createStructuredAssetGroup(
        { assetKind: "character", collectionVersion: 1, title: "噜噜", description: "", fields: {}, sourceAssetId: "asset-lulu", avatarImageId: "avatar", images: [image("avatar", { partId: "avatar" }), image("old", { partId: "hero" })], parts: [{ id: "hero", groupId: "appearance", title: "主视图", description: "", expectedOutput: "", prompt: "旧设定" }], referencePrompt: "@[node:hero]" },
        { x: 300, y: 300 },
    );
    const group = original[0];
    const oldImage = original.find((node) => node.type === "image");
    const next = refreshStructuredAssetGroup(
        original,
        { assetKind: "character", collectionVersion: 1, title: "噜噜", description: "", fields: {}, sourceAssetId: "asset-lulu", avatarImageId: "avatar", images: [image("avatar", { partId: "avatar" }), image("new", { partId: "hero" })], parts: [{ id: "hero", groupId: "appearance", title: "主视图", description: "", expectedOutput: "", prompt: "新设定" }], referencePrompt: "@[node:hero]" },
        group.id,
        [{ fromNodeId: group.id, toNodeId: "next" }],
    );
    const refreshed = next.find((node) => node.id === group.id);
    assert.equal(refreshed.metadata.assetSourceId, "asset-lulu");
    assert.equal(refreshed.metadata.assetCoverUrl, "data:image/png;base64,avatar");
    assert.match(refreshed.metadata.groupPrompt, /新设定/);
    assert.doesNotMatch(JSON.stringify(next), /旧设定|image:old/);
    assert.equal(next.some((node) => node.id === oldImage.id && node.metadata.groupId === group.id), false);
});
