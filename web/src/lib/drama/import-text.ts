import type { DramaSourceType } from "./types";

export type ImportedChapter = { title: string; body: string };

const NUM = "[零〇一二三四五六七八九十百千两\\d]+";
const CHAPTER_HEADING = [
    new RegExp(`^第\\s*${NUM}\\s*[章回节集]`),
    /^chapter\s+(\d+|[ivxlc]+|[a-z]+)\b/i,
    /^#{1,3}\s+\S/,
];
const SCENE_HEADING = [
    new RegExp(`^(第\\s*${NUM}\\s*场|场景\\s*${NUM}?)`),
    /^\d+\s*[-－—.]\s*\d+\s+\S/,
    /^(INT|EXT|INT\.?\/EXT|I\/E)[.\s]/i,
    /^[内外]景/,
];
const MAX_HEADING_LENGTH = 60;
const CHUNK_SIZE = 3000;
/** The server stores at most 200,000 characters per chapter; longer ones are cut well below that. */
export const MAX_CHAPTER_CHARS = 150_000;

const headingTitle = (line: string) => line.replace(/^#+\s*/, "").trim();

function splitByHeadings(lines: string[], patterns: RegExp[]): ImportedChapter[] | null {
    const isHeading = (line: string) => line.length <= MAX_HEADING_LENGTH && !/[。！？]/.test(line) && patterns.some((pattern) => pattern.test(line));
    const starts = lines.flatMap((line, index) => (isHeading(line) ? [index] : []));
    if (starts.length < 2) return null;
    const chapters: ImportedChapter[] = [];
    if (starts[0] > 0) chapters.push({ title: "开篇", body: lines.slice(0, starts[0]).join("\n") });
    starts.forEach((start, i) => chapters.push({ title: headingTitle(lines[start]), body: lines.slice(start + 1, starts[i + 1] ?? lines.length).join("\n") }));
    return chapters;
}

function splitBySize(lines: string[]): ImportedChapter[] {
    const chunks: string[][] = [[]];
    let size = 0;
    for (const line of lines) {
        if (size >= CHUNK_SIZE) {
            chunks.push([]);
            size = 0;
        }
        chunks.at(-1)!.push(line);
        size += line.length;
    }
    return chunks.map((chunk, i) => ({ title: `第 ${i + 1} 段`, body: chunk.join("\n") }));
}

/** A chapter over the limit becomes "标题（1）", "标题（2）"…, cut at line breaks (a single endless line is cut where it must be). */
function capLength(chapter: ImportedChapter): ImportedChapter[] {
    if (chapter.body.length <= MAX_CHAPTER_CHARS) return [chapter];
    const parts: string[][] = [[]];
    let size = 0;
    for (const line of chapter.body.split("\n")) {
        for (let at = 0; at < Math.max(1, line.length); at += MAX_CHAPTER_CHARS) {
            const piece = line.slice(at, at + MAX_CHAPTER_CHARS);
            if (size + piece.length + 1 > MAX_CHAPTER_CHARS && parts.at(-1)!.length) {
                parts.push([]);
                size = 0;
            }
            parts.at(-1)!.push(piece);
            size += piece.length + 1;
        }
    }
    return parts.map((lines, index) => ({ title: `${chapter.title}（${index + 1}）`, body: lines.join("\n").trim() })).filter((part) => part.body);
}

/** Local split of pasted or imported text; a fallback of ~3000-character chunks keeps heading-less text usable. */
export function splitChapters(text: string, source: DramaSourceType = "novel"): ImportedChapter[] {
    const lines = text
        .replace(/\r\n?/g, "\n")
        .split("\n")
        .map((line) => line.trim());
    const chapters = splitByHeadings(lines, CHAPTER_HEADING) ?? (source === "script" ? splitByHeadings(lines, SCENE_HEADING) : null) ?? splitBySize(lines);
    return chapters
        .map(({ title, body }) => ({ title, body: body.replace(/\n{3,}/g, "\n\n").trim() }))
        .filter((chapter) => chapter.body)
        .flatMap(capLength);
}
