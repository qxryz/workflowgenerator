import { scanZodiacProviderToolCalls } from "./zodiac-provider-transport.js";

export type ZodiacDecisionOption = {
    id: string;
    label: string;
    description?: string;
};

export type ZodiacAssetDecisionOption = {
    nodeId: string;
    label: string;
    description?: string;
};

export type ZodiacSingleChoiceDecision = {
    id: string;
    type: "single_choice";
    question: string;
    options: ZodiacDecisionOption[];
    allowCustom?: boolean;
};

export type ZodiacMultiChoiceDecision = {
    id: string;
    type: "multi_choice";
    question: string;
    options: ZodiacDecisionOption[];
    allowCustom?: boolean;
};

export type ZodiacShortTextDecision = {
    id: string;
    type: "short_text";
    question: string;
    placeholder?: string;
    submitLabel?: string;
};

export type ZodiacAssetPickerDecision = {
    id: string;
    type: "asset_picker";
    question: string;
    options: ZodiacAssetDecisionOption[];
    multiple?: boolean;
};

export type ZodiacConfirmSummaryDecision = {
    id: string;
    type: "confirm_summary";
    question: string;
    summary: string[];
    confirmLabel?: string;
    cancelLabel?: string;
};

export type ZodiacDecisionUi =
    | ZodiacSingleChoiceDecision
    | ZodiacMultiChoiceDecision
    | ZodiacShortTextDecision
    | ZodiacAssetPickerDecision
    | ZodiacConfirmSummaryDecision;

export type ParsedZodiacDecisionPayload = {
    text: string;
    decision: ZodiacDecisionUi;
};

const DECISION_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,63}$/u;
const NODE_ID_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}._:-]{0,127}$/u;
const MAX_RAW_DECISION_BYTES = 32 * 1024;

/**
 * Parses exactly one complete `zodiac-ui` block. Multiple blocks are rejected
 * rather than guessed between, while user-visible copy is still protocol-free.
 */
export function extractZodiacDecisionPayload(reply: string): ParsedZodiacDecisionPayload | undefined {
    const scan = scanZodiacDecisionPayloads(reply);
    if (scan.unfinished || !scan.blocks.length) return undefined;
    const decisions = scan.blocks.map((block) => parseZodiacDecisionBody(block.body));
    if (decisions.some((decision) => !decision)) return undefined;
    const unique = new Map(decisions.map((decision) => [JSON.stringify(decision), decision as ZodiacDecisionUi]));
    if (unique.size !== 1) return undefined;
    return { decision: [...unique.values()][0], text: stripZodiacDecisionPayload(reply) };
}

/** Hides complete, invalid and unfinished explicit protocol blocks. */
export function stripZodiacDecisionPayload(reply: string) {
    const scan = scanZodiacDecisionPayloads(reply);
    return removeTextRanges(reply, scan.ranges).trim();
}

/** Detects only an explicit transport marker, never an ordinary mention of zodiac-ui. */
export function hasExplicitZodiacDecisionProtocol(reply: string) {
    return scanZodiacDecisionPayloads(reply).explicit;
}

