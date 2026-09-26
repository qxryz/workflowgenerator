import { saveAs } from "file-saver";

import { isDesktopApp } from "@/services/desktop-updater";

/** Resolve only after the desktop has written the whole file to Downloads. */
export async function downloadFile(blob: Blob, filename: string): Promise<string> {
    if (!blob.size) throw new Error("文件内容为空");
    if (!isDesktopApp()) {
        saveAs(blob, filename);
        return filename;
    }
    let response: Response;
    try {
        response = await fetch(`/api/desktop/download?filename=${encodeURIComponent(filename)}`, {
            method: "POST",
            body: blob,
            credentials: "same-origin",
        });
    } catch (error) {
        throw new Error(error instanceof Error ? `无法连接下载服务：${error.message}` : "无法连接下载服务");
    }
    const result = await response.json().catch(() => null) as { fileName?: string; error?: string } | null;
    if (!response.ok || !result?.fileName) throw new Error(result?.error || `保存文件失败（${response.status}）`);
    return result.fileName;
}
