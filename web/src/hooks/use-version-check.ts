import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { App } from "antd";
import { relaunch } from "@tauri-apps/plugin-process";
import { check, type DownloadEvent, type Update } from "@tauri-apps/plugin-updater";

import { APP_VERSION } from "@/constant/env";
import { isNewerVersion, parseChangelog, type ReleaseInfo } from "@/lib/release";
import { flushDesktopState } from "@/services/desktop-lifecycle";
import { isDesktopApp } from "@/services/desktop-storage";

const repositoryBase = "https://raw.githubusercontent.com/qxryz/workflowgenerator/main";
const latestVersionUrl = `${repositoryBase}/VERSION`;
const latestChangelogUrl = `${repositoryBase}/CHANGELOG.md`;

export const APP_RELEASES_URL = "https://github.com/qxryz/workflowgenerator/tags";

type InstallPhase = "idle" | "downloading" | "installing" | "restarting";

function readLocalReleases(): ReleaseInfo[] {
    return __APP_RELEASES__ || [];
}

async function fetchRemoteReleaseInfo(currentVersion: string) {
    try {
        const [versionResponse, changelogResponse] = await Promise.all([fetch(latestVersionUrl), fetch(latestChangelogUrl)]);
        if (!versionResponse.ok || !changelogResponse.ok) return null;
        const [version, changelog] = await Promise.all([versionResponse.text(), changelogResponse.text()]);
        return {
            version: version.trim() || currentVersion,
            releases: changelog.trim() ? parseChangelog(changelog) : [],
        };
    } catch {
        return null;
    }
}

function friendlyCheckError(error: unknown) {
    const detail = error instanceof Error ? error.message : String(error);
    return /404|valid release json|failed to fetch|network/i.test(detail) ? "暂时没有可用的更新包" : "检查更新失败，请稍后再试";
}

export function useVersionCheck() {
    const currentVersion = APP_VERSION;
    const { message } = App.useApp();
    const desktopApp = useMemo(isDesktopApp, []);
    const localReleases = useMemo(readLocalReleases, []);
    const pendingUpdateRef = useRef<Update | null>(null);
    const checkingRef = useRef(false);
    const [latestVersion, setLatestVersion] = useState(currentVersion);
    const [releases, setReleases] = useState<ReleaseInfo[]>(localReleases);
    const [availableVersion, setAvailableVersion] = useState<string | null>(null);
    const [checking, setChecking] = useState(false);
    const [checkError, setCheckError] = useState("");
    const [installPhase, setInstallPhase] = useState<InstallPhase>("idle");
    const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
    const installing = installPhase !== "idle";

    const replacePendingUpdate = useCallback((next: Update | null) => {
        const previous = pendingUpdateRef.current;
        pendingUpdateRef.current = next;
        setAvailableVersion(next?.version || null);
        if (previous && previous !== next) void previous.close().catch(() => undefined);
    }, []);

    const checkLatestRelease = useCallback(
        async (showMessage = false) => {
            if (checkingRef.current || installing) return false;
            checkingRef.current = true;
            setChecking(true);
            setCheckError("");
            const remoteInfoPromise = fetchRemoteReleaseInfo(currentVersion);
            try {
                if (desktopApp) {
                    const update = await check({ timeout: 20_000 });
                    replacePendingUpdate(update);
                    const remoteInfo = await remoteInfoPromise;
                    if (remoteInfo?.releases.length) setReleases(remoteInfo.releases);
                    setLatestVersion(update?.version || remoteInfo?.version || currentVersion);
                    if (showMessage) update ? message.success(`发现新版本 ${update.version}`) : message.success("已经是最新版本");
                    return true;
                }

                const remoteInfo = await remoteInfoPromise;
                if (!remoteInfo) throw new Error("network");
                setLatestVersion(remoteInfo.version);
                if (remoteInfo.releases.length) setReleases(remoteInfo.releases);
                if (showMessage) message.success(isNewerVersion(remoteInfo.version, currentVersion) ? `发现新版本 ${remoteInfo.version}` : "已经是最新版本");
                return true;
            } catch (error) {
                const remoteInfo = await remoteInfoPromise;
                if (remoteInfo?.releases.length) setReleases(remoteInfo.releases);
                if (remoteInfo?.version) setLatestVersion(remoteInfo.version);
                const text = friendlyCheckError(error);
                setCheckError(text);
                if (showMessage) message.error(text);
                return false;
            } finally {
                checkingRef.current = false;
                setChecking(false);
            }
        },
        [currentVersion, desktopApp, installing, message, replacePendingUpdate],
    );

    const installLatestUpdate = useCallback(async () => {
        const update = pendingUpdateRef.current;
        if (!update || installPhase !== "idle") return false;
        let downloaded = 0;
        let contentLength: number | undefined;
        setInstallPhase("downloading");
        setDownloadProgress(null);
        try {
            await update.download((event: DownloadEvent) => {
                if (event.event === "Started") {
                    contentLength = event.data.contentLength;
                    setDownloadProgress(contentLength ? 0 : null);
                    return;
                }
                if (event.event === "Progress") {
                    downloaded += event.data.chunkLength;
                    if (contentLength) setDownloadProgress(Math.min(99, Math.round((downloaded / contentLength) * 100)));
                    return;
                }
                setDownloadProgress(100);
            });
            setInstallPhase("installing");
            await flushDesktopState();
            await update.install();
            setInstallPhase("restarting");
            await relaunch();
            return true;
        } catch {
            setInstallPhase("idle");
            setDownloadProgress(null);
            message.error("安装更新失败，请稍后重试");
            return false;
        }
    }, [installPhase, message]);

    useEffect(() => {
        void checkLatestRelease();
    }, [checkLatestRelease]);

    useEffect(
        () => () => {
            const update = pendingUpdateRef.current;
            pendingUpdateRef.current = null;
            if (update) void update.close().catch(() => undefined);
        },
        [],
    );

    return {
        latestVersion,
        releases,
        checking,
        checkError,
        availableVersion,
        desktopApp,
        installing,
        installPhase,
        downloadProgress,
        checkLatestRelease,
        installLatestUpdate,
    };
}
