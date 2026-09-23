import { lazy, Suspense, useEffect, useLayoutEffect, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import "@/styles/workspace-interface.css";

import { AppTopNav } from "@/components/layout/app-top-nav";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { WorkspaceStatusBar } from "@/components/agent/workspace-status-bar";
import { retainedZodiacWorkspaces } from "@/lib/agent/zodiac-workspace-lifetime";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/stores/use-agent-store";

const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const AgentPanel = lazy(() => import("@/components/agent/agent-panel").then((module) => ({ default: module.AgentPanel })));

export default function UserLayout({ children }: { children: ReactNode }) {
    const { t } = useAppTranslation();
    const { pathname, search, hash } = useLocation();
    const selectedProjectId = useAgentStore((state) => state.selectedProjectId);
    const work = useAgentStore((state) => state.work);
    const routeProjectId = /^\/canvas\/([^/]+)/.exec(pathname)?.[1];
    const activeProjectId = routeProjectId ? decodeURIComponent(routeProjectId) : null;
    const [retainedProjects, setRetainedProjects] = useState<string[]>([]);
    const displayedProjects = [...new Set([...retainedProjects, ...(activeProjectId ? [activeProjectId] : [])])];
    useLayoutEffect(() => {
        if (activeProjectId) {
            const state = useAgentStore.getState();
            state.setAgentState({ selectedProjectId: activeProjectId, canvasContext: state.contexts[activeProjectId] || null });
        }
        const selected = activeProjectId || selectedProjectId;
        setRetainedProjects((current) => {
            const next = retainedZodiacWorkspaces(current, selected, work);
            return next.join() === current.join() ? current : next;
        });
    }, [activeProjectId, selectedProjectId, work]);
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
        <div className="wg-workspace flex h-dvh flex-col overflow-hidden bg-background text-foreground">
            <a href="#main-content" className="fixed left-4 top-3 z-50 -translate-y-20 rounded-lg bg-[color:var(--wg-home-accent)] px-4 py-2 text-sm font-semibold text-[color:var(--wg-home-accent-text)] transition focus:translate-y-0">
                {t("跳到主要内容")}
            </a>
            <div className="flex min-h-0 flex-1 overflow-hidden">
                <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
                    <AppTopNav />
                    <div className="flex min-h-0 flex-1 overflow-hidden">
                        <div id="main-content" tabIndex={-1} className={cn("min-w-0 flex-1 overflow-hidden outline-none", !isHome && !projectOpen && "wg-workspace-content")}>
                            <div className="h-full min-h-0" style={{ display: projectOpen ? "none" : undefined }}>
                                {children}
                            </div>
                            {displayedProjects.map((id) => (
                                <div key={id} className="h-full min-h-0" style={{ display: id === activeProjectId ? "block" : "none" }}>
                                    <Suspense fallback={null}>
                                        <CanvasProjectPage projectId={id} active={id === activeProjectId} />
                                    </Suspense>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
                {displayedProjects.length ? (
                    <Suspense fallback={null}>
                        <AgentPanel />
                    </Suspense>
                ) : null}
            </div>
            <WorkspaceStatusBar />
        </div>
    );
}
