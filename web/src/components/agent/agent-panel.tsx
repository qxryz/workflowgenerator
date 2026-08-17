import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { SidebarRightIcon, ViewIcon, ViewOffIcon } from "hugeicons-react";
import { Button, Switch, Tooltip } from "antd";
import { motion } from "motion/react";

import { ZodicPanel } from "@/components/agent/zodic-panel";
import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const confirmTools = useAgentStore((state) => state.confirmTools);
    const showReasoning = useAgentStore((state) => state.showReasoning);
    const setWidth = useAgentStore((state) => state.setWidth);
    const commitWidth = useAgentStore((state) => state.commitWidth);
    const setConfirmTools = useAgentStore((state) => state.setConfirmTools);
    const setShowReasoning = useAgentStore((state) => state.setShowReasoning);
    const closePanel = useAgentStore((state) => state.closePanel);
    const resizeCleanupRef = useRef<(() => void) | null>(null);

    useEffect(
        () => () => {
            resizeCleanupRef.current?.();
            resizeCleanupRef.current = null;
        },
        [],
    );

    const startResize = (event: ReactPointerEvent<HTMLButtonElement>) => {
        event.preventDefault();
        resizeCleanupRef.current?.();
        const startX = event.clientX;
        const startWidth = width;
        let nextWidth = startWidth;
        let frame = 0;
        const onMove = (moveEvent: PointerEvent) => {
            nextWidth = Math.min(760, Math.max(360, startWidth + startX - moveEvent.clientX));
            if (frame) return;
            frame = window.requestAnimationFrame(() => {
                frame = 0;
                setWidth(nextWidth);
            });
        };
        const cleanup = () => {
            if (frame) window.cancelAnimationFrame(frame);
            window.removeEventListener("pointermove", onMove);
            window.removeEventListener("pointerup", onUp);
            window.removeEventListener("pointercancel", onUp);
            resizeCleanupRef.current = null;
        };
        const onUp = () => {
            cleanup();
            setWidth(nextWidth);
            commitWidth(nextWidth);
            setResizing(false);
        };
        setResizing(true);
        window.addEventListener("pointermove", onMove);
        window.addEventListener("pointerup", onUp);
        window.addEventListener("pointercancel", onUp);
        resizeCleanupRef.current = () => {
            cleanup();
            commitWidth(nextWidth);
        };
    };

    if (!panelMounted) return null;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0 py-2 pl-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: panelClosing ? "none" : undefined }}
        >
            <motion.aside
                className="wg-sketch-panel relative flex h-full shrink-0 flex-col overflow-hidden rounded-l-[18px] border shadow-[-5px_6px_0_color-mix(in_srgb,var(--wg-pencil)_10%,transparent)]"
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整右侧面板宽度" />
                <header className="wg-paper-surface flex h-16 shrink-0 items-center justify-between border-b border-dashed px-4" style={{ borderColor: theme.node.stroke }}>
                    <div className="flex min-w-0 items-center gap-2">
                        <ZodiacAvatar />
                        <div className="min-w-0">
                            <div className="text-[15px] font-semibold leading-5 tracking-[-.025em]">Zodiac</div>
                            <div className="truncate text-xs" style={{ color: theme.node.muted }}>工作流副驾驶</div>
                        </div>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                        <Tooltip title={showReasoning ? "隐藏工作过程" : "显示工作过程"}>
                            <Button
                                type="text"
                                shape="circle"
                                className="!h-8 !w-8 !min-w-8"
                                style={{ color: showReasoning ? "var(--wg-home-accent)" : theme.node.muted }}
                                icon={showReasoning ? <ViewIcon className="size-4" /> : <ViewOffIcon className="size-4" />}
                                aria-label={showReasoning ? "隐藏工作过程" : "显示工作过程"}
                                onClick={() => setShowReasoning(!showReasoning)}
                            />
                        </Tooltip>
                        <label className="flex items-center gap-1.5 text-xs" style={{ color: theme.node.muted }}>
                            <Switch size="small" checked={confirmTools} onChange={setConfirmTools} />
                            工具确认
                        </label>
                        <Tooltip title="收起对话">
                            <Button type="text" shape="circle" className="!h-8 !w-8 !min-w-8" style={{ color: theme.node.muted }} icon={<SidebarRightIcon className="size-4" />} onClick={closePanel} />
                        </Tooltip>
                    </div>
                </header>
                <ZodicPanel />
            </motion.aside>
        </motion.div>
    );
}
