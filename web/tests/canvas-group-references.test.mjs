import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
const mocks = new Map([
    ["@/types/canvas", 'export const CanvasNodeType = { Image:"image", Text:"text", File:"file", Config:"config", Video:"video", Audio:"audio", Group:"group" };'],
    ["@/lib/canvas/node-registry", "export const getNodeDefinition = () => undefined;"],
    ["@/stores/use-config-store", "export const resolveModelRequestConfig = config => config;"],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (mocks.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks.get(specifier))}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return nextResolve(specifier, context);
    },
});
const { buildNodeMentionReferences } = await import("../src/lib/canvas/canvas-resource-references.ts");
const node = (id, type, metadata = {}) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata });
const role = node("小狸", "group", { assetKind: "character", groupPrompt: "参考 @[node:front] 保持围巾" });
const front = node("front", "image", { groupId: role.id, storageKey: "image:front", status: "success" });
const unused = node("unused", "audio", { groupId: role.id });
const scene = node("小屋", "group", { assetKind: "scene" });
const set = node("set", "text", { groupId: scene.id, content: "暖黄色灯光" });
const next = node("next", "config");
const edges = [role, scene].map((n) => ({ id: n.id, fromNodeId: n.id, toNodeId: next.id }));
test("upstream bundles expose one role/scene reference with effective members and readiness", () => {
    const refs = buildNodeMentionReferences(next, [role, front, unused, scene, set, next], edges);
    assert.deepEqual(
        refs.map((r) => r.label),
        ["角色1", "场景1"],
    );
    assert.equal(refs[0].ready, true);
    assert.deepEqual(
        refs[0].members.map((r) => r.nodeId),
        [role.id, front.id],
    );
    const broken = buildNodeMentionReferences(next, [{ ...role, metadata: { ...role.metadata, groupPrompt: "@[node:missing]" } }, front, next], edges.slice(0, 1));
    assert.equal(broken[0].ready, false);
});
test("group editor can choose individual members, including unready audio", () => {
    const refs = buildNodeMentionReferences(role, [role, front, unused], []);
    assert.deepEqual(
        refs.map((r) => r.nodeId),
        ["front", "unused"],
    );
    assert.equal(refs[1].ready, false);
});
test("legacy imported groups keep role labels without changing their data or collapsing them", () => {
    const legacy = { ...role, title: "人物 · 小狸", metadata: { groupPrompt: "@[node:front]" } };
    const refs = buildNodeMentionReferences(next, [legacy, front, next], edges.slice(0, 1));
    assert.equal(refs[0].label, "角色1");
    assert.equal(legacy.metadata.groupCollapsed, undefined);
});