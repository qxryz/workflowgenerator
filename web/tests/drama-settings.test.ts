import assert from "node:assert/strict";
import test from "node:test";

import { edgeShapes, fitView, layoutGraph, neighbours, placeLabels, type GraphEdge, type GraphNode, type Point } from "../src/lib/drama/graph-layout.ts";
import { adoptedSheets } from "../src/lib/drama/media/references.ts";
import { buildCatalogue, proposalView, sheetsOf } from "../src/lib/drama/settings-view.ts";
import { addColour, moveColour, nextColour, paletteProblem, removeColour, sameColours, storedPalette } from "../src/lib/drama/style/palette-edit.ts";
import type { DramaArtifact, DramaEntity, DramaRelation, SettingsProposal } from "../src/lib/drama/types.ts";

const entity = (n: number, kind: DramaEntity["kind"], name: string, extra: Partial<DramaEntity> = {}): DramaEntity => ({
    id: `e${n}`,
    label: `E${n}`,
    kind,
    name,
    aliases: [],
    description: "",
    appearance: "",
    parentId: null,
    sort: n,
    sourceNote: "",
    runId: null,
    updatedAt: 0,
    rev: 1,
    ...extra,
});
const relation = (id: string, fromId: string, toId: string, kind: DramaRelation["kind"] = "ally", label = ""): DramaRelation => ({ id, fromId, toId, kind, label, note: "" });
const proposalEntity = (kind: DramaEntity["kind"], name: string, extra: Partial<SettingsProposal["entities"][number]> = {}): SettingsProposal["entities"][number] => ({
    kind,
    name,
    aliases: [],
    description: `${name}描述`,
    appearance: "",
    sourceNote: "",
    ...extra,
});

const existing = [entity(1, "character", "林夏", { aliases: ["小夏"] }), entity(2, "scene", "渡口茶棚"), entity(3, "prop", "黄铜怀表", { parentId: "e1" })];

test("proposalView: ref present means update, otherwise new; short labels show as names", () => {
    const proposal: SettingsProposal = {
        entities: [proposalEntity("prop", "麻绳手链", { parent: "E1" }), proposalEntity("character", "林夏", { ref: "E1" }), proposalEntity("character", "周远"), proposalEntity("world", "七号码头的规矩")],
        relations: [
            { from: "林夏", to: "周远", kind: "mentor", label: "", note: "" },
            { from: "E1", to: "E2", kind: "belong", label: "常客", note: "" },
            { from: "周远", to: "不存在的人", kind: "other", label: "", note: "" },
        ],
    };
    const view = proposalView(proposal, existing);
    assert.deepEqual(
        view.groups.map((group) => group.kind),
        ["character", "prop", "world"],
    );
    const [林夏, 周远] = view.groups[0].rows;
    assert.deepEqual([林夏.item.name, 林夏.change], ["林夏", "update"]);
    assert.deepEqual([周远.item.name, 周远.change], ["周远", "new"]);
    assert.equal(view.groups[1].rows[0].parent, "林夏", "a label parent shows the real name");
    assert.deepEqual(view.counts, { added: 3, updated: 1, relations: 3 });
    assert.deepEqual([view.relations[1].from, view.relations[1].to], ["林夏", "渡口茶棚"]);
    assert.equal(view.relations[2].to, "不存在的人", "unknown ends stay as written");
    assert.equal(proposalView({ entities: [proposalEntity("character", "小夏")], relations: [] }, existing).groups[0].rows[0].change, "new", "matching by name is the server's call; without a ref the row says new");
});

test("catalogue: props sit under their owner and in the prop filter; 全部 lists only props without an owner", () => {
    const stray = entity(4, "prop", "旧船票");
    const entities = [...existing, stray, entity(5, "world", "码头规矩")];
    const all = buildCatalogue(entities, "all");
    assert.deepEqual(
        all.sections.map((section) => [section.kind, section.entities.map((e) => e.name)]),
        [
            ["character", ["林夏"]],
            ["scene", ["渡口茶棚"]],
            ["prop", ["旧船票"]],
            ["world", ["码头规矩"]],
        ],
    );
    assert.equal(all.sections[2].unowned, true);
    assert.deepEqual(
        all.owned.get("e1")?.map((e) => e.name),
        ["黄铜怀表"],
    );
    assert.deepEqual(all.counts, { all: 5, character: 1, scene: 1, prop: 2, world: 1 });
    const props = buildCatalogue(entities, "prop");
    assert.deepEqual(
        props.sections.map((section) => section.entities.map((e) => e.name)),
        [["黄铜怀表", "旧船票"]],
    );
    assert.equal(props.sections[0].unowned, undefined);
});

