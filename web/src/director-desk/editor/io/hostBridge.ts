import { DIRECTOR_BRIDGE_CAPABILITIES, createDirectorBridgeMessage, isDirectorBridgeMessage, type DirectorBridgeCapture, type DirectorBridgeTheme, type DirectorFrameMessage, type DirectorHostMessage, type DirectorProjectSnapshotAction, type DirectorProjectSnapshotStatus } from "../../../lib/director-bridge";
import { useDirectorStore } from "../store/directorStore";
import { parseProjectValue } from "./importProjectJson";

interface HostConnectedPanorama {
    edgeId: string;
    sourceNodeId: string;
}

let initialized = false;
let activeInstanceId = "";
let hostConnectedPanorama: HostConnectedPanorama | null = null;
let removeUnsubscribe: (() => void) | null = null;
let projectNoticeTimer: number | null = null;
let suppressProjectNotices = false;
let suppressNextPanoramaRemovalNotice = false;
const snapshotResultListeners = new Set<(result: DirectorProjectSnapshotResult) => void>();

export type DirectorProjectSnapshotResult = {
    action: DirectorProjectSnapshotAction;
    status: DirectorProjectSnapshotStatus;
};

function normalizeString(value: unknown) {
    return typeof value === "string" ? value.trim() : "";
}

function getHostOrigin() {
    return window.location.origin === "null" ? "*" : window.location.origin;
}

function isTrustedHostEvent(event: MessageEvent) {
    if (event.source !== window.parent) return false;
    return window.location.origin === "null" ? event.origin === "null" : event.origin === window.location.origin;
}

function applyDirectorDeskTheme(theme: DirectorBridgeTheme) {
    document.documentElement.dataset.hostTheme = theme;
    document.documentElement.dataset.theme = "dark";
    document.documentElement.classList.add("dark");
}

function getInitialHostTheme(): DirectorBridgeTheme | null {
    try {
        const theme = new URLSearchParams(window.location.search).get("theme");
        return theme === "light" || theme === "dark" ? theme : null;
    } catch {
        return null;
    }
}

function postToHost(message: DirectorFrameMessage) {
    window.parent?.postMessage(message, getHostOrigin());
}

function emitSnapshotResult(result: DirectorProjectSnapshotResult) {
    snapshotResultListeners.forEach((listener) => listener(result));
}

function postReady() {
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "ready" }>>("ready", {
            capabilities: [...DIRECTOR_BRIDGE_CAPABILITIES],
        }),
    );
}

function postProjectChanged() {
    if (!activeInstanceId || suppressProjectNotices) return;

    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "project.changed" }>>("project.changed", {
            instanceId: activeInstanceId,
            project: useDirectorStore.getState().project,
        }),
    );
}

function postProjectFlushResult(requestId: string) {
    if (!activeInstanceId || !requestId) return;
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "project.flush.result" }>>("project.flush.result", {
            instanceId: activeInstanceId,
            requestId,
            project: useDirectorStore.getState().project,
        }),
    );
}

function scheduleProjectChanged() {
    if (!activeInstanceId || suppressProjectNotices) return;
    if (projectNoticeTimer) window.clearTimeout(projectNoticeTimer);
    projectNoticeTimer = window.setTimeout(() => {
        projectNoticeTimer = null;
        postProjectChanged();
    }, 180);
}

function flushProjectChanged() {
    if (projectNoticeTimer) {
        window.clearTimeout(projectNoticeTimer);
        projectNoticeTimer = null;
    }
    postProjectChanged();
}

function notifyPanoramaRemoved() {
    if (!activeInstanceId || !hostConnectedPanorama) return;

    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "panorama.removed" }>>("panorama.removed", {
            instanceId: activeInstanceId,
            ...hostConnectedPanorama,
        }),
    );
    hostConnectedPanorama = null;
}

function subscribeToProjectChanges() {
    if (removeUnsubscribe) return;

    removeUnsubscribe = useDirectorStore.subscribe((state, previousState) => {
        const previousPanoramaAssetId = previousState.project.panoramaAssetId;
        const nextPanoramaAssetId = state.project.panoramaAssetId;

        if (previousPanoramaAssetId && !nextPanoramaAssetId) {
            if (suppressNextPanoramaRemovalNotice) {
                suppressNextPanoramaRemovalNotice = false;
                hostConnectedPanorama = null;
            } else {
                notifyPanoramaRemoved();
            }
        }

        if (state.project !== previousState.project) {
            scheduleProjectChanged();
        }
    });
}

function importHostPanorama(payload: Extract<DirectorHostMessage, { type: "panorama.set" }>["payload"]) {
    if (!activeInstanceId || payload.instanceId !== activeInstanceId) return;

    const imageUrl = normalizeString(payload.imageUrl);
    if (!imageUrl) return;

    const fileName = normalizeString(payload.fileName) || "画布全景图.png";
    hostConnectedPanorama = {
        edgeId: normalizeString(payload.edgeId),
        sourceNodeId: normalizeString(payload.sourceNodeId),
    };
    useDirectorStore.getState().addImportedAsset({
        kind: "panorama",
        name: fileName,
        fileName,
        url: imageUrl,
        projectionMode: "backdrop",
    });
}

