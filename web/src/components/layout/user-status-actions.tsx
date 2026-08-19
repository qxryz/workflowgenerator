import type { CSSProperties } from "react";
import { KeyboardIcon, PuzzleIcon, Settings01Icon } from "hugeicons-react";

import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useThemeStore } from "@/stores/use-theme-store";

type UserStatusActionsProps = {
    showConfig?: boolean;
    variant?: "default" | "canvas";
    onOpenShortcuts?: () => void;
    onOpenPlugins?: () => void;
};

export function UserStatusActions({ showConfig = true, variant = "default", onOpenShortcuts, onOpenPlugins }: UserStatusActionsProps) {
    const { t } = useAppTranslation();
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const smoothNavigate = useSmoothNavigation();
    const canvasTheme = canvasThemes[theme];
    const naturalIconClass =
        variant === "canvas"
            ? "inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-xl transition hover:bg-black/5 dark:hover:bg-white/10 [&_svg]:size-4"
            : "inline-flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-[9px] text-[color:var(--wg-home-muted)] transition duration-150 hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--wg-home-accent)] [&_svg]:size-4";
    const iconStyle: CSSProperties | undefined = variant === "canvas" ? { color: canvasTheme.node.text } : undefined;

    return (
        <div className="inline-flex shrink-0 items-center gap-1">
            {onOpenPlugins ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenPlugins} aria-label={t("节点插件")} title={t("节点插件")}>
                    <PuzzleIcon className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
            {showConfig ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={() => void smoothNavigate("/config", { direction: "enter-workspace", preload: () => import("@/pages/config") })} aria-label={t("渠道设置")} title={t("渠道设置")}>
                    <Settings01Icon className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
            <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} className={naturalIconClass} style={iconStyle} aria-label={t(theme === "dark" ? "切换到浅色主题" : "切换到深色主题")} title={t(theme === "dark" ? "切换到浅色主题" : "切换到深色主题")} />
            {onOpenShortcuts ? (
                <button type="button" className={naturalIconClass} style={iconStyle} onClick={onOpenShortcuts} aria-label={t("快捷键")} title={t("快捷键")}>
                    <KeyboardIcon className="size-4" strokeWidth={1.8} />
                </button>
            ) : null}
        </div>
    );
}
