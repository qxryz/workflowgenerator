import { bezier, fmt, slice, tangent, type Curve, type Point } from "./graph-curve.ts";

export type { Point };
// Layout and geometry for the relationship graph. A force layout per connected group (Fruchterman-Reingold),
// then a collision pass that reserves each node's name label, then the groups are packed side by side.
// Everything is deterministic: the same graph always lands in the same place.

export type GraphNode = { id: string; name: string; r: number };
/** `weak` links (an owner and its props) pull nodes together but are drawn quietly. */
export type GraphEdge = {
    id: string;
    from: string;
    to: string;
    weak?: boolean;
    ideal?: number;
    /** Text shown on the line; only its length matters here. */ label?: string;
    /** Closest the two ends may be, so the line, its arrow and its label fit between them. */ gap?: number;
};
export type View = { x: number; y: number; k: number };

const IDEAL = 150;
const REPEL = 0.35;
const GRAVITY = 0.08;
/** Extra pull toward the middle along y; above 1 flattens groups into landscape. */
const FLATTEN = 1;
const TRIES = 24;
const WEAK_IDEAL = 105;
const LABEL_BELOW = 30;

/** Rough text width at 12px; CJK glyphs are wide. */
export const textWidth = (text: string, size = 12) => [...text].reduce((sum, char) => sum + (char.charCodeAt(0) < 256 ? size * 0.56 : size), 0);

/** Box a node claims, including the name under it. */
const half = (node: GraphNode) => ({ w: Math.max(node.r, textWidth(node.name, 13) / 2) + 14, up: node.r + 8, down: node.r + LABEL_BELOW });

function components(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
    const parent = new Map(nodes.map((node) => [node.id, node.id]));
    const root = (id: string): string => (parent.get(id) === id ? id : (parent.set(id, root(parent.get(id)!)), parent.get(id)!));
    for (const edge of edges) if (parent.has(edge.from) && parent.has(edge.to)) parent.set(root(edge.from), root(edge.to));
    const groups = new Map<string, GraphNode[]>();
    for (const node of nodes) groups.set(root(node.id), [...(groups.get(root(node.id)) ?? []), node]);
    return [...groups.values()].sort((a, b) => b.length - a.length);
}

/** One spring per pair of nodes, however many relations join them; pairs with several relations get more room for their labels. */
function springs(group: GraphNode[], edges: GraphEdge[]): GraphEdge[] {
    const members = new Set(group.map((node) => node.id));
    const pairs = new Map<string, { edge: GraphEdge; count: number }>();
    for (const edge of edges) {
        if (!members.has(edge.from) || !members.has(edge.to) || edge.from === edge.to) continue;
        const key = [edge.from, edge.to].sort().join("|");
        const known = pairs.get(key);
        if (!known) pairs.set(key, { edge, count: edge.weak ? 0 : 1 });
        else if (!edge.weak) pairs.set(key, { edge: known.edge.weak ? edge : known.edge, count: known.count + 1 });
    }
    const radius = new Map(group.map((node) => [node.id, node.r]));
    return [...pairs.values()].map(({ edge, count }) => {
        const widest = Math.max(...edges.filter((other) => !other.weak && [other.from, other.to].sort().join("|") === [edge.from, edge.to].sort().join("|")).map((other) => textWidth(other.label ?? "", 12) + 16), 0);
        return { ...edge, weak: count === 0, ideal: count === 0 ? WEAK_IDEAL : IDEAL + 45 * (count - 1), gap: (radius.get(edge.from) ?? 28) + (radius.get(edge.to) ?? 28) + widest + 48 };
    });
}

