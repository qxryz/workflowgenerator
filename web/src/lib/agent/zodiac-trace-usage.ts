export type TraceTokens = {
    input: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    output: number | null;
    reasoning: number | null;
};

export type TraceUsage = {
    requests: number;
    unreported: number;
    pending: number;
    tokens: TraceTokens;
};

export function tokenTotals(tokens: TraceTokens) {
    const sum = (values: (number | null)[]) => (values.every((value) => value != null) ? values.reduce<number>((total, value) => total + (value ?? 0), 0) : null);
    const input = sum([tokens.input, tokens.cacheRead, tokens.cacheWrite]);
    const output = sum([tokens.output, tokens.reasoning]);
    return { input, output, total: sum([input, output]) };
}

export function compactTokens(value: number | null) {
    if (value == null) return "—";
    if (value >= 1_000_000) return `${+(value / 1_000_000).toFixed(2)}M`;
    if (value >= 1_000) return `${+(value / 1_000).toFixed(1)}K`;
    return String(value);
}

export function cacheHitPercent(tokens: TraceTokens) {
    const { input } = tokenTotals(tokens);
    if (!input || tokens.cacheRead == null) return null;
    const ratio = (tokens.cacheRead / input) * 100;
    // A partial cache hit must never round up to a full hit.
    return ratio === 100 ? "100" : ratio > 99.9 ? ">99.9" : String(Math.round(ratio * 10) / 10);
}
