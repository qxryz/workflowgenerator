import { flushPendingWrites, completeDesktopClose } from "@/services/server-storage";

type Flusher = () => void | Promise<void>;

const flushers = new Set<Flusher>();

export function registerStateFlusher(flusher: Flusher) {
    flushers.add(flusher);
    return () => {
        flushers.delete(flusher);
    };
}

export async function flushAppState() {
    const results = await Promise.allSettled(Array.from(flushers, (flusher) => Promise.resolve().then(flusher)));
    await flushPendingWrites();
    const failed = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
    if (failed) throw failed.reason;
}

/** Desktop close waits for durable writes; visibility/pagehide also flush browser development sessions. */
export function installUnloadFlushGuard() {
    if (typeof window === "undefined") return () => undefined;

    let flushed = false;
    const flushOnce = () => {
        if (flushed) return;
        flushed = true;
        void flushAppState().catch((error) => {
            console.error("Failed to persist app state before unload.", error);
            window.dispatchEvent(new CustomEvent("workflowgenerator:save-error"));
        });
    };

    const onVisibilityChange = () => {
        if (document.visibilityState === "hidden") flushOnce();
        else flushed = false;
    };
    const onPageHide = () => flushOnce();
    let closing = false;
    const onDesktopClose = async (event: Event) => {
        event.preventDefault();
        if (closing) return;
        closing = true;
        try { await flushAppState(); await completeDesktopClose(); }
        catch (error) { closing = false; console.error("保存未完成", error); window.dispatchEvent(new CustomEvent("workflowgenerator:save-error")); }
    };
    window.addEventListener("workflowgenerator:desktop-close", onDesktopClose);

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("pagehide", onPageHide);
    return () => {
        document.removeEventListener("visibilitychange", onVisibilityChange);
        window.removeEventListener("pagehide", onPageHide);
        window.removeEventListener("workflowgenerator:desktop-close", onDesktopClose);
    };
}
