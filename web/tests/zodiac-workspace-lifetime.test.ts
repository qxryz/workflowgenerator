import assert from "node:assert/strict";
import test from "node:test";
import { retainedZodiacWorkspaces } from "../src/lib/agent/zodiac-workspace-lifetime.ts";
import { useAgentStore, type AgentCanvasContext } from "../src/stores/use-agent-store.ts";
import { observeWorkflowExecution, useWorkflowRunStore } from "../src/stores/canvas/use-workflow-run-store.ts";

test("leaving a canvas retains its live conversation, then releases it only after completion", () => {
    assert.deepEqual(retainedZodiacWorkspaces(["a"], "b", { a: { agent: true } }), ["a", "b"]);
    assert.deepEqual(retainedZodiacWorkspaces(["a", "b"], "b", { a: { agent: false, generation: true } }), ["a", "b"]);
    assert.deepEqual(retainedZodiacWorkspaces(["a", "b"], "b", { a: { agent: false, generation: false } }), ["b"]);
    assert.deepEqual(retainedZodiacWorkspaces(["b"], "b", {}), ["b"]);
});

test("background context updates and collapsing the panel do not replace or unload the active conversation", () => {
    const a = { projectId: "a" } as AgentCanvasContext;
    const b = { projectId: "b" } as AgentCanvasContext;
    useAgentStore.setState({ selectedProjectId: "b", contexts: {}, canvasContext: null });
    useAgentStore.getState().setCanvasContext(b);
    useAgentStore.getState().setCanvasContext(a);
    assert.equal(useAgentStore.getState().canvasContext, b);
    assert.equal(useAgentStore.getState().contexts.a, a);
    useAgentStore.getState().openPanel();
    useAgentStore.getState().closePanel();
    assert.equal(useAgentStore.getState().panelMounted, true);
    assert.equal(useAgentStore.getState().contexts.a, a);
});

test("concurrent workflow events remain assigned to their own canvas", () => {
    useWorkflowRunStore.getState().reset();
    const callbacks = new Map<string, (event: any) => void>();
    const execution = (id: string) => ({
        runId: id,
        getSnapshot: () => ({ runId: id, status: "running", nodes: [] }),
        subscribe: (fn: any) => {
            callbacks.set(id, fn);
            return () => callbacks.delete(id);
        },
    });
    observeWorkflowExecution(execution("run-a") as any, "a");
    observeWorkflowExecution(execution("run-b") as any, "b");
    callbacks.get("run-a")!({ type: "node_status_changed", nodeId: "one" });
    assert.deepEqual(useWorkflowRunStore.getState().runIdsByProject, { a: "run-a", b: "run-b" });
    useWorkflowRunStore.getState().removeRun("run-a");
    assert.deepEqual(useWorkflowRunStore.getState().runIdsByProject, { b: "run-b" });
});
