import test from "node:test";
import assert from "node:assert/strict";

import { shouldRefreshStoredAssetCover } from "../src/lib/asset-media.ts";

test("refreshes persisted local image cover URLs from their storage key", () => {
    assert.equal(shouldRefreshStoredAssetCover("wg-media://localhost/images/old-version", "wg-media://localhost/images/old-version"), true);
    assert.equal(shouldRefreshStoredAssetCover("blob:old-renderer", "blob:old-renderer"), true);
    assert.equal(shouldRefreshStoredAssetCover("data:image/png;base64,old", "data:image/png;base64,old"), true);
});

test("keeps a custom remote cover that is separate from the stored image", () => {
    assert.equal(shouldRefreshStoredAssetCover("https://example.com/custom-cover.jpg", "wg-media://localhost/images/version"), false);
});
