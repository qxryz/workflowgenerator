import { AlertCircle, CheckCircle2, ChevronDown, FileText, Link2 } from "lucide-react";

import type { ZodiacWorkOrder } from "@/lib/agent/zodiac-work-order";
import type { canvasThemes } from "@/lib/canvas-theme";

export function ZodiacWorkOrderDetail({ order, theme }: { order: ZodiacWorkOrder; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!order.steps.length) return null;
    return (
        <details className="group ml-11 mt-2 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium" style={{ color: theme.node.text }}>
                <FileText className="size-3.5" />
                <span>工作单 · {order.steps.length} 个步骤</span>
                {order.issues.length ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-amber-600"><AlertCircle className="size-3" />待补全</span>
                ) : (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600"><CheckCircle2 className="size-3" />已装配</span>
                )}
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} />
            </summary>
            <div className="space-y-2 border-t p-2.5" style={{ borderColor: theme.node.stroke }}>
                {order.steps.map((step, index) => {
                    const issue = order.issues.find((candidate) => candidate.nodeId === step.nodeId);
                    return (
                        <div key={step.nodeId} className="rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.node.text }}>
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px]" style={{ borderColor: theme.node.stroke }}>{index + 1}</span>
                                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                                <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.muted }}>{modeLabel(step.mode)}</span>
                            </div>
                            {step.prompt ? (
                                <div className="thin-scrollbar mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5" style={{ color: theme.node.muted }}>
                                    {step.prompt}
                                </div>
                            ) : (
                                <div className="mt-2 text-[11px] text-amber-600">{issue?.message || "这一步还没有创作内容"}</div>
                            )}
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: theme.node.muted }}>
                                {step.inputNodeIds.length ? <span className="inline-flex items-center gap-1"><Link2 className="size-3" />承接 {step.inputNodeIds.length} 个上游</span> : <span>独立起点</span>}
                                <span>{step.outputNodeId ? "结果槽已绑定" : "结果槽待绑定"}</span>
                                {step.model ? <span>模型：{step.model}</span> : <span>模型随渠道</span>}
                            </div>
                        </div>
                    );
                })}
            </div>
        </details>
    );
}

function modeLabel(mode: string) {
    if (mode === "image") return "图片";
    if (mode === "video") return "视频";
    if (mode === "audio") return "音频";
    return "文本";
}
