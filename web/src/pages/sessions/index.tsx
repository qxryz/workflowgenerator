import { useEffect, useMemo, useState } from "react";
import { App, Button, Drawer, Empty, Popconfirm, Spin, Tag } from "antd";
import { BubbleChatIcon, Delete02Icon, Search01Icon, ViewIcon } from "hugeicons-react";
import { Streamdown } from "streamdown";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import {
    deleteArchivedZodiacSession,
    listArchivedZodiacSessions,
    type ZodiacArchivedSession,
    type ZodiacSessionItem,
} from "@/services/zodiac-session-storage";

type HistoryItem = ZodiacSessionItem & { role?: string; text?: string };
type HistorySession = ZodiacArchivedSession<HistoryItem>;

export default function ZodiacSessionsPage() {
    const { message } = App.useApp();
    const [sessions, setSessions] = useState<HistorySession[] | null>(null);
    const [preview, setPreview] = useState<HistorySession | null>(null);
    const [query, setQuery] = useState("");

    useEffect(() => {
        void listArchivedZodiacSessions<HistoryItem>()
            .then(setSessions)
            .catch((error) => {
                console.error("Failed to load Zodiac sessions.", error);
                setSessions([]);
                message.error("会话记录加载失败");
            });
    }, [message]);

    const filtered = useMemo(() => {
        const keyword = query.trim().toLocaleLowerCase();
        if (!keyword) return sessions || [];
        return (sessions || []).filter((session) =>
            [session.title, session.workspaceTitle, session.summary, ...session.items.map((item) => item.text || "")]
                .join(" ")
                .toLocaleLowerCase()
                .includes(keyword),
        );
    }, [query, sessions]);

    const deleteSession = async (session: HistorySession) => {
        try {
            await deleteArchivedZodiacSession(session.id);
            setSessions((current) => current?.filter((item) => item.id !== session.id) || []);
            setPreview((current) => current?.id === session.id ? null : current);
            message.success("会话已删除");
        } catch (error) {
            console.error("Failed to delete Zodiac session.", error);
            message.error("删除失败，请重试");
        }
    };

    return (
        <main className="wg-paper-surface flex h-full min-w-0 flex-col overflow-hidden bg-transparent text-[color:var(--wg-home-text)]">
            <header className="flex min-h-[68px] shrink-0 items-center gap-4 border-b border-dashed border-[color:var(--wg-pencil-soft)] px-5 lg:px-7">
                <div className="min-w-0">
                    <h1 className="wg-sketch-title text-[21px] font-semibold">Zodiac 会话</h1>
                    <p className="wg-ascii-label mt-0.5 text-[9px] tabular-nums text-[color:var(--wg-home-muted-strong)]">
                        SESSIONS / {String(sessions?.length || 0).padStart(2, "0")}
                    </p>
                </div>
                <label className="ml-auto flex h-9 w-[min(36vw,340px)] items-center gap-2 rounded-[9px] border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-3 text-[color:var(--wg-home-muted)] focus-within:border-[color:var(--wg-home-accent)] focus-within:ring-2 focus-within:ring-[color:var(--wg-home-accent)]/10">
                    <Search01Icon className="size-4 shrink-0" strokeWidth={1.7} />
                    <input
                        value={query}
                        onChange={(event) => setQuery(event.target.value)}
                        placeholder="搜索会话"
                        className="min-w-0 flex-1 bg-transparent text-[12px] text-[color:var(--wg-home-text)] outline-none placeholder:text-[color:var(--wg-home-muted-strong)]"
                    />
                </label>
            </header>

            <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 lg:px-6 lg:py-5">
                {sessions === null ? (
                    <div className="flex h-64 items-center justify-center" role="status" aria-label="正在读取会话">
                        <Spin />
                    </div>
                ) : null}

                {sessions?.length === 0 ? (
                    <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        className="py-20"
                        description={
                            <div>
                                <div className="text-sm text-[color:var(--wg-home-text)]">还没有会话记录</div>
                                <div className="mt-1 text-xs text-[color:var(--wg-home-muted)]">在 Zodiac 中开始新会话后，上一段对话会保存在这里。</div>
                            </div>
                        }
                    />
                ) : null}

                {sessions && sessions.length > 0 && filtered.length === 0 ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} className="py-20" description="没有匹配的会话" />
                ) : null}

                {filtered.length ? (
                    <div className="grid gap-3 xl:grid-cols-2 2xl:grid-cols-3">
                        {filtered.map((session) => {
                            const turns = session.items.filter((item) => item.role === "user" || item.role === "assistant");
                            const excerpt = withoutReasoning([...turns].reverse().find((item) => item.text?.trim())?.text || session.summary || "");
                            return (
                                <article
                                    key={session.id}
                                    className="group flex min-h-40 flex-col rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-4 transition-colors hover:border-[color:var(--wg-home-accent)]/45 hover:bg-[color:var(--wg-home-hover)]"
                                >
                                    <div className="flex items-start gap-3">
                                        <ZodiacAvatar className="size-9 shrink-0" />
                                        <div className="min-w-0 flex-1">
                                            <h2 className="truncate text-[14px] font-semibold">{session.title}</h2>
                                            <div className="mt-1 flex min-w-0 items-center gap-2 text-[11px] text-[color:var(--wg-home-muted)]">
                                                <span className="truncate">{session.workspaceTitle}</span>
                                                <span aria-hidden>·</span>
                                                <time className="shrink-0">{formatSessionTime(session.endedAt)}</time>
                                            </div>
                                        </div>
                                        <Tag className="!m-0 shrink-0">{turns.length} 条</Tag>
                                    </div>

                                    <p className="mt-4 line-clamp-3 text-[12px] leading-5 text-[color:var(--wg-home-muted)]">
                                        {excerpt || "这段会话没有可预览的内容。"}
                                    </p>

                                    <div className="mt-auto flex items-center justify-end gap-1 pt-4">
                                        <Button type="text" size="small" icon={<ViewIcon className="size-3.5" />} onClick={() => setPreview(session)}>
                                            浏览
                                        </Button>
                                        <Popconfirm
                                            title="删除这段会话？"
                                            description="删除后无法恢复。"
                                            okText="删除"
                                            cancelText="取消"
                                            okButtonProps={{ danger: true }}
                                            onConfirm={() => deleteSession(session)}
                                        >
                                            <Button danger type="text" size="small" icon={<Delete02Icon className="size-3.5" />}>
                                                删除
                                            </Button>
                                        </Popconfirm>
                                    </div>
                                </article>
                            );
                        })}
                    </div>
                ) : null}
            </div>

            <Drawer
                open={Boolean(preview)}
                width={640}
                title={preview ? (
                    <div className="flex min-w-0 items-center gap-3">
                        <ZodiacAvatar className="size-8 shrink-0" />
                        <div className="min-w-0">
                            <div className="truncate text-sm font-semibold">{preview.title}</div>
                            <div className="mt-0.5 truncate text-[11px] font-normal text-[color:var(--wg-home-muted)]">
                                {preview.workspaceTitle} · {formatSessionTime(preview.endedAt)}
                            </div>
                        </div>
                    </div>
                ) : null}
                onClose={() => setPreview(null)}
                extra={preview ? (
                    <Popconfirm
                        title="删除这段会话？"
                        description="删除后无法恢复。"
                        okText="删除"
                        cancelText="取消"
                        okButtonProps={{ danger: true }}
                        onConfirm={() => deleteSession(preview)}
                    >
                        <Button danger type="text" size="small" icon={<Delete02Icon className="size-3.5" />}>删除</Button>
                    </Popconfirm>
                ) : null}
            >
                {preview ? <SessionPreview session={preview} /> : null}
            </Drawer>
        </main>
    );
}

