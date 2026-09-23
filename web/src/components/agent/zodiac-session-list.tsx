import { useEffect, useMemo, useState } from "react";
import { App, Button, Empty, Input, Spin, Popconfirm, Drawer } from "antd";
import { ArrowUpRight, MessageSquare, Search } from "lucide-react";
import { Streamdown } from "streamdown";
import { useNavigate } from "react-router-dom";
import { archiveZodiacSessionById, deleteArchivedZodiacSession, listZodiacSessions, resumeZodiacSession, type ZodiacListedSession } from "@/services/zodiac-session-storage";
import { flushAppState } from "@/services/app-lifecycle";
import { getStoredValue } from "@/services/server-storage";
import { useAgentStore } from "@/stores/use-agent-store";

export function ZodiacSessionList({ workspaceId, archivedOnly = false, onOpen, onPreview }: { archivedOnly?: boolean; workspaceId?: string; onOpen?: () => void; onPreview?: (session: ZodiacListedSession) => void }) {
    const { message } = App.useApp();
    const navigate = useNavigate();
    const [sessions, setSessions] = useState<ZodiacListedSession[] | null>(null);
    const [query, setQuery] = useState("");
    const [preview, setPreview] = useState<ZodiacListedSession | null>(null);
    const [opening, setOpening] = useState("");
    useEffect(() => {
        let alive = true;
        void flushAppState()
            .then(() => listZodiacSessions())
            .then((value) => {
                if (alive) setSessions(value);
            })
            .catch((error) => {
                if (alive) {
                    setSessions([]);
                    message.error(String(error));
                }
            });
        return () => {
            alive = false;
        };
    }, [message, workspaceId]);
    const visible = useMemo(
        () =>
            (sessions || [])
                .filter((session) => (!workspaceId || session.workspaceId === workspaceId) && session.archived === (archivedOnly && !workspaceId))
                .filter((session) => [session.title, session.workspaceTitle, ...session.items.map((item) => item.text || "")].join(" ").toLowerCase().includes(query.toLowerCase())),
        [sessions, query, workspaceId, archivedOnly],
    );
    const open = async (session: ZodiacListedSession, restore = false) => {
        if (session.archived && !restore) { (onPreview || setPreview)(session); return; }
        if (opening) return;
        setOpening(session.id);
        try {
            if (Object.values(useAgentStore.getState().work[session.workspaceId] || {}).some(Boolean)) throw new Error("该工作流正在运行，请结束当前任务后恢复会话。");
            await flushAppState();
            if (session.workspaceId !== "workspace" && !(await getStoredValue("canvas-project-v1", session.workspaceId))) throw new Error("对应画布已删除，可以查看这段对话。");
            await resumeZodiacSession(session.id, { restoreArchived: restore });
            navigate(session.workspaceId === "workspace" ? "/sessions" : `/canvas/${encodeURIComponent(session.workspaceId)}`);
            useAgentStore.getState().openPanel();
            onOpen?.();
        } catch (error) {
            message.error(error instanceof Error ? error.message : "无法打开会话");
        } finally {
            setOpening("");
        }
    };
    return (
        <div className="flex min-h-0 flex-1 flex-col gap-4">
            <Input aria-label="搜索对话" prefix={<Search className="mr-1 size-4 opacity-50" />} placeholder="搜索对话" value={query} onChange={(event) => setQuery(event.target.value)} allowClear />
            <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
                {!sessions ? (
                    <div className="p-10 text-center">
                        <Spin />
                    </div>
                ) : !visible.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={query ? "没有找到对话" : "还没有对话"} />
                ) : (
                    visible.map((session) => (
                        <article key={session.id} className="zodiac-enter group mb-1 rounded-lg p-3.5 transition-colors hover:bg-[color:var(--wg-home-hover)]">
                            <button type="button" className="flex w-full items-start gap-3 text-left" disabled={!!opening} onClick={() => void open(session)}>
                                <MessageSquare className="mt-1 size-4 shrink-0 opacity-50" />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate text-sm font-medium">{session.title}</span>
                                    <span className="mt-1 block truncate text-xs opacity-55">
                                        {session.workspaceTitle} · {new Date(session.updatedAt).toLocaleDateString()}
                                    </span>
                                </span>
                                {opening === session.id ? <Spin size="small" /> : <ArrowUpRight className="size-4 opacity-40" />}
                            </button>
                            <div className="mt-3 flex items-center justify-between pl-7 text-xs">
                                <span className="opacity-45">{session.archived ? "已归档" : "最近使用"}</span>
                                <div className="flex items-center gap-1">
                                    {archivedOnly && !workspaceId && session.archived ? <Button type="text" size="small" disabled={!!opening} onClick={() => void open(session, true)}>恢复</Button> : null}
                                    {!session.archived ? <Button type="text" size="small" disabled={!!opening} onClick={async () => {
                                        try {
                                            if (Object.values(useAgentStore.getState().work[session.workspaceId] || {}).some(Boolean)) throw new Error("该工作流正在运行，请结束任务后归档。");
                                            await flushAppState();
                                            await archiveZodiacSessionById(session.id);
                                            setSessions(await listZodiacSessions());
                                            message.success("会话已归档");
                                        } catch (error) { message.error(error instanceof Error ? error.message : "归档失败"); }
                                    }}>归档</Button> : null}
                                    {session.archived ? (
                                        <Popconfirm
                                            title="删除这段对话？"
                                            description="画布和素材会保留。"
                                            onConfirm={async () => {
                                                try {
                                                    await deleteArchivedZodiacSession(session.id);
                                                    setSessions((current) => current?.filter((item) => item.id !== session.id) || []);
                                                } catch {
                                                    message.error("删除失败，请重试");
                                                }
                                            }}
                                        >
                                            <Button type="text" size="small" danger>
                                                删除
                                            </Button>
                                        </Popconfirm>
                                    ) : null}
                                    <Button type="text" size="small" onClick={() => (onPreview || setPreview)(session)}>
                                        查看记录
                                    </Button>
                                </div>
                            </div>
                        </article>
                    ))
                )}
            </div>
            <Drawer rootClassName="zodiac-surface" title={preview?.title || "对话记录"} open={!!preview} onClose={() => setPreview(null)} width={580}>
                {preview?.items
                    .filter((item) => item.text && ["user", "assistant", "error"].includes(item.role || ""))
                    .map((item) => (
                        <div key={item.id} className="mb-5">
                            <p className="mb-1 text-xs opacity-50">{item.role === "user" ? "你" : "Zodiac"}</p>
                            <Streamdown>{item.text || ""}</Streamdown>
                        </div>
                    ))}
            </Drawer>
        </div>
    );
}
