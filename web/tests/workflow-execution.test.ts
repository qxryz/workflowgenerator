import assert from "node:assert/strict";
import test from "node:test";

import { createWorkflowExecution, WorkflowGraphError, type WorkflowExecutionEvent, type WorkflowNodeExecutionContext } from "../src/lib/canvas/workflow-execution.ts";
import { observeWorkflowExecution, useWorkflowRunStore } from "../src/stores/canvas/use-workflow-run-store.ts";

type Artifact = { id: string; persisted: true };

function nodeStatuses(snapshot: ReturnType<ReturnType<typeof createWorkflowExecution<Artifact>>["getSnapshot"]>) {
    return Object.fromEntries(snapshot.nodes.map((node) => [node.nodeId, node.status]));
}

function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((promiseResolve, promiseReject) => {
        resolve = promiseResolve;
        reject = promiseReject;
    });
    return { promise, resolve, reject };
}

async function nextTask() {
    await new Promise((resolve) => setTimeout(resolve, 0));
}

test("automatic mode releases downstream only after upstream returns persisted artifacts", async () => {
    const upstream = deferred<{ artifacts: Artifact[] }>();
    const calls: string[] = [];
    let downstreamInputs: readonly Artifact[] = [];
    const events: WorkflowExecutionEvent<Artifact>[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: {
            nodes: [{ id: "create" }, { id: "use" }],
            edges: [{ fromNodeId: "create", toNodeId: "use" }],
        },
        runNode: async (context) => {
            calls.push(context.node.id);
            if (context.node.id === "create") {
                context.reportProgress({ ratio: 2, message: "provider done" });
                context.markPersisting();
                return upstream.promise;
            }
            downstreamInputs = context.inputs[0].artifacts;
            return { artifacts: [{ id: "final", persisted: true }] };
        },
    });
    execution.subscribe((event) => events.push(event));

    const run = execution.start();
    await nextTask();
    assert.deepEqual(calls, ["create"]);
    assert.equal(nodeStatuses(execution.getSnapshot()).use, "waiting_inputs");

    upstream.resolve({ artifacts: [{ id: "source", persisted: true }] });
    const snapshot = await run;
    assert.equal(snapshot.status, "completed");
    assert.deepEqual(calls, ["create", "use"]);
    assert.deepEqual(downstreamInputs, [{ id: "source", persisted: true }]);
    assert.ok(events.some((event) => event.type === "node_status_changed" && event.status === "persisting"));
    assert.ok(events.some((event) => event.type === "node_artifacts_persisted" && event.nodeId === "create"));
    const persistedEventIndex = events.findIndex((event) => event.type === "node_artifacts_persisted" && event.nodeId === "create");
    const downstreamRunningIndex = events.findIndex((event) => event.type === "node_status_changed" && event.nodeId === "use" && event.status === "running");
    assert.ok(persistedEventIndex < downstreamRunningIndex);
    const progress = events.find((event) => event.type === "node_progress");
    assert.equal(progress?.type === "node_progress" ? progress.progress.ratio : undefined, 1);
});

test("guided mode exposes persisted checkpoint output and waits for explicit continuation", async () => {
    const calls: string[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "guided",
        graph: {
            nodes: [{ id: "draft", checkpoint: true }, { id: "publish" }],
            edges: [{ fromNodeId: "draft", toNodeId: "publish" }],
        },
        runNode: async ({ node, inputs }) => {
            calls.push(node.id);
            if (node.id === "publish") assert.equal(inputs[0].artifacts[0].id, "draft-v1");
            return { artifacts: [{ id: node.id === "draft" ? "draft-v1" : "published", persisted: true }] };
        },
    });

    const waiting = await execution.start();
    assert.equal(waiting.status, "waiting_review");
    assert.deepEqual(nodeStatuses(waiting), { draft: "waiting_review", publish: "waiting_inputs" });
    assert.equal(waiting.nodes[0].artifacts[0].id, "draft-v1");
    assert.deepEqual(calls, ["draft"]);

    const completed = await execution.continueNode("draft");
    assert.equal(completed.status, "completed");
    assert.deepEqual(calls, ["draft", "publish"]);
});

