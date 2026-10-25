import { RELATION_KIND_LABELS } from "./labels.ts";
import type { DramaArtifact, DramaEntity, DramaRelation, EntityKind, RelationKind, SettingsProposal } from "./types.ts";

/** Catalogue order; props are special-cased (shown under their owner and in their own group). */
export const KIND_ORDER: readonly EntityKind[] = ["character", "scene", "prop", "world"];
export type KindFilter = "all" | EntityKind;

const key = (text: string) => text.replace(/\s+/g, "").toLowerCase();
const namesOf = (entity: Pick<DramaEntity, "name" | "aliases">) => [entity.name, ...entity.aliases].map(key);

/** Who a name, alias or short label ("E3") points at; the first hit wins. */
export function findEntity<T extends Pick<DramaEntity, "label" | "name" | "aliases" | "kind">>(entities: readonly T[], reference: string, kind?: EntityKind): T | undefined {
    const wanted = key(reference);
    if (!wanted) return undefined;
    return entities.find((entity) => key(entity.label) === wanted) ?? entities.find((entity) => (!kind || entity.kind === kind) && namesOf(entity).includes(wanted));
}

export type ChangeKind = "new" | "update";
type ProposalEntity = SettingsProposal["entities"][number];
export type ProposalRow = { item: ProposalEntity; change: ChangeKind; parent: string };
export type ProposalRelationRow = { from: string; to: string; kind: RelationKind; label: string; note: string; change: ChangeKind };
export type ProposalView = {
    groups: Array<{ kind: EntityKind; rows: ProposalRow[] }>;
    relations: ProposalRelationRow[];
    counts: { added: number; updated: number; relations: number };
};

/** An item updates an existing setting when it names one by `ref`, or has the same kind and name (or alias). Nothing is ever deleted. */
export function matchExisting(entities: readonly DramaEntity[], item: Pick<ProposalEntity, "ref" | "kind" | "name">): DramaEntity | undefined {
    if (item.ref) {
        const byRef = entities.find((entity) => key(entity.label) === key(item.ref!));
        if (byRef) return byRef;
    }
    return entities.find((entity) => entity.kind === item.kind && namesOf(entity).includes(key(item.name)));
}

/** Turns a settings proposal into the change list the review shows. */
export function classifyProposal(proposal: SettingsProposal, entities: readonly DramaEntity[], relations: readonly DramaRelation[]): ProposalView {
    const matched = proposal.entities.map((item) => matchExisting(entities, item));
    const resolve = (reference: string): { id?: string; name: string } => {
        const index = proposal.entities.findIndex((item) => namesOf(item).includes(key(reference)));
        if (index >= 0) return { id: matched[index]?.id, name: proposal.entities[index].name };
        const existing = findEntity(entities, reference);
        return { id: existing?.id, name: existing?.name ?? reference };
    };
    const rows = proposal.entities.map<ProposalRow & { kind: EntityKind }>((item, index) => ({ kind: item.kind, item, change: matched[index] ? "update" : "new", parent: item.parent ? resolve(item.parent).name : "" }));
    const groups = KIND_ORDER.map((kind) => ({ kind, rows: rows.filter((row) => row.kind === kind) })).filter((group) => group.rows.length);
    const links = proposal.relations.map<ProposalRelationRow>((relation) => {
        const from = resolve(relation.from);
        const to = resolve(relation.to);
        const known = from.id && to.id && relations.some((existing) => existing.fromId === from.id && existing.toId === to.id && existing.kind === relation.kind);
        return { from: from.name, to: to.name, kind: relation.kind, label: relation.label, note: relation.note, change: known ? "update" : "new" };
    });
    return { groups, relations: links, counts: { added: rows.filter((row) => row.change === "new").length, updated: rows.filter((row) => row.change === "update").length, relations: links.length } };
}

export const relationText = (relation: Pick<DramaRelation, "kind" | "label">) => relation.label.trim() || RELATION_KIND_LABELS[relation.kind];

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

/** The adopted, ready sheet of each entity. */
export function adoptedSheets(artifacts: readonly DramaArtifact[]): Map<string, DramaArtifact> {
    const sheets = new Map<string, DramaArtifact>();
    for (const artifact of artifacts) if (artifact.kind === "sheet" && artifact.adopted && artifact.status === "ready" && artifact.entityId) sheets.set(artifact.entityId, artifact);
    return sheets;
}

/** Newest first, as the workbench expects. */
export const sheetsOf = (artifacts: readonly DramaArtifact[], entityId: string) => artifacts.filter((artifact) => artifact.kind === "sheet" && artifact.entityId === entityId).sort((a, b) => b.createdAt - a.createdAt);
