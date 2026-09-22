export type VideoGenerationRunMode = "foreground" | "background";

export type PendingVideoGenerationIntent = {
    id: string;
    taskId?: string;
};

export type VideoCancellationJournalEntry = {
    reason: string;
    createdAt: number;
    hidden?: boolean;
};

export type VideoGenerationRun = Readonly<{
    runId: string;
    jobId: string;
    mode: VideoGenerationRunMode;
    agentTaskId?: string;
    controller: AbortController;
}>;

type StartVideoGenerationRunOptions = {
    runId: string;
    jobId: string;
    mode: VideoGenerationRunMode;
    agentTaskId?: string;
};

export function consumePendingVideoGenerationIntent<T extends { id: string }>(pending: T | null, intentId: string) {
    return pending?.id === intentId ? pending : null;
}

export function shouldInvalidateVideoGenerationLifecycle(currentEpoch: number, cleanupEpoch: number) {
    return currentEpoch === cleanupEpoch;
}

export function shouldRetainUploadedVideo(outcome: "committed" | "stale-removed" | "uncertain") {
    return outcome !== "stale-removed";
}

export function mergeVideoCancellationJournalEntry(current: VideoCancellationJournalEntry | undefined, incoming: VideoCancellationJournalEntry): VideoCancellationJournalEntry {
    const hidden = Boolean(current?.hidden || incoming.hidden);
    return {
        reason: current?.hidden ? current.reason : incoming.reason,
        createdAt: Math.max(current?.createdAt || 0, incoming.createdAt),
        hidden,
    };
}

export async function retryAsyncOperation<T>(operation: () => Promise<T>, attempts = 3, onRetry?: (attempt: number) => Promise<void>): Promise<T> {
    for (let attempt = 0; attempt < attempts; attempt += 1) {
        try {
            return await operation();
        } catch (error) {
            if (attempt === attempts - 1) throw error;
            await onRetry?.(attempt);
        }
    }
    throw new Error("Async operation failed");
}

export class KeyedAsyncQueue {
    private readonly tails = new Map<string, Promise<void>>();

    run<T>(key: string, operation: () => Promise<T>): Promise<T> {
        const previous = this.tails.get(key) || Promise.resolve();
        const result = previous.catch(() => undefined).then(operation);
        const tail = result.then(
            () => undefined,
            () => undefined,
        );
        this.tails.set(key, tail);
        return result.finally(() => {
            if (this.tails.get(key) === tail) this.tails.delete(key);
        });
    }
}

export class AsyncRevisionClock {
    private revision = 0;
    private readonly listeners = new Set<() => void>();

    snapshot() {
        return this.revision;
    }

    isCurrent(snapshot: number) {
        return snapshot === this.revision;
    }

    bump() {
        this.revision += 1;
        for (const listener of this.listeners) {
            try {
                listener();
            } catch {
                // One unmounted consumer must not prevent the other pages from
                // observing a repository mutation.
            }
        }
        return this.revision;
    }

    subscribe(listener: () => void) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }
}

export class VideoGenerationLogVisibility {
    private readonly hiddenJobIds = new Set<string>();
    private readonly retiredJobIds = new Set<string>();
    private readonly retirementReasons = new Map<string, string>();

    retire(jobId: string, reason = "视频任务已取消") {
        this.retiredJobIds.add(jobId);
        this.retirementReasons.set(jobId, reason);
    }

    hide(jobId: string) {
        this.retire(jobId, "视频生成记录已删除");
        this.hiddenJobIds.add(jobId);
    }

    isVisible(jobId: string) {
        return !this.hiddenJobIds.has(jobId);
    }

    canResume(jobId: string) {
        return !this.retiredJobIds.has(jobId);
    }

    revive(jobId: string) {
        if (this.hiddenJobIds.has(jobId)) return false;
        this.retiredJobIds.delete(jobId);
        this.retirementReasons.delete(jobId);
        return true;
    }

    retirementReason(jobId: string) {
        return this.retirementReasons.get(jobId);
    }
}

