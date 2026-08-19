export type Position = {
    x: number;
    y: number;
};

export type ViewportTransform = {
    x: number;
    y: number;
    k: number;
};

export enum CanvasNodeType {
    Image = "image",
    Text = "text",
    File = "file",
    Config = "config",
    Video = "video",
    Audio = "audio",
    Terminal = "terminal",
    Group = "group",
}

// 节点类型放开为字符串,内置类型用 CanvasNodeType,插件类型为 "<pluginId>:<name>"
export type CanvasNodeTypeId = CanvasNodeType | (string & {});

export type CanvasNodeStatus = "idle" | "success" | "loading" | "error";
export type CanvasGenerationMode = "text" | "image" | "video" | "audio";
export type CanvasTerminalInputMode = "auto" | CanvasGenerationMode | "file";
export type CanvasImageGenerationType = "generation" | "edit";

/**
 * A result slot reuses the built-in text/image/video/audio node types. Its
 * role is explicit so execution never has to guess from a compatible-looking
 * downstream node.
 */
export type CanvasResultSlotRole = "result-slot";
export type CanvasResultSlotAdvanceMode = "review" | "auto";
export type CanvasResultSlotState = "empty" | "waiting" | "running" | "persisting" | "ready" | "error" | "stale";

export type CanvasResultSlotArtifact = {
    id: string;
    kind: CanvasGenerationMode;
    /** Text content for text artifacts; a readable URL for media artifacts. */
    content: string;
    title?: string;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    durationMs?: number;
};

type CanvasResultSlotVersionBase = {
    id: string;
    createdAt?: string;
    sourceNodeId?: string;
    runId?: string;
    attemptId?: string;
};

export type CanvasResultSlotSuccessVersion = CanvasResultSlotVersionBase & {
    status: "success";
    artifacts: CanvasResultSlotArtifact[];
    primaryArtifactId: string;
};

export type CanvasResultSlotFailureVersion = CanvasResultSlotVersionBase & {
    status: "error";
    artifacts: [];
    errorDetails: string;
};

export type CanvasResultSlotVersion = CanvasResultSlotSuccessVersion | CanvasResultSlotFailureVersion;

export type CanvasNodeMetadata = {
    content?: string;
    composerContent?: string;
    prompt?: string;
    status?: CanvasNodeStatus;
    errorDetails?: string;
    fontSize?: number;
    generationMode?: CanvasGenerationMode;
    generationType?: CanvasImageGenerationType;
    model?: string;
    reasoningEffort?: "auto" | "low" | "medium" | "high" | "xhigh";
    size?: string;
    quality?: string;
    background?: string;
    imageWatermark?: string;
    imageOptimizePrompt?: string;
    count?: number;
    seconds?: string;
    vquality?: string;
    generateAudio?: string;
    watermark?: string;
    seedance25TaskMode?: "generate" | "extend" | "edit";
    seedance25Continuation?: "natural" | "ending";
    seedance25OutputFormat?: "mp4" | "mov";
    seedance25InputMode?: "reference" | "first-frame" | "first-last";
    seedance25Seed?: string;
    seedance25ReturnLastFrame?: string;
    seedance25WebSearch?: string;
    seedance25CameraFixed?: string;
    minimaxVideoInputMode?: "auto" | "first-frame" | "last-frame" | "first-last" | "reference";
    minimaxVideoPromptOptimizer?: string;
    minimaxVideoFastPretreatment?: string;
    audioVoice?: string;
    audioFormat?: string;
    audioSpeed?: string;
    audioInstructions?: string;
    references?: string[];
    naturalWidth?: number;
    naturalHeight?: number;
    freeResize?: boolean;
    isBatchRoot?: boolean;
    batchRootId?: string;
    batchChildIds?: string[];
    batchUsesReferenceImages?: boolean;
    primaryImageId?: string;
    imageBatchExpanded?: boolean;
    storageKey?: string;
    mimeType?: string;
    bytes?: number;
    fileName?: string;
    fileExtension?: string;
    fileCategory?: import("@/lib/asset-file").AssetFileCategory;
    durationMs?: number;
    groupId?: string;
    interactive?: boolean; // 插件节点「交互 ⇄ 移动」开关状态(见 CanvasNodeDefinition.interactionToggle)
    terminalCommand?: string;
    terminalDirectory?: string;
    terminalOutput?: string;
    terminalInputMode?: CanvasTerminalInputMode;
    terminalOutputMode?: CanvasGenerationMode;
    terminalOutputValue?: string;
    terminalOutputArtifactUrl?: string;
    terminalOutputArtifactStorageKey?: string;
    terminalOutputMimeType?: string;
    terminalImportedArtifactPaths?: string[];
    terminalImportedArtifactSignatures?: Record<string, string>;
    terminalOutputRevision?: number;
    terminalSessionVersion?: number;
    terminalFontSize?: number;
    /** New terminal nodes wait for a user-confirmed data contract before opening a PTY. */
    terminalConfigured?: boolean;
    /** Explicit output-slot contract. Absent on ordinary resource nodes. */
    role?: CanvasResultSlotRole;
    advanceMode?: CanvasResultSlotAdvanceMode;
    slotState?: CanvasResultSlotState;
    resultSlotMode?: CanvasGenerationMode;
    resultSlotSourceNodeId?: string;
    resultVersions?: CanvasResultSlotVersion[];
    /** Always points to a successful version; failed attempts do not hide the last usable result. */
    currentResultVersionId?: string;
    /** Number of preview columns chosen by the user; omitted means automatic. */
    resultSlotLayoutColumns?: number;
    /** Manual node resizing pauses auto-fit until the user chooses a layout again. */
    resultSlotAutoSize?: boolean;
};

export type CanvasNodeData = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    position: Position;
    width: number;
    height: number;
    metadata?: CanvasNodeMetadata;
};

export type CanvasTerminalArtifact =
    | {
          kind: Exclude<CanvasGenerationMode, "text">;
          url: string;
          storageKey: string;
          mimeType: string;
          bytes: number;
          width?: number;
          height?: number;
          durationMs?: number;
          title: string;
      }
    | {
          kind: "file";
          storageKey: string;
          mimeType: string;
          bytes: number;
          title: string;
          fileName: string;
          extension: string;
          category: import("@/lib/asset-file").AssetFileCategory;
      };

export type CanvasConnection = {
    id: string;
    fromNodeId: string;
    toNodeId: string;
};

export type CanvasAssistantReference = {
    id: string;
    type: CanvasNodeTypeId;
    title: string;
    dataUrl?: string;
    storageKey?: string;
    text?: string;
};

export type CanvasAssistantImage = {
    id: string;
    dataUrl: string;
    storageKey?: string;
    prompt: string;
};

export type CanvasAssistantMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    references?: CanvasAssistantReference[];
};

export type CanvasAssistantSession = {
    id: string;
    title: string;
    messages: CanvasAssistantMessage[];
    createdAt: string;
    updatedAt: string;
};

export type ConnectionHandle = {
    nodeId: string;
    handleType: "source" | "target";
};

export type SelectionBox = {
    startWorldX: number;
    startWorldY: number;
    currentWorldX: number;
    currentWorldY: number;
    additive: boolean;
    initialSelectedNodeIds: string[];
};

export type ContextMenuState =
    | {
          type: "node";
          x: number;
          y: number;
          nodeId: string;
      }
    | {
          type: "connection";
          x: number;
          y: number;
          connectionId: string;
      };
