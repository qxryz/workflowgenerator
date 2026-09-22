import { useEffect, useState } from "react";
import { Check, ChevronDown, CircleAlert, LoaderCircle, Pause, Sparkles } from "lucide-react";
import type { ZodiacActivity } from "@/lib/agent/zodiac-activity";
import type { ZodiacRun } from "@/lib/agent/zodiac-run-events";
import { canvasThemes } from "@/lib/canvas-theme";

export function ZodiacActivityCard({ run, activities = [], theme }: { run: ZodiacRun; activities?: ZodiacActivity[]; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const running = run.status === "running";
    const [now, setNow] = useState(Date.now());
    const [open, setOpen] = useState(false);
    useEffect(() => {
        if (!running) return;
        const timer = window.setInterval(() => setNow(Date.now()), 1000);
        return () => window.clearInterval(timer);
    }, [running]);
    const current = [...activities].reverse().find((item) => item.status === "running" || item.status === "waiting");
    const started = activities[0]?.startedAt;
    const seconds = started ? Math.max(0, Math.floor(((running ? now : activities.at(-1)?.at || now) - started) / 1000)) : 0;
    const label = running ? current?.label || "正在准备" : run.status === "error" ? "处理未完成" : run.status === "stopped" ? "已停止" : run.status === "waiting" ? "已整理提案" : "处理完成";
    return (
        <div className="ml-11 rounded-lg px-3 py-2" style={{ background: `color-mix(in srgb, ${theme.node.text} 4%, transparent)`, color: theme.node.muted }}>
            <button type="button" className="flex w-full items-center gap-2.5 text-left text-xs" aria-expanded={open} onClick={() => setOpen(!open)}>
                {running ? <LoaderCircle className="size-3.5 shrink-0 motion-safe:animate-spin" /> : run.status === "error" ? <CircleAlert className="size-3.5" /> : <Sparkles className="size-3.5" />}
                <span className="flex-1" role="status">
                    {label}
                    {running && current?.status !== "waiting" ? <span className="ml-1 motion-safe:animate-pulse">…</span> : null}
                </span>
                {seconds > 0 ? <span className="tabular-nums opacity-65">{seconds}s</span> : null}
                <ChevronDown className={`size-3 transition-transform ${open ? "rotate-180" : ""}`} />
            </button>
            {open ? (
                <ol className="mt-3 space-y-2 border-l pl-3" style={{ borderColor: theme.node.stroke }}>
                    {activities.map((item) => (
                        <li key={item.id} className="text-xs">
                            <div className="flex items-center gap-2">
                                {item.status === "done" ? (
                                    <Check className="size-3" />
                                ) : item.status === "error" ? (
                                    <CircleAlert className="size-3 text-red-500" />
                                ) : running && item.status !== "waiting" ? (
                                    <LoaderCircle className="size-3 motion-safe:animate-spin" />
                                ) : (
                                    <Pause className="size-3" />
                                )}
                                <span>{item.label}</span>
                                <span className="ml-auto opacity-50">{item.status === "done" ? "完成" : item.status === "error" ? "未完成" : item.status === "waiting" && running ? "待批准" : running ? "进行中" : "已结束"}</span>
                            </div>
                            {item.detail ? <p className="mt-1 break-words leading-5 text-red-500">{item.detail}</p> : null}
                        </li>
                    ))}
                </ol>
            ) : null}
            {running && seconds >= 30 && current?.status !== "waiting" ? <p className="mt-2 text-[11px] opacity-65">仍在处理，你可以随时停止。</p> : null}
        </div>
    );
}
