import type { CanvasProject } from "@/stores/canvas/use-canvas-store";
import { CanvasNodeType, type CanvasNodeData } from "@/types/canvas";

export function portableCanvasProject(project: CanvasProject): CanvasProject {
    return { ...project, nodes: project.nodes.map(portableCanvasNode) };
}

export function portableCanvasNode(node: CanvasNodeData): CanvasNodeData {
    if (node.type !== CanvasNodeType.Terminal || !node.metadata) return node;
    const {
        terminalDirectory: _terminalDirectory,
        terminalOutput: _terminalOutput,
        terminalImportedArtifactPaths: _terminalImportedArtifactPaths,
        terminalImportedArtifactSignatures: _terminalImportedArtifactSignatures,
        terminalOutputRevision: _terminalOutputRevision,
        ...metadata
    } = node.metadata;
    return {
        ...node,
        metadata: {
            ...metadata,
            terminalConfigured: false,
            terminalOutputValue: redactLocalPaths(metadata.terminalOutputValue),
        },
    };
}

function redactLocalPaths(value?: string) {
    if (!value) return value;
    return value
        .replace(/(^|[\s("'`])\/(?:[^\s"'`，。；;,]+\/)*([^\s/"'`，。；;,]+)/gmu, "$1./$2")
        .replace(/(^|[\s("'`])[a-z]:\\(?:[^\s"'`，。；;,\\]+\\)*([^\s"'`，。；;,\\]+)/gim, "$1.\\$2");
}
