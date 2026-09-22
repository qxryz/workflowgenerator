import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { motion } from "motion/react";

import { ZodicPanel } from "@/components/agent/zodic-panel";
import { canvasThemes } from "@/lib/canvas-theme";
import { CANVAS_AGENT_PANEL_MOTION_MS, useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const PANEL_MOTION_SECONDS = CANVAS_AGENT_PANEL_MOTION_MS / 1000;

export function AgentPanel() {
    const theme = canvasThemes[useThemeStore((state) => state.theme)];
    const contexts = useAgentStore(state => state.contexts);
    const selectedProjectId = useAgentStore(state => state.selectedProjectId);
    const width = useAgentStore((state) => state.width);
    const [resizing, setResizing] = useState(false);
    const panelMounted = useAgentStore((state) => state.panelMounted);
    const panelOpen = useAgentStore((state) => state.panelOpen);
    const panelClosing = useAgentStore((state) => state.panelClosing);
    const setWidth = useAgentStore((state) => state.setWidth);
    const commitWidth = useAgentStore((state) => state.commitWidth);
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

    if (!panelMounted && !Object.keys(contexts).length) return null;

    return (
        <motion.div
            className="relative z-[70] flex h-full shrink-0"
            initial={{ width: 0, opacity: 0 }}
            animate={{ width: panelOpen ? width + 1 : 0, opacity: panelOpen ? 1 : 0 }}
            transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
            style={{ overflow: "clip", pointerEvents: !panelOpen ? "none" : undefined, visibility: !panelOpen && !panelClosing ? "hidden" : undefined }}
        >
            <motion.aside
                className="relative flex h-full shrink-0 flex-col overflow-hidden border-l"
                initial={{ x: 48 }}
                animate={{ x: panelClosing ? 28 : 0 }}
                transition={{ duration: resizing ? 0 : PANEL_MOTION_SECONDS, ease: [0.22, 1, 0.36, 1] }}
                style={{ width, background: theme.node.panel, borderColor: theme.node.stroke, color: theme.node.text }}
            >
                <button type="button" className="absolute inset-y-0 left-0 z-40 w-4 -translate-x-1/2 cursor-col-resize" onPointerDown={startResize} aria-label="调整右侧面板宽度" />
                {Object.keys(contexts).map(projectId => <div key={projectId} className="h-full min-h-0 flex-col" style={{ display: projectId === selectedProjectId ? "flex" : "none" }}><ZodicPanel projectId={projectId} visible={panelOpen && projectId === selectedProjectId} /></div>)}
            </motion.aside>
        </motion.div>
    );
}
