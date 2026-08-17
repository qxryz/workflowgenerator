const REASONING_TAG = /<(think|thinking|analysis|reasoning)>([\s\S]*?)<\/\1>/gi;
const UNFINISHED_REASONING_TAG = /<(think|thinking|analysis|reasoning)>([\s\S]*)$/i;

/**
 * Keeps the provider's visible working trace separate from the final answer.
 * Protocol payloads remain excluded; the canvas work order is their durable UI.
 */
export function extractZodiacWorkProcess(text: string) {
    if (!text) return "";
    const parts: string[] = [];
    REASONING_TAG.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = REASONING_TAG.exec(text))) {
        const value = normalizeTrace(match[2]);
        if (value) parts.push(value);
    }
    const unfinished = text.match(UNFINISHED_REASONING_TAG);
    if (unfinished && !/<\/(?:think|thinking|analysis|reasoning)>/i.test(unfinished[2])) {
        const value = normalizeTrace(unfinished[2]);
        if (value && !parts.includes(value)) parts.push(value);
    }
    return parts.join("\n\n").slice(0, 48_000);
}

export function stripZodiacReasoning(text: string) {
    REASONING_TAG.lastIndex = 0;
    return text
        .replace(REASONING_TAG, "")
        .replace(UNFINISHED_REASONING_TAG, "")
        .trimStart();
}

function normalizeTrace(value: string) {
    return value
        .replace(/<\/?(?:think|thinking|analysis|reasoning)>/gi, "")
        .replace(/\r\n?/g, "\n")
        .trim();
}
