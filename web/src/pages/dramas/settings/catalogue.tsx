import { useMemo } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { ENTITY_GROUP_LABELS } from "@/lib/drama/labels";
import { adoptedSheets } from "@/lib/drama/media/references";
import { buildCatalogue, type KindFilter } from "@/lib/drama/settings-view";
import type { DramaSnapshot } from "@/lib/drama/types";
import { EntityCard } from "./entity-card";

type Props = { snapshot: DramaSnapshot; filter: KindFilter; selectedId: string | null; onSelect: (id: string) => void };

export function Catalogue({ snapshot, filter, selectedId, onSelect }: Props) {
    const { t } = useAppTranslation();
    const { entities, artifacts } = snapshot;
    const catalogue = useMemo(() => buildCatalogue(entities, filter), [entities, filter]);
    const sheets = useMemo(() => adoptedSheets(artifacts), [artifacts]);
    const byId = useMemo(() => new Map(entities.map((entity) => [entity.id, entity])), [entities]);
    if (!catalogue.sections.length) return <p className="!mb-0 grid h-full place-items-center text-sm text-[color:var(--wg-home-muted)]">{t("这一类还没有设定")}</p>;
    return (
        <div className="thin-scrollbar h-full overflow-y-auto px-5 py-5">
            <div className="flex flex-col gap-7">
                {catalogue.sections.map((section) => (
                    <section key={section.kind}>
                        <h3 className="mb-3 flex items-baseline gap-2 text-[13px] font-semibold">
                            {t(section.unowned ? "未归属的道具陈设" : ENTITY_GROUP_LABELS[section.kind])}
                            <span className="font-normal tabular-nums text-[color:var(--wg-home-muted)]">{section.entities.length}</span>
                        </h3>
                        <div className="grid grid-cols-[repeat(auto-fill,minmax(210px,1fr))] gap-4">
                            {section.entities.map((entity) => (
                                <EntityCard
                                    key={entity.id}
                                    entity={entity}
                                    sheet={sheets.get(entity.id)}
                                    selected={entity.id === selectedId}
                                    selectedId={selectedId}
                                    props={catalogue.owned.get(entity.id)}
                                    owner={entity.kind === "prop" && entity.parentId ? byId.get(entity.parentId) : undefined}
                                    onSelect={onSelect}
                                />
                            ))}
                        </div>
                    </section>
                ))}
            </div>
        </div>
    );
}
