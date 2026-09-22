import type {
    CanvasConnection,
    CanvasGenerationMode,
    CanvasNodeData,
    CanvasNodeMetadata,
    CanvasResultSlotAdvanceMode,
    CanvasResultSlotArtifact,
    CanvasResultSlotFailureVersion,
    CanvasResultSlotState,
    CanvasResultSlotSuccessVersion,
    CanvasResultSlotVersion,
    Position,
} from "../../types/canvas";
import type { WorkflowNodeStatus } from "./workflow-execution";

const SLOT_NODE_SPEC: Record<CanvasGenerationMode, { type: CanvasGenerationMode; title: string; width: number; height: number }> = {
    text: { type: "text", title: "文本结果", width: 340, height: 240 },
    image: { type: "image", title: "图片结果", width: 340, height: 240 },
    video: { type: "video", title: "视频结果", width: 420, height: 236 },
    audio: { type: "audio", title: "音频结果", width: 340, height: 180 },
};

export type CanvasResultSlotNode = CanvasNodeData & {
    type: CanvasGenerationMode;
    metadata: CanvasNodeMetadata & {
        role: "result-slot";
        advanceMode: CanvasResultSlotAdvanceMode;
        slotState: CanvasResultSlotState;
        resultSlotMode: CanvasGenerationMode;
        resultVersions: CanvasResultSlotVersion[];
    };
};

export type CreateCanvasResultSlotOptions = {
    id: string;
    mode: CanvasGenerationMode;
    position: Position;
    title?: string;
    width?: number;
    height?: number;
    sourceNodeId?: string;
    advanceMode?: CanvasResultSlotAdvanceMode;
    metadata?: CanvasNodeMetadata;
};

export type CreateCanvasResultSlotBindingOptions = CreateCanvasResultSlotOptions & {
    sourceNodeId: string;
    connectionId: string;
};

export type AppendResultSlotSuccessInput = {
    id: string;
    artifacts: readonly CanvasResultSlotArtifact[];
    primaryArtifactId?: string;
    createdAt?: string;
    sourceNodeId?: string;
    runId?: string;
    attemptId?: string;
};

export type AppendResultSlotFailureInput = {
    id: string;
    errorDetails: string;
    createdAt?: string;
    sourceNodeId?: string;
    runId?: string;
    attemptId?: string;
};

export type CanvasResultSlotOutput = {
    slotNodeId: string;
    mode: CanvasGenerationMode;
    version: CanvasResultSlotSuccessVersion;
    artifacts: readonly CanvasResultSlotArtifact[];
    primaryArtifact: CanvasResultSlotArtifact;
};

/** Creates an empty result-slot node without mutating canvas state. */
export function createCanvasResultSlot(options: CreateCanvasResultSlotOptions): CanvasResultSlotNode {
    const spec = SLOT_NODE_SPEC[options.mode];
    assertNonEmptyId(options.id, "结果槽 ID");
    if (options.sourceNodeId !== undefined) assertNonEmptyId(options.sourceNodeId, "来源节点 ID");

    return {
        id: options.id,
        type: spec.type,
        title: options.title?.trim() || spec.title,
        position: { ...options.position },
        width: options.width ?? spec.width,
        height: options.mode === "audio" ? Math.max(options.height ?? spec.height, spec.height) : (options.height ?? spec.height),
        metadata: {
            ...options.metadata,
            content: "",
            storageKey: undefined,
            status: "idle",
            errorDetails: undefined,
            role: "result-slot",
            advanceMode: options.advanceMode ?? "review",
            slotState: "empty",
            resultSlotMode: options.mode,
            resultSlotSourceNodeId: options.sourceNodeId,
            resultVersions: [],
            currentResultVersionId: undefined,
        },
    };
}

/** Convenience creator for the node and its declared write connection. */
export function createCanvasResultSlotBinding(options: CreateCanvasResultSlotBindingOptions): { node: CanvasResultSlotNode; connection: CanvasConnection } {
    assertNonEmptyId(options.connectionId, "结果槽连线 ID");
    const node = createCanvasResultSlot(options);
    return {
        node,
        connection: {
            id: options.connectionId,
            fromNodeId: options.sourceNodeId,
            toNodeId: node.id,
        },
    };
}

