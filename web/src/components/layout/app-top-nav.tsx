import { lazy, Suspense, useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { Clapperboard, Compass, Folder, MessageSquare, NotebookPen, PanelsTopLeft, Shapes, UserRound, Workflow } from "lucide-react";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { BrandMark } from "@/components/layout/brand-mark";
import { DesktopUpdateWatcher } from "@/components/layout/desktop-update-watcher";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { cn } from "@/lib/utils";
import { openExternalUrl } from "@/services/external-links";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then((module) => ({ default: module.AppConfigModal })));
const EXPLORE_URL = "https://web.zhouzhou.dev";
const destinations = [
    { label: "工作流", path: "/canvas", icon: Workflow },
    { label: "工作台", path: "/workbench", icon: PanelsTopLeft },
    { label: "导演台", path: "/director", icon: Clapperboard },
    { label: "Skills", path: "/skills", icon: Shapes },
    { label: "提示词", path: "/prompts", icon: NotebookPen },
    { label: "资产", path: "/assets", icon: Folder },
    { label: "对话", path: "/sessions", icon: MessageSquare },
];

function playfulMenuItems(t: (message: string) => string): MenuProps["items"] {
    return [{ key: "about-author", label: t("说了别点"), icon: <UserRound className="size-4" strokeWidth={1.7} /> }, { type: "divider" }, { key: "explore", label: t("探索"), icon: <Compass className="size-4" strokeWidth={1.7} /> }];
}

export function AppTopNav() {
    const { t } = useAppTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const smoothNavigate = useSmoothNavigation();
    const [playfulMenuOpen, setPlayfulMenuOpen] = useState(false);
    const reduceMotion = useReducedMotion();
    const configOpen = useConfigStore((state) => state.isConfigOpen);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);

    return (
        <>
            <DesktopUpdateWatcher />
            {!hideHeader ? (
                <header className="wg-app-header">
                    <div className="wg-app-header-inner">
                        <button
                            type="button"
                            onClick={() =>
                                void smoothNavigate("/", {
                                    direction: "return-home",
                                    preload: () => import("@/pages/home"),
                                    onCommit: () =>
                                        setAgentState({
                                            panelOpen: false,
                                            panelMounted: false,
                                            panelClosing: false,
                                        }),
                                })
                            }
                            className="wg-brand-link"
                            aria-label={t("返回首页")}
                        >
                            <BrandMark className="size-7 shadow-none" />
                            <span className="wg-ascii-label hidden text-[12px] font-semibold lg:inline">WG</span>
                        </button>

                        <LayoutGroup id="workspace-navigation">
                            <nav id="app-primary-navigation" className="wg-primary-navigation thin-scrollbar" aria-label={t("工作区")}>
                                {destinations.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <NavLink key={item.path} to={item.path} title={t(item.label)} aria-label={t(item.label)} className={({ isActive }) => cn("wg-nav-item", isActive && "is-active")}>
                                            {({ isActive }) => (
                                                <>
                                                    {isActive ? <motion.span className="wg-nav-selection" layoutId="selected-tab" transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 430, damping: 36 }} /> : null}
                                                    <Icon className="relative size-4 shrink-0" strokeWidth={1.6} />
                                                    <span className="wg-nav-label relative">{t(item.label)}</span>
                                                </>
                                            )}
                                        </NavLink>
                                    );
                                })}
                            </nav>
                        </LayoutGroup>

                        <div className="wg-app-header-actions">
                            <Dropdown
                                trigger={["click"]}
                                placement="bottomRight"
                                open={playfulMenuOpen}
                                onOpenChange={setPlayfulMenuOpen}
                                menu={{
                                    items: playfulMenuItems(t),
                                    onClick: ({ key }) => {
                                        setPlayfulMenuOpen(false);
                                        if (key === "about-author") {
                                            navigate("/about-author");
                                            return;
                                        }
                                        if (key === "explore") {
                                            void openExternalUrl(EXPLORE_URL);
                                        }
                                    },
                                }}
                                styles={{ root: { minWidth: 220 } }}
                            >
                                <button type="button" title={t("别点我")} aria-label={t("别点我")} className="wg-icon-button" data-active={pathname === "/about-author" || playfulMenuOpen || undefined} aria-haspopup="menu" aria-expanded={playfulMenuOpen}>
                                    <UserRound className="size-4 shrink-0" strokeWidth={1.7} />
                                </button>
                            </Dropdown>
                            <UserStatusActions />
                        </div>
                    </div>
                </header>
            ) : null}

            {configOpen ? (
                <Suspense fallback={null}>
                    <AppConfigModal />
                </Suspense>
            ) : null}
        </>
    );
}
