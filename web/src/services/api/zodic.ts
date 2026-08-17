import { buildApiUrl, modelOptionName, resolveModelRequestConfig, type AiConfig } from "@/stores/use-config-store";
import { isMiniMaxAdapter } from "@/lib/model-adapters";
import { requestMiniMaxTextReply } from "./minimax-text";

export type ZodicContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type ZodicMessage = { role: "system" | "user" | "assistant"; content: string | ZodicContentPart[] };

type RequestOptions = { signal?: AbortSignal };

/** Runs one turn through the selected BYOK text model. OpenAI-compatible and
 * Gemini channels stream; MiniMax uses its native Anthropic Messages reply. */
export async function requestZodicReply(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const requestConfig = { ...resolveModelRequestConfig(config, config.textModel || config.model), systemPrompt: "" };
    const zodiacMessages = withZodiacDefaultRole(config.zodiacSystemPrompt, messages);
    if (!requestConfig.apiKey.trim() || !requestConfig.baseUrl.trim() || !requestConfig.model.trim()) throw new Error("请先在模型设置中配置一个可用的文本模型");
    if (isMiniMaxAdapter(requestConfig.adapter)) {
        return requestMiniMaxTextReply(requestConfig, zodiacMessages, onDelta, options);
    }
    return requestConfig.apiFormat === "gemini" ? requestGeminiReply(requestConfig, zodiacMessages, onDelta, options) : requestOpenAiReply(requestConfig, zodiacMessages, onDelta, options);
}

function withZodiacDefaultRole(defaultRole: string, messages: ZodicMessage[]) {
    const role = defaultRole.trim();
    return role ? [{ role: "system" as const, content: role }, ...messages] : messages;
}

async function requestOpenAiReply(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const response = await fetch(buildApiUrl(config.baseUrl, "/chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.apiKey}`, Accept: "text/event-stream" },
        body: JSON.stringify({ model: modelOptionName(config.model), messages, stream: true }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    if (!response.body) return readOpenAiJson(response, onDelta);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const consume = (flush = false) => {
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = flush ? "" : blocks.pop() || "";
        for (const block of blocks) {
            const data = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n")
                .trim();
            if (!data || data === "[DONE]") continue;
            const payload = JSON.parse(data) as { error?: { message?: string }; choices?: Array<{ delta?: { content?: string | Array<{ text?: string }> } }> };
            if (payload.error?.message) throw new Error(payload.error.message);
            const content = payload.choices?.[0]?.delta?.content;
            const delta = typeof content === "string" ? content : Array.isArray(content) ? content.map((part) => part.text || "").join("") : "";
            if (!delta) continue;
            text += delta;
            onDelta(text);
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consume();
    }
    buffer += decoder.decode();
    consume(true);
    return text || "没有返回内容";
}

async function readOpenAiJson(response: Response, onDelta: (text: string) => void) {
    const payload = (await response.json()) as { error?: { message?: string }; choices?: Array<{ message?: { content?: string } }> };
    if (payload.error?.message) throw new Error(payload.error.message);
    const text = payload.choices?.[0]?.message?.content || "没有返回内容";
    onDelta(text);
    return text;
}

async function requestGeminiReply(config: AiConfig, messages: ZodicMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const base = config.baseUrl.trim().replace(/\/+$/, "");
    const apiBase = /\/v1(?:beta)?$/i.test(base) ? base : `${base}/v1beta`;
    const model = modelOptionName(config.model).replace(/^models\//, "");
    const system = messages
        .filter((message) => message.role === "system")
        .map((message) => textContent(message.content))
        .filter(Boolean)
        .join("\n\n");
    const contents = messages.filter((message) => message.role !== "system").map((message) => ({ role: message.role === "assistant" ? "model" : "user", parts: toGeminiParts(message.content) }));
    const response = await fetch(`${apiBase}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": config.apiKey },
        body: JSON.stringify({ contents, ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}) }),
        signal: options?.signal,
    });
    if (!response.ok) throw new Error(await readError(response));
    if (!response.body) return readGeminiJson(response, onDelta);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    let text = "";
    const consume = (flush = false) => {
        const blocks = buffer.split(/\r?\n\r?\n/);
        buffer = flush ? "" : blocks.pop() || "";
        for (const block of blocks) {
            const data = block
                .split(/\r?\n/)
                .filter((line) => line.startsWith("data:"))
                .map((line) => line.slice(5).trimStart())
                .join("\n")
                .trim();
            if (!data || data === "[DONE]") continue;
            const payload = JSON.parse(data) as GeminiPayload;
            if (payload.error?.message) throw new Error(payload.error.message);
            const delta =
                payload.candidates
                    ?.flatMap((candidate) => candidate.content?.parts || [])
                    .map((part) => part.text || "")
                    .join("") || "";
            if (!delta) continue;
            text += delta;
            onDelta(text);
        }
    };
    for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        consume();
    }
    buffer += decoder.decode();
    consume(true);
    return text || "没有返回内容";
}

type GeminiPayload = { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>; error?: { message?: string } };

async function readGeminiJson(response: Response, onDelta: (text: string) => void) {
    const payload = (await response.json()) as GeminiPayload;
    if (payload.error?.message) throw new Error(payload.error.message);
    const text =
        payload.candidates
            ?.flatMap((candidate) => candidate.content?.parts || [])
            .map((part) => part.text || "")
            .join("") || "没有返回内容";
    onDelta(text);
    return text;
}

function toGeminiParts(content: ZodicMessage["content"]) {
    if (!Array.isArray(content)) return [{ text: content }];
    return content.map((part) => {
        if (part.type === "text") return { text: part.text };
        const match = part.image_url.url.match(/^data:([^;,]+);base64,(.+)$/);
        return match ? { inlineData: { mimeType: match[1], data: match[2] } } : { text: part.image_url.url };
    });
}

function textContent(content: ZodicMessage["content"]) {
    return Array.isArray(content)
        ? content
              .filter((part) => part.type === "text")
              .map((part) => part.text)
              .join("\n")
        : content;
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
