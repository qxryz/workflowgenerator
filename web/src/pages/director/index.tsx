import { App } from "antd";
import { saveAs } from "file-saver";
import { RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { parseProjectValue } from "@/director-desk/editor/io/importProjectJson";
import type { DirectorCameraCapture, DirectorProject } from "@/director-desk/editor/schema/directorProject";
import { createDirectorBridgeMessage, isDirectorFrameMessage, type DirectorBridgeCapture, type DirectorHostMessage } from "@/lib/director-bridge";
import { deleteStoredImages, discardUploadedImage, getImageBlob, imageToDataUrl, publishUploadedImage, resolveImageUrl, uploadImage } from "@/services/image-storage";
import { readDirectorProject, readDirectorRecentProject, writeDirectorProject, writeDirectorRecentProject } from "@/services/director-project-storage";
import { exportDesktopMedia, isDesktopApp } from "@/services/desktop-storage";
import { registerDesktopFlusher } from "@/services/desktop-lifecycle";
import { registerRuntimeMediaReferenceProvider } from "@/services/media-reference-snapshot";
import { useAssetStore } from "@/stores/use-asset-store";
import { useThemeStore } from "@/stores/use-theme-store";
import { directorCaptureTitle, isDirectorCapturePayload, resolveDirectorInstanceId, resolveDirectorReturnTo, type DirectorCapturePayload } from "./host-utils";
import { findDirectorCapture, fingerprintDirectorCapture, hydrateDirectorProjectCaptures, indexDirectorCaptureImages, prepareDirectorProjectForStorage, type DirectorStoredImage } from "./project-media";

type FrameState = "loading" | "ready" | "error";
type SessionOpenMessage = Extract<DirectorHostMessage, { type: "session.open" }>;
type SnapshotResultMessage = Extract<DirectorHostMessage, { type: "project.snapshot.result" }>;
type ProjectFlushMessage = Extract<DirectorHostMessage, { type: "project.flush" }>;

const directorImageStorage = {
    store: uploadImage,
    resolve: (storageKey: string) => resolveImageUrl(storageKey),
    discard: (image: DirectorStoredImage) => discardUploadedImage(image),
};

function captureAsStoredImage(capture: DirectorCameraCapture | DirectorCapturePayload | DirectorBridgeCapture | undefined): DirectorStoredImage | null {
    if (!capture?.storageKey || !capture.width || !capture.height || !capture.bytes || !capture.mimeType) return null;
    return {
        url: capture.dataUrl,
        storageKey: capture.storageKey,
        width: capture.width,
        height: capture.height,
        bytes: capture.bytes,
        mimeType: capture.mimeType,
        ...(capture.contentHash ? { contentHash: capture.contentHash } : {}),
    };
}

function captureStorageKeys(project: DirectorProject | null) {
    return new Set(Array.from(indexDirectorCaptureImages(project).values(), (image) => image.storageKey));
}

export default function DirectorPage() {
    const { message } = App.useApp();
    const location = useLocation();
    const navigate = useNavigate();
    const theme = useThemeStore((state) => state.theme);
    const addAssetPersisted = useAssetStore((state) => state.addAssetPersisted);
    const instanceId = useMemo(() => resolveDirectorInstanceId(location.search), [location.search]);
    const returnTo = useMemo(() => resolveDirectorReturnTo(location.search, window.location.origin), [location.search]);
    const frameRef = useRef<HTMLIFrameElement>(null);
    const projectRef = useRef<{ instanceId: string; promise: Promise<DirectorProject | null> } | null>(null);
    const persistedProjectRef = useRef<{ instanceId: string; project: DirectorProject | null }>({ instanceId, project: null });
    const pendingCaptureUploadsRef = useRef(new Map<string, DirectorStoredImage>());
    const flushRequestsRef = useRef(new Map<string, { resolve: (project: unknown | null) => void; timeout: number }>());
    const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
    const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
    const closingRef = useRef(false);
    const [frameKey, setFrameKey] = useState(0);
    const [frameState, setFrameState] = useState<FrameState>("loading");
    const frameStateRef = useRef<FrameState>(frameState);
    frameStateRef.current = frameState;

    const readProject = useCallback(() => {
        if (projectRef.current?.instanceId !== instanceId) {
            persistedProjectRef.current = { instanceId, project: null };
            projectRef.current = {
                instanceId,
                promise: readDirectorProject(instanceId).then(async (stored) => {
                    if (stored == null) return null;
                    const persisted = parseProjectValue(stored);
                    persistedProjectRef.current = { instanceId, project: persisted };
                    return hydrateDirectorProjectCaptures(persisted, (storageKey, fallback) => imageToDataUrl({ storageKey, url: fallback }));
                }),
            };
        }
        return projectRef.current.promise;
    }, [instanceId]);

    useEffect(() => {
        void readProject().catch((error) => {
            console.error("Failed to restore the Director Desk project.", error);
            message.error("导演项目未能读取，请重新打开后再试");
        });
    }, [message, readProject]);

    const sendSession = useCallback(async () => {
        const frame = frameRef.current?.contentWindow;
        if (!frame) return;
        const project = await readProject();
        frame.postMessage(createDirectorBridgeMessage<SessionOpenMessage>("session.open", { instanceId, theme, ...(project == null ? {} : { project }) }), window.location.origin);
    }, [instanceId, readProject, theme]);

    const sendSnapshotResult = useCallback((payload: SnapshotResultMessage["payload"]) => {
        frameRef.current?.contentWindow?.postMessage(createDirectorBridgeMessage<SnapshotResultMessage>("project.snapshot.result", payload), window.location.origin);
    }, []);

    const queueProjectSave = useCallback(
        (project: unknown) => {
            try {
                projectRef.current = { instanceId, promise: Promise.resolve(parseProjectValue(project)) };
            } catch {
                // The queued persistence path reports the validated error below.
            }
            const write = saveQueueRef.current.catch(() => undefined).then(async () => {
                const previous = persistedProjectRef.current.instanceId === instanceId ? persistedProjectRef.current.project : null;
                const prepared = await prepareDirectorProjectForStorage(project, previous, directorImageStorage, pendingCaptureUploadsRef.current);
                const previousKeys = captureStorageKeys(previous);
                try {
                    const stored = parseProjectValue(await writeDirectorProject(instanceId, prepared.project));
                    persistedProjectRef.current = { instanceId, project: stored };
                    prepared.uploaded.forEach((image) => publishUploadedImage(image));
                    const storedImages = indexDirectorCaptureImages(stored);
                    pendingCaptureUploadsRef.current.forEach((image, captureId) => {
                        if (storedImages.get(captureId)?.storageKey !== image.storageKey) return;
                        publishUploadedImage(image);
                        pendingCaptureUploadsRef.current.delete(captureId);
                    });
                    const storedKeys = captureStorageKeys(stored);
                    const removedKeys = Array.from(previousKeys).filter((storageKey) => !storedKeys.has(storageKey));
                    if (removedKeys.length) await deleteStoredImages(removedKeys);
                    return stored;
                } catch (error) {
                    await Promise.allSettled(prepared.uploaded.map((image) => discardUploadedImage(image)));
                    throw error;
                }
            });
            saveQueueRef.current = write.then(() => undefined);
            void write.catch((error) => {
                console.error("Failed to save the Director Desk project.", error);
                message.error("导演项目未能保存，请重试");
            });
            return write;
        },
        [instanceId, message],
    );

    const saveRecentProject = useCallback(
        async (project: unknown) => {
            try {
                const stored = await queueProjectSave(project);
                await writeDirectorRecentProject(instanceId, stored);
                sendSnapshotResult({ instanceId, action: "save", status: "saved" });
            } catch (error) {
                console.error("Failed to save the recent Director Desk project.", error);
                sendSnapshotResult({ instanceId, action: "save", status: "error" });
            }
        },
        [instanceId, queueProjectSave, sendSnapshotResult],
    );

    const restoreRecentProject = useCallback(async () => {
        try {
            const stored = await readDirectorRecentProject(instanceId);
            const project = stored == null ? null : await hydrateDirectorProjectCaptures(stored, (storageKey, fallback) => imageToDataUrl({ storageKey, url: fallback }));
            sendSnapshotResult(project == null ? { instanceId, action: "restore", status: "empty" } : { instanceId, action: "restore", status: "restored", project });
        } catch (error) {
            console.error("Failed to restore the recent Director Desk project.", error);
            sendSnapshotResult({ instanceId, action: "restore", status: "error" });
        }
    }, [instanceId, sendSnapshotResult]);

    useEffect(() => {
        if (frameState !== "ready") return;
        void sendSession().catch((error) => {
            console.error("Failed to open the Director Desk session.", error);
            message.error("导演台暂时无法打开，请重试");
        });
    }, [frameState, message, sendSession]);

    useEffect(() => {
        if (frameState !== "loading") return;
        const timeout = window.setTimeout(() => setFrameState("error"), 12_000);
        return () => window.clearTimeout(timeout);
    }, [frameKey, frameState]);

    const ensureCaptureImage = useCallback(async (capture: DirectorCapturePayload) => {
        await saveQueueRef.current.catch(() => undefined);
        const captureId = capture.id?.trim() || "";
        const contentHash = capture.contentHash || (await fingerprintDirectorCapture(capture.dataUrl));
        const pending = captureId ? pendingCaptureUploadsRef.current.get(captureId) : undefined;
        if (pending && (!contentHash || pending.contentHash === contentHash)) return { image: pending, staged: true };
        if (pending) {
            pendingCaptureUploadsRef.current.delete(captureId);
            await discardUploadedImage(pending);
        }

        const persistedProject = persistedProjectRef.current.instanceId === instanceId ? persistedProjectRef.current.project : null;
        const persistedCapture = captureId ? findDirectorCapture(persistedProject, captureId) : undefined;
        const captureCandidate = captureAsStoredImage(capture);
        const persistedCandidate = captureAsStoredImage(persistedCapture);
        const candidate = captureCandidate ?? (persistedCandidate?.contentHash === contentHash ? persistedCandidate : null);
        if (candidate) {
            const url = await resolveImageUrl(candidate.storageKey, "");
            if (url) return { image: { ...candidate, url }, staged: false };
        }

        const uploaded = { ...(await uploadImage(capture.dataUrl)), ...(contentHash ? { contentHash } : {}) };
        if (captureId) pendingCaptureUploadsRef.current.set(captureId, uploaded);
        return { image: uploaded, staged: true };
    }, [instanceId]);

    const saveCapture = useCallback(
        async (capture: DirectorCapturePayload, index: number) => {
            const { image, staged } = await ensureCaptureImage(capture);
            const captureId = capture.id?.trim() || "";
            try {
                const fileName = capture.fileName.split(/[\\/]/).pop()?.slice(0, 160) || "director-capture.png";
                await addAssetPersisted({
                    kind: "image",
                    title: directorCaptureTitle(fileName, index),
                    coverUrl: image.url,
                    tags: ["导演台", "镜头"],
                    source: "导演台",
                    data: { dataUrl: image.url, storageKey: image.storageKey, width: image.width, height: image.height, bytes: image.bytes, mimeType: image.mimeType },
                    metadata: { source: "director-desk", instanceId, fileName, ...(captureId ? { captureId } : {}) },
                });
                if (staged) publishUploadedImage(image);
            } catch (error) {
                if (staged && !captureId) await discardUploadedImage(image);
                throw error;
            }
        },
        [addAssetPersisted, ensureCaptureImage, instanceId],
    );

    const queueCaptures = useCallback(
        (captures: unknown[]) => {
            const validCaptures = captures.filter(isDirectorCapturePayload);
            if (!validCaptures.length) {
                message.warning("没有收到可保存的镜头截图");
                return;
            }
            captureQueueRef.current = captureQueueRef.current.catch(() => undefined).then(async () => {
                let saved = 0;
                for (const [index, capture] of validCaptures.entries()) {
                    try {
                        await saveCapture(capture, index);
                        saved += 1;
                    } catch (error) {
                        console.error("Failed to save a Director Desk capture.", error);
                    }
                }
                if (saved) message.success(`已将 ${saved} 张镜头截图保存到我的资产`);
                if (saved !== validCaptures.length) message.error(`${validCaptures.length - saved} 张截图保存失败，请重试`);
            });
        },
        [message, saveCapture],
    );

    const exportCapture = useCallback(
        async (capture: DirectorCapturePayload) => {
            const { image, staged } = await ensureCaptureImage(capture);
            const captureId = capture.id?.trim() || "";
            const fileName = capture.fileName.split(/[\\/]/).pop()?.slice(0, 160) || "director-capture.png";
            try {
                if (isDesktopApp()) {
                    const exportedName = await exportDesktopMedia("images", image.storageKey, fileName);
                    message.success(`已下载：${exportedName || fileName}`);
                } else {
                    const blob = await getImageBlob(image.storageKey);
                    if (!blob) throw new Error("截图文件不存在");
                    saveAs(blob, fileName);
                    message.success(`已下载：${fileName}`);
                }
            } catch (error) {
                message.error(error instanceof Error ? `下载失败：${error.message}` : "下载失败，请重试");
            } finally {
                if (staged && !captureId) await discardUploadedImage(image);
            }
        },
        [ensureCaptureImage, message],
    );

    const requestProjectFlush = useCallback(() => {
        const frame = frameRef.current?.contentWindow;
        if (!frame || frameStateRef.current !== "ready") return Promise.resolve<unknown | null>(null);
        const requestId = crypto.randomUUID();
        return new Promise<unknown | null>((resolve) => {
            const timeout = window.setTimeout(() => {
                flushRequestsRef.current.delete(requestId);
                resolve(null);
            }, 1_500);
            flushRequestsRef.current.set(requestId, { resolve, timeout });
            frame.postMessage(createDirectorBridgeMessage<ProjectFlushMessage>("project.flush", { instanceId, requestId }), window.location.origin);
        });
    }, [instanceId]);

    useEffect(
        () =>
            registerRuntimeMediaReferenceProvider(() => ({
                directorProject: persistedProjectRef.current.instanceId === instanceId ? persistedProjectRef.current.project : null,
                pendingDirectorCaptures: Array.from(pendingCaptureUploadsRef.current.values()),
            })),
        [instanceId],
    );

    useEffect(
        () =>
            registerDesktopFlusher(async () => {
                const project = await requestProjectFlush();
                if (project != null) await queueProjectSave(project);
                await Promise.all([saveQueueRef.current, captureQueueRef.current]);
            }),
        [queueProjectSave, requestProjectFlush],
    );

    useEffect(() => {
        return () => {
            flushRequestsRef.current.forEach(({ resolve, timeout }) => {
                window.clearTimeout(timeout);
                resolve(null);
            });
            flushRequestsRef.current.clear();
            pendingCaptureUploadsRef.current.forEach((image) => void discardUploadedImage(image));
            pendingCaptureUploadsRef.current.clear();
        };
    }, [instanceId]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.origin !== window.location.origin || event.source !== frameRef.current?.contentWindow || !isDirectorFrameMessage(event.data)) return;
            const bridgeMessage = event.data;
            switch (bridgeMessage.type) {
                case "ready":
                    setFrameState("ready");
                    break;
                case "project.changed":
                    if (bridgeMessage.payload.instanceId === instanceId && bridgeMessage.payload.project !== undefined) void queueProjectSave(bridgeMessage.payload.project);
                    break;
                case "project.snapshot.save":
                    if (bridgeMessage.payload.instanceId === instanceId && bridgeMessage.payload.project !== undefined) void saveRecentProject(bridgeMessage.payload.project);
                    break;
                case "project.snapshot.restore":
                    if (bridgeMessage.payload.instanceId === instanceId) void restoreRecentProject();
                    break;
                case "project.flush.result": {
                    if (bridgeMessage.payload.instanceId !== instanceId) break;
                    const pending = flushRequestsRef.current.get(bridgeMessage.payload.requestId);
                    if (!pending) break;
                    window.clearTimeout(pending.timeout);
                    flushRequestsRef.current.delete(bridgeMessage.payload.requestId);
                    pending.resolve(bridgeMessage.payload.project);
                    break;
                }
                case "captures.sent":
                    if (bridgeMessage.payload.instanceId === instanceId && Array.isArray(bridgeMessage.payload.captures)) queueCaptures(bridgeMessage.payload.captures);
                    break;
                case "capture.export":
                    if (bridgeMessage.payload.instanceId === instanceId && isDirectorCapturePayload(bridgeMessage.payload.capture)) void exportCapture(bridgeMessage.payload.capture);
                    break;
                case "close":
                    if (bridgeMessage.payload.instanceId && bridgeMessage.payload.instanceId !== instanceId) return;
                    if (closingRef.current) return;
                    closingRef.current = true;
                    void Promise.allSettled([saveQueueRef.current, captureQueueRef.current]).finally(() => navigate(returnTo, { replace: true }));
                    break;
                case "panorama.removed":
                    break;
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [exportCapture, instanceId, navigate, queueCaptures, queueProjectSave, restoreRecentProject, returnTo, saveRecentProject]);

    const reload = () => {
        closingRef.current = false;
        setFrameState("loading");
        setFrameKey((value) => value + 1);
    };

    return (
        <main className="wg-paper-surface flex h-full min-w-0 flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <section className="relative min-h-0 flex-1 overflow-hidden bg-[color:var(--wg-panel)]" aria-label="导演台工作区">
                <iframe
                    key={frameKey}
                    ref={frameRef}
                    title="导演台"
                    src="/director-runtime.html"
                    className="h-full w-full border-0 bg-transparent"
                    style={{ colorScheme: "dark" }}
                    allow="clipboard-read; clipboard-write; fullscreen"
                    allowFullScreen
                    referrerPolicy="same-origin"
                    onError={() => setFrameState("error")}
                />
                {frameState !== "ready" ? (
                    <div className="absolute inset-0 grid place-items-center bg-[color:var(--wg-surface)]/95 px-6 text-center" role={frameState === "error" ? "alert" : "status"} aria-live="polite">
                        {frameState === "error" ? (
                            <div>
                                <h2 className="text-[15px] font-semibold">导演台暂时无法打开</h2>
                                <p className="mt-1.5 text-[12px] text-[color:var(--wg-home-muted)]">请检查应用资源后重新加载。</p>
                                <button type="button" className="wg-sketch-button wg-sketch-button-primary mt-5 inline-flex h-9 items-center gap-2 px-4 text-[12px] font-semibold" onClick={reload}>
                                    <RefreshCw className="size-4" strokeWidth={1.8} />
                                    重新加载
                                </button>
                            </div>
                        ) : (
                            <div>
                                <span className="mx-auto block size-5 animate-spin rounded-full border-2 border-current border-r-transparent opacity-60" />
                                <p className="mt-3 text-[12px] text-[color:var(--wg-home-muted)]">正在打开导演台…</p>
                            </div>
                        )}
                    </div>
                ) : null}
            </section>
        </main>
    );
}
