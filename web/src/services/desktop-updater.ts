import { flushAppState } from "@/services/app-lifecycle";

export function isDesktopApp() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkDesktopUpdate() {
    if (!isDesktopApp()) return null;
    const { check } = await import("@tauri-apps/plugin-updater");
    return check();
}

export async function installDesktopUpdate(update: NonNullable<Awaited<ReturnType<typeof checkDesktopUpdate>>>, onProgress?: (received: number, total: number) => void) {
    let received = 0;
    let total = 0;
    await update.downloadAndInstall((event) => {
        if (event.event === "Started") total = event.data.contentLength ?? 0;
        if (event.event === "Progress") received += event.data.chunkLength;
        onProgress?.(received, total);
    });
    await flushAppState();
    const { relaunch } = await import("@tauri-apps/plugin-process");
    await relaunch();
}
