export const DESKTOP_EXTERNAL_LINK_ERROR_EVENT = "workflowgenerator:external-link-error";

const SUPPORTED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

function supportedExternalUrl(value: string) {
    try {
        const url = new URL(value);
        return SUPPORTED_EXTERNAL_PROTOCOLS.has(url.protocol) ? url : null;
    } catch {
        return null;
    }
}

function notifyExternalLinkError() {
    window.dispatchEvent(new Event(DESKTOP_EXTERNAL_LINK_ERROR_EVENT));
}

export async function openExternalUrl(value: string) {
    const url = supportedExternalUrl(value);
    if (!url) {
        notifyExternalLinkError();
        return;
    }
    if ("__TAURI_INTERNALS__" in window) {
        try {
            const { invoke } = await import("@tauri-apps/api/core");
            await invoke("open_external_url", { url: url.toString() });
        } catch {
            notifyExternalLinkError();
        }
        return;
    }
    window.open(url.toString(), "_blank", "noopener,noreferrer");
}

/**
 * The desktop build intercepted `target="_blank"` clicks and routed them
 * through the OS opener, because the embedded WebView would otherwise navigate
 * itself away from the app. A normal browser opens a new tab for those anchors
 * on its own, so there is nothing left to install.
 */
export function installDesktopExternalLinkHandler() {
    return () => undefined;
}
