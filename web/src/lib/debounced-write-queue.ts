export type DebouncedWriteQueue<T> = {
    schedule: (value: T) => void;
    flush: () => Promise<void>;
    cancelPending: () => void;
    waitForIdle: () => Promise<void>;
};

/**
 * Coalesces nearby writes while still exposing a durable flush boundary.
 * A failed write remains observable to flush(), and a later value may recover
 * the queue by replacing it with the newest complete snapshot.
 */
export function createDebouncedWriteQueue<T>(write: (value: T) => Promise<void>, delayMs: number): DebouncedWriteQueue<T> {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let pendingValue: T | undefined;
    let hasPendingValue = false;
    let writeQueue: Promise<void> = Promise.resolve();

    const clearTimer = () => {
        if (timer === null) return;
        clearTimeout(timer);
        timer = null;
    };

    const commitPending = () => {
        clearTimer();
        if (!hasPendingValue) return writeQueue;

        const value = pendingValue as T;
        pendingValue = undefined;
        hasPendingValue = false;
        writeQueue = writeQueue.catch(() => undefined).then(() => write(value));
        // Timer-triggered writes have no direct caller. Keep their rejection on
        // writeQueue for the next flush while preventing an unhandled promise.
        void writeQueue.catch(() => undefined);
        return writeQueue;
    };

    return {
        schedule(value) {
            pendingValue = value;
            hasPendingValue = true;
            clearTimer();
            timer = setTimeout(() => {
                timer = null;
                void commitPending();
            }, delayMs);
        },
        flush: commitPending,
        cancelPending() {
            clearTimer();
            pendingValue = undefined;
            hasPendingValue = false;
        },
        waitForIdle: () => writeQueue,
    };
}
