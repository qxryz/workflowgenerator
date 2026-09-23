import test from "node:test";
import assert from "node:assert/strict";
import { zodiacWorkspaceAssets, pinZodiacReference, zodiacVideoReferenceSettings, zodiacReferenceInstructions } from "../src/lib/agent/zodiac-assets.ts";
import { pinZodiacStageReferences } from "../src/lib/agent/zodiac-stage-execution.ts";
import type { CanvasNodeData } from "../src/types/canvas.ts";
import type { ZodiacStageDraft } from "../src/lib/agent/zodiac-stage-plan.ts";

const node = (id: string, type: string, metadata: object): CanvasNodeData => ({ id, type, title: id, position: { x: 0, y: 0 }, metadata }) as CanvasNodeData;

test("workspace handoff includes complete documents and exact media versions, excludes settings and pending outputs", () => {
    const nodes = [node("doc", "text", { content: "完整正文".repeat(10000) }), node("pic", "image", { storageKey: "image:key", currentResultVersionId: "v2", groupId: "person" }), node("config", "config", { apiKey: "SECRET" }), node("pending", "image", { storageKey: "image:old", role: "result-slot", slotState: "running" })];
    const assets = zodiacWorkspaceAssets(nodes, ["pic"]);
    assert.equal(assets.length, 2);
    assert.equal(assets[0].content?.length, 40000);
    assert.equal(assets[1].resultVersionId, "v2");
    assert.equal(assets[1].selected, true);
    assert.doesNotMatch(JSON.stringify(assets), /SECRET|image:old/);
});

test("identity and style references are not misclassified as first and last frames", () => {
    const nodes = [node("person", "image", { storageKey: "image:person" }), node("style", "image", { storageKey: "image:style" })];
    assert.deepEqual(zodiacVideoReferenceSettings("channel::MiniMax-H3", [{ nodeId: "person", role: "identity" }, { nodeId: "style", role: "style" }], nodes), { minimaxVideoInputMode: "reference" });
    assert.deepEqual(zodiacVideoReferenceSettings("MiniMax-H3", [{ nodeId: "person", role: "first_frame" }, { nodeId: "style", role: "last_frame" }], nodes), { minimaxVideoInputMode: "first-last" });
    assert.throws(() => zodiacVideoReferenceSettings("MiniMax-H3", [{ nodeId: "person", role: "last_frame" }, { nodeId: "style", role: "first_frame" }], nodes), /顺序/);
    assert.throws(() => zodiacVideoReferenceSettings("agnes-video-v2.0", [{ nodeId: "person", role: "identity" }], nodes), /不能.*当作首帧/);
    const prompt = zodiacReferenceInstructions([{ nodeId: "person", role: "identity" }, { nodeId: "style" }]);
    assert.match(prompt, /@\[node:person\]/);
    assert.match(prompt, /@\[node:style\]/);
});

test("review pins text and media references and rejects replacements while preserving semantic roles and order", async () => {
    const nodes = [node("doc", "text", { content: "已确认文案" }), node("person", "image", { storageKey: "image:person", currentResultVersionId: "v1" })];
    const stage: ZodiacStageDraft = { id: "stage", contract: { goal: "海报", workItems: [{ id: "poster", title: "海报", tool: "hub_generate_image", args: { prompt: "海报", references: [{ nodeId: "doc" }, { nodeId: "person", role: "identity" }] } }] } };
    const pinned = await pinZodiacStageReferences(stage, nodes);
    const refs = pinned.contract.workItems[0].args.references as any[];
    assert.equal(refs[0].contentHash.length, 64);
    assert.equal(refs[1].role, "identity");
    assert.equal(refs[1].resultVersionId, "v1");
    assert.equal((stage.contract.workItems[0].args.references as any[])[0].contentHash, undefined);
    nodes[0].metadata!.content = "修改后的文案";
    nodes[1].metadata!.currentResultVersionId = "v2";
    await assert.rejects(pinZodiacReference(refs[0], nodes), /文档已变化/);
    await assert.rejects(pinZodiacReference(refs[1], nodes), /媒体已变化/);
});
