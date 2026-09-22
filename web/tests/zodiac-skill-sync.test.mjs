import assert from "node:assert/strict";
import test from "node:test";
import { nativeTools } from "../src/services/api/zodic.ts";
import { runZodiacTurn } from "../src/services/api/zodiac-transport.ts";

test("native skill tool loads selected skill files on demand", () => {
    const tool = nativeTools().find((tool) => tool.name === "skill");
    assert.deepEqual(tool.parameters.required, ["name"]);
    assert.equal(tool.parameters.properties.path.type, "string");
});

test("runtime requires an explicit workflow scope", async () => {
    await assert.rejects(() => runZodiacTurn({ sessionId: "x", text: "hello" }), /请先打开工作流/u);
});
