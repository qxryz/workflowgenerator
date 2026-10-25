import { lazy, type ComponentType, type LazyExoticComponent } from "react";

const RECOVERY_KEY = "workflowgenerator:route-module-recovery";
const RECOVERY_WINDOW_MS = 20_000;

function isModuleLoadError(error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return /mime type|dynamically imported module|importing a module script|failed to fetch/i.test(message);
}

async function loadWithRecovery<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>) {
    try {
        const module = await loader();
        try {
            window.sessionStorage.removeItem(RECOVERY_KEY);
        } catch {
            // Storage may be unavailable in an embedded or privacy-restricted webview.
        }
        return module;
    } catch (error) {
        if (typeof window !== "undefined" && isModuleLoadError(error)) {
            try {
                const previous = Number(window.sessionStorage.getItem(RECOVERY_KEY) || 0);
                const isFreshRecovery = previous > 0 && Date.now() - previous < RECOVERY_WINDOW_MS;
                if (!isFreshRecovery) {
                    window.sessionStorage.setItem(RECOVERY_KEY, String(Date.now()));
                    window.location.reload();
                    return new Promise<{ default: T }>(() => undefined);
                }
            } catch {
                // Fall through to the route error screen when recovery is unavailable.
            }
        }
        throw error;
    }
}

/** Load a route module and recover once from a stale desktop asset manifest. */
export function lazyRoute<T extends ComponentType<any>>(loader: () => Promise<{ default: T }>): LazyExoticComponent<T> {
    return lazy(() => loadWithRecovery(loader));
}
