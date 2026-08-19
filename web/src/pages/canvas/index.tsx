import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { App } from "antd";
import { Add01Icon, Delete02Icon, Download01Icon, Search01Icon, Upload01Icon } from "hugeicons-react";

import { readZip } from "@/lib/zip";
import { setAssetFileBlob } from "@/services/asset-file-storage";
import { setMediaBlob } from "@/services/file-storage";
import { setImageBlob } from "@/services/image-storage";
import { CanvasDeleteProjectsDialog } from "@/components/canvas/canvas-delete-projects-dialog";
import { CanvasProjectCard } from "@/components/canvas/canvas-project-card";
import type { CanvasExportFile } from "@/types/canvas-export";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";
import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { useAppTranslation } from "@/hooks/use-app-translation";

export default function CanvasPage() {
    const { message } = App.useApp();
    const { t } = useAppTranslation();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const inputRef = useRef<HTMLInputElement>(null);
    const autoOpenRef = useRef(false);
    const [query, setQuery] = useState("");
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const createProject = useCanvasStore((state) => state.createProject);
    const importProject = useCanvasStore((state) => state.importProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const filteredProjects = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return projects;
        return projects.filter((project) => project.title.toLocaleLowerCase().includes(keyword));
    }, [projects, query]);

    const mode = searchParams.get("mode");
    const agentMode = mode === "new" || mode === "recent" || mode === "choose";
    const agentQuery = agentMode ? `?${searchParams.toString()}` : "";
    const enterProject = (id: string) => {
        navigate(`/canvas/${id}${agentQuery}`);
    };
    const defaultProjectTitle = () => t("工作流 {number}", { number: projects.length + 1 });
    const createAndEnter = () => enterProject(createProject(defaultProjectTitle()));
    const importCanvas = async (file?: File) => {
        if (!file) return;
        try {
            const zip = await readZip(file);
            const projectFile = zip.get("projects.json");
            if (!projectFile) throw new Error("missing projects.json");
            const data = JSON.parse(await projectFile.text()) as CanvasExportFile;
            await Promise.all(
                data.projects.flatMap((project) =>
                    project.files.map(async (item) => {
                        const blob = zip.get(item.path);
                        if (!blob) return;
                        const typedBlob = blob.type ? blob : blob.slice(0, blob.size, item.mimeType);
                        await (item.storageKey.startsWith("image:") ? setImageBlob(item.storageKey, typedBlob) : item.storageKey.startsWith("file:") ? setAssetFileBlob(item.storageKey, typedBlob) : setMediaBlob(item.storageKey, typedBlob));
                    }),
                ),
            );
            data.projects.forEach((item) => importProject(item.project));
            message.success(t("已导入 {count} 个画布", { count: data.projects.length }));
        } catch {
            message.error(t("导入失败，请选择有效的画布压缩包"));
        } finally {
            if (inputRef.current) inputRef.current.value = "";
        }
    };

    useEffect(() => {
        if (!hydrated || autoOpenRef.current || (mode !== "new" && mode !== "recent")) return;
        autoOpenRef.current = true;
        enterProject(mode === "new" ? createProject(defaultProjectTitle()) : projects[0]?.id || createProject(defaultProjectTitle()));
    }, [createProject, hydrated, mode, projects]);

    if (hydrated && (mode === "new" || mode === "recent")) return <main className="flex h-full items-center justify-center bg-[color:var(--wg-surface)] text-sm text-[#637083] dark:text-[#aeb7c5]">{t("正在打开工作区...")}</main>;

    return (
        <main className="wg-paper-surface flex h-full min-w-0 flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="flex min-h-[68px] shrink-0 items-center gap-4 border-b border-dashed border-[color:var(--wg-pencil-soft)] px-5 lg:px-7">
                <div className="min-w-0">
                    <h1 className="wg-sketch-title text-[21px] font-semibold">{t("工作流")}</h1>
                    <p className="wg-ascii-label mt-0.5 text-[9px] tabular-nums text-[color:var(--wg-home-muted-strong)]">PROJECTS / {String(projects.length).padStart(2, "0")}</p>
                </div>

                <label className="ml-auto hidden h-9 w-[min(28vw,300px)] items-center gap-2 rounded-[9px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-3 text-[color:var(--wg-home-muted)] focus-within:border-[color:var(--wg-home-accent)] focus-within:ring-2 focus-within:ring-[color:var(--wg-home-accent)]/10 sm:flex">
                    <Search01Icon className="size-4 shrink-0" strokeWidth={1.7} />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder={t("搜索工作流")}
                        className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--wg-home-text)] outline-none placeholder:text-[color:var(--wg-home-muted-strong)]"
                    />
                </label>

                <div className="flex shrink-0 items-center gap-1">
                        {selectedIds.length ? (
                            <>
                                <button type="button" disabled={!hydrated} className="inline-flex h-9 items-center gap-2 rounded-[9px] px-3 text-[12px] font-medium text-[color:var(--wg-home-muted)] hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)] disabled:opacity-50" onClick={() => void exportCanvasProjects(projects.filter((project) => selectedIds.includes(project.id)), `WorkflowGenerator-${selectedIds.length}个项目`)}>
                                    <Download01Icon className="size-4" strokeWidth={1.7} />
                                    <span className="hidden xl:inline">{t("导出")}</span>
                                </button>
                                <button type="button" disabled={!hydrated} className="inline-flex h-9 items-center gap-2 rounded-[9px] px-3 text-[12px] font-medium text-destructive hover:bg-destructive/10 disabled:opacity-50" onClick={() => setDeleteIds(selectedIds)}>
                                    <Delete02Icon className="size-4" strokeWidth={1.7} />
                                    <span className="hidden xl:inline">{t("删除")}</span>
                                </button>
                            </>
                        ) : null}
                        <button type="button" disabled={!hydrated} className="wg-sketch-button-quiet inline-flex h-9 items-center gap-2 px-3 text-[12px] font-medium text-[color:var(--wg-home-muted)] disabled:opacity-50" onClick={() => inputRef.current?.click()}>
                            <Upload01Icon className="size-4" strokeWidth={1.7} />
                            <span className="hidden lg:inline">{t("导入")}</span>
                        </button>
                        <button type="button" disabled={!hydrated} className="wg-sketch-button wg-sketch-button-primary inline-flex h-9 items-center gap-2 px-3.5 text-[12px] font-semibold disabled:opacity-50" onClick={createAndEnter}>
                            <Add01Icon className="size-4" strokeWidth={1.8} />
                            {t("新建")}
                        </button>
                    </div>
            </header>

            <div className="min-h-0 flex-1 overflow-auto px-4 py-4 lg:px-6 lg:py-5">
                {!hydrated ? (
                    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4" role="status" aria-label={t("正在读取工作流")}>
                        {[0, 1, 2, 3].map((item) => <div key={item} className="aspect-[16/13] animate-pulse rounded-[12px] bg-[color:var(--wg-home-hover)]" />)}
                    </div>
                ) : filteredProjects.length ? (
                    <div className="grid gap-x-3 gap-y-5 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
                        {filteredProjects.map((project) => (
                            <CanvasProjectCard key={project.id} project={project} />
                        ))}
                    </div>
                ) : projects.length ? (
                    <section className="flex min-h-[320px] flex-col items-center justify-center text-center">
                        <Search01Icon className="size-7 text-[color:var(--wg-home-muted-strong)]" strokeWidth={1.5} />
                        <h2 className="mt-4 text-[14px] font-semibold">{t("没有匹配的工作流")}</h2>
                        <button type="button" className="mt-2 text-[12px] font-medium text-[color:var(--wg-home-accent)]" onClick={() => setQuery("")}>{t("清除搜索")}</button>
                    </section>
                ) : (
                    <section className="flex min-h-[420px] flex-col items-center justify-center text-center">
                        <span className="grid size-10 place-items-center rounded-[11px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] text-[color:var(--wg-home-accent)]"><Add01Icon className="size-5" strokeWidth={1.7} /></span>
                        <h2 className="mt-4 text-[15px] font-semibold">{t("新建工作流")}</h2>
                        <p className="mt-1.5 max-w-xs text-[12px] leading-5 text-[color:var(--wg-home-muted)]">{t("从空白画布开始，或让 Zodiac 帮你搭建节点。")}</p>
                        <button type="button" className="wg-sketch-button wg-sketch-button-primary mt-5 inline-flex h-9 items-center gap-2 px-4 text-[12px] font-semibold" onClick={createAndEnter}>
                            <Add01Icon className="size-4" strokeWidth={1.8} />
                            {t("新建")}
                        </button>
                    </section>
                )}
            </div>

            <input ref={inputRef} type="file" accept="application/zip,.zip" className="hidden" onChange={(event) => void importCanvas(event.target.files?.[0])} />
            <CanvasDeleteProjectsDialog />
        </main>
    );
}