export const videoGenerationLogMutationQueue = new KeyedAsyncQueue();
export const videoGenerationLogRevision = new AsyncRevisionClock();
export const videoGenerationLogVisibility = new VideoGenerationLogVisibility();

export function markStaleVideoLogCancelled<T extends object>(log: T) {
    return {
        ...log,
        status: "失败" as const,
        task: undefined,
        video: undefined,
        error: "视频任务已取消",
    };
}

export function markVideoLogDeleted<T extends object>(log: T) {
    return {
        ...markStaleVideoLogCancelled(log),
        deletedAt: Date.now(),
        error: "视频生成记录已删除",
    };
}

/**
 * Owns the lifecycle of video requests and polling loops.
 *
 * A job identifies a persisted generation attempt. A run identifies one local
 * request/polling lifecycle for that job. Comparing both prevents a late
 * completion from a cancelled run from mutating a replacement run.
 */
export class VideoGenerationRunRegistry {
    private readonly runs = new Map<string, VideoGenerationRun>();
    private readonly runIdsByJob = new Map<string, string>();
    private readonly retiredJobIds = new Set<string>();
    private foregroundRunId: string | null = null;

    start(options: StartVideoGenerationRunOptions): VideoGenerationRun | null {
        if (this.retiredJobIds.has(options.jobId) || this.runIdsByJob.has(options.jobId)) return null;

        if (options.mode === "foreground") this.cancelForeground();

        const run: VideoGenerationRun = {
            ...options,
            controller: new AbortController(),
        };
        this.runs.set(run.runId, run);
        this.runIdsByJob.set(run.jobId, run.runId);
        if (run.mode === "foreground") this.foregroundRunId = run.runId;
        return run;
    }

    isActive(run: VideoGenerationRun) {
        return this.runs.get(run.runId) === run && this.runIdsByJob.get(run.jobId) === run.runId && !run.controller.signal.aborted;
    }

    isForeground(run: VideoGenerationRun) {
        return this.isActive(run) && this.foregroundRunId === run.runId;
    }

    foregroundJobId() {
        if (!this.foregroundRunId) return undefined;
        return this.runs.get(this.foregroundRunId)?.jobId;
    }

    foregroundRun() {
        if (!this.foregroundRunId) return undefined;
        return this.runs.get(this.foregroundRunId);
    }

    hasJob(jobId: string) {
        return this.runIdsByJob.has(jobId);
    }

    isRetired(jobId: string) {
        return this.retiredJobIds.has(jobId);
    }

    runIfActive(run: VideoGenerationRun, effect: () => void) {
        if (!this.isActive(run)) return false;
        effect();
        return true;
    }

    runIfForeground(run: VideoGenerationRun, effect: () => void) {
        if (!this.isForeground(run)) return false;
        effect();
        return true;
    }

    finish(run: VideoGenerationRun) {
        if (this.runs.get(run.runId) !== run) return;
        this.runs.delete(run.runId);
        if (this.runIdsByJob.get(run.jobId) === run.runId) this.runIdsByJob.delete(run.jobId);
        if (this.foregroundRunId === run.runId) this.foregroundRunId = null;
    }

    cancel(run: VideoGenerationRun) {
        if (this.runs.get(run.runId) !== run) return false;
        run.controller.abort();
        this.finish(run);
        return true;
    }

    cancelForeground() {
        if (!this.foregroundRunId) return [];
        const run = this.runs.get(this.foregroundRunId);
        return run && this.cancel(run) ? [run] : [];
    }

    cancelJob(jobId: string) {
        const runId = this.runIdsByJob.get(jobId);
        if (!runId) return [];
        const run = this.runs.get(runId);
        return run && this.cancel(run) ? [run] : [];
    }

    retireJob(jobId: string) {
        this.retiredJobIds.add(jobId);
        return this.cancelJob(jobId);
    }

    cancelAll() {
        const runs = [...this.runs.values()];
        for (const run of runs) this.cancel(run);
        return runs;
    }
}
