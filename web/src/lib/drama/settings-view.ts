import type { DramaArtifact, DramaEntity, EntityKind, RelationKind, SettingsProposal } from "./types.ts";

/** Catalogue order; props are special-cased (shown under their owner and in their own group). */
export const KIND_ORDER: readonly EntityKind[] = ["character", "scene", "prop", "world"];
export type KindFilter = "all" | EntityKind;

/** Short labels ("E3") only reach the screen as the names they stand for. */
const nameOf = (entities: readonly Pick<DramaEntity, "label" | "name">[], reference: string) => entities.find((entity) => entity.label.toLowerCase() === reference.trim().toLowerCase())?.name ?? reference;

export type ChangeKind = "new" | "update";
type ProposalEntity = SettingsProposal["entities"][number];
export type ProposalRow = { item: ProposalEntity; change: ChangeKind; parent: string };
export type ProposalRelationRow = { from: string; to: string; kind: RelationKind; label: string; note: string };
export type ProposalView = {
    groups: Array<{ kind: EntityKind; rows: ProposalRow[] }>;
    relations: ProposalRelationRow[];
    counts: { added: number; updated: number; relations: number };
};

/**
 * What a settings result shows. The server decides what updates what and marks every item it will update
 * with `ref`, so "ref present" is the whole rule here; nothing is ever deleted.
 */
export function proposalView(proposal: SettingsProposal, entities: readonly DramaEntity[]): ProposalView {
    const rows = proposal.entities.map<ProposalRow>((item) => ({ item, change: item.ref ? "update" : "new", parent: item.parent ? nameOf(entities, item.parent) : "" }));
    const groups = KIND_ORDER.map((kind) => ({ kind, rows: rows.filter((row) => row.item.kind === kind) })).filter((group) => group.rows.length);
    const relations = proposal.relations.map<ProposalRelationRow>((relation) => ({ ...relation, from: nameOf(entities, relation.from), to: nameOf(entities, relation.to) }));
    const updated = rows.filter((row) => row.change === "update").length;
    return { groups, relations, counts: { added: rows.length - updated, updated, relations: relations.length } };
}

export type Catalogue = {
    sections: Array<{ kind: EntityKind; entities: DramaEntity[]; unowned?: boolean }>;
    /** Props listed under their owner card. */
    owned: Map<string, DramaEntity[]>;
    counts: Record<KindFilter, number>;
};

const isOwner = (entity: DramaEntity | undefined): entity is DramaEntity => entity?.kind === "character" || entity?.kind === "scene";

/** "全部" lists every kind but shows props only where they have no owner card; the 道具陈设 filter lists all props. */
export function buildCatalogue(entities: readonly DramaEntity[], filter: KindFilter): Catalogue {
    const byId = new Map(entities.map((entity) => [entity.id, entity]));
    const owned = new Map<string, DramaEntity[]>();
    for (const entity of entities) {
        const owner = entity.kind === "prop" && entity.parentId ? byId.get(entity.parentId) : undefined;
        if (isOwner(owner)) owned.set(owner.id, [...(owned.get(owner.id) ?? []), entity]);
    }
    const hasOwner = (entity: DramaEntity) => entity.kind === "prop" && Boolean(entity.parentId && isOwner(byId.get(entity.parentId)));
    const sections = KIND_ORDER.flatMap((kind) => {
        if (filter !== "all" && filter !== kind) return [];
        const unowned = kind === "prop" && filter === "all";
        const list = entities.filter((entity) => entity.kind === kind && !(unowned && hasOwner(entity)));
        return list.length ? [{ kind, entities: list, ...(unowned ? { unowned: true } : {}) }] : [];
    });
    const counts: Record<KindFilter, number> = { all: entities.length, character: 0, scene: 0, prop: 0, world: 0 };
    for (const entity of entities) counts[entity.kind] += 1;
    return { sections, owned, counts };
}

/** Newest first, as the workbench expects. */
export const sheetsOf = (artifacts: readonly DramaArtifact[], entityId: string) => artifacts.filter((artifact) => artifact.kind === "sheet" && artifact.entityId === entityId).sort((a, b) => b.createdAt - a.createdAt);
