import { App } from "antd";
import { useEffect } from "react";

import { checkDesktopUpdate, installDesktopUpdate, isDesktopApp } from "@/services/desktop-updater";

export function DesktopUpdateWatcher() {
    const { modal, message } = App.useApp();
    useEffect(() => {
        if (!isDesktopApp()) return;
        let disposed = false;
        const timer = window.setTimeout(() => {
            void checkDesktopUpdate().then((update) => {
                if (!update || disposed) return;
                modal.confirm({
                    title: `发现新版本 ${update.version}`,
                    content: update.body || "现在下载并安装更新？",
                    okText: "更新并重启",
                    cancelText: "稍后",
                    onOk: async () => {
                        const hide = message.loading("正在下载更新…", 0);
                        try { await installDesktopUpdate(update); }
                        catch (error) { message.error(error instanceof Error ? error.message : "更新失败，请稍后重试"); }
                        finally { hide(); }
                    },
                });
            }).catch(() => { /* 离线时不打断创作；用户仍可在设置中手动检查。 */ });
        }, 5000);
        return () => { disposed = true; window.clearTimeout(timer); };
    }, [message, modal]);
    return null;
}