/** Normalizes only the documented declarative UI schema. Unknown fields fail closed. */
export function normalizeZodiacDecisionUi(value: unknown): ZodiacDecisionUi | undefined {
    const record = asRecord(value);
    if (!record) return undefined;
    const id = boundedId(record.id, DECISION_ID_PATTERN);
    const type = boundedText(record.type, 32);
    const question = boundedText(record.question, 240);
    if (!id || !type || !question) return undefined;

    if (type === "single_choice" || type === "multi_choice") {
        const maximum = type === "single_choice" ? 4 : 6;
        if (!hasOnlyKeys(record, ["id", "type", "question", "options", "allowCustom"])) return undefined;
        if (record.allowCustom !== undefined && typeof record.allowCustom !== "boolean") return undefined;
        const options = normalizeChoiceOptions(record.options, type === "single_choice" ? 2 : 2, maximum);
        if (!options) return undefined;
        return {
            id,
            type,
            question,
            options,
            ...(record.allowCustom === true ? { allowCustom: true } : {}),
        };
    }

    if (type === "short_text") {
        if (!hasOnlyKeys(record, ["id", "type", "question", "placeholder", "submitLabel"])) return undefined;
        const placeholder = optionalBoundedText(record.placeholder, 120);
        const submitLabel = optionalBoundedText(record.submitLabel, 32);
        if (placeholder === INVALID_TEXT || submitLabel === INVALID_TEXT) return undefined;
        return {
            id,
            type,
            question,
            ...(typeof placeholder === "string" ? { placeholder } : {}),
            ...(typeof submitLabel === "string" ? { submitLabel } : {}),
        };
    }

    if (type === "asset_picker") {
        if (!hasOnlyKeys(record, ["id", "type", "question", "options", "multiple"])) return undefined;
        if (record.multiple !== undefined && typeof record.multiple !== "boolean") return undefined;
        const options = normalizeAssetOptions(record.options);
        if (!options) return undefined;
        return {
            id,
            type,
            question,
            options,
            ...(record.multiple === true ? { multiple: true } : {}),
        };
    }

    if (type === "confirm_summary") {
        if (!hasOnlyKeys(record, ["id", "type", "question", "summary", "confirmLabel", "cancelLabel"])) return undefined;
        const summary = normalizeSummary(record.summary);
        const confirmLabel = optionalBoundedText(record.confirmLabel, 32);
        const cancelLabel = optionalBoundedText(record.cancelLabel, 32);
        if (!summary || confirmLabel === INVALID_TEXT || cancelLabel === INVALID_TEXT) return undefined;
        return {
            id,
            type,
            question,
            summary,
            ...(typeof confirmLabel === "string" ? { confirmLabel } : {}),
            ...(typeof cancelLabel === "string" ? { cancelLabel } : {}),
        };
    }

    return undefined;
}

function normalizeChoiceOptions(value: unknown, minimum: number, maximum: number): ZodiacDecisionOption[] | undefined {
    if (!Array.isArray(value) || value.length < minimum || value.length > maximum) return undefined;
    const options: ZodiacDecisionOption[] = [];
    const ids = new Set<string>();
    for (const valueOption of value) {
        const option = asRecord(valueOption);
        if (!option || !hasOnlyKeys(option, ["id", "label", "description"])) return undefined;
        const id = boundedId(option.id, DECISION_ID_PATTERN);
        const label = boundedText(option.label, 80);
        const description = optionalBoundedText(option.description, 180);
        if (!id || !label || ids.has(id) || description === INVALID_TEXT) return undefined;
        ids.add(id);
        options.push({ id, label, ...(typeof description === "string" ? { description } : {}) });
    }
    return options;
}

function normalizeAssetOptions(value: unknown): ZodiacAssetDecisionOption[] | undefined {
    if (!Array.isArray(value) || value.length < 1 || value.length > 12) return undefined;
    const options: ZodiacAssetDecisionOption[] = [];
    const nodeIds = new Set<string>();
    for (const valueOption of value) {
        const option = asRecord(valueOption);
        if (!option || !hasOnlyKeys(option, ["nodeId", "label", "description"])) return undefined;
        const nodeId = boundedId(option.nodeId, NODE_ID_PATTERN);
        const label = boundedText(option.label, 80);
        const description = optionalBoundedText(option.description, 180);
        if (!nodeId || !label || nodeIds.has(nodeId) || description === INVALID_TEXT) return undefined;
        nodeIds.add(nodeId);
        options.push({ nodeId, label, ...(typeof description === "string" ? { description } : {}) });
    }
    return options;
}

function normalizeSummary(value: unknown) {
    if (!Array.isArray(value) || value.length < 1 || value.length > 6) return undefined;
    const items = value.map((item) => boundedText(item, 180));
    return items.every((item): item is string => Boolean(item)) ? items : undefined;
}

