import { useEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { Button, Empty, Input, Modal, Select, Spin, Tag } from "antd";
import { agentRequest } from "@/services/api/opencode-runtime";
import type { ZodiacActivity } from "@/lib/agent/zodiac-activity";

type TraceRecord = {
    id: string;
    messageId: string;
    sessionId: string;
    at: number;
    title: string;
    parentId?: string;
    info: { role?: string; agent?: string; tokens?: unknown; modelID?: string; error?: unknown };
    part: { type: string; text?: string; tool?: string; state?: { status?: string; input?: unknown; output?: unknown; error?: string; time?: { start?: number; end?: number } }; time?: { start?: number; end?: number } };
};
type TracePage = { records: TraceRecord[]; before: number | null };
export function traceText(value: unknown): string {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) || "";
    return text
        .replace(/\b(?:sk|provider[-_]?secret|secret)[-_][a-z\d_-]{8,}\b/giu, "[凭据已隐藏]")
        .replace(/\bBearer\s+[^\s,;"']+/giu, "Bearer [凭据已隐藏]")
        .replace(/((?:api[_-]?key|access[_-]?token|authorization|password|secret)["']?\s*[=:：]\s*)["']?[^\s,;"'}]+["']?/giu, "$1[凭据已隐藏]");
}
const statusText: Record<string, string> = { completed: "完成", done: "完成", error: "失败", running: "进行中", pending: "等待", waiting: "待审批" };
const kindText: Record<string, string> = { text: "回复", reasoning: "思考", tool: "工具", file: "附件", "step-start": "开始", "step-finish": "结束", approval: "审批" };

export function ZodiacTracePanel({ open, onClose, projectId, sessionId, running, activities }: { open: boolean; onClose: () => void; projectId: string; sessionId: string; running: boolean; activities: ZodiacActivity[] }) {
    const { t } = useAppTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const followRef = useRef(true);
    const runningRef = useRef(running);
    runningRef.current = running;
    const [records, setRecords] = useState<TraceRecord[]>([]);
    const [before, setBefore] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [selected, setSelected] = useState("");
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        followRef.current = true;
        setRecords([]);
        setBefore(null);
        setSelected("");
        setLoading(true);
        const read = async (first = false) => {
            try {
                const page = await agentRequest<TracePage>("trace", { projectId, sessionId }, controller.signal);
                setRecords((old) => [...new Map([...old, ...page.records].map((row) => [row.id, row])).values()].sort((a, b) => a.at - b.at));
                if (first) setBefore(page.before);
                setError("");
            } catch (e) {
                if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "轨迹读取失败");
            } finally {
                if (!controller.signal.aborted) {
                    setLoading(false);
                    timer = setTimeout(() => void read(), runningRef.current ? 2500 : 10000);
                }
            }
        };
        void read(true);
        return () => {
            controller.abort();
            clearTimeout(timer);
        };
    }, [open, projectId, sessionId]);
    useEffect(() => {
        if (followRef.current && scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }, [records]);
    const approvals: TraceRecord[] = activities
        .filter((row) => row.kind === "approval" || row.status === "error")
        .map((row) => ({
            id: `approval-${row.id}`,
            messageId: row.id,
            sessionId,
            at: row.startedAt,
            title: "权限",
            info: {},
            part: { type: row.kind === "approval" ? "approval" : "error", text: row.label, state: { status: row.status, input: row.kind === "approval" ? row.detail : undefined, error: row.status === "error" ? row.detail || row.label : undefined } },
        }));
    const rows = useMemo(() => [...records, ...approvals].filter((row) => !["step-start", "step-finish", "patch"].includes(row.part.type)).sort((a, b) => a.at - b.at), [records, activities]);
    const visible = rows.filter((row) => (filter === "all" || (filter === "error" ? row.part.state?.status === "error" || !!row.info.error : (row.info.agent || "zodiac") === filter)) && traceText(row).toLowerCase().includes(query.toLowerCase()));
    const detail = rows.find((row) => row.id === selected);
    const start = rows[0]?.at || 0;
    const turns = rows.filter((row) => row.info.role === "user" && !row.parentId && row.part.type === "text");
    const turnLabel = (row: TraceRecord) => turns.filter((turn) => turn.at <= row.at).length;
    const end = Math.max(start + 1, ...rows.map((row) => row.part.state?.time?.end || row.part.time?.end || row.at));
    const older = async () => {
        followRef.current = false;
        setLoading(true);
        try {
            const page = await agentRequest<TracePage>("trace", { projectId, sessionId, before });
            setRecords((old) => [...new Map([...page.records, ...old].map((row) => [row.id, row])).values()]);
            setBefore(page.before);
        } catch (e) {
            setError(e instanceof Error ? e.message : "读取失败");
        } finally {
            setLoading(false);
        }
    };
    return (
        <Modal rootClassName="zodiac-surface" title={t("轨迹")} open={open} onCancel={onClose} footer={null} width={1180} styles={{ body: { height: "72vh", display: "flex", flexDirection: "column", gap: 12 } }} destroyOnHidden>
            <div className="flex flex-wrap gap-2">
                <Input aria-label={t("搜索轨迹")} placeholder={t("搜索工具、输入或错误")} className="!w-72" value={query} onChange={(e) => setQuery(e.target.value)} allowClear />
                <Select
                    aria-label={t("筛选轨迹")}
                    value={filter}
                    onChange={setFilter}
                    className="w-40"
                    options={[{ value: "all", label: t("全部记录") }, { value: "error", label: t("失败记录") }, ...[...new Set(records.map((row) => row.info.agent).filter(Boolean))].map((value) => ({ value, label: value }))]}
                />
                <span className="self-center text-xs opacity-50">{t("{count} 条记录", { count: visible.length })}</span>
            </div>
            {error ? (
                <p role="alert" className="text-red-500">
                    {error}
                </p>
            ) : null}
            <div className="flex h-9 shrink-0 items-center gap-px rounded border px-2" aria-label={t("活动时间线")}>
                <svg viewBox="0 0 1000 24" className="h-6 w-full" role="img" aria-label={t("按实际开始时间与耗时排列的活动")}>
                    {rows.map((row) => {
                        const time = row.part.state?.time || row.part.time;
                        const x = ((row.at - start) / (end - start)) * 995;
                        return (
                            <rect
                                key={row.id}
                                x={x}
                                y={row.parentId ? 13 : 2}
                                width={time?.end && time.start ? Math.max(2, ((time.end - time.start) / (end - start)) * 995) : 2}
                                height={9}
                                fill={row.part.state?.status === "error" || !!row.info.error ? "#ef4444" : row.id === selected ? "#f59e0b" : "#6b8aca"}
                                onClick={() => setSelected(row.id)}
                                className="cursor-pointer"
                            >
                                <title>{row.part.tool || row.info.agent || row.part.type}</title>
                            </rect>
                        );
                    })}
                </svg>
            </div>
            <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(260px,.8fr)] gap-3 max-md:grid-cols-1">
                <div
                    ref={scrollRef}
                    onWheel={(event) => {
                        if (event.deltaY < 0) followRef.current = false;
                    }}
                    onScroll={(event) => {
                        const el = event.currentTarget;
                        followRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                    }}
                    className="thin-scrollbar min-h-0 overflow-auto rounded-lg border"
                >
                    {before ? (
                        <Button block type="text" loading={loading} onClick={() => void older()}>
                            {t("加载更早记录")}
                        </Button>
                    ) : null}
                    {!rows.length ? (
                        loading ? (
                            <div className="p-10 text-center">
                                <Spin />
                            </div>
                        ) : (
                            <Empty className="py-10" description={t("暂无轨迹")} />
                        )
                    ) : (
                        <table className="w-full table-fixed text-left text-xs">
                            <thead className="sticky top-0 bg-[color:var(--wg-panel)]">
                                <tr>
                                    <th className="w-12 p-2">{t("轮次")}</th>
                                    <th className="w-20 p-2">{t("时间")}</th>
                                    <th className="w-24 p-2">{t("智能体")}</th>
                                    <th className="p-2">{t("记录")}</th>
                                    <th className="w-16 p-2">{t("状态")}</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visible.map((row) => (
                                    <tr key={row.id} className={`cursor-pointer border-t hover:bg-[color:var(--wg-home-hover)] ${selected === row.id ? "bg-[color:var(--wg-home-hover)]" : ""}`} onClick={() => setSelected(row.id)}>
                                        <td className="p-2 opacity-50">{turnLabel(row) || "—"}</td>
                                        <td className="p-2 tabular-nums">{new Date(row.at).toLocaleTimeString()}</td>
                                        <td className="truncate p-2" title={row.title}>
                                            {row.info.role === "user" ? "你" : row.info.agent || (row.parentId ? row.title : "Zodiac")}
                                        </td>
                                        <td className="p-2">
                                            <button className="block w-full truncate text-left" onClick={() => setSelected(row.id)}>
                                                {row.part.tool || t(kindText[row.part.type] || row.part.type)} · {traceText(row.part.text || row.part.state?.error || row.info.error || row.part.state?.input).slice(0, 100)}
                                            </button>
                                        </td>
                                        <td className="p-2">{t(statusText[row.info.error ? "error" : row.part.state?.status || ""] || "—")}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}
                </div>
                <section aria-label={t("轨迹详情")} className="thin-scrollbar min-h-0 overflow-auto rounded-lg border p-4">
                    {!detail ? (
                        <p className="text-sm opacity-50">{t("选择记录，查看输入、输出和错误。")}</p>
                    ) : (
                        <>
                            <div className="mb-4 flex flex-wrap gap-2">
                                <Tag>{detail.info.agent || detail.info.role || "Zodiac"}</Tag>
                                <strong>{detail.part.tool || t(kindText[detail.part.type] || detail.part.type)}</strong>
                            </div>
                            {(() => {
                                const time = detail.part.state?.time || detail.part.time;
                                return time?.start && time.end ? <p className="mb-3 text-xs opacity-60">{t("耗时 {seconds} 秒", { seconds: ((time.end - time.start) / 1000).toFixed(2) })}</p> : null;
                            })()}
                            {[
                                { label: "输入", value: detail.part.state?.input },
                                { label: "输出", value: detail.part.state?.output ?? detail.part.text },
                                { label: "错误", value: detail.part.state?.error ?? detail.info.error },
                                { label: "用量", value: detail.info.tokens },
                            ]
                                .filter((entry) => entry.value != null)
                                .map((entry) => (
                                    <div key={entry.label} className="mb-5">
                                        <h3 className="mb-2 text-xs opacity-60">{t(entry.label)}</h3>
                                        <pre className="whitespace-pre-wrap break-words text-xs leading-5">{traceText(entry.value)}</pre>
                                    </div>
                                ))}
                            <details>
                                <summary className="cursor-pointer text-xs opacity-60">{t("原始记录")}</summary>
                                <pre className="mt-2 whitespace-pre-wrap break-words text-xs">{traceText(detail)}</pre>
                            </details>
                        </>
                    )}
                </section>
            </div>
        </Modal>
    );
}
