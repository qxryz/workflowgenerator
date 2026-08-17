import type { ReactNode } from "react";
import { useEffect } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App, ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ClientRootInit } from "@/components/layout/client-root-init";
import { getAntThemeConfig } from "@/lib/app-theme";
import { installDesktopCloseGuard } from "@/services/desktop-lifecycle";
import { DESKTOP_EXTERNAL_LINK_ERROR_EVENT, installDesktopExternalLinkHandler } from "@/services/external-links";
import { useThemeStore } from "@/stores/use-theme-store";

const queryClient = new QueryClient({
    defaultOptions: {
        queries: {
            staleTime: 30_000,
            retry: false,
            refetchOnWindowFocus: false,
        },
    },
});

export function AppProviders({ children }: { children: ReactNode }) {
    const theme = useThemeStore((state) => state.theme);
    const dark = theme === "dark";

    useEffect(() => {
        document.documentElement.classList.toggle("dark", dark);
        document.documentElement.style.colorScheme = theme;
    }, [dark, theme]);
    useEffect(() => installDesktopCloseGuard(), []);
    useEffect(() => installDesktopExternalLinkHandler(), []);

    return (
        <ConfigProvider locale={zhCN} theme={getAntThemeConfig(dark)}>
            <App>
                <DesktopLifecycleFeedback />
                <QueryClientProvider client={queryClient}>
                    <ClientRootInit>{children}</ClientRootInit>
                </QueryClientProvider>
            </App>
        </ConfigProvider>
    );
}

function DesktopLifecycleFeedback() {
    const { message } = App.useApp();
    useEffect(() => {
        const notifySaveError = () => message.error("还有内容未能保存，请释放一些存储空间后重试关闭。");
        const notifyExternalLinkError = () => message.error("无法打开链接，请检查系统默认浏览器后重试。");
        window.addEventListener("workflowgenerator:save-error", notifySaveError);
        window.addEventListener(DESKTOP_EXTERNAL_LINK_ERROR_EVENT, notifyExternalLinkError);
        return () => {
            window.removeEventListener("workflowgenerator:save-error", notifySaveError);
            window.removeEventListener(DESKTOP_EXTERNAL_LINK_ERROR_EVENT, notifyExternalLinkError);
        };
    }, [message]);
    return null;
}
