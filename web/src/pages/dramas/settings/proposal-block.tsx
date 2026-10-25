import { useEffect, useState } from "react";

import { ProposalShell } from "@/components/drama/proposal-shell";
import { RunHistory } from "@/components/drama/run-history";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { formatClock } from "@/lib/drama/format";
import type { DramaRun, DramaSnapshot, SettingsProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { SettingsProposalView } from "./proposal-view";

type Props = { snapshot: DramaSnapshot; current: DramaRun | undefined; history: DramaRun[]; /** The relation graph gets the whole section unless the task needs attention. */ graph: boolean };

/** The settings task and its result in one place: live while running, the change list while waiting, a collapsed record afterwards. */
export function ProposalBlock({ snapshot, current, history, graph }: Props) {
    const { t } = useAppTranslation();
    const [picked, setPicked] = useState<string>();
    useEffect(() => setPicked(undefined), [current?.id]);
    const run = history.find((item) => item.id === picked) ?? current;
    if (!run || (graph && (run.status === "accepted" || run.status === "rejected" || run.status === "stopped"))) return null;
    const reviewing = run.status === "review";
    return (
        <div className={cn("flex shrink-0 items-start gap-2 px-5 pt-4", reviewing ? (snapshot.entities.length ? "max-h-[62%]" : "max-h-[86%]") : "max-h-[50%]")}>
            <div className="flex min-h-0 max-h-full min-w-0 flex-1 flex-col">
                <ProposalShell key={run.id} run={run} title={t("设定整理 · {time}", { time: formatClock(run.createdAt) })} defaultExpanded={Boolean(picked) && picked !== current?.id}>
                    {(proposal) => <SettingsProposalView proposal={proposal as SettingsProposal} snapshot={snapshot} settled={!reviewing} />}
                </ProposalShell>
            </div>
            {history.length > 1 || (history.length === 1 && run.status !== "running") ? (
                <div className="pt-2.5">
                    <RunHistory runs={history} selectedId={run.id} onSelect={setPicked} dramaId={snapshot.project.id} />
                </div>
            ) : null}
        </div>
    );
}
