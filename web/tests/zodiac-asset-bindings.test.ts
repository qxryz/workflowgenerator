import assert from "node:assert/strict";
import test from "node:test";
import { prepareZodiacToolProposal, normalizeZodiacCanvasOps } from "../src/lib/agent/zodiac-tool-proposal.ts";

const assets = [
    { id: "cast", type: "group", title: "人物 · 橘子" },
    { id: "profile", type: "text", metadata: { groupId: "cast", content: "橘子头，白帽，橙色身体" } },
    { id: "portrait", type: "image", metadata: { groupId: "cast", content: "image-content" } },
    { id: "unrelated", type: "image", metadata: { content: "unrelated-content" } },
];
const action = (prompt: string) => ({ type: "add_node" as const, id: "shot", nodeType: "config", metadata: { generationMode: "image" as const, prompt, composerContent: prompt } });
const sources = (ops: ReturnType<typeof prepareZodiacToolProposal>["ops"]) => ops.flatMap((op) => (op.type === "connect_nodes" && op.toNodeId === "shot" ? [op.fromNodeId] : []));

test("stable asset mentions become actual edges with the character's written profile", () => {
    const proposal = prepareZodiacToolProposal([action("使用 @[node:portrait] 做分镜")], assets);
    assert.deepEqual(sources(proposal.ops).sort(), ["portrait", "profile"]);
    const shot = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    assert.equal(shot?.type, "add_node");
    if (shot?.type === "add_node") assert.match(shot.metadata?.composerContent || "", /@\[node:profile\]/);
});

test("group connections retain the reusable group rather than creating member edges", () => {
    const proposal = prepareZodiacToolProposal([action("保持角色设定"), { type: "connect_nodes", fromNodeId: "cast", toNodeId: "shot" }], assets);
    assert.deepEqual(sources(proposal.ops), ["cast"]);
});

test("group tokens retain their stable group identity and exclude unrelated assets", () => {
    const proposal = prepareZodiacToolProposal([action("参考 @[node:cast]")], assets);
    assert.deepEqual(sources(proposal.ops), ["cast"]);
    const shot = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    if (shot?.type === "add_node") {
        assert.equal(shot.metadata?.prompt, "参考 @[node:cast]");
        assert.doesNotMatch(shot.metadata?.prompt || "", /@\[node:portrait\]/);
    }
});

test("unknown and deleted references cannot produce an executable ungrounded proposal", () => {
    assert.deepEqual(prepareZodiacToolProposal([action("参考 @[node:missing]")], assets).ops, []);
    assert.deepEqual(prepareZodiacToolProposal([{ type: "delete_node", id: "portrait" }, action("参考 @[node:portrait]")], assets).ops, []);
});

// 实测（2026-09-22，作者的真实会话）：提案引用了快照里没有的组 id 时，整套 ops 被清空，
// 而模型只收到「没通过应用校验（正文、引用、结果槽或连线不完整）」——它无法判断是引用越界，
// 只能整段重写再撞同一个错，用户看到的是「没拿到 ops 字段」。被拒绝是对的（不能凭空引用），
// 但必须把原因说出来。
test("a rejected proposal explains which reference is out of bounds", () => {
    const orphan = prepareZodiacToolProposal([action("保持参考 @[node:group-not-in-snapshot] 的角色")], assets);
    assert.deepEqual(orphan.ops, []);
    assert.match(orphan.reason || "", /group-not-in-snapshot/u, "原因要点名越界的节点 id");
    assert.match(orphan.reason || "", /读取当前画布/u, "原因要说明下一步动作");

    assert.match(prepareZodiacToolProposal([{ type: "delete_node", id: "portrait" }, action("参考 @[node:portrait]")], assets).reason || "", /portrait/u);
    // 空组：组存在但里面没有成员，整体引用它同样无法执行。
    const emptyGroup = [...assets, { id: "empty-cast", type: "group" as const, title: "空组" }];
    assert.match(prepareZodiacToolProposal([action("参考 @[node:empty-cast]")], emptyGroup).reason || "", /组/u);
});

