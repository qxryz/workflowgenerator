import { Button, Progress, Tag, Timeline } from "antd";
import { Star } from "lucide-react";

import { APP_VERSION } from "@/constant/env";
import { APP_RELEASES_URL, APP_REPOSITORY_URL, useVersionCheck } from "@/hooks/use-version-check";

const downloadNumber = new Intl.NumberFormat("zh-CN");

function getTagColor(type: string) {
    if (type === "新增") return "green";
    if (type === "修复") return "red";
    if (type === "调整") return "blue";
    if (type === "文档") return "purple";
    return "default";
}

function getReleaseTitle(version: string) {
    return version === "Unreleased" ? "未发布" : version;
}

function sameVersion(left: string, right: string) {
    return versionKey(left) === versionKey(right);
}

function versionKey(version: string) {
    return version.replace(/^v/, "");
}

export function AppUpdateSettings() {
    const { latestVersion, releases, releaseDownloads, checking, checkError, availableVersion, desktopApp, installing, installPhase, downloadProgress, checkLatestRelease, installLatestUpdate } = useVersionCheck();
    const phaseText = installPhase === "downloading" ? "正在下载更新" : installPhase === "installing" ? "正在安装更新" : installPhase === "restarting" ? "正在重新打开" : "";
    const statusText = checking ? "正在检查更新" : availableVersion ? `可以更新到 ${availableVersion}` : checkError || "当前已经是最新版";

    return (
        <div className="space-y-4">
            <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                <div className="flex flex-wrap items-center justify-between gap-4">
                    <div className="min-w-0">
                        <div className="flex items-center gap-2 text-sm font-semibold">
                            软件更新
                            <Tag className="m-0 font-mono">v{versionKey(APP_VERSION)}</Tag>
                        </div>
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">{phaseText || statusText}</div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        {desktopApp && availableVersion ? (
                            <Button type="primary" loading={installing} disabled={checking} onClick={() => void installLatestUpdate()}>
                                {installing ? phaseText : "下载并安装"}
                            </Button>
                        ) : (
                            <Button loading={checking} disabled={installing} onClick={() => void checkLatestRelease(true)}>
                                检查更新
                            </Button>
                        )}
                        <Button icon={<Star size={14} />} href={APP_REPOSITORY_URL} target="_blank" rel="noreferrer">
                            Star
                        </Button>
                        <Button href={APP_RELEASES_URL} target="_blank" rel="noreferrer">
                            前往 Tags
                        </Button>
                    </div>
                </div>
                {installing ? (
                    <div className="mt-4">
                        <Progress percent={downloadProgress ?? 0} showInfo={downloadProgress !== null} status="active" />
                        <div className="mt-1 text-xs text-stone-500 dark:text-stone-400">安装完成后会自动重新打开。</div>
                    </div>
                ) : null}
                {!desktopApp ? <div className="mt-3 text-xs text-stone-500 dark:text-stone-400">网页版不能自动安装，请前往 Tags 下载。</div> : null}
            </section>

            {releases.length ? (
                <section className="rounded-xl border border-stone-200 p-4 dark:border-stone-800">
                    <div className="mb-4 text-sm font-semibold">更新日志</div>
                    <Timeline
                        items={releases.map((release) => {
                            const downloads = releaseDownloads[versionKey(release.version)];
                            return {
                                content: (
                                    <div>
                                        <div className="flex flex-wrap items-center gap-2">
                                            <span className="text-sm font-semibold text-stone-950 dark:text-stone-100">{getReleaseTitle(release.version)}</span>
                                            <span className="text-xs text-stone-500 dark:text-stone-400">{release.date}</span>
                                            {sameVersion(release.version, latestVersion) ? <Tag color="green">最新</Tag> : null}
                                            {sameVersion(release.version, APP_VERSION) ? <Tag>当前</Tag> : null}
                                        </div>
                                        {downloads ? (
                                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-stone-500 dark:text-stone-400">
                                                <span className="font-medium text-stone-700 dark:text-stone-300">累计下载 {downloadNumber.format(downloads.totalDownloads)}</span>
                                                <span>手动安装 {downloadNumber.format(downloads.manualDownloads)}</span>
                                                <span>更新包 {downloadNumber.format(downloads.updateDownloads)}</span>
                                            </div>
                                        ) : null}
                                        <div className="mt-2 space-y-1.5">
                                            {release.items.map((item, index) => (
                                                <div key={`${release.version}-${index}`} className="flex items-start gap-2 text-sm leading-6 text-stone-700 dark:text-stone-300">
                                                    <Tag color={getTagColor(item.type)} className="m-0 mt-0.5 shrink-0 whitespace-nowrap">
                                                        {item.type}
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
