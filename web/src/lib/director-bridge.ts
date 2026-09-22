export const DIRECTOR_BRIDGE_CHANNEL = "workflowgenerator:director-desk";
export const DIRECTOR_BRIDGE_VERSION = 1 as const;

export const DIRECTOR_BRIDGE_CAPABILITIES = ["project.sync", "project.snapshot", "project.flush", "panorama.input", "capture.output"] as const;

export type DirectorBridgeTheme = "light" | "dark";

export type DirectorBridgeCapture = {
    id?: string;
    dataUrl: string;
    fileName: string;
    storageKey?: string;
    width?: number;
    height?: number;
    bytes?: number;
    mimeType?: string;
    contentHash?: string;
};

export type DirectorProjectSnapshotAction = "save" | "restore";
export type DirectorProjectSnapshotStatus = "saved" | "restored" | "empty" | "error";

type DirectorBridgeEnvelope<TType extends string, TPayload> = {
    channel: typeof DIRECTOR_BRIDGE_CHANNEL;
    version: typeof DIRECTOR_BRIDGE_VERSION;
    type: TType;
    payload: TPayload;
};

export type DirectorHostMessage =
    | DirectorBridgeEnvelope<"session.open", { instanceId: string; theme: DirectorBridgeTheme; project?: unknown }>
    | DirectorBridgeEnvelope<"panorama.set", { instanceId: string; edgeId: string; sourceNodeId: string; imageUrl: string; fileName: string }>
    | DirectorBridgeEnvelope<"project.flush", { instanceId: string; requestId: string }>
    | DirectorBridgeEnvelope<"project.snapshot.result", { instanceId: string; action: DirectorProjectSnapshotAction; status: DirectorProjectSnapshotStatus; project?: unknown }>;

export type DirectorFrameMessage =
    | DirectorBridgeEnvelope<"ready", { capabilities: string[] }>
    | DirectorBridgeEnvelope<"project.changed", { instanceId: string; project: unknown }>
    | DirectorBridgeEnvelope<"project.snapshot.save", { instanceId: string; project: unknown }>
    | DirectorBridgeEnvelope<"project.snapshot.restore", { instanceId: string }>
    | DirectorBridgeEnvelope<"project.flush.result", { instanceId: string; requestId: string; project: unknown }>
    | DirectorBridgeEnvelope<"close", { instanceId?: string }>
    | DirectorBridgeEnvelope<"panorama.removed", { instanceId: string; edgeId: string; sourceNodeId: string }>
    | DirectorBridgeEnvelope<"captures.sent", { instanceId: string; captures: DirectorBridgeCapture[] }>
    | DirectorBridgeEnvelope<"capture.export", { instanceId: string; capture: DirectorBridgeCapture }>;

export type DirectorBridgeMessage = DirectorHostMessage | DirectorFrameMessage;

export function createDirectorBridgeMessage<TMessage extends DirectorBridgeMessage>(type: TMessage["type"], payload: TMessage["payload"]): TMessage {
    return {
        channel: DIRECTOR_BRIDGE_CHANNEL,
        version: DIRECTOR_BRIDGE_VERSION,
        type,
        payload,
    } as TMessage;
}

export function isDirectorBridgeMessage(value: unknown): value is DirectorBridgeMessage {
    if (!value || typeof value !== "object") return false;
    const message = value as Partial<DirectorBridgeMessage>;
    return message.channel === DIRECTOR_BRIDGE_CHANNEL && message.version === DIRECTOR_BRIDGE_VERSION && typeof message.type === "string" && Boolean(message.payload && typeof message.payload === "object");
}

export function isDirectorFrameMessage(value: unknown): value is DirectorFrameMessage {
    if (!isDirectorBridgeMessage(value)) return false;
    return value.type === "ready" || value.type === "project.changed" || value.type === "project.snapshot.save" || value.type === "project.snapshot.restore" || value.type === "project.flush.result" || value.type === "close" || value.type === "panorama.removed" || value.type === "captures.sent" || value.type === "capture.export";
}