/** One force run from the `attempt`-th starting arrangement. */
function relax(group: GraphNode[], edges: GraphEdge[], attempt: number): Record<string, Point> {
    const pos: Record<string, Point> = {};
    const n = group.length;
    if (n === 1) return { [group[0].id]: { x: 0, y: 0 } };
    const links = springs(group, edges);
    // Start on a circle in breadth-first order from the best connected node, so neighbours start next to each other.
    const degree = (id: string) => links.filter((edge) => edge.from === id || edge.to === id).length;
    const ranked = [...group].sort((a, b) => degree(b.id) - degree(a.id) || (a.id < b.id ? -1 : 1));
    const order = [ranked[attempt % Math.min(3, n)].id];
    for (let i = 0; i < order.length; i++)
        for (const edge of links) {
            const other = edge.from === order[i] ? edge.to : edge.to === order[i] ? edge.from : "";
            if (other && !order.includes(other)) order.push(other);
        }
    const radius = Math.max(120, n * 34);
    const phase = attempt * 0.9;
    // From the fourth attempt on the start is also shuffled a little (a fixed pseudo-random sequence), so the runs differ more.
    let seed = attempt * 7919 + 13;
    const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * (attempt >= 3 ? radius * 0.7 : 0);
    order.forEach((id, i) => (pos[id] = { x: Math.cos(phase + (i / n) * Math.PI * 2) * radius + noise(), y: Math.sin(phase + (i / n) * Math.PI * 2) * radius * 0.8 + noise() }));

    const iterations = 360;
    for (let step = 0; step < iterations; step++) {
        const temperature = 70 * (1 - step / iterations) + 1.5;
        const push: Record<string, Point> = Object.fromEntries(group.map((node) => [node.id, { x: 0, y: 0 }]));
        for (let i = 0; i < n; i++)
            for (let j = i + 1; j < n; j++) {
                const a = group[i].id,
                    b = group[j].id;
                const dx = pos[a].x - pos[b].x || 0.01,
                    dy = pos[a].y - pos[b].y || 0.01;
                const d = Math.max(Math.hypot(dx, dy), 1);
                const force = (REPEL * IDEAL * IDEAL) / d / d;
                push[a].x += dx * force;
                push[a].y += dy * force;
                push[b].x -= dx * force;
                push[b].y -= dy * force;
            }
        for (const edge of links) {
            const ideal = edge.ideal ?? IDEAL;
            const dx = pos[edge.from].x - pos[edge.to].x,
                dy = pos[edge.from].y - pos[edge.to].y;
            const d = Math.max(Math.hypot(dx, dy), 1);
            const force = d / ideal;
            push[edge.from].x -= dx * force;
            push[edge.from].y -= dy * force;
            push[edge.to].x += dx * force;
            push[edge.to].y += dy * force;
        }
        for (const node of group) {
            push[node.id].x -= pos[node.id].x * GRAVITY;
            push[node.id].y -= pos[node.id].y * GRAVITY * FLATTEN;
            const move = Math.hypot(push[node.id].x, push[node.id].y) || 1;
            const scale = Math.min(move, temperature) / move;
            pos[node.id].x += push[node.id].x * scale;
            pos[node.id].y += push[node.id].y * scale;
        }
    }
    separate(group, pos, links);
    return pos;
}

const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** Lower is better: crossing lines hurt most, then stretched or squeezed lines, then a shape too big for the view. */
function untidiness(group: GraphNode[], links: GraphEdge[], edges: GraphEdge[], pos: Record<string, Point>): number {
    let crossings = 0;
    for (let i = 0; i < links.length; i++)
        for (let j = i + 1; j < links.length; j++) {
            const [a, b] = [links[i], links[j]];
            if (a.from === b.from || a.from === b.to || a.to === b.from || a.to === b.to) continue;
            const [p1, p2, p3, p4] = [pos[a.from], pos[a.to], pos[b.from], pos[b.to]];
            if (cross(p1, p2, p3) * cross(p1, p2, p4) < 0 && cross(p3, p4, p1) * cross(p3, p4, p2) < 0) crossings++;
        }
    // A line running through a node it does not belong to reads as a relation with that node.
    let through = 0;
    for (const link of links) {
        const [a, b] = [pos[link.from], pos[link.to]];
        const length2 = (b.x - a.x) ** 2 + (b.y - a.y) ** 2 || 1;
        for (const node of group) {
            if (node.id === link.from || node.id === link.to) continue;
            const p = pos[node.id];
            const t = Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.y - a.y) * (b.y - a.y)) / length2));
            if (Math.hypot(p.x - (a.x + t * (b.x - a.x)), p.y - (a.y + t * (b.y - a.y))) < node.r + 10) through++;
        }
    }
    const stretch = links.reduce((sum, edge) => sum + Math.abs(Math.hypot(pos[edge.from].x - pos[edge.to].x, pos[edge.from].y - pos[edge.to].y) - (edge.ideal ?? IDEAL)), 0);
    const box = bounds(group, pos);
    const [w, h] = [box.right - box.left, box.bottom - box.top];
    // How much a 1000 x 640 view has to shrink it: small nodes and small text are the real cost of a sprawling shape.
    const shrink = 1 - Math.min(1, 1000 / w, 640 / h);
    return crossings * 400 + through * 300 + stretch * 0.15 + shrink * 2500 + labelClashes(group, edges, pos) * 300;
}

