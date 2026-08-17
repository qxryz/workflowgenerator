import { invoke } from "@tauri-apps/api/core";

import { isDesktopApp } from "@/services/desktop-storage";

export const DESKTOP_EXTERNAL_LINK_ERROR_EVENT = "workflowgenerator:external-link-error";

const SUPPORTED_EXTERNAL_PROTOCOLS = new Set(["http:", "https:", "mailto:", "tel:"]);

export function installDesktopExternalLinkHandler() {
    if (!isDesktopApp()) return () => undefined;

    const handleClick = (event: MouseEvent) => {
        if (event.defaultPrevented || event.button !== 0) return;
        const anchor = event.composedPath().find((target): target is HTMLAnchorElement => target instanceof HTMLAnchorElement);
        if (!anchor?.href || anchor.target.toLowerCase() !== "_blank") return;

        let url: URL;
        try {
            url = new URL(anchor.href);
        } catch {
            return;
        }
        if (!SUPPORTED_EXTERNAL_PROTOCOLS.has(url.protocol)) return;

        event.preventDefault();
        void invoke("plugin:opener|open_url", { url: url.toString() }).catch(() => {
            window.dispatchEvent(new Event(DESKTOP_EXTERNAL_LINK_ERROR_EVENT));
        });
    };

    window.addEventListener("click", handleClick, true);
    return () => window.removeEventListener("click", handleClick, true);
}
