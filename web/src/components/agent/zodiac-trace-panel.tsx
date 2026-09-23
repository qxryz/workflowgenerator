import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { Button, Empty, Input, Modal, Select, Slider, Spin } from "antd";
import { agentRequest } from "@/services/api/opencode-runtime";
import { ArrowDownToLine, ChevronLeft, ChevronRight, Minus, Plus } from "lucide-react";
import { layoutTraceTimeline } from "@/lib/agent/zodiac-trace-layout";
import "./zodiac-trace.css";
import type { ZodiacActivity } from "@/lib/agent/zodiac-activity";
import type { TraceTokens, TraceUsage } from "@/lib/agent/zodiac-trace-usage";
import { TraceUsageDetails, TraceUsagePill } from "./zodiac-trace-usage";

type TraceRecord = {
    id: string;
    messageId: string;
    sessionId: string;
    at: number;
    title: string;
    parentId?: string;
    usage?: TraceTokens | null;
    info: { role?: string; agent?: string; tokens?: unknown; modelID?: string; error?: unknown };
    part: { type: string; text?: string; tool?: string; state?: { status?: string; input?: unknown; output?: unknown; error?: string; time?: { start?: number; end?: number } }; time?: { start?: number; end?: number } };
};
type TracePage = { records: TraceRecord[]; before: number | null; usage: TraceUsage };
export function traceText(value: unknown): string {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2) || "";
    return text
        .replace(/\b(?:sk|provider[-_]?secret|secret)[-_][a-z\d_-]{8,}\b/giu, "[凭据已隐藏]")
        .replace(/\bBearer\s+[^\s,;"']+/giu, "Bearer [凭据已隐藏]")
        .replace(/((?:api[_-]?key|access[_-]?token|authorization|password|secret)["']?\s*[=:：]\s*)["']?[^\s,;"'}]+["']?/giu, "$1[凭据已隐藏]");
}
const statusText: Record<string, string> = { completed: "完成", done: "完成", error: "失败", running: "进行中", pending: "等待", waiting: "待审批" };
const kindText: Record<string, string> = { text: "回复", reasoning: "思考", tool: "工具", file: "附件", "step-start": "开始", "step-finish": "结束", approval: "审批" };

function traceTime(row: TraceRecord) {
    const time = row.part.state?.time || row.part.time;
    return { start: time?.start ?? row.at, end: time?.end };
}
function traceStatus(row: TraceRecord) {
    return row.info.error || row.part.state?.error ? "error" : row.part.state?.status || "";
}
function traceLane(row: TraceRecord) {
    return row.parentId ? `${row.sessionId}:${row.info.agent || "agent"}` : "zodiac";
}
function traceTone(row: TraceRecord) {
    if (traceStatus(row) === "error") return "error";
    if (row.part.type === "approval") return "approval";
    if (row.info.role === "user") return "user";
    return row.parentId ? "child" : "agent";
}
function scrollBehavior(): ScrollBehavior {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth";
}
function reveal(container: HTMLElement | null, item: HTMLElement | undefined, horizontal = false) {
    if (!container || !item) return;
    const bounds = container.getBoundingClientRect();
    const target = item.getBoundingClientRect();
    const behavior = scrollBehavior();
    container.scrollTo({
        left: horizontal ? container.scrollLeft + target.left - bounds.left - (container.clientWidth - target.width) / 2 : 0,
        top: container.scrollTop + target.top - bounds.top - (container.clientHeight - target.height) / 2,
        behavior,
    });
}

export function ZodiacTracePanel({ open, onClose, projectId, sessionId, running, activities }: { open: boolean; onClose: () => void; projectId: string; sessionId: string; running: boolean; activities: ZodiacActivity[] }) {
    const { t } = useAppTranslation();
    const scrollRef = useRef<HTMLDivElement>(null);
    const timelineRef = useRef<HTMLDivElement>(null);
    const detailRef = useRef<HTMLElement>(null);
    const rowRefs = useRef(new Map<string, HTMLButtonElement>());
    const barRefs = useRef(new Map<string, HTMLButtonElement>());
    const followRef = useRef(true);
    const runningRef = useRef(running);
    const requestRef = useRef<AbortController | null>(null);
    runningRef.current = running;
    const [records, setRecords] = useState<TraceRecord[]>([]);
    const [usage, setUsage] = useState<TraceUsage | null>(null);
    const [before, setBefore] = useState<number | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState("");
    const [query, setQuery] = useState("");
    const [filter, setFilter] = useState("all");
    const [selected, setSelected] = useState("");
    const [zoom, setZoom] = useState(1);
    const [laneOrder, setLaneOrder] = useState(["zodiac"]);
    const [viewportWidth, setViewportWidth] = useState(1000);
    const previousWidth = useRef(0);
    useEffect(() => {
        if (!open) return;
        const controller = new AbortController();
        requestRef.current = controller;
        let timer: ReturnType<typeof setTimeout> | undefined;
        followRef.current = true;
        setRecords([]);
        setUsage(null);
        setBefore(null);
        setSelected("");
        setQuery("");
        setFilter("all");
        setLoading(true);
        setZoom(1);
        setLaneOrder(["zodiac"]);
        previousWidth.current = 0;
        const read = async (first = false) => {
            try {
                const page = await agentRequest<TracePage>("trace", { projectId, sessionId }, controller.signal);
                if (controller.signal.aborted) return;
                setUsage(page.usage ?? null);
                setRecords((old) => [...new Map([...old, ...page.records].map((row) => [row.id, row])).values()].sort((a, b) => a.at - b.at));
                if (first) {
                    setBefore(page.before);
                    setLaneOrder(["zodiac"]);
                }
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

    const rows = useMemo(() => {
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
        return [...records, ...approvals].filter((row) => !["step-start", "step-finish", "patch"].includes(row.part.type)).sort((a, b) => a.at - b.at);
    }, [records, activities, sessionId]);
    useEffect(() => {
        if (!open || loading) return;
        setLaneOrder((current) => {
            const next = [...new Set([...current, ...rows.map(traceLane)])];
            return next.length === current.length ? current : next;
        });
    }, [rows, open, loading]);
    const numbered = useMemo(() => {
        let turn = 0;
        let lastMessage = "";
        return new Map(
            rows.map((row, index) => {
                if (row.info.role === "user" && !row.parentId && row.messageId !== lastMessage) {
                    turn++;
                    lastMessage = row.messageId;
                }
                return [row.id, { index: index + 1, turn }];
            }),
        );
    }, [rows]);
    const visible = useMemo(
        () => rows.filter((row) => (filter === "all" || (filter === "error" ? traceStatus(row) === "error" : (row.info.agent || "zodiac") === filter)) && traceText(row).toLowerCase().includes(query.toLowerCase())),
        [rows, filter, query],
    );
    const byId = useMemo(() => new Map(visible.map((row) => [row.id, row])), [visible]);
    const detail = byId.get(selected);
    const layout = useMemo(
        () =>
            layoutTraceTimeline(
                visible.map((row) => ({ id: row.id, lane: traceLane(row), ...traceTime(row) })),
                viewportWidth,
                zoom,
                laneOrder,
            ),
        [visible, viewportWidth, zoom, laneOrder],
    );
    const recordLabel = (row: TraceRecord) => row.part.tool || t(kindText[row.part.type] || row.part.type);
    const actorLabel = (row: TraceRecord) => (row.info.role === "user" ? t("你") : row.info.agent || (row.parentId ? row.title : "Zodiac"));
    const clockLabel = (at: number) => new Date(at).toLocaleTimeString([], { hour12: false });
    const selectRecord = (id: string) => {
        followRef.current = false;
        setSelected(id);
        reveal(scrollRef.current, rowRefs.current.get(id));
        reveal(timelineRef.current, barRefs.current.get(id), true);
        detailRef.current?.scrollTo({ top: 0 });
    };
    const changeFilter = (nextQuery: string, nextFilter: string) => {
        followRef.current = false;
        previousWidth.current = 0;
        setSelected("");
        setQuery(nextQuery);
        setFilter(nextFilter);
        scrollRef.current?.scrollTo({ top: 0 });
        timelineRef.current?.scrollTo({ left: 0, top: 0 });
    };
    // The dialog mounts lazily. Observe its scroll viewport after records render.
    useEffect(() => {
        const viewport = timelineRef.current;
        if (!open || !viewport) return;
        const observer = new ResizeObserver(() => setViewportWidth(viewport.clientWidth));
        observer.observe(viewport);
        return () => observer.disconnect();
    }, [open, loading]);
    useLayoutEffect(() => {
        const viewport = timelineRef.current;
        if (!viewport) return;
        const oldWidth = previousWidth.current;
        if (oldWidth && oldWidth !== layout.width) {
            const bar = layout.bars.find((entry) => entry.id === selected);
            viewport.scrollLeft = bar ? bar.x + bar.width / 2 - viewport.clientWidth / 2 : ((viewport.scrollLeft + viewport.clientWidth / 2) / oldWidth) * layout.width - viewport.clientWidth / 2;
            if (bar) viewport.scrollTop = 18 + bar.lane * 10 - viewport.clientHeight / 2;
        }
        previousWidth.current = layout.width;
    }, [layout, selected]);
    useEffect(() => {
        if (!followRef.current || selected || query || filter !== "all") return;
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        const last = visible.at(-1);
        if (last) reveal(timelineRef.current, barRefs.current.get(last.id), true);
    }, [visible.length, selected, query, filter]);
    const older = async () => {
        followRef.current = false;
        const signal = requestRef.current?.signal;
        setLoading(true);
        try {
            const page = await agentRequest<TracePage>("trace", { projectId, sessionId, before }, signal);
            if (signal?.aborted) return;
            setRecords((old) => [...new Map([...page.records, ...old].map((row) => [row.id, row])).values()].sort((a, b) => a.at - b.at));
            setBefore(page.before);
        } catch (e) {
            if (!signal?.aborted) setError(e instanceof Error ? e.message : "读取失败");
        } finally {
            if (!signal?.aborted) setLoading(false);
        }
    };
    return (
        <Modal
            rootClassName="zodiac-surface zodiac-trace-modal"
            title={t("轨迹")}
            open={open}
            onCancel={onClose}
            footer={null}
            width={1240}
            centered
            styles={{ body: { height: "min(78vh, 900px)", display: "flex", flexDirection: "column", gap: 12, minHeight: 0 } }}
            destroyOnHidden
        >
            <div className="zodiac-trace-filters">
                <Input aria-label={t("搜索轨迹")} placeholder={t("搜索工具、输入或错误")} value={query} onChange={(e) => changeFilter(e.target.value, filter)} allowClear />
                <Select
                    aria-label={t("筛选轨迹")}
                    value={filter}
                    onChange={(value) => changeFilter(query, value)}
                    options={[{ value: "all", label: t("全部记录") }, { value: "error", label: t("失败记录") }, ...[...new Set(records.map((row) => row.info.agent).filter(Boolean))].map((value) => ({ value, label: value }))]}
                />
                <span className="zodiac-trace-count">{t("{count} 条记录", { count: visible.length })}</span>
                <TraceUsagePill key={`${projectId}:${sessionId}:${open}`} usage={usage} unavailable={Boolean(error)} />
                <div className="zodiac-trace-controls">
                    <div className="zodiac-trace-zoom">
                        <button type="button" className="wg-icon-button" aria-label={t("缩小时间线")} disabled={zoom <= 0.5} onClick={() => setZoom((value) => Math.max(0.5, value - 0.25))}>
                            <Minus />
                        </button>
                        <Slider ariaLabelForHandle={t("时间线缩放")} min={50} max={400} step={25} value={zoom * 100} onChange={(value) => setZoom(value / 100)} tooltip={{ formatter: (value) => `${value}%` }} />
                        <button type="button" className="wg-icon-button" aria-label={t("放大时间线")} disabled={zoom >= 4} onClick={() => setZoom((value) => Math.min(4, value + 0.25))}>
                            <Plus />
                        </button>
                        <button type="button" className="wg-text-button zodiac-trace-zoom-value" title={t("重置缩放")} onClick={() => setZoom(1)}>
                            {Math.round(zoom * 100)}%
                        </button>
                    </div>
                    <div className="zodiac-trace-pan">
                        <button type="button" className="wg-icon-button" aria-label={t("向前查看时间线")} onClick={() => timelineRef.current?.scrollBy({ left: -viewportWidth * 0.7, behavior: scrollBehavior() })}>
                            <ChevronLeft />
                        </button>
                        <button type="button" className="wg-icon-button" aria-label={t("向后查看时间线")} onClick={() => timelineRef.current?.scrollBy({ left: viewportWidth * 0.7, behavior: scrollBehavior() })}>
                            <ChevronRight />
                        </button>
                        <button
                            type="button"
                            className="wg-icon-button"
                            aria-label={t("最新记录")}
                            title={t("最新记录")}
                            disabled={!visible.length}
                            onClick={() => {
                                if (visible.length) selectRecord(visible[visible.length - 1].id);
                            }}
                        >
                            <ArrowDownToLine />
                        </button>
                    </div>
                </div>
            </div>
            {error ? (
                <p role="alert" className="text-red-500">
                    {error}
                </p>
            ) : null}
            <section className="zodiac-trace-timeline" aria-label={t("活动时间线")}>
                <div
                    ref={timelineRef}
                    className="zodiac-trace-timeline-scroll"
                    tabIndex={0}
                    aria-label={t("滚动查看时间线")}
                    onWheel={(event) => {
                        if (!event.deltaX && !event.ctrlKey && layout.height <= event.currentTarget.clientHeight && Math.abs(event.deltaY) > 0) event.currentTarget.scrollLeft += event.deltaY;
                    }}
                >
                    <div className="zodiac-trace-track" style={{ width: layout.width, height: layout.height }}>
                        {layout.ticks.map((tick) => (
                            <span key={`${tick.at}-${tick.x}`} className="zodiac-trace-tick" style={{ left: tick.x }}>
                                <span>{clockLabel(tick.at)}</span>
                            </span>
                        ))}
                        {layout.bars.map((bar) => {
                            const row = byId.get(bar.id)!;
                            const number = numbered.get(row.id)!.index;
                            const time = traceTime(row);
                            const duration = time.end != null ? ` · ${t("耗时 {seconds} 秒", { seconds: (Math.max(0, time.end - time.start) / 1000).toFixed(2) })}` : "";
                            const label = `#${number} · ${recordLabel(row)} · ${actorLabel(row)} · ${clockLabel(time.start)}${duration}`;
                            return (
                                <button
                                    type="button"
                                    key={bar.id}
                                    ref={(el) => {
                                        if (el) barRefs.current.set(bar.id, el);
                                        else barRefs.current.delete(bar.id);
                                    }}
                                    className="zodiac-trace-bar"
                                    data-tone={traceTone(row)}
                                    data-selected={selected === row.id || undefined}
                                    aria-label={label}
                                    aria-pressed={selected === row.id}
                                    title={label}
                                    style={{ left: bar.x, top: 18 + bar.lane * 10, width: bar.width }}
                                    onClick={() => selectRecord(row.id)}
                                ></button>
                            );
                        })}
                    </div>
                </div>
            </section>
            <div className="zodiac-trace-split">
                <div className="zodiac-trace-list-pane">
                    <div className="zodiac-trace-list-heading">
                        <span>#</span>
                        <span>{t("时间")}</span>
                        <span>{t("记录")}</span>
                        <span>{t("状态")}</span>
                    </div>
                    <div
                        ref={scrollRef}
                        className="zodiac-trace-list"
                        aria-label={t("轨迹记录")}
                        onWheel={(event) => {
                            if (event.deltaY < 0) followRef.current = false;
                        }}
                        onScroll={(event) => {
                            const el = event.currentTarget;
                            followRef.current = !selected && el.scrollHeight - el.scrollTop - el.clientHeight < 24;
                        }}
                    >
                        {before ? (
                            <Button block type="text" loading={loading} onClick={() => void older()}>
                                {t("加载更早记录")}
                            </Button>
                        ) : null}
                        {!visible.length ? (
                            loading ? (
                                <div className="p-10 text-center">
                                    <Spin />
                                </div>
                            ) : (
                                <Empty className="py-10" description={t(rows.length ? "暂无符合要求的结果" : "暂无轨迹")} />
                            )
                        ) : (
                            visible.map((row) => {
                                const number = numbered.get(row.id)!;
                                const preview = traceText(row.part.text || row.part.state?.error || row.info.error || row.part.state?.input || row.part.state?.output);
                                return (
                                    <button
                                        type="button"
                                        key={row.id}
                                        ref={(el) => {
                                            if (el) rowRefs.current.set(row.id, el);
                                            else rowRefs.current.delete(row.id);
                                        }}
                                        className="zodiac-trace-row"
                                        data-selected={selected === row.id || undefined}
                                        aria-pressed={selected === row.id}
                                        aria-label={`#${number.index} ${recordLabel(row)}`}
                                        onClick={() => selectRecord(row.id)}
                                    >
                                        <span className="zodiac-trace-number">#{number.index}</span>
                                        <time>{clockLabel(row.at)}</time>
                                        <span className="zodiac-trace-preview">
                                            <strong>{recordLabel(row)}</strong>
                                            <span>
                                                {" "}
                                                · {actorLabel(row)}
                                                {preview ? ` · ${preview.slice(0, 240)}` : ""}
                                            </span>
                                        </span>
                                        <span className="zodiac-trace-state" data-tone={traceTone(row)}>
                                            {t(statusText[traceStatus(row)] || "—")}
                                        </span>
                                    </button>
                                );
                            })
                        )}
                    </div>
                </div>
                <section ref={detailRef} aria-label={t("轨迹详情")} className="zodiac-trace-detail">
                    {!detail ? (
                        <p className="zodiac-trace-placeholder">{t("选择记录，查看输入、输出和错误。")}</p>
                    ) : (
                        <div key={detail.id} className="zodiac-trace-detail-content">
                            <header className="zodiac-trace-detail-heading">
                                <span className="zodiac-trace-number">#{numbered.get(detail.id)!.index}</span>
                                <strong>{recordLabel(detail)}</strong>
                                <span>{actorLabel(detail)}</span>
                            </header>
                            <p className="zodiac-trace-detail-meta">
                                {numbered.get(detail.id)!.turn > 0 ? `${t("第 {count} 轮", { count: numbered.get(detail.id)!.turn })} · ` : ""}
                                {clockLabel(traceTime(detail).start)}
                                {traceTime(detail).end != null ? ` · ${t("耗时 {seconds} 秒", { seconds: (Math.max(0, traceTime(detail).end! - traceTime(detail).start) / 1000).toFixed(2) })}` : ""}
                            </p>
                            {[
                                { label: "输入", value: detail.part.state?.input },
                                { label: "输出", value: detail.part.state?.output ?? detail.part.text },
                                { label: "错误", value: detail.part.state?.error ?? detail.info.error },
                            ]
                                .filter((entry) => entry.value != null)
                                .map((entry) => (
                                    <div key={entry.label} className="zodiac-trace-field">
                                        <h3>{t(entry.label)}</h3>
                                        <pre>{traceText(entry.value)}</pre>
                                    </div>
                                ))}
                            {detail.info.role === "assistant" ? (
                                <div className="zodiac-trace-field">
                                    <h3>{t("本次请求 · Token")}</h3>
                                    <TraceUsageDetails tokens={detail.usage ?? null} />
                                </div>
                            ) : null}
                            <details className="zodiac-trace-raw">
                                <summary>{t("原始记录")}</summary>
                                <pre>{traceText(detail)}</pre>
                            </details>
                        </div>
                    )}
                </section>
            </div>
        </Modal>
    );
}
