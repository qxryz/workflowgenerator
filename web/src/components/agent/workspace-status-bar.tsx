import { useAppTranslation } from "@/hooks/use-app-translation";
import { useNavigate } from "react-router-dom";
import { App } from "antd";
import { useState, useSyncExternalStore } from "react";
import { flushAppState } from "@/services/app-lifecycle";
import { pendingWriteCount, revealWorkspace, subscribePendingWrites } from "@/services/server-storage";
import { CircleAlert, Clock3, FolderOpen, LoaderCircle, MessageSquare } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { WORKSPACE_STATUS_LABELS, workspaceStatusCounts, workspaceStatusIsRunning, workspaceWorkStatuses } from "@/lib/agent/workspace-status";

/** App-level status stays visible while a workspace runs off screen. */
export function WorkspaceStatusBar() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const [exporting, setExporting] = useState(false);
    const navigate = useNavigate();
    const work = useAgentStore((state) => state.work);
    const activities = useAgentStore((state) => state.activities);
    const projects = useCanvasStore((state) => state.projects);
    const writes = useSyncExternalStore(subscribePendingWrites, pendingWriteCount, pendingWriteCount);
    const working = Object.keys(work).flatMap((id) => {
        const statuses = workspaceWorkStatuses(work[id]);
        return statuses.length ? [{ id, statuses }] : [];
    });
    const tasks = Object.values(activities);
    const counts = workspaceStatusCounts([...working.flatMap((item) => item.statuses), ...tasks.map((task) => task.status)], writes);
    const running = counts.some(({ status }) => workspaceStatusIsRunning(status));
    const statusText = counts.length ? counts.map(({ status, count }) => t(WORKSPACE_STATUS_LABELS[status], { count })).join(" · ") : t("就绪");
    return (
        <footer className="wg-workspace-status relative z-[80] flex h-8 shrink-0 items-center gap-2 border-t border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-bg)] px-4" aria-label={t("工作状态")}>
            {running ? <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" /> : counts.some(({ status }) => status === "attention") ? <CircleAlert className="size-3.5 shrink-0" /> : counts.length ? <Clock3 className="size-3.5 shrink-0" /> : <MessageSquare className="size-3.5 shrink-0 opacity-50" />}
            <span role="status" className="max-w-[45%] truncate" title={statusText}>{statusText}</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                {working.map(({ id, statuses }) => (
                    <button
                        key={`workspace-${id}`}
                        className="max-w-48 shrink-0 truncate rounded px-2 py-1 hover:bg-white/10"
                        onClick={() => {
                            navigate(`/canvas/${encodeURIComponent(id)}`);
                            useAgentStore.getState().openPanel();
                        }}
                    >
                        {projects.find((project) => project.id === id)?.title || t("工作流")} · {statuses.map((status) => t(WORKSPACE_STATUS_LABELS[status], { count: 1 })).join(" · ")}
                    </button>
                ))}
                {tasks.map((task) => (
                    <button key={`activity-${task.id}`} className="max-w-48 shrink-0 truncate rounded px-2 py-1 hover:bg-white/10" title={t(task.title)} onClick={() => navigate(task.route)}>
                        {t(task.title)}
                    </button>
                ))}
            </div>
            <button
                disabled={exporting}
                title={t("在访达中查看 Zodiac 工作空间")}
                className="wg-text-button disabled:opacity-50"
                onClick={async () => {
                    setExporting(true);
                    try {
                        await flushAppState();
                        await revealWorkspace();
                    } catch (error) {
                        message.error(error instanceof Error ? error.message : "无法打开工作空间");
                    } finally {
                        setExporting(false);
                    }
                }}
            >
                {exporting ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <FolderOpen className="size-3.5" />}
                <span>{t("工作空间")}</span>
            </button>
        </footer>
    );
}
