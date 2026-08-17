import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { useLocation } from "react-router-dom";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { pathname, search, hash } = useLocation();
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const closeAgentPanel = useAgentStore((state) => state.closePanel);
    const isHome = pathname === "/";
    const projectOpen = /^\/canvas\/[^/]+/.test(pathname);
    const isWorkflow = pathname === "/canvas" || projectOpen;

    useEffect(() => {
        if (!isWorkflow) closeAgentPanel();
    }, [closeAgentPanel, isWorkflow, pathname]);

    useEffect(() => {
        if (!isWorkflow) return;
        try {
            window.sessionStorage.setItem("wg-last-workflow-route", `${pathname}${search}${hash}`);
        } catch {
            // A direct return to the workflow list remains available when session storage is unavailable.
        }
    }, [hash, isWorkflow, pathname, search]);

    return (
        <div className="flex h-dvh overflow-hidden bg-background text-foreground">
            <a href="#main-content" className="fixed left-4 top-3 z-50 -translate-y-20 rounded-lg bg-[color:var(--wg-home-accent)] px-4 py-2 text-sm font-semibold text-[color:var(--wg-home-accent-text)] transition focus:translate-y-0">
                跳到主要内容
            </a>
            <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                <AppTopNav />
                <div className="flex min-h-0 flex-1 overflow-hidden">
                    <div id="main-content" tabIndex={-1} className={cn("min-w-0 flex-1 overflow-hidden outline-none", !isHome && !projectOpen && "wg-celestial-shell")}>
                        <div className="h-full min-h-0">{children}</div>
                    </div>
                </div>
            </div>
            {panelMounted ? (
                <Suspense fallback={null}>
                    <AgentPanel />
                </Suspense>
            ) : null}
        </div>
    );
}
