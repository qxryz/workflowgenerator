import { useEffect, useState } from "react";
import { ZodiacGlyph } from "@/components/brand/zodiac-glyph";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { type ZodiacActivity } from "@/lib/agent/zodiac-activity";
import type { ZodiacRun } from "@/lib/agent/zodiac-run-events";
import { canvasThemes } from "@/lib/canvas-theme";

export function ZodiacActivityCard({ run, activities = [], theme, onTrace }: { run: ZodiacRun; activities?: ZodiacActivity[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes]; onTrace?: () => void }) {
    const { t } = useAppTranslation();
    const running = run.status === "running";
    const [now, setNow] = useState(Date.now());
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    const current = [...activities].reverse().find((item) => item.status === "running" || item.status === "waiting");
    const started = activities[0]?.startedAt;
    const seconds = started ? Math.max(0, Math.floor(((running ? now : activities.at(-1)?.at || now) - started) / 1000)) : 0;
    const label = running ? (current?.kind === "approval" ? "等待审批" : "工作中") : run.status === "error" ? "未完成" : run.status === "stopped" ? "已停止" : run.status === "waiting" ? "等待选择" : "已完成";
    return (
        <button type="button" className="group flex max-w-full items-center gap-2 py-0.5 text-left text-[11px] transition-opacity hover:opacity-70" style={{ color: theme.node.muted }} aria-label={t("查看轨迹")} onClick={onTrace}>
            <span key={label} className="zodiac-enter flex items-center gap-2">
                {running ? (
                    <svg width="18" height="18" viewBox="0 0 20 20" aria-hidden="true" fill="currentColor">
                        <circle className="zodiac-status-dot" cx="4" cy="10" r="1.4" />
                        <circle className="zodiac-status-dot" cx="10" cy="10" r="1.4" />
                        <circle className="zodiac-status-dot" cx="16" cy="10" r="1.4" />
                    </svg>
                ) : (
                    <ZodiacGlyph name={run.status === "error" ? "alert" : run.status === "waiting" ? "chevron" : "check"} className="size-3.5" />
                )}
                <span role="status">{t(label)}</span>
            </span>
            {seconds > 0 ? <span className="tabular-nums opacity-45">{seconds}s</span> : null}
            <ZodiacGlyph name="trace" className="ml-1 size-3 opacity-0 transition-opacity group-hover:opacity-70 group-focus-visible:opacity-70" />
        </button>
    );
}