export function isCanvasResultSlot(node: CanvasNodeData | undefined | null): node is CanvasResultSlotNode {
    if (!node || node.metadata?.role !== "result-slot") return false;
    return (
        isGenerationMode(node.type) &&
        node.metadata.resultSlotMode === node.type &&
        (node.metadata.advanceMode === "review" || node.metadata.advanceMode === "auto") &&
        isResultSlotState(node.metadata.slotState) &&
        Array.isArray(node.metadata.resultVersions)
    );
}

export function setCanvasResultSlotAdvanceMode(node: CanvasNodeData, advanceMode: CanvasResultSlotAdvanceMode): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    return { ...slot, metadata: { ...slot.metadata, advanceMode } };
}

/** Updates a lifecycle state while keeping the last readable artifact in place. */
export function setCanvasResultSlotState(node: CanvasNodeData, slotState: CanvasResultSlotState, errorDetails?: string): CanvasResultSlotNode {
    const slot = synchronizeResultSlotSelectedOutput(node);
    const status = legacyNodeStatus(slotState, Boolean(getCurrentResultSlotVersion(slot)));
    return {
        ...slot,
        metadata: {
            ...slot.metadata,
            slotState,
            status,
            errorDetails: slotState === "error" ? errorDetails || slot.metadata.errorDetails || "生成失败" : undefined,
        },
    };
}

/** Mirrors executor lifecycle into a result slot, including terminal failures. */
export function syncResultSlotWorkflowStatus(node: CanvasNodeData, status: WorkflowNodeStatus, errorDetails?: string): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    if (status === "queued" || status === "waiting_inputs") return setCanvasResultSlotState(slot, "waiting");
    if (status === "running") return setCanvasResultSlotState(slot, "running");
    if (status === "persisting") return setCanvasResultSlotState(slot, "persisting");
    if ((status === "completed" || status === "waiting_review") && getCurrentResultSlotVersion(slot)) return setCanvasResultSlotState(slot, "ready");
    if (status === "error" || status === "blocked") {
        const failed = setCanvasResultSlotState(slot, "error", errorDetails || (status === "blocked" ? "上一步未完成" : "这一步未完成"));
        // Executor failures are terminal for the current attempt. Keep the last
        // durable preview, but never leave legacy renderers in a loading/success
        // state while the slot itself says that this attempt failed.
        return { ...failed, metadata: { ...failed.metadata, status: "error" } };
    }
    if (status === "stopped") return setCanvasResultSlotState(slot, getCurrentResultSlotVersion(slot) ? "ready" : "empty");
    return slot;
}

export type CanvasResultSlotExecutionControls = {
    busy: boolean;
    canContinue: boolean;
    regenerateWith?: "workflow" | "direct";
};

/**
 * Keeps result-slot actions consistent with the executor lifecycle. A slot
 * owned by a workflow can only regenerate through retryFrom; manual slots may
 * use the direct generator. Busy states intentionally expose neither action.
 */
export function resolveCanvasResultSlotExecutionControls(workflowStatus: WorkflowNodeStatus | undefined, slotState: CanvasResultSlotState): CanvasResultSlotExecutionControls {
    const workflowBusy = workflowStatus === "queued" || workflowStatus === "waiting_inputs" || workflowStatus === "running" || workflowStatus === "persisting";
    const slotBusy = slotState === "waiting" || slotState === "running" || slotState === "persisting";
    const busy = workflowBusy || slotBusy;
    return {
        busy,
        canContinue: !busy && workflowStatus === "waiting_review" && slotState === "ready",
        regenerateWith: busy ? undefined : workflowStatus ? "workflow" : "direct",
    };
}

export function workflowNodeOwnsGenerationStop(status?: WorkflowNodeStatus) {
    return status === "queued" || status === "running" || status === "persisting";
}

