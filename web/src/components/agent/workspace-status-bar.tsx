import { useAppTranslation } from "@/hooks/use-app-translation";
import { useNavigate } from "react-router-dom";
import { App } from "antd";
import { useState } from "react";
import { flushAppState } from "@/services/app-lifecycle";
import { revealWorkspace } from "@/services/server-storage";
import { FolderOpen, LoaderCircle, MessageSquare } from "lucide-react";
import { useAgentStore } from "@/stores/use-agent-store";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";

/** App-level status stays visible while a workspace runs off screen. */
export function WorkspaceStatusBar() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const [exporting, setExporting] = useState(false);
    const navigate = useNavigate();
    const work = useAgentStore((state) => state.work);
    const projects = useCanvasStore((state) => state.projects);
    const working = Object.keys(work).filter((id) => Object.values(work[id]).some(Boolean));
    return (
        <footer className="wg-workspace-status relative z-[80] flex h-8 shrink-0 items-center gap-2 border-t border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-bg)] px-4" aria-label={t("工作状态")}>
            {working.length ? <LoaderCircle className="size-3.5 motion-safe:animate-spin" /> : <MessageSquare className="size-3.5 opacity-50" />}
            <span role="status">{working.length ? t("工作中 {count}", { count: working.length }) : t("就绪")}</span>
            <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto">
                {working.map((id) => (
                    <button
                        key={id}
                        className="max-w-48 shrink-0 truncate rounded px-2 py-1 hover:bg-white/10"
                        onClick={() => {
                            navigate(`/canvas/${encodeURIComponent(id)}`);
                            useAgentStore.getState().openPanel();
                        }}
                    >
                        {projects.find((project) => project.id === id)?.title || "工作流"}
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
