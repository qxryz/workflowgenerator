import { resolveCanvasInputBindings } from "../../lib/canvas/canvas-input-bindings.ts";
import type { CanvasResourceReference } from "../../lib/canvas/canvas-resource-references";

export function missingCanvasReference(nodeId: string): CanvasResourceReference {
    return { id: nodeId, nodeId, kind: "text", label: "引用已失效", title: "引用的素材已移除或尚未连接", ready: false, active: false };
}

export function canvasReferenceCaption(reference: CanvasResourceReference) {
    return reference.bindingKind ? `${reference.label} · ${reference.title.replace(/^(?:人物|角色|场景)\s*·\s*/u, "")}` : reference.kind === "text" ? reference.text || reference.title : reference.label;
}

export function canvasReferenceLookup(references: CanvasResourceReference[], fallback: CanvasResourceReference[] = []) {
    const map = new Map(fallback.map((reference) => [reference.nodeId, reference]));
    const seen = new Set<CanvasResourceReference>();
    const addMember = (reference: CanvasResourceReference) => {
        if (seen.has(reference)) return;
        seen.add(reference);
        reference.members?.forEach(addMember);
        if (!map.has(reference.nodeId)) map.set(reference.nodeId, reference);
    };
    references.forEach((reference) => {
        reference.members?.forEach(addMember);
        map.set(reference.nodeId, reference);
    });
    return map;
}

export function selectedCanvasReferenceCounts(references: CanvasResourceReference[], prompt: string) {
    const inputs = new Map<string, { nodeId: string; kind: CanvasResourceReference["kind"]; ready: boolean; bindingNodeIds: string[] }>();
    const append = (reference: CanvasResourceReference, bindingIds: string[], parents = new Set<CanvasResourceReference>()) => {
        if (parents.has(reference)) return;
        if (reference.members?.length) {
            const nextParents = new Set(parents).add(reference);
            reference.members.forEach((member) => append(member, [...bindingIds, reference.nodeId], nextParents));
            if (reference.ready) return;
            // Keep a pending group unresolved even if its available members are ready.
        }
        const existing = inputs.get(reference.nodeId);
        inputs.set(reference.nodeId, {
            nodeId: reference.nodeId,
            kind: reference.kind,
            ready: reference.ready && reference.active && (existing?.ready ?? true),
            bindingNodeIds: [...new Set([...(existing?.bindingNodeIds || []), ...bindingIds])],
        });
    };
    references.filter((reference) => reference.active).forEach((reference) => append(reference, []));
    const { selectedInputs } = resolveCanvasInputBindings([...inputs.values()], prompt);
    return {
        images: selectedInputs.filter((reference) => reference.kind === "image").length,
        videos: selectedInputs.filter((reference) => reference.kind === "video").length,
        audios: selectedInputs.filter((reference) => reference.kind === "audio").length,
    };
}
