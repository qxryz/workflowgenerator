import assert from "node:assert/strict";
import test from "node:test";
import { layoutTraceTimeline } from "../src/lib/agent/zodiac-trace-layout.ts";

test("trace keeps dense and overlapping events independently clickable", () => {
    const entries = Array.from({ length: 130 }, (_, index) => ({ id: `${index}`, start: 1000 + index, end: index === 0 ? 600000 : undefined }));
    const layout = layoutTraceTimeline(entries, 900, 1);
    assert.equal(layout.bars.length, entries.length);
    assert.ok(layout.width > 900);
    for (const bar of layout.bars) {
        assert.ok(bar.width >= 18);
        assert.ok(bar.x + bar.width <= layout.width);
        for (const other of layout.bars) {
            if (other.id !== bar.id) assert.ok(other.x + 0.001 >= bar.x + bar.width || bar.x + 0.001 >= other.x + other.width);
        }
    }
});

test("zoom expands record spacing without changing identity or timestamps", () => {
    const entries = [
        { id: "long", start: 1000, end: 180000 },
        { id: "short", start: 90000, end: 92000 },
    ];
    const normal = layoutTraceTimeline(entries, 900, 1);
    const zoomed = layoutTraceTimeline(entries, 900, 4);
    assert.equal(zoomed.start, normal.start);
    assert.equal(zoomed.end, normal.end);
    assert.deepEqual(
        zoomed.bars.map((bar) => bar.id),
        normal.bars.map((bar) => bar.id),
    );
    assert.ok(zoomed.bars[1].x - 8 > (normal.bars[1].x - 8) * 3);
    assert.ok(normal.bars[0].width <= 180);
    assert.equal(normal.bars[1].x, normal.bars[0].x + normal.bars[0].width);
    assert.ok(zoomed.bars[0].width > normal.bars[0].width * 3);
});

test("trace handles empty, instantaneous and invalid intervals", () => {
    for (const entries of [
        [],
        [{ id: "one", start: 0 }],
        [
            { id: "one", start: 1, end: -5 },
            { id: "invalid", start: NaN },
        ],
    ]) {
        const layout = layoutTraceTimeline(entries, 600, 0.5);
        assert.ok(Number.isFinite(layout.width));
        assert.equal(layout.ticks.length > 0, layout.bars.length > 0);
        assert.ok(layout.bars.every((bar) => Number.isFinite(bar.x) && bar.width >= 18));
    }
});

test("multiple agents keep their own stable tracks as filtering or new records arrive", () => {
    const laneOrder = ["zodiac", "executor-a", "executor-b"];
    const entries = [
        { id: "one", start: 1, lane: "executor-b" },
        { id: "two", start: 2, lane: "executor-a" },
    ];
    const layout = layoutTraceTimeline(entries, 900, 1, laneOrder);
    assert.deepEqual(
        layout.bars.map((bar) => bar.lane),
        [2, 1],
    );
    assert.equal(layoutTraceTimeline([entries[1]], 900, 1, laneOrder).bars[0].lane, 1);
    assert.deepEqual(layoutTraceTimeline([...entries, { id: "new", start: 3, lane: "planner" }], 900, 1, laneOrder).lanes, [...laneOrder, "planner"]);
});
