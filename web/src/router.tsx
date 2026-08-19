import { lazy, Suspense } from "react";
import { createBrowserRouter, Navigate, Outlet } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useAppTranslation } from "@/hooks/use-app-translation";
import UserLayout from "@/layouts/user-layout";
import NotFound from "@/pages/not-found";

const AssetsPage = lazy(() => import("@/pages/assets"));
const AboutAuthorPage = lazy(() => import("@/pages/about-author"));
const CanvasPage = lazy(() => import("@/pages/canvas"));
const CanvasProjectPage = lazy(() => import("@/pages/canvas/project"));
const ConfigPage = lazy(() => import("@/pages/config"));
const HomePage = lazy(() => import("@/pages/home"));
const WorkbenchPage = lazy(() => import("@/pages/workbench"));
const DirectorPage = lazy(() => import("@/pages/director"));
const DocsPage = lazy(() => import("@/pages/model-adaptations"));
const DshLauncherPage = lazy(() => import("@/pages/dsh"));
const PromptsPage = lazy(() => import("@/pages/prompts"));
const ZodiacSessionsPage = lazy(() => import("@/pages/sessions"));
const SkillsPage = lazy(() => import("@/pages/skills"));

function RouteOutlet() {
    const { t } = useAppTranslation();
    return (
        <Suspense
            fallback={
                <div className="flex h-full items-center justify-center" role="status" aria-live="polite">
                    <span className="size-5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-60" />
                    <span className="sr-only">{t("正在打开")}</span>
                </div>
            }
        >
            <Outlet />
        </Suspense>
    );
}

export const router = createBrowserRouter([
    {
        element: (
            <UserLayout>
                <AnalyticsTracker />
                <RouteOutlet />
            </UserLayout>
        ),
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/about-author", element: <AboutAuthorPage /> },
            { path: "/workbench", element: <WorkbenchPage /> },
            { path: "/workbench/image", element: <WorkbenchPage /> },
            { path: "/workbench/video", element: <WorkbenchPage /> },
            { path: "/workbench/audio", element: <WorkbenchPage /> },
            { path: "/workbench/sd25", element: <WorkbenchPage /> },
            { path: "/director", element: <DirectorPage /> },
            { path: "/image", element: <Navigate to="/workbench/image" replace /> },
            { path: "/docs", element: <DocsPage /> },
            { path: "/dsh", element: <DshLauncherPage /> },
            { path: "/model-adaptations", element: <DocsPage /> },
            { path: "/sessions", element: <ZodiacSessionsPage /> },
            { path: "/skills", element: <SkillsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/video", element: <Navigate to="/workbench/video" replace /> },
            { path: "/audio", element: <Navigate to="/workbench/audio" replace /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: <CanvasProjectPage /> },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
