import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";

import { neighbours, type EdgeShape, type GraphEdge, type GraphNode, type LabelBox, type Point, type View } from "@/lib/drama/graph-layout";
import type { DramaArtifact, EntityKind } from "@/lib/drama/types";
import { KIND_COLOR, KIND_ICON } from "./common";

export type CanvasNode = GraphNode & { kind: EntityKind; sheet?: DramaArtifact };
type Props = {
    nodes: CanvasNode[];
    edges: GraphEdge[];
    shapes: EdgeShape[];
    labels: LabelBox[];
    danger: Set<string>;
    points: Record<string, Point>;
    view: View;
    onView: (view: View) => void;
    selectedNode: string | null;
    selectedEdge: string | null;
    connectFrom: string | null;
    connecting: boolean;
    onNode: (id: string) => void;
    onEdge: (id: string) => void;
    onMove: (id: string, point: Point) => void;
    onBackground: () => void;
};

const CLICK_SLOP = 4;

/** Crops a character sheet to its front view; other sheets fill the circle. */
function Thumb({ node, id }: { node: CanvasNode; id: string }) {
    const { sheet, r } = node;
    if (!sheet) return null;
    const w = sheet.width || 1600,
        h = sheet.height || 900;
    const triple = node.kind === "character";
    return (
        <g clipPath={`url(#${id})`}>
            <svg x={-r} y={-r} width={r * 2} height={r * 2} viewBox={triple ? `0 0 ${w / 3} ${h}` : `0 0 ${w} ${h}`} preserveAspectRatio={triple ? "xMidYMin slice" : "xMidYMid slice"}>
                <image href={sheet.mediaUrl} width={w} height={h} />
            </svg>
        </g>
    );
}