/** How many relation labels cannot find a free spot in this arrangement. */
function labelClashes(group: GraphNode[], edges: GraphEdge[], pos: Record<string, Point>): number {
    const members = new Set(group.map((node) => node.id));
    const strong = edges.filter((edge) => !edge.weak && members.has(edge.from) && members.has(edge.to) && edge.from !== edge.to);
    const shapes = edgeShapes(strong, pos, Object.fromEntries(group.map((node) => [node.id, node.r])));
    const texts = Object.fromEntries(strong.map((edge) => [edge.id, edge.label ?? "关系"]));
    return placeLabels(shapes, texts, group, pos).reduce((sum, label) => sum + label.clash, 0);
}

/** The tidiest of several force runs; the runs differ only in where nodes start, so the result is still deterministic. */
function arrange(group: GraphNode[], edges: GraphEdge[]): Record<string, Point> {
    if (group.length < 3) return relax(group, edges, 0);
    const links = springs(group, edges);
    let best: { pos: Record<string, Point>; score: number } | undefined;
    for (let attempt = 0; attempt < TRIES; attempt++) {
        const pos = relax(group, edges, attempt);
        const score = untidiness(group, links, edges, pos);
        if (!best || score < best.score) best = { pos, score };
    }
    return best!.pos;
}

/** How far two nodes' boxes (circle plus name label) overlap on each axis; both positive means they touch. */
function overlapOf(a: GraphNode, pa: Point, b: GraphNode, pb: Point) {
    const boxA = half(a),
        boxB = half(b);
    const [upper, lower] = pa.y <= pb.y ? [boxA, boxB] : [boxB, boxA];
    return { x: boxA.w + boxB.w - Math.abs(pa.x - pb.x), y: upper.down + lower.up - Math.abs(pa.y - pb.y) };
}

/** Pushes overlapping boxes apart along the shorter overlap until nothing touches. */
function separate(group: GraphNode[], pos: Record<string, Point>, links: GraphEdge[] = []) {
    for (let pass = 0; pass < 240; pass++) {
        let moved = false;
        for (const link of links) {
            const [a, b] = [pos[link.from], pos[link.to]];
            const d = Math.hypot(a.x - b.x, a.y - b.y) || 0.01;
            if (d >= (link.gap ?? 0)) continue;
            moved = true;
            const shift = (link.gap! - d) / 2 + 0.5;
            [a.x, a.y, b.x, b.y] = [a.x + ((a.x - b.x) / d) * shift, a.y + ((a.y - b.y) / d) * shift, b.x - ((a.x - b.x) / d) * shift, b.y - ((a.y - b.y) / d) * shift];
        }
        for (let i = 0; i < group.length; i++)
            for (let j = i + 1; j < group.length; j++) {
                const pa = pos[group[i].id],
                    pb = pos[group[j].id];
                const over = overlapOf(group[i], pa, group[j], pb);
                if (over.x <= 0 || over.y <= 0) continue;
                moved = true;
                if (over.x < over.y) {
                    const shift = ((over.x + 2) / 2) * (pa.x <= pb.x ? -1 : 1);
                    pa.x += shift;
                    pb.x -= shift;
                } else {
                    const shift = ((over.y + 2) / 2) * (pa.y <= pb.y ? -1 : 1);
                    pa.y += shift;
                    pb.y -= shift;
                }
            }
        if (!moved) return;
    }
}

const bounds = (group: GraphNode[], pos: Record<string, Point>) => {
    const boxes = group.map((node) => ({ node, ...half(node), ...pos[node.id] }));
    return {
        left: Math.min(...boxes.map((box) => box.x - box.w)),
        right: Math.max(...boxes.map((box) => box.x + box.w)),
        top: Math.min(...boxes.map((box) => box.y - box.up)),
        bottom: Math.max(...boxes.map((box) => box.y + box.down)),
    };
};

