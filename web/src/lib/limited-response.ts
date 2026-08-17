export async function readResponseBytes(response: Response, maxBytes: number, tooLargeMessage = "下载内容过大", timeoutMs = 120_000) {
    const declaredLength = Number(response.headers.get("content-length") || 0);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) throw new Error(tooLargeMessage);
    if (!response.body) return new Uint8Array();

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    let timer: ReturnType<typeof globalThis.setTimeout> | undefined;
    const deadline = new Promise<never>((_, reject) => {
        timer = globalThis.setTimeout(() => reject(new Error("读取下载内容超时")), timeoutMs);
    });
    try {
        for (;;) {
            const next = await Promise.race([reader.read(), deadline]);
            if (next.done) break;
            total += next.value.byteLength;
            if (total > maxBytes) {
                await reader.cancel(tooLargeMessage).catch(() => undefined);
                throw new Error(tooLargeMessage);
            }
            chunks.push(next.value);
        }
    } catch (error) {
        await reader.cancel(error).catch(() => undefined);
        throw error;
    } finally {
        if (timer) globalThis.clearTimeout(timer);
        reader.releaseLock();
    }

    const result = new Uint8Array(total);
    let offset = 0;
    chunks.forEach((chunk) => {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    });
    return result;
}

export async function readResponseText(response: Response, maxBytes: number, tooLargeMessage?: string, timeoutMs?: number) {
    return new TextDecoder("utf-8", { fatal: true }).decode(await readResponseBytes(response, maxBytes, tooLargeMessage, timeoutMs));
}