test("a work-order gap names the node that is not wired up", () => {
    const tool = prepareZodiacToolProposal([{ type: "add_node", id: "text", nodeType: "text", title: "剧本文本" }], assets);
    assert.ok(tool.ops.length, "只有文本节点、没有动作时提案本身仍然成立");
    assert.equal(tool.reason, undefined, "有效提案不携带原因");
});

test("asset binding is idempotent and existing explicit edges are not duplicated", () => {
    const original = [action("参考 @[node:portrait]"), { type: "connect_nodes" as const, fromNodeId: "portrait", toNodeId: "shot" }];
    const first = prepareZodiacToolProposal(original, assets);
    const second = prepareZodiacToolProposal(first.ops, assets);
    assert.deepEqual(second, first);
    assert.equal(sources(first.ops).filter((id) => id === "portrait").length, 1);
});

test("safe group membership survives provider normalization", () => {
    const normalized = normalizeZodiacCanvasOps([{ type: "add_node", id: "notes", nodeType: "text", metadata: { groupId: "cast", content: "设定" } }]);
    assert.equal(normalized[0]?.type === "add_node" && normalized[0].metadata?.groupId, "cast");
});

test("explicit character connections are selected even when the prompt mentions only a script", () => {
    const nodes = [...assets, { id: "script", type: "text", metadata: { content: "剧本" } }];
    const proposal = prepareZodiacToolProposal([action("按 @[node:script] 做分镜"), { type: "connect_nodes", fromNodeId: "portrait", toNodeId: "shot" }], nodes);
    const shot = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    assert.deepEqual(sources(proposal.ops).sort(), ["portrait", "profile", "script"]);
    if (shot?.type === "add_node") {
        assert.match(shot.metadata?.composerContent || "", /@\[node:portrait\]/);
        assert.match(shot.metadata?.composerContent || "", /@\[node:profile\]/);
    }
});

test("cross-action references bind to the produced data and schedule its unfinished owner", () => {
    const proposal = prepareZodiacToolProposal([{ type: "add_node", id: "story", nodeType: "config", metadata: { generationMode: "text", prompt: "写剧本" } }, action("按 @[node:story] 画分镜"), { type: "run_generation", nodeId: "shot" }]);
    const story = proposal.bindings.find((binding) => binding.actionId === "story")!;
    assert.deepEqual(sources(proposal.ops), [story.outputNodeId]);
    const shot = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    if (shot?.type === "add_node") assert.equal(shot.metadata?.composerContent, `按 @[node:${story.outputNodeId}] 画分镜`);
    assert.ok(proposal.ops.some((op) => op.type === "run_generation" && op.nodeId === "story"));
});

test("run prompt overrides survive later structural updates", () => {
    const proposal = prepareZodiacToolProposal(
        [action("最初提示"), { type: "run_generation", nodeId: "shot", prompt: "本次使用 @[node:unrelated]" }, { type: "update_node", id: "shot", metadata: { prompt: "保存配置 @[node:cast]", composerContent: "保存配置 @[node:cast]" } }],
        assets,
    );
    const run = proposal.ops.find((op) => op.type === "run_generation" && op.nodeId === "shot");
    assert.equal(run?.type === "run_generation" && run.prompt, "本次使用 @[node:unrelated]");
    assert.deepEqual(sources(proposal.ops), ["unrelated"]);
});

test("restoring a compatible older action binds its assets without creating a duplicate", () => {
    const old = action("参考 @[node:portrait]");
    const proposal = prepareZodiacToolProposal([old], [...assets, { id: "shot", type: "config", metadata: old.metadata }], [], true);
    assert.ok(proposal.ops.length);
    assert.ok(proposal.bindings.some((binding) => binding.actionId === "shot"));
    assert.equal(
        proposal.ops.some((op) => op.type === "add_node" && op.nodeType === "config"),
        false,
    );
    assert.deepEqual(sources(proposal.ops).sort(), ["portrait", "profile"]);
});