/** Positions for every node. `fixed` nodes keep their place; the rest are laid out around them. */
export function layoutGraph(nodes: GraphNode[], edges: GraphEdge[], fixed: Record<string, Point> = {}): Record<string, Point> {
    const known = nodes.filter((node) => fixed[node.id]);
    const fresh = nodes.filter((node) => !fixed[node.id]);
    if (known.length) return placeNew(known, fresh, edges, fixed);

    const placed = components(nodes, edges).map((group) => {
        const pos = arrange(group, edges);
        const box = bounds(group, pos);
        return { group, pos, box, width: box.right - box.left, height: box.bottom - box.top };
    });
    if (!placed.length) return {};
    const area = placed.reduce((sum, item) => sum + (item.width + 60) * (item.height + 60), 0);
    const rowWidth = Math.max(placed[0].width, Math.sqrt(area * 1.7));
    const result: Record<string, Point> = {};
    let x = 0,
        y = 0,
        rowHeight = 0;
    for (const item of placed) {
        if (x > 0 && x + item.width > rowWidth) {
            x = 0;
            y += rowHeight + 60;
            rowHeight = 0;
        }
        for (const node of item.group) result[node.id] = { x: x + item.pos[node.id].x - item.box.left, y: y + item.pos[node.id].y - item.box.top };
        x += item.width + 60;
        rowHeight = Math.max(rowHeight, item.height);
    }
    return result;
}

/** New nodes beside a node they link to, or in a row under everything else; existing nodes never move. */
function placeNew(known: GraphNode[], fresh: GraphNode[], edges: GraphEdge[], fixed: Record<string, Point>): Record<string, Point> {
    const result: Record<string, Point> = {};
    for (const node of known) result[node.id] = fixed[node.id];
    const taken = [...known];
    const free = (point: Point, node: GraphNode) =>
        taken.every((other) => {
            const over = overlapOf(node, point, other, result[other.id]);
            return over.x <= 0 || over.y <= 0;
        });
    const floor = Math.max(...known.map((node) => result[node.id].y + half(node).down)) + 50;
    let column = 0;
    for (const node of fresh) {
        const anchorEdge = edges.find((edge) => (edge.from === node.id && result[edge.to]) || (edge.to === node.id && result[edge.from]));
        const anchor = anchorEdge ? result[anchorEdge.from === node.id ? anchorEdge.to : anchorEdge.from] : undefined;
        let point: Point | undefined;
        if (anchor)
            for (let ring = 0; ring < 6 && !point; ring++)
                for (let step = 0; step < 12 && !point; step++) {
                    const angle = Math.PI / 6 + (step / 12) * Math.PI * 2;
                    const candidate = { x: anchor.x + Math.cos(angle) * (IDEAL + ring * 50), y: anchor.y + Math.sin(angle) * (IDEAL + ring * 50) };
                    if (free(candidate, node)) point = candidate;
                }
        if (!point) {
            const leftmost = Math.min(...known.map((item) => result[item.id].x));
            point = { x: leftmost + column++ * 150, y: floor };
        }
        result[node.id] = point;
        taken.push(node);
    }
    return result;
}

// ---- edges ----

export type EdgeShape = { id: string; d: string; head: string; at: (t: number) => Point; normal: Point };
/**
 * Lines run from the rim of one node to the rim of the other, ending in an arrowhead. Edges between the same two nodes
 * fan out (`bend`) so opposite directions and repeated relations never lie on top of each other.
 */
export function edgeShapes(edges: GraphEdge[], points: Record<string, Point>, radius: Record<string, number>): EdgeShape[] {
    const lanes = new Map<string, GraphEdge[]>();
    for (const edge of edges) {
        const lane = [edge.from, edge.to].sort().join("|");
        lanes.set(lane, [...(lanes.get(lane) ?? []), edge]);
    }
    return edges.flatMap((edge) => {
        const a = points[edge.from],
            b = points[edge.to];
        if (!a || !b || edge.from === edge.to) return [];
        const lane = lanes.get([edge.from, edge.to].sort().join("|"))!;
        const forward = edge.from < edge.to ? 1 : -1;
        const distance = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const unit = { x: (b.x - a.x) / distance, y: (b.y - a.y) / distance };
        const normal = { x: -unit.y * forward, y: unit.x * forward };
        const bend = (lane.indexOf(edge) - (lane.length - 1) / 2) * 56;
        const full: Curve = { p0: a, c: { x: (a.x + b.x) / 2 + normal.x * bend * 2, y: (a.y + b.y) / 2 + normal.y * bend * 2 }, p1: b };
        const gap = (id: string) => (radius[id] ?? 28) + 3;
        let t0 = 0;
        while (t0 < 0.5 && Math.hypot(bezier(full, t0).x - a.x, bezier(full, t0).y - a.y) < gap(edge.from)) t0 += 0.01;
        let t1 = 1;
        while (t1 > 0.5 && Math.hypot(bezier(full, t1).x - b.x, bezier(full, t1).y - b.y) < gap(edge.to) + (edge.weak ? 0 : 3)) t1 -= 0.01;
        const curve = slice(full, t0, t1);
        const tip = curve.p1;
        const dir = tangent(curve, 1);
        const head = edge.weak ? "" : `M ${fmt(tip)} L ${fmt({ x: tip.x - dir.x * 11 - dir.y * 5, y: tip.y - dir.y * 11 + dir.x * 5 })} L ${fmt({ x: tip.x - dir.x * 11 + dir.y * 5, y: tip.y - dir.y * 11 - dir.x * 5 })} Z`;
        return [{ id: edge.id, d: `M ${fmt(curve.p0)} Q ${fmt(curve.c)} ${fmt(curve.p1)}`, head, at: (t: number) => bezier(curve, t), normal }];
    });
}

