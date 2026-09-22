import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

// 终端节点已从产品中移除：老画布在加载时必须删掉终端节点及其全部连线。
const state = { stored: new Map<string, string>() };
(globalThis as Record<string, unknown>).__canvasTerminalMigration = state;

const mocks = new Map([
    [
        "@/services/server-storage",
        `const state = globalThis.__canvasTerminalMigration;
export const getStoredValue = async (namespace, key) => state.stored.get(namespace + "/" + key) ?? null;
export const commitCanvasProjects = async (changes) => {
const projects = changes.map(change => ({ id: change.id, value: state.stored.get("canvas-project-v1/" + change.id) ?? null }));
let ids = JSON.parse(state.stored.get("canvas-project-meta-v1/projects") || "[]");
if (changes.some((change,index) => change.expected !== projects[index].value)) return { conflict: true, projects, ids };
for (const change of changes) { const key="canvas-project-v1/"+change.id; if(change.value===null) { state.stored.delete(key); ids=ids.filter(id=>id!==change.id); } else { state.stored.set(key,change.value); if(!ids.includes(change.id)) ids.unshift(change.id); } }
state.stored.set("canvas-project-meta-v1/projects",JSON.stringify(ids));
return { conflict:false, projects:changes.map(({id,value})=>({id,value})), ids };
};`,
    ],
    ["@/services/media-retention-policy", `export const markMediaReferencesChanged = () => {};`],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        if (mocks.has(specifier)) return { url: `data:text/javascript,${encodeURIComponent(mocks.get(specifier) as string)}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return nextResolve(specifier, context);
    },
});

const { normalizeCanvasProject } = await import("../src/lib/canvas/canvas-portability.ts");
const { useCanvasStore, flushCanvasStoreWrites } = await import("../src/stores/canvas/use-canvas-store.ts");

const node = (id: string, type: string) => ({ id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata: {} });
function legacyProject() {
    return {
        id: "legacy",
        title: "老画布",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-02T00:00:00.000Z",
        nodes: [node("prompt", "text"), node("terminal", "terminal"), node("image", "image")],
        connections: [
            { id: "prompt-to-terminal", fromNodeId: "prompt", toNodeId: "terminal" },
            { id: "terminal-to-image", fromNodeId: "terminal", toNodeId: "image" },
            { id: "prompt-to-image", fromNodeId: "prompt", toNodeId: "image" },
        ],
        chatSessions: [],
        activeChatId: null,
        backgroundMode: "lines",
        showImageInfo: false,
        viewport: { x: 0, y: 0, k: 1 },
    };
}

test("legacy terminal nodes and their connections are removed without touching other nodes", () => {
    const project = normalizeCanvasProject(legacyProject() as never);
    assert.deepEqual(
        project.nodes.map((item) => item.id),
        ["prompt", "image"],
    );
    assert.deepEqual(
        project.connections.map((edge) => edge.id),
        ["prompt-to-image"],
    );
    assert.deepEqual(normalizeCanvasProject(project as never), project);
});

test("a canvas without terminal nodes is returned unchanged", () => {
    const clean = { ...legacyProject(), nodes: [node("prompt", "text")], connections: [] };
    assert.equal(normalizeCanvasProject(clean as never), clean);
});

test("the persisted canvas load path cleans terminal nodes before the canvas opens", async () => {
    state.stored.set("canvas-project-meta-v1/projects", JSON.stringify(["legacy"]));
    state.stored.set("canvas-project-v1/legacy", JSON.stringify(legacyProject()));
    await useCanvasStore.persist.rehydrate();
    const restored = useCanvasStore.getState().openProject("legacy");
    assert.deepEqual(
        restored?.nodes.map((item) => item.id),
        ["prompt", "image"],
    );
    assert.deepEqual(
        restored?.connections.map((edge) => edge.id),
        ["prompt-to-image"],
    );
});

test("importing an old canvas export cleans terminal nodes and connections", () => {
    const id = useCanvasStore.getState().importProject(legacyProject() as never);
    const imported = useCanvasStore.getState().openProject(id);
    assert.deepEqual(
        imported?.nodes.map((item) => item.id),
        ["prompt", "image"],
    );
    assert.deepEqual(
        imported?.connections.map((edge) => edge.id),
        ["prompt-to-image"],
    );
});


test("a migrated project saves using its original raw JSON as the comparison base", async () => {
    useCanvasStore.getState().renameProject("legacy", "迁移后画布");
    await flushCanvasStoreWrites();
    const persisted = JSON.parse(state.stored.get("canvas-project-v1/legacy")!);
    assert.deepEqual(persisted.nodes.map((item: {id:string}) => item.id), ["prompt", "image"]);
    assert.equal(persisted.title, "迁移后画布");
});
