import type { NodeGenerationInput } from "../../components/canvas/canvas-node-generation";
import type { CanvasNodeData, CanvasResultSlotArtifact, CanvasResultSlotSuccessVersion } from "../../types/canvas";
import type { CanvasWorkflowSourceSnapshot } from "./canvas-workflow-graph";
import type { WorkflowNodeInput } from "./workflow-execution";

export type ResolveCanvasWorkflowInputsOptions = {
    sourceSnapshot: readonly CanvasWorkflowSourceSnapshot[];
    /** Inputs read once from the canvas snapshot used to compile this run. */
    frozenInputs: readonly NodeGenerationInput[];
    frozenNodes: readonly CanvasNodeData[];
    /** Live canvas nodes so downstream steps pick up edits made after the run was compiled. */
    liveNodes?: readonly CanvasNodeData[];
    /** Persisted outputs produced inside this exact executor run. */
    workflowInputs: readonly WorkflowNodeInput<CanvasResultSlotArtifact>[];
};

/**
 * Resolves every workflow input from immutable run data. It intentionally has
 * no access to the live canvas, so selecting a different historical version
 * while a guided run is paused cannot change what its downstream steps read.
 */
export function resolveCanvasWorkflowGenerationInputs(options: ResolveCanvasWorkflowInputsOptions): NodeGenerationInput[] {
    const frozenInputsByNodeId = groupByNodeId(options.frozenInputs);
    const frozenNodeById = new Map(options.frozenNodes.map((node) => [node.id, node]));
    const liveNodeById = options.liveNodes ? new Map(options.liveNodes.map((node) => [node.id, node])) : undefined;
    const workflowInputByActionId = new Map(options.workflowInputs.map((input) => [input.nodeId, input]));
    const resolved: NodeGenerationInput[] = [];

    for (const source of options.sourceSnapshot) {
        if (source.resolution === "workflow") {
            const workflowInput = source.sourceActionNodeId ? workflowInputByActionId.get(source.sourceActionNodeId) : undefined;
            if (!workflowInput) throw new Error("本次运行的上游结果尚未就绪");
            resolved.push(...artifactInputs(source.sourceNodeId, workflowInput.artifacts));
            continue;
        }

        if (source.versionId) {
            // 上游来源有多个版本资产时，优先取该来源最后一个有效（成功）版本；编辑后
            // 新追加的版本会在 liveNodes 中可见，从而及时同步给下游。
            const node = (liveNodeById?.get(source.sourceNodeId)) || frozenNodeById.get(source.sourceNodeId);
            const version = lastSuccessfulVersion(node) || successfulVersion(node, source.versionId);
            if (!version) throw new Error("本次运行锁定的上游版本已不可用，请重新开始工作流");
            resolved.push(...artifactInputs(source.sourceNodeId, orderedVersionArtifacts(version)));
            continue;
        }

        resolved.push(...(frozenInputsByNodeId.get(source.sourceNodeId) || []));
    }

    return resolved;
}

function groupByNodeId(inputs: readonly NodeGenerationInput[]) {
    const grouped = new Map<string, NodeGenerationInput[]>();
    for (const input of inputs) {
        const items = grouped.get(input.nodeId) || [];
        items.push(input);
        grouped.set(input.nodeId, items);
    }
    return grouped;
}

function successfulVersion(node: CanvasNodeData | undefined, versionId: string) {
    return node?.metadata?.resultVersions?.find((version): version is CanvasResultSlotSuccessVersion => version.id === versionId && version.status === "success");
}

function lastSuccessfulVersion(node: CanvasNodeData | undefined) {
    const versions = node?.metadata?.resultVersions || [];
    for (let index = versions.length - 1; index >= 0; index -= 1) {
        const version = versions[index];
        if (version.status === "success") return version;
    }
    return undefined;
}

function orderedVersionArtifacts(version: CanvasResultSlotSuccessVersion) {
    const primary = version.artifacts.find((artifact) => artifact.id === version.primaryArtifactId);
    return primary ? [primary, ...version.artifacts.filter((artifact) => artifact.id !== primary.id)] : version.artifacts;
}

function artifactInputs(sourceNodeId: string, artifacts: readonly CanvasResultSlotArtifact[]): NodeGenerationInput[] {
    return artifacts.map((artifact, index) => {
        const nodeId = index === 0 ? sourceNodeId : `${sourceNodeId}::artifact:${artifact.id}`;
        const title = artifact.title || `结果 ${index + 1}`;
        const ready = Boolean(artifact.content || artifact.storageKey);
        if (artifact.kind === "image") {
            return {
                nodeId,
                type: "image",
                title,
                ready,
                image: ready
                    ? {
                          id: artifact.id,
                          name: `${title}.png`,
                          type: artifact.mimeType || "image/png",
                          dataUrl: artifact.content,
                          storageKey: artifact.storageKey,
                      }
                    : undefined,
            };
        }
        if (artifact.kind === "video") {
            return {
                nodeId,
                type: "video",
                title,
                ready,
                video: ready
                    ? {
                          id: artifact.id,
                          name: `${title}.mp4`,
                          type: artifact.mimeType || "video/mp4",
                          url: artifact.content,
                          storageKey: artifact.storageKey,
                          bytes: artifact.bytes,
                          width: artifact.naturalWidth,
                          height: artifact.naturalHeight,
                          durationMs: artifact.durationMs,
                      }
                    : undefined,
            };
        }
        if (artifact.kind === "audio") {
            return {
                nodeId,
                type: "audio",
                title,
                ready,
                audio: ready
                    ? {
                          id: artifact.id,
                          name: `${title}.mp3`,
                          type: artifact.mimeType || "audio/mpeg",
                          url: artifact.content,
                          storageKey: artifact.storageKey,
                          durationMs: artifact.durationMs,
                      }
                    : undefined,
            };
        }
        return { nodeId, type: "text", title, ready, text: ready ? artifact.content : undefined };
    });
}
