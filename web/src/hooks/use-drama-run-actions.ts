import { useQueryClient } from "@tanstack/react-query";
import { App } from "antd";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { dramaKey, episodeKey } from "@/hooks/use-drama";
import type { DramaRun } from "@/lib/drama/types";
import { deleteRun, updateRun } from "@/services/drama-api";
import { useDramaRuns } from "@/stores/use-drama-runs";

/** Stop / delete for run records, shared by every surface that lists runs. */
export function useDramaRunActions(dramaId: string | undefined) {
    const { t } = useAppTranslation();
    const { message, modal } = App.useApp();
    const client = useQueryClient();

    const refresh = (run?: Pick<DramaRun, "id" | "episodeId">) => {
        if (dramaId) void client.invalidateQueries({ queryKey: dramaKey(dramaId) });
        if (run?.episodeId) void client.invalidateQueries({ queryKey: episodeKey(run.episodeId) });
        if (run) void client.invalidateQueries({ queryKey: ["drama-run", run.id] });
    };

    /** Aborts the stream when this tab owns it; otherwise (orphaned run) marks it stopped directly. */
    const stop = async (run: DramaRun) => {
        const live = useDramaRuns.getState().runs[run.id];
        try {
            if (live) live.abort();
            else await updateRun(run.id, { status: "stopped" });
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("停止失败，请重试"));
        }
        refresh(run);
    };

    const remove = (run: DramaRun, onDeleted?: () => void) => {
        if (run.status === "running") return;
        modal.confirm({
            title: t("删除这条记录？"),
            content: run.status === "review" ? t("还没有采用的结果也会一并丢弃。") : undefined,
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteRun(run.id);
                    refresh(run);
                    onDeleted?.();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : t("删除失败，请重试"));
                }
            },
        });
    };

    return { stop, remove, refresh };
}