// ---- labels ----

export type LabelBox = { id: string; x: number; y: number; w: number; h: number; text: string; /** Other labels or nodes it still touches. */ clash: number };
type Rect = { x: number; y: number; w: number; h: number };
const overlap = (a: Rect, b: Rect, pad = 4) => Math.abs(a.x - b.x) < (a.w + b.w) / 2 + pad && Math.abs(a.y - b.y) < (a.h + b.h) / 2 + pad;

/** Slides each label along its line (then off to the side) until it clears the other labels and every node. */
export function placeLabels(shapes: EdgeShape[], texts: Record<string, string>, nodes: GraphNode[], points: Record<string, Point>): LabelBox[] {
    const blocked: Rect[] = nodes.flatMap((node) => {
        const p = points[node.id];
        const box = half(node);
        return p ? [{ x: p.x, y: p.y + (box.down - box.up) / 2, w: box.w * 2, h: box.up + box.down }] : [];
    });
    const placed: LabelBox[] = [];
    for (const shape of shapes) {
        const text = texts[shape.id] ?? "";
        const w = Math.min(textWidth(text, 12), 150) + 16,
            h = 20;
        const tries = [0.5, 0.42, 0.58, 0.34, 0.66, 0.28, 0.72].flatMap((t) => [0, 1, -1].map((side) => ({ t, side })));
        let best: { x: number; y: number; score: number } | undefined;
        for (const { t, side } of tries) {
            const p = shape.at(t);
            const rect = { x: p.x + shape.normal.x * side * 16, y: p.y + shape.normal.y * side * 16, w, h };
            const score = [...blocked, ...placed].filter((other) => overlap(rect, other)).length;
            if (!best || score < best.score) best = { x: rect.x, y: rect.y, score };
            if (!score) break;
        }
        placed.push({ id: shape.id, x: best!.x, y: best!.y, w, h, text, clash: best!.score });
    }
    return placed;
}

// ---- view ----

export function neighbours(edges: GraphEdge[], id: string): Set<string> {
    const ids = new Set([id]);
    for (const edge of edges) {
        if (edge.from === id) ids.add(edge.to);
        if (edge.to === id) ids.add(edge.from);
    }
    return ids;
}

/** Space the overlays (toolbar, legend) take at the edges of the canvas; the fit leaves it free. */
export type Insets = { top: number; bottom: number; side: number };

/** Zoom and offset that show every node inside a width x height viewport, clear of the overlays. */
export function fitView(nodes: GraphNode[], points: Record<string, Point>, width: number, height: number, inset: Insets = { top: 24, bottom: 24, side: 24 }): View {
    const placed = nodes.filter((node) => points[node.id]);
    if (!placed.length || width <= 0 || height <= 0) return { x: width / 2, y: height / 2, k: 1 };
    const box = bounds(placed, points);
    const [w, h] = [width - inset.side * 2, height - inset.top - inset.bottom];
    const k = Math.max(0.35, Math.min(1.25, w / (box.right - box.left), h / (box.bottom - box.top)));
    return { k, x: inset.side + (w - (box.right - box.left) * k) / 2 - box.left * k, y: inset.top + (h - (box.bottom - box.top) * k) / 2 - box.top * k };
}
