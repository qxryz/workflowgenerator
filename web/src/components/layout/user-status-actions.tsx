import type { CSSProperties } from "react";
import { Ellipsis, Keyboard, Moon, Puzzle, Settings2, Sun } from "lucide-react";
import { Dropdown } from "antd";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    compact?: boolean;
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", compact = false, onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { t } = useAppTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const smoothNavigate = useSmoothNavigation();
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass = "wg-icon-button";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;
    const openConfig = () => void smoothNavigate("/config", { direction: "enter-workspace", preload: () => import("@/pages/config") });

    if (compact)
        return (
            <Dropdown
                trigger={["click"]}
                placement="bottomRight"
                classNames={{ root: "wg-canvas-menu" }}
                menu={{
                    items: [
                        ...(onOpenPlugins ? [{ key: "plugins", label: t("节点插件"), icon: <Puzzle className="size-4" />, onClick: onOpenPlugins }] : []),
                        ...(showConfig ? [{ key: "config", label: t("渠道设置"), icon: <Settings2 className="size-4" />, onClick: openConfig }] : []),
                        { key: "theme", label: t(theme === "dark" ? "切换到浅色主题" : "切换到深色主题"), icon: theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />, onClick: () => setTheme(theme === "dark" ? "light" : "dark") },
                        ...(onOpenShortcuts ? [{ key: "shortcuts", label: t("快捷键"), icon: <Keyboard className="size-4" />, onClick: onOpenShortcuts }] : []),
                    ],
                }}
            >
                <button type="button" className="wg-icon-button wg-canvas-folded-control" aria-label={t("更多工具")} title={t("更多工具")} aria-haspopup="menu">
                    <Ellipsis />
                </button>
            </Dropdown>
        );

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={`${naturalIconClass} wg-plugins-button`} style={iconStyle} onClick={onOpenPlugins} aria-label={t("节点插件")} title={t("节点插件")}>
                    <Puzzle className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={openConfig} aria-label={t("渠道设置")} title={t("渠道设置")}>
                    <Settings2 className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
            <AnimatedThemeToggler
                theme={theme}
                onThemeChange={setTheme}
                className={naturalIconClass}
                style={iconStyle}
                aria-label={t(theme === "dark" ? "切换到浅色主题" : "切换到深色主题")}
                title={t(theme === "dark" ? "切换到浅色主题" : "切换到深色主题")}
            />
            {onOpenShortcuts ? (
                <button type="button" className={`${naturalIconClass} wg-shortcuts-button`} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("快捷键")} title={t("快捷键")}>
                    <Keyboard className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
        </div>
    );
}
