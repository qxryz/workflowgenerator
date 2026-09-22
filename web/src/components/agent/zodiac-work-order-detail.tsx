import { AlertCircle, CheckCircle2, ChevronDown, FileText, Link2 } from "lucide-react";

import type { ZodiacWorkOrder } from "@/lib/agent/zodiac-work-order";
import type { canvasThemes } from "@/lib/canvas-theme";

export function ZodiacWorkOrderDetail({ order, theme }: { order: ZodiacWorkOrder; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    if (!order.steps.length) return null;
    return (
        <details className="group ml-11 mt-2 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke, background: theme.node.panel }}>
            <summary className="cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium" style={{ color: theme.node.text, display: "flex", listStyle: "none" }}>
                <FileText className="size-3.5" />
                <span>工作单 · {order.steps.length} 个步骤</span>
                {order.issues.length ? (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-amber-600">
                        <AlertCircle className="size-3" />
                        待补全
                    </span>
                ) : (
                    <span className="ml-auto inline-flex items-center gap-1 text-[11px] text-emerald-600">
                        <CheckCircle2 className="size-3" />
                        已装配
                    </span>
                )}
                <ChevronDown className="size-3.5 transition-transform group-open:rotate-180" style={{ color: theme.node.muted }} />
            </summary>
            <div className="space-y-2 border-t p-2.5" style={{ borderColor: theme.node.stroke }}>
                {order.steps.map((step, index) => {
                    const issue = order.issues.find((candidate) => candidate.nodeId === step.nodeId);
                    return (
                        <div key={step.nodeId} className="rounded-lg border px-3 py-2.5" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel }}>
                            <div className="flex items-center gap-2 text-xs font-semibold" style={{ color: theme.node.text }}>
                                <span className="grid size-5 shrink-0 place-items-center rounded-full border text-[10px]" style={{ borderColor: theme.node.stroke }}>
                                    {index + 1}
                                </span>
                                <span className="min-w-0 flex-1 truncate">{step.title}</span>
                                <span className="shrink-0 text-[10px] font-medium" style={{ color: theme.node.muted }}>
                                    {modeLabel(step.mode)}
                                </span>
                            </div>
                            {step.prompt ? (
                                <div className="thin-scrollbar mt-2 max-h-36 overflow-y-auto whitespace-pre-wrap break-words text-[11px] leading-5" style={{ color: theme.node.muted }}>
                                    {step.prompt.replace(/@\[node:([^\]]+)\]/gu, (_, id: string) => `「${step.inputs?.find((input) => input.nodeId === id)?.title || step.inputs?.flatMap((input) => input.members || []).find((input) => input.nodeId === id)?.title || "待连接素材"}」`)}
                                </div>
                            ) : (
                                <div className="mt-2 text-[11px] text-amber-600">{issue?.message || "这一步还没有创作内容"}</div>
                            )}
                            {step.inputs?.length ? (
                                <div className="mt-2 flex flex-wrap gap-1.5 text-[10px]" style={{ color: theme.node.text }}>
                                    {step.inputs.map((input) => (
                                        <span key={input.nodeId} title={input.groupTitle} className="inline-flex max-w-full items-center gap-1 rounded border px-1.5 py-0.5" style={{ borderColor: theme.node.stroke, opacity: input.selected ? 1 : 0.5 }}>
                                            <Link2 className="size-3 shrink-0" />
                                            <span className="truncate">
                                                {input.title}
                                                {input.selected ? "" : " · 未选用"}
                                            </span>
                                        </span>
                                    ))}
                                </div>
                            ) : null}
                            {step.inputs?.filter((input) => input.selected && input.members?.length).map((input) => (
                                <details key={input.nodeId} className="mt-2 text-[10px]" style={{ color: theme.node.muted }}>
                                    <summary className="cursor-pointer">{input.title} · 选用 {input.members?.filter((member) => member.selected).length} 项</summary>
                                    <div className="mt-1 space-y-1 pl-2">
                                        {input.members?.map((member) => <div key={member.nodeId}>{member.title}{member.selected ? "" : " · 未选用"}</div>)}
                                        {input.groupPrompt ? <p className="whitespace-pre-wrap break-words">{input.groupPrompt.replace(/@\[node:([^\]]+)\]/gu, (_, id: string) => `「${input.members?.find((member) => member.nodeId === id)?.title || "素材"}」`)}</p> : null}
                                    </div>
                                </details>
                            ))}
                            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[10px]" style={{ color: theme.node.muted }}>
                                {step.inputNodeIds.length ? (
                                    <span className="inline-flex items-center gap-1">
                                        <Link2 className="size-3" />
                                        已连接 · 选用 {step.inputs?.filter((input) => input.selected).length ?? step.inputNodeIds.length} 个素材
                                    </span>
                                ) : (
                                    <span>独立起点</span>
                                )}
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
