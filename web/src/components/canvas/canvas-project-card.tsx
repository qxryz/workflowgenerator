import {
    CheckmarkCircle02Icon,
    Delete02Icon,
    Download01Icon,
    Edit02Icon,
    MoreHorizontalIcon,
    WorkflowSquare01Icon,
} from "hugeicons-react";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { exportCanvasProjects } from "@/lib/canvas/canvas-export";
import { cn } from "@/lib/utils";
import { useCanvasStore, type CanvasProject } from "@/stores/canvas/use-canvas-store";
import { useCanvasUiStore } from "@/stores/canvas/use-canvas-ui-store";

type PreviewNode = {
    id: string;
    left: number;
    top: number;
    width: number;
    height: number;
};

function createPreviewNodes(project: CanvasProject): PreviewNode[] {
    const nodes = project.nodes.slice(0, 18);
    if (!nodes.length) return [];
    const minX = Math.min(...nodes.map((node) => node.position.x));
    const minY = Math.min(...nodes.map((node) => node.position.y));
    const maxX = Math.max(...nodes.map((node) => node.position.x + node.width));
    const maxY = Math.max(...nodes.map((node) => node.position.y + node.height));
    const spanX = Math.max(1, maxX - minX);
    const spanY = Math.max(1, maxY - minY);

    return nodes.map((node) => ({
        id: node.id,
        left: 8 + ((node.position.x - minX) / spanX) * 76,
        top: 10 + ((node.position.y - minY) / spanY) * 70,
        width: Math.max(9, Math.min(28, (node.width / spanX) * 76)),
        height: Math.max(8, Math.min(25, (node.height / spanY) * 70)),
    }));
}

