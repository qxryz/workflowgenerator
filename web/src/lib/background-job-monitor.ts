/** Follow only jobs already submitted or observed by the user. No history
 * scan, provider request, or automatic resume is performed here. */
export function createBackgroundJobMonitor<Job extends { id: string }>(deps: {
    active: (job: Job) => boolean;
    read: (id: string) => Promise<Job>;
    changed: (job: Job | undefined, id: string) => void;
    unavailable: (job: Job | undefined, id: string) => void;
    removed: (error: unknown) => boolean;
    schedule?: (action: () => void, delay: number) => () => void;
}) {
    type Entry = { id: string; job?: Job; cancel?: () => void; failures: number };
    const entries = new Map<string, Entry>();
    const schedule = deps.schedule || ((action, delay) => { const timer = setTimeout(action, delay); return () => clearTimeout(timer); });
    function stop(id: string, job?: Job) {
        const entry = entries.get(id);
        if (!entry) return;
        entry?.cancel?.();
        entries.delete(id);
        deps.changed(job, id);
    }
    function poll(entry: Entry) {
        entry.cancel = schedule(() => {
            entry.cancel = undefined;
            void (async () => {
                try {
                    const job = await deps.read(entry.id);
                    if (entries.get(entry.id) !== entry) return;
                    if (job.id !== entry.id) throw new Error("Unexpected job identity");
                    if (!deps.active(job)) { stop(entry.id, job); return; }
                    entry.job = job;
                    entry.failures = 0;
                    deps.changed(job, entry.id);
                    poll(entry);
                } catch (error) {
                    if (entries.get(entry.id) !== entry) return;
                    if (deps.removed(error)) { stop(entry.id); return; }
                    entry.failures += 1;
                    deps.unavailable(entry.job, entry.id);
                    poll(entry);
                }
            })();
        }, Math.min(10_000, 1200 * 2 ** entry.failures));
    }
    return {
        observe(job: Job) {
            if (!deps.active(job)) { stop(job.id, job); return; }
            const existing = entries.get(job.id);
            if (existing) { existing.job = job; return; }
            const entry: Entry = { id: job.id, job, failures: 0 };
            entries.set(job.id, entry);
            deps.changed(job, job.id);
            poll(entry);
        },
        follow(id: string) {
            const existing = entries.get(id);
            if (existing) { deps.unavailable(existing.job, id); return; }
            const entry: Entry = { id, failures: 0 };
            entries.set(id, entry);
            deps.unavailable(undefined, id);
            poll(entry);
        },
        stop,
    };
}
