export const WORKFLOW_NODE_STATUSES = ["queued", "waiting_inputs", "running", "persisting", "waiting_review", "completed", "error", "stopped", "blocked"] as const;

export type WorkflowNodeStatus = (typeof WORKFLOW_NODE_STATUSES)[number];
export type WorkflowExecutionMode = "guided" | "automatic";
export type WorkflowRunStatus = "idle" | "running" | "waiting_review" | "completed" | "error" | "stopped";
export type WorkflowRunStartReason = "start" | "resume" | "retry";

export type WorkflowExecutionNode<TNodeData = unknown> = {
    id: string;
    data?: TNodeData;
    /** Guided runs pause after this node's persisted output is available. */
    checkpoint?: boolean;
};

export type WorkflowExecutionEdge = {
    fromNodeId: string;
    toNodeId: string;
};

export type WorkflowExecutionGraph<TNodeData = unknown> = {
    nodes: readonly WorkflowExecutionNode<TNodeData>[];
    edges: readonly WorkflowExecutionEdge[];
};

export type WorkflowExecutionError = {
    message: string;
    code?: string;
};

export type WorkflowNodeInput<TArtifact> = {
    nodeId: string;
    artifacts: readonly TArtifact[];
    metadata?: Readonly<Record<string, unknown>>;
};

export type WorkflowNodeProgress = {
    message?: string;
    ratio?: number;
    detail?: unknown;
};

export type WorkflowNodeRunResult<TArtifact> = {
    /** The executor treats every returned artifact as already durably persisted. */
    artifacts: readonly TArtifact[];
    metadata?: Readonly<Record<string, unknown>>;
};

export type WorkflowNodeExecutionContext<TArtifact, TNodeData> = {
    runId: string;
    mode: WorkflowExecutionMode;
    node: Readonly<WorkflowExecutionNode<TNodeData>>;
    attempt: number;
    inputs: readonly WorkflowNodeInput<TArtifact>[];
    signal: AbortSignal;
    /** Call when provider work has finished and durable persistence begins. */
    markPersisting: () => void;
    reportProgress: (progress: WorkflowNodeProgress) => void;
};

export type WorkflowNodeRunner<TArtifact, TNodeData> = (context: WorkflowNodeExecutionContext<TArtifact, TNodeData>) => Promise<WorkflowNodeRunResult<TArtifact>>;

export type WorkflowNodeRunRecord<TArtifact> = {
    nodeId: string;
    status: WorkflowNodeStatus;
    attempt: number;
    artifacts: readonly TArtifact[];
    metadata?: Readonly<Record<string, unknown>>;
    error?: WorkflowExecutionError;
    startedAt?: number;
    completedAt?: number;
};

export type WorkflowRunSnapshot<TArtifact> = {
    runId: string;
    mode: WorkflowExecutionMode;
    status: WorkflowRunStatus;
    nodes: readonly WorkflowNodeRunRecord<TArtifact>[];
    startedAt?: number;
    endedAt?: number;
};

type WorkflowExecutionEventBase = {
    runId: string;
    sequence: number;
    timestamp: number;
};

export type WorkflowExecutionEvent<TArtifact> =
    | (WorkflowExecutionEventBase & { type: "run_started"; reason: WorkflowRunStartReason })
    | (WorkflowExecutionEventBase & {
          type: "node_status_changed";
          nodeId: string;
          previousStatus: WorkflowNodeStatus;
          status: WorkflowNodeStatus;
          attempt: number;
          error?: WorkflowExecutionError;
      })
    | (WorkflowExecutionEventBase & { type: "node_progress"; nodeId: string; attempt: number; progress: WorkflowNodeProgress })
    | (WorkflowExecutionEventBase & {
          type: "node_artifacts_persisted";
          nodeId: string;
          attempt: number;
          artifacts: readonly TArtifact[];
          metadata?: Readonly<Record<string, unknown>>;
      })
    | (WorkflowExecutionEventBase & { type: "node_review_continued"; nodeId: string })
    | (WorkflowExecutionEventBase & { type: "run_waiting_review"; nodeIds: readonly string[] })
    | (WorkflowExecutionEventBase & { type: "run_completed"; status: "completed" | "error" })
    | (WorkflowExecutionEventBase & { type: "run_stopped"; reason?: string });

