import { ChevronDown, Download, FolderOpen, History, Save, Upload } from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { saveAs } from "file-saver";
import "../../styles/project-menu.css";
import { serializeProject } from "../io/exportProjectJson";
import { restoreDirectorDeskRecentProject, saveDirectorDeskRecentProject, subscribeDirectorProjectSnapshotResult } from "../io/hostBridge";
import { parseProject } from "../io/importProjectJson";
import { useDirectorStore } from "../store/directorStore";

type ProjectStatus = {
    tone: "normal" | "error";
    text: string;
};

export function ProjectMenu() {
    const [open, setOpen] = useState(false);
    const [status, setStatus] = useState<ProjectStatus | null>(null);
    const menuRef = useRef<HTMLDivElement>(null);
    const importInputRef = useRef<HTMLInputElement>(null);
    const project = useDirectorStore((state) => state.project);
    const replaceProject = useDirectorStore((state) => state.replaceProject);

    useEffect(() => {
        return subscribeDirectorProjectSnapshotResult((result) => {
            if (result.status === "saved") {
                setStatus({ tone: "normal", text: "已保存为最近工程" });
                return;
            }
            if (result.status === "restored") {
                setStatus({ tone: "normal", text: "已恢复最近工程" });
                return;
            }
            if (result.status === "empty") {
                setStatus({ tone: "error", text: "还没有保存过最近工程" });
                return;
            }
            setStatus({ tone: "error", text: result.action === "save" ? "最近工程保存失败" : "最近工程恢复失败" });
        });
    }, []);

    useEffect(() => {
        if (!open) return;

        function closeOnOutsidePointer(event: PointerEvent) {
            if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
            setOpen(false);
        }

        function closeOnEscape(event: KeyboardEvent) {
            if (event.key === "Escape") setOpen(false);
        }

        document.addEventListener("pointerdown", closeOnOutsidePointer);
        window.addEventListener("keydown", closeOnEscape);
        return () => {
            document.removeEventListener("pointerdown", closeOnOutsidePointer);
            window.removeEventListener("keydown", closeOnEscape);
        };
    }, [open]);

    async function handleImport(event: ChangeEvent<HTMLInputElement>) {
        const input = event.currentTarget;
        const file = input.files?.[0];
        if (!file) return;

        try {
            replaceProject(parseProject(await file.text()));
            setStatus({ tone: "normal", text: "工程已导入" });
        } catch {
            setStatus({ tone: "error", text: "工程文件格式不正确" });
        } finally {
            input.value = "";
        }
    }

    function handleExport() {
        saveAs(new Blob([serializeProject(project)], { type: "application/json;charset=utf-8" }), "workflowgenerator-director-project.json");
        setStatus({ tone: "normal", text: "工程文件已导出" });
    }

    function handleSaveRecent() {
        setStatus({ tone: "normal", text: "正在保存…" });
        if (!saveDirectorDeskRecentProject()) setStatus({ tone: "error", text: "导演项目还没有准备好" });
    }

    function handleRestoreRecent() {
        setStatus({ tone: "normal", text: "正在恢复…" });
        if (!restoreDirectorDeskRecentProject()) setStatus({ tone: "error", text: "导演项目还没有准备好" });
    }

    return (
        <div className="director-project-menu" ref={menuRef}>
            <button aria-expanded={open} aria-haspopup="menu" aria-label="工程菜单" className="top-bar-action-button director-project-menu-trigger" type="button" onClick={() => setOpen((value) => !value)}>
                <FolderOpen aria-hidden="true" size={15} strokeWidth={1.8} />
                <span>工程</span>
                <ChevronDown aria-hidden="true" size={13} strokeWidth={1.8} />
            </button>
            {open ? (
                <div className="director-project-menu-popover" role="menu" aria-label="工程操作">
                    <button type="button" role="menuitem" onClick={() => importInputRef.current?.click()}>
                        <Upload aria-hidden="true" size={15} strokeWidth={1.8} />
                        <span>导入工程</span>
                    </button>
                    <button type="button" role="menuitem" onClick={handleExport}>
                        <Download aria-hidden="true" size={15} strokeWidth={1.8} />
                        <span>导出工程</span>
                    </button>
                    <span className="director-project-menu-divider" aria-hidden="true" />
                    <button type="button" role="menuitem" onClick={handleSaveRecent}>
                        <Save aria-hidden="true" size={15} strokeWidth={1.8} />
                        <span>保存为最近工程</span>
                    </button>
                    <button type="button" role="menuitem" onClick={handleRestoreRecent}>
                        <History aria-hidden="true" size={15} strokeWidth={1.8} />
                        <span>恢复最近工程</span>
                    </button>
                    {status ? (
                        <p className={status.tone === "error" ? "is-error" : undefined} role={status.tone === "error" ? "alert" : "status"}>
                            {status.text}
                        </p>
                    ) : null}
                </div>
            ) : null}
            <input ref={importInputRef} aria-hidden="true" className="hidden-file-input" tabIndex={-1} accept=".json,application/json" type="file" onChange={(event) => void handleImport(event)} />
        </div>
    );
}