/** Appends a persisted success and selects it without overwriting history. */
export function appendResultSlotSuccess(node: CanvasNodeData, input: AppendResultSlotSuccessInput): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    assertVersionCanBeAppended(slot, input.id, input.sourceNodeId);
    if (!input.artifacts.length) throw new Error("成功版本必须至少包含一个产物");

    const artifactIds = new Set<string>();
    const artifacts = input.artifacts.map((artifact) => {
        assertNonEmptyId(artifact.id, "产物 ID");
        if (artifactIds.has(artifact.id)) throw new Error(`结果版本包含重复产物 ID：${artifact.id}`);
        artifactIds.add(artifact.id);
        if (artifact.kind !== slot.metadata.resultSlotMode || artifact.kind !== slot.type) {
            throw new Error(`产物类型 ${artifact.kind} 与 ${slot.metadata.resultSlotMode} 结果槽不兼容`);
        }
        if (!artifact.content) throw new Error(`产物 ${artifact.id} 没有可读取内容`);
        return { ...artifact };
    });
    const primaryArtifactId = input.primaryArtifactId || artifacts[0].id;
    if (!artifactIds.has(primaryArtifactId)) throw new Error(`主产物 ${primaryArtifactId} 不在当前成功版本中`);

    const version: CanvasResultSlotSuccessVersion = {
        id: input.id,
        status: "success",
        artifacts,
        primaryArtifactId,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    };

    return applySuccessfulVersion(
        {
            ...slot,
            metadata: {
                ...slot.metadata,
                resultVersions: [...slot.metadata.resultVersions, version],
                currentResultVersionId: version.id,
                slotState: "ready",
            },
        },
        version,
    );
}

/** Records a failed attempt while preserving the last successful selection. */
export function appendResultSlotFailure(node: CanvasNodeData, input: AppendResultSlotFailureInput): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    assertVersionCanBeAppended(slot, input.id, input.sourceNodeId);
    if (!input.errorDetails.trim()) throw new Error("失败版本必须包含错误原因");

    const version: CanvasResultSlotFailureVersion = {
        id: input.id,
        status: "error",
        artifacts: [],
        errorDetails: input.errorDetails,
        ...(input.createdAt ? { createdAt: input.createdAt } : {}),
        ...(input.sourceNodeId ? { sourceNodeId: input.sourceNodeId } : {}),
        ...(input.runId ? { runId: input.runId } : {}),
        ...(input.attemptId ? { attemptId: input.attemptId } : {}),
    };

    return synchronizeResultSlotSelectedOutput({
        ...slot,
        metadata: {
            ...slot.metadata,
            resultVersions: [...slot.metadata.resultVersions, version],
            slotState: "error",
            status: slot.metadata.currentResultVersionId ? "success" : "error",
            errorDetails: version.errorDetails,
        },
    });
}

/** Selects a successful historical version as the slot's readable output. */
export function selectResultSlotVersion(node: CanvasNodeData, versionId: string): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    const version = slot.metadata.resultVersions.find((candidate) => candidate.id === versionId);
    if (!version) throw new Error(`结果槽中不存在版本：${versionId}`);
    if (version.status !== "success") throw new Error(`失败版本不能设为当前结果：${versionId}`);
    return applySuccessfulVersion(
        {
            ...slot,
            metadata: { ...slot.metadata, currentResultVersionId: version.id, slotState: "ready" },
        },
        version,
    );
}

