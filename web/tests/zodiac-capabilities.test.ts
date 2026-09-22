import test from "node:test";
import assert from "node:assert/strict";
import { buildZodiacCapabilities } from "../src/lib/agent/zodiac-capabilities.ts";
import { readZodiacWorkflow } from "../src/lib/agent/zodiac-workflows.ts";
import type { AiConfig } from "../src/stores/use-config-store.ts";

test("capability projection excludes credentials, endpoints and disabled capabilities", () => {
    const config = { channels: [{ id: "c", name: "private", apiKey: "SECRET", baseUrl: "https://private.invalid", capabilities: { video: false }, models: [{ name: "image", capability: "image", script: "private script" }, { name: "video", capability: "video" }] }] } as unknown as AiConfig;
    const result = buildZodiacCapabilities(config);
    assert.deepEqual(result.models, [{ id: "c::image", name: "image", capability: "image", configured: true }]);
    assert.doesNotMatch(JSON.stringify(result), /SECRET|private|script/);
});

test("workflow lookup uses explicit catalog ids and does not accept local paths", () => {
    assert.equal("workflows" in readZodiacWorkflow({}), true);
    assert.equal("contract" in readZodiacWorkflow({ id: "ad-tvc" }), true);
    assert.throws(() => readZodiacWorkflow({ id: "../../private" }), /工作流不存在/);
    assert.throws(() => readZodiacWorkflow({ id: 1 }), /必须是工作流/);
});
