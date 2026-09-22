export type ZodiacActiveOperation<TItem extends { id: string }> = {
    operationId: string;
    sessionId: string;
    workspaceId: string;
    ownedItemIds: Set<string>;
    items: TItem[];
};

export type ZodiacOperationRuntimeEvent<TItem extends { id: string }> = {
    type: "registered" | "updated" | "removed";
    operation: ZodiacActiveOperation<TItem>;
};

type RuntimeItem = { id: string };
type RuntimeOperation = ZodiacActiveOperation<RuntimeItem>;
type RuntimeListener = (event: ZodiacOperationRuntimeEvent<RuntimeItem>) => void;

class ZodiacOperationRuntime {
    private readonly operations = new Map<string, RuntimeOperation>();
    private readonly listeners = new Set<RuntimeListener>();
    private revision = 0;

    register<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>) {
        const key = zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId);
        const current = this.operations.get(key);
        if (current && current !== operation) return false;
        this.operations.set(key, operation);
        this.emit({ type: "registered", operation });
        return true;
    }

    updateItems<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>, items: TItem[]) {
        const key = zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId);
        // The operation owns its durable session snapshot even when it is a
        // synchronous rejection and therefore was never registered as active.
        operation.items = items;
        if (this.operations.get(key) !== operation) return false;
        this.emit({ type: "updated", operation });
        return true;
    }

    remove<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>) {
        const key = zodiacOperationRuntimeKey(operation.workspaceId, operation.sessionId, operation.operationId);
        if (this.operations.get(key) !== operation) return false;
        this.operations.delete(key);
        this.emit({ type: "removed", operation });
        return true;
    }

    get<TItem extends RuntimeItem>(workspaceId: string, sessionId: string, operationId: string) {
        return this.operations.get(zodiacOperationRuntimeKey(workspaceId, sessionId, operationId)) as ZodiacActiveOperation<TItem> | undefined;
    }

    list<TItem extends RuntimeItem>(workspaceId: string, sessionId?: string) {
        return Array.from(this.operations.values()).filter((operation) => (
            operation.workspaceId === workspaceId && (sessionId === undefined || operation.sessionId === sessionId)
        )) as ZodiacActiveOperation<TItem>[];
    }

    has(workspaceId: string, sessionId?: string) {
        return this.list(workspaceId, sessionId).length > 0;
    }

    subscribe(listener: RuntimeListener) {
        this.listeners.add(listener);
        return () => {
            this.listeners.delete(listener);
        };
    }

    getRevision() {
        return this.revision;
    }

    private emit(event: ZodiacOperationRuntimeEvent<RuntimeItem>) {
        this.revision += 1;
        this.listeners.forEach((listener) => listener(event));
    }
}

const operationRuntime = new ZodiacOperationRuntime();

export function zodiacOperationRuntimeKey(workspaceId: string, sessionId: string, operationId: string) {
    return JSON.stringify([workspaceId, sessionId, operationId]);
}

export function registerZodiacActiveOperation<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>) {
    return operationRuntime.register(operation);
}

export function updateZodiacActiveOperationItems<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>, items: TItem[]) {
    return operationRuntime.updateItems(operation, items);
}

export function removeZodiacActiveOperation<TItem extends RuntimeItem>(operation: ZodiacActiveOperation<TItem>) {
    return operationRuntime.remove(operation);
}

export function getZodiacActiveOperation<TItem extends RuntimeItem>(workspaceId: string, sessionId: string, operationId: string) {
    return operationRuntime.get<TItem>(workspaceId, sessionId, operationId);
}

export function listZodiacActiveOperations<TItem extends RuntimeItem>(workspaceId: string, sessionId?: string) {
    return operationRuntime.list<TItem>(workspaceId, sessionId);
}

export function hasZodiacActiveOperations(workspaceId: string, sessionId?: string) {
    return operationRuntime.has(workspaceId, sessionId);
}

export function subscribeZodiacOperationRuntime<TItem extends RuntimeItem>(listener: (event: ZodiacOperationRuntimeEvent<TItem>) => void) {
    return operationRuntime.subscribe(listener as RuntimeListener);
}

export function getZodiacOperationRuntimeRevision() {
    return operationRuntime.getRevision();
}

/** Merge only the tool/run records owned by a live operation into a reloaded session. */
export function mergeActiveOperationItems<TItem extends { id: string }>(
    sessionId: string,
    items: TItem[],
    operations: Iterable<ZodiacActiveOperation<TItem>>,
) {
    let merged = items;
    for (const operation of operations) {
        if (operation.sessionId !== sessionId) continue;
        const ownedItems = new Map(operation.items.filter((item) => operation.ownedItemIds.has(item.id)).map((item) => [item.id, item]));
        const seen = new Set<string>();
        merged = merged.map((item) => {
            const activeItem = ownedItems.get(item.id);
            if (!activeItem) return item;
            seen.add(item.id);
            return activeItem;
        });
        ownedItems.forEach((item, id) => {
            if (!seen.has(id)) merged = [...merged, item];
        });
    }
    return merged;
}

/** Merge live items captured while storage was loading without duplicating IDs. */
export function reconcileZodiacSessionItems<TItem extends { id: string }>(stored: TItem[], live: TItem[]) {
    if (!live.length) return stored;
    const liveById = new Map(live.map((item) => [item.id, item]));
    const seen = new Set<string>();
    const reconciled = stored.map((item) => {
        const current = liveById.get(item.id);
        seen.add(item.id);
        return current || item;
    });
    live.forEach((item) => {
        if (!seen.has(item.id)) reconciled.push(item);
    });
    return reconciled;
}
