import { flushPendingWrites } from "@/services/server-storage";
import type { ZodiacTurnOptions, ZodiacToolResult } from "./zodiac-transport";
import { nativeTools } from "./zodic.ts";
import { zodiacToolLabel } from "@/lib/agent/zodiac-activity";
import { createZodiacToolDispatcher, type ZodiacRoleContext, type ZodiacToolDefinition } from "@/lib/agent/zodiac-agent-policy";

type RuntimeMessage = {
    info: { id: string; role: string; time?: { completed?: number }; error?: { data?: { message?: string }; name?: string } };
    parts: { id: string; type: string; text?: string; tool?: string; callID?: string; state?: { status: string; title?: string; input?: unknown; error?: string } }[];
};
type RuntimeSnapshot = {
    sessionId: string;
    messages: RuntimeMessage[];
    status?: { type: string } | null;
    permissions: { id: string; permission: string; patterns: string[]; metadata: unknown }[];
    tools: { callId: string; name: string; args: unknown; context: Pick<ZodiacRoleContext, "role" | "taskId" | "rootSessionId" | "turnId" | "nativeCallId"> }[];
    children: { id: string; title: string }[];
};
export async function agentRequest<T>(endpoint: string, body: unknown, signal?: AbortSignal): Promise<T> {
    const response = await fetch(`/api/agent/${endpoint}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
            message = JSON.parse(text).error || text;
        } catch {
            /* Plain HTTP error. */
        }
        throw new Error(message || "Agent 连接失败");
    }
    return response.json();
}
const delay = (signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
        const abort = () => {
            clearTimeout(timer);
            reject(new DOMException("Aborted", "AbortError"));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", abort);
            resolve();
        }, 200);
        if (signal?.aborted) abort();
        else signal?.addEventListener("abort", abort, { once: true });
    });

/** Shared by runtime registration and the in-app tool reference. Native task is not an MCP tool. */
export function registeredZodiacTools(tools: readonly ZodiacToolDefinition[] = nativeTools(), skillTools: readonly ZodiacToolDefinition[] = []) {
    return [WORKSPACE_IMPORT_TOOL, ...tools, ...skillTools].filter(
        (tool, index, all) => !["task", "hub_generate_music", "hub_video_edit"].includes(tool.name) && all.findIndex(t => t.name === tool.name) === index,
    );
}

/** Persistent native sessions own execution. React observes output and handles app tools. */
export async function runOpenCodeTurn(options: ZodiacTurnOptions): Promise<string> {
    const turnId = options.turnId || crypto.randomUUID();
    const identity = { projectId: options.projectId!, sessionId: options.sessionId, turnId };
    const messages = options.messages || [];
    const content = (value: (typeof messages)[number]["content"]) =>
        typeof value === "string"
            ? value
            : value
                  .filter((p) => p.type === "text")
                  .map((p) => ("text" in p ? p.text : ""))
                  .join("\n");
    const lastUser = [...messages].reverse().find((m) => m.role === "user");
    const attachments =
        lastUser && Array.isArray(lastUser.content)
            ? lastUser.content
                  .filter((part) => part.type === "image_url")
                  .map((part) => {
                      const url = "image_url" in part ? part.image_url.url : "";
                      return { type: "file", mime: url.slice(5, url.indexOf(";")), url };
                  })
            : [];
    const history = messages
        .filter((message) => message.role !== "system" && message !== lastUser)
        .slice(-16)
        .map((message) => `${message.role}: ${content(message.content)}`)
        .join("\n\n")
        .slice(-60000);
    const system =
        messages
            .filter((m) => m.role === "system")
            .map((m) => content(m.content))
            .join("\n\n") +
        "\n\nRuntime tools: application tools have the wg_ prefix (for example wg_hub_canvas_write_node). Use native task for persistent subagents, with subagent_type router, planner or executor. Native read/write/edit/bash operate on actual files. Skill packages and scripts are under ./skills/. Keep intermediate files and scripts in this session workspace. A successful tool result that waits for the user ends this turn; do not continue mutating the canvas. Never claim execution without tool results.";
    const tools = registeredZodiacTools(typeof options.tools === "function" ? options.tools() : options.tools || nativeTools(), options.skillToolCatalog);
    const dispatchers = new Map<string, ReturnType<typeof createZodiacToolDispatcher>>();
    const handled = new Set<string>();
    const reasoning = new Map<string, string>();
    let finalText = "";
    let lastText = "";
    let started = false;
    let waitingForUser = false;
    let waitingMessage = "";
    let stopTask: Promise<unknown> | undefined;
    let runtimeError: string | undefined;
    let idleWithoutReply = 0;
    let eventTask: Promise<void> | undefined;
    const eventController = new AbortController();
    const assistantIds = new Set<string>();
    const streamedParts = new Map<string, { type: string; text: string; messageId: string }>();
    let latestAssistantId = "";
    const emitParts = () => {
        const text = [...streamedParts.values()]
            .filter((part) => part.type === "text" && part.messageId === latestAssistantId)
            .map((part) => part.text)
            .filter(Boolean)
            .join("\n\n");
        if (text !== lastText) {
            lastText = text;
            options.onDelta?.(text);
        }
    };
    const emitReasoning = (id: string, text: string) => {
        const previous = reasoning.get(id) || "";
        if (text.startsWith(previous) && text.length > previous.length) options.onReasoning?.(text.slice(previous.length));
        reasoning.set(id, text);
    };
    const stop = () => {
        if (started) stopTask ??= agentRequest("abort", identity).catch(() => undefined);
        return stopTask;
    };
    options.signal?.addEventListener("abort", stop, { once: true });
    options.onActivity?.({ id: "runtime", kind: "model", status: "running", label: "思考中", at: Date.now() });
    try {
        await flushPendingWrites();
        options.signal?.throwIfAborted();
        const { sessionId: nativeSession } = await agentRequest<{ sessionId: string }>("start", {
            ...identity,
            turnId,
            text: lastUser ? content(lastUser.content) : options.text,
            system,
            history,
            attachments,
            tools,
            skills: options.skills || [],
            assets: options.assets || [],
        });
        started = true;
        options.signal?.throwIfAborted();
        eventTask = observeEvents(identity, eventController.signal, (event) => {
            const properties = event.properties;
            const part = properties?.part;
            if (event.type === "session.error" && properties?.sessionID === nativeSession) runtimeError = properties.error?.data?.message || "Agent 执行失败";
            if (event.type === "message.updated" && properties?.info?.sessionID === nativeSession && properties.info.role === "assistant") { assistantIds.add(properties.info.id); latestAssistantId = properties.info.id; }
            if (event.type === "message.part.updated" && part?.sessionID === nativeSession && assistantIds.has(part.messageID) && ["text", "reasoning"].includes(part.type)) {
                streamedParts.set(part.id, { type: part.type, text: part.text || "", messageId: part.messageID });
                if (part.type === "reasoning") emitReasoning(part.id, part.text || "");
                else emitParts();
            } else if (event.type === "message.part.delta" && properties?.sessionID === nativeSession && properties.field === "text") {
                const existing = streamedParts.get(properties.partID);
                if (!existing) return;
                existing.text += properties.delta || "";
                if (existing.type === "reasoning") emitReasoning(properties.partID, existing.text);
                else emitParts();
            }
        }).catch(() => undefined); // Canonical snapshots recover a dropped event connection.
        for (;;) {
            if (runtimeError) throw new Error(runtimeError);
            const state = await agentRequest<RuntimeSnapshot>("state", identity, options.signal);
            const assistants = state.messages.filter((m) => m.info.role === "assistant");
            latestAssistantId = assistants.at(-1)?.info.id || latestAssistantId;
            finalText = (assistants.at(-1)?.parts || [])
                .filter((p) => p.type === "text").map((p) => p.text || "")
                .filter(Boolean)
                .join("\n\n");
            for (const message of assistants) {
                assistantIds.add(message.info.id);
                for (const part of message.parts)
                    if (part.type === "text" || part.type === "reasoning") {
                        const current = streamedParts.get(part.id);
                        if (!current || !current.text.startsWith(part.text || "")) streamedParts.set(part.id, { type: part.type, text: part.text || "", messageId: message.info.id });
                    }
            }
            emitParts();
            for (const message of assistants) {
                if (message.info.error) throw new Error(message.info.error.data?.message || message.info.error.name || "模型执行失败");
                for (const part of message.parts) {
                    if (part.type === "reasoning") {
                        emitReasoning(part.id, part.text || "");
                    }
                    if (part.type === "tool" && part.state) {
                        const status = part.state.status === "completed" ? "done" : part.state.status === "error" ? "error" : "running";
                        options.onActivity?.({
                            id: part.callID || part.id,
                            kind: "tool",
                            status,
                            label: zodiacToolLabel((part.tool || "").replace(/^wg_/, "")),
                            ...(part.state.error ? { detail: part.state.error } : {}),
                            at: Date.now(),
                        });
                    }
                }
            }
            for (const request of state.permissions) {
                if (handled.has(request.id)) continue;
                handled.add(request.id);
                const name = request.permission === "bash" ? "执行命令" : request.permission === "edit" ? "写入文件" : "访问文件";
                options.onActivity?.({ id: request.id, kind: "approval", status: "waiting", label: `确认${name}`, detail: JSON.stringify({ patterns: request.patterns, metadata: request.metadata }, null, 2), at: Date.now() });
                const approved =
                    (!waitingForUser && (await options.onPermissionRequest?.({ callId: request.id, name, args: { patterns: request.patterns, ...(typeof request.metadata === "object" && request.metadata !== null ? request.metadata : {}) } }))) || false;
                await agentRequest("permission", { ...identity, id: request.id, result: approved }, options.signal);
                options.onActivity?.({ id: request.id, kind: "approval", status: approved ? "done" : "error", label: approved ? `已允许${name}` : `已拒绝${name}`, at: Date.now() });
            }
            for (const request of state.tools) {
                if (handled.has(request.callId)) continue;
                handled.add(request.callId);
                let result: ZodiacToolResult;
                try {
                    const actor = request.context;
                    if (!actor || actor.rootSessionId !== options.sessionId || actor.turnId !== turnId || !["orchestrator", "router", "planner", "executor"].includes(actor.role) || !actor.taskId) {
                        result = { ok: false, error: "工具请求缺少有效的任务身份，未执行。" };
                    } else if (waitingForUser) {
                        result = { ok: false, error: "正在等待用户确认，不得继续执行。" };
                    } else {
                        const key = `${actor.taskId}:${actor.role}`;
                        let dispatcher = dispatchers.get(key);
                        if (!dispatcher) {
                            dispatcher = createZodiacToolDispatcher({
                                context: { ...actor, source: options.source || { kind: "opencode" }, signal: options.signal },
                                tools: () => tools,
                                execute: (call, context) => options.onToolRequest
                                    ? options.onToolRequest(call, { ...context, nativeCallId: (call as RuntimeSnapshot["tools"][number]).context.nativeCallId })
                                    : { ok: false, error: "工具执行器不可用" },
                                skillTools: options.skillTools,
                                maxCalls: options.maxToolRounds,
                            });
                            dispatchers.set(key, dispatcher);
                        }
                        result = await dispatcher.dispatch(request);
                    }
                } catch (error) {
                    result = { ok: false, error: error instanceof Error ? error.message : "工具执行失败" };
                }
                if (result.ok && (["zodiac-ui", "zodiac-ops"].includes(request.name) || (result.result as any)?.status === "waiting_user" || (result.result as any)?.waitingForUser === true)) {
                    waitingForUser = true;
                    waitingMessage = (result.result as any)?.message || (request.name === "zodiac-ui" ? "请选择后继续。" : "内容已准备，请查看后继续。");
                }
                await agentRequest("tool-result", { ...identity, id: request.callId, result }, options.signal);
            }
            if (waitingForUser) {
                // End a decision turn before the model can start another tool or hang behind the fence.
                await stop();
                options.signal?.throwIfAborted();
                options.onActivity?.({ id: "runtime", kind: "model", status: "done", label: "等待你确认", at: Date.now() });
                return waitingMessage;
            }
            const last = assistants.at(-1);
            idleWithoutReply = !last?.info.time?.completed && (!state.status || state.status.type === "idle") && !state.tools.length && !state.permissions.length ? idleWithoutReply + 1 : 0;
            if (idleWithoutReply > 50) throw new Error(last ? "任务已中断，请先核对已生成的产物后继续。" : "Agent 未开始回复，请检查模型连接后重试。");
            if (last?.info.time?.completed && (!state.status || state.status.type === "idle") && !state.tools.length && !state.permissions.length) break;
            await delay(options.signal);
        }
        options.onActivity?.({ id: "runtime", kind: "model", status: "done", label: "已完成", at: Date.now() });
        return finalText;
    } catch (error) {
        await stop();
        options.onActivity?.({ id: "runtime", kind: "model", status: "error", label: options.signal?.aborted ? "已停止" : "执行失败", detail: options.signal?.aborted ? undefined : error instanceof Error ? error.message : String(error), at: Date.now() });
        throw error;
    } finally {
        eventController.abort();
        await eventTask;
        await stopTask;
        options.signal?.removeEventListener("abort", stop);
    }
}

// OpenCode sends actual text/reasoning deltas. Polling supplies durable snapshots,
// pending approvals and MCP requests, including after a transient SSE disconnect.
async function observeEvents(identity: unknown, signal: AbortSignal, onEvent: (event: any) => void) {
    const response = await fetch("/api/agent/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(identity), signal });
    if (!response.ok || !response.body) throw new Error("事件连接不可用");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    try {
        for (;;) {
            const { value, done } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true }).replace(/\r\n/g, "\n");
            let boundary;
            while ((boundary = buffer.indexOf("\n\n")) >= 0) {
                const block = buffer.slice(0, boundary);
                buffer = buffer.slice(boundary + 2);
                const data = block
                    .split("\n")
                    .filter((line) => line.startsWith("data:"))
                    .map((line) => line.slice(5).trimStart())
                    .join("\n");
                if (data) {
                    try {
                        onEvent(JSON.parse(data));
                    } catch {
                        /* Ignore non-JSON heartbeat. */
                    }
                }
            }
        }
    } finally {
        reader.releaseLock();
    }
}

const WORKSPACE_IMPORT_TOOL = {
    name: "hub_import_file",
    description: "将当前会话工作区中的真实图片、视频、音频或文本文档导入画布；传相对路径，需要用户确认。用于脚本处理后的最终产物。",
    parameters: { type: "object", properties: { path: { type: "string" }, name: { type: "string" } }, required: ["path"] },
};
