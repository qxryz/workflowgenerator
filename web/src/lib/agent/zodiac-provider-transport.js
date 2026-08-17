const MAX_TOOL_CALL_BYTES = 128 * 1024;

/**
 * Reads provider transport wrappers such as `<|tool_call|>` without trusting
 * their contents. Consumers still validate every recovered JSON object against
 * their own strict declarative schema.
 */
export function scanZodiacProviderToolCalls(text) {
    const calls = [];
    const opening = /(?:<\|tool_call\|>|<tool_call>)/giu;
    const closing = /(?:<\|\/tool_call\|>|<\/tool_call>)/giu;
    let match;
    while ((match = opening.exec(text))) {
        const start = transportLineStart(text, match.index);
        closing.lastIndex = opening.lastIndex;
        const endMatch = closing.exec(text);
        const unfinished = !endMatch;
        const bodyEnd = endMatch?.index ?? text.length;
        const end = unfinished ? text.length : transportTailEnd(text, endMatch.index + endMatch[0].length);
        calls.push({ start, end, bodies: jsonObjectsWithin(text, opening.lastIndex, bodyEnd), unfinished });
        opening.lastIndex = end;
        if (unfinished) break;
    }
    return calls;
}

function jsonObjectsWithin(text, start, end) {
    const bodies = [];
    let cursor = start;
    while (cursor < end && bodies.length < 8) {
        const objectStart = text.indexOf("{", cursor);
        if (objectStart < 0 || objectStart >= end) break;
        const objectEnd = balancedJsonObjectEnd(text, objectStart, Math.min(end, objectStart + MAX_TOOL_CALL_BYTES));
        if (objectEnd === undefined || objectEnd > end) {
            cursor = objectStart + 1;
            continue;
        }
        bodies.push(text.slice(objectStart, objectEnd));
        cursor = objectEnd;
    }
    return bodies;
}

function balancedJsonObjectEnd(text, start, limit) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let cursor = start; cursor < limit; cursor += 1) {
        const character = text[cursor];
        if (quoted) {
            if (escaped) escaped = false;
            else if (character === "\\") escaped = true;
            else if (character === '"') quoted = false;
            continue;
        }
        if (character === '"') quoted = true;
        else if (character === "{") depth += 1;
        else if (character === "}") {
            depth -= 1;
            if (depth === 0) return cursor + 1;
            if (depth < 0) return undefined;
        }
    }
    return undefined;
}

function transportLineStart(text, markerStart) {
    const lineStart = Math.max(0, text.lastIndexOf("\n", markerStart - 1) + 1);
    const prefix = text.slice(lineStart, markerStart);
    return /^(?:[\t |]|<\|[\w.-]+\|>)*$/u.test(prefix) ? lineStart : markerStart;
}

function transportTailEnd(text, markerEnd) {
    let cursor = markerEnd;
    for (;;) {
        const whitespace = text.slice(cursor).match(/^[\t \r\n|]+/u);
        if (whitespace) cursor += whitespace[0].length;
        const provider = text.slice(cursor).match(/^<\|\/?[\w.-]+\|>/u);
        if (provider) {
            cursor += provider[0].length;
            continue;
        }
        const sentinel = text.slice(cursor).match(/^\[(?:blocked|done|complete|completed)\]/iu);
        if (sentinel) {
            cursor += sentinel[0].length;
            continue;
        }
        break;
    }
    return cursor;
}
