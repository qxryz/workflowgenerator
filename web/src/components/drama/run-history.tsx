/**
 * Run history for one section.
 *
 * `useStageRuns(runs, stage, match?)` -> `{ current?: DramaRun; history: DramaRun[] }`
 *   current = the live run, else the newest awaiting review, else the newest; history = all matching runs, newest first.
 *   `match` narrows by scope (e.g. `(r) => r.scope.ord === 3`); keep it referentially stable (useCallback) or accept a recompute.
 *
 * `RunHistory({ runs, selectedId, onSelect, dramaId? })` -> compact Select (time + StatusTag per run) with a delete icon to its right.
 *   runs: pass `history` from useStageRuns. selectedId: if it is not in `runs`, the Select shows nothing selected; parents should fall back to `current`.
 *   Running runs cannot be deleted. Deleting asks for confirmation. dramaId defaults to the :id route param.
 */
import { Trash2 } from "lucide-react";
import { useMemo } from "react";
import { useParams } from "react-router-dom";
import { Select } from "antd";

import { StatusTag } from "@/components/drama/status-tag";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useDramaRunActions } from "@/hooks/use-drama-run-actions";
import { formatClock } from "@/lib/drama/format";
import { pickStageRuns } from "@/lib/drama/stage-runs";
import type { DramaRun, RunStage } from "@/lib/drama/types";

export function useStageRuns(runs: readonly DramaRun[], stage: RunStage, match?: (run: DramaRun) => boolean) {
    return useMemo(() => pickStageRuns(runs, stage, match), [runs, stage, match]);
}

type Props = { runs: readonly DramaRun[]; selectedId: string | undefined; onSelect: (id: string) => void; dramaId?: string };

export function RunHistory({ runs, selectedId, onSelect, dramaId }: Props) {
    const { t } = useAppTranslation();
    const params = useParams();
    const { remove } = useDramaRunActions(dramaId ?? params.id);
    const selected = runs.find((run) => run.id === selectedId);
    if (!runs.length) return null;
    return (
        <div className="flex items-center gap-1">
            <Select
                size="small"
                className="min-w-52"
                value={selected?.id}
                placeholder={t("历史记录")}
                onChange={onSelect}
                popupMatchSelectWidth={false}
                options={runs.map((run) => ({
                    value: run.id,
                    label: (
                        <span className="flex items-center justify-between gap-3">
                            <span className="tabular-nums">{formatClock(run.createdAt)}</span>
                            <StatusTag status={run.status} />
                        </span>
                    ),
                }))}
            />
            <button type="button" className="wg-icon-button !size-7" disabled={!selected || selected.status === "running"} title={selected?.status === "running" ? t("运行中的记录不能删除") : t("删除这条记录")} aria-label={t("删除这条记录")} onClick={() => selected && remove(selected)}>
                <Trash2 className="!size-4" strokeWidth={1.6} />
            </button>
        </div>
    );
}