function openHostSession(payload: Extract<DirectorHostMessage, { type: "session.open" }>["payload"]) {
    const instanceId = normalizeString(payload.instanceId);
    if (!instanceId) return;

    if (projectNoticeTimer) {
        window.clearTimeout(projectNoticeTimer);
        projectNoticeTimer = null;
    }
    suppressProjectNotices = true;
    suppressNextPanoramaRemovalNotice = Boolean(useDirectorStore.getState().project.panoramaAssetId);
    activeInstanceId = instanceId;
    hostConnectedPanorama = null;
    applyDirectorDeskTheme(payload.theme);
    useDirectorStore.getState().openScopedScene(instanceId);

    if (payload.project !== undefined) {
        try {
            useDirectorStore.getState().replaceProject(parseProjectValue(payload.project));
        } catch {
            // Keep the new empty session usable when the host sends a malformed snapshot.
        }
    }

    suppressNextPanoramaRemovalNotice = false;
    suppressProjectNotices = false;
    postProjectChanged();
}

function handleHostMessage(event: MessageEvent) {
    if (!isTrustedHostEvent(event) || !isDirectorBridgeMessage(event.data)) return;

    if (event.data.type === "session.open") {
        openHostSession(event.data.payload);
        return;
    }

    if (event.data.type === "panorama.set") {
        importHostPanorama(event.data.payload);
        return;
    }

    if (event.data.type === "project.flush" && event.data.payload.instanceId === activeInstanceId) {
        postProjectFlushResult(normalizeString(event.data.payload.requestId));
        return;
    }

    if (event.data.type === "project.snapshot.result" && event.data.payload.instanceId === activeInstanceId) {
        const { action, status } = event.data.payload;
        if (action === "restore" && status === "restored") {
            try {
                useDirectorStore.getState().replaceProject(parseProjectValue(event.data.payload.project));
            } catch {
                emitSnapshotResult({ action, status: "error" });
                return;
            }
        }
        emitSnapshotResult({ action, status });
    }
}

export function subscribeDirectorProjectSnapshotResult(listener: (result: DirectorProjectSnapshotResult) => void) {
    snapshotResultListeners.add(listener);
    return () => {
        snapshotResultListeners.delete(listener);
    };
}

export function saveDirectorDeskRecentProject() {
    if (!activeInstanceId) return false;
    const state = useDirectorStore.getState();
    state.saveLatestSnapshot();
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "project.snapshot.save" }>>("project.snapshot.save", {
            instanceId: activeInstanceId,
            project: state.project,
        }),
    );
    return true;
}

export function restoreDirectorDeskRecentProject() {
    if (!activeInstanceId) return false;
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "project.snapshot.restore" }>>("project.snapshot.restore", {
            instanceId: activeInstanceId,
        }),
    );
    return true;
}

export function postDirectorDeskCapturesToHost(
    captures: Array<{
        id?: string;
        dataUrl: string;
        fileName?: string;
        storageKey?: string;
        width?: number;
        height?: number;
        bytes?: number;
        mimeType?: string;
        contentHash?: string;
    }>,
) {
    if (!activeInstanceId) return;

    const normalizedCaptures = captures.flatMap((capture, index): DirectorBridgeCapture[] => {
        const dataUrl = normalizeString(capture.dataUrl);
        if (!dataUrl) return [];

        return [
            {
                ...(normalizeString(capture.id) ? { id: normalizeString(capture.id) } : {}),
                dataUrl,
                fileName: normalizeString(capture.fileName) || `director-desk-capture-${index + 1}.png`,
                ...(normalizeString(capture.storageKey) ? { storageKey: normalizeString(capture.storageKey) } : {}),
                ...(typeof capture.width === "number" ? { width: capture.width } : {}),
                ...(typeof capture.height === "number" ? { height: capture.height } : {}),
                ...(typeof capture.bytes === "number" ? { bytes: capture.bytes } : {}),
                ...(normalizeString(capture.mimeType) ? { mimeType: normalizeString(capture.mimeType) } : {}),
                ...(normalizeString(capture.contentHash) ? { contentHash: normalizeString(capture.contentHash) } : {}),
            },
        ];
    });
    if (normalizedCaptures.length === 0) return;

    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "captures.sent" }>>("captures.sent", {
            instanceId: activeInstanceId,
            captures: normalizedCaptures,
        }),
    );
}

export function exportDirectorDeskCaptureToHost(capture: DirectorBridgeCapture) {
    if (!activeInstanceId) return false;
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "capture.export" }>>("capture.export", {
            instanceId: activeInstanceId,
            capture,
        }),
    );
    return true;
}

export function isEmbeddedDirectorDesk() {
    return new URLSearchParams(window.location.search).get("embedded") === "1";
}

export function getDirectorCaptureDestinationLabel() {
    return isEmbeddedDirectorDesk() ? "送回工作流" : "保存到我的资产";
}

export function postDirectorDeskCloseToHost() {
    flushProjectChanged();
    postToHost(
        createDirectorBridgeMessage<Extract<DirectorFrameMessage, { type: "close" }>>("close", {
            ...(activeInstanceId ? { instanceId: activeInstanceId } : {}),
        }),
    );
}

export function initDirectorDeskHostBridge() {
    if (initialized) return;

    initialized = true;
    applyDirectorDeskTheme(getInitialHostTheme() ?? "dark");
    window.addEventListener("message", handleHostMessage);
    subscribeToProjectChanges();
    postReady();
}

export function clearDirectorDeskHostBridge() {
    if (!initialized) return;

    initialized = false;
    flushProjectChanged();
    activeInstanceId = "";
    hostConnectedPanorama = null;
    suppressProjectNotices = false;
    suppressNextPanoramaRemovalNotice = false;
    window.removeEventListener("message", handleHostMessage);
    removeUnsubscribe?.();
    removeUnsubscribe = null;
}