test("a prop whose owner is not a character or scene counts as unowned", () => {
    const entities = [entity(1, "world", "世界"), entity(2, "prop", "石头", { parentId: "e1" })];
    const all = buildCatalogue(entities, "all");
    assert.equal(all.owned.size, 0);
    assert.deepEqual(
        all.sections.find((section) => section.kind === "prop")?.entities.map((e) => e.name),
        ["石头"],
    );
});

test("adoptedSheets keeps only adopted ready sheets; sheetsOf lists an entity's sheets newest first", () => {
    const art = (id: string, extra: Partial<DramaArtifact>): DramaArtifact => ({
        id,
        entityId: "e1",
        shotId: null,
        kind: "sheet",
        status: "ready",
        mediaKey: "",
        mediaUrl: `/m/${id}`,
        mime: "image/png",
        width: null,
        height: null,
        durationMs: null,
        prompt: "",
        model: "",
        params: {},
        inputHash: "",
        providerTask: null,
        error: "",
        adopted: false,
        createdAt: 1,
        updatedAt: 1,
        ...extra,
    });
    const list = [art("a", { createdAt: 1 }), art("b", { adopted: true, createdAt: 2 }), art("c", { status: "pending", adopted: true, entityId: "e2" }), art("d", { entityId: "e2", createdAt: 5 })];
    assert.equal(adoptedSheets(list).get("e1")?.id, "b");
    assert.equal(adoptedSheets(list).has("e2"), false);
    assert.deepEqual(
        sheetsOf(list, "e1").map((a) => a.id),
        ["b", "a"],
    );
});

// ---- graph ----

const node = (id: string, name = id, r = 28): GraphNode => ({ id, name, r });
const edge = (id: string, from: string, to: string, weak = false): GraphEdge => ({ id, from, to, weak });
const touching = (a: GraphNode, pa: Point, b: GraphNode, pb: Point) => Math.hypot(pa.x - pb.x, pa.y - pb.y) < a.r + b.r;

function ring(count: number) {
    const nodes = Array.from({ length: count }, (_, i) => node(`n${i}`, `人物${i}`));
    const edges = nodes.flatMap((n, i) => [edge(`ring${i}`, n.id, nodes[(i + 1) % count].id), ...(i % 3 === 0 ? [edge(`chord${i}`, n.id, nodes[(i + 4) % count].id)] : [])]);
    return { nodes, edges };
}

test("layout is deterministic, finite and never overlaps node circles", () => {
    const { nodes, edges } = ring(14);
    const lonely = [node("x1", "孤立的设定"), node("x2", "另一个孤立的设定")];
    const all = [...nodes, ...lonely];
    const first = layoutGraph(all, edges);
    const again = layoutGraph(all, edges);
    assert.deepEqual(first, again);
    for (const n of all) assert.ok(Number.isFinite(first[n.id].x) && Number.isFinite(first[n.id].y), n.id);
    for (let i = 0; i < all.length; i++) for (let j = i + 1; j < all.length; j++) assert.equal(touching(all[i], first[all[i].id], all[j], first[all[j].id]), false, `${all[i].id} overlaps ${all[j].id}`);
});

test("layout keeps connected nodes closer than the graph is wide, and separate groups apart", () => {
    const nodes = ["a", "b", "c", "d", "e", "f"].map((id) => node(id));
    const edges = [edge("1", "a", "b"), edge("2", "b", "c"), edge("3", "d", "e"), edge("4", "e", "f")];
    const points = layoutGraph(nodes, edges);
    const gap = (x: string, y: string) => Math.hypot(points[x].x - points[y].x, points[x].y - points[y].y);
    assert.ok(gap("a", "b") < 300 && gap("b", "c") < 300 && gap("d", "e") < 300);
    assert.ok(gap("a", "b") > 56, "linked nodes leave room for the line and its label");
});

test("fixed nodes never move and new nodes land beside what they link to without overlap", () => {
    const nodes = [node("a"), node("b"), node("c"), node("d")];
    const fixed = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } };
    const points = layoutGraph(nodes, [edge("1", "a", "b"), edge("2", "b", "c")], fixed);
    assert.deepEqual(points.a, fixed.a);
    assert.deepEqual(points.b, fixed.b);
    assert.ok(Math.hypot(points.c.x - points.b.x, points.c.y - points.b.y) < 400, "c sits near b");
    for (const [x, y] of [
        ["a", "c"],
        ["b", "c"],
        ["a", "d"],
        ["b", "d"],
        ["c", "d"],
    ])
        assert.equal(touching(nodes.find((n) => n.id === x)!, points[x], nodes.find((n) => n.id === y)!, points[y]), false);
});

