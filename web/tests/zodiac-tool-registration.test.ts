import test from "node:test";
import assert from "node:assert/strict";
import { registeredZodiacTools } from "../src/services/api/opencode-runtime.ts";

test("MCP registration preserves native task and prevents skill tools replacing application contracts", () => {
    const tool = (name: string, description: string) => ({ name, description, parameters: { type: "object" } });
    const tools = registeredZodiacTools(
        [tool("task", "legacy"), tool("hub_plan_get", "application")],
        [tool("task", "skill"), tool("hub_plan_get", "override"), tool("skill_extra", "extra")],
    );
    assert.equal(tools.some(t => t.name === "task"), false);
    assert.equal(tools.filter(t => t.name === "hub_plan_get").length, 1);
    assert.equal(tools.find(t => t.name === "hub_plan_get")?.description, "application");
    assert.equal(tools.some(t => t.name === "hub_import_file"), true);
    assert.equal(tools.some(t => t.name === "skill_extra"), true);
});
