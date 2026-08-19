import { useEffect, useRef, useState } from "react";
import { Add01Icon, CommandLineIcon, Delete02Icon, Download01Icon, Folder01Icon, Home01Icon, Menu01Icon, Redo02Icon, SidebarLeftIcon, SidebarRightIcon, Undo02Icon, Upload01Icon } from "hugeicons-react";
import { Button, Dropdown, Modal, Tooltip } from "antd";
import { Eye, Play, Square, Zap } from "lucide-react";

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
    terminalNodeCount,
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
    terminalNodeCount: number;
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
    const [shortcutsOpen, setShortcutsOpen] = useState(false);
    const sidePanelOpen = useCanvasSidePanelStore((state) => state.panelOpen);
    const toggleSidePanel = useCanvasSidePanelStore((state) => state.togglePanel);

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
            <div className="pointer-events-none absolute left-3 right-3 top-3 z-50 flex h-12 items-center justify-between gap-3">
                <div className="wg-sketch-panel pointer-events-auto flex min-w-0 items-center gap-2 px-2 backdrop-blur-xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <Tooltip title={t(sidePanelOpen ? "收起面板" : "展开面板")}>
                        <button type="button" onClick={toggleSidePanel} aria-label={t(sidePanelOpen ? "收起面板" : "展开面板")} className="wg-sketch-button-quiet grid size-8 place-items-center" style={{ color: theme.node.text }}>
                            {sidePanelOpen ? <SidebarLeftIcon className="size-4" strokeWidth={1.8} /> : <SidebarRightIcon className="size-4" strokeWidth={1.8} />}
                        </button>
                    </Tooltip>
                    <Dropdown
                        trigger={["click"]}
                        menu={{
                            items: [
                                { key: "home", icon: <Home01Icon className="size-4" />, label: t("主页"), onClick: onHome },
                                { key: "projects", icon: <Folder01Icon className="size-4" />, label: t("我的画布"), onClick: onProjects },
                                { type: "divider" },
                                { key: "new", icon: <Add01Icon className="size-4" />, label: t("新建画布"), onClick: onCreateProject },
                                { key: "delete", danger: true, icon: <Delete02Icon className="size-4" />, label: t("删除当前画布"), onClick: onDeleteProject },
                                { type: "divider" },
                                { key: "import", icon: <Upload01Icon className="size-4" />, label: t("导入资产"), onClick: onImportImage },
                                { key: "export", icon: <Download01Icon className="size-4" />, label: t("导出当前画布"), onClick: onExportProject },
                                { type: "divider" },
                                { key: "undo", disabled: !canUndo, icon: <Undo02Icon className="size-4" />, label: <MenuLabel text="撤销" shortcut="⌘ Z" />, onClick: onUndo },
                                { key: "redo", disabled: !canRedo, icon: <Redo02Icon className="size-4" />, label: <MenuLabel text="重做" shortcut="⌘ ⇧ Z / ⌘ Y" />, onClick: onRedo },
                            ],
                        }}
                    >
                        <button type="button" className="wg-sketch-button-quiet grid size-8 place-items-center" style={{ color: theme.node.text }} aria-label={t("打开画布菜单")}>
                            <Menu01Icon className="size-4" strokeWidth={1.8} />
                        </button>
                    </Dropdown>

                    <div ref={titleRef} className="flex min-w-0 items-center gap-2">
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
                                className="max-w-[280px] bg-transparent p-0 text-left text-lg font-semibold tracking-normal outline-none"
                                style={{ color: theme.node.text }}
                            />
                        ) : (
                            <button type="button" className="wg-sketch-button-quiet max-w-[280px] truncate px-1.5 py-1 text-left text-[15px] font-semibold tracking-[-.025em]" onDoubleClick={onStartTitleEditing} title={t("双击修改画布名称")}>
                                {title}
                            </button>
                        )}
                    </div>
                </div>

                {workflowActionCount > 0 ? (
                    <div
                        className="wg-sketch-panel pointer-events-auto absolute left-1/2 flex -translate-x-1/2 items-center gap-1 p-1 backdrop-blur-xl"
                        style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}
                        aria-label={t("工作流运行")}
                    >
                        {workflowStatus === "running" ? (
                            <Button danger type="text" size="small" className="!h-8 !rounded-xl" icon={<Square className="size-3.5 fill-current" />} onClick={onStopWorkflow}>
                                {t("停止")}
                            </Button>
                        ) : workflowStatus === "waiting_review" ? (
                            <Button type="text" size="small" className="!h-8 !rounded-xl !px-3" icon={<Eye className="size-3.5" />} disabled={!onInspectWorkflow} onClick={onInspectWorkflow}>
                                {t("检查结果")}
                            </Button>
                        ) : (
                            <>
                                <Button type="text" size="small" className="!h-8 !rounded-xl !px-3" icon={<Play className="size-3.5" />} onClick={onRunGuided}>
                                    {t("逐步运行")}
                                </Button>
                                <Button type="text" size="small" className="!h-8 !rounded-xl !px-3" icon={<Zap className="size-3.5" />} onClick={onRunAutomatic}>
                                    {t("自动运行")}
                                </Button>
                            </>
                        )}
                    </div>
                ) : null}

                <div className="wg-sketch-panel pointer-events-auto flex items-center gap-1.5 px-1.5 py-1 backdrop-blur-xl" style={{ background: theme.toolbar.panel, borderColor: theme.toolbar.border }}>
                    <UserStatusActions variant="canvas" onOpenShortcuts={() => setShortcutsOpen(true)} onOpenPlugins={onOpenPlugins} />
                    <Tooltip title={t("当前画布有 {count} 个终端 Agent 节点", { count: terminalNodeCount })}>
                        <span className="inline-flex h-8 items-center gap-1.5 rounded-xl px-2 text-xs font-medium" style={{ background: theme.toolbar.activeBg, color: theme.toolbar.activeText }}>
                            <CommandLineIcon className="size-3.5" strokeWidth={1.8} />
                            {terminalNodeCount}
                        </span>
                    </Tooltip>
                    <span className="h-6 w-px" style={{ background: theme.toolbar.border }} />
                    <Button
                        type="text"
                        className="!h-8 !rounded-xl !px-3 !font-semibold"
                        style={{ background: agentOpen ? "var(--wg-home-accent)" : theme.toolbar.activeBg, color: agentOpen ? "var(--wg-home-accent-text)" : theme.toolbar.activeText }}
                        icon={<ZodiacAvatar className="size-5 border-0 shadow-none" />}
                        onClick={onToggleAgent}
                    >
                        Zodiac
                    </Button>
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
