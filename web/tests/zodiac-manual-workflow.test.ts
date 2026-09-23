import test from "node:test";
import assert from "node:assert/strict";
import { prepareZodiacManualOps } from "../src/lib/agent/zodiac-manual-workflow.ts";
import { arkImageGenerationParameters, resolveSeedreamRequestSize } from "../src/lib/model-providers.ts";
import { updateZodiacActivity, zodiacActivityError } from "../src/lib/agent/zodiac-activity.ts";

test("legacy run proposals keep prompts and references but cannot start work or replace an existing model", () => {
    const ops = prepareZodiacManualOps([
        { type: "add_node", id: "draw", nodeType: "config", metadata: { generationMode: "image", model: "agent-choice" } },
        { type: "connect_nodes", fromNodeId: "source", toNodeId: "draw" },
        { type: "update_node", id: "existing", metadata: { model: "another-agent-choice", prompt: "new prompt" } },
        { type: "run_generation", nodeId: "draw", mode: "image", prompt: "Use @[node:source] as style" },
    ], { image: "user-choice" });
    assert.equal(ops.some(op => op.type === "run_generation"), false);
    assert.equal(ops[0].type === "add_node" && ops[0].metadata?.model, "user-choice");
    assert.equal(ops[2].type === "update_node" && ops[2].metadata?.model, undefined);
    assert.deepEqual(ops[1], { type: "connect_nodes", fromNodeId: "source", toNodeId: "draw" });
    assert.equal(ops.at(-1)?.type === "update_node" && (ops.at(-1) as any).metadata.prompt, "Use @[node:source] as style");
});

test("Seedream validates actual pixels without rejecting valid non-square dimensions", () => {
    for (const model of ["doubao-seedream-4-5-251128", "doubao-seedream-5-0-lite-260128"]) {
        assert.throws(() => arkImageGenerationParameters(model, "1024x1024", 1, false, false), /3686400/);
        assert.throws(() => arkImageGenerationParameters(model, "1K", 1, false, false), /不支持 1K/);
        assert.equal(arkImageGenerationParameters(model, "3750x1250", 1, false, false).size, "3750x1250");
    }
});

test("polling completed activities keeps their timestamp stable and errors omit protocol wrappers", () => {
    const event = { id: "a", kind: "tool" as const, status: "done" as const, label: "读取素材", at: 1000 };
    const items = updateZodiacActivity([], event);
    assert.equal(updateZodiacActivity(items, { ...event, at: 9999 }), items);
    assert.equal(zodiacActivityError('{"ok":false,"error":"尺寸无效 Request id: secret-trace"}'), "尺寸无效");
});


test("Seedream aspect ratios resolve to supported pixels and explicit sizes stay explicit", () => {
    const model = "doubao-seedream-5-0-lite-260128";
    for (const ratio of ["1:1", "16:9", "9:16", "21:9"]) {
        const size = resolveSeedreamRequestSize(model, undefined, ratio)!;
        const [w, h] = size.split("x").map(Number);
        assert.ok(w * h >= 3686400 && w * h <= 16777216);
    }
    assert.equal(resolveSeedreamRequestSize(model, "high", "3750x1250"), "3750x1250");
    assert.throws(() => resolveSeedreamRequestSize(model, undefined, "1024x1024"), /3686400/);
});
