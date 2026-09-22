export const TEXT_RESPONSE_LIMIT = 12000;

export async function canvasTextHash(content: string): Promise<string> {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(content));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function textOutline(content: string) {
    return content
        .split("\n")
        .flatMap((line, index) => (/^#{1,6}\s+/.test(line) ? [{ line: index + 1, text: line.slice(0, 160) }] : []))
        .slice(0, 60);
}

export function readCanvasText(content: string, offset = 1, limit = 100) {
    const lines = content.split("\n");
    if (!Number.isInteger(offset) || offset < 1 || offset > lines.length || !Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error("读取行范围无效，单次最多 200 行");
    let text = "";
    let endLine = offset - 1;
    let cutLine = false;
    for (let index = offset - 1; index < Math.min(lines.length, offset - 1 + limit); index++) {
        const line = `${index + 1}: ${lines[index]}\n`;
        const available = TEXT_RESPONSE_LIMIT - text.length;
        if (available <= 0) break;
        text += line.slice(0, available);
        endLine = index + 1;
        if (line.length > available) {
            cutLine = true;
            break;
        }
    }
    return { totalLines: lines.length, startLine: offset, endLine, text, outline: textOutline(content), truncated: cutLine || endLine < lines.length, nextLine: cutLine ? null : endLine < lines.length ? endLine + 1 : null };
}

export function grepCanvasText(content: string, query: string, maxMatches = 20) {
    if (!query || query.length > 2000 || !Number.isInteger(maxMatches) || maxMatches < 1 || maxMatches > 100) throw new Error("搜索参数无效");
    const matches: { line: number; matchedText: string; occurrence: number; snippet: string }[] = [];
    let totalMatches = 0;
    let offset = 0;
    let budget = TEXT_RESPONSE_LIMIT;
    for (;;) {
        const start = content.indexOf(query, offset);
        if (start < 0) break;
        if (matches.length < maxMatches && budget > query.length + 100) {
            const snippet = content.slice(Math.max(0, start - 120), Math.min(content.length, start + query.length + 120)).slice(0, Math.max(0, budget - query.length));
            matches.push({ line: content.slice(0, start).split("\n").length, matchedText: query, occurrence: totalMatches, snippet });
            budget -= query.length + snippet.length;
        }
        totalMatches++;
        offset = start + query.length;
    }
    return { totalLines: content.split("\n").length, totalMatches, matches, truncated: totalMatches > matches.length };
}

export type CanvasTextEdit = { exact: string; replacement: string; occurrence?: number };

export function applyAnchoredCanvasEdits(content: string, edits: CanvasTextEdit[]): string {
    if (!Array.isArray(edits) || !edits.length || edits.length > 100) throw new Error("需要 1–100 项文本修改");
    const ranges = edits
        .map((edit) => {
            if (!edit || typeof edit.exact !== "string" || !edit.exact || typeof edit.replacement !== "string") throw new Error("每项修改需要非空 exact 和 replacement");
            const offsets: number[] = [];
            let offset = 0;
            for (;;) {
                const found = content.indexOf(edit.exact, offset);
                if (found < 0) break;
                offsets.push(found);
                offset = found + edit.exact.length;
            }
            if (!offsets.length) throw new Error("文本锚点不存在，请重新搜索");
            if (edit.occurrence === undefined && offsets.length !== 1) throw new Error("文本锚点重复，需要 occurrence 明确定位");
            const occurrence = edit.occurrence ?? 0;
            if (!Number.isInteger(occurrence) || occurrence < 0 || occurrence >= offsets.length) throw new Error("occurrence 超出锚点范围");
            return { start: offsets[occurrence], end: offsets[occurrence] + edit.exact.length, replacement: edit.replacement };
        })
        .sort((a, b) => a.start - b.start);
    for (let index = 1; index < ranges.length; index++) if (ranges[index].start < ranges[index - 1].end) throw new Error("文本修改范围重叠，未写入任何修改");
    let next = content;
    for (const range of ranges.reverse()) next = next.slice(0, range.start) + range.replacement + next.slice(range.end);
    if (next.length > 200000) throw new Error("文本正文不能超过 200000 字符");
    return next;
}
