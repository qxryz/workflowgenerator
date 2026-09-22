import { PLUGIN_AGENT_TOOL_DEFINITIONS } from "@/lib/agent/zodiac-plugin-tool-definitions.js";
import { ZODIAC_PLAN_TOOLS } from "@/lib/agent/zodiac-plan-tools.js";
import { ZODIAC_CAPABILITIES_TOOL } from "@/lib/agent/zodiac-capabilities";
import { ZODIAC_WORKFLOW_TOOL } from "@/lib/agent/zodiac-workflows";
import { zodiacToolWaitsForUser, type ZodiacToolCatalog, type ZodiacToolDefinition } from "@/lib/agent/zodiac-agent-policy";
import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { isMiniMaxAdapter } from "@/lib/model-adapters";
import { proxyModelPost } from "@/services/server-storage";
import { assertMiniMaxCredentialMatches, buildMiniMaxEndpoint } from "@/lib/minimax-contract";
import { buildMiniMaxAnthropicRequest } from "./minimax-text.ts";
import { ZODIAC_UI_PARAMETERS, ZODIAC_OPS_PARAMETERS, HUB_TOOL_DEFINITIONS, validateZodiacUi, validateZodiacOps } from "@/lib/agent/zodiac-native-tools.js";

export type ZodicContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ZodicMessage = { role: "system" | "user" | "assistant"; content: string | ZodicContentPart[] };

type ToolOutcome = { ok: true; result?: unknown } | { ok: false; error: string };
type ToolRequest = { callId: string; name: string; args: unknown };
export type RequestOptions = { signal?: AbortSignal; onToolRequest?: (request: ToolRequest) => Promise<ToolOutcome> | ToolOutcome; maxToolRounds?: number; tools?: ZodiacToolCatalog; includeDefaultRole?: boolean; onReasoning?: (text: string) => void; onStatus?: (status: "running" | "done" | "error") => void; responseTimeoutMs?: number };

function requestTools(options?: RequestOptions): readonly ZodiacToolDefinition[] {
    return typeof options?.tools === "function" ? options.tools() : (options?.tools ?? nativeTools());
}
type FunctionCall = { id?: string; name?: string; arguments?: string };
type OpenAiPayload = {
    error?: { message?: string };
    choices?: Array<{
        delta?: { reasoning_content?: string; reasoning?: string; content?: string | Array<{ text?: string }>; tool_calls?: Array<{ index?: number; id?: string; function?: FunctionCall }>; function_call?: FunctionCall };
        message?: { reasoning_content?: string; reasoning?: string; content?: string | Array<{ text?: string }>; tool_calls?: Array<{ id?: string; function?: FunctionCall }>; function_call?: FunctionCall; refusal?: string };
        finish_reason?: string;
    }>;
};
type GeminiPayload = {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string; thought?: boolean; functionCall?: { name?: string; args?: unknown } }> }; finishReason?: string }>;
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
};

/** Replies stream through the server, which forwards the provider's status,
 * content type and body untouched, so `readReply` parses them exactly as it did
 * when this talked to providers directly. Routing through the server is what
 * removes the CORS dependency: a browser-origin SSE request is blocked outright
 * by providers that send no `Access-Control-Allow-Origin`.
 *
 * `readReply` still accepts a plain JSON reply when a provider ignores
 * `stream`. All channels retain the same validated declarative UI protocol. */
