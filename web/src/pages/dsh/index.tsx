import { App, Button } from "antd";
import { Check, LoaderCircle, Play, RefreshCw, Store } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import { cn } from "@/lib/utils";
import { isDesktopApp } from "@/services/desktop-storage";
import { getDshDesktopState, getDshMarketplaceState, installDshMarketplace, openDshDesktop, type DshDesktopState, type DshMarketplaceState } from "@/services/dsh-launcher";

const EMPTY_STATE: DshDesktopState = { installed: false, running: false, version: null };
const EMPTY_MARKETPLACE_STATE: DshMarketplaceState = { installed: false, version: null };

function wait(duration: number) {
    return new Promise((resolve) => window.setTimeout(resolve, duration));
}

export default function DshLauncherPage() {
    const { modal } = App.useApp();
    const desktopApp = isDesktopApp();
    const [snapshot, setSnapshot] = useState<DshDesktopState | null>(null);
    const [marketplace, setMarketplace] = useState<DshMarketplaceState | null>(null);
    const [checking, setChecking] = useState(desktopApp);
    const [marketplaceChecking, setMarketplaceChecking] = useState(desktopApp);
    const [installingMarketplace, setInstallingMarketplace] = useState(false);
    const [marketplaceJustInstalled, setMarketplaceJustInstalled] = useState(false);
    const [opening, setOpening] = useState(false);
    const [error, setError] = useState("");
    const [marketplaceError, setMarketplaceError] = useState("");

    const refresh = useCallback(
        async (quiet = false) => {
            if (!desktopApp) {
                setSnapshot(EMPTY_STATE);
                setChecking(false);
                return EMPTY_STATE;
            }
            if (!quiet) setChecking(true);
            try {
                const next = await getDshDesktopState();
                setSnapshot(next);
                setError("");
                return next;
            } catch (reason) {
                console.error("Unable to read DSH Desktop state", reason);
                setError("暂时无法确认 DSH 的状态，请稍后再试。");
                return null;
            } finally {
                if (!quiet) setChecking(false);
            }
        },
        [desktopApp],
    );

    const refreshMarketplace = useCallback(
        async (quiet = false) => {
            if (!desktopApp) {
                setMarketplace(EMPTY_MARKETPLACE_STATE);
                setMarketplaceChecking(false);
                return EMPTY_MARKETPLACE_STATE;
            }
            if (!quiet) setMarketplaceChecking(true);
            try {
                const next = await getDshMarketplaceState();
                setMarketplace(next);
                setMarketplaceError("");
                return next;
            } catch (reason) {
                console.error("Unable to read DSH marketplace state", reason);
                setMarketplaceError("暂时无法确认插件市场状态，请稍后再试。");
                return null;
            } finally {
                if (!quiet) setMarketplaceChecking(false);
            }
        },
        [desktopApp],
    );

    useEffect(() => {
        void refresh();
        void refreshMarketplace();
        if (!desktopApp) return;
        const timer = window.setInterval(() => {
            void refresh(true);
            void refreshMarketplace(true);
        }, 3_000);
        const refreshWhenVisible = () => {
            if (document.visibilityState === "visible") {
                void refresh(true);
                void refreshMarketplace(true);
            }
        };
        document.addEventListener("visibilitychange", refreshWhenVisible);
        return () => {
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", refreshWhenVisible);
        };
    }, [desktopApp, refresh, refreshMarketplace]);

    const launch = async () => {
        setOpening(true);
        setError("");
        try {
            await openDshDesktop();
            for (const duration of [350, 700, 1_000]) {
                await wait(duration);
                const next = await refresh(true);
                if (next?.running) break;
            }
        } catch (reason) {
            console.error("Unable to open DSH Desktop", reason);
            setError("DSH 暂时没有响应，请稍后再试。");
        } finally {
            setOpening(false);
        }
    };

    const installMarketplace = async () => {
        setInstallingMarketplace(true);
        setMarketplaceError("");
        try {
            const next = await installDshMarketplace();
            setMarketplace(next);
            setMarketplaceJustInstalled(true);
        } catch (reason) {
            console.error("Unable to install DSH marketplace", reason);
            setMarketplaceError(reason instanceof Error ? reason.message : typeof reason === "string" ? reason : "插件市场安装失败，请稍后重试。");
        } finally {
            setInstallingMarketplace(false);
        }
    };

    const confirmMarketplaceInstall = () => {
        modal.confirm({
            title: "安装 DSH 插件市场？",
            content: (
                <div className="space-y-2 text-sm leading-6 text-[color:var(--wg-home-muted)]">
                    <p>这会把社区维护的插件市场加入你的 DSH。</p>
                    <p>第三方插件可能访问你在 DSH 中可用的文件、凭据和网络。请确认你信任该来源后再继续。</p>
                </div>
            ),
            okText: "继续安装",
            cancelText: "取消",
            centered: true,
            onOk: installMarketplace,
        });
    };

    const installed = Boolean(snapshot?.installed);
    const running = Boolean(snapshot?.running);
    const version = snapshot?.version ? `v${snapshot.version}` : installed ? "版本未知" : "尚未安装";
    const status = checking && !snapshot ? "正在检查" : !desktopApp ? "请在桌面版中打开" : !installed ? "尚未安装" : running ? "正在运行" : "准备就绪";
    const buttonLabel = opening ? "正在启动…" : checking && !snapshot ? "正在检查…" : !desktopApp ? "仅桌面版可用" : !installed ? "尚未安装" : running ? "回到 DSH" : "启动 DSH";
    const buttonDisabled = opening || checking || !desktopApp || !installed;
    const marketplaceInstalled = Boolean(marketplace?.installed);
    const marketplaceVersion = marketplace?.version ? `v${marketplace.version}` : null;
    const marketplaceStatus = marketplaceChecking && !marketplace ? "正在检查" : !desktopApp ? "仅桌面版可用" : marketplaceInstalled ? "已安装" : installed ? "未安装" : "需要 DSH";
    const refreshAll = () => {
        void refresh();
        void refreshMarketplace();
    };

    return (
        <main className="wg-dsh-launcher flex h-full min-h-0 flex-col overflow-hidden text-[color:var(--wg-home-text)]" aria-labelledby="dsh-launcher-title">
            <section className="relative z-10 flex min-h-0 flex-1 items-center overflow-y-auto px-6 py-10 sm:px-10 lg:px-16">
                <div className="mx-auto grid w-full max-w-6xl items-center gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(280px,0.75fr)] lg:gap-16">
                    <div className="max-w-2xl">
                        <div className="wg-ascii-label inline-flex items-center gap-2.5 text-[11px] font-semibold text-[color:var(--wg-home-muted)]">
                            <span className="h-px w-7 bg-[color:var(--wg-home-line-strong)]" />
                            DEEPSEEK HARNESS
                        </div>
                        <h1 id="dsh-launcher-title" className="wg-sketch-title mt-5 text-[clamp(4.75rem,12vw,9.5rem)] font-black leading-[0.78] tracking-[-0.09em] text-[color:var(--wg-home-text)]">
                            DSH
                        </h1>
                        <p className="mt-7 max-w-lg text-lg font-medium tracking-[-0.02em] text-[color:var(--wg-home-text)] sm:text-xl">打开 DSH，继续你的工作。</p>
                        <div className="mt-5 flex flex-wrap items-center gap-3 text-sm text-[color:var(--wg-home-muted)]" aria-live="polite">
                            <span
                                className={cn(
                                    "size-2.5 rounded-full border border-[color:var(--wg-pencil-soft)]",
                                    running ? "bg-[color:var(--wg-playful-mint)] shadow-[0_0_0_4px_var(--wg-playful-mint-soft)]" : installed ? "bg-[color:var(--wg-home-accent)]" : "bg-[color:var(--wg-home-muted-strong)]",
                                )}
                            />
                            <span>{status}</span>
                            <span aria-hidden className="text-[color:var(--wg-home-line-strong)]">
                                /
                            </span>
                            <span className="font-mono text-xs">{version}</span>
                        </div>
                        <section className="mt-8 flex max-w-xl items-center gap-3 border-y border-dashed border-[color:var(--wg-pencil-soft)] py-4" aria-labelledby="dsh-marketplace-title">
                            <span className="grid size-10 shrink-0 place-items-center rounded-[10px_13px_11px_12px] border border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-home-raised)] text-[color:var(--wg-home-accent)]">
                                <Store className="size-5" strokeWidth={1.7} />
                            </span>
                            <span className="min-w-0 flex-1">
                                <span id="dsh-marketplace-title" className="block text-sm font-bold">
                                    插件市场
                                </span>
                                <span className="mt-0.5 block text-xs leading-5 text-[color:var(--wg-home-muted)]">
                                    {marketplaceJustInstalled && running ? "已安装，重新打开 DSH 后即可使用。" : marketplaceInstalled ? "在 DSH 设置中浏览和管理社区插件。" : "浏览、搜索和安装社区插件。"}
                                </span>
                                <span className="mt-1.5 flex items-center gap-2 text-[11px] text-[color:var(--wg-home-muted)]" aria-live="polite">
                                    <span className={cn("size-1.5 rounded-full", marketplaceInstalled ? "bg-[color:var(--wg-playful-mint)]" : "bg-[color:var(--wg-home-muted-strong)]")} />
                                    {marketplaceStatus}
                                    {marketplaceVersion ? <span className="font-mono">{marketplaceVersion}</span> : null}
                                </span>
                            </span>
                            {marketplaceInstalled ? (
                                <span className="inline-flex h-9 shrink-0 items-center gap-1.5 px-2 text-xs font-semibold text-[color:var(--wg-playful-mint)]">
                                    <Check className="size-4" strokeWidth={2} />
                                    已安装
                                </span>
                            ) : (
                                <Button type="primary" loading={installingMarketplace} disabled={!desktopApp || !installed || marketplaceChecking} onClick={confirmMarketplaceInstall} className="shrink-0">
                                    安装
                                </Button>
                            )}
                        </section>
                        {error ? (
                            <div className="mt-7 flex flex-wrap items-center gap-3 text-sm text-[color:var(--wg-home-muted)]" role="alert">
                                <span>{error}</span>
                                <button type="button" onClick={() => void refresh()} className="wg-sketch-button-quiet inline-flex h-8 items-center gap-1.5 px-2.5 font-semibold text-[color:var(--wg-home-text)]">
                                    <RefreshCw className="size-3.5" />
                                    重新检查
                                </button>
                            </div>
                        ) : null}
                        {marketplaceError ? (
                            <div className="mt-4 flex flex-wrap items-center gap-3 text-sm text-[color:var(--wg-home-muted)]" role="alert">
                                <span>{marketplaceError}</span>
                                <button type="button" onClick={() => void refreshMarketplace()} className="wg-sketch-button-quiet inline-flex h-8 items-center gap-1.5 px-2.5 font-semibold text-[color:var(--wg-home-text)]">
                                    <RefreshCw className="size-3.5" />
                                    重新检查
                                </button>
                            </div>
                        ) : null}
                    </div>

                    <div className="relative hidden min-h-[330px] items-center justify-center lg:flex" aria-hidden>
                        <div className="wg-dsh-launcher-orbit absolute size-[min(27vw,390px)] rounded-full border border-dashed border-[color:var(--wg-home-line-strong)]" />
                        <div className="absolute size-[min(21vw,300px)] rotate-6 rounded-[38%_46%_42%_50%] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-raised)] shadow-[12px_16px_0_var(--wg-pencil-faint)]" />
                        <img src="/icons/deepseek.svg" alt="" className="relative z-10 size-[min(12vw,170px)] -rotate-3 drop-shadow-[8px_10px_0_var(--wg-pencil-faint)]" />
                        <span className="wg-ascii-label absolute bottom-3 right-4 font-mono text-[10px] text-[color:var(--wg-home-muted-strong)]">READY / LAUNCH</span>
                    </div>
                </div>
            </section>

            <footer className="relative z-20 border-t border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-home-floating)] px-4 py-3 backdrop-blur-md sm:px-6" aria-label="DSH 启动控制">
                <div className="mx-auto flex w-full max-w-6xl items-center gap-3">
                    <div className="flex min-w-0 flex-1 items-center gap-3">
                        <span className="grid size-10 shrink-0 place-items-center rounded-[10px_13px_11px_12px] border border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-panel)] shadow-[1px_2px_0_var(--wg-pencil-faint)]">
                            <img src="/icons/deepseek.svg" alt="" className="size-6" />
                        </span>
                        <span className="min-w-0">
                            <span className="block truncate text-sm font-bold">DSH</span>
                            <span className="block truncate font-mono text-[10px] text-[color:var(--wg-home-muted)]">{version}</span>
                        </span>
                    </div>

                    <div className="hidden items-center gap-2 pr-2 text-xs text-[color:var(--wg-home-muted)] sm:flex" aria-live="polite">
                        <span className={cn("size-1.5 rounded-full", running ? "bg-[color:var(--wg-playful-mint)]" : "bg-[color:var(--wg-home-muted-strong)]")} />
                        {status}
                    </div>

                    <button
                        type="button"
                        onClick={refreshAll}
                        disabled={checking || marketplaceChecking || opening || installingMarketplace || !desktopApp}
                        className="wg-sketch-button-quiet inline-grid size-11 shrink-0 place-items-center text-[color:var(--wg-home-muted)] disabled:cursor-not-allowed disabled:opacity-45"
                        aria-label="重新检查 DSH 状态"
                        title="重新检查"
                    >
                        <RefreshCw className={cn("size-4", (checking || marketplaceChecking) && "animate-spin")} />
                    </button>
                    <button
                        type="button"
                        onClick={() => void launch()}
                        disabled={buttonDisabled}
                        className="wg-sketch-button wg-sketch-button-primary inline-flex h-11 min-w-[150px] shrink-0 items-center justify-center gap-2 px-5 text-sm font-bold disabled:cursor-not-allowed disabled:opacity-45 disabled:shadow-none sm:min-w-[176px]"
                    >
                        {opening || (checking && !snapshot) ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}
                        {buttonLabel}
                    </button>
                </div>
            </footer>
        </main>
    );
}
