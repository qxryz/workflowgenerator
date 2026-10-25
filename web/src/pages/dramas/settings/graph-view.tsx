import { App, Tooltip } from "antd";
import { Info, Link2, Maximize, Minus, Plus, Shuffle } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { edgeShapes, fitView, layoutGraph, placeLabels, type GraphEdge, type Point, type View } from "@/lib/drama/graph-layout";
import { ENTITY_GROUP_LABELS, RELATION_KIND_LABELS } from "@/lib/drama/labels";
import { adoptedSheets, KIND_ORDER, type KindFilter } from "@/lib/drama/settings-view";
import type { DramaSnapshot, EntityKind } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { createRelation, deleteRelation, updateRelation } from "@/services/drama-api";
import { KIND_COLOR, useGuard, useRefresh } from "./common";
import { EdgeEditor } from "./edge-editor";
import { GraphCanvas, type CanvasNode } from "./graph-canvas";

const RADIUS: Record<EntityKind, number> = { character: 30, scene: 30, prop: 21, world: 26 };
const HOSTILE = new Set(["enemy", "rival"]);
type Props = { snapshot: DramaSnapshot; filter: KindFilter; selectedId: string | null; onSelect: (id: string | null) => void };

export function GraphView({ snapshot, filter, selectedId, onSelect }: Props) {
    const { t } = useAppTranslation();
    const { modal } = App.useApp();
    const dramaId = snapshot.project.id;
    const guard = useGuard(dramaId);
    const refresh = useRefresh(dramaId);
    const box = useRef<HTMLDivElement>(null);
    const [size, setSize] = useState({ width: 0, height: 0 });
    const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
    const [moved, setMoved] = useState<Record<string, Point>>({});
    const [edgeId, setEdgeId] = useState<string | null>(null);
    const [connecting, setConnecting] = useState(false);
    const [from, setFrom] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const sheets = useMemo(() => adoptedSheets(snapshot.artifacts), [snapshot.artifacts]);
    const nodes = useMemo<CanvasNode[]>(
        () => snapshot.entities.filter((entity) => filter === "all" || entity.kind === filter).map((entity) => ({ id: entity.id, name: entity.name, kind: entity.kind, r: RADIUS[entity.kind], sheet: sheets.get(entity.id) })),
        [snapshot.entities, filter, sheets],
    );
    const visible = useMemo(() => new Set(nodes.map((node) => node.id)), [nodes]);
    const edges = useMemo<GraphEdge[]>(() => {
        const strong = snapshot.relations
            .filter((relation) => visible.has(relation.fromId) && visible.has(relation.toId))
            .map((relation) => ({ id: relation.id, from: relation.fromId, to: relation.toId, label: relation.label.trim() || t(RELATION_KIND_LABELS[relation.kind]) }));
        const owned = snapshot.entities
            .filter((entity) => entity.kind === "prop" && entity.parentId && visible.has(entity.id) && visible.has(entity.parentId))
            .map((entity) => ({ id: `own:${entity.id}`, from: entity.id, to: entity.parentId!, weak: true }));
        return [...strong, ...owned];
    }, [snapshot.relations, snapshot.entities, visible, t]);

    // Positions live here only. Nodes already placed stay put when settings or relations change.
    const [placed, setPlaced] = useState<Record<string, Point>>({});
    const nodeKey = nodes.map((node) => node.id).join();
    const needsFit = useRef(true);
    /** Once the user pans, zooms or moves a node, the view is theirs; until then it keeps fitting as the canvas resizes. */
    const touched = useRef(false);
    useEffect(() => {
        setPlaced((previous) => {
            const known = Object.fromEntries(nodes.filter((node) => previous[node.id]).map((node) => [node.id, previous[node.id]]));
            const fresh = nodes.length !== Object.keys(known).length;
            if (fresh) needsFit.current = true;
            return { ...previous, ...layoutGraph(nodes, edges, known) };
        });
        // eslint-disable-next-line react-hooks/exhaustive-deps -- re-layout only when the set of nodes changes
    }, [nodeKey]);
    const points = useMemo(() => ({ ...placed, ...moved }), [placed, moved]);

    const fit = useCallback(() => setView(fitView(nodes, points, size.width, size.height, { top: 52, bottom: 56, side: 28 })), [nodes, points, size]);
    useEffect(() => {
        const element = box.current;
        if (!element) return;
        const observer = new ResizeObserver(([entry]) => setSize({ width: entry.contentRect.width, height: entry.contentRect.height }));
        observer.observe(element);
        return () => observer.disconnect();
    }, []);
    useLayoutEffect(() => {
        if ((!needsFit.current && touched.current) || !size.width || !nodes.every((node) => placed[node.id])) return;
        needsFit.current = false;
        fit();
    }, [fit, nodes, placed, size.width]);
    const relayout = () => {
        setMoved({});
        touched.current = false;
        setPlaced((previous) => ({ ...previous, ...layoutGraph(nodes, edges) }));
        needsFit.current = true;
    };
    const zoom = (factor: number) => {
        touched.current = true;
        setView((current) => {
            const k = Math.min(2.5, Math.max(0.25, current.k * factor));
            const cx = size.width / 2,
                cy = size.height / 2;
            return { k, x: cx - ((cx - current.x) / current.k) * k, y: cy - ((cy - current.y) / current.k) * k };
        });
    };

    const radius = useMemo(() => Object.fromEntries(nodes.map((node) => [node.id, node.r])), [nodes]);
    const shapes = useMemo(() => edgeShapes(edges, points, radius), [edges, points, radius]);
    const texts = useMemo(() => Object.fromEntries(snapshot.relations.map((relation) => [relation.id, trim(relation.label.trim() || t(RELATION_KIND_LABELS[relation.kind]))])), [snapshot.relations, t]);
    const strongShapes = useMemo(() => shapes.filter((shape) => texts[shape.id] !== undefined), [shapes, texts]);
    const labels = useMemo(() => placeLabels(strongShapes, texts, nodes, points), [strongShapes, texts, nodes, points]);
    const danger = useMemo(() => new Set(snapshot.relations.filter((relation) => HOSTILE.has(relation.kind)).map((relation) => relation.id)), [snapshot.relations]);

    const relation = snapshot.relations.find((item) => item.id === edgeId);
    const anchor = labels.find((label) => label.id === edgeId);
    const name = (id: string) => snapshot.entities.find((entity) => entity.id === id)?.name ?? "";

    const pickNode = (id: string) => {
        if (!connecting) {
            setEdgeId(null);
            return onSelect(id);
        }
        if (!from) return setFrom(id);
        if (from === id) return setFrom(null);
        setConnecting(false);
        setFrom(null);
        void guard(async () => {
            const created = await createRelation(dramaId, { fromId: from, toId: id, kind: "other", label: "", note: "" });
            await refresh();
            setEdgeId(created.id);
        });
    };
    const save = async (patch: Parameters<typeof updateRelation>[1]) => {
        setBusy(true);
        const ok = await guard(() => updateRelation(relation!.id, patch));
        setBusy(false);
        if (ok) {
            await refresh();
            if (!("fromId" in patch)) setEdgeId(null);
        }
    };
    const remove = () =>
        modal.confirm({
            title: t("删除「{from}」到「{to}」的关系？", { from: name(relation!.fromId), to: name(relation!.toId) }),
            okText: t("删除"),
            cancelText: t("取消"),
            okButtonProps: { danger: true },
            onOk: async () => {
                if (await guard(() => deleteRelation(relation!.id))) {
                    setEdgeId(null);
                    await refresh();
                }
            },
        });
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;
            setConnecting(false);
            setFrom(null);
            setEdgeId(null);
        };
        window.addEventListener("keydown", escape);
        return () => window.removeEventListener("keydown", escape);
    }, []);

    // The editor sits under the label it edits, or above it when there is no room below.
    const EDITOR_HEIGHT = 220;
    const labelY = anchor ? anchor.y * view.k + view.y : 0;
    const editorAt = anchor && {
        left: Math.min(Math.max(anchor.x * view.k + view.x - 144, 8), Math.max(8, size.width - 296)),
        top: labelY + 20 + EDITOR_HEIGHT < size.height ? labelY + 20 : Math.max(8, labelY - 20 - EDITOR_HEIGHT),
    };
    return (
        <div ref={box} className="relative size-full overflow-hidden bg-[color:var(--wg-home-bg)]">
            <GraphCanvas
                nodes={nodes}
                edges={edges}
                shapes={shapes}
                labels={labels}
                danger={danger}
                points={points}
                view={view}
                onView={(next) => {
                    touched.current = true;
                    setView(next);
                }}
                selectedNode={selectedId}
                selectedEdge={edgeId}
                connectFrom={from}
                connecting={connecting}
                onNode={pickNode}
                onEdge={(id) => {
                    if (connecting) return;
                    onSelect(null);
                    setEdgeId(id);
                }}
                onMove={(id, point) => {
                    touched.current = true;
                    setMoved((current) => ({ ...current, [id]: point }));
                }}
                onBackground={() => {
                    setEdgeId(null);
                    if (!connecting) onSelect(null);
                }}
            />
            {!nodes.length ? <p className="!mb-0 pointer-events-none absolute inset-0 grid place-items-center text-sm text-[color:var(--wg-home-muted)]">{t("这一类还没有设定")}</p> : null}
            {nodes.length && !snapshot.relations.length ? <p className="!mb-0 pointer-events-none absolute inset-x-0 top-14 text-center text-[12px] text-[color:var(--wg-home-muted)]">{t("还没有关系。点「连线」，依次点选两个设定来添加。")}</p> : null}

            <div className="absolute right-3 top-3 flex items-center gap-1 rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] p-1">
                <button
                    type="button"
                    aria-pressed={connecting}
                    className={cn("wg-text-button !h-8", connecting && "!bg-[color:var(--wg-home-text)] !text-[color:var(--wg-panel)]")}
                    onClick={() => {
                        setConnecting((on) => !on);
                        setFrom(null);
                        setEdgeId(null);
                    }}
                >
                    <Link2 className="size-4" strokeWidth={1.6} />
                    {t("连线")}
                </button>
                <span className="mx-0.5 h-5 w-px bg-[color:var(--wg-home-line)]" />
                <Tooltip title={t("拖动空白处平移 · 滚轮缩放 · 拖动节点调整位置 · 点击线条编辑")}>
                    <span className="grid size-8 place-items-center text-[color:var(--wg-home-muted)]">
                        <Info className="size-4" strokeWidth={1.6} />
                    </span>
                </Tooltip>
                {[
                    { label: "缩小", icon: Minus, run: () => zoom(1 / 1.25) },
                    { label: "放大", icon: Plus, run: () => zoom(1.25) },
                    {
                        label: "适应画面",
                        icon: Maximize,
                        run: () => {
                            touched.current = false;
                            fit();
                        },
                    },
                    { label: "重新排布", icon: Shuffle, run: relayout },
                ].map((action) => (
                    <Tooltip key={action.label} title={t(action.label)}>
                        <button type="button" className="wg-icon-button !size-8" aria-label={t(action.label)} onClick={action.run}>
                            <action.icon className="!size-4" strokeWidth={1.6} />
                        </button>
                    </Tooltip>
                ))}
            </div>
            {connecting ? (
                <div className="absolute left-1/2 top-3 -translate-x-1/2 rounded-full border border-[color:var(--wg-home-accent)] bg-[color:var(--wg-panel)] px-3.5 py-1.5 text-[12px] text-[color:var(--wg-home-accent)]">
                    {from ? t("再点选终点，关系由「{name}」指向它（Esc 取消）", { name: name(from) }) : t("点选起点（Esc 取消）")}
                </div>
            ) : null}
            <Legend />
            {relation && editorAt ? (
                <div className="absolute z-10" style={editorAt}>
                    <EdgeEditor
                        key={`${relation.id}:${relation.fromId}`}
                        relation={relation}
                        fromName={name(relation.fromId)}
                        toName={name(relation.toId)}
                        busy={busy}
                        onSave={(patch) => void save(patch)}
                        onDelete={remove}
                        onClose={() => setEdgeId(null)}
                    />
                </div>
            ) : null}
        </div>
    );
}

