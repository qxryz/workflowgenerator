import assert from "node:assert/strict";
import test from "node:test";
const rows = new Map<string, string>();
const initial = { id: "p", title: "画布", createdAt: "2026", updatedAt: "2026", nodes: [{ id: "n", type: "text", x: 0, y: 0, width: 100, height: 100, metadata: { content: "old" } }], connections: [], chatSessions: [], activeChatId: null, backgroundMode: "lines", showImageInfo: false, viewport: { x: 0, y: 0, k: 1 } };
rows.set("p", JSON.stringify(initial));
let beforeCommit: (() => Promise<void>) | null = null;
globalThis.fetch = (async (input: string | URL | Request, options?: RequestInit) => {
    const body = JSON.parse(String(options?.body || "{}"));
    if (String(input) === "/api/store/get") return Response.json(body.namespace === "canvas-project-meta-v1" ? JSON.stringify([...rows.keys()]) : rows.get(body.key) ?? null);
    assert.equal(String(input), "/api/canvas/commit", "canvas writes must never use the unguarded store API");
    if (beforeCommit) { const pause = beforeCommit; beforeCommit = null; await pause(); }
    const projects = body.changes.map((change: { id: string }) => ({ id: change.id, value: rows.get(change.id) ?? null }));
    if (body.changes.some((change: { expected: string | null }, index: number) => change.expected !== projects[index].value)) return Response.json({ projects, ids: [...rows.keys()] }, { status: 409 });
    for (const change of body.changes) if (change.value === null) rows.delete(change.id); else rows.set(change.id, change.value);
    return Response.json({ projects: body.changes.map((change: { id: string; value: string | null }) => ({ id: change.id, value: change.value })), ids: [...rows.keys()] });
}) as typeof fetch;
const { useCanvasStore, flushCanvasStoreWrites, CanvasSaveConflictError } = await import("../src/stores/canvas/use-canvas-store.ts");
while (!useCanvasStore.getState().hydrated) await new Promise((resolve) => setTimeout(resolve, 1));
const current = () => useCanvasStore.getState().projects.find((project) => project.id === "p")!;
const saved = () => JSON.parse(rows.get("p")!);

test("ordinary stale-tab save preserves committed text and merges movement", async () => {
    const remote = saved(); remote.nodes[0].metadata.content = "remote text"; rows.set("p", JSON.stringify(remote));
    useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, x: 50 })) });
    await flushCanvasStoreWrites();
    assert.equal(saved().nodes[0].metadata.content, "remote text"); assert.equal(saved().nodes[0].x, 50); assert.equal(current().nodes[0].metadata.content, "remote text");
});
test("conflicting text fails the tool save and durably preserves the local draft as a visible project", async () => {
    const remote = saved(); remote.nodes[0].metadata.content = "newest remote"; rows.set("p", JSON.stringify(remote));
    useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "my unsaved edit" } })) });
    await assert.rejects(flushCanvasStoreWrites(), CanvasSaveConflictError);
    assert.equal(saved().nodes[0].metadata.content, "newest remote");
    const backup = useCanvasStore.getState().projects.find((project) => project.id !== "p")!;
    assert.match(backup.title, /冲突副本/); assert.equal(JSON.parse(rows.get(backup.id)!).nodes[0].metadata.content, "my unsaved edit");
    useCanvasStore.getState().updateProject("p", { viewport: { x: 1, y: 1, k: 1 } });
    await flushCanvasStoreWrites(); assert.ok(rows.has(backup.id));
});
test("edits queued during an in-flight write keep their original comparison base", async () => {
    let release!: () => void, started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    beforeCommit = () => { started(); return new Promise<void>((resolve) => { release = resolve; }); };
    useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, x: 100 })) });
    const first = flushCanvasStoreWrites(); await begun;
    useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "last local edit" } })) });
    release(); await first; await flushCanvasStoreWrites();
    assert.equal(saved().nodes[0].metadata.content, "last local edit"); assert.equal(saved().nodes[0].x, 100);
});


test("rapid successive edits to the same text are causal updates, not conflicts", async () => {
    let release!: () => void, started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    beforeCommit = () => { started(); return new Promise<void>((resolve) => { release = resolve; }); };
    const edit = (content: string) => useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content } })) });
    const count = rows.size;
    edit("a"); const first = flushCanvasStoreWrites(); await begun;
    edit("ab"); const second = flushCanvasStoreWrites(); edit("abc"); release();
    await Promise.all([first, second]); await flushCanvasStoreWrites();
    assert.equal(saved().nodes[0].metadata.content, "abc");
    assert.equal(rows.size, count, "own consecutive saves must not create conflict copies");
});


test("deleting a project while its creation is saving does not leave a stored orphan", async () => {
    let release!: () => void, started!: () => void;
    const begun = new Promise<void>((resolve) => { started = resolve; });
    beforeCommit = () => { started(); return new Promise<void>((resolve) => { release = resolve; }); };
    const id = useCanvasStore.getState().createProject("transient");
    const first = flushCanvasStoreWrites(); await begun;
    useCanvasStore.getState().deleteProjects([id]); release();
    await first; await flushCanvasStoreWrites();
    assert.equal(rows.has(id), false);
    assert.equal(useCanvasStore.getState().projects.some((project) => project.id === id), false);
});


test("hash-guarded tools reject stale project versions even when fields could otherwise merge", async () => {
    const remote = saved(); remote.nodes[0].x = 200; rows.set("p", JSON.stringify(remote));
    useCanvasStore.getState().updateProject("p", { nodes: current().nodes.map((node) => ({ ...node, metadata: { ...node.metadata, content: "strict attempted edit" } })) });
    await assert.rejects(flushCanvasStoreWrites({ strictProjectId: "p" }), CanvasSaveConflictError);
    assert.equal(saved().nodes[0].metadata.content, "abc");
    assert.equal(saved().nodes[0].x, 200);
    assert.ok([...rows.values()].some((value) => JSON.parse(value).nodes[0]?.metadata.content === "strict attempted edit"));
});
