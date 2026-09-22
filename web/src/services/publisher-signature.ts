import { readResponseBytes, readResponseText } from "@/lib/limited-response";

const MAX_SIGNATURE_BYTES = 16 * 1024;

function signatureUrl(value: string) {
    const url = new URL(value);
    url.pathname += ".sig";
    return url.toString();
}

function bytesToBase64(bytes: Uint8Array) {
    let binary = "";
    for (let offset = 0; offset < bytes.byteLength; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
}

/**
 * Verifies a publisher payload against the project's minisign public key.
 *
 * The check runs on the server rather than in the browser. WebCrypto has no
 * minisign verify, and Ed25519 is still missing from `crypto.subtle` on several
 * engines the app targets, so a browser-side implementation would mean shipping
 * a WASM verifier. The server already links `minisign-verify`, so the trust
 * model is unchanged — only where it runs moved.
 */
export async function verifyPublisherPayload(bytes: Uint8Array, signature: string) {
    const response = await fetch("/api/publisher/verify", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ payloadBase64: bytesToBase64(bytes), signature }),
    });
    if (!response.ok) throw new Error((await response.text()).trim() || "发布签名校验失败");
    const result = (await response.json()) as { valid?: boolean };
    if (!result.valid) throw new Error("发布签名校验失败");
}

export async function fetchSignedPublisherText(url: string, maxBytes: number, tooLargeMessage: string, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const [payloadResponse, signatureResponse] = await Promise.all([fetch(url, { cache: "no-store", redirect: "error", signal: controller.signal }), fetch(signatureUrl(url), { cache: "no-store", redirect: "error", signal: controller.signal })]);
        if (!payloadResponse.ok) throw new Error(`请求失败（${payloadResponse.status}）`);
        if (!signatureResponse.ok) throw new Error("发布签名不存在");
        const [bytes, signature] = await Promise.all([readResponseBytes(payloadResponse, maxBytes, tooLargeMessage, timeoutMs), readResponseText(signatureResponse, MAX_SIGNATURE_BYTES, "发布签名文件过大", timeoutMs)]);
        await verifyPublisherPayload(bytes, signature);
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}
