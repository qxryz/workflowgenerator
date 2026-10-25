/**
 * Runs `jobs` with at most `concurrency` in flight, starting them in order. Resolves with one settled
 * result per job (same order). After `signal` aborts nothing new starts; skipped jobs settle as AbortError.
 */
export async function runQueue(jobs: ReadonlyArray<() => Promise<unknown>>, concurrency = 2, signal?: AbortSignal): Promise<PromiseSettledResult<unknown>[]> {
    const results = new Array<PromiseSettledResult<unknown>>(jobs.length);
    let next = 0;
    const worker = async () => {
        while (next < jobs.length) {
            const index = next++;
            if (signal?.aborted) {
                results[index] = { status: "rejected", reason: new DOMException("Aborted", "AbortError") };
                continue;
            }
            try {
                results[index] = { status: "fulfilled", value: await jobs[index]() };
            } catch (reason) {
                results[index] = { status: "rejected", reason };
            }
        }
    };
    await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, jobs.length)) }, worker));
    return results;
}