export type WorkflowExecutionOptions<TArtifact, TNodeData> = {
    graph: WorkflowExecutionGraph<TNodeData>;
    mode: WorkflowExecutionMode;
    runNode: WorkflowNodeRunner<TArtifact, TNodeData>;
    runId?: string;
    now?: () => number;
    shouldWaitForReview?: (node: Readonly<WorkflowExecutionNode<TNodeData>>, result: Readonly<WorkflowNodeRunResult<TArtifact>>) => boolean;
};

type MutableNodeRecord<TArtifact> = {
    nodeId: string;
    status: WorkflowNodeStatus;
    attempt: number;
    artifacts: TArtifact[];
    metadata?: Readonly<Record<string, unknown>>;
    error?: WorkflowExecutionError;
    startedAt?: number;
    completedAt?: number;
};

type WorkflowEventListener<TArtifact> = (event: WorkflowExecutionEvent<TArtifact>) => void;
type WorkflowEventPayload<TArtifact> = WorkflowExecutionEvent<TArtifact> extends infer TEvent ? (TEvent extends WorkflowExecutionEventBase ? Omit<TEvent, keyof WorkflowExecutionEventBase> : never) : never;

const FAILED_DEPENDENCY_STATUSES = new Set<WorkflowNodeStatus>(["error", "stopped", "blocked"]);
const FINAL_NODE_STATUSES = new Set<WorkflowNodeStatus>(["completed", "error", "stopped", "blocked"]);
let runSequence = 0;

class WorkflowAbortError extends Error {
    constructor() {
        super("Workflow execution was stopped");
        this.name = "WorkflowAbortError";
    }
}

export class WorkflowGraphError extends Error {
    constructor(message: string) {
        super(message);
        this.name = "WorkflowGraphError";
    }
}

export class WorkflowExecution<TArtifact = unknown, TNodeData = unknown> {
    private readonly graph: WorkflowExecutionGraph<TNodeData>;
    private readonly mode: WorkflowExecutionMode;
    private readonly runNode: WorkflowNodeRunner<TArtifact, TNodeData>;
    private readonly now: () => number;
    private readonly shouldWaitForReview: NonNullable<WorkflowExecutionOptions<TArtifact, TNodeData>["shouldWaitForReview"]>;
    private readonly nodeById: Map<string, WorkflowExecutionNode<TNodeData>>;
    private readonly incomingByNodeId: Map<string, string[]>;
    private readonly outgoingByNodeId: Map<string, string[]>;
    private readonly records: Map<string, MutableNodeRecord<TArtifact>>;
    private readonly listeners = new Set<WorkflowEventListener<TArtifact>>();
    private readonly stoppedFrom = new Map<string, WorkflowNodeStatus>();
    private controller = new AbortController();
    private runStatus: WorkflowRunStatus = "idle";
    private startedAt?: number;
    private endedAt?: number;
    private eventSequence = 0;
    private executionEpoch = 0;
    private pumpPromise: Promise<WorkflowRunSnapshot<TArtifact>> | null = null;

    readonly runId: string;

