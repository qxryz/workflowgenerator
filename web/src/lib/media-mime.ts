const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const SUPPORTED_MEDIA_TYPES = new Set([
    ...SUPPORTED_IMAGE_TYPES,
    "video/mp4",
    "video/webm",
    "video/quicktime",
    "audio/mpeg",
    "audio/mp4",
    "audio/x-m4a",
    "audio/wav",
    "audio/x-wav",
    "audio/ogg",
    "audio/flac",
]);

export async function normalizeImageBlob(blob: Blob) {
    const mimeType = normalizedType(blob.type);
    if (SUPPORTED_IMAGE_TYPES.has(mimeType)) return mimeType === blob.type ? blob : blob.slice(0, blob.size, mimeType);
    const detected = await detectMediaMime(blob);
    if (!detected || !SUPPORTED_IMAGE_TYPES.has(detected)) throw new Error("暂不支持这种图片格式");
    return blob.slice(0, blob.size, detected);
}

export async function normalizeMediaBlob(blob: Blob, hint = "") {
    const mimeType = normalizedType(blob.type);
    if (SUPPORTED_MEDIA_TYPES.has(mimeType)) return mimeType === blob.type ? blob : blob.slice(0, blob.size, mimeType);
    let detected = await detectMediaMime(blob);
    if (detected === "video/mp4" && hint.startsWith("audio")) detected = "audio/mp4";
    if (detected && SUPPORTED_MEDIA_TYPES.has(detected)) return blob.slice(0, blob.size, detected);
    const fallback = hint.startsWith("video") ? "video/mp4" : hint.startsWith("audio") ? "audio/mpeg" : "";
    if (!fallback) throw new Error("暂不支持这种媒体格式");
    return blob.slice(0, blob.size, fallback);
}

export function dataUrlToBlob(dataUrl: string) {
    const separator = dataUrl.indexOf(",");
    if (separator < 0) throw new Error("本地媒体内容无效");
    const header = dataUrl.slice(0, separator);
    const mimeType = /^data:([^;,]+)/i.exec(header)?.[1] || "application/octet-stream";
    const payload = dataUrl.slice(separator + 1);
    if (!header.toLowerCase().includes(";base64")) {
        return new Blob([decodeURIComponent(payload)], { type: mimeType });
    }
    const binary = atob(payload);
    const bytes = new Uint8Array(binary.length);
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
    return new Blob([bytes], { type: mimeType });
}

export async function mediaInputToBlob(input: string | Blob) {
    if (input instanceof Blob) return input;
    if (/^data:/i.test(input)) return dataUrlToBlob(input);
    return (await fetch(input)).blob();
}

function normalizedType(value: string) {
    return value.split(";", 1)[0].trim().toLowerCase();
}

async function detectMediaMime(blob: Blob) {
    const bytes = new Uint8Array(await blob.slice(0, 32).arrayBuffer());
    const ascii = (start: number, length: number) => String.fromCharCode(...bytes.slice(start, start + length));
    if (matches(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return "image/png";
    if (matches(bytes, [0xff, 0xd8, 0xff])) return "image/jpeg";
    if (ascii(0, 4) === "GIF8") return "image/gif";
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WEBP") return "image/webp";
    if (ascii(4, 4) === "ftyp" && ["avif", "avis"].includes(ascii(8, 4))) return "image/avif";
    if (ascii(0, 4) === "\u001aEß£") return "video/webm";
    if (ascii(4, 4) === "ftyp") return ascii(8, 4).startsWith("qt") ? "video/quicktime" : "video/mp4";
    if (ascii(0, 4) === "RIFF" && ascii(8, 4) === "WAVE") return "audio/wav";
    if (ascii(0, 4) === "OggS") return "audio/ogg";
    if (ascii(0, 4) === "fLaC") return "audio/flac";
    if (ascii(0, 3) === "ID3" || (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0)) return "audio/mpeg";
    return "";
}

function matches(bytes: Uint8Array, signature: number[]) {
    return signature.every((value, index) => bytes[index] === value);
}
