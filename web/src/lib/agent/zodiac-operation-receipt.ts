import { normalizeZodiacCanvasOps, prepareZodiacToolProposal, type ZodiacKnownCanvasConnection, type ZodiacKnownCanvasNode } from "./zodiac-tool-proposal";

/**
 * A resolved operation list is the durable receipt for structure that may
 * already exist on the canvas. Keep its ids and meaning exact across restart;
 * live drift is validated later by the apply boundary instead of being hidden
 * by another id-remapping pass during session restore.
 */
export function restoreZodiacOperationOps(
    storedOps: unknown,
    resolvedOps: unknown,
    knownNodes: ZodiacKnownCanvasNode[] = [],
    knownConnections: ZodiacKnownCanvasConnection[] = [],
) {
    const hasResolvedReceipt = Array.isArray(resolvedOps) && resolvedOps.length > 0;
    const source = hasResolvedReceipt ? resolvedOps : storedOps;
    const normalized = normalizeZodiacCanvasOps(source);
    const valid = Array.isArray(source) && source.length > 0 && normalized.length === source.length;
    return {
        hasResolvedReceipt,
        valid,
        ops: valid
            ? hasResolvedReceipt
                ? normalized
                : prepareZodiacToolProposal(normalized, knownNodes, knownConnections, true).ops
            : [],
    };
}