test("edge shapes start and end on the node rims and fan out between the same two nodes", () => {
    const points = { a: { x: 0, y: 0 }, b: { x: 300, y: 0 } };
    const radius = { a: 28, b: 28 };
    const shapes = edgeShapes([edge("ab", "a", "b"), edge("ba", "b", "a")], points, radius);
    assert.equal(shapes.length, 2);
    const mid = shapes.map((shape) => shape.at(0.5));
    assert.ok(Math.abs(mid[0].y - mid[1].y) > 40, "opposite relations take different lanes");
    const start = shapes[0].at(0),
        end = shapes[0].at(1);
    assert.ok(Math.hypot(start.x, start.y) >= 28 && Math.hypot(end.x - 300, end.y) >= 28);
    assert.ok(shapes[0].head.startsWith("M "), "directed edges have an arrowhead");
    assert.equal(edgeShapes([edge("w", "a", "b", true)], points, radius)[0].head, "", "weak links have none");
    assert.deepEqual(edgeShapes([edge("loop", "a", "a")], points, radius), []);
});

test("labels on edges that share a lane do not overlap each other or nodes", () => {
    const nodes = [node("a"), node("b"), node("c")];
    const points = { a: { x: 0, y: 0 }, b: { x: 260, y: 0 }, c: { x: 130, y: 120 } };
    const edges = [edge("1", "a", "b"), edge("2", "b", "a"), edge("3", "a", "c"), edge("4", "c", "b")];
    const labels = placeLabels(edgeShapes(edges, points, { a: 28, b: 28, c: 28 }), { 1: "师徒", 2: "亲属", 3: "同盟", 4: "敌对" }, nodes, points);
    for (let i = 0; i < labels.length; i++)
        for (let j = i + 1; j < labels.length; j++) {
            const a = labels[i],
                b = labels[j];
            assert.ok(Math.abs(a.x - b.x) >= (a.w + b.w) / 2 || Math.abs(a.y - b.y) >= (a.h + b.h) / 2, `${a.text} overlaps ${b.text}`);
        }
});

test("neighbours and fitView", () => {
    const edges = [edge("1", "a", "b"), edge("2", "c", "a"), edge("3", "d", "e")];
    assert.deepEqual([...neighbours(edges, "a")].sort(), ["a", "b", "c"]);
    const nodes = [node("a"), node("b")];
    const view = fitView(nodes, { a: { x: 0, y: 0 }, b: { x: 600, y: 300 } }, 800, 500);
    const screen = (p: Point) => ({ x: p.x * view.k + view.x, y: p.y * view.k + view.y });
    for (const p of [
        { x: 0, y: 0 },
        { x: 600, y: 300 },
    ]) {
        const s = screen(p);
        assert.ok(s.x >= 0 && s.x <= 800 && s.y >= 0 && s.y <= 500);
    }
    assert.deepEqual(fitView([], {}, 800, 500), { x: 400, y: 250, k: 1 });
});

// ---- palette editing ----

test("palette editing keeps 2-8 valid colours and moves them without losing any", () => {
    assert.deepEqual(moveColour(["#111111", "#222222", "#333333"], 0, 2), ["#222222", "#333333", "#111111"]);
    assert.deepEqual(moveColour(["#111111", "#222222"], 1, 0), ["#222222", "#111111"]);
    assert.deepEqual(moveColour(["#111111", "#222222"], 0, 5), ["#111111", "#222222"], "out of range does nothing");
    assert.deepEqual(removeColour(["#111111", "#222222", "#333333"], 1), ["#111111", "#333333"]);
    const eight = ["#111111", "#222222", "#333333", "#444444", "#555555", "#666666", "#777777", "#888888"];
    assert.equal(addColour(eight).length, 8, "the ninth colour is refused");
    assert.equal(addColour(["#336699"]).length, 2);
    assert.match(nextColour(["#336699"]), /^#[0-9A-F]{6}$/);
    assert.notEqual(nextColour(["#336699"]), "#336699");
});

test("a palette draft reports what is missing and is stored normalised", () => {
    assert.equal(paletteProblem({ name: "雨夜", colors: ["#112233", "#445566"] }), null);
    assert.equal(paletteProblem({ name: " ", colors: ["#112233", "#445566"] }), "请输入色卡名称");
    assert.equal(paletteProblem({ name: "雨夜", colors: ["#112233"] }), "色卡至少需要 2 个颜色");
    assert.equal(paletteProblem({ name: "雨夜", colors: ["#112233", "oops"] }), "请输入有效的 HEX 颜色代码");
    assert.deepEqual(storedPalette({ name: " 雨夜 ", colors: ["#abc", "#445566"] }), { name: "雨夜", colors: ["#AABBCC", "#445566"] });
    assert.equal(sameColours(["#aabbcc"], ["#AABBCC"]), true);
    assert.equal(sameColours(["#aabbcc", "#000000"], ["#000000", "#aabbcc"]), false, "order matters");
});
