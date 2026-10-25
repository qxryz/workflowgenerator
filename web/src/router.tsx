import { Suspense } from "react";
import { createBrowserRouter, isRouteErrorResponse, Link, Navigate, Outlet, useRouteError } from "react-router-dom";

import { AnalyticsTracker } from "@/components/layout/analytics-tracker";
import { useAppTranslation } from "@/hooks/use-app-translation";
import UserLayout from "@/layouts/user-layout";
import NotFound from "@/pages/not-found";
import { lazyRoute } from "@/lib/route-module";

const AssetsPage = lazyRoute(() => import("@/pages/assets"));
const AboutAuthorPage = lazyRoute(() => import("@/pages/about-author"));
const CanvasPage = lazyRoute(() => import("@/pages/canvas"));
const ConfigPage = lazyRoute(() => import("@/pages/config"));
const HomePage = lazyRoute(() => import("@/pages/home"));
const WorkbenchPage = lazyRoute(() => import("@/pages/workbench"));
const DirectorPage = lazyRoute(() => import("@/pages/director"));
const PromptsPage = lazyRoute(() => import("@/pages/prompts"));
const ZodiacSessionsPage = lazyRoute(() => import("@/pages/sessions"));
const SkillsPage = lazyRoute(() => import("@/pages/skills"));

function RouteErrorPage() {
    const { t } = useAppTranslation();
    const error = useRouteError();
    const status = isRouteErrorResponse(error) ? error.status : undefined;
    const title = status === 404 ? t("页面不存在") : t("页面暂时无法打开");

    return (
        <main className="flex min-h-screen items-center justify-center bg-background px-6 py-12 text-foreground">
            <section className="w-full max-w-lg rounded-3xl border border-border/70 bg-card/90 p-8 shadow-xl shadow-black/5">
                <div className="mb-6 flex size-11 items-center justify-center rounded-2xl bg-primary text-lg font-semibold text-primary-foreground">WG</div>
                <p className="text-xs font-medium uppercase tracking-[0.18em] text-muted-foreground">WorkflowGenerator</p>
                <h1 className="mt-2 text-2xl font-semibold tracking-tight">{title}</h1>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">{t("页面资源没有完整加载。请重新加载；如果问题持续，可以先返回首页继续工作。")}</p>
                <div className="mt-7 flex flex-wrap gap-3">
                    <button type="button" className="wg-primary-button" onClick={() => window.location.reload()}>{t("重新加载")}</button>
                    <Link className="rounded-lg border border-border px-4 py-2 text-sm font-medium transition hover:bg-muted" to="/">{t("返回首页")}</Link>
                </div>
            </section>
        </main>
    );
}

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
        errorElement: <RouteErrorPage />,
        children: [
            { path: "/", element: <HomePage /> },
            { path: "/assets", element: <AssetsPage /> },
            { path: "/about-author", element: <AboutAuthorPage /> },
            { path: "/workbench", element: <WorkbenchPage /> },
            { path: "/workbench/image", element: <WorkbenchPage /> },
            { path: "/workbench/video", element: <WorkbenchPage /> },
            { path: "/workbench/character", element: <WorkbenchPage /> },
            { path: "/workbench/scene", element: <WorkbenchPage /> },
            { path: "/workbench/audio", element: <WorkbenchPage /> },
            { path: "/workbench/sd25", element: <WorkbenchPage /> },
            { path: "/director", element: <DirectorPage /> },
            { path: "/image", element: <Navigate to="/workbench/image" replace /> },
            { path: "/sessions", element: <ZodiacSessionsPage /> },
            { path: "/skills", element: <SkillsPage /> },
            { path: "/prompts", element: <PromptsPage /> },
            { path: "/video", element: <Navigate to="/workbench/video" replace /> },
            { path: "/audio", element: <Navigate to="/workbench/audio" replace /> },
            { path: "/canvas", element: <CanvasPage /> },
            { path: "/canvas/:id", element: null },
            { path: "/config", element: <ConfigPage /> },
        ],
    },
    { path: "*", element: <NotFound /> },
]);
