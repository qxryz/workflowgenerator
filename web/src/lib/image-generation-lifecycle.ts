export type GenerationIdentity = {
    batchId: string;
    slotIds: string[];
};

export type GenerationLogOwnerProbe = { kind: "known"; exists: boolean; discarded: boolean; storageKeys: string[] } | { kind: "unknown" };

export type GenerationLogMediaResolution = {
    owner: GenerationLogOwnerProbe;
    rollbackSucceeded: boolean;
};

type GenerationLogVisibility = { id?: string; discarded?: boolean };

export class GenerationLogVisibilityRegistry {
    private suppressedLogIds = new Set<string>();
    private listeners = new Set<(logId: string) => void>();

    suppress(logId: string) {
        if (this.suppressedLogIds.has(logId)) return;
        this.suppressedLogIds.add(logId);
        this.listeners.forEach((listener) => listener(logId));
    }

    shouldDisplay(log: GenerationLogVisibility) {
        return shouldDisplayGenerationLog(log, this.suppressedLogIds);
    }

    filter<T extends GenerationLogVisibility>(logs: T[]) {
        return logs.filter((log) => this.shouldDisplay(log));
    }

    subscribe(listener: (logId: string) => void) {
        this.listeners.add(listener);
        return () => this.listeners.delete(listener);
    }
}

// A renderer can briefly contain both the outgoing and incoming ImagePage
// during navigation. Keeping cancellation visibility at module scope prevents
// a late read from either instance from reviving the cancelled log.
export const generationLogVisibility = new GenerationLogVisibilityRegistry();

export class StaleGenerationError extends Error {
    constructor() {
        super("生图任务已失效");
        this.name = "StaleGenerationError";
    }
}

export function createGenerationIdentity(count: number, createId: () => string): GenerationIdentity {
    return {
        batchId: createId(),
        slotIds: Array.from({ length: Math.max(0, count) }, () => createId()),
    };
}

export function isGenerationIdentityCurrent(activeBatchId: string | undefined, batchId: string, aborted = false) {
    return !aborted && activeBatchId === batchId;
}

export async function awaitForCurrentGeneration<T>(operation: () => Promise<T>, isCurrent: () => boolean) {
    if (!isCurrent()) throw new StaleGenerationError();
    const value = await operation();
    if (!isCurrent()) throw new StaleGenerationError();
    return value;
}

export function consumePendingGenerationIntent<T extends { id: string }>(pending: T | null, intentId: string) {
    return pending?.id === intentId ? pending : null;
}

export function shouldInvalidateGenerationLifecycle(currentEpoch: number, cleanupEpoch: number) {
    return currentEpoch === cleanupEpoch;
}

export function resolveGenerationMediaAction(storageKey: string, resolution: GenerationLogMediaResolution): "publish" | "discard" {
    if (resolution.rollbackSucceeded) return "discard";
    if (resolution.owner.kind === "unknown") return "publish";
    return resolution.owner.storageKeys.includes(storageKey) ? "publish" : "discard";
}

export async function reconcileCancelledGenerationLog({
    probe,
    writeTombstone,
    remove,
    cause,
}: {
    probe: () => Promise<GenerationLogOwnerProbe>;
    writeTombstone: () => Promise<unknown>;
    remove: () => Promise<unknown>;
    cause?: unknown;
}): Promise<{ media: GenerationLogMediaResolution; error?: unknown }> {
    const ownerBeforeRollback = await probe();
    if (ownerBeforeRollback.kind === "known" && !ownerBeforeRollback.exists) {
        return { media: { owner: ownerBeforeRollback, rollbackSucceeded: false }, error: cause };
    }

    try {
        await writeTombstone();
    } catch {
        // The primary desktop write can succeed even when its migration marker
        // fails. The raw probes below determine the durable state.
    }

    try {
        await remove();
        return {
            media: {
                owner: { kind: "known", exists: false, discarded: false, storageKeys: [] },
                rollbackSucceeded: true,
            },
            error: cause,
        };
    } catch (rollbackError) {
        let ownerAfterRollback = await probe();
        if (ownerAfterRollback.kind === "known" && ownerAfterRollback.exists && !ownerAfterRollback.discarded) {
            try {
                await writeTombstone();
            } catch {
                // A final probe decides whether the owner is hidden or unknown.
            }
            ownerAfterRollback = await probe();
        }
        return {
            media: { owner: ownerAfterRollback, rollbackSucceeded: false },
            error: cause || rollbackError,
        };
    }
}

export function shouldDisplayGenerationLog(log: { id?: string; discarded?: boolean }, suppressedLogIds: ReadonlySet<string>) {
    return !log.discarded && (!log.id || !suppressedLogIds.has(log.id));
}

export function updateStableGenerationSlot<T extends { id: string }>(items: T[], slotId: string, next: Partial<T>) {
    const index = items.findIndex((item) => item.id === slotId);
    if (index < 0) return items;
    return items.map((item, itemIndex) => (itemIndex === index ? { ...item, ...next } : item));
}

export function resolveGenerationAppendLogId(requestedLogId?: string, previewLogId?: string, resultLogIds: Array<string | undefined> = []) {
    return requestedLogId || previewLogId || resultLogIds.find(Boolean);
}

export function mergeRetriedGenerationLog<
    TImage extends { dataUrl: string },
    TLog extends {
        durationMs: number;
        successCount: number;
        failCount: number;
        status: "成功" | "失败";
        images: TImage[];
        thumbnails: string[];
    },
>(log: TLog, image: TImage, retryDurationMs: number): TLog {
    const images = [...log.images, image];
    return {
        ...log,
        durationMs: log.durationMs + Math.max(0, retryDurationMs),
        successCount: log.successCount + 1,
        failCount: Math.max(0, log.failCount - 1),
        status: "成功",
        images,
        thumbnails: images.map((item) => item.dataUrl).filter(Boolean),
    };
}
