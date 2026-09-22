// Hub 工具执行体单测：生成类走画布链路、读取类读快照、失败必须给出中文原因（不许静默降级）。
import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { build } from "esbuild";
const bundle = await build({ entryPoints: [path.resolve("src/lib/canvas/canvas-agent-ops.ts")], bundle: true, write: false, platform: "node", format: "esm", alias: { "@": path.resolve("src") } });
const { applyCanvasAgentOps } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`);
const { canvasTextHash } = await import("../src/lib/canvas/canvas-text-tools.ts");

const { HUB_TOOL_EXECUTION_NAMES, executeHubTool } = await import("../src/lib/agent/zodiac-hub-tools.ts");

/** 造一份最小画布快照：一个已就绪的图片节点 + 一个未就绪的结果槽。 */
function snapshot() {
    return {
        projectId: "p1",
        title: "测试画布",
        nodes: [
            { id: "poster-1", type: "image", title: "海报", position: { x: 0, y: 0 }, width: 320, height: 320, metadata: { status: "success", storageKey: "media/poster.png" } },
            { id: "text-1", type: "text", title: "剧本", position: { x: 0, y: 400 }, width: 320, height: 200, metadata: { status: "success", content: "0–5 秒：开场" } },
            { id: "pending-1", type: "image", title: "还没生成", position: { x: 0, y: 800 }, width: 320, height: 320, metadata: { status: "loading", role: "result-slot", slotState: "waiting" } },
        ],
        connections: [{ id: "c1", fromNodeId: "text-1", toNodeId: "poster-1" }],
        selectedNodeIds: [],
        viewport: { x: 0, y: 0, k: 1 },
    };
}

/** 默认上下文：记录 applyOps / runWorkflow 的调用，并按注入的产物状态回填结果槽。 */
function context(overrides = {}) {
    const calls = { applied: [], ran: [] };
    const state = { snapshot: snapshot() };
    const base = {
        calls,
        sessionId: "session-1",
        turnId: "turn-1",
        resolveMediaUrl: async (node) => `/media/media/${encodeURIComponent(node.metadata.storageKey)}`,
        getSnapshot: () => state.snapshot,
        applyOps: async (ops) => {
            calls.applied.push(ops);
            state.snapshot = applyCanvasAgentOps(state.snapshot, ops);
            return state.snapshot;
        },
        runWorkflow: async (startNodeIds) => {
            calls.ran.push(startNodeIds);
            // 动作节点 id 形如 "<mode>-action-xxx"，其结果槽是同一批 ops 里紧跟的那个节点。
            const actionId = startNodeIds?.[0];
            const action = state.snapshot.nodes.find((node) => node.id === actionId);
            const slotId = state.snapshot.connections.find((edge) => edge.fromNodeId === actionId)?.toNodeId;
            const slot = state.snapshot.nodes.find((node) => node.id === slotId && node.type === action?.metadata?.generationMode);
            if (slot) slot.metadata = { ...slot.metadata, status: "success", storageKey: "media/out-1.png" };
            return { status: "completed", nodes: [] };
        },
        saveSessionFile: async ({ path, content, storageKey }) => ({ path, bytes: content ? content.length : storageKey.length }),
        analyseImage: async () => "一张竖版海报，主体居中，标题在上方。",
        readImageDataUrl: async (nodeId) => (nodeId === "poster-1" ? "data:image/png;base64,AAAA" : null),
    };
    return Object.assign(base, overrides, { calls: { ...calls, ...(overrides.calls || {}) } });
}

test("导出的执行集保留技能工具契约，未接入能力须明确失败", () => {
    assert.deepEqual(HUB_TOOL_EXECUTION_NAMES, [
        "hub_generate_image",
        "hub_generate_video",
        "hub_generate_audio",
        "hub_generate_music",
        "hub_video_edit",
        "hub_analyse_media",
        "hub_read",
        "hub_canvas_get_node",
        "hub_canvas_list_nodes",
        "hub_canvas_grep_text",
        "hub_canvas_read_text",
        "hub_canvas_write_node",
        "hub_canvas_apply_text_edits",
        "hub_canvas_group_nodes",
        "hub_canvas_group_recent_outputs",
        "hub_canvas_ungroup_node",
        "hub_save_file_to_session",
    ]);
});

test("hub_generate_video：建动作节点 + 同类型结果槽 + 连线，然后交给运行器，回报产物位置", async () => {
    const ctx = context();
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_video", args: { prompt: "一镜到底的动态海报", references: [{ nodeId: "poster-1" }] } }, ctx);
    assert.equal(outcome.ok, true, JSON.stringify(outcome));
    const ops = ctx.calls.applied[0];
    assert.equal(ops.length, 4);
    assert.equal(ops[0].nodeType, "config");
    assert.equal(ops[0].metadata.generationMode, "video");
    assert.equal(ops[0].metadata.prompt, "一镜到底的动态海报");
    assert.equal(ops[0].metadata.references, undefined);
    assert.deepEqual(ops[3], { type: "connect_nodes", fromNodeId: "poster-1", toNodeId: ops[0].id });
    // 结果槽的 nodeType 必须直接是产物类型，不能写成 config。
    assert.equal(ops[1].nodeType, "video");
    assert.equal(ops[2].type, "connect_nodes");
    assert.equal(ops[2].fromNodeId, ops[0].id);
    assert.equal(ops[2].toNodeId, ops[1].id);
    assert.equal(ctx.calls.ran.length, 1);
    assert.equal(outcome.result.nodeId, ops[1].id);
    assert.equal(outcome.result.storageKey, "media/out-1.png");
    assert.equal(outcome.result.url, "/media/media/media%2Fout-1.png");
});

test("生成类：参考素材必须在画布上，且必须是已就绪的资源节点", async () => {
    const missing = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x", references: [{ nodeId: "不存在" }] } }, context());
    assert.equal(missing.ok, false);
    assert.match(missing.error, /不在当前画布上/);

    const notReady = await executeHubTool({ callId: "c2", name: "hub_generate_image", args: { prompt: "x", references: [{ nodeId: "pending-1" }] } }, context());
    assert.equal(notReady.ok, false);
    assert.match(notReady.error, /还不能作为生成输入/);
});

test("生成类：缺 prompt 直接失败，不去调运行器", async () => {
    const ctx = context();
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: {} }, ctx);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /缺少 prompt/);
    assert.equal(ctx.calls.applied.length, 0);
    assert.equal(ctx.calls.ran.length, 0);
});

test("生成类：运行器报错时把供应商原因带回来，不谎报成功", async () => {
    const ctx = context({ runWorkflow: async () => ({ status: "error", nodes: [{ nodeId: "a", status: "error", error: { message: "模型不存在" } }] }) });
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x" } }, ctx);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /模型不存在/);
});

for (const [name, args] of [
    ["hub_video_edit", { prompt: "延长 2 秒", video: { nodeId: "poster-1" } }],
    ["hub_generate_music", { prompt: "钢琴配乐", lyrics: "歌词" }],
]) {
    test(`${name}：未接入能力明确失败，不产生付费生成或画布修改`, async () => {
        const ctx = context();
        const outcome = await executeHubTool({ callId: "c1", name, args }, ctx);
        assert.equal(outcome.ok, false);
        assert.match(outcome.error, /尚未接入/);
        assert.equal(ctx.calls.applied.length, 0);
        assert.equal(ctx.calls.ran.length, 0);
    });
}

test("生成类：运行器结束但结果未保存时不能报告成功", async () => {
    const ctx = context({ runWorkflow: async () => ({ status: "completed", nodes: [] }) });
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x" } }, ctx);
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /已保存的产物/);
});

test("生成类：请求已取消时不修改画布或开始生成", async () => {
    const controller = new AbortController();
    controller.abort();
    const ctx = context({ signal: controller.signal });
    await assert.rejects(executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x" } }, ctx), { name: "AbortError" });
    assert.equal(ctx.calls.applied.length, 0);
    assert.equal(ctx.calls.ran.length, 0);
});

test("生成类：节点提交期间取消，不能继续启动供应商请求", async () => {
    const controller = new AbortController();
    const ctx = context({
        signal: controller.signal,
        applyOps: async () => {
            controller.abort();
            return snapshot();
        },
    });
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x" } }, ctx);
    assert.equal(outcome.ok, false);
    assert.equal(ctx.calls.ran.length, 0);
});

test("生成类：运行中的取消信号传到实际运行器并不谎报成功", async () => {
    const controller = new AbortController();
    let observedAbort = false;
    const ctx = context({
        signal: controller.signal,
        runWorkflow: async (_ids, _mode, signal) => {
            assert.equal(signal, controller.signal);
            const result = new Promise((resolve) =>
                signal.addEventListener(
                    "abort",
                    () => {
                        observedAbort = true;
                        resolve({ status: "stopped", nodes: [] });
                    },
                    { once: true },
                ),
            );
            controller.abort();
            return result;
        },
    });
    const outcome = await executeHubTool({ callId: "c1", name: "hub_generate_image", args: { prompt: "x" } }, ctx);
    assert.equal(observedAbort, true);
    assert.equal(outcome.ok, false);
});

test("hub_read / hub_canvas_get_node：读快照，缺节点报中文原因", async () => {
    const read = await executeHubTool({ callId: "c1", name: "hub_read", args: { nodeId: "text-1" } }, context());
    assert.equal(read.ok, true);
    assert.equal(read.result.content, "0–5 秒：开场");
    // 快照里 text-1 → poster-1 有连线，下游必须原样带出（不能被解释反）。
    assert.deepEqual(read.result.downstream, ["poster-1"]);

    const miss = await executeHubTool({ callId: "c2", name: "hub_canvas_get_node", args: { nodeId: "nope" } }, context());
    assert.equal(miss.ok, false);
    assert.match(miss.error, /没有节点 nope/);
});

test("hub_canvas_group_recent_outputs：无本轮产物不误分历史节点", async () => {
    const ctx = context();
    const outcome = await executeHubTool({ callId: "c1", name: "hub_canvas_group_recent_outputs", args: {} }, ctx);
    assert.equal(outcome.result.groupId, null);
    assert.equal(outcome.result.reason, "insufficient-candidates");
    assert.equal(ctx.calls.applied.length, 0);
});

test("hub_analyse_media：读不到画面时明确失败，绝不假装看过", async () => {
    const ok = await executeHubTool({ callId: "c1", name: "hub_analyse_media", args: { asset: { nodeId: "poster-1" } } }, context());
    assert.equal(ok.ok, true);
    assert.match(ok.result.description, /竖版海报/);

    const failed = await executeHubTool({ callId: "c2", name: "hub_analyse_media", args: { asset: { nodeId: "pending-1" } } }, context());
    assert.equal(failed.ok, false);
    assert.match(failed.error, /读不到节点 pending-1/);
});

test("hub_save_file_to_session：文本与产物两条路，使用会话相对路径", async () => {
    const text = await executeHubTool({ callId: "c1", name: "hub_save_file_to_session", args: { path: "storyboard/shot-01.md", content: "# 分镜一" } }, context());
    assert.equal(text.ok, true);
    assert.equal(text.result.path, "storyboard/shot-01.md");

    const asset = await executeHubTool({ callId: "c2", name: "hub_save_file_to_session", args: { path: "refs/poster.png", asset: { nodeId: "poster-1" } } }, context());
    assert.equal(asset.ok, true);

    const neither = await executeHubTool({ callId: "c3", name: "hub_save_file_to_session", args: { path: "a.md" } }, context());
    assert.equal(neither.ok, false);
    assert.match(neither.error, /需要 content/);

    const noArtifact = await executeHubTool({ callId: "c4", name: "hub_save_file_to_session", args: { path: "a.png", asset: { nodeId: "pending-1" } } }, context());
    assert.equal(noArtifact.ok, false);
    assert.match(noArtifact.error, /还没有产物可以落盘/);
});

test("未知工具：明确报不支持，不静默成功", async () => {
    const outcome = await executeHubTool({ callId: "c1", name: "hub_browser", args: {} }, context());
    assert.equal(outcome.ok, false);
    assert.match(outcome.error, /还不支持的工具/);
});

const call = (ctx, name, args, callId = `${name}-request`) => executeHubTool({ callId, name, args }, ctx);

test("文档真实保存全文并返回hash；operationId重试不新增节点", async () => {
    const ctx = context();
    const args = { content: "# 分镜\n第一幕正文\n", name: "分镜", operationId: "stage-1:item-1" };
    const first = await call(ctx, "hub_canvas_write_node", args);
    const second = await call(ctx, "hub_canvas_write_node", args, "retry-call");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(second.result.nodeId, first.result.nodeId);
    assert.equal(first.result.contentHash, await canvasTextHash(args.content));
    const node = ctx.getSnapshot().nodes.find((node) => node.id === first.result.nodeId);
    assert.equal(node.metadata.content, args.content);
    assert.equal(node.metadata.agentSessionId, ctx.sessionId);
    assert.equal(node.metadata.agentTurnId, ctx.turnId);
    assert.equal(ctx.calls.applied.length, 1);
    const reused = await call(ctx, "hub_canvas_write_node", { ...args, content: "不同正文" });
    assert.equal(reused.ok, false);
    assert.equal(node.metadata.content, args.content);
});

test("旧hash、重复锚点、重叠范围全部拒绝且不写入", async () => {
    const ctx = context();
    const node = ctx.getSnapshot().nodes.find((node) => node.id === "text-1");
    node.metadata.content = "hello hello end";
    const hash = await canvasTextHash(node.metadata.content);
    for (const args of [
        { expectedContentHash: "stale", edits: [{ exact: "hello", replacement: "new", occurrence: 0 }] },
        { expectedContentHash: hash, edits: [{ exact: "hello", replacement: "new" }] },
        {
            expectedContentHash: hash,
            edits: [
                { exact: "hello hello", replacement: "new" },
                { exact: "hello", occurrence: 1, replacement: "also" },
            ],
        },
    ])
        assert.equal((await call(ctx, "hub_canvas_apply_text_edits", { nodeId: node.id, ...args })).ok, false);
    assert.equal(node.metadata.content, "hello hello end");
    assert.equal(ctx.calls.applied.length, 0);
    const success = await call(ctx, "hub_canvas_apply_text_edits", { nodeId: node.id, expectedContentHash: hash, edits: [{ exact: "hello", replacement: "new", occurrence: 1 }] });
    assert.equal(success.ok, true, JSON.stringify(success));
    assert.equal(ctx.getSnapshot().nodes.find((n) => n.id === node.id).metadata.content, "hello new end");
});

test("真实apply层拒绝hash计算后发生的用户编辑且整批无副作用", async () => {
    const ctx = context();
    const originalApply = ctx.applyOps;
    const hash = await canvasTextHash("0–5 秒：开场");
    ctx.applyOps = async (ops) => {
        ctx.getSnapshot().nodes.find((node) => node.id === "text-1").metadata.content = "用户新正文";
        return originalApply(ops);
    };
    const result = await call(ctx, "hub_canvas_write_node", { nodeId: "text-1", content: "Agent 覆盖", expectedContentHash: hash });
    assert.equal(result.ok, false);
    assert.match(result.error, /版本冲突/);
    assert.equal(ctx.getSnapshot().nodes.find((node) => node.id === "text-1").metadata.content, "用户新正文");
    const before = ctx.getSnapshot();
    assert.throws(
        () =>
            applyCanvasAgentOps(before, [
                { type: "add_node", id: "must-not-commit", nodeType: "text" },
                { type: "update_node", id: "text-1", expectedContent: "old", metadata: { content: "new" } },
            ]),
        /版本冲突/,
    );
    assert.equal(
        before.nodes.some((node) => node.id === "must-not-commit"),
        false,
    );
});

test("节点分页和文本窗口返回版本与明确长度上限", async () => {
    const ctx = context();
    const page1 = await call(ctx, "hub_canvas_list_nodes", { limit: 2 });
    const page2 = await call(ctx, "hub_canvas_list_nodes", { limit: 2, cursor: page1.result.nextCursor });
    assert.equal(page1.result.nodes.length, 2);
    assert.equal(page2.result.nodes.length, 1);
    assert.equal(page2.result.nextCursor, null);
    const node = ctx.getSnapshot().nodes.find((node) => node.id === "text-1");
    node.metadata.content = "# 标题\nhello hello\n" + "x".repeat(20000);
    const grep = await call(ctx, "hub_canvas_grep_text", { nodeId: node.id, query: "hello" });
    assert.deepEqual(
        grep.result.matches.map((match) => match.occurrence),
        [0, 1],
    );
    assert.equal(grep.result.contentHash, await canvasTextHash(node.metadata.content));
    const read = await call(ctx, "hub_canvas_read_text", { nodeId: node.id, offsetLine: 2, limitLines: 2 });
    assert.ok(read.result.text.length <= 12000);
    assert.equal(read.result.truncated, true);
    assert.equal(read.result.nextLine, null);
    const summary = await call(ctx, "hub_canvas_get_node", { nodeId: node.id });
    assert.equal(summary.result.content, null);
    assert.ok(summary.result.preview.length <= 600);
});

test("本轮产物分组只包含同session/turn；解组保留子节点和连线", async () => {
    const ctx = context();
    const first = await call(ctx, "hub_canvas_write_node", { content: "文档 A", operationId: "a" });
    const second = await call(ctx, "hub_canvas_write_node", { content: "文档 B", operationId: "b" });
    const excluded = await call(ctx, "hub_canvas_write_node", { content: "另一会话", operationId: "excluded" });
    ctx.getSnapshot().nodes.find((node) => node.id === excluded.result.nodeId).metadata.agentSessionId = "other-session";
    const grouped = await call(ctx, "hub_canvas_group_recent_outputs", { label: "本轮" });
    assert.equal(grouped.ok, true, JSON.stringify(grouped));
    assert.deepEqual(grouped.result.nodeIds.sort(), [first.result.nodeId, second.result.nodeId].sort());
    assert.equal(ctx.getSnapshot().nodes.find((node) => node.id === "poster-1").metadata.groupId, undefined);
    const beforeCount = ctx.getSnapshot().nodes.length;
    const ungrouped = await call(ctx, "hub_canvas_ungroup_node", { nodeId: grouped.result.groupId });
    assert.equal(ungrouped.ok, true);
    assert.equal(ctx.getSnapshot().nodes.length, beforeCount - 1);
    assert.equal(ctx.getSnapshot().nodes.find((node) => node.id === first.result.nodeId).metadata.content, "文档 A");
    assert.equal(ctx.getSnapshot().connections.length, 1);
});

test("合并分组先转移成员，不会级联删除孩子", async () => {
    const ctx = context();
    const a = await call(ctx, "hub_canvas_write_node", { content: "A", operationId: "a" });
    const b = await call(ctx, "hub_canvas_write_node", { content: "B", operationId: "b" });
    const g1 = await call(ctx, "hub_canvas_group_nodes", { nodeIds: [a.result.nodeId, b.result.nodeId] }, "group1");
    const g2 = await call(ctx, "hub_canvas_group_nodes", { nodeIds: ["text-1", "poster-1"] }, "group2");
    const merged = await call(ctx, "hub_canvas_group_nodes", { nodeIds: [g1.result.groupId, g2.result.groupId] }, "merge");
    assert.equal(merged.ok, true, JSON.stringify(merged));
    assert.equal(merged.result.groupedCount, 4);
    assert.ok(ctx.getSnapshot().nodes.find((node) => node.id === "text-1"));
    assert.equal(
        ctx.getSnapshot().nodes.some((node) => node.id === g2.result.groupId),
        false,
    );
});

test("格式错误引用不能被静默忽略后继续付费生成", async () => {
    const ctx = context();
    for (const references of [[{ label: "missing-id" }], "poster-1", [null], [{ nodeId: "poster-1" }, {}]]) {
        const result = await call(ctx, "hub_generate_image", { prompt: "x", references });
        assert.equal(result.ok, false);
    }
    assert.equal(ctx.calls.ran.length, 0);
    assert.equal(ctx.calls.applied.length, 0);
});

test("稳定operationId重复和同时生成仅运行一次；相同ID不同参数拒绝", async () => {
    const ctx = context();
    const args = { prompt: "x", operationId: "stage1:image1" };
    const [first, concurrent] = await Promise.all([call(ctx, "hub_generate_image", args, "first"), call(ctx, "hub_generate_image", args, "concurrent")]);
    const retry = await call(ctx, "hub_generate_image", args, "later-retry");
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(concurrent.result.nodeId, first.result.nodeId);
    assert.equal(retry.result.nodeId, first.result.nodeId);
    assert.equal(ctx.calls.ran.length, 1);
    const conflict = await call(ctx, "hub_generate_image", { ...args, prompt: "changed" });
    assert.equal(conflict.ok, false);
    assert.equal(ctx.calls.ran.length, 1);
});

test("已审批参数完整保存到动作节点，不丢空值", async () => {
    const ctx = context();
    const result = await call(ctx, "hub_generate_image", { prompt: "approved", quality: "high", background: "", imageWatermark: "false", imageOptimizePrompt: "false", imagePromptPrefix: "", operationId: "approved-params" });
    assert.equal(result.ok, true, JSON.stringify(result));
    const metadata = ctx.getSnapshot().nodes.find((node) => node.id === result.result.actionNodeId).metadata;
    assert.equal(metadata.quality, "high");
    assert.equal(metadata.background, "");
    assert.equal(metadata.imageWatermark, "false");
    assert.equal(metadata.imageOptimizePrompt, "false");
    assert.equal(metadata.imagePromptPrefix, "");
});

test("源连线未提交时拒绝开始生成", async () => {
    const ctx = context();
    const originalApply = ctx.applyOps;
    ctx.applyOps = (ops) => originalApply(ops.filter((op) => !(op.type === "connect_nodes" && op.fromNodeId === "poster-1")));
    const result = await call(ctx, "hub_generate_image", { prompt: "x", references: [{ nodeId: "poster-1" }] });
    assert.equal(result.ok, false);
    assert.match(result.error, /参考素材连线/);
    assert.equal(ctx.calls.ran.length, 0);
});

test("正文局部编辑和分组的稳定操作可以安全重试", async () => {
    const ctx = context();
    const args = { nodeId: "text-1", expectedContentHash: await canvasTextHash("0–5 秒：开场"), edits: [{ exact: "开场", replacement: "结束" }], operationId: "edit-once" };
    const first = await call(ctx, "hub_canvas_apply_text_edits", args);
    const retry = await call(ctx, "hub_canvas_apply_text_edits", args, "retry");
    assert.equal(first.ok, true);
    assert.equal(retry.result.contentHash, first.result.contentHash);
    const groupArgs = { nodeIds: ["text-1", "poster-1"], operationId: "group-once" };
    const group = await call(ctx, "hub_canvas_group_nodes", groupArgs);
    const groupRetry = await call(ctx, "hub_canvas_group_nodes", groupArgs, "retry-group");
    assert.equal(groupRetry.result.groupId, group.result.groupId);
    assert.equal(groupRetry.result.groupedCount, 2);
});

test("提交后异常、停止、运行器error或无落盘产物都要求核对", async () => {
    for (const runWorkflow of [
        async () => {
            throw new Error("connection lost");
        },
        async () => ({ status: "stopped", nodes: [] }),
        async () => ({ status: "completed", nodes: [] }),
    ]) {
        const result = await call(context({ runWorkflow }), "hub_generate_image", { prompt: "x" });
        assert.equal(result.ok, false);
        assert.equal(result.requiresReconciliation, true);
        assert.ok(result.nodeId);
        assert.ok(result.actionNodeId);
    }
    const runnerError = await call(context({ runWorkflow: async () => ({ status: "error", nodes: [{ status: "error", error: { message: "provider rejected request" } }] }) }), "hub_generate_image", { prompt: "x" });
    assert.equal(runnerError.ok, false);
    assert.equal(runnerError.requiresReconciliation, true);
});

test("生成完成但flush失败被运行器包装成error时仍要求核对，不标可重试失败", async () => {
    const ctx = context();
    const originalRun = ctx.runWorkflow;
    ctx.runWorkflow = async (ids) => {
        await originalRun(ids);
        return { status: "error", nodes: [{ nodeId: ids[0], status: "error", error: { message: "保存生成记录失败：连接中断" } }] };
    };
    const outcome = await call(ctx, "hub_generate_image", { prompt: "x", operationId: "flush-error" });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.requiresReconciliation, true);
    assert.match(outcome.error, /保存生成记录失败/);
    assert.equal(ctx.getSnapshot().nodes.find((node) => node.id === outcome.nodeId).metadata.storageKey, "media/out-1.png");
    assert.equal(ctx.calls.ran.length, 1);
});

test("预览URL查询失败保留真实已保存产物回执且重试不再生成", async () => {
    const ctx = context({
        resolveMediaUrl: async () => {
            throw new Error("preview unavailable");
        },
    });
    const args = { prompt: "x", operationId: "durable-without-preview" };
    const first = await call(ctx, "hub_generate_image", args);
    const retry = await call(ctx, "hub_generate_image", args);
    assert.equal(first.ok, true, JSON.stringify(first));
    assert.equal(first.result.url, null);
    assert.equal(first.result.storageKey, "media/out-1.png");
    assert.equal(retry.result.nodeId, first.result.nodeId);
    assert.equal(ctx.calls.ran.length, 1);
});
