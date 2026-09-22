import { App, Button, Progress } from "antd";
import { useState } from "react";

import { checkDesktopUpdate, installDesktopUpdate, isDesktopApp } from "@/services/desktop-updater";

export function ConfigUpdates() {
    const { message } = App.useApp();
    const [checking, setChecking] = useState(false);
    const [installing, setInstalling] = useState(false);
    const [available, setAvailable] = useState<NonNullable<Awaited<ReturnType<typeof checkDesktopUpdate>>> | null>(null);
    const [progress, setProgress] = useState<number | null>(null);
    if (!isDesktopApp()) return <p className="text-sm text-stone-500">请在桌面应用中检查更新。</p>;
    const checkNow = async () => {
        setChecking(true);
        try {
            const update = await checkDesktopUpdate();
            setAvailable(update);
            if (!update) message.success("已是最新版本");
        } catch (error) { message.error(error instanceof Error ? error.message : "检查更新失败"); }
        finally { setChecking(false); }
    };
    const installNow = async () => {
        if (!available) return;
        setInstalling(true);
        try {
            await installDesktopUpdate(available, (received, total) => setProgress(total ? Math.round(received / total * 100) : null));
        } catch (error) { message.error(error instanceof Error ? error.message : "更新失败"); }
        finally { setInstalling(false); }
    };
    return <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
        <div className="text-sm font-semibold">软件更新</div>
        <p className="mt-1 text-xs text-stone-500">有新版本时会在启动后提醒。安装前会保存当前工作。</p>
        <div className="mt-4 flex items-center gap-2">
            <Button onClick={() => void checkNow()} loading={checking} disabled={installing}>检查更新</Button>
            {available ? <Button type="primary" onClick={() => void installNow()} loading={installing}>安装 {available.version}</Button> : null}
        </div>
        {installing ? <div className="mt-3">{progress === null ? <span className="text-xs text-stone-500">正在下载更新…</span> : <Progress percent={progress} size="small" />}</div> : null}
    </section>;
}
