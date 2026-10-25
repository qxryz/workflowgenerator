import { flushAppState } from "@/services/app-lifecycle";
import { withWorkspaceActivity } from "@/services/workspace-activity";

type UpdateProgressListener = (received: number, total: number) => void;
let installationPromise: Promise<void> | null = null;
let latestProgress: { received: number; total: number } | null = null;
const progressListeners = new Set<UpdateProgressListener>();

function reportUpdateProgress(listener: UpdateProgressListener, received: number, total: number) {
    try {
        listener(received, total);
    } catch {
        // A UI observer cannot interrupt installation or another observer.
    }
}

export function isDesktopApp() {
    return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function checkDesktopUpdate() {
    if (!isDesktopApp()) return null;
    const { check } = await import("@tauri-apps/plugin-updater");
    return check();
}

export function installDesktopUpdate(update: NonNullable<Awaited<ReturnType<typeof checkDesktopUpdate>>>, onProgress?: UpdateProgressListener): Promise<void> {
    if (onProgress) progressListeners.add(onProgress);
    if (installationPromise) {
        if (onProgress && latestProgress) reportUpdateProgress(onProgress, latestProgress.received, latestProgress.total);
        return installationPromise;
    }
    // Lock synchronously before invoking either updater or UI callbacks.
    installationPromise = Promise.resolve().then(() => withWorkspaceActivity({ id: "desktop-update", title: "软件更新", status: "downloading", route: "/config" }, async setStatus => {
        let received = 0;
        let total = 0;
        await update.downloadAndInstall((event) => {
            if (event.event === "Started") total = event.data.contentLength ?? 0;
            if (event.event === "Progress") received += event.data.chunkLength;
            if (event.event === "Finished") setStatus("running");
            latestProgress = { received, total };
            progressListeners.forEach(listener => reportUpdateProgress(listener, received, total));
        });
        setStatus("saving");
        await flushAppState();
        setStatus("running");
        const { relaunch } = await import("@tauri-apps/plugin-process");
        await relaunch();
    })).finally(() => {
        installationPromise = null;
        latestProgress = null;
        progressListeners.clear();
    });
    return installationPromise;
}
