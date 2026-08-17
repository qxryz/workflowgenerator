import assert from "node:assert/strict";
import test from "node:test";

import { runZodiacProposalGeneration } from "../src/lib/agent/zodiac-execution-mode.ts";
import { resolveZodiacExecutionMode } from "../src/lib/agent/zodiac-tool-proposal.ts";

test("Zodiac defaults to guided and only accepts automatic mode from explicit user intent", () => {
    assert.equal(resolveZodiacExecutionMode("帮我搭一个商品图工作流"), "guided");
    assert.equal(resolveZodiacExecutionMode("帮我搭一个商品图工作流", "automatic"), "guided");
    assert.equal(resolveZodiacExecutionMode("全自动跑完这个工作流"), "automatic");
    assert.equal(resolveZodiacExecutionMode("直接跑到底，无需确认", "guided"), "automatic");
    assert.equal(resolveZodiacExecutionMode("跑完整条流程，不需要我确认"), "automatic");
    assert.equal(resolveZodiacExecutionMode("不要全自动，每一步确认"), "guided");
});

test("the Zodiac bridge runner forwards execution mode and preserves failed run semantics", async () => {
    const calls: Array<{ nodeIds: string[] | undefined; mode: string }> = [];
    const completed = await runZodiacProposalGeneration(
        async (nodeIds, mode) => {
            calls.push({ nodeIds, mode });
            return { runId: "run-automatic", mode, status: "completed", nodes: [] };
        },
        ["write", "render"],
        "automatic",
    );

    assert.equal(completed?.mode, "automatic");
    assert.deepEqual(calls, [{ nodeIds: ["write", "render"], mode: "automatic" }]);

    await assert.rejects(
        () => runZodiacProposalGeneration(
            async (nodeIds, mode) => ({
                runId: "run-failed",
                mode,
                status: "error",
                nodes: [{ nodeId: nodeIds?.[0] || "write", status: "error", attempt: 1, artifacts: [], error: { message: "生成未完成" } }],
            }),
            ["write"],
            "guided",
        ),
        /生成未完成/,
    );

    await assert.rejects(
        () => runZodiacProposalGeneration(
            async (nodeIds, mode) => ({
                runId: "run-stopped",
                mode,
                status: "stopped",
                nodes: [{ nodeId: nodeIds?.[0] || "write", status: "stopped", attempt: 1, artifacts: [] }],
            }),
            ["write"],
            "guided",
        ),
        /运行已停止/,
    );
});
