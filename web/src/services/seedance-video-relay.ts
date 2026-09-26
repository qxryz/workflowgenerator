import { getMediaBlob } from "@/services/file-storage";
import type { AiConfig } from "@/stores/use-config-store";
import type { ReferenceVideo } from "@/types/media";

const MAX_VIDEO_BYTES = 200 * 1024 * 1024;
const OFFICIAL_RELAY_BASE = "https://wg.coco120.cn/seedance-media";

/** Seedance accepts a public video URL, but not a local URL or video Base64. */
export async function publishSeedanceReferenceVideo(config: AiConfig, video: ReferenceVideo, signal?: AbortSignal): Promise<string> {
    const custom = config.seedanceVideoRelayMode === "custom";
    const base = custom ? config.seedanceVideoRelayUrl?.trim().replace(/\/+$/, "") || "" : OFFICIAL_RELAY_BASE;
    const token = custom ? config.seedanceVideoRelayToken?.trim() || "" : "";
    if (!base || (custom && !token)) throw new Error("请在“本地与网络”填写自定义视频服务器的地址和上传凭证");
    let endpoint: URL;
    try {
        endpoint = new URL(`${base}/v1/${custom ? "upload" : "public-upload"}`);
    } catch {
        throw new Error("视频中转地址无效，请填写 HTTPS 地址");
    }
    if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password || endpoint.search || endpoint.hash) {
        throw new Error("视频中转地址必须是 HTTPS 地址，且不能带用户名、密码或查询参数");
    }
    const blob = (video.storageKey ? await getMediaBlob(video.storageKey) : null) || (video.url ? await (await fetch(video.url, { signal })).blob() : null);
    if (!blob) throw new Error(`本机参考视频“${video.name}”读取失败，请重新添加`);
    if (blob.size > MAX_VIDEO_BYTES) throw new Error(`本机参考视频“${video.name}”超过 200MB`);
    const mimeType = video.type === "video/quicktime" || blob.type === "video/quicktime" ? "video/quicktime" : "video/mp4";
    const response = await fetch(endpoint, {
        method: "PUT",
        headers: { ...(custom ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": mimeType },
        body: blob,
        signal,
    });
    if (!response.ok) {
        const reason = response.status === 429 ? "上传次数已达上限" : response.status === 507 ? "服务器存储空间不足" : response.status === 503 ? "服务器繁忙" : "请检查所选视频服务器";
        throw new Error(`参考视频上传失败（${response.status}）：${reason}`);
    }
    const payload = await response.json() as { url?: string };
    const url = payload.url || "";
    if (!url.startsWith(`${base}/v1/media/`) || !/^https:\/\//i.test(url)) {
        throw new Error("视频中转没有返回可信的公网视频地址");
    }
    return url;
}
