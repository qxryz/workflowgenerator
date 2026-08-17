import assert from "node:assert/strict";
import test from "node:test";

import { summarizeReleaseDownloads } from "../src/services/api/github-releases.ts";

test("release downloads count only manual installers and updater packages per version", () => {
    const stats = summarizeReleaseDownloads([
        {
            tag_name: "v0.2.0",
            assets: [
                { name: "WorkflowGenerator_0.2.0_aarch64.dmg", download_count: 21 },
                { name: "WorkflowGenerator_0.2.0_x64.dmg", download_count: 4 },
                { name: "WorkflowGenerator_0.2.0_aarch64.app.tar.gz", download_count: 9 },
                { name: "latest.json", download_count: 300 },
                { name: "WorkflowGenerator_0.2.0_aarch64.app.tar.gz.sig", download_count: 14 },
                { name: "SHA256SUMS", download_count: 7 },
            ],
        },
        {
            tag_name: "v0.3.0-dev.1",
            assets: [
                { name: "WorkflowGenerator_0.3.0-dev.1_aarch64.dmg", download_count: 2 },
                { name: "WorkflowGenerator_0.3.0-dev.1_aarch64.app.tar.gz", download_count: 1 },
            ],
        },
    ]);

    assert.deepEqual(stats["0.2.0"], { manualDownloads: 25, updateDownloads: 9, totalDownloads: 34 });
    assert.deepEqual(stats["0.3.0-dev.1"], { manualDownloads: 2, updateDownloads: 1, totalDownloads: 3 });
});

test("release download summaries ignore drafts and malformed counters", () => {
    const stats = summarizeReleaseDownloads([
        { tag_name: "v0.1.0", draft: true, assets: [{ name: "private.dmg", download_count: 99 }] },
        { tag_name: "not-a-version", assets: [{ name: "invalid.dmg", download_count: 99 }] },
        {
            tag_name: "v0.1.1",
            assets: [
                { name: "WorkflowGenerator.dmg", download_count: -1 },
                { name: "WorkflowGenerator.app.tar.gz", download_count: "12" },
            ],
        },
    ]);

    assert.deepEqual(stats, {
        "0.1.1": { manualDownloads: 0, updateDownloads: 0, totalDownloads: 0 },
    });
});