export function GraphCanvas(props: Props) {
    const { nodes, edges, shapes, labels, danger, points, view, onView, selectedNode, selectedEdge, connectFrom, connecting } = props;
    const root = useRef<SVGSVGElement>(null);
    const [hover, setHover] = useState<string | null>(null);
    const [pointer, setPointer] = useState<Point | null>(null);
    const drag = useRef<{ kind: "pan" | "node"; id?: string; startX: number; startY: number; origin: Point; moved: boolean } | null>(null);
    const latest = useRef({ view, onView });
    latest.current = { view, onView };

    // Wheel zoom needs a non-passive listener to keep the page from scrolling.
    useEffect(() => {
        const svg = root.current;
        if (!svg) return;
        const wheel = (event: WheelEvent) => {
            event.preventDefault();
            const { view: current, onView: set } = latest.current;
            const rect = svg.getBoundingClientRect();
            const k = Math.min(2.5, Math.max(0.25, current.k * Math.exp(-event.deltaY * (event.ctrlKey ? 0.01 : 0.0015))));
            const x = event.clientX - rect.left,
                y = event.clientY - rect.top;
            set({ k, x: x - ((x - current.x) / current.k) * k, y: y - ((y - current.y) / current.k) * k });
        };
        svg.addEventListener("wheel", wheel, { passive: false });
        return () => svg.removeEventListener("wheel", wheel);
    }, []);

    const world = (event: { clientX: number; clientY: number }): Point => {
        const rect = root.current!.getBoundingClientRect();
        return { x: (event.clientX - rect.left - view.x) / view.k, y: (event.clientY - rect.top - view.y) / view.k };
    };
    const start = (event: ReactPointerEvent, kind: "pan" | "node", id?: string) => {
        if (event.button !== 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        drag.current = { kind, id, startX: event.clientX, startY: event.clientY, origin: kind === "node" ? points[id!] : { x: view.x, y: view.y }, moved: false };
    };
    const move = (event: ReactPointerEvent) => {
        if (connectFrom) setPointer(world(event));
        const d = drag.current;
        if (!d) return;
        const dx = event.clientX - d.startX,
            dy = event.clientY - d.startY;
        if (!d.moved && Math.hypot(dx, dy) < CLICK_SLOP) return;
        d.moved = true;
        if (d.kind === "pan") onView({ ...view, x: d.origin.x + dx, y: d.origin.y + dy });
        else if (!connecting) props.onMove(d.id!, { x: d.origin.x + dx / view.k, y: d.origin.y + dy / view.k });
    };
    const end = (event: ReactPointerEvent) => {
        const d = drag.current;
        drag.current = null;
        if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
        if (!d || d.moved) return;
        if (d.kind === "node") props.onNode(d.id!);
        else props.onBackground();
    };

    // Text keeps a readable size on screen when the whole graph is zoomed out.
    const nameScale = 1 / Math.max(view.k, 0.75);
    const labelScale = 1 / Math.max(view.k, 0.8);
    const focus = hover ?? selectedNode;
    const lit = focus ? neighbours(edges, focus) : null;
    const touches = (id: string) => {
        const edge = edges.find((item) => item.id === id);
        return !focus || selectedEdge === id || edge?.from === focus || edge?.to === focus;
    };
    const rubber = connectFrom && pointer ? { from: points[connectFrom], to: pointer } : null;

    return (
        <svg
            ref={root}
            className="size-full touch-none select-none"
            style={{ cursor: connecting ? "crosshair" : "grab" }}
            onPointerDown={(event) => event.target === event.currentTarget && start(event, "pan")}
            onPointerMove={move}
            onPointerUp={end}
            onPointerLeave={() => setPointer(null)}
        >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                <rect x={-5000} y={-5000} width={10000} height={10000} fill="transparent" onPointerDown={(event) => start(event, "pan")} />
                {nodes.map((node) => (
                    <clipPath key={node.id} id={`clip-${node.id}`}>
                        <circle r={node.r - 1.5} />
                    </clipPath>
                ))}
                {shapes.map((shape) => {
                    const weak = edges.find((edge) => edge.id === shape.id)?.weak;
                    const on = selectedEdge === shape.id;
                    const color = on ? "var(--wg-home-accent)" : danger.has(shape.id) ? "var(--destructive)" : weak ? "var(--wg-home-line-strong)" : "var(--wg-home-muted-strong)";
                    return (
                        <g key={shape.id} opacity={touches(shape.id) ? 1 : 0.12}>
                            <path d={shape.d} fill="none" style={{ stroke: color }} strokeWidth={on ? 2.4 : weak ? 1.2 : 1.6} strokeDasharray={weak ? "3 5" : undefined} strokeLinecap="round" />
                            {shape.head ? <path d={shape.head} style={{ fill: color, stroke: color }} strokeWidth={1} strokeLinejoin="round" /> : null}
                            {weak ? null : <path d={shape.d} fill="none" stroke="transparent" strokeWidth={16} style={{ cursor: "pointer" }} onPointerDown={(event) => event.stopPropagation()} onClick={() => props.onEdge(shape.id)} />}
                        </g>
                    );
                })}
                {rubber ? <line x1={rubber.from.x} y1={rubber.from.y} x2={rubber.to.x} y2={rubber.to.y} style={{ stroke: "var(--wg-home-accent)" }} strokeWidth={1.6} strokeDasharray="5 4" pointerEvents="none" /> : null}
                {nodes.map((node) => {
                    const p = points[node.id];
                    if (!p) return null;
                    const Icon = KIND_ICON[node.kind];
                    const on = selectedNode === node.id || connectFrom === node.id;
                    return (
                        <g
                            key={node.id}
                            transform={`translate(${p.x} ${p.y})`}
                            opacity={lit && !lit.has(node.id) ? 0.25 : 1}
                            style={{ cursor: connecting ? "crosshair" : "pointer" }}
                            onPointerDown={(event) => {
                                event.stopPropagation();
                                start(event, "node", node.id);
                            }}
                            onPointerEnter={() => setHover(node.id)}
                            onPointerLeave={() => setHover(null)}
                        >
                            {on ? <circle r={node.r + 6} fill="none" style={{ stroke: connectFrom === node.id ? "var(--wg-home-accent)" : "var(--wg-home-text)" }} strokeWidth={1.4} strokeDasharray={connectFrom === node.id ? "4 3" : undefined} /> : null}
                            <circle r={node.r} style={{ fill: "var(--wg-panel)", stroke: KIND_COLOR[node.kind] }} strokeWidth={2.5} strokeDasharray={node.kind === "world" ? "5 3" : undefined} />
                            <Thumb node={node} id={`clip-${node.id}`} />
                            {node.sheet ? null : <Icon x={-node.r * 0.45} y={-node.r * 0.45} width={node.r * 0.9} height={node.r * 0.9} strokeWidth={1.5} style={{ color: KIND_COLOR[node.kind] }} />}
                            <text
                                y={node.r + 18 * nameScale}
                                textAnchor="middle"
                                fontSize={13 * nameScale}
                                fontWeight={600}
                                style={{ fill: "var(--wg-home-text)", stroke: "var(--wg-home-bg)", paintOrder: "stroke" }}
                                strokeWidth={4}
                                strokeLinejoin="round"
                                pointerEvents="none"
                            >
                                {node.name}
                            </text>
                        </g>
                    );
                })}
                {labels.map((label) => {
                    const on = selectedEdge === label.id;
                    return (
                        <g
                            key={label.id}
                            transform={`translate(${label.x} ${label.y}) scale(${labelScale})`}
                            opacity={touches(label.id) ? 1 : 0.12}
                            style={{ cursor: "pointer" }}
                            onPointerDown={(event) => event.stopPropagation()}
                            onClick={() => props.onEdge(label.id)}
                        >
                            <rect
                                x={-label.w / 2}
                                y={-label.h / 2}
                                width={label.w}
                                height={label.h}
                                rx={10}
                                style={{ fill: "var(--wg-panel)", stroke: on ? "var(--wg-home-accent)" : danger.has(label.id) ? "var(--destructive)" : "var(--wg-home-line-strong)" }}
                                strokeWidth={on ? 1.6 : 1}
                            />
                            <text y={4} textAnchor="middle" fontSize={12} style={{ fill: "var(--wg-home-text)" }} pointerEvents="none">
                                {label.text}
                            </text>
                        </g>
                    );
                })}
            </g>
        </svg>
    );
}
