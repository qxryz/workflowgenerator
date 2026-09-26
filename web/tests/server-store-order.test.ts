import assert from "node:assert/strict";
import test from "node:test";

import { flushPendingWrites, setStoredValue } from "../src/services/server-storage.ts";

test("consecutive skill store saves reach the server in selection order", async () => {
    const originalFetch = globalThis.fetch;
    const received: string[] = [];
    let releaseFirst: (() => void) | undefined;
    let firstStarted: (() => void) | undefined;
    const started = new Promise<void>((resolve) => { firstStarted = resolve; });
    globalThis.fetch = async (_input, init) => {
        const value = JSON.parse(String(init?.body)).value as string;
        received.push(value);
        if (value === "first") {
            firstStarted?.();
            await new Promise<void>((resolve) => { releaseFirst = resolve; });
        }
        return { ok: true, status: 204 } as Response;
    };
    let first: Promise<void> | undefined;
    let second: Promise<void> | undefined;
    try {
        first = setStoredValue("zustand-v1", "workflowgenerator:skills-v1", "first");
        second = setStoredValue("zustand-v1", "workflowgenerator:skills-v1", "second");
        await started;
        assert.deepEqual(received, ["first"]);
        releaseFirst?.();
        await Promise.all([first, second, flushPendingWrites()]);
        assert.deepEqual(received, ["first", "second"]);
    } finally {
        releaseFirst?.();
        await Promise.allSettled([first, second].filter((write): write is Promise<void> => Boolean(write)));
        globalThis.fetch = originalFetch;
    }
});
