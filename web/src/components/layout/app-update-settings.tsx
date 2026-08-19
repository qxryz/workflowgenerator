import { Button, Progress, Tag, Timeline } from "antd";
import { Star } from "lucide-react";

import { APP_VERSION } from "@/constant/env";
import { APP_RELEASES_URL, APP_REPOSITORY_URL, useVersionCheck } from "@/hooks/use-version-check";
import { useAppTranslation } from "@/hooks/use-app-translation";

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整") return "blue";
    if (type === "文档") return "purple";
    return "default";
}

function sameVersion(left: string, right: string) {
    return versionKey(left) === versionKey(right);
}

function versionKey(version: string) {
    return version.replace(/^v/, "");
}

export function AppUpdateSettings() {
    const { language, t } = useAppTranslation();
    const { latestVersion, releases, releaseDownloads, checking, checkError, availableVersion, desktopApp, installing, installPhase, downloadProgress, checkLatestRelease, installLatestUpdate } = useVersionCheck();
    const downloadNumber = new Intl.NumberFormat(language);
    const phaseText = installPhase === "downloading" ? t("正在下载更新") : installPhase === "installing" ? t("正在安装更新") : installPhase === "restarting" ? t("正在重新打开") : "";
    const statusText = checking ? t("正在检查更新") : availableVersion ? t("可以更新到 {version}", { version: availableVersion }) : checkError || t("当前已经是最新版");

    return (
        <div className="space-y-4">
            <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            {t("软件更新")}
                            <Tag className="m-0 font-mono">v{versionKey(APP_VERSION)}</Tag>
                        </div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{phaseText || statusText}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {desktopApp && availableVersion ? (
                            <Button type="primary" loading={installing} disabled={checking} onClick={() => void installLatestUpdate()}>
                                {installing ? phaseText : t("下载并安装")}
                            </Button>
                        ) : (
                            <Button loading={checking} disabled={installing} onClick={() => void checkLatestRelease(true)}>
                                {t("检查更新")}
                            </Button>
                        )}
                        <Button icon={<Star size={14} />} href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer">
                            Star
                        </Button>
                        <Button href={APP_RELEASES_URL} target="_blank" rel="noreferrer">
                            {t("前往 Tags")}
                        </Button>
                    </div>
                </div>
                {installing ? (
                    <div className="mt-4">
                        <Progress percent={downloadProgress ?? 0} showInfo={downloadProgress !== null} status="active" />
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{t("安装完成后会自动重新打开。")}</div>
                    </div>
                ) : null}
                {!desktopApp ? <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">{t("网页版不能自动安装，请前往 Tags 下载。")}</div> : null}
            </section>

            {releases.length ? (
                <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                    <div className="mb-4 text-sm font-semibold">{t("更新日志")}</div>
                    <Timeline
                        items={releases.map((release) => {
                            const downloads = releaseDownloads[versionKey(release.version)];
                            return {
                                content: (
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{release.version === "Unreleased" ? t("未发布") : release.version}</span>
                                            <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                            {sameVersion(release.version, latestVersion) ? <Tag color="green">{t("最新")}</Tag> : null}
                                            {sameVersion(release.version, APP_VERSION) ? <Tag>{t("当前")}</Tag> : null}
                                        </div>
                                        {downloads ? (
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                                <span className="font-medium text-stone-700 dark:text-stone-300">{t("累计下载 {count}", { count: downloadNumber.format(downloads.totalDownloads) })}</span>
                                                <span>{t("手动安装 {count}", { count: downloadNumber.format(downloads.manualDownloads) })}</span>
                                                <span>{t("更新包 {count}", { count: downloadNumber.format(downloads.updateDownloads) })}</span>
                                            </div>
                                        ) : null}
                                        <div className="mt-2 space-y-1.5">
                                            {release.items.map((item, index) => (
                                                <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                    <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                        {t(item.type)}
                                                    </Tag>
                                                    <span className="min-w-0 flex-1">{item.content}</span>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                ),
                            };
                        })}
                    />
                </section>
            ) : null}
        </div>
    );
}
