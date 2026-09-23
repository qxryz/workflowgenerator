import { useEffect, useLayoutEffect, useRef, useState } from "react";

import { Dropdown, Modal, Tooltip } from "antd";
import { Eye, Play, Square, Zap, Plus, Trash2, Download, Folder, Home, Menu, Redo2, PanelLeftClose, PanelLeftOpen, Undo2, Upload } from "lucide-react";

import { UserStatusActions } from "@/components/layout/user-status-actions";
import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { canvasThemes } from "@/lib/canvas-theme";
import { useCanvasSidePanelStore } from "@/stores/use-canvas-side-panel-store";
import { useThemeStore } from "@/stores/use-theme-store";

export function CanvasTopBar({
    title,
    titleDraft,
    isTitleEditing,
    onTitleDraftChange,
    onStartTitleEditing,
    onFinishTitleEditing,
    onCancelTitleEditing,
    canUndo,
    canRedo,
    onHome,
    onProjects,
    onCreateProject,
    onDeleteProject,
    onExportProject,
    onImportImage,
    onOpenPlugins,
    onUndo,
    onRedo,
    agentOpen,
    onToggleAgent,
    workflowActionCount = 0,
    workflowStatus = "idle",
    onRunGuided,
    onRunAutomatic,
    onInspectWorkflow,
    onStopWorkflow,
}: {
    title: string;
    titleDraft: string;
    isTitleEditing: boolean;
    onTitleDraftChange: (value: string) => void;
    onStartTitleEditing: () => void;
    onFinishTitleEditing: () => void;
    onCancelTitleEditing: () => void;
    canUndo: boolean;
    canRedo: boolean;
    onHome: () => void;
    onProjects: () => void;
    onCreateProject: () => void;
    onDeleteProject: () => void;
    onExportProject: () => void;
    onImportImage: () => void;
    onOpenPlugins: () => void;
    onUndo: () => void;
    onRedo: () => void;
    agentOpen: boolean;
    onToggleAgent: () => void;
    workflowActionCount?: number;
    workflowStatus?: string;
    onRunGuided?: () => void;
    onRunAutomatic?: () => void;
    onInspectWorkflow?: () => void;
    onStopWorkflow?: () => void;
}) {
    const { t } = useAppTranslation();
    const colorTheme = useThemeStore((state) => state.theme);
    const theme = canvasThemes[colorTheme];
    const titleRef = useRef<HTMLDivElement>(null);
    const barRef = useRef<HTMLDivElement>(null);
    const [compact, setCompact] = useState(false);
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

    useLayoutEffect(() => {
        const bar = barRef.current;
        if (!bar) return;
        const update = () => {
            const width = bar.clientWidth;
            // Ignore retained canvases while hidden; leave space between thresholds
            // so dragging around the boundary does not repeatedly open and fold tools.
            if (width) setCompact((current) => width < (current ? 768 : 720));
        };
        update();
        const observer = new ResizeObserver(update);
        observer.observe(bar);
        return () => observer.disconnect();
    }, []);

    useEffect(() => {
        if (!isTitleEditing) return;
        const close = (event: PointerEvent) => {
            if (!titleRef.current?.contains(event.target as Node)) onFinishTitleEditing();
        };
        document.addEventListener("pointerdown", close, true);
        return () => document.removeEventListener("pointerdown", close, true);
    }, [isTitleEditing, onFinishTitleEditing]);

    return (
        <>
            <div ref={barRef} className="wg-canvas-topbar" data-compact={compact || undefined}>
                <div className="wg-control-surface wg-canvas-title pointer-events-auto">
                    <Tooltip title={t(sidePanelOpen ? "收起面板" : "展开面板")}>
                        <button type="button" onClick={toggleSidePanel} aria-label={t(sidePanelOpen ? "收起面板" : "展开面板")} className="wg-icon-button wg-canvas-sidebar-toggle">
                            {sidePanelOpen ? <PanelLeftClose className="size-4" strokeWidth={1.8} /> : <PanelLeftOpen className="size-4" strokeWidth={1.8} />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        classNames={{ root: "wg-canvas-menu" }}
                        menu={{
                            items: [
                                { key: "panel", icon: <PanelLeftOpen className="size-4" />, label: t(sidePanelOpen ? "收起面板" : "展开面板"), onClick: toggleSidePanel },
                                { key: "home", icon: <Home className="size-4" />, label: t("主页"), onClick: onHome },
                                { key: "projects", icon: <Folder className="size-4" />, label: t("我的画布"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Plus className="size-4" />, label: t("新建画布"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Trash2 className="size-4" />, label: t("删除当前画布"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload className="size-4" />, label: t("导入资产"), onClick: onImportImage },
                                { key: "export", icon: <Download className="size-4" />, label: t("导出当前画布"), onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo2 className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo2 className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="wg-icon-button" aria-label={t("打开画布菜单")}>
                            <Menu className="size-4" strokeWidth={1.8} />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="wg-canvas-title-editor flex min-w-0 items-center">
                        {isTitleEditing ? (
                            <input
                                autoFocus
                                value={titleDraft}
                                onChange={(event) => onTitleDraftChange(event.target.value)}
                                onBlur={onFinishTitleEditing}
                                onKeyDown={(event) => {
                                    if (event.key === "Enter") onFinishTitleEditing();
                                    if (event.key === "Escape") onCancelTitleEditing();
                                }}
                                aria-label={t("画布名称")}
                                className="wg-canvas-title-name w-full bg-transparent outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button type="button" className="wg-text-button wg-canvas-title-name truncate" onDoubleClick={onStartTitleEditing} title={t("双击修改画布名称")}>
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                <div className="wg-control-surface wg-canvas-commands pointer-events-auto">
                    {workflowActionCount > 0 ? (
                        <>
                            <div className="wg-canvas-run-controls" role="group" aria-label={t("工作流运行")}>
                                {workflowStatus === "running" ? (
                                    <Tooltip title={t("停止")}>
                                        <button type="button" className="wg-text-button wg-canvas-run-button" data-danger="true" aria-label={t("停止")} onClick={onStopWorkflow}>
                                            <Square className="size-3.5 shrink-0 fill-current" />
                                            <span className="wg-canvas-run-label">{t("停止")}</span>
                                        </button>
                                    </Tooltip>
                                ) : workflowStatus === "waiting_review" ? (
                                    <Tooltip title={t("检查结果")}>
                                        <button type="button" className="wg-text-button wg-canvas-run-button" aria-label={t("检查结果")} disabled={!onInspectWorkflow} onClick={onInspectWorkflow}>
                                            <Eye className="size-3.5 shrink-0" />
                                            <span className="wg-canvas-run-label">{t("检查结果")}</span>
                                        </button>
                                    </Tooltip>
                                ) : compact ? (
                                    <Dropdown
                                        trigger={["click"]}
                                        placement="bottomRight"
                                        classNames={{ root: "wg-canvas-menu" }}
                                        menu={{
                                            items: [
                                                { key: "guided", label: t("逐步运行"), icon: <Play className="size-4" />, disabled: !onRunGuided, onClick: onRunGuided },
                                                { key: "automatic", label: t("自动运行"), icon: <Zap className="size-4" />, disabled: !onRunAutomatic, onClick: onRunAutomatic },
                                            ],
                                        }}
                                    >
                                        <button type="button" className="wg-icon-button wg-canvas-folded-control" aria-label={t("工作流运行")} title={t("工作流运行")} aria-haspopup="menu">
                                            <Play />
                                        </button>
                                    </Dropdown>
                                ) : (
                                    <>
                                        <Tooltip title={t("逐步运行")}>
                                            <button type="button" className="wg-text-button wg-canvas-run-button" aria-label={t("逐步运行")} disabled={!onRunGuided} onClick={onRunGuided}>
                                                <Play className="size-3.5 shrink-0" />
                                                <span className="wg-canvas-run-label">{t("逐步运行")}</span>
                                            </button>
                                        </Tooltip>
                                        <Tooltip title={t("自动运行")}>
                                            <button type="button" className="wg-text-button wg-canvas-run-button" aria-label={t("自动运行")} disabled={!onRunAutomatic} onClick={onRunAutomatic}>
                                                <Zap className="size-3.5 shrink-0" />
                                                <span className="wg-canvas-run-label">{t("自动运行")}</span>
                                            </button>
                                        </Tooltip>
                                    </>
                                )}
                            </div>
                            <span className="wg-control-divider" />
                        </>
                    ) : null}

                    <div className="wg-canvas-utilities">
                        <UserStatusActions variant="canvas" compact={compact} onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                        <span className="wg-control-divider" />
                        <button type="button" className="wg-text-button wg-zodiac-trigger" data-active={agentOpen || undefined} aria-label="Zodiac" aria-pressed={agentOpen} onClick={onToggleAgent}>
                            <ZodiacAvatar className="size-5 border-0 shadow-none" />
                            <span className="wg-zodiac-label">Zodiac</span>
                        </button>
                    </div>
                </div>
            </div>
            <Modal title={t("快捷键")} open={shortcutsOpen} onCancel={() => setShortcutsOpen(false)} footer={null} centered>
                <div className="space-y-2 border-t pt-4 text-sm" style={{ borderColor: theme.node.stroke }}>
                    <Shortcut keys={["拖动画布"]} value="平移视图" />
                    <Shortcut keys={["滚轮"]} value="缩放画布" />
                    <Shortcut keys={["缩放滑杆"]} value="精确调整缩放" />
                    <Shortcut keys={["Ctrl / Cmd", "拖动"]} value="框选多个节点" />
                    <Shortcut keys={["Shift / Ctrl / Cmd", "点击"]} value="追加选择节点" />
                    <Shortcut keys={["Ctrl / Cmd", "A"]} value="全选节点" />
                    <Shortcut keys={["Ctrl / Cmd", "C / V"]} value="复制 / 粘贴节点，或粘贴剪切板文本/图片" />
                    <Shortcut keys={["Ctrl / Cmd", "Z"]} value="撤销" />
                    <Shortcut keys={["Ctrl / Cmd", "Shift", "Z"]} value="重做" />
                    <Shortcut keys={["Ctrl / Cmd", "Y"]} value="重做" />
                    <Shortcut keys={["Delete / Backspace"]} value="删除选中" />
                    <Shortcut keys={["Esc"]} value="取消选择并关闭浮层" />
                    <Shortcut keys={["拖入任意文件"]} value="上传到画布" />
                </div>
            </Modal>
        </>
    );
}

function MenuLabel({ text, shortcut }: { text: string; shortcut: string }) {
    const { t } = useAppTranslation();
    return (
        <span className="flex min-w-36 items-center justify-between gap-8">
            <span>{t(text)}</span>
            <span className="text-xs opacity-45">{shortcut}</span>
        </span>
    );
}

function Shortcut({ keys, value }: { keys: string[]; value: string }) {
    const { t } = useAppTranslation();
    return (
        <div className="grid grid-cols-[minmax(0,1fr)_120px] items-center gap-6 rounded-lg px-1 py-1.5">
            <span className="flex min-w-0 flex-wrap items-center gap-1.5">
                {keys.map((key, index) => (
                    <span key={`${key}-${index}`} className="flex items-center gap-1.5">
                        {index ? <span className="text-xs opacity-35">+</span> : null}
                        <kbd
                            className="min-w-9 rounded-md border px-2.5 py-1.5 text-center text-xs font-medium leading-none shadow-[inset_0_-1px_0_rgba(0,0,0,.08),0_1px_2px_rgba(0,0,0,.06)]"
                            style={{ borderColor: "rgba(120,113,108,.28)", background: "linear-gradient(#fff, rgba(245,245,244,.92))", color: "rgb(68,64,60)" }}
                        >
                            {t(key)}
                        </kbd>
                    </span>
                ))}
            </span>
            <span className="text-right text-sm opacity-55">{t(value)}</span>
        </div>
    );
}