test("regenerating a reviewed action creates a new attempt and continuation consumes that attempt", async () => {
    const sourceArtifacts: string[] = [];
    const downstreamInputs: string[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "guided",
        graph: {
            nodes: [{ id: "source", checkpoint: true }, { id: "downstream" }],
            edges: [{ fromNodeId: "source", toNodeId: "downstream" }],
        },
        runNode: async ({ node, attempt, inputs }) => {
            if (node.id === "source") {
                const id = `source-v${attempt}`;
                sourceArtifacts.push(id);
                return { artifacts: [{ id, persisted: true }] };
            }
            downstreamInputs.push(inputs[0].artifacts[0].id);
            return { artifacts: [{ id: `downstream-v${attempt}`, persisted: true }] };
        },
    });

    assert.equal((await execution.start()).status, "waiting_review");
    const regenerated = await execution.retryFrom("source");
    assert.equal(regenerated.status, "waiting_review");
    assert.equal(regenerated.nodes[0].attempt, 2);
    assert.equal(regenerated.nodes[0].artifacts[0].id, "source-v2");
    assert.deepEqual(sourceArtifacts, ["source-v1", "source-v2"]);

    const completed = await execution.continueNode("source");
    assert.equal(completed.status, "completed");
    assert.deepEqual(downstreamInputs, ["source-v2"], "the old execution snapshot must not leak into downstream continuation");
});

test("a failed dependency blocks only its descendants while independent branches finish", async () => {
    const calls: string[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: {
            nodes: [{ id: "broken" }, { id: "blocked-child" }, { id: "blocked-grandchild" }, { id: "independent" }],
            edges: [
                { fromNodeId: "broken", toNodeId: "blocked-child" },
                { fromNodeId: "blocked-child", toNodeId: "blocked-grandchild" },
            ],
        },
        runNode: async ({ node }) => {
            calls.push(node.id);
            if (node.id === "broken") throw new Error("provider unavailable");
            return { artifacts: [{ id: node.id, persisted: true }] };
        },
    });

    const snapshot = await execution.start();
    assert.equal(snapshot.status, "error");
    assert.deepEqual(nodeStatuses(snapshot), {
        broken: "error",
        "blocked-child": "blocked",
        "blocked-grandchild": "blocked",
        independent: "completed",
    });
    assert.deepEqual(new Set(calls), new Set(["broken", "independent"]));
});

test("concurrent start calls share one execution and do not launch a node twice", async () => {
    const gate = deferred<{ artifacts: Artifact[] }>();
    let calls = 0;
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: { nodes: [{ id: "only" }], edges: [] },
        runNode: async () => {
            calls += 1;
            return gate.promise;
        },
    });

    const first = execution.start();
    const second = execution.start();
    assert.equal(first, second);
    await nextTask();
    assert.equal(calls, 1);
    gate.resolve({ artifacts: [{ id: "once", persisted: true }] });
    await Promise.all([first, second]);
    assert.equal(calls, 1);
});

test("cancel stops immediately and resume continues from the last durable checkpoint", async () => {
    const attempts: number[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: {
            nodes: [{ id: "slow" }, { id: "next" }],
            edges: [{ fromNodeId: "slow", toNodeId: "next" }],
        },
        runNode: ({ node, attempt, signal }) => {
            attempts.push(attempt);
            if (node.id === "next" || attempt > 1) return Promise.resolve({ artifacts: [{ id: node.id, persisted: true }] });
            return new Promise((_, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }));
        },
    });

    const firstRun = execution.start();
    await nextTask();
    await execution.cancel("user stopped");
    await firstRun;
    assert.equal(execution.getSnapshot().status, "stopped");
    assert.deepEqual(nodeStatuses(execution.getSnapshot()), { slow: "stopped", next: "stopped" });

    const resumed = await execution.resume();
    assert.equal(resumed.status, "completed");
    assert.deepEqual(attempts, [1, 2, 1]);
});

