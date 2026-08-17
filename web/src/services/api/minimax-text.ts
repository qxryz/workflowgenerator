export type MiniMaxTextContentPart = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

export type MiniMaxTextMessage = {
    role: "system" | "user" | "assistant";
    content: string | MiniMaxTextContentPart[];
};

export type MiniMaxTextRequestConfig = {
    baseUrl: string;
    apiKey: string;
    model: string;
    minimaxBillingMode?: "token-plan" | "payg";
    systemPrompt?: string;
};

type AnthropicTextPart = { type: "text"; text: string };
type AnthropicImagePart = {
    type: "image";
    source: { type: "base64"; media_type: string; data: string } | { type: "url"; url: string };
};

export type MiniMaxAnthropicMessage = {
    role: "user" | "assistant";
    content: Array<AnthropicTextPart | AnthropicImagePart>;
};

export type MiniMaxAnthropicRequest = {
    model: string;
    max_tokens: number;
    stream: false;
    system?: string;
    messages: MiniMaxAnthropicMessage[];
};

type MiniMaxAnthropicResponse = {
    content?: Array<{ type?: string; text?: string }>;
    error?: { message?: string };
    base_resp?: { status_code?: number; status_msg?: string };
};

type RequestOptions = { signal?: AbortSignal };

/** Serializes the app's shared text/image message shape to MiniMax's
 * Anthropic Messages contract. System prompts live at the request root. */
export function buildMiniMaxAnthropicRequest(model: string, messages: MiniMaxTextMessage[], systemPrompt = ""): MiniMaxAnthropicRequest {
    const system = [systemPrompt, ...messages.filter((message) => message.role === "system").map((message) => textOnly(message.content))]
        .map((value) => value.trim())
        .filter(Boolean)
        .join("\n\n");

    const converted = messages
        .filter((message): message is MiniMaxTextMessage & { role: "user" | "assistant" } => message.role !== "system")
        .map((message) => ({ role: message.role, content: toAnthropicContent(message.content) }))
        .filter((message) => message.content.length > 0);
    const normalized = converted.reduce<MiniMaxAnthropicMessage[]>((result, message) => {
        const previous = result.at(-1);
        if (previous?.role === message.role) previous.content.push(...message.content);
        else result.push(message);
        return result;
    }, []);

    if (!model.trim()) throw new Error("请选择 MiniMax M3 模型");
    if (!normalized.length) throw new Error("请输入消息内容");
    return {
        model: model.trim(),
        max_tokens: 8192,
        stream: false,
        ...(system ? { system } : {}),
        messages: normalized,
    };
}

export function parseMiniMaxAnthropicResponse(payload: MiniMaxAnthropicResponse) {
    const statusCode = payload.base_resp?.status_code;
    if (typeof statusCode === "number" && statusCode !== 0) {
        throw new Error(payload.base_resp?.status_msg || `MiniMax 请求失败（${statusCode}）`);
    }
    if (payload.error?.message) throw new Error(payload.error.message);
    const text = (payload.content || [])
        .map((part) => part.text || "")
        .filter(Boolean)
        .join("");
    return text || "没有返回内容";
}

/** MiniMax M3 deliberately uses the provider's Anthropic Messages endpoint;
 * it never falls back to OpenAI Chat Completions. */
export async function requestMiniMaxTextReply(config: MiniMaxTextRequestConfig, messages: MiniMaxTextMessage[], onDelta: (text: string) => void, options?: RequestOptions) {
    const billingMode = config.minimaxBillingMode || "payg";
    const { assertMiniMaxCredentialMatches, buildMiniMaxEndpoint } = await import("@/lib/minimax-contract");
    assertMiniMaxCredentialMatches(billingMode, config.apiKey);
    if (!config.apiKey.trim()) throw new Error("请先配置当前 MiniMax 线路的密钥");
    const endpoint = buildMiniMaxEndpoint(config.baseUrl, "text");
    const body = buildMiniMaxAnthropicRequest(config.model, messages, config.systemPrompt);
    throwIfAborted(options?.signal);

    let payload: MiniMaxAnthropicResponse;
    const { isDesktopApp, postDesktopModelJson } = await import("@/services/desktop-storage");
    if (isDesktopApp()) {
        const result = await postDesktopModelJson<MiniMaxAnthropicResponse>(endpoint, config.apiKey, body);
        if (!result) throw new Error("MiniMax 桌面请求没有返回内容");
        payload = result;
    } else {
        const response = await fetch(endpoint, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Authorization: `Bearer ${config.apiKey}`,
                "anthropic-version": "2023-06-01",
            },
            body: JSON.stringify(body),
            signal: options?.signal,
        });
        if (!response.ok) throw new Error(await readMiniMaxError(response));
        payload = (await response.json()) as MiniMaxAnthropicResponse;
    }

    throwIfAborted(options?.signal);
    const text = parseMiniMaxAnthropicResponse(payload);
    onDelta(text);
    return text;
}

function toAnthropicContent(content: MiniMaxTextMessage["content"]): MiniMaxAnthropicMessage["content"] {
    if (!Array.isArray(content)) return content ? [{ type: "text", text: content }] : [];
    return content.flatMap((part): MiniMaxAnthropicMessage["content"] => {
        if (part.type === "text") return part.text ? [{ type: "text", text: part.text }] : [];
        return [{ type: "image", source: imageSource(part.image_url.url) }];
    });
}

function imageSource(url: string): AnthropicImagePart["source"] {
    const dataUrl = /^data:([^;,]+)(?:;[^,]*)?;base64,(.+)$/is.exec(url);
    if (dataUrl) {
        if (!dataUrl[1].toLowerCase().startsWith("image/")) throw new Error("MiniMax M3 图片输入需要有效的图片格式");
        return { type: "base64", media_type: dataUrl[1], data: dataUrl[2] };
    }
    if (/^https?:\/\//i.test(url)) return { type: "url", url };
    throw new Error("MiniMax M3 图片输入需要 data URL 或可公开访问的 HTTP(S) 地址");
}

function textOnly(content: MiniMaxTextMessage["content"]) {
    return Array.isArray(content)
        ? content
              .filter((part): part is Extract<MiniMaxTextContentPart, { type: "text" }> => part.type === "text")
              .map((part) => part.text)
              .join("\n")
        : content;
}

function throwIfAborted(signal?: AbortSignal) {
    if (signal?.aborted) throw signal.reason || new DOMException("请求已取消", "AbortError");
}

async function readMiniMaxError(response: Response) {
    const raw = await response.text();
    try {
        const payload = JSON.parse(raw) as MiniMaxAnthropicResponse & { message?: string };
        return payload.error?.message || payload.base_resp?.status_msg || payload.message || raw || `请求失败 (${response.status})`;
    } catch {
        return raw || `请求失败 (${response.status})`;
    }
}
