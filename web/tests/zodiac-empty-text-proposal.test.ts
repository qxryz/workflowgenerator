import assert from "node:assert/strict";
import test from "node:test";
import { normalizeZodiacCanvasOps, prepareZodiacToolProposal } from "../src/lib/agent/zodiac-tool-proposal.ts";
import { composeZodiacSystemPrompt } from "../src/lib/agent/zodiac-harness.ts";

const resources = [
    { id: "cast", type: "image", metadata: { content: "data:image/png;base64,a" } },
    { id: "notes", type: "text", title: "剧本", metadata: { content: "" } },
];
const shot = (prompt: string) => ({ type: "add_node" as const, id: "shot", nodeType: "config", metadata: { generationMode: "image" as const, prompt } });

test("malformed add operations never fall back to empty text nodes", () => {
    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "add_node", id: "mystery" }]), []);
    assert.deepEqual(normalizeZodiacCanvasOps([{ type: "add_node", node: { id: "script", type: "text", content: "剧本" } }]), []);
});

test("explicit role selection does not silently append an unrelated script reference", () => {
    const proposal = prepareZodiacToolProposal([shot("保持 @[node:cast] 外观"), { type: "connect_nodes", fromNodeId: "notes", toNodeId: "shot" }], resources);
    assert.ok(proposal.ops.length);
    const action = proposal.ops.find((op) => op.type === "add_node" && op.id === "shot");
    assert.equal(action?.metadata?.prompt, "保持 @[node:cast] 外观");
    assert.doesNotMatch(action?.metadata?.composerContent || "", /node:notes/);
});

test("explicit script references and ordinary upstream wiring still work", () => {
    const known = resources.map((node) => (node.id === "notes" ? { ...node, metadata: { content: "写好的剧本" } } : node));
    const selected = prepareZodiacToolProposal([shot("根据 @[node:notes]，保持 @[node:cast] 外观")], known);
    assert.ok(selected.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "notes" && op.toNodeId === "shot"));
    const wired = prepareZodiacToolProposal([shot("画剧本中的场面"), { type: "connect_nodes", fromNodeId: "notes", toNodeId: "shot" }], known);
    assert.ok(wired.ops.some((op) => op.type === "connect_nodes" && op.fromNodeId === "notes"));
});

test("the provider contract distinguishes completed text from future text generation", () => {
    const contract = composeZodiacSystemPrompt();
    assert.match(contract, /metadata\.content/);
    assert.match(contract, /不要.*(?:重复|额外).*文本生成/);
});