test("resuming a stopped guided run preserves its persisted review checkpoint", async () => {
    let calls = 0;
    const execution = createWorkflowExecution<Artifact>({
        mode: "guided",
        graph: {
            nodes: [{ id: "review", checkpoint: true }, { id: "next" }],
            edges: [{ fromNodeId: "review", toNodeId: "next" }],
        },
        runNode: async ({ node }) => {
            calls += 1;
            return { artifacts: [{ id: node.id, persisted: true }] };
        },
    });

    assert.equal((await execution.start()).status, "waiting_review");
    await execution.cancel();
    const resumed = await execution.resume();
    assert.equal(resumed.status, "waiting_review");
    assert.equal(resumed.nodes[0].artifacts[0].id, "review");
    assert.equal(calls, 1);
    await execution.continueNode("review");
    assert.equal(calls, 2);
});

test("retryFrom reruns a failed node and its blocked descendants from the breakpoint", async () => {
    let sourceCalls = 0;
    let childCalls = 0;
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: {
            nodes: [{ id: "source" }, { id: "child" }],
            edges: [{ fromNodeId: "source", toNodeId: "child" }],
        },
        runNode: async ({ node, inputs }) => {
            if (node.id === "source") {
                sourceCalls += 1;
                if (sourceCalls === 1) throw new Error("temporary failure");
                return { artifacts: [{ id: "source-v2", persisted: true }] };
            }
            childCalls += 1;
            assert.equal(inputs[0].artifacts[0].id, "source-v2");
            return { artifacts: [{ id: "child-v1", persisted: true }] };
        },
    });

    assert.equal((await execution.start()).status, "error");
    const retried = await execution.retryFrom("source");
    assert.equal(retried.status, "completed");
    assert.deepEqual(nodeStatuses(retried), { source: "completed", child: "completed" });
    assert.equal(retried.nodes[0].attempt, 2);
    assert.equal(sourceCalls, 2);
    assert.equal(childCalls, 1);
});

test("events are ordered and the workflow run store mirrors snapshots for Zodiac", async () => {
    useWorkflowRunStore.getState().reset();
    const events: WorkflowExecutionEvent<Artifact>[] = [];
    const execution = createWorkflowExecution<Artifact>({
        runId: "zodiac-run",
        mode: "automatic",
        graph: { nodes: [{ id: "asset-slot" }], edges: [] },
        runNode: async () => ({ artifacts: [{ id: "asset-1", persisted: true }] }),
    });
    execution.subscribe((event) => events.push(event));
    const stopObserving = observeWorkflowExecution(execution);

    await execution.start();
    stopObserving();

    assert.deepEqual(
        events.map((event) => event.sequence),
        events.map((_, index) => index + 1),
    );
    assert.equal(events.at(-1)?.type, "run_completed");
    const store = useWorkflowRunStore.getState();
    assert.equal(store.activeRunId, "zodiac-run");
    assert.equal(store.runs["zodiac-run"].status, "completed");
    assert.equal(store.eventsByRunId["zodiac-run"].at(-1)?.type, "run_completed");
});

test("a failing event observer cannot break execution or other Zodiac subscribers", async () => {
    const received: string[] = [];
    const execution = createWorkflowExecution<Artifact>({
        mode: "automatic",
        graph: { nodes: [{ id: "safe" }], edges: [] },
        runNode: async () => ({ artifacts: [{ id: "safe", persisted: true }] }),
    });
    execution.subscribe(() => {
        throw new Error("observer failed");
    });
    execution.subscribe((event) => received.push(event.type));

    assert.equal((await execution.start()).status, "completed");
    assert.equal(received.at(-1), "run_completed");
});

test("invalid or cyclic workflow graphs fail before any provider work starts", () => {
    const runNode = async (_context: WorkflowNodeExecutionContext<Artifact, unknown>) => ({ artifacts: [] });
    assert.throws(
        () =>
            createWorkflowExecution({
                mode: "automatic",
                graph: { nodes: [{ id: "a" }], edges: [{ fromNodeId: "missing", toNodeId: "a" }] },
                runNode,
            }),
        WorkflowGraphError,
    );
    assert.throws(
        () =>
            createWorkflowExecution({
                mode: "automatic",
                graph: {
                    nodes: [{ id: "a" }, { id: "b" }],
                    edges: [
                        { fromNodeId: "a", toNodeId: "b" },
                        { fromNodeId: "b", toNodeId: "a" },
                    ],
                },
                runNode,
            }),
        /acyclic/,
    );
});