function parseZodiacDecisionBody(body: string) {
    try {
        return normalizeZodiacDecisionUi(JSON.parse(body) as unknown);
    } catch {
        return undefined;
    }
}

type ZodiacDecisionFence = { start: number; end: number; body: string };

type ZodiacDecisionScan = {
    blocks: ZodiacDecisionFence[];
    ranges: Array<{ start: number; end: number }>;
    explicit: boolean;
    unfinished: boolean;
};

function scanZodiacDecisionPayloads(text: string): ZodiacDecisionScan {
    const fenced = scanZodiacDecisionFences(text);
    const blocks = [...fenced.blocks];
    const ranges = fenced.blocks.map((block) => ({ start: block.start, end: block.end }));
    if (fenced.unfinished) ranges.push({ start: fenced.unfinished.start, end: text.length });

    const occupied = [...ranges];
    const rawMarker = /^[\t ]*(?:<\|[\w.-]+\|>[\t ]*)?zodiac-ui[\t ]*(?=\{|\r?$)/gimu;
    let match: RegExpExecArray | null;
    let unfinished = Boolean(fenced.unfinished);
    while ((match = rawMarker.exec(text))) {
        const start = match.index;
        if (occupied.some((range) => start >= range.start && start < range.end)) continue;
        const bodyStart = skipWhitespace(text, rawMarker.lastIndex);
        if (text[bodyStart] !== "{") {
            const end = rawProtocolLineEnd(text, bodyStart);
            ranges.push({ start, end });
            occupied.push({ start, end });
            unfinished = true;
            continue;
        }
        const jsonEnd = balancedJsonObjectEnd(text, bodyStart, MAX_RAW_DECISION_BYTES);
        if (jsonEnd === undefined) {
            ranges.push({ start, end: text.length });
            occupied.push({ start, end: text.length });
            unfinished = true;
            break;
        }
        const end = rawProtocolEnd(text, jsonEnd);
        blocks.push({ start, end, body: text.slice(bodyStart, jsonEnd) });
        ranges.push({ start, end });
        occupied.push({ start, end });
        rawMarker.lastIndex = end;
    }

    scanZodiacProviderToolCalls(text).forEach((call) => {
        if (occupied.some((range) => call.start >= range.start && call.start < range.end)) return;
        const decisionBodies = call.bodies.filter(looksLikeDecisionBody);
        const recognizablePartial = call.unfinished && /"type"\s*:\s*"(?:single_choice|multi_choice|short_text|asset_picker|confirm_summary)"/u.test(text.slice(call.start, call.end));
        if (!decisionBodies.length && !recognizablePartial) return;
        decisionBodies.forEach((body) => blocks.push({ start: call.start, end: call.end, body }));
        ranges.push({ start: call.start, end: call.end });
        occupied.push({ start: call.start, end: call.end });
        if (call.unfinished) unfinished = true;
    });

    return {
        blocks,
        ranges,
        explicit: blocks.length > 0 || ranges.length > 0,
        unfinished,
    };
}

function looksLikeDecisionBody(body: string) {
    try {
        const record = asRecord(JSON.parse(body) as unknown);
        return Boolean(record && typeof record.type === "string" && ["single_choice", "multi_choice", "short_text", "asset_picker", "confirm_summary"].includes(record.type));
    } catch {
        return false;
    }
}

function scanZodiacDecisionFences(text: string): {
    blocks: ZodiacDecisionFence[];
    unfinished?: { start: number };
} {
    const blocks: ZodiacDecisionFence[] = [];
    const lines = crlfLines(text);
    for (let index = 0; index < lines.length; index += 1) {
        const line = lines[index];
        const opening = line.content.match(/^[\t ]*(`{3,})zodiac-ui[\t ]*$/iu);
        if (!opening) continue;
        const closingPattern = new RegExp("^[\\t ]*`{" + opening[1].length + ",}[\\t ]*$", "u");
        let closingIndex = -1;
        for (let candidate = index + 1; candidate < lines.length; candidate += 1) {
            if (closingPattern.test(lines[candidate].content)) {
                closingIndex = candidate;
                break;
            }
        }
        if (closingIndex < 0) return { blocks, unfinished: { start: line.start } };
        const closing = lines[closingIndex];
        blocks.push({ start: line.start, end: closing.end, body: text.slice(line.nextStart, closing.start) });
        index = closingIndex;
    }
    return { blocks };
}

function skipWhitespace(text: string, start: number) {
    let cursor = start;
    while (cursor < text.length && /\s/u.test(text[cursor])) cursor += 1;
    return cursor;
}

function rawProtocolLineEnd(text: string, start: number) {
    const newline = text.indexOf("\n", start);
    return newline < 0 ? text.length : newline + 1;
}

function balancedJsonObjectEnd(text: string, start: number, maximumLength: number) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    const limit = Math.min(text.length, start + maximumLength);
    for (let cursor = start; cursor < limit; cursor += 1) {
        const character = text[cursor];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') {
            quoted = true;
            continue;
        }
        if (character === "{") depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) return cursor + 1;
            if (depth < 0) return undefined;
        }
    }
    return undefined;
}