    constructor(options: WorkflowExecutionOptions<TArtifact, TNodeData>) {
        validateGraph(options.graph);
        this.graph = {
            nodes: options.graph.nodes.map((node) => ({ ...node })),
            edges: options.graph.edges.map((edge) => ({ ...edge })),
        };
        this.mode = options.mode;
        this.runNode = options.runNode;
        this.now = options.now ?? Date.now;
        this.shouldWaitForReview = options.shouldWaitForReview ?? ((node) => node.checkpoint === true);
        this.runId = options.runId ?? `workflow-run-${this.now()}-${++runSequence}`;
        this.nodeById = new Map(this.graph.nodes.map((node) => [node.id, node]));
        this.incomingByNodeId = new Map(this.graph.nodes.map((node) => [node.id, []]));
        this.outgoingByNodeId = new Map(this.graph.nodes.map((node) => [node.id, []]));

        for (const edge of this.graph.edges) {
            const incoming = this.incomingByNodeId.get(edge.toNodeId)!;
            const outgoing = this.outgoingByNodeId.get(edge.fromNodeId)!;
            if (!incoming.includes(edge.fromNodeId)) incoming.push(edge.fromNodeId);
            if (!outgoing.includes(edge.toNodeId)) outgoing.push(edge.toNodeId);
        }

        this.records = new Map(
            this.graph.nodes.map((node) => [
                node.id,
                {
                    nodeId: node.id,
                    status: this.incomingByNodeId.get(node.id)!.length === 0 ? "queued" : "waiting_inputs",
                    attempt: 0,
                    artifacts: [],
                },
            ]),
        );
    }

    getSnapshot(): WorkflowRunSnapshot<TArtifact> {
        return {
            runId: this.runId,
            mode: this.mode,
            status: this.runStatus,
            nodes: this.graph.nodes.map((node) => cloneRecord(this.records.get(node.id)!)),
            startedAt: this.startedAt,
            endedAt: this.endedAt,
        };
    }

    subscribe(listener: WorkflowEventListener<TArtifact>): () => void {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }

    start(): Promise<WorkflowRunSnapshot<TArtifact>> {
        if (this.pumpPromise) return this.pumpPromise;
        if (this.runStatus !== "idle") return Promise.resolve(this.getSnapshot());
        return this.activateAndPump("start");
    }

    continueNode(nodeId: string): Promise<WorkflowRunSnapshot<TArtifact>> {
        const record = this.getRecord(nodeId);
        if (record.status !== "waiting_review") {
            return Promise.reject(new Error(`Node ${nodeId} is not waiting for review`));
        }
        record.completedAt = this.now();
        this.transition(record, "completed");
        this.emit({ type: "node_review_continued", nodeId });
        return this.activateAndPump("resume");
    }

    continueAll(): Promise<WorkflowRunSnapshot<TArtifact>> {
        const waiting = Array.from(this.records.values()).filter((record) => record.status === "waiting_review");
        if (waiting.length === 0) return Promise.resolve(this.getSnapshot());
        for (const record of waiting) {
            record.completedAt = this.now();
            this.transition(record, "completed");
            this.emit({ type: "node_review_continued", nodeId: record.nodeId });
        }
        return this.activateAndPump("resume");
    }

    cancel(reason?: string): Promise<WorkflowRunSnapshot<TArtifact>> {
        if (this.runStatus === "completed" || this.runStatus === "error" || this.runStatus === "stopped") {
            return this.pumpPromise ?? Promise.resolve(this.getSnapshot());
        }

        this.executionEpoch += 1;
        this.controller.abort();
        for (const record of this.records.values()) {
            if (FINAL_NODE_STATUSES.has(record.status)) continue;
            this.stoppedFrom.set(record.nodeId, record.status);
            this.transition(record, "stopped");
        }
        this.runStatus = "stopped";
        this.endedAt = this.now();
        this.emit({ type: "run_stopped", reason });
        return this.pumpPromise ?? Promise.resolve(this.getSnapshot());
    }

    resume(): Promise<WorkflowRunSnapshot<TArtifact>> {
        if (this.pumpPromise) return this.pumpPromise.then(() => this.resume());
        if (this.runStatus !== "stopped") return Promise.resolve(this.getSnapshot());

        this.executionEpoch += 1;
        this.controller = new AbortController();
        this.endedAt = undefined;
        for (const record of this.records.values()) {
            if (record.status !== "stopped") continue;
            const previous = this.stoppedFrom.get(record.nodeId);
            const nextStatus = previous === "waiting_review" ? "waiting_review" : this.dependenciesComplete(record.nodeId) ? "queued" : "waiting_inputs";
            this.transition(record, nextStatus);
            this.stoppedFrom.delete(record.nodeId);
        }
        return this.activateAndPump("resume");
    }

