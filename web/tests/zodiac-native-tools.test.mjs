import assert from "node:assert/strict";
import test from "node:test";

import { readZodicProviderReply } from "../src/services/api/zodic.ts";

test("Zodiac SSE stops at DONE even when the provider keeps the socket open", async () => {
    let cancelled = false;
    let reads = 0;
    const encoder = new TextEncoder();
    const body = new ReadableStream({
        pull(controller) {
            reads += 1;
            if (reads === 1) controller.enqueue(encoder.encode('data: {"value":1}\n\ndata: [DONE]\n\n'));
            // Deliberately leave the stream open after [DONE].
        },
        cancel() {
            cancelled = true;
        },
    });
    const values = [];
    await readZodicProviderReply(new Response(body, { headers: { "content-type": "text/event-stream" } }), (payload) => values.push(payload));
    assert.deepEqual(values, [{ value: 1 }]);
    assert.equal(cancelled, true);
    assert.equal(reads, 1);
});