export async function requestZodicReply(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    throwIfAborted(options?.signal);
    const requestConfig = { ...resolveModelRequestConfig(config, config.textModel || config.model), systemPrompt: "" };
    const conversation = withZodiacDefaultRole(options?.includeDefaultRole === false ? "" : config.zodiacSystemPrompt, messages);
    const history: ToolRound[] = [];
    if (!requestConfig.apiKey.trim() || !requestConfig.baseUrl.trim() || !requestConfig.model.trim()) throw new Error("请先在模型设置中配置一个可用的文本模型");
    for (const message of conversation) {
        if (Array.isArray(message.content)) message.content.forEach((part) => part.type === "image_url" && validateImageUrl(part.image_url.url));
    }
    const maximum = Math.min(Math.max(options?.maxToolRounds ?? 12, 1), 24);
    let visibleText = "";
    for (let round = 0; round < maximum; round += 1) {
        throwIfAborted(options?.signal);
        const tools = [...requestTools(options)];
        const stepOptions = { ...options, tools };
        const step = isMiniMaxAdapter(requestConfig.adapter)
            ? await requestMiniMaxStep(
                  requestConfig,
                  conversation,
                  (text) => {
                      visibleText = text;
                      onDelta(text);
                  },
                  stepOptions,
                  history,
              )
            : requestConfig.apiFormat === "gemini"
              ? await requestGeminiStep(
                    requestConfig,
                    conversation,
                    (text) => {
                        visibleText = text;
                        onDelta(text);
                    },
                    stepOptions,
                    history,
                )
              : await requestOpenAiStep(
                    requestConfig,
                    conversation,
                    (text) => {
                        visibleText = text;
                        onDelta(text);
                    },
                    stepOptions,
                    history,
                );
        visibleText = step.text || visibleText;
        if (!step.calls.length) {
            if (!visibleText.trim()) throw new Error("模型没有返回内容，请重试");
            onDelta(visibleText);
            return visibleText;
        }
        if (!options?.onToolRequest) throw new Error("模型请求执行工具，但当前界面没有连接工具执行器");
        const results: Array<{ callId: string; name: string; outcome: ToolOutcome }> = [];
        let waitForUser = false;
        for (const [index, call] of step.calls.entries()) {
            throwIfAborted(options?.signal);
            let request: ToolRequest;
            let outcome: ToolOutcome;
            try {
                request = normalizeFunctionCall(call, round, index, tools);
                outcome = await options.onToolRequest(request);
            } catch (error) {
                throwIfAborted(options?.signal);
                request = { callId: call.id || `native-${round + 1}-${index + 1}`, name: call.name || "unknown", args: {} };
                outcome = { ok: false, error: error instanceof Error ? error.message : "工具执行失败" };
            }
            throwIfAborted(options?.signal);
            results.push({ callId: request.callId, name: request.name, outcome });
            if (zodiacToolWaitsForUser(request.name, outcome)) {
                waitForUser = true;
                break;
            }
        }
        if (waitForUser) return visibleText.trim();
        history.push({ ...step, results });
        visibleText = "";
    }
    throw new Error("Zodiac 连续调用工具次数过多，已停止；请缩小本次任务后重试");
}

type StepReply = { text: string; calls: FunctionCall[]; parts?: unknown[] };
type ToolRound = StepReply & { results: Array<{ callId: string; name: string; outcome: ToolOutcome }> };

export function nativeTools() {
    const hub = Object.entries({ ...HUB_TOOL_DEFINITIONS, ...PLUGIN_AGENT_TOOL_DEFINITIONS }).map(([name, definition]) => ({ name, description: definition.description, parameters: definition.parameters }));
    return [
        {
            name: "task",
            description: "派发独立的只读路由或阶段规划任务。Router 判断 direct/workflow/ask；Planner 编写当前阶段供用户审核，不能执行生成。仅传明确意图和计划 ID，不复制完整父会话。",
            parameters: {
                type: "object",
                required: ["role", "input"],
                properties: { role: { type: "string", enum: ["router", "planner"] }, input: { type: "string", maxLength: 20000 }, planId: { type: "string" }, taskId: { type: "string", description: "恢复同一计划的 Planner 任务时使用返回的 taskId" } },
            },
        },
        { name: "zodiac-ui", description: "展示一个原生分层决策界面并等待用户回答；不要与 zodiac-ops 同轮调用。", parameters: ZODIAC_UI_PARAMETERS },
        { name: "zodiac-ops", description: "提交画布操作提案并等待用户批准；不要声称已经执行。", parameters: ZODIAC_OPS_PARAMETERS },
        {
            name: "skill",
            description: "读取已启用或本轮附加技能的正文。首次只传 name；读取文件时传文件清单中的相对 path。此工具只读取技能包中的文件；脚本由 Runtime 的原生 bash 工具在会话工作目录中执行，执行前需要审批。",
            parameters: { type: "object", required: ["name"], properties: { name: { type: "string", description: "技能 id 或显示名" }, path: { type: "string", description: "可选，技能包文件相对路径，默认 SKILL.md" } } },
        },
        ZODIAC_WORKFLOW_TOOL,
        ZODIAC_CAPABILITIES_TOOL,
        ...ZODIAC_PLAN_TOOLS,
        ...hub,
    ];
}

