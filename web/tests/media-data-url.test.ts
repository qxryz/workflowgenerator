import assert from "node:assert/strict";
import test from "node:test";

import { dataUrlToBlob, mediaInputToBlob, normalizeImageBlob } from "../src/lib/media-mime.ts";

test("data image URLs decode without a WebView fetch", async () => {
    const previousFetch = globalThis.fetch;
    let normalized: Blob;
    try {
        globalThis.fetch = async () => {
            throw new Error("data URL must not use fetch");
        };
        normalized = await normalizeImageBlob(await mediaInputToBlob("data:image/png;base64,iVBORw0KGgo="));
    } finally {
        globalThis.fetch = previousFetch;
    }

    assert.equal(normalized.type, "image/png");
    assert.equal(normalized.size, 8);
    assert.deepEqual(Array.from(new Uint8Array(await normalized.arrayBuffer())), [137, 80, 78, 71, 13, 10, 26, 10]);
});

test("percent-encoded data URLs keep their declared media type", async () => {
    const blob = dataUrlToBlob("data:image/svg+xml,%3Csvg%3E%3C%2Fsvg%3E");

    assert.equal(blob.type, "image/svg+xml");
    assert.equal(await blob.text(), "<svg></svg>");
});