    retryFrom(nodeId: string): Promise<WorkflowRunSnapshot<TArtifact>> {
        this.getRecord(nodeId);
        if (this.pumpPromise || this.runStatus === "running") {
            return Promise.reject(new Error("Cannot retry while workflow nodes are running"));
        }

        const resetNodeIds = this.collectDescendants(nodeId);
        this.executionEpoch += 1;
        this.controller = new AbortController();
        this.endedAt = undefined;
        for (const resetNodeId of resetNodeIds) {
            const record = this.records.get(resetNodeId)!;
            record.artifacts = [];
            record.metadata = undefined;
            record.error = undefined;
            record.startedAt = undefined;
            record.completedAt = undefined;
            this.stoppedFrom.delete(resetNodeId);
            this.transition(record, this.dependenciesCompleteOutside(resetNodeId, resetNodeIds) ? "queued" : "waiting_inputs");
        }
        return this.activateAndPump("retry");
    }

    private activateAndPump(reason: WorkflowRunStartReason): Promise<WorkflowRunSnapshot<TArtifact>> {
        if (this.pumpPromise) return this.pumpPromise;
        if (this.startedAt === undefined) this.startedAt = this.now();
        this.endedAt = undefined;
        this.runStatus = "running";
        this.emit({ type: "run_started", reason });
        return this.ensurePump();
    }

    private ensurePump(): Promise<WorkflowRunSnapshot<TArtifact>> {
        if (this.pumpPromise) return this.pumpPromise;
        const epoch = this.executionEpoch;
        const promise = this.runPump(epoch).finally(() => {
            if (this.pumpPromise === promise) this.pumpPromise = null;
        });
        this.pumpPromise = promise;
        return promise;
    }

    private async runPump(epoch: number): Promise<WorkflowRunSnapshot<TArtifact>> {
        while (epoch === this.executionEpoch && !this.controller.signal.aborted) {
            this.refreshEligibility();
            const ready = Array.from(this.records.values()).filter((record) => record.status === "queued");
            if (ready.length > 0) {
                await Promise.all(ready.map((record) => this.executeNode(record, epoch)));
                continue;
            }

            const waitingForReview = Array.from(this.records.values()).filter((record) => record.status === "waiting_review");
            if (waitingForReview.length > 0) {
                this.runStatus = "waiting_review";
                this.emit({ type: "run_waiting_review", nodeIds: waitingForReview.map((record) => record.nodeId) });
                return this.getSnapshot();
            }

            const records = Array.from(this.records.values());
            if (records.every((record) => FINAL_NODE_STATUSES.has(record.status))) {
                if (records.some((record) => record.status === "error" || record.status === "blocked")) {
                    this.runStatus = "error";
                } else if (records.some((record) => record.status === "stopped")) {
                    this.runStatus = "stopped";
                } else {
                    this.runStatus = "completed";
                }
                this.endedAt = this.now();
                if (this.runStatus === "completed" || this.runStatus === "error") {
                    this.emit({ type: "run_completed", status: this.runStatus });
                }
                return this.getSnapshot();
            }

            throw new WorkflowGraphError("Workflow reached an unresolved state");
        }
        return this.getSnapshot();
    }

