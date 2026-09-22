import type { Asset, StructuredAsset, StructuredAssetRelationship } from "@/stores/use-asset-store";

const structured = (asset: Asset): asset is StructuredAsset => asset.kind === "character" || asset.kind === "scene";

/** Reconcile a library snapshot. When editing one asset its relationship list is authoritative, including removals. */
export function synchronizeStructuredAssetRelationships(assets: Asset[], changedAssetId?: string): Asset[] {
    const byId = new Map(assets.map((asset) => [asset.id, asset]));
    const relationships = new Map<string, StructuredAssetRelationship[]>();
    const pairs = new Set<string>();
    const ordered = [...assets].sort((a, b) => (a.id === changedAssetId ? -1 : b.id === changedAssetId ? 1 : b.updatedAt.localeCompare(a.updatedAt)));
    for (const owner of ordered) {
        if (!structured(owner)) continue;
        for (const relation of owner.data.relationships || []) {
            if (!relation.targetAssetId || relation.targetAssetId === owner.id) continue;
            if (changedAssetId && owner.id !== changedAssetId && relation.targetAssetId === changedAssetId) continue;
            const key = JSON.stringify([owner.id, relation.targetAssetId].sort());
            if (pairs.has(key)) continue;
            pairs.add(key);
            const target = byId.get(relation.targetAssetId);
            const sourceAssetId = relation.sourceAssetId === owner.id || relation.sourceAssetId === relation.targetAssetId ? relation.sourceAssetId : owner.id;
            const sourceName = byId.get(sourceAssetId)?.title || relation.sourceName || (sourceAssetId === owner.id ? owner.title : relation.targetName);
            const normalized = { ...relation, sourceAssetId, sourceName, targetName: target?.title || relation.targetName };
            relationships.set(owner.id, [...(relationships.get(owner.id) || []), normalized]);
            if (target && structured(target) && target.kind === owner.kind) {
                relationships.set(target.id, [...(relationships.get(target.id) || []), { ...normalized, targetAssetId: owner.id, targetName: owner.title }]);
            }
        }
    }
    return assets.map((asset) => {
        if (!structured(asset)) return asset;
        const next = relationships.get(asset.id) || [];
        let referencePrompt = asset.data.referencePrompt;
        if (next.length && asset.data.collectionVersion === 1 && typeof referencePrompt === "string" && !referencePrompt.includes("@[node:relationships]")) {
            referencePrompt = [referencePrompt, "@[node:relationships]"].filter(Boolean).join("\n");
        }
        if (JSON.stringify(next) === JSON.stringify(asset.data.relationships || []) && referencePrompt === asset.data.referencePrompt) return asset;
        return { ...asset, ...(changedAssetId ? { updatedAt: byId.get(changedAssetId)?.updatedAt || asset.updatedAt } : {}), data: { ...asset.data, relationships: next, ...(referencePrompt === undefined ? {} : { referencePrompt }) } };
    });
}

export function removeStructuredAssetRelationships(assets: Asset[], removedId: string): Asset[] {
    return synchronizeStructuredAssetRelationships(
        assets
            .filter((asset) => asset.id !== removedId)
            .map((asset) => {
                if (!structured(asset) || !asset.data.relationships?.some((relation) => relation.targetAssetId === removedId)) return asset;
                return { ...asset, updatedAt: new Date().toISOString(), data: { ...asset.data, relationships: asset.data.relationships.filter((relation) => relation.targetAssetId !== removedId) } };
            }),
    );
}