function normalizeFunctionCall(call: FunctionCall, round: number, index: number, tools: readonly ZodiacToolDefinition[]): ToolRequest {
    const name = call.name || "";
    const normalizedName = name === "zodic-ops" || name === "zodiac_ops" ? "zodiac-ops" : name === "zodiac_ui" ? "zodiac-ui" : name;
    if (!tools.some((tool) => tool.name === normalizedName)) throw new Error(`模型返回了无法识别的工具：${normalizedName || "未命名"}`);
    let args: unknown = {};
    try {
        args = JSON.parse(call.arguments || "{}");
    } catch {
        throw new Error(`工具 ${normalizedName} 的参数不完整，请重试`);
    }
    if (!args || typeof args !== "object" || Array.isArray(args)) throw new Error(`工具 ${normalizedName} 的参数格式无效`);
    if (normalizedName === "zodiac-ui") args = validateZodiacUi(args);
    if (normalizedName === "zodiac-ops") args = validateZodiacOps(args);
    return { callId: call.id || `native-${round + 1}-${index + 1}`, name: normalizedName, args };
}

function withZodiacDefaultRole(defaultRole: string, messages: ZodicMessage[]) {
    const role = defaultRole.trim();
    return role ? [{ role: "system" as const, content: role }, ...messages] : messages;
}

async function requestOpenAiStep(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions, history: ToolRound[] = []) {
    const url = buildApiUrl(config.baseUrl, "/chat/completions");
    const wireMessages = [
        ...messages,
        ...history.flatMap((step) => [
            { role: "assistant", content: step.text || null, tool_calls: step.calls.map((call, index) => ({ id: step.results[index].callId, type: "function", function: { name: call.name, arguments: call.arguments || "{}" } })) },
            ...step.results.map((result) => ({ role: "tool", tool_call_id: result.callId, content: JSON.stringify(result.outcome) })),
        ]),
    ];
    const body = {
        model: modelOptionName(config.model),
        messages: wireMessages,
        stream: true,
        ...(options?.onToolRequest && requestTools(options).length
            ? { tools: requestTools(options).map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } })), tool_choice: "auto" }
            : {}),
    };
    let text = "";
    const calls = new Map<number, FunctionCall>();
    const consume = (payload: OpenAiPayload) => {
        throwIfAborted(options?.signal);
        if (payload.error?.message) throw new Error(payload.error.message);
        const choice = payload.choices?.[0];
        if (choice?.finish_reason === "length") throw new Error("模型回答被截断，请重试或缩小本次任务");
        if (choice?.finish_reason === "content_filter" || choice?.message?.refusal) throw new Error(choice.message?.refusal || "模型未能回答本次请求");
        const output = choice?.delta || choice?.message;
        const reasoning = output?.reasoning_content || output?.reasoning;
        if (reasoning) options?.onReasoning?.(reasoning);
        const content = output?.content;
        const delta = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text || "").join("") : "";
        if (delta) {
            text += delta;
            onDelta(text);
        }
        const toolCalls = choice?.delta?.tool_calls || choice?.message?.tool_calls || (output?.function_call ? [{ function: output.function_call }] : []);
        toolCalls.forEach((call, position) => {
            const index = "index" in call && typeof call.index === "number" ? call.index : position;
            const previous = calls.get(index) || {};
            calls.set(index, { id: previous.id || ("id" in call ? call.id : undefined), name: (previous.name || "") + (call.function?.name || ""), arguments: (previous.arguments || "") + (call.function?.arguments || "") });
        });
    };
    await streamProvider(url, config.apiKey, body, consume, options);
    return { text, calls: [...calls.values()] };
}

