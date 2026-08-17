import { memo, useEffect, useRef, useState, type ReactNode } from "react";
import { Button, Popconfirm, Tooltip } from "antd";
import { ArrowUp, CheckCircle2, CircleAlert, ImagePlus, LoaderCircle, Sparkles, Square, UserRound, X, XCircle } from "lucide-react";
import { Streamdown } from "streamdown";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { isPlainEnterKey } from "@/lib/keyboard-event";
import { canvasThemes } from "@/lib/canvas-theme";
import type { LocalUser } from "@/stores/use-user-store";

export type CanvasAgentChatAttachment = { id: string; name: string; url: string };
export type CanvasAgentChatMessage = {
    id: string;
    role: "user" | "assistant" | "system" | "tool" | "error";
    title?: string;
    text: string;
    meta?: string;
    detail?: unknown;
    attachments?: CanvasAgentChatAttachment[];
    /** Present while the message is actively streaming; cleared on completion. */
    streamId?: string;
};

const WORKING_TEXT = "working...";

export const AgentChatMessage = memo(function AgentChatMessage({
    item,
    theme,
    user,
    onRejectTool,
    onApproveTool,
}: {
    item: CanvasAgentChatMessage;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    user: LocalUser | null;
    onRejectTool?: (id: string) => void;
    onApproveTool?: (id: string) => void;
}) {
    const isUser = item.role === "user";
    const isSystem = item.role === "system";
    const color = item.role === "error" ? "#dc2626" : item.role === "tool" ? "#2563eb" : theme.node.text;
    if (isSystem) {
        return (
            <div className="flex justify-center text-xs">
                <div className="max-w-[88%] px-3 py-1.5 text-center" style={{ color: theme.node.muted }}>
                    {item.text}
                    {item.meta ? <span className="ml-2 opacity-60">{item.meta}</span> : null}
                </div>
            </div>
        );
    }
    if (item.role === "tool") {
        if (objectField(item.detail, "status") === "pending") return <AgentPendingToolCard summary={item.text} detail={item.detail} theme={theme} onReject={() => onRejectTool?.(item.id)} onApprove={() => onApproveTool?.(item.id)} />;
        return (
            <div className="flex items-start gap-3">
                <AgentAvatar theme={theme} />
                <AgentToolCard title={item.title || "执行记录"} text={item.text} detail={item.detail} theme={theme} />
            </div>
        );
    }
    return (
        <div className={`flex items-start gap-3 ${isUser ? "justify-end" : "justify-start"}`}>
            {!isUser ? <AgentAvatar theme={theme} /> : null}
            <div
                className={isUser ? "min-w-0 max-w-[82%] rounded-xl rounded-br-sm border px-3.5 py-2.5 text-left text-sm leading-6" : "min-w-0 flex-1 text-left text-sm leading-6"}
                style={
                    isUser
                        ? {
                              color,
                              background: `color-mix(in srgb, ${theme.node.text} 7%, ${theme.toolbar.panel})`,
                              borderColor: `color-mix(in srgb, ${theme.node.text} 14%, transparent)`,
                          }
                        : { color }
                }
            >
                {isUser ? (
                    <div className="whitespace-pre-wrap break-words">{item.text}</div>
                ) : (
                    <Streamdown className="agent-streamdown" animated isAnimating={!!item.streamId}>
                        {item.text}
                    </Streamdown>
                )}
                {item.attachments?.length ? <AgentMessageAttachments attachments={item.attachments} /> : null}
                {item.meta ? <div className={`mt-1 text-[11px] opacity-45 ${isUser ? "text-right" : ""}`}>{item.meta}</div> : null}
            </div>
            {isUser ? <AgentUserAvatar user={user} theme={theme} /> : null}
        </div>
    );
});

