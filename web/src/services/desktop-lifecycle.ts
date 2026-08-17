import { flushDesktopWrites, isDesktopApp } from "@/services/desktop-storage";

type DesktopFlusher = () => void | Promise<void>;

const flushers = new Set<DesktopFlusher>();

export function registerDesktopFlusher(flusher: DesktopFlusher) {
    flushers.add(flusher);
    return () => {
        flushers.delete(flusher);
    };
}

export async function flushDesktopState() {
    const results = await Promise.allSettled(Array.from(flushers, (flusher) => Promise.resolve().then(flusher)));
    await flushDesktopWrites();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
}

export function installDesktopCloseGuard() {
    if (!isDesktopApp()) return () => undefined;
    let disposed = false;
    let closing = false;
    let removeListener: (() => void) | undefined;
    const install = async () => {
        try {
            const { getCurrentWindow } = await import("@tauri-apps/api/window");
            if (disposed) return;
            const appWindow = getCurrentWindow();
            const unlisten = await appWindow.onCloseRequested(async (event) => {
                // Every close request must be held while the first one is saving.
                // Otherwise a second click can bypass the async flush.
                event.preventDefault();
                if (closing) return;
                closing = true;
                try {
                    await flushDesktopState();
                    await appWindow.destroy();
                } catch (error) {
                    closing = false;
                    console.error("Failed to persist desktop state before closing.", error);
                    globalThis.window.dispatchEvent(new CustomEvent("workflowgenerator:save-error"));
                }
            });
            if (disposed) unlisten();
            else removeListener = unlisten;
        } catch (error) {
            if (!disposed) console.error("Failed to install the desktop close guard.", error);
        }
    };
    void install();
    return () => {
        disposed = true;
        removeListener?.();
        removeListener = undefined;
    };
}
