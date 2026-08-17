import { invoke } from "@tauri-apps/api/core";

import { readResponseBytes, readResponseText } from "@/lib/limited-response";
import { isDesktopApp } from "@/services/desktop-storage";

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

export async function verifyPublisherPayload(bytes: Uint8Array, signature: string) {
    if (!isDesktopApp()) throw new Error("发布签名只能由桌面应用校验");
    const valid = await invoke<boolean>("native_verify_publisher_signature", {
        payloadBase64: bytesToBase64(bytes),
        signature,
    });
    if (!valid) throw new Error("发布签名校验失败");
}

export async function fetchSignedPublisherText(url: string, maxBytes: number, tooLargeMessage: string, timeoutMs = 10_000) {
    const controller = new AbortController();
    const timeout = globalThis.setTimeout(() => controller.abort(), timeoutMs);
    try {
        const [payloadResponse, signatureResponse] = await Promise.all([
            fetch(url, { cache: "no-store", redirect: "error", signal: controller.signal }),
            fetch(signatureUrl(url), { cache: "no-store", redirect: "error", signal: controller.signal }),
        ]);
        if (!payloadResponse.ok) throw new Error(`请求失败（${payloadResponse.status}）`);
        if (!signatureResponse.ok) throw new Error("发布签名不存在");
        const [bytes, signature] = await Promise.all([
            readResponseBytes(payloadResponse, maxBytes, tooLargeMessage, timeoutMs),
            readResponseText(signatureResponse, MAX_SIGNATURE_BYTES, "发布签名文件过大", timeoutMs),
        ]);
        await verifyPublisherPayload(bytes, signature);
        return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch (error) {
        if (error instanceof DOMException && error.name === "AbortError") throw new Error("请求超时");
        throw error;
    } finally {
        globalThis.clearTimeout(timeout);
    }
}