function SessionPreview({ session }: { session: HistorySession }) {
    const conversation = session.items.filter((item) => item.role === "user" || item.role === "assistant");
    return (
        <div className="space-y-5 pb-8">
            {session.summary ? (
                <section className="rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-hover)] p-4">
                    <div className="mb-2 flex items-center gap-2 text-[11px] font-semibold text-[color:var(--wg-home-muted)]">
                        <BubbleChatIcon className="size-3.5" />
                        对话摘要
                    </div>
                    <Streamdown className="agent-streamdown text-sm">{session.summary}</Streamdown>
                </section>
            ) : null}
            {conversation.map((item) => (
                <section key={item.id} className={item.role === "user" ? "ml-10 rounded-xl bg-[color:var(--wg-home-hover)] px-4 py-3" : "mr-5"}>
                    <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-[.12em] text-[color:var(--wg-home-muted)]">
                        {item.role === "user" ? "你" : "Zodiac"}
                    </div>
                    {item.role === "assistant" ? (
                        <Streamdown className="agent-streamdown text-sm">{withoutReasoning(item.text || "")}</Streamdown>
                    ) : (
                        <p className="whitespace-pre-wrap text-sm leading-6">{item.text}</p>
                    )}
                </section>
            ))}
        </div>
    );
}

function withoutReasoning(text: string) {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/<think>[\s\S]*$/gi, "").trim();
}

function formatSessionTime(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return new Intl.DateTimeFormat("zh-CN", {
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
    }).format(date);
}
