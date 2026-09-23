import assert from "node:assert/strict";
import test from "node:test";
import { tokenTotals, cacheHitPercent, compactTokens } from "../src/lib/agent/zodiac-trace-usage.ts";

test("usage sums disjoint cache buckets and includes reasoning in output", () => {
    const tokens = { input: 100, cacheRead: 700, cacheWrite: 200, output: 60, reasoning: 40 };
    assert.deepEqual(tokenTotals(tokens), { input: 1000, output: 100, total: 1100 });
    assert.equal(cacheHitPercent(tokens), "70");
});

test("missing measurements remain unknown, zero is valid, partial hits never read 100%", () => {
    const zero = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0, reasoning: 0 };
    assert.deepEqual(tokenTotals(zero), { input: 0, output: 0, total: 0 });
    assert.equal(cacheHitPercent(zero), null);
    assert.equal(tokenTotals({ ...zero, input: null }).total, null);
    assert.equal(cacheHitPercent({ ...zero, input: 1, cacheRead: 99999 }), ">99.9");
    assert.equal(cacheHitPercent({ ...zero, cacheRead: 99999 }), "100");
    assert.equal(compactTokens(null), "—");
    assert.equal(compactTokens(0), "0");
    assert.equal(compactTokens(12500), "12.5K");
    assert.equal(compactTokens(1250000), "1.25M");
});
