/** Decode a saved, same-origin video and capture its final decodable frame. */
export async function captureVideoLastFrame(url: string, signal?: AbortSignal): Promise<Blob> {
    const source = new URL(url, window.location.href);
    if (source.origin !== window.location.origin || !source.pathname.startsWith("/media/")) {
        throw new Error("只能从已保存到本机的画布视频提取画面");
    }
    signal?.throwIfAborted();
    const video = document.createElement("video");
    video.crossOrigin = "anonymous";
    video.preload = "auto";
    video.muted = true;
    video.playsInline = true;
    const waitFor = (event: "loadedmetadata" | "loadeddata" | "seeked") => new Promise<void>((resolve, reject) => {
        const cleanup = () => {
            video.removeEventListener(event, done);
            video.removeEventListener("error", failed);
            signal?.removeEventListener("abort", aborted);
            window.clearTimeout(timer);
        };
        const done = () => { cleanup(); resolve(); };
        const failed = () => { cleanup(); reject(new Error("视频无法解码，请检查源文件")); };
        const aborted = () => { cleanup(); reject(new DOMException("Aborted", "AbortError")); };
        const timer = window.setTimeout(() => { cleanup(); reject(new Error("读取视频画面超时")); }, 30000);
        video.addEventListener(event, done, { once: true });
        video.addEventListener("error", failed, { once: true });
        signal?.addEventListener("abort", aborted, { once: true });
        if (signal?.aborted) aborted();
    });
    try {
        const metadata = waitFor("loadedmetadata");
        video.src = source.href;
        video.load();
        await metadata;
        if (!Number.isFinite(video.duration) || video.duration <= 0 || !video.videoWidth || !video.videoHeight) {
            throw new Error("视频时长或画面尺寸无效，无法提取尾帧");
        }
        const target = Math.max(0, video.duration - 0.001);
        if (target > 0) {
            const seeked = waitFor("seeked");
            video.currentTime = target;
            await seeked;
        }
        if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) await waitFor("loadeddata");
        signal?.throwIfAborted();
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("无法创建画面缓冲区");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("尾帧编码失败")), "image/png"));
        signal?.throwIfAborted();
        return blob;
    } finally {
        video.removeAttribute("src");
        video.load();
    }
}