    private async executeNode(record: MutableNodeRecord<TArtifact>, epoch: number): Promise<void> {
        record.attempt += 1;
        record.startedAt = this.now();
        record.completedAt = undefined;
        record.error = undefined;
        this.transition(record, "running");
        const attempt = record.attempt;
        const signal = this.controller.signal;
        const inputs = this.incomingByNodeId.get(record.nodeId)!.map((nodeId) => {
            const source = this.records.get(nodeId)!;
            return { nodeId, artifacts: [...source.artifacts], metadata: source.metadata };
        });
        const isCurrentAttempt = () => epoch === this.executionEpoch && !signal.aborted && record.attempt === attempt && (record.status === "running" || record.status === "persisting");

        try {
            const result = await raceWithAbort(
                Promise.resolve().then(() =>
                    this.runNode({
                        runId: this.runId,
                        mode: this.mode,
                        node: this.nodeById.get(record.nodeId)!,
                        attempt,
                        inputs,
                        signal,
                        markPersisting: () => {
                            if (isCurrentAttempt() && record.status === "running") this.transition(record, "persisting");
                        },
                        reportProgress: (progress) => {
                            if (!isCurrentAttempt()) return;
                            this.emit({ type: "node_progress", nodeId: record.nodeId, attempt, progress: normalizeProgress(progress) });
                        },
                    }),
                ),
                signal,
            );
            if (!isCurrentAttempt()) return;
            if (!result || !Array.isArray(result.artifacts)) throw new Error(`Node ${record.nodeId} returned an invalid result`);
            if (record.status === "running") this.transition(record, "persisting");
            record.artifacts = [...result.artifacts];
            record.metadata = result.metadata;
            this.emit({
                type: "node_artifacts_persisted",
                nodeId: record.nodeId,
                attempt,
                artifacts: [...record.artifacts],
                metadata: record.metadata,
            });

            if (this.mode === "guided" && this.shouldWaitForReview(this.nodeById.get(record.nodeId)!, result)) {
                this.transition(record, "waiting_review");
            } else {
                record.completedAt = this.now();
                this.transition(record, "completed");
            }
        } catch (error) {
            if (epoch !== this.executionEpoch || signal.aborted || error instanceof WorkflowAbortError) return;
            record.error = normalizeError(error);
            record.completedAt = this.now();
            this.transition(record, "error");
        }
    }

    private refreshEligibility() {
        let changed = true;
        while (changed) {
            changed = false;
            for (const record of this.records.values()) {
                if (record.status !== "waiting_inputs" && record.status !== "queued") continue;
                const dependencies = this.incomingByNodeId.get(record.nodeId)!;
                const dependencyRecords = dependencies.map((nodeId) => this.records.get(nodeId)!);
                if (dependencyRecords.some((dependency) => FAILED_DEPENDENCY_STATUSES.has(dependency.status))) {
                    record.error = { message: "Upstream dependency did not complete" };
                    record.completedAt = this.now();
                    this.transition(record, "blocked");
                    changed = true;
                    continue;
                }
                const nextStatus = dependencyRecords.every((dependency) => dependency.status === "completed") ? "queued" : "waiting_inputs";
                if (nextStatus !== record.status) {
                    this.transition(record, nextStatus);
                    changed = true;
                }
            }
        }
    }

    private transition(record: MutableNodeRecord<TArtifact>, status: WorkflowNodeStatus) {
        if (record.status === status) return;
        const previousStatus = record.status;
        record.status = status;
        this.emit({
            type: "node_status_changed",
            nodeId: record.nodeId,
            previousStatus,
            status,
            attempt: record.attempt,
            error: record.error,
        });
    }

    private dependenciesComplete(nodeId: string) {
        return this.incomingByNodeId.get(nodeId)!.every((dependencyId) => this.records.get(dependencyId)!.status === "completed");
    }

    private dependenciesCompleteOutside(nodeId: string, resetNodeIds: Set<string>) {
        return this.incomingByNodeId.get(nodeId)!.every((dependencyId) => !resetNodeIds.has(dependencyId) && this.records.get(dependencyId)!.status === "completed");
    }

    private collectDescendants(nodeId: string) {
        const collected = new Set<string>([nodeId]);
        const queue = [nodeId];
        while (queue.length > 0) {
            const current = queue.shift()!;
            for (const childId of this.outgoingByNodeId.get(current)!) {
                if (collected.has(childId)) continue;
                collected.add(childId);
                queue.push(childId);
            }
        }
        return collected;
    }

