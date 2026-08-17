import assert from "node:assert/strict";
import test from "node:test";

import {
    estimateZodiacConversationTokens,
    planZodiacContextCompaction,
    recentZodiacConversationItems,
    trimZodiacSessionItems,
    zodiacConversationAfterSummary,
} from "../src/lib/agent/zodiac-session-retention.ts";

test("persisted Zodiac sessions keep only their newest items", () => {
    const items = Array.from({ length: 8 }, (_, index) => ({ id: index }));
    assert.deepEqual(trimZodiacSessionItems(items, 3).map((item) => item.id), [5, 6, 7]);
});

test("model context keeps recent conversation messages and drops tool noise", () => {
    const items = [
        { id: "old-user", role: "user" },
        { id: "old-tool", role: "tool" },
        { id: "old-assistant", role: "assistant" },
        { id: "new-tool", role: "tool" },
        { id: "new-user", role: "user" },
        { id: "new-assistant", role: "assistant" },
    ];
    assert.deepEqual(recentZodiacConversationItems(items, 3).map((item) => item.id), ["old-assistant", "new-user", "new-assistant"]);
});

test("context compaction summarizes only old unsummarized conversation turns", () => {
    const items = [
        { id: "summarized", role: "assistant", text: "old" },
        { id: "tool", role: "tool", text: "noise" },
        ...Array.from({ length: 8 }, (_, index) => ({ id: `turn-${index}`, role: index % 2 ? "assistant" : "user", text: "long context" })),
    ];
    assert.deepEqual(zodiacConversationAfterSummary(items, "summarized").map((item) => item.id), items.slice(2).map((item) => item.id));
    const plan = planZodiacContextCompaction(items, "summarized", 1, 3);
    assert.deepEqual(plan?.items.map((item) => item.id), ["turn-0", "turn-1", "turn-2", "turn-3", "turn-4"]);
    assert.equal(plan?.throughId, "turn-4");
});

test("a trimmed summary marker does not reintroduce already summarized history", () => {
    const items = Array.from({ length: 20 }, (_, index) => ({ id: `turn-${index}`, role: index % 2 ? "assistant" : "user", text: "message" }));
    assert.deepEqual(
        zodiacConversationAfterSummary(items, "marker-already-trimmed").map((item) => item.id),
        items.slice(-12).map((item) => item.id),
    );
});

test("context estimation counts images and CJK content conservatively", () => {
    const plain = estimateZodiacConversationTokens([{ id: "plain", role: "user", text: "hello world" }]);
    const rich = estimateZodiacConversationTokens([{ id: "rich", role: "user", text: "你好世界", attachments: [{ url: "image" }] }]);
    assert.ok(rich > plain + 800);
});
