import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { ArrowUpRight, Trash2, FolderOpen, MessageSquare, Plus, Settings2, Shapes, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useConfigStore } from "@/stores/use-config-store";

export default function IndexPage() {
    const navigate = useNavigate();
    const projects = useCanvasStore((state) => state.projects);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const recent = useMemo(() => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 6), [projects]);
    const create = () => {
        useAgentStore.getState().openPanel();
        navigate("/canvas?mode=new");
    };
    return (
        <main className="h-full overflow-auto bg-[color:var(--wg-home-bg)] px-8 pb-10 pt-24 text-[color:var(--wg-home-text)]">
            <div className="mx-auto max-w-5xl">
                <div className="mb-10 flex items-center justify-between gap-6">
                    <div className="flex items-center gap-4">
                        <ZodiacAvatar className="size-12" />
                        <div>
                            <h1 className="text-2xl font-semibold tracking-tight">工作空间</h1>
                            <p className="mt-1 text-sm text-[color:var(--wg-home-muted)]">画布、素材与对话</p>
                        </div>
                    </div>
                    <button type="button" onClick={create} className="inline-flex items-center gap-2 rounded-lg bg-[color:var(--wg-home-accent)] px-4 py-2.5 text-sm font-medium text-[color:var(--wg-home-accent-text)]">
                        <Plus className="size-4" />
                        新建画布
                    </button>
                </div>
                <div className="mb-12 grid gap-3 sm:grid-cols-3">
                    {[
                        { title: "开始创作", detail: "写文案、生成素材、编排工作流", icon: Sparkles, action: create },
                        { title: "继续对话", detail: "打开已保存的创作记录", icon: MessageSquare, action: () => navigate("/sessions") },
                        { title: "素材库", detail: "管理和复用创作素材", icon: Shapes, action: () => navigate("/assets") },
                    ].map((item) => (
                        <button type="button" key={item.title} onClick={item.action} className="group rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-5 text-left transition-colors hover:bg-[color:var(--wg-home-hover)]">
                            <item.icon className="mb-5 size-5 text-[color:var(--wg-home-accent)]" />
                            <div className="flex items-center justify-between text-sm font-medium">
                                {item.title}
                                <ArrowUpRight className="size-4 opacity-40 group-hover:opacity-100" />
                            </div>
                            <p className="mt-2 text-xs text-[color:var(--wg-home-muted)]">{item.detail}</p>
                        </button>
                    ))}
                </div>
                <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-sm font-semibold">最近画布</h2>
                    <button type="button" className="text-xs text-[color:var(--wg-home-muted)] hover:underline" onClick={() => navigate("/canvas")}>
                        查看全部
                    </button>
                </div>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {recent.map((project) => (
                        <div key={project.id} className="group relative rounded-xl border border-[color:var(--wg-home-line)] transition-colors hover:bg-[color:var(--wg-home-hover)]"><button type="button" onClick={() => navigate(`/canvas/${project.id}`)} className="w-full p-5 text-left">
                            <FolderOpen className="mb-6 size-5 opacity-40" />
                            <p className="truncate text-sm font-medium">{project.title}</p>
                            <p className="mt-2 text-xs opacity-45">{new Date(project.updatedAt).toLocaleDateString()}</p>
                        </button><button type="button" aria-label={`删除 ${project.title}`} className="absolute right-3 top-3 rounded p-2 text-red-500 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => useCanvasUiStore.getState().setDeleteProjectIds([project.id])}><Trash2 className="size-4" /></button></div>
                    ))}
                </div>
                {hydrated && !recent.length ? <div className="rounded-xl border border-dashed border-[color:var(--wg-home-line)] py-12 text-center text-sm opacity-50">创建画布，开始一段创作。</div> : null}
                <button type="button" className="mt-8 inline-flex items-center gap-2 text-xs text-[color:var(--wg-home-muted)] hover:underline" onClick={() => useConfigStore.getState().openConfigDialog(true, "channels")}>
                    <Settings2 className="size-3.5" />
                    模型与渠道
                </button>
            </div>
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