    private getRecord(nodeId: string) {
        const record = this.records.get(nodeId);
        if (!record) throw new Error(`Unknown workflow node: ${nodeId}`);
        return record;
    }

    private emit(event: WorkflowEventPayload<TArtifact>) {
        const completedEvent = {
            ...event,
            runId: this.runId,
            sequence: ++this.eventSequence,
            timestamp: this.now(),
        } as WorkflowExecutionEvent<TArtifact>;
        for (const listener of this.listeners) {
            try {
                listener(completedEvent);
            } catch {
                // A broken observer must never interrupt provider work or DAG scheduling.
            }
        }
    }
}

export function createWorkflowExecution<TArtifact = unknown, TNodeData = unknown>(options: WorkflowExecutionOptions<TArtifact, TNodeData>) {
    return new WorkflowExecution(options);
}

function validateGraph<TNodeData>(graph: WorkflowExecutionGraph<TNodeData>) {
    const nodeIds = new Set<string>();
    for (const node of graph.nodes) {
        if (!node.id.trim()) throw new WorkflowGraphError("Workflow node IDs cannot be empty");
        if (nodeIds.has(node.id)) throw new WorkflowGraphError(`Duplicate workflow node: ${node.id}`);
        nodeIds.add(node.id);
    }
    for (const edge of graph.edges) {
        if (!nodeIds.has(edge.fromNodeId)) throw new WorkflowGraphError(`Unknown source node: ${edge.fromNodeId}`);
        if (!nodeIds.has(edge.toNodeId)) throw new WorkflowGraphError(`Unknown target node: ${edge.toNodeId}`);
        if (edge.fromNodeId === edge.toNodeId) throw new WorkflowGraphError(`Workflow node cannot depend on itself: ${edge.fromNodeId}`);
    }

    const indegree = new Map(Array.from(nodeIds, (id) => [id, 0]));
    const outgoing = new Map(Array.from(nodeIds, (id) => [id, new Set<string>()]));
    for (const edge of graph.edges) {
        const targets = outgoing.get(edge.fromNodeId)!;
        if (targets.has(edge.toNodeId)) continue;
        targets.add(edge.toNodeId);
        indegree.set(edge.toNodeId, indegree.get(edge.toNodeId)! + 1);
    }
    const queue = Array.from(indegree, ([id, degree]) => (degree === 0 ? id : null)).filter((id): id is string => id !== null);
    let visited = 0;
    while (queue.length > 0) {
        const nodeId = queue.shift()!;
        visited += 1;
        for (const targetId of outgoing.get(nodeId)!) {
            const degree = indegree.get(targetId)! - 1;
            indegree.set(targetId, degree);
            if (degree === 0) queue.push(targetId);
        }
    }
    if (visited !== nodeIds.size) throw new WorkflowGraphError("Workflow graph must be acyclic");
}

function cloneRecord<TArtifact>(record: MutableNodeRecord<TArtifact>): WorkflowNodeRunRecord<TArtifact> {
    return {
        nodeId: record.nodeId,
        status: record.status,
        attempt: record.attempt,
        artifacts: [...record.artifacts],
        metadata: record.metadata,
        error: record.error ? { ...record.error } : undefined,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
    };
}

function normalizeError(error: unknown): WorkflowExecutionError {
    if (error instanceof Error) {
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return { message: error.message || "Workflow node failed", code };
    }
    if (typeof error === "string") return { message: error };
    return { message: "Workflow node failed" };
}

function normalizeProgress(progress: WorkflowNodeProgress): WorkflowNodeProgress {
    if (typeof progress.ratio !== "number") return progress;
    return { ...progress, ratio: Math.max(0, Math.min(1, progress.ratio)) };
}

function raceWithAbort<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
    if (signal.aborted) return Promise.reject(new WorkflowAbortError());
    return new Promise<T>((resolve, reject) => {
        const onAbort = () => reject(new WorkflowAbortError());
        signal.addEventListener("abort", onAbort, { once: true });
        promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
    });
}
