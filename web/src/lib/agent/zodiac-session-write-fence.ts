/**
 * In-memory ownership fence for the one active Zodiac session per workspace.
 * Async writes must re-check this fence when they reach the head of the save
 * queue, not when they are enqueued.
 */
export class ZodiacSessionWriteFence {
    private readonly activeSessionIds = new Map<string, string>();

    activate(workspaceId: string, sessionId: string) {
        this.activeSessionIds.set(workspaceId, sessionId);
    }

    claimOrMatches(workspaceId: string, sessionId: string) {
        const activeSessionId = this.activeSessionIds.get(workspaceId);
        if (activeSessionId === undefined) {
            this.activate(workspaceId, sessionId);
            return true;
        }
        return activeSessionId === sessionId;
    }

    matches(workspaceId: string, sessionId: string) {
        return this.activeSessionIds.get(workspaceId) === sessionId;
    }

    current(workspaceId: string) {
        return this.activeSessionIds.get(workspaceId);
    }
}

export const zodiacSessionWriteFence = new ZodiacSessionWriteFence();

export class ZodiacSessionWriteCoordinator {
    private readonly queues = new Map<string, Promise<unknown>>();
    private readonly fence: ZodiacSessionWriteFence;

    constructor(fence: ZodiacSessionWriteFence) {
        this.fence = fence;
    }

    enqueue(workspaceId: string, sessionId: string, write: () => void | Promise<void>) {
        const previous = this.queues.get(workspaceId) || Promise.resolve();
        const queued = previous.catch(() => undefined).then(async () => {
            if (!this.fence.claimOrMatches(workspaceId, sessionId)) return false;
            await write();
            return true;
        });
        this.queues.set(workspaceId, queued);
        return queued;
    }

    replace(workspaceId: string, replacementSessionId: string, remove: () => void | Promise<void>) {
        this.fence.activate(workspaceId, replacementSessionId);
        const previous = this.queues.get(workspaceId) || Promise.resolve();
        const queued = previous.catch(() => undefined).then(async () => {
            if (!this.fence.matches(workspaceId, replacementSessionId)) return false;
            await remove();
            return true;
        });
        this.queues.set(workspaceId, queued);
        return queued;
    }
}