function rawProtocolEnd(text: string, jsonEnd: number) {
    let cursor = jsonEnd;
    while (cursor < text.length && /[\t \r\n]/u.test(text[cursor])) cursor += 1;
    const sentinel = text.slice(cursor).match(/^\[(?:blocked|done|complete|completed)\]/iu);
    if (sentinel) {
        cursor += sentinel[0].length;
        while (cursor < text.length && /[\t \r\n]/u.test(text[cursor])) cursor += 1;
    }
    const wrapper = text.slice(cursor).match(/^<\|\/?[\w.-]+\|>/u);
    if (wrapper) cursor += wrapper[0].length;
    return cursor;
}

function crlfLines(text: string) {
    const lines: Array<{ start: number; end: number; nextStart: number; content: string }> = [];
    let start = 0;
    let cursor = 0;
    while (cursor < text.length) {
        if (text[cursor] !== "\r" && text[cursor] !== "\n") {
            cursor += 1;
            continue;
        }
        const nextStart = text[cursor] === "\r" && text[cursor + 1] === "\n" ? cursor + 2 : cursor + 1;
        lines.push({ start, end: cursor, nextStart, content: text.slice(start, cursor) });
        start = nextStart;
        cursor = nextStart;
    }
    lines.push({ start, end: text.length, nextStart: text.length, content: text.slice(start) });
    return lines;
}

function removeTextRanges(text: string, ranges: Array<{ start: number; end: number }>) {
    if (!ranges.length) return text;
    const sorted = [...ranges].sort((left, right) => left.start - right.start);
    let cursor = 0;
    let visible = "";
    for (const range of sorted) {
        if (range.end <= cursor) continue;
        visible += text.slice(cursor, Math.max(cursor, range.start));
        cursor = Math.max(cursor, range.end);
    }
    return visible + text.slice(cursor);
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
    return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function hasOnlyKeys(record: Record<string, unknown>, allowed: readonly string[]) {
    const allowedSet = new Set(allowed);
    return Object.keys(record).every((key) => allowedSet.has(key));
}

function boundedId(value: unknown, pattern: RegExp) {
    const candidate = boundedText(value, 128);
    return candidate && pattern.test(candidate) ? candidate : undefined;
}

function boundedText(value: unknown, maximum: number) {
    if (typeof value !== "string") return undefined;
    const candidate = value.trim();
    return candidate && candidate.length <= maximum && !hasUnsafeControlCharacters(candidate) ? candidate : undefined;
}

const INVALID_TEXT = Symbol("invalid-text");

function optionalBoundedText(value: unknown, maximum: number): string | undefined | typeof INVALID_TEXT {
    if (value === undefined) return undefined;
    return boundedText(value, maximum) || INVALID_TEXT;
}

function hasUnsafeControlCharacters(value: string) {
    return /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value);
}
