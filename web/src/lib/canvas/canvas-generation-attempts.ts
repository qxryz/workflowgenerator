export type CanvasGenerationProjectBoundary = Readonly<{
    projectId: string;
    restoreEpoch: number;
}>;

export type CanvasGenerationAttempt = Readonly<{
    token: string;
    controller: AbortController;
}> &
    CanvasGenerationProjectBoundary;

export type CanvasGenerationRequest = Readonly<{
    targetNodeId: string;
    originNodeId: string;
    runningNodeId: string;
    attempt: CanvasGenerationAttempt;
}> &
    CanvasGenerationProjectBoundary;

export type CanvasGenerationRequestLease = Readonly<{
    targetNodeId: string;
    attempt: CanvasGenerationAttempt;
}>;

export type CanvasGenerationRequestRegistry = Map<string, CanvasGenerationRequest>;

let attemptSequence = 0;

export function createCanvasGenerationAttempt(boundary: CanvasGenerationProjectBoundary, controller = new AbortController()): CanvasGenerationAttempt {
    attemptSequence += 1;
    return Object.freeze({ token: `canvas-generation-${attemptSequence}`, controller, ...boundary });
}

function isCanvasGenerationAttemptInBoundary(attempt: CanvasGenerationAttempt, boundary: CanvasGenerationProjectBoundary | null) {
    return Boolean(boundary && attempt.projectId === boundary.projectId && attempt.restoreEpoch === boundary.restoreEpoch);
}

export function claimCanvasGenerationRequest(registry: CanvasGenerationRequestRegistry, request: Omit<CanvasGenerationRequest, "attempt"> & { attempt?: CanvasGenerationAttempt }): CanvasGenerationRequestLease {
    const boundary = { projectId: request.projectId, restoreEpoch: request.restoreEpoch };
    const attempt = request.attempt || createCanvasGenerationAttempt(boundary);
    if (!isCanvasGenerationAttemptInBoundary(attempt, boundary)) throw canvasGenerationAttemptExpiredError();
    const previous = registry.get(request.targetNodeId);
    if (previous && previous.attempt.token !== attempt.token) previous.attempt.controller.abort();
    registry.set(request.targetNodeId, { ...request, attempt });
    return Object.freeze({ targetNodeId: request.targetNodeId, attempt });
}

export function isCanvasGenerationRequestCurrent(registry: CanvasGenerationRequestRegistry, lease: CanvasGenerationRequestLease, boundary: CanvasGenerationProjectBoundary | null) {
    const current = registry.get(lease.targetNodeId);
    return isCanvasGenerationAttemptInBoundary(lease.attempt, boundary) && current?.attempt.token === lease.attempt.token && !lease.attempt.controller.signal.aborted;
}

export function isCanvasGenerationRequestSuperseded(registry: CanvasGenerationRequestRegistry, lease: CanvasGenerationRequestLease, boundary: CanvasGenerationProjectBoundary | null) {
    if (!isCanvasGenerationAttemptInBoundary(lease.attempt, boundary)) return true;
    const current = registry.get(lease.targetNodeId);
    return Boolean(current && current.attempt.token !== lease.attempt.token);
}

export function areCanvasGenerationRequestsCurrent(registry: CanvasGenerationRequestRegistry, leases: readonly CanvasGenerationRequestLease[], boundary: CanvasGenerationProjectBoundary | null) {
    return leases.length > 0 && leases.every((lease) => isCanvasGenerationRequestCurrent(registry, lease, boundary));
}

export function assertCanvasGenerationRequestsCurrent(registry: CanvasGenerationRequestRegistry, leases: readonly CanvasGenerationRequestLease[], boundary: CanvasGenerationProjectBoundary | null) {
    if (!areCanvasGenerationRequestsCurrent(registry, leases, boundary)) throw canvasGenerationAttemptExpiredError();
}

export function finishCanvasGenerationRequest(registry: CanvasGenerationRequestRegistry, lease: CanvasGenerationRequestLease) {
    if (registry.get(lease.targetNodeId)?.attempt.token !== lease.attempt.token) return false;
    registry.delete(lease.targetNodeId);
    return true;
}

export function cancelCanvasGenerationRequestsByRunningId(registry: CanvasGenerationRequestRegistry, runningNodeId: string) {
    const affectedNodeIds = new Set<string>();
    const attempts = new Map<string, CanvasGenerationAttempt>();
    registry.forEach((request) => {
        if (request.runningNodeId !== runningNodeId) return;
        attempts.set(request.attempt.token, request.attempt);
        registry.delete(request.targetNodeId);
        affectedNodeIds.add(request.targetNodeId);
        affectedNodeIds.add(request.originNodeId);
    });
    attempts.forEach((attempt) => attempt.controller.abort());
    return affectedNodeIds;
}

export function hasCanvasGenerationRequestForRunningId(registry: CanvasGenerationRequestRegistry, runningNodeId: string) {
    return Array.from(registry.values()).some((request) => request.runningNodeId === runningNodeId);
}

/**
 * An upload is provisional until its owning attempt is still current. A late
 * provider result is discarded before callers can mirror it into canvas state.
 */
export async function retainOwnedCanvasGenerationUpload<T>(
    registry: CanvasGenerationRequestRegistry,
    leases: readonly CanvasGenerationRequestLease[],
    boundary: CanvasGenerationProjectBoundary | null,
    upload: T,
    discard: (upload: T) => Promise<unknown> | unknown,
) {
    if (areCanvasGenerationRequestsCurrent(registry, leases, boundary)) return upload;
    try {
        await discardCanvasGenerationUpload(upload, discard);
    } catch (cause) {
        const error = canvasGenerationAttemptExpiredError();
        error.cause = cause;
        throw error;
    }
    throw canvasGenerationAttemptExpiredError();
}

export async function discardCanvasGenerationUpload<T>(upload: T, discard: (upload: T) => Promise<unknown> | unknown, retryCount = 2) {
    let lastError: unknown;
    for (let attempt = 0; attempt <= retryCount; attempt += 1) {
        try {
            await discard(upload);
            return;
        } catch (error) {
            lastError = error;
            if (attempt < retryCount) await Promise.resolve();
        }
    }
    throw lastError;
}

export function canvasGenerationAttemptExpiredError() {
    const error = new Error("生成请求已被更新的任务替代");
    error.name = "AbortError";
    return error;
}
