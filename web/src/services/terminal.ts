import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { reserveStorageKey, withMediaStorageFence } from "@/services/media-retention-policy";

export type LocalAgentInstallation = {
    id: "codex" | "claude" | "gemini" | "opencode" | "pi" | "kimi-code";
    name: string;
    command: string;
    path: string | null;
};

export type LocalAgentScanResult = {
    agents: LocalAgentInstallation[];
    searchPaths: string[];
};

export type TerminalOutputEvent = {
    sessionId: string;
    data: string;
};

export type TerminalArtifactEvent = {
    sessionId: string;
    path: string;
    mimeType: string;
};

export type TerminalSessionInput = {
    name: string;
    kind: "text" | "image" | "video" | "audio";
    text?: string;
    dataUrl?: string;
    storageKey?: string;
};

export type TerminalSkillInput = {
    id: string;
    name: string;
    version: string;
    body: string;
};

export type TerminalOutputFile = {
    dataUrl: string;
    mimeType: string;
    signature: string;
    bytes: number;
};

export type TerminalImportedMedia = {
    record: {
        key: string;
        url: string;
        mimeType: string;
        bytes: number;
    };
    signature: string;
};

type TerminalOutputHandler = (event: TerminalOutputEvent) => void;
type TerminalArtifactHandler = (event: TerminalArtifactEvent) => void;
const outputHandlers = new Map<string, Set<TerminalOutputHandler>>();
const artifactHandlers = new Map<string, Set<TerminalArtifactHandler>>();
let outputListener: Promise<UnlistenFn> | null = null;
let artifactListener: Promise<UnlistenFn> | null = null;

export async function startTerminalSession(sessionId: string, cwd?: string, inputs: TerminalSessionInput[] = [], skills: TerminalSkillInput[] = []) {
    return invoke<void>("start_terminal_session", { sessionId, cwd: cwd?.trim() || null, inputs, skills });
}

export async function writeTerminalInput(sessionId: string, input: string) {
    return invoke<void>("write_terminal_input", { sessionId, input });
}

export async function resizeTerminalSession(sessionId: string, cols: number, rows: number) {
    return invoke<void>("resize_terminal_session", { sessionId, cols, rows });
}

export async function stopTerminalSession(sessionId: string) {
    return invoke<void>("stop_terminal_session", { sessionId });
}

export async function readTerminalOutputFile(sessionId: string, path: string) {
    return invoke<TerminalOutputFile>("read_terminal_output_file", { sessionId, path });
}

export async function importTerminalOutputFile(sessionId: string, path: string, outputMode: "image" | "video" | "audio", storageKey: string, previousSignature?: string) {
    const releaseReservation = reserveStorageKey(storageKey);
    try {
        const imported = await withMediaStorageFence(() =>
            invoke<TerminalImportedMedia | null>("import_terminal_output_file", {
                sessionId,
                path,
                outputMode,
                storageKey,
                previousSignature: previousSignature || null,
            }),
        );
        if (!imported) releaseReservation();
        return imported;
    } catch (error) {
        releaseReservation();
        throw error;
    }
}

export async function openExternalTerminal(terminal: "terminal" | "ghostty", cwd?: string) {
    return invoke<void>("open_external_terminal", { terminal, cwd: cwd?.trim() || null });
}

export async function chooseTerminalDirectory() {
    return invoke<string | null>("choose_terminal_directory");
}

export async function listenToTerminalOutput(sessionId: string, handler: TerminalOutputHandler) {
    addTerminalHandler(outputHandlers, sessionId, handler);
    try {
        outputListener ||= listen<TerminalOutputEvent>("terminal-output", (event) => {
            outputHandlers.get(event.payload.sessionId)?.forEach((subscriber) => subscriber(event.payload));
        });
        await outputListener;
    } catch (error) {
        removeTerminalHandler(outputHandlers, sessionId, handler);
        outputListener = null;
        throw error;
    }
    return () => removeTerminalHandler(outputHandlers, sessionId, handler);
}

export async function listenToTerminalArtifact(sessionId: string, handler: TerminalArtifactHandler) {
    addTerminalHandler(artifactHandlers, sessionId, handler);
    try {
        artifactListener ||= listen<TerminalArtifactEvent>("terminal-artifact", (event) => {
            artifactHandlers.get(event.payload.sessionId)?.forEach((subscriber) => subscriber(event.payload));
        });
        await artifactListener;
    } catch (error) {
        removeTerminalHandler(artifactHandlers, sessionId, handler);
        artifactListener = null;
        throw error;
    }
    return () => removeTerminalHandler(artifactHandlers, sessionId, handler);
}

export async function prepareTerminalInputs(references: CanvasResourceReference[], inputMode: "auto" | "text" | "image" | "video" | "audio") {
    const accepted = references.filter((reference) => inputMode === "auto" || reference.kind === inputMode);
    return Promise.all(
        accepted.map(async (reference): Promise<TerminalSessionInput> => {
            if (reference.kind === "text") return { name: reference.title, kind: "text", text: reference.text ?? "" };
            if (reference.storageKey) return { name: reference.title, kind: reference.kind, storageKey: reference.storageKey };
            return { name: reference.title, kind: reference.kind, dataUrl: await referenceToDataUrl(reference) };
        }),
    );
}

async function referenceToDataUrl(reference: CanvasResourceReference) {
    const url = reference.previewUrl || "";
    if (!url) throw new Error(`“${reference.title}”没有可用的本地内容`);
    if (url.startsWith("data:")) return url;
    const response = await fetch(url);
    if (!response.ok) throw new Error(`无法读取“${reference.title}”`);
    const blob = await response.blob();
    if (blob.size > 64 * 1024 * 1024) throw new Error(`“${reference.title}”超过 64MB，暂不能注入终端`);
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result || ""));
        reader.onerror = () => reject(new Error(`无法读取“${reference.title}”`));
        reader.readAsDataURL(blob);
    });
}

export async function scanLocalAgents(extraPaths: string[] = []) {
    return invoke<LocalAgentScanResult>("scan_local_agents", { extraPaths });
}

function addTerminalHandler<T>(handlers: Map<string, Set<T>>, sessionId: string, handler: T) {
    const subscribers = handlers.get(sessionId) || new Set<T>();
    subscribers.add(handler);
    handlers.set(sessionId, subscribers);
}

function removeTerminalHandler<T>(handlers: Map<string, Set<T>>, sessionId: string, handler: T) {
    const subscribers = handlers.get(sessionId);
    if (!subscribers) return;
    subscribers.delete(handler);
    if (!subscribers.size) handlers.delete(sessionId);
}