test("invalid memberships and group cycles are rejected while forward declarations work", () => {
    for (const groupId of ["missing", "portrait", "notes"]) {
        assert.deepEqual(prepareZodiacToolProposal([{ type: "add_node", id: "notes", nodeType: "text", metadata: { groupId } }], assets).ops, []);
    }
    assert.deepEqual(
        prepareZodiacToolProposal([
            { type: "add_node", id: "a", nodeType: "group", metadata: { groupId: "b" } },
            { type: "add_node", id: "b", nodeType: "group", metadata: { groupId: "a" } },
        ]).ops,
        [],
    );
    assert.ok(
        prepareZodiacToolProposal([
            { type: "add_node", id: "notes", nodeType: "text", metadata: { groupId: "cast" } },
            { type: "add_node", id: "cast", nodeType: "group" },
        ]).ops.length,
    );
});

test("retained group references are idempotent and do not delete existing group connections", () => {
    const existing = [...assets, { id: "shot", type: "config", metadata: { generationMode: "image" as const, prompt: "参考 @[node:cast]" } }];
    const connections = [{ id: "cast-shot", fromNodeId: "cast", toNodeId: "shot" }];
    const first = prepareZodiacToolProposal([{ type: "run_generation", nodeId: "shot" }], existing, connections);
    const second = prepareZodiacToolProposal(first.ops, existing, connections);
    assert.deepEqual(second, first);
    assert.equal(
        first.ops.some((op) => op.type === "delete_connections" && op.id === "cast-shot"),
        false,
    );
    assert.equal(
        sources(first.ops).some((id) => id === "portrait" || id === "profile"),
        false,
    );
});

test("an explicitly connected group remains selected alongside a script token", () => {
    const proposal = prepareZodiacToolProposal([action("按 @[node:unrelated] 绘制"), { type: "connect_nodes", fromNodeId: "cast", toNodeId: "shot" }], assets);
    assert.deepEqual(sources(proposal.ops).sort(), ["cast", "unrelated"]);
    const shot = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    if (shot?.type === "add_node") assert.match(shot.metadata?.composerContent || "", /@\[node:cast\]/);
});

test("individual nested image references retain ancestor character profiles", () => {
    const nested = [...assets, { id: "views", type: "group", metadata: { groupId: "cast" } }, { id: "side", type: "image", metadata: { groupId: "views", content: "side-view" } }];
    const proposal = prepareZodiacToolProposal([action("参考 @[node:side]")], nested);
    assert.deepEqual(sources(proposal.ops).sort(), ["profile", "side"]);
});

test("whole-group prompts preserve the group's curated member choice", () => {
    const nodes = assets.map((node) => (node.id === "cast" ? { ...node, metadata: { groupPrompt: "保持角色比例 @[node:portrait]" } } : node));
    const proposal = prepareZodiacToolProposal([action("参考 @[node:cast]")], nodes);
    assert.deepEqual(sources(proposal.ops), ["cast"]);
    assert.ok(proposal.ops.length);
    const invalid = nodes.map((node) => (node.id === "cast" ? { ...node, metadata: { groupPrompt: "@[node:unrelated]" } } : node));
    assert.deepEqual(prepareZodiacToolProposal([action("参考 @[node:cast]")], invalid).ops, []);
});

test("a connected group supplies member aliases without redundant leaf edges", () => {
    const nodes = [...assets, { id: "shot", type: "config", metadata: { generationMode: "image" as const, prompt: "参考 @[node:portrait]" } }];
    const proposal = prepareZodiacToolProposal([{ type: "run_generation", nodeId: "shot" }], nodes, [{ id: "group-edge", fromNodeId: "cast", toNodeId: "shot" }]);
    assert.deepEqual(sources(proposal.ops), []);
    const run = proposal.ops.find((op) => op.type === "run_generation" && op.nodeId === "shot");
    if (run?.type === "run_generation") assert.match(run.prompt || "", /@\[node:profile\]/);
});
