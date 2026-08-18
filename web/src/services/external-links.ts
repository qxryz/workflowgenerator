import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "@/services/desktop-storage";

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
    if (!isDesktopApp()) {
        window.open(url.toString(), "_blank", "noopener,noreferrer");
        return;
    }
    try {
        await invoke("plugin:opener|open_url", { url: url.toString() });
    } catch {
        notifyExternalLinkError();
    }
}

export function installDesktopExternalLinkHandler() {
    if (!isDesktopApp()) return () => undefined;

    const handleClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;
        const anchor = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
        if (!anchor?.href || anchor.target.toLowerCase() !== "_blank") return;

        const url = supportedExternalUrl(anchor.href);
        if (!url) return;

        event.preventDefault();
        void openExternalUrl(url.toString());
    };

    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
}