async function requestGeminiStep(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions, history: ToolRound[] = []) {
    const base = config.baseUrl.trim().replace(/\/+$/, "");
    const apiBase = /\/v1(?:beta)?$/i.test(base) ? base : `${base}/v1beta`;
    const model = modelOptionName(config.model).replace(/^models\//, "");
    const system = messages
        .filter((message) => message.role === "system")
        .map((message) => textContent(message.content))
        .filter(Boolean)
        .join("\n\n");
    const contents: Array<{ role: string; parts: unknown[] }> = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }));
    for (const step of history) contents.push({ role: "model", parts: step.parts || [] }, { role: "user", parts: step.results.map((result) => ({ functionResponse: { name: result.name, response: result.outcome } })) });
    const url = `${apiBase}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const body = {
        contents,
        ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
        ...(options?.onToolRequest && requestTools(options).length ? { tools: [{ functionDeclarations: requestTools(options).map((tool) => ({ name: tool.name, description: tool.description, parameters: tool.parameters })) }] } : {}),
    };
    let text = "";
    const calls: FunctionCall[] = [];
    const parts: unknown[] = [];
    const consume = (payload: GeminiPayload) => {
        throwIfAborted(options?.signal);
        if (payload.error?.message) throw new Error(payload.error.message);
        if (payload.promptFeedback?.blockReason) throw new Error(`模型拒绝了本次请求：${payload.promptFeedback.blockReason}`);
        const candidate = payload.candidates?.[0];
        if (candidate?.finishReason === "MAX_TOKENS") throw new Error("模型回答被截断，请重试或缩小本次任务");
        if (candidate?.finishReason && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(candidate.finishReason)) throw new Error(`模型未能完成回答：${candidate.finishReason}`);
        parts.push(...(candidate?.content?.parts || []));
        for (const part of candidate?.content?.parts || []) {
            if (part.thought) { if (part.text) options?.onReasoning?.(part.text); continue; }
            if (part.text) {
                text += part.text;
                onDelta(text);
            }
            if (part.functionCall) calls.push({ name: part.functionCall.name, arguments: JSON.stringify(part.functionCall.args) });
        }
    };
    await streamProvider(url, config.apiKey, body, consume, options, "x-goog-api-key");
    return { text, calls, parts };
}

/** Providers may return JSON despite stream:true. Sniff unlabeled JSON as well
 * as Content-Type, and preserve UTF-8/SSE records across arbitrary chunks. */
export async function readZodicProviderReply<T>(response: Response, consume: (payload: T) => void | boolean) {
    if (!response.ok) throw new Error(await readError(response));
    const consumeJson = (value: T | T[]) => (Array.isArray(value) ? value.some((entry) => consume(entry) === true) : consume(value) === true);
    if (!response.body || response.headers.get("content-type")?.includes("application/json")) {
        consumeJson(await response.json());
        return;
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let json = false;
    const consumeBlock = (block: string) => {
        const data = block
            .split(/\r?\n/)
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trimStart())
            .join("\n")
            .trim();
        if (data === "[DONE]") return true;
        if (data) return consumeJson(JSON.parse(data));
        return false;
    };
    try {
        for (;;) {
            const { done, value } = await reader.read();
            buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
            if (/^\s*[[{]/u.test(buffer)) json = true;
            if (!json) {
                const blocks = buffer.split(/\r?\n\r?\n/);
                buffer = blocks.pop() || "";
                if (blocks.some(consumeBlock)) return;
            }
            if (done) break;
        }
        if (json) consumeJson(JSON.parse(buffer));
        else if (buffer.trim()) consumeBlock(buffer);
    } finally {
        await reader.cancel().catch(() => {});
        reader.releaseLock();
    }
}

async function requestMiniMaxStep(config: ReturnType<typeof resolveModelRequestConfig>, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions, history: ToolRound[] = []): Promise<StepReply> {
    const billingMode = config.minimaxBillingMode || "payg";
    assertMiniMaxCredentialMatches(billingMode, config.apiKey);
    const endpoint = buildMiniMaxEndpoint(config.baseUrl, "text");
    const base = buildMiniMaxAnthropicRequest(config.model, messages, config.systemPrompt);
    const wireMessages = [
        ...base.messages,
        ...history.flatMap((step) => [
            { role: "assistant", content: step.parts || [] },
            { role: "user", content: step.results.map((result) => ({ type: "tool_result", tool_use_id: result.callId, content: JSON.stringify(result.outcome), is_error: !result.outcome.ok })) },
        ]),
    ];
    const body = { ...base, stream: true, messages: wireMessages, ...(options?.onToolRequest && requestTools(options).length ? { tools: requestTools(options).map((tool) => ({ name: tool.name, description: tool.description, input_schema: tool.parameters })) } : {}) };
    type Block = { type?: string; text?: string; thinking?: string; signature?: string; id?: string; name?: string; input?: unknown; json?: string };
    const blocks = new Map<number, Block>();
    let text = "";
    const consume = (payload: { type?: string; index?: number; content_block?: Block; delta?: Block & { type?: string; partial_json?: string; stop_reason?: string }; content?: Block[]; stop_reason?: string; error?: { message?: string }; base_resp?: { status_code?: number; status_msg?: string } }) => {
        if (payload.error?.message) throw new Error(payload.error.message);
        if (payload.base_resp?.status_code) throw new Error(payload.base_resp.status_msg || "MiniMax 请求失败");
        if (payload.stop_reason === "max_tokens" || payload.delta?.stop_reason === "max_tokens") throw new Error("模型回答被截断，请重试或缩小本次任务");
        if (payload.content) {
            payload.content.forEach((part, index) => { blocks.set(index, part); if (part.type === "text") text += part.text || ""; if (part.type === "thinking" && part.thinking) options?.onReasoning?.(part.thinking); });
            if (text) onDelta(text);
        }
        const index = payload.index ?? 0;
        if (payload.type === "content_block_start" && payload.content_block) {
            blocks.set(index, { ...payload.content_block });
            if (payload.content_block.type === "text" && payload.content_block.text) { text += payload.content_block.text; onDelta(text); }
        }
        if (payload.type === "content_block_delta") {
            const block = blocks.get(index) || {};
            const delta = payload.delta || {};
            if (delta.text) { block.text = (block.text || "") + delta.text; text += delta.text; onDelta(text); }
            if (delta.thinking) { block.thinking = (block.thinking || "") + delta.thinking; options?.onReasoning?.(delta.thinking); }
            if (delta.signature) block.signature = (block.signature || "") + delta.signature;
            if (delta.partial_json) block.json = (block.json || "") + delta.partial_json;
            blocks.set(index, block);
        }
        return payload.type === "message_stop";
    };
    await streamProvider(endpoint, config.apiKey, body, consume, options, undefined, { "anthropic-version": "2023-06-01" });
    const parts = [...blocks.entries()].sort(([a], [b]) => a - b).map(([, block]) => {
        const { json, ...part } = block;
        if (json) part.input = JSON.parse(json);
        return part;
    });
    const calls = parts.filter((part) => part.type === "tool_use").map((part) => ({ id: part.id, name: part.name, arguments: JSON.stringify(part.input || {}) }));
    return { text, calls, parts };
}

async function streamProvider<T>(url: string, key: string, body: Record<string, unknown>, consume: (payload: T) => void | boolean, options?: RequestOptions, auth?: "x-goog-api-key", headers?: Record<string, string>) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    options?.signal?.addEventListener("abort", abort, { once: true });
    if (options?.signal?.aborted) abort();
    let expired = false;
    const timeout = setTimeout(() => { expired = true; controller.abort(); }, options?.responseTimeoutMs ?? 180_000);
    options?.onStatus?.("running");
    try {
        const response = await proxyModelPost(url, key, body, auth, headers, controller.signal);
        await readZodicProviderReply(response, consume);
        throwIfAborted(controller.signal);
        options?.onStatus?.("done");
    } catch (error) {
        options?.onStatus?.("error");
        if (expired) throw new Error("模型响应超时。请重试，或在渠道设置中切换模型。");
        throw error;
    } finally {
        clearTimeout(timeout);
        options?.signal?.removeEventListener("abort", abort);
    }
}

function toGeminiParts(content: ZodicMessage["content"]) {
    if (!Array.isArray(content)) return [{ text: content }];
    return content.map((part) => {
        if (part.type === "text") return { text: part.text };
        const match = part.image_url.url.match(/^data:(image\/[^;,]+)(?:;[^,]*)?;base64,([\s\S]+)$/i);
        if (match) return { inlineData: { mimeType: match[1], data: match[2] } };
        return { fileData: { fileUri: part.image_url.url } };
    });
}

function validateImageUrl(url: string) {
    if (/^https?:\/\//i.test(url)) return;
    if (/^data:image\/[^;,]+(?:;[^,]*)?;base64,[a-z\d+/=\s]+$/i.test(url)) return;
    throw new Error("参考图片尚未读取成功，请重新添加图片后重试");
}

function textContent(content: ZodicMessage["content"]) {
    return Array.isArray(content)
        ? content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
        : content;
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason || new DOMException("请求已取消", "AbortError");
}

async function readError(response: Response) {
    const text = await response.text();
    try {
        const parsed = JSON.parse(text) as { error?: { message?: string }; message?: string };
        return parsed.error?.message || parsed.message || text || `请求失败 (${response.status})`;
    } catch {
        return text || `请求失败 (${response.status})`;
    }
}