/** Deletes one attempt. Deleting the current success selects the newest remaining success. */
export function deleteResultSlotVersion(node: CanvasNodeData, versionId: string): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    const removedIndex = slot.metadata.resultVersions.findIndex((version) => version.id === versionId);
    if (removedIndex < 0) return slot;

    const removed = slot.metadata.resultVersions[removedIndex];
    const versions = slot.metadata.resultVersions.filter((version) => version.id !== versionId);
    const currentSurvives = versions.some((version) => version.status === "success" && version.id === slot.metadata.currentResultVersionId);

    if (!currentSurvives) {
        const fallback = newestSuccessfulVersion(versions);
        if (fallback) {
            return applySuccessfulVersion(
                {
                    ...slot,
                    metadata: { ...slot.metadata, resultVersions: versions, currentResultVersionId: fallback.id, slotState: "ready" },
                },
                fallback,
            );
        }
        return clearResultSlotOutput({ ...slot, metadata: { ...slot.metadata, resultVersions: versions } }, latestFailure(versions));
    }

    if (removed.status === "error" && slot.metadata.slotState === "error") {
        const latestVersion = versions[versions.length - 1];
        if (latestVersion?.status === "error") {
            return {
                ...slot,
                metadata: { ...slot.metadata, resultVersions: versions, status: "success", slotState: "error", errorDetails: latestVersion.errorDetails },
            };
        }
        const current = versions.find((version): version is CanvasResultSlotSuccessVersion => version.status === "success" && version.id === slot.metadata.currentResultVersionId);
        return current ? applySuccessfulVersion({ ...slot, metadata: { ...slot.metadata, resultVersions: versions, slotState: "ready" } }, current) : clearResultSlotOutput({ ...slot, metadata: { ...slot.metadata, resultVersions: versions } });
    }

    return { ...slot, metadata: { ...slot.metadata, resultVersions: versions } };
}

/** Deletes one candidate from a successful generation without discarding its siblings. */
export function deleteResultSlotArtifact(node: CanvasNodeData, versionId: string, artifactId: string): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    const version = slot.metadata.resultVersions.find((candidate) => candidate.id === versionId);
    if (!version || version.status !== "success" || !version.artifacts.some((artifact) => artifact.id === artifactId)) return slot;
    if (version.artifacts.length === 1) return deleteResultSlotVersion(slot, versionId);

    const artifacts = version.artifacts.filter((artifact) => artifact.id !== artifactId);
    const nextVersion: CanvasResultSlotSuccessVersion = {
        ...version,
        artifacts,
        primaryArtifactId: version.primaryArtifactId === artifactId ? artifacts[0].id : version.primaryArtifactId,
    };
    const resultVersions = slot.metadata.resultVersions.map((candidate) => (candidate.id === versionId ? nextVersion : candidate));
    const nextSlot = { ...slot, metadata: { ...slot.metadata, resultVersions } };
    return slot.metadata.currentResultVersionId === versionId ? applySuccessfulVersion(nextSlot, nextVersion) : nextSlot;
}

export function getCurrentResultSlotVersion(node: CanvasNodeData): CanvasResultSlotSuccessVersion | undefined {
    if (!isCanvasResultSlot(node) || !node.metadata.currentResultVersionId) return undefined;
    return node.metadata.resultVersions.find((version): version is CanvasResultSlotSuccessVersion => version.status === "success" && version.id === node.metadata.currentResultVersionId);
}

/** Reads the entire selected result collection and its explicit primary item. */
export function readCurrentResultSlotOutput(node: CanvasNodeData): CanvasResultSlotOutput | undefined {
    const version = getCurrentResultSlotVersion(node);
    if (!version || !isCanvasResultSlot(node)) return undefined;
    const primaryArtifact = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId);
    if (!primaryArtifact) return undefined;
    return {
        slotNodeId: node.id,
        mode: node.metadata.resultSlotMode,
        version,
        artifacts: version.artifacts,
        primaryArtifact,
    };
}

export function readCurrentResultSlotArtifacts(node: CanvasNodeData): readonly CanvasResultSlotArtifact[] {
    return readCurrentResultSlotOutput(node)?.artifacts || [];
}

/**
 * Rebuilds the legacy node payload from the selected persisted version.
 * Provider work is allowed to stage temporary values on the node, but a
 * lifecycle transition must never leave download/save actions pointing at
 * that uncommitted payload.
 */
export function synchronizeResultSlotSelectedOutput(node: CanvasNodeData): CanvasResultSlotNode {
    const slot = assertResultSlot(node);
    const version = getCurrentResultSlotVersion(slot);
    if (!version) {
        return {
            ...slot,
            metadata: {
                ...slot.metadata,
                content: "",
                storageKey: undefined,
                mimeType: undefined,
                bytes: undefined,
                naturalWidth: undefined,
                naturalHeight: undefined,
                durationMs: undefined,
                currentResultVersionId: undefined,
            },
        };
    }
    const primary = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId);
    if (!primary) throw new Error(`结果版本 ${version.id} 缺少主产物`);
    return mirrorArtifact(slot, primary);
}

