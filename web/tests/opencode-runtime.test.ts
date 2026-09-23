import assert from "node:assert/strict";
import test from "node:test";
import { runZodiacTurn } from "../src/services/api/zodiac-transport.ts";

const completed = { sessionId: "ses_native", messages: [{ info: { id: "m1", role: "assistant", time: { completed: 1 } }, parts: [{ id: "p1", type: "text", text: "已完成" }] }], permissions: [], tools: [], children: [], status: null };
test("native runtime forwards full skills, scopes work, requires actual approval, and returns tool outcomes", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    const requests: { path: string; body: any }[] = [];
    let reads = 0;
    globalThis.fetch = async (url, init) => {
        const path = String(url);
        const body = JSON.parse(String(init?.body));
        requests.push({ path, body });
        if (path.endsWith("/events")) return new Response("");
        if (path.endsWith("/start")) return Response.json({ sessionId: "ses_native" });
        if (path.endsWith("/state"))
            return Response.json(
                reads++
                    ? completed
                    : {
                          ...completed,
                          messages: [],
                          status: { type: "busy" },
                          permissions: [{ id: "per_1", permission: "bash", patterns: ["python3 scripts/a.py"], metadata: { command: "python3 scripts/a.py" } }],
                          tools: [{ callId: "tool_1", name: "hub_canvas_write_node", args: { content: "42" }, context: { role: "orchestrator", taskId: "ses_native", rootSessionId: "session-a", turnId: "turn-a", nativeCallId: "call_1" } }],
                      },
            );
        return Response.json({ ok: true });
    };
    const skills = [{ id: "sample", body: "Skill body", files: [{ path: "scripts/a.py", content: "print(42)" }] }];
    const text = await runZodiacTurn({
        projectId: "project-a",
        sessionId: "session-a",
        turnId: "turn-a",
        text: "run",
        skills,
        onPermissionRequest: async (request) => {
            assert.equal(request.name, "执行命令");
            return false;
        },
        onToolRequest: async (request, actor) => {
            assert.equal(actor.source.kind, "opencode");
            assert.equal(request.args && (request.args as any).content, "42");
            return { ok: true, result: { nodeId: "saved-node" } };
        },
    });
    assert.equal(text, "已完成");
    assert.deepEqual(requests.find((r) => r.path.endsWith("/start"))!.body.skills, skills);
    assert.equal(requests.find((r) => r.path.endsWith("/permission"))!.body.result, false);
    assert.equal(requests.find((r) => r.path.endsWith("/tool-result"))!.body.result.result.nodeId, "saved-node");
    assert.ok(requests.every((r) => r.body.projectId === "project-a" && r.body.sessionId === "session-a"));
    assert.ok(requests.every((r) => !r.path.includes("/api/model/")));
});

test("stopping a native turn requests backend cancellation; there is no direct-model fallback", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    const controller = new AbortController();
    const paths: string[] = [];
    globalThis.fetch = async (url) => {
        const path = String(url);
        paths.push(path);
        if (path.endsWith("/start")) return Response.json({ sessionId: "ses_native" });
        if (path.endsWith("/events")) return new Response("");
        if (path.endsWith("/state")) {
            controller.abort();
            throw new DOMException("Aborted", "AbortError");
        }
        return Response.json({ ok: true });
    };
    await assert.rejects(runZodiacTurn({ projectId: "p", sessionId: "s", text: "run", signal: controller.signal }), { name: "AbortError" });
    assert.ok(paths.includes("/api/agent/abort"));
    assert.ok(paths.every((p) => !p.includes("/api/model/")));
});

test("runtime dispatch requires host identity and does not promote readonly children through model arguments", async (t) => {
    const original = globalThis.fetch;
    t.after(() => { globalThis.fetch = original; });
    const executed: string[] = [], outcomes: any[] = [];
    const context = { role: "router", taskId: "ses_child", rootSessionId: "s", turnId: "turn", nativeCallId: "native-1" };
    let reads = 0;
    globalThis.fetch = async (url, init) => {
        const path = String(url);
        if (path.endsWith("/events")) return new Response("");
        if (path.endsWith("/start")) return Response.json({ sessionId: "ses_native" });
        if (path.endsWith("/state")) return Response.json(reads++ ? completed : { ...completed, tools: [
            { callId: "no-context", name: "hub_canvas_write_node", args: { content: "no" } },
            { callId: "forged-role", name: "hub_canvas_write_node", args: { content: "no", role: "orchestrator" }, context },
            { callId: "stale-turn", name: "hub_read", args: { nodeId: "asset" }, context: { ...context, turnId: "old" } },
            { callId: "read", name: "hub_read", args: { nodeId: "asset" }, context },
        ] });
        if (path.endsWith("/tool-result")) outcomes.push(JSON.parse(String(init?.body)));
        return Response.json({ ok: true });
    };
    await runZodiacTurn({ projectId: "p", sessionId: "s", turnId: "turn", text: "read", onToolRequest: (request, actor) => {
        assert.equal(actor.role, "router");
        assert.equal(actor.taskId, "ses_child");
        executed.push(request.callId);
        return { ok: true };
    } });
    assert.deepEqual(executed, ["read"]);
    assert.deepEqual(outcomes.map(outcome => outcome.result.ok), [false, false, false, true]);
});

test("SSE streams assistant text and reasoning without echoing user parts or duplicating snapshot reasoning", async (t) => {
    const original = globalThis.fetch;
    t.after(() => {
        globalThis.fetch = original;
    });
    const text: string[] = [];
    const thoughts: string[] = [];
    globalThis.fetch = async (url) => {
        const path = String(url);
        if (path.endsWith("/start")) return Response.json({ sessionId: "ses_native" });
        if (path.endsWith("/events")) {
            const events = [
                { type: "message.updated", properties: { info: { id: "user", sessionID: "ses_native", role: "user" } } },
                { type: "message.part.updated", properties: { part: { id: "u", messageID: "user", sessionID: "ses_native", type: "text", text: "Do not echo this user input" } } },
                { type: "message.updated", properties: { info: { id: "assistant", sessionID: "ses_native", role: "assistant" } } },
                { type: "message.part.updated", properties: { part: { id: "answer", messageID: "assistant", sessionID: "ses_native", type: "text", text: "" } } },
                { type: "message.part.delta", properties: { partID: "answer", sessionID: "ses_native", field: "text", delta: "Hello " } },
                { type: "message.part.updated", properties: { part: { id: "reason", messageID: "assistant", sessionID: "ses_native", type: "reasoning", text: "Checking files." } } },
                { type: "message.part.delta", properties: { partID: "answer", sessionID: "ses_native", field: "text", delta: "world" } },
            ];
            return new Response(events.map((event) => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "Content-Type": "text/event-stream" } });
        }
        if (path.endsWith("/state")) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            return Response.json({
                ...completed,
                messages: [
                    {
                        info: { id: "assistant", role: "assistant", time: { completed: 1 } },
                        parts: [
                            { id: "answer", type: "text", text: "Hello world" },
                            { id: "reason", type: "reasoning", text: "Checking files." },
                        ],
                    },
                ],
            });
        }
        return Response.json({ ok: true });
    };
    assert.equal(await runZodiacTurn({ projectId: "p", sessionId: "s", text: "run", onDelta: (value) => text.push(value), onReasoning: (value) => thoughts.push(value) }), "Hello world");
    assert.ok(text.includes("Hello "));
    assert.equal(text.at(-1), "Hello world");
    assert.ok(text.every((value) => !value.includes("Do not echo")));
    assert.deepEqual(thoughts, ["Checking files."]);
});
