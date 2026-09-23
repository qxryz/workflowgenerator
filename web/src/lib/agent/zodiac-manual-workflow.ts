import type { CanvasAgentOp } from "../canvas/canvas-agent-ops";
import type { CanvasGenerationMode, CanvasNodeMetadata } from "../../types/canvas";

/** Conversation proposals prepare a workflow. Running and model selection belong to the user. */
export function prepareZodiacManualOps(ops: CanvasAgentOp[], defaults: Partial<Record<CanvasGenerationMode, string>> = {}): CanvasAgentOp[] {
    const metadata = (value?: CanvasNodeMetadata, newNode = false) => {
        if (!value) return value;
        const { model: _suggestedModel, ...rest } = value;
        const selected = newNode && rest.generationMode ? defaults[rest.generationMode] : undefined;
        return { ...rest, ...(selected ? { model: selected } : {}) };
    };
    const structure = ops.filter(op => op.type !== "run_generation").map((op): CanvasAgentOp => {
        if (op.type === "add_node") return { ...op, metadata: metadata(op.metadata, true) };
        if (op.type === "update_node") return { ...op, metadata: metadata(op.metadata), ...(op.patch ? { patch: { ...op.patch, metadata: metadata(op.patch.metadata) } } : {}) };
        return op;
    });
    // Preserve prompts attached to old run operations without starting a request.
    return [...structure, ...ops.flatMap((op): CanvasAgentOp[] => op.type === "run_generation" ? [{
        type: "update_node", id: op.nodeId,
        metadata: { ...(op.mode ? { generationMode: op.mode } : {}), ...(op.prompt?.trim() ? { prompt: op.prompt, composerContent: op.prompt } : {}) },
    }] : [])];
}