export function AgentPendingToolCard({
    summary,
    detail,
    theme,
    state = "pending",
    title = "确认下一步",
    approveText = "继续",
    rejectText = "调整方案",
    errorText,
    summaryMeta,
    danger = false,
    confirmationText,
    onReject,
    onApprove,
}: {
    summary: string;
    detail?: unknown;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    state?: "pending" | "running" | "failed";
    title?: string;
    approveText?: string;
    rejectText?: string;
    errorText?: string;
    summaryMeta?: string;
    danger?: boolean;
    confirmationText?: string;
    onReject?: () => void;
    onApprove?: () => void;
}) {
    const technicalDetail = import.meta.env.DEV && detail ? detail : undefined;
    const presentation = state === "running"
        ? { label: "正在执行", color: "#2563eb", border: "rgba(37,99,235,.22)", background: "rgba(37,99,235,.04)", icon: <LoaderCircle className="size-4 motion-safe:animate-spin" /> }
        : state === "failed"
            ? { label: "可以重试", color: "#dc2626", border: "rgba(220,38,38,.20)", background: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" /> }
            : danger
                ? { label: "需要确认", color: "#dc2626", border: "rgba(220,38,38,.20)", background: "rgba(220,38,38,.04)", icon: <CircleAlert className="size-4" /> }
                : { label: "等你决定", color: "#d97706", border: "rgba(217,119,6,.22)", background: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" /> };
    const heading = (
        <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: presentation.border, color: presentation.color, background: presentation.background }}>
                {presentation.icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                    <span>{state === "failed" ? "这一步还没完成" : state === "running" ? "正在加入画布" : title}</span>
                    <span className="inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: presentation.border, color: presentation.color, background: presentation.background }}>
                        {presentation.label}
                    </span>
                    {technicalDetail ? (
                        <span className="ml-auto text-xs font-normal" style={{ color: theme.node.muted }}>
                            开发详情
                        </span>
                    ) : null}
                </div>
                <div className="mt-2 text-sm leading-6" style={{ color: theme.node.text }}>
                    {state === "failed" && errorText ? errorText : summary}
                    {summaryMeta ? <span className="ml-2 whitespace-nowrap text-[11px] font-medium" style={{ color: theme.node.muted }}>· {summaryMeta}</span> : null}
                </div>
            </div>
        </div>
    );
    return (
        <div className="flex items-start gap-3">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 flex-1 rounded-xl border p-4" style={{ borderColor: theme.node.stroke, background: "transparent", color: theme.node.text }}>
                {technicalDetail ? (
                    <details>
                        <summary className="cursor-pointer list-none">{heading}</summary>
                        <AgentDetailBlock detail={technicalDetail} theme={theme} />
                    </details>
                ) : heading}
                {state !== "running" && (onReject || onApprove) ? (
                    <div className="mt-4 grid grid-cols-2 gap-2">
                        {onReject ? (
                            <Button className="!h-9" icon={<XCircle className="size-4" />} onClick={() => onReject()}>
                                {rejectText}
                            </Button>
                        ) : <span />}
                        {onApprove ? (() => {
                            const approveButton = (
                                <Button
                                    className="!h-9"
                                    danger={danger}
                                    icon={state === "failed" ? <LoaderCircle className="size-4" /> : danger ? <CircleAlert className="size-4" /> : <CheckCircle2 className="size-4" />}
                                    style={danger ? { background: "transparent" } : { borderColor: "rgba(22,163,74,.42)", color: "#16a34a", background: "transparent" }}
                                    onClick={confirmationText ? undefined : () => onApprove()}
                                >
                                    {state === "failed" ? "重新尝试" : approveText}
                                </Button>
                            );
                            return confirmationText ? (
                                <Popconfirm
                                    title="确认继续？"
                                    description={confirmationText}
                                    okText="确认更改"
                                    cancelText="取消"
                                    okButtonProps={{ danger: true }}
                                    onConfirm={() => onApprove()}
                                >
                                    {approveButton}
                                </Popconfirm>
                            ) : approveButton;
                        })() : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}

export function AgentToolCard({ title, text, detail, theme }: { title: string; text: string; detail?: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const state = toolCardState(title, text, detail);
    const technicalDetail = import.meta.env.DEV && detail ? detail : undefined;
    const content = (
        <div className="flex items-start gap-3">
            <span className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-lg border" style={{ borderColor: state.softBorder, color: state.color, background: state.softBg }}>
                {state.icon}
            </span>
            <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2 text-sm font-semibold leading-5">
                    <span className="min-w-0 truncate">{title}</span>
                    <span className="inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium" style={{ borderColor: state.softBorder, color: state.color, background: state.softBg }}>
                        {state.label}
                    </span>
                    {technicalDetail ? (
                        <span className="ml-auto text-xs font-normal" style={{ color: theme.node.muted }}>
                            开发详情
                        </span>
                    ) : null}
                </div>
                <div className="mt-2 text-sm leading-6" style={{ color: state.isError ? state.color : theme.node.muted }}>
                    {text}
                </div>
            </div>
        </div>
    );
    const cardStyle = { borderColor: theme.node.stroke, background: "transparent", color: theme.node.text };
    return technicalDetail ? (
        <details className="min-w-0 flex-1 rounded-xl border px-4 py-3.5 text-left" style={cardStyle}>
            <summary className="cursor-pointer list-none">{content}</summary>
            <AgentDetailBlock detail={technicalDetail} theme={theme} />
        </details>
    ) : (
        <div className="min-w-0 flex-1 rounded-xl border px-4 py-3.5 text-left" style={cardStyle}>{content}</div>
    );
}

export function AgentWorkingMessage({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const [length, setLength] = useState(1);
    useEffect(() => {
        const timer = window.setInterval(() => setLength((value) => (value >= WORKING_TEXT.length + 4 ? 1 : value + 1)), 120);
        return () => window.clearInterval(timer);
    }, [setLength]);
    return (
        <div className="flex items-start gap-2.5">
            <AgentAvatar theme={theme} />
            <div className="min-w-0 max-w-[82%]">
                <div className="font-mono text-sm" style={{ color: theme.node.muted }} aria-label={WORKING_TEXT}>
                    <span className="inline-block w-[76px]">{WORKING_TEXT.slice(0, Math.min(length, WORKING_TEXT.length))}</span>
                </div>
            </div>
        </div>
    );
}

export function AgentChatComposer({
    prompt,
    attachments = [],
    disabled,
    sending,
    placeholder,
    theme,
    onPromptChange,
    onSubmit,
    onStop,
    onAddFiles,
    onRemoveAttachment,
    skillChips = [],
    onRemoveSkill,
    left,
}: {
    prompt: string;
    attachments?: CanvasAgentChatAttachment[];
    disabled?: boolean;
    sending?: boolean;
    placeholder: string;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onPromptChange: (value: string) => void;
    onSubmit: () => void;
    onStop?: () => void;
    onAddFiles?: (files: FileList | File[] | null) => void | Promise<void>;
    onRemoveAttachment?: (id: string) => void;
    skillChips?: Array<{ id: string; name: string }>;
    onRemoveSkill?: (id: string) => void;
    left?: ReactNode;
}) {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const canSubmit = !disabled && !sending && Boolean(prompt.trim() || attachments.length || skillChips.length);
    return (
        <div className="px-2 pb-2 pt-2" onWheelCapture={(event) => event.stopPropagation()}>
            <div className="rounded-[24px] border px-3 pb-3 pt-3 shadow-lg" style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke }}>
                {attachments.length ? (
                    <div className="thin-scrollbar mb-2 flex gap-2 overflow-x-auto pb-1">
                        {attachments.map((item) => (
                            <div key={item.id} className="group relative size-14 shrink-0 overflow-hidden rounded-xl border" style={{ borderColor: theme.node.stroke }} title={item.name}>
                                <img src={item.url} alt={item.name} className="size-full object-cover" />
                                {onRemoveAttachment ? (
                                    <button
                                        type="button"
                                        className="absolute right-1 top-1 grid size-5 place-items-center rounded-full border opacity-0 shadow-sm transition group-hover:opacity-100"
                                        style={{ background: theme.toolbar.panel, borderColor: theme.node.stroke, color: theme.node.text }}
                                        onClick={() => onRemoveAttachment(item.id)}
                                        aria-label="移除图片"
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </div>
                        ))}
                    </div>
                ) : null}
                {skillChips.length ? (
                    <div className="mb-2 flex flex-wrap gap-1.5">
                        {skillChips.map((skill) => (
                            <span
                                key={skill.id}
                                className="inline-flex max-w-56 items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px]"
                                style={{ borderColor: theme.node.stroke, background: `color-mix(in srgb, ${theme.node.text} 6%, transparent)`, color: theme.node.text }}
                            >
                                <Sparkles className="size-3 shrink-0" style={{ color: "var(--wg-home-accent)" }} />
                                <span className="truncate">{skill.name}</span>
                                {onRemoveSkill ? (
                                    <button
                                        type="button"
                                        className="grid size-4 shrink-0 place-items-center rounded-full opacity-60 transition hover:opacity-100"
                                        onClick={() => onRemoveSkill(skill.id)}
                                        aria-label={`移除技能 ${skill.name}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                ) : null}
                            </span>
                        ))}
                    </div>
                ) : null}
                <textarea
                    value={prompt}
                    onChange={(event) => onPromptChange(event.target.value)}
                    onPaste={(event) => {
                        if (!onAddFiles) return;
                        const images = Array.from(event.clipboardData.files).filter((file) => file.type.startsWith("image/"));
                        if (!images.length) return;
                        event.preventDefault();
                        void onAddFiles(images);
                    }}
                    onKeyDown={(event) => {
                        if (!isPlainEnterKey(event)) return;
                        event.preventDefault();
                        void onSubmit();
                    }}
                    className="thin-scrollbar max-h-32 min-h-20 w-full resize-none border-0 bg-transparent px-1 py-1 text-sm leading-5 outline-none placeholder:opacity-45"
                    style={{ color: theme.node.text }}
                    placeholder={placeholder}
                />
                <div className="mt-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-1">
                        {onAddFiles ? (
                            <>
                                <input
                                    ref={fileInputRef}
                                    hidden
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    onChange={(event) => {
                                        void onAddFiles(event.target.files);
                                        event.target.value = "";
                                    }}
                                />
                                <Tooltip title="上传图片">
                                    <Button type="text" shape="circle" className="!h-9 !w-9 !min-w-9" disabled={sending} style={{ color: theme.node.muted }} icon={<ImagePlus className="size-4" />} onClick={() => fileInputRef.current?.click()} />
                                </Tooltip>
                            </>
                        ) : null}
                        {left}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                        {sending && onStop ? (
                            <Button danger shape="circle" className="!h-10 !w-10 !min-w-10" icon={<Square className="size-4" />} onClick={() => void onStop()} aria-label="停止" />
                        ) : (
                            <Button
                                type="primary"
                                shape="circle"
                                className="!h-10 !w-10 !min-w-10"
                                disabled={!canSubmit}
                                icon={sending ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowUp className="size-4" />}
                                onClick={() => void onSubmit()}
                                aria-label="发送"
                            />
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

export function AgentPanelTabs<T extends string>({
    value,
    items,
    theme,
    right,
    onChange,
}: {
    value: T;
    items: { value: T; label: string; icon?: ReactNode; count?: number }[];
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    right?: ReactNode;
    onChange: (value: T) => void;
}) {
    return (
        <div className="border-b px-3" style={{ borderColor: theme.node.stroke }}>
            <div className="flex min-h-11 items-center justify-between gap-3">
                <nav className="thin-scrollbar flex min-w-0 flex-1 items-center gap-3 overflow-x-auto text-sm" role="tablist" aria-label="Agent 面板">
                    {items.map((item) => (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={value === item.value}
                            className={`inline-flex h-11 shrink-0 items-center gap-1.5 border-b-2 px-0.5 transition ${value === item.value ? "font-medium" : "font-normal"}`}
                            style={{ borderColor: value === item.value ? theme.node.text : "transparent", color: value === item.value ? theme.node.text : theme.node.muted }}
                            onClick={() => onChange(item.value)}
                        >
                            {item.icon}
                            {item.label}
                            {item.count ? ` ${item.count}` : ""}
                        </button>
                    ))}
                </nav>
                {right ? <div className="flex shrink-0 items-center gap-2">{right}</div> : null}
            </div>
        </div>
    );
}

function AgentDetailBlock({ detail, theme }: { detail: unknown; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return (
        <pre className="thin-scrollbar mt-3 max-h-64 overflow-auto rounded-lg border p-3 text-[11px] leading-4" style={{ borderColor: theme.node.stroke, background: theme.toolbar.panel, color: theme.node.muted }}>
            {JSON.stringify(detail, null, 2)}
        </pre>
    );
}

function AgentAvatar({ theme }: { theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    return <ZodiacAvatar className="size-8" />;
}

function AgentUserAvatar({ user, theme }: { user: LocalUser | null; theme: (typeof canvasThemes)[keyof typeof canvasThemes] }) {
    const avatarUrl = user?.avatarUrl?.trim();
    return (
        <span className="grid size-8 shrink-0 place-items-center overflow-hidden rounded-full" style={{ color: theme.node.text }}>
            {avatarUrl ? <img src={avatarUrl} alt="" className="size-full object-cover" referrerPolicy="no-referrer" /> : <UserRound className="size-4" />}
        </span>
    );
}

function AgentMessageAttachments({ attachments }: { attachments: CanvasAgentChatAttachment[] }) {
    return (
        <div className="mt-2 grid grid-cols-3 gap-1.5">
            {attachments.map((item) => (
                <img key={item.id} src={item.url} alt={item.name} className="aspect-square w-full rounded-lg object-cover" />
            ))}
        </div>
    );
}

function toolCardState(title: string, text: string, detail?: unknown) {
    const raw = `${title} ${text} ${normalizeText(objectField(detail, "error"))}`;
    const lower = raw.toLowerCase();
    const tool = String(objectField(detail, "name") || objectField(detail, "tool") || "");
    const status = String(objectField(detail, "status") || "").toLowerCase();
    if (status === "noop" || /未生效|无需|没有找到|没有.*可|已存在/.test(raw))
        return { label: "未生效", color: "#d97706", softBorder: "rgba(217,119,6,.22)", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (/拒绝|取消/.test(raw) || lower.includes("rejected") || status === "rejected") return { label: "继续调整", color: "#d97706", softBorder: "rgba(217,119,6,.22)", softBg: "rgba(217,119,6,.04)", icon: <CircleAlert className="size-4" />, isError: false };
    if (/失败|错误/.test(raw) || lower.includes("failed") || lower.includes("error") || status === "failed" || status === "error") return { label: "未完成", color: "#dc2626", softBorder: "rgba(220,38,38,.20)", softBg: "rgba(220,38,38,.04)", icon: <XCircle className="size-4" />, isError: true };
    if (/完成|成功|已应用/.test(raw) || lower.includes("completed") || lower.includes("succeeded") || lower.includes("applied") || status === "applied" || status === "completed" || status === "succeeded")
        return { label: tool === "canvas_apply_ops" || /画布操作|画布提案/.test(title) ? "已加入画布" : "已完成", color: "#16a34a", softBorder: "rgba(22,163,74,.20)", softBg: "rgba(22,163,74,.04)", icon: <CheckCircle2 className="size-4" />, isError: false };
    return { label: "进行中", color: "#2563eb", softBorder: "rgba(37,99,235,.20)", softBg: "rgba(37,99,235,.04)", icon: <LoaderCircle className="size-4" />, isError: false };
}

function normalizeText(value: unknown) {
    if (typeof value === "string") return value.trim();
    if (value instanceof Error) return value.message;
    if (value == null) return "";
    return JSON.stringify(value, null, 2);
}

function objectField(value: unknown, key: string) {
    return value && typeof value === "object" ? (value as Record<string, unknown>)[key] : undefined;
}
