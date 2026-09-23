import { useEffect, useMemo, useState } from "react";
import { App, Empty, Input, Spin, Dropdown, Drawer } from "antd";
import { ArrowUpRight, MessageSquare, Search, MoreHorizontal, Archive, ArchiveRestore, Trash2, FileText } from "lucide-react";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { Streamdown } from "streamdown";
import { useNavigate } from "react-router-dom";
import { archiveZodiacSessionById, deleteArchivedZodiacSession, listZodiacSessions, resumeZodiacSession, type ZodiacListedSession } from "@/services/zodiac-session-storage";
import { flushAppState } from "@/services/app-lifecycle";
import { getStoredValue } from "@/services/server-storage";
import { useAgentStore } from "@/stores/use-agent-store";

export function ZodiacSessionList({
    workspaceId,
    archivedOnly = false,
    variant = "panel",
    onOpen,
    onPreview,
}: {
    variant?: "page" | "panel";
    archivedOnly?: boolean;
    workspaceId?: string;
    onOpen?: () => void;
    onPreview?: (session: ZodiacListedSession) => void;
}) {
    const { message, modal } = App.useApp();
    const { t } = useAppTranslation();
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
        if (session.archived && !restore) {
            (onPreview || setPreview)(session);
            return;
        }
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
    const archive = async (session: ZodiacListedSession) => {
        try {
            if (Object.values(useAgentStore.getState().work[session.workspaceId] || {}).some(Boolean)) throw new Error(t("该工作流正在运行，请结束任务后归档。"));
            await flushAppState();
            await archiveZodiacSessionById(session.id);
            setSessions(await listZodiacSessions());
            message.success(t("会话已归档"));
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("归档失败"));
        }
    };
    const remove = (session: ZodiacListedSession) =>
        modal.confirm({
            title: t("删除这段对话？"),
            content: t("画布和素材会保留。"),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                try {
                    await deleteArchivedZodiacSession(session.id);
                    setSessions((current) => current?.filter((item) => item.id !== session.id) || []);
                } catch (error) {
                    message.error(t("删除失败，请重试"));
                    throw error;
                }
            },
        });
    const search = <Input aria-label={t("搜索对话")} prefix={<Search className="mr-1 size-4 opacity-50" />} placeholder={t("搜索对话")} value={query} onChange={(event) => setQuery(event.target.value)} allowClear />;
    return (
        <div className="wg-session-surface wg-session-list flex min-h-0 flex-1 flex-col">
            {variant === "page" ? (
                <header className="wg-page-header shrink-0">
                    <div className="min-w-0">
                        <h1>{t("对话")}</h1>
                        <p className="mt-1 text-xs text-[color:var(--wg-home-muted)]">{t("已归档的创作记录")}</p>
                    </div>
                    <div className="ml-auto w-full max-w-sm">{search}</div>
                </header>
            ) : (
                <div className="mb-4">{search}</div>
            )}
            <div className={`thin-scrollbar min-h-0 flex-1 overflow-y-auto ${variant === "page" ? "wg-library-content" : ""}`}>
                {!sessions ? (
                    <div className="p-10 text-center">
                        <Spin />
                    </div>
                ) : !visible.length ? (
                    <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t(query ? "没有找到对话" : "还没有对话")} />
                ) : (
                    <div className="wg-interface-enter">
                        {visible.map((session) => (
                            <article key={session.id} className="wg-session-row">
                                <button type="button" className="wg-session-open" disabled={!!opening} onClick={() => void open(session)}>
                                    <MessageSquare className="size-4 shrink-0 opacity-45" strokeWidth={1.6} />
                                    <span className="min-w-0 flex-1">
                                        <span className="block truncate text-sm font-medium">{session.title}</span>
                                        <span className="mt-1.5 flex items-center gap-2 text-xs text-[color:var(--wg-home-muted)]">
                                            <span className="truncate">{session.workspaceTitle}</span>
                                            <span aria-hidden="true">·</span>
                                            <time className="shrink-0" dateTime={session.updatedAt}>
                                                {new Date(session.updatedAt).toLocaleDateString()}
                                            </time>
                                        </span>
                                    </span>
                                    {opening === session.id ? <Spin size="small" /> : <ArrowUpRight className="wg-session-arrow size-4 shrink-0" />}
                                </button>
                                <Dropdown
                                    trigger={["click"]}
                                    classNames={{ root: "wg-canvas-menu" }}
                                    menu={{
                                        items: [
                                            { key: "preview", label: t("查看记录"), icon: <FileText className="size-4" /> },
                                            ...(session.archived && archivedOnly && !workspaceId ? [{ key: "restore", label: t("恢复"), icon: <ArchiveRestore className="size-4" />, disabled: !!opening }] : []),
                                            ...(!session.archived ? [{ key: "archive", label: t("归档"), icon: <Archive className="size-4" />, disabled: !!opening }] : []),
                                            ...(session.archived ? [{ key: "delete", label: t("删除"), icon: <Trash2 className="size-4" />, danger: true }] : []),
                                        ],
                                        onClick: ({ key }) => {
                                            if (key === "preview") (onPreview || setPreview)(session);
                                            if (key === "restore") void open(session, true);
                                            if (key === "archive") void archive(session);
                                            if (key === "delete") remove(session);
                                        },
                                    }}
                                >
                                    <button type="button" className="wg-icon-button" aria-label={t("对话操作")} title={t("对话操作")}>
                                        <MoreHorizontal />
                                    </button>
                                </Dropdown>
                            </article>
                        ))}
                    </div>
                )}
            </div>
            <Drawer rootClassName="zodiac-surface wg-session-surface" title={preview?.title || "对话记录"} open={!!preview} onClose={() => setPreview(null)} width={580}>
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
