export type TraceInterval = { id: string; start: number; end?: number; lane?: string };

/** A chronological strip: brief events stay clickable and long waits are bounded. */
export function layoutTraceTimeline(intervals: TraceInterval[], viewportWidth: number, zoom: number, laneOrder: string[] = ["zodiac"]) {
    const ordered = intervals.filter((entry) => Number.isFinite(entry.start)).toSorted((a, b) => a.start - b.start);
    const start = ordered[0]?.start ?? 0;
    const end = ordered.reduce((last, entry) => Math.max(last, entry.start, Number.isFinite(entry.end) ? entry.end! : entry.start), start);
    const ticks: { at: number; x: number }[] = [];
    const lanes = [...new Set([...laneOrder, ...ordered.map((entry) => entry.lane || "zodiac")])];
    let cursor = 8;
    const bars = ordered.map((entry) => {
        const duration = Number.isFinite(entry.end) ? Math.max(0, entry.end! - entry.start) : 0;
        // Deliberately cap duration width so one long thought cannot consume the strip.
        // Timestamps and exact durations remain available on each record.
        const width = Math.max(18, Math.min(180, 28 + Math.log1p(duration / 1000) * 16) * zoom);
        const bar = { id: entry.id, x: cursor, width, lane: lanes.indexOf(entry.lane || "zodiac") };
        if (!ticks.length || cursor - ticks[ticks.length - 1].x >= 120) ticks.push({ at: entry.start, x: cursor });
        cursor += width;
        return bar;
    });
    return { start, end, width: Math.max(viewportWidth, cursor + 12), height: 24 + lanes.length * 10, lanes, bars, ticks };
}
