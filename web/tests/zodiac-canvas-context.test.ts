import assert from "node:assert/strict";
import test from "node:test";

import { expandZodiacGroupNodeIds, redactZodiacContextText, selectZodiacCanvasImages, selectZodiacContextNodes, type ZodiacCanvasSnapshot } from "../src/lib/agent/zodiac-canvas-context.ts";

const node = (id: string, type: string, title: string, metadata: Record<string, unknown> = {}) => ({ id, type, title, position: { x: 0, y: 0 }, metadata });

function groupedSnapshot(): ZodiacCanvasSnapshot {
    return {
        title: "双人故事",
        selectedNodeIds: [],
        connections: [],
        nodes: [
            node("group-a", "group", "人物 · 雪狐"),
            node("a-profile", "text", "雪狐 · 资料", { groupId: "group-a", content: "白色短毛、绿围巾" }),
            node("a-sheet", "image", "雪狐 · 三视图", { groupId: "group-a", content: "a-sheet" }),
            node("a-hero", "image", "雪狐 · 主视觉", { groupId: "group-a", content: "a-hero" }),
            node("a-front", "image", "雪狐 · 正面", { groupId: "group-a", content: "a-front" }),
            node("group-b", "group", "人物 · 赤熊"),
            node("b-profile", "text", "赤熊 · 资料", { groupId: "group-b", content: "棕红色毛、蓝色背带裤" }),
            node("b-sheet", "image", "赤熊 · 表情板", { groupId: "group-b", content: "b-sheet" }),
            node("b-hero", "image", "赤熊 · 主视觉", { groupId: "group-b", storageKey: "b-hero" }),
            node("b-front", "image", "赤熊 · 正面", { groupId: "group-b", content: "b-front" }),
        ],
    };
}

test("automatic visual context balances character groups and favors their identity images", () => {
    assert.deepEqual(selectZodiacCanvasImages(groupedSnapshot(), { maxImages: 4 }), { nodeIds: ["a-hero", "b-hero", "a-front", "b-front"], omitted: 2 });
});

test("explicitly named assets and selected members expand to the relevant group", () => {
    const snapshot = groupedSnapshot();
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { userText: "请用赤熊做分镜", maxImages: 2 }), { nodeIds: ["b-hero", "b-front"], omitted: 1 });
    snapshot.selectedNodeIds = ["a-sheet"];
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { maxImages: 2 }), { nodeIds: ["a-sheet", "a-hero"], omitted: 1 });
});

test("requesting canvas character groups includes both despite an unrelated previous selection", () => {
    const snapshot = groupedSnapshot();
    snapshot.nodes.unshift(node("old", "config", "旧分镜"));
    snapshot.selectedNodeIds = ["old"];
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { userText: "帮我统合画布上两个人物组，编写剧本", maxImages: 2 }), { nodeIds: ["a-hero", "b-hero"], omitted: 4 });
});

test("renamed asset cards retain their declared character identity for canvas requests", () => {
    const snapshot = groupedSnapshot();
    snapshot.nodes = snapshot.nodes.map((item) => item.type === "group" ? { ...item, title: item.id, metadata: { ...item.metadata, assetKind: "character" } } : item);
    snapshot.nodes.push(node("old", "config", "旧分镜"));
    snapshot.selectedNodeIds = ["old"];
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { userText: "使用画布上两个人物组", maxImages: 2 }).nodeIds, ["a-hero", "b-hero"]);
});

test("connected references are visible when the selected action is downstream", () => {
    const snapshot = groupedSnapshot();
    snapshot.nodes.push(node("shot", "config", "镜头"));
    snapshot.selectedNodeIds = ["shot"];
    snapshot.connections.push({ fromNodeId: "b-hero", toNodeId: "shot" });
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { maxImages: 2 }).nodeIds, ["b-hero", "b-front"]);
});

test("nested group expansion terminates on invalid cycles and ignores nonexistent ids", () => {
    const nodes = [node("outer", "group", "外层", { groupId: "inner" }), node("inner", "group", "内层", { groupId: "outer" }), node("photo", "image", "照片", { groupId: "inner", content: "photo" })];
    assert.deepEqual(expandZodiacGroupNodeIds(nodes, ["outer", "missing", "photo"]), ["outer", "inner", "photo"]);
});

test("image selection excludes pending, failed, and empty resources and honors a zero limit", () => {
    const snapshot: ZodiacCanvasSnapshot = {
        title: "参考",
        selectedNodeIds: [],
        connections: [],
        nodes: [
            node("empty", "image", "空图"),
            node("loading", "image", "生成中", { content: "old", status: "loading" }),
            node("failed", "image", "失败", { content: "old", status: "error" }),
            node("slot", "image", "未完成槽位", { content: "old", role: "result-slot", slotState: "empty" }),
            node("ready", "image", "可用图", { storageKey: "stored" }),
        ],
    };
    assert.deepEqual(selectZodiacCanvasImages(snapshot), { nodeIds: ["ready"], omitted: 0 });
    assert.deepEqual(selectZodiacCanvasImages(snapshot, { maxImages: 0 }), { nodeIds: [], omitted: 1 });
});

test("small text contexts keep a profile from each group before optional image details", () => {
    const ids = selectZodiacContextNodes(groupedSnapshot(), 4).map((item) => item.id);
    assert.deepEqual(ids, ["group-a", "group-b", "a-profile", "b-profile"]);
});

test("context sanitization covers quoted credentials and platform media locations", () => {
    const safe = redactZodiacContextText('服装：绿围巾。{"apiKey":"private-json-key"} Bearer private-bearer C:\\Users\\name\\private-file.png wg-media://private/abc.jpg file:///Users/name/secret.png');
    assert.match(safe, /绿围巾/);
    assert.doesNotMatch(safe, /private-json-key|private-bearer|private-file|private\/abc|Users\/name/);
});
