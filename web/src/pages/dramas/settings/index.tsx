import { Users } from "lucide-react";
import { useMemo, useState } from "react";

import { StartTaskButton } from "@/components/drama/start-task-button";
import { useStageRuns } from "@/components/drama/run-history";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { buildCatalogue, type KindFilter } from "@/lib/drama/settings-view";
import type { DramaSnapshot } from "@/lib/drama/types";
import { Catalogue } from "./catalogue";
import { DetailPane } from "./detail-pane";
import { GraphView } from "./graph-view";
import { ProposalBlock } from "./proposal-block";
import { SettingsToolbar, type View } from "./toolbar";

/** 设定与关系: the settings task and its result, the catalogue or relation graph, and the selected setting's pane. */
export function SettingsSection({ snapshot }: { snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    const [view, setView] = useState<View>("catalogue");
    const [filter, setFilter] = useState<KindFilter>("all");
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [created, setCreated] = useState<string | null>(null);
    const { current, history } = useStageRuns(snapshot.runs, "settings");
    const counts = useMemo(() => buildCatalogue(snapshot.entities, "all").counts, [snapshot.entities]);

    const select = (id: string | null) => {
        setSelectedId(id);
        setCreated(null);
    };
    const hasSettings = snapshot.entities.length > 0;
    const firstRun = !hasSettings && !current;

    return (
        <div className="flex h-full min-h-0 flex-col">
            <SettingsToolbar
                snapshot={snapshot}
                view={view}
                onView={setView}
                filter={filter}
                onFilter={setFilter}
                counts={counts}
                hideTask={firstRun}
                onCreated={(entity) => {
                    setSelectedId(entity.id);
                    setCreated(entity.id);
                }}
            />
            <div className="flex min-h-0 flex-1">
                <div className="flex min-w-0 flex-1 flex-col">
                    <ProposalBlock snapshot={snapshot} current={current} history={history} />
                    <div className="min-h-0 flex-1">
                        {firstRun ? (
                            <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                                <Users className="size-9 text-[color:var(--wg-home-muted-strong)]" strokeWidth={1.2} />
                                <p className="!mb-0 max-w-sm text-sm text-[color:var(--wg-home-muted)]">{t("还没有设定。根据故事整理出人物、场景、道具和人物关系。")}</p>
                                <StartTaskButton snapshot={snapshot} stage="settings" label="整理设定" variant="primary" />
                            </div>
                        ) : !hasSettings ? null : view === "graph" ? (
                            <GraphView snapshot={snapshot} filter={filter} selectedId={selectedId} onSelect={select} />
                        ) : (
                            <Catalogue snapshot={snapshot} filter={filter} selectedId={selectedId} onSelect={select} />
                        )}
                    </div>
                </div>
                {hasSettings ? <DetailPane snapshot={snapshot} entityId={selectedId} focusName={created === selectedId && created !== null} onClose={() => select(null)} /> : null}
            </div>
        </div>
    );
}