export function readCurrentResultSlotArtifact(node: CanvasNodeData): CanvasResultSlotArtifact | undefined {
    return readCurrentResultSlotOutput(node)?.primaryArtifact;
}

function assertResultSlot(node: CanvasNodeData): CanvasResultSlotNode {
    if (!isCanvasResultSlot(node)) throw new Error(`节点 ${node.id} 不是有效的结果槽`);
    return node;
}

function assertVersionCanBeAppended(slot: CanvasResultSlotNode, versionId: string, sourceNodeId?: string) {
    assertNonEmptyId(versionId, "结果版本 ID");
    if (slot.metadata.resultVersions.some((version) => version.id === versionId)) throw new Error(`结果版本 ID 已存在：${versionId}`);
    if (sourceNodeId && slot.metadata.resultSlotSourceNodeId && sourceNodeId !== slot.metadata.resultSlotSourceNodeId) {
        throw new Error(`节点 ${sourceNodeId} 不能写入属于 ${slot.metadata.resultSlotSourceNodeId} 的结果槽`);
    }
}

function applySuccessfulVersion(slot: CanvasResultSlotNode, version: CanvasResultSlotSuccessVersion): CanvasResultSlotNode {
    const primary = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId);
    if (!primary) throw new Error(`结果版本 ${version.id} 缺少主产物`);
    const mirrored = mirrorArtifact(slot, primary);
    return {
        ...mirrored,
        metadata: {
            ...mirrored.metadata,
            status: "success",
            errorDetails: undefined,
            slotState: "ready",
            currentResultVersionId: version.id,
        },
    };
}

function mirrorArtifact(slot: CanvasResultSlotNode, artifact: CanvasResultSlotArtifact): CanvasResultSlotNode {
    return {
        ...slot,
        metadata: {
            ...slot.metadata,
            content: artifact.content,
            storageKey: artifact.storageKey,
            mimeType: artifact.mimeType,
            bytes: artifact.bytes,
            naturalWidth: artifact.naturalWidth,
            naturalHeight: artifact.naturalHeight,
            durationMs: artifact.durationMs,
        },
    };
}

function clearResultSlotOutput(slot: CanvasResultSlotNode, failure?: CanvasResultSlotFailureVersion): CanvasResultSlotNode {
    return {
        ...slot,
        metadata: {
            ...slot.metadata,
            content: "",
            storageKey: undefined,
            mimeType: undefined,
            bytes: undefined,
            naturalWidth: undefined,
            naturalHeight: undefined,
            durationMs: undefined,
            currentResultVersionId: undefined,
            slotState: failure ? "error" : "empty",
            status: failure ? "error" : "idle",
            errorDetails: failure?.errorDetails,
        },
    };
}

function newestSuccessfulVersion(versions: readonly CanvasResultSlotVersion[]) {
    for (let index = versions.length - 1; index >= 0; index -= 1) {
        const version = versions[index];
        if (version.status === "success") return version;
    }
    return undefined;
}

function latestFailure(versions: readonly CanvasResultSlotVersion[]) {
    for (let index = versions.length - 1; index >= 0; index -= 1) {
        const version = versions[index];
        if (version.status === "error") return version;
    }
    return undefined;
}

function legacyNodeStatus(state: CanvasResultSlotState, hasCurrentResult: boolean): CanvasNodeMetadata["status"] {
    if (state === "running" || state === "persisting") return "loading";
    if (state === "ready") return "success";
    if (state === "error") return hasCurrentResult ? "success" : "error";
    return "idle";
}

function isGenerationMode(value: unknown): value is CanvasGenerationMode {
    return value === "text" || value === "image" || value === "video" || value === "audio";
}

function isResultSlotState(value: unknown): value is CanvasResultSlotState {
    return value === "empty" || value === "waiting" || value === "running" || value === "persisting" || value === "ready" || value === "error" || value === "stale";
}

function assertNonEmptyId(value: string, label: string) {
    if (!value.trim()) throw new Error(`${label}不能为空`);
}