export function CanvasProjectCard({ project }: { project: CanvasProject }) {
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const [actionsOpen, setActionsOpen] = useState(false);
    const renameProject = useCanvasStore((state) => state.renameProject);
    const selectedIds = useCanvasUiStore((state) => state.selectedProjectIds);
    const editingId = useCanvasUiStore((state) => state.editingProjectId);
    const editingTitle = useCanvasUiStore((state) => state.editingProjectTitle);
    const startEditing = useCanvasUiStore((state) => state.startEditingProject);
    const setEditingTitle = useCanvasUiStore((state) => state.setEditingProjectTitle);
    const stopEditing = useCanvasUiStore((state) => state.stopEditingProject);
    const toggleSelected = useCanvasUiStore((state) => state.toggleSelectedProjectId);
    const setDeleteIds = useCanvasUiStore((state) => state.setDeleteProjectIds);
    const previewNodes = useMemo(() => createPreviewNodes(project), [project]);
    const editing = editingId === project.id;
    const selected = selectedIds.includes(project.id);
    const open = () => navigate(`/canvas/${project.id}${searchParams.toString() ? `?${searchParams.toString()}` : ""}`);
    const saveTitle = () => {
        renameProject(project.id, editingTitle);
        stopEditing();
    };
    const updatedAt = new Date(project.updatedAt).toLocaleString("zh-CN", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
    });

    return (
        <article
            className={cn(
                "group relative min-w-0 cursor-pointer rounded-[10px_13px_11px_12px] p-1.5 transition-[background,transform] duration-150 hover:bg-[color:var(--wg-home-hover)] active:scale-[.995]",
                selected && "bg-[color:var(--wg-home-hover)]",
            )}
            onClick={() => !editing && open()}
        >
            <div
                className={cn(
                    "wg-paper-surface relative aspect-[16/10] overflow-hidden rounded-[9px_12px_10px_11px] border bg-[color:var(--wg-panel)] transition-[border-color,box-shadow] duration-150",
                    selected
                        ? "border-[color:var(--wg-home-accent)] shadow-[0_0_0_2px_color-mix(in_srgb,var(--wg-home-accent)_18%,transparent)]"
                        : "border-[color:var(--wg-home-line)] group-hover:border-[color:var(--wg-home-line-strong)]",
                )}
            >
                <div
                    className="absolute inset-0 opacity-55"
                    style={{
                        backgroundImage:
                            "linear-gradient(to right, color-mix(in srgb, var(--wg-home-line) 55%, transparent) 1px, transparent 1px), linear-gradient(to bottom, color-mix(in srgb, var(--wg-home-line) 55%, transparent) 1px, transparent 1px)",
                        backgroundSize: "18px 18px",
                    }}
                    aria-hidden="true"
                />

                {previewNodes.length ? (
                    <div className="absolute inset-0" aria-hidden="true">
                        {previewNodes.map((node, index) => (
                            <span
                                key={node.id}
                                className="absolute rounded-[2px_4px_3px_3px] border border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-home-raised)] shadow-[1px_1px_0_color-mix(in_srgb,var(--wg-pencil)_14%,transparent)]"
                                style={{
                                    left: `${node.left}%`,
                                    top: `${node.top}%`,
                                    width: `${node.width}%`,
                                    height: `${node.height}%`,
                                    transform: `rotate(${[-1.2, 0.8, -0.45, 1.05][index % 4]}deg)`,
                                }}
                            />
                        ))}
                    </div>
                ) : (
                    <div className="absolute inset-0 grid place-items-center text-[color:var(--wg-home-muted-strong)]">
                        <WorkflowSquare01Icon className="size-8 opacity-45" strokeWidth={1.4} />
                    </div>
                )}

                <label
                    className={cn(
                        "absolute left-2.5 top-2.5 grid size-7 cursor-pointer place-items-center rounded-[7px] border bg-[color:var(--wg-home-floating)] text-transparent opacity-0 shadow-sm backdrop-blur-xl transition group-hover:opacity-100",
                        selected
                            ? "border-[color:var(--wg-home-accent)] bg-[color:var(--wg-home-accent)] text-[color:var(--wg-home-accent-text)] opacity-100"
                            : "border-[color:var(--wg-home-line)]",
                    )}
                    onClick={(event) => event.stopPropagation()}
                >
                    <input
                        type="checkbox"
                        checked={selected}
                        onChange={(event) => toggleSelected(project.id, event.target.checked)}
                        className="sr-only"
                        aria-label={`选择 ${project.title}`}
                    />
                    <CheckmarkCircle02Icon className="size-4" strokeWidth={2} />
                </label>

                <button
                    type="button"
                    className={cn(
                        "absolute right-2.5 top-2.5 grid size-7 cursor-pointer place-items-center rounded-[7px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-floating)] text-[color:var(--wg-home-muted)] opacity-0 shadow-sm backdrop-blur-xl transition hover:text-[color:var(--wg-home-text)] group-hover:opacity-100",
                        actionsOpen && "opacity-100",
                    )}
                    onClick={(event) => {
                        event.stopPropagation();
                        setActionsOpen((value) => !value);
                    }}
                    aria-label="工作流操作"
                >
                    <MoreHorizontalIcon className="size-4" strokeWidth={1.8} />
                </button>
            </div>

            <div className="px-1.5 pb-1 pt-2.5">
                {editing ? (
                    <input
                        value={editingTitle}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingTitle(event.target.value)}
                        onBlur={saveTitle}
                        onKeyDown={(event) => {
                            if (event.key === "Enter") saveTitle();
                            if (event.key === "Escape") stopEditing();
                        }}
                        className="h-8 w-full rounded-[7px] border border-[color:var(--wg-home-accent)] bg-[color:var(--wg-panel)] px-2 text-[13px] font-semibold outline-none ring-2 ring-[color:var(--wg-home-accent)]/15"
                        autoFocus
                    />
                ) : (
                    <>
                        <h2 className="truncate text-[13px] font-semibold text-[color:var(--wg-home-text)]">{project.title}</h2>
                        <p className="wg-ascii-label mt-1 flex items-center gap-2 text-[9px] tabular-nums text-[color:var(--wg-home-muted-strong)]">
                            <span>NODES {String(project.nodes.length).padStart(2, "0")}</span>
                            <span>LINKS {String(project.connections.length).padStart(2, "0")}</span>
                            <span className="ml-auto">{updatedAt}</span>
                        </p>
                    </>
                )}
            </div>

            {actionsOpen && !editing ? (
                <div
                    className="absolute right-3 top-12 z-10 flex items-center gap-1 rounded-[10px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-1 shadow-[0_16px_40px_color-mix(in_srgb,var(--wg-home-text)_14%,transparent)]"
                    onClick={(event) => event.stopPropagation()}
                >
                    <button type="button" className="grid size-8 place-items-center rounded-[7px] text-[color:var(--wg-home-muted)] hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)]" onClick={() => void exportCanvasProjects([project], project.title || "WorkflowGenerator")} aria-label="导出">
                        <Download01Icon className="size-4" strokeWidth={1.7} />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded-[7px] text-[color:var(--wg-home-muted)] hover:bg-[color:var(--wg-home-hover)] hover:text-[color:var(--wg-home-text)]" onClick={() => startEditing(project.id, project.title)} aria-label="重命名">
                        <Edit02Icon className="size-4" strokeWidth={1.7} />
                    </button>
                    <button type="button" className="grid size-8 place-items-center rounded-[7px] text-destructive hover:bg-destructive/10" onClick={() => setDeleteIds([project.id])} aria-label="删除">
                        <Delete02Icon className="size-4" strokeWidth={1.7} />
                    </button>
                </div>
            ) : null}
        </article>
    );
}