const trim = (text: string) => (text.length > 10 ? `${text.slice(0, 9)}…` : text);

function Legend() {
    const { t } = useAppTranslation();
    return (
        <div className="pointer-events-none absolute bottom-3 left-3 flex max-w-[calc(100%-1.5rem)] flex-wrap items-center gap-x-3.5 gap-y-1 rounded-xl border border-[color:var(--wg-home-line)] bg-[color:var(--wg-panel)] px-3 py-1.5 text-[11px] text-[color:var(--wg-home-muted)]">
            {KIND_ORDER.map((kind) => (
                <span key={kind} className="flex items-center gap-1.5">
                    <span className={cn("size-3 rounded-full border-2", kind === "world" && "border-dashed")} style={{ borderColor: KIND_COLOR[kind] }} />
                    {t(ENTITY_GROUP_LABELS[kind])}
                </span>
            ))}
            <span className="flex items-center gap-1.5">
                <span className="h-px w-5 bg-[color:var(--wg-home-muted-strong)]" />
                {t("箭头：谁指向谁")}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="h-px w-5 border-t border-dashed border-[color:var(--wg-home-line-strong)]" />
                {t("所属")}
            </span>
            <span className="flex items-center gap-1.5">
                <span className="h-px w-5 bg-destructive" />
                {t("敌对 / 竞争")}
            </span>
        </div>
    );
}
