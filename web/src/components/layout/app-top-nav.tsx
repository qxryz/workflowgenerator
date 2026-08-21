import { lazy, Suspense, useState } from "react";
import { Dropdown, type MenuProps } from "antd";
import { BubbleChatIcon, FolderLibraryIcon, MagicWand03Icon, Note01Icon, WorkflowSquare01Icon } from "hugeicons-react";
import { ChevronDown, Clapperboard, Clock, Compass, FileText, PanelsTopLeft, UserRound } from "lucide-react";
import { NavLink, useLocation, useNavigate } from "react-router-dom";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { BrandMark } from "@/components/layout/brand-mark";
import { UserStatusActions } from "@/components/layout/user-status-actions";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { cn } from "@/lib/utils";
import { isDesktopApp } from "@/services/desktop-storage";
import { openExternalUrl } from "@/services/external-links";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

const AppConfigModal = lazy(() => import("@/components/layout/app-config-modal").then((module) => ({ default: module.AppConfigModal })));
const EXPLORE_URL = "https://web.zhouzhou.dev";
const destinations = [
    { label: "工作流", path: "/canvas", icon: WorkflowSquare01Icon },
    { label: "工作台", path: "/workbench", icon: PanelsTopLeft },
    { label: "导演台", path: "/director", icon: Clapperboard },
    { label: "Skills", path: "/skills", icon: MagicWand03Icon },
    { label: "提示词", path: "/prompts", icon: Note01Icon },
    { label: "资产", path: "/assets", icon: FolderLibraryIcon },
    { label: "会话", path: "/sessions", icon: BubbleChatIcon },
    { label: "文档", path: "/docs", icon: FileText },
];

function playfulMenuItems(desktop: boolean, t: (message: string) => string): MenuProps["items"] {
    const items: NonNullable<MenuProps["items"]> = [{ key: "about-author", label: t("说了别点"), icon: <UserRound className="size-4" strokeWidth={1.7} /> }];
    if (desktop) {
        items.push({ type: "divider" }, { key: "upcoming", label: "...", icon: <Clock className="size-4" strokeWidth={1.7} />, disabled: true });
    }
    items.push({ type: "divider" }, { key: "explore", label: t("探索"), icon: <Compass className="size-4" strokeWidth={1.7} /> });
    return items;
}

function navItemClass(active: boolean) {
    return cn(
        "wg-sketch-button-quiet group relative inline-flex h-8 shrink-0 cursor-pointer items-center justify-center gap-1.5 px-2 text-[12px] font-medium text-[color:var(--wg-home-muted)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--wg-home-accent)]",
        active &&
            "wg-hatched border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-home-hover)] font-semibold text-[color:var(--wg-home-text)] after:absolute after:-bottom-[7px] after:left-2 after:right-2 after:h-px after:bg-[color:var(--wg-home-accent)] after:content-['']",
    );
}

export function AppTopNav() {
    const { t } = useAppTranslation();
    const { pathname } = useLocation();
    const navigate = useNavigate();
    const smoothNavigate = useSmoothNavigation();
    const [playfulMenuOpen, setPlayfulMenuOpen] = useState(false);
    const desktopApp = isDesktopApp();
    const isHome = pathname === "/";
    const configOpen = useConfigStore((state) => state.isConfigOpen);
    const togglePanel = useAgentStore((state) => state.togglePanel);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const setAgentState = useAgentStore((state) => state.setAgentState);
    const hideHeader = /^\/canvas\/[^/]+/.test(pathname);

    return (
        <>
            {!hideHeader ? (
                <header
                    className={cn(
                        "z-30 h-[52px] shrink-0 border-b text-[color:var(--wg-home-text)]",
                        isHome ? "absolute inset-x-0 top-0 border-transparent bg-transparent" : "wg-paper-surface border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-home-bg)]",
                    )}
                >
                    <div className="flex h-full w-full items-center gap-2 px-3">
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
                            className="wg-sketch-button-quiet inline-flex h-9 shrink-0 cursor-pointer items-center gap-2.5 px-1.5"
                            aria-label={t("返回首页")}
                        >
                            <BrandMark className="size-7 shadow-none" />
                            <span className="wg-ascii-label hidden text-[12px] font-semibold lg:inline">WG</span>
                        </button>

                        {!isHome ? (
                            <nav id="app-primary-navigation" className="hidden min-w-0 flex-1 items-center justify-center gap-0.5 border-l border-dashed border-[color:var(--wg-pencil-soft)] pl-2 sm:flex" aria-label={t("工作区")}>
                                {destinations.map((item) => {
                                    const Icon = item.icon;
                                    return (
                                        <NavLink key={item.path} to={item.path} title={t(item.label)} className={({ isActive }) => navItemClass(isActive || (item.path === "/docs" && pathname === "/model-adaptations"))}>
                                            <Icon className="size-4 shrink-0" strokeWidth={1.7} />
                                            <span className="hidden xl:inline">{t(item.label)}</span>
                                        </NavLink>
                                    );
                                })}
                                <Dropdown
                                    trigger={["click"]}
                                    placement="bottomRight"
                                    open={playfulMenuOpen}
                                    onOpenChange={setPlayfulMenuOpen}
                                    menu={{
                                        items: playfulMenuItems(desktopApp, t),
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
                                    <button type="button" title={t("别点我")} className={cn(navItemClass(pathname === "/about-author"), "wg-playful-nav")} aria-haspopup="menu" aria-expanded={playfulMenuOpen}>
                                        <UserRound className="size-4 shrink-0" strokeWidth={1.7} />
                                        <span className="hidden text-[11px] xl:inline">{t("别点我")}</span>
                                        <ChevronDown className={cn("hidden size-3 shrink-0 transition-transform xl:block", playfulMenuOpen && "rotate-180")} strokeWidth={1.7} />
                                    </button>
                                </Dropdown>
                            </nav>
                        ) : null}

                        <div className={cn("ml-auto flex shrink-0 items-center gap-1", !isHome && "border-l border-dashed border-[color:var(--wg-pencil-soft)] pl-2")}>
                            {!isHome ? (
                                <button
                                    type="button"
                                    className={cn(
                                        "wg-sketch-button-quiet inline-flex h-9 cursor-pointer items-center gap-2 px-3 text-[12px] font-semibold",
                                        panelOpen ? "bg-[color:var(--wg-home-accent)] text-[color:var(--wg-home-accent-text)]" : "text-[color:var(--wg-home-muted)] hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)]",
                                    )}
                                    onClick={togglePanel}
                                    aria-pressed={panelOpen}
                                    aria-label={t(panelOpen ? "收起 Zodiac" : "打开 Zodiac")}
                                >
                                    <ZodiacAvatar className="size-5 border-0 shadow-none" />
                                    <span className="hidden sm:inline">Zodiac</span>
                                </button>
                            ) : null}
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
