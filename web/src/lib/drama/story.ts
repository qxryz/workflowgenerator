import { pickStageRuns } from "./stage-runs.ts";
import type { ChapterProposal, DramaChapter, DramaEntity, DramaEpisode, DramaRun, EpisodesProposal, LedgerEntry, LedgerKind } from "./types.ts";

// Pure helpers for the story, review and episodes sections.

type Translate = (message: string, values?: Record<string, string | number>) => string;

export const ORIGIN_LABELS = { imported: "已导入", written: "AI 写作", manual: "手动添加" } as const;
export const LEDGER_ORDER: LedgerKind[] = ["character", "place", "item", "world", "thread"];
export const LEDGER_OP_LABELS: Record<ChapterProposal["ledger"][number]["op"], string> = { add: "新增", update: "更新", resolve: "回收" };

export type LedgerDraft = Omit<LedgerEntry, "id"> & { id?: string };

/** Non-empty groups in reading order; open threads first, then by first appearance, then name. */
export function groupLedger(ledger: readonly LedgerEntry[]): Array<{ kind: LedgerKind; entries: LedgerEntry[] }> {
    const first = (entry: LedgerEntry) => (entry.chapterOrds.length ? Math.min(...entry.chapterOrds) : Number.MAX_SAFE_INTEGER);
    return LEDGER_ORDER.flatMap((kind) => {
        const entries = ledger
            .filter((entry) => entry.kind === kind)
            .sort((a, b) => Number(a.status === "resolved") - Number(b.status === "resolved") || first(a) - first(b) || a.name.localeCompare(b.name, "zh"));
        return entries.length ? [{ kind, entries }] : [];
    });
}

export const upsertLedger = (ledger: readonly LedgerEntry[], draft: LedgerDraft): LedgerDraft[] =>
    draft.id && ledger.some((entry) => entry.id === draft.id) ? ledger.map((entry) => (entry.id === draft.id ? { ...draft } : entry)) : [...ledger, draft];

export const removeLedger = (ledger: readonly LedgerEntry[], id: string): LedgerEntry[] => ledger.filter((entry) => entry.id !== id);

/** [1,2,3,5] -> "1–3、5": runs of three or more collapse into a range. */
export function compressOrds(ords: readonly number[], separator = "、"): string {
    const sorted = [...new Set(ords)].sort((a, b) => a - b);
    const parts: string[] = [];
    for (let i = 0; i < sorted.length; ) {
        let j = i;
        while (j + 1 < sorted.length && sorted[j + 1] === sorted[j] + 1) j += 1;
        if (j - i >= 2) parts.push(`${sorted[i]}–${sorted[j]}`);
        else for (let k = i; k <= j; k += 1) parts.push(String(sorted[k]));
        i = j + 1;
    }
    return parts.join(separator);
}

/** "第 3 章": how chapters are named on screen (the short label C3 is only for prompts). */
export const chapterNo = (ord: number, t: Translate): string => t("第 {count} 章", { count: ord });

/** "第1–3、5章"; empty string when there are none. */
export const formatChapterRefs = (ords: readonly number[], t: Translate): string => (ords.length ? t("第{ords}章", { ords: compressOrds(ords, t("、")) }) : "");

/** Characters that count as writing: everything but whitespace. */
export const countChars = (text: string): number => text.replace(/\s/g, "").length;

export const paragraphs = (body: string): string[] =>
    body
        .split(/\n+/)
        .map((line) => line.trim())
        .filter(Boolean);

export const nextChapterOrd = (chapters: readonly Pick<DramaChapter, "ord">[]): number => Math.max(0, ...chapters.map((chapter) => chapter.ord)) + 1;

export type ChapterRow = { ord: number; chapter?: DramaChapter; run?: DramaRun };

const PENDING: ReadonlySet<string> = new Set(["running", "review", "failed"]);
const onOrd = (ord: number) => (run: DramaRun) => run.scope.ord === ord;

/** The result a chapter is waiting on: live, to confirm, or failed. Settled and stopped runs are only history. */
export function pendingChapterRun(runs: readonly DramaRun[], ord: number): DramaRun | undefined {
    const { current } = pickStageRuns(runs, "chapter", onOrd(ord));
    return current && PENDING.has(current.status) ? current : undefined;
}

/** Written chapters plus a row for every chapter that only exists as a pending result so far. */
export function chapterRows(chapters: readonly DramaChapter[], runs: readonly DramaRun[]): ChapterRow[] {
    const rows: ChapterRow[] = [...chapters].sort((a, b) => a.ord - b.ord).map((chapter) => ({ ord: chapter.ord, chapter, run: pendingChapterRun(runs, chapter.ord) }));
    const known = new Set(rows.map((row) => row.ord));
    const unwritten = [...new Set(runs.filter((run) => run.stage === "chapter" && run.scope.ord && !known.has(run.scope.ord)).map((run) => run.scope.ord!))];
    for (const ord of unwritten) {
        const run = pendingChapterRun(runs, ord);
        if (run) rows.push({ ord, run });
    }
    return rows.sort((a, b) => a.ord - b.ord);
}

/** Which row to open first: something waiting for confirmation, else the latest chapter (originals) or the first (adaptations). */
export function defaultRow(rows: readonly ChapterRow[], original: boolean): ChapterRow | undefined {
    return rows.find((row) => row.run?.status === "review") ?? (original ? rows.at(-1) : rows[0]);
}

/** Everything when it is short, otherwise the latest ten. */
export const defaultReviewOrds = (chapters: readonly Pick<DramaChapter, "ord">[], limit = 10): number[] =>
    chapters
        .map((chapter) => chapter.ord)
        .sort((a, b) => a - b)
        .slice(-limit);

const DIGITS: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };

function chineseNumber(text: string): number | undefined {
    if (/^\d+$/.test(text)) return Number(text);
    const [tens, ones] = text.includes("十") ? text.split("十") : [undefined, text];
    const tensValue = tens === undefined ? 0 : tens === "" ? 1 : DIGITS[tens];
    const onesValue = ones ? DIGITS[ones] : 0;
    return tensValue === undefined || onesValue === undefined || (tensValue === 0 && !ones) ? undefined : tensValue * 10 + onesValue;
}

/** The first chapter among `ords` that `text` mentions ("第 3 章", "第三章", "C3"). */
export function guessChapterOrd(text: string, ords: readonly number[]): number | undefined {
    for (const match of text.matchAll(/第\s*([零〇一二两三四五六七八九十\d]{1,4})\s*章|\bC(\d{1,4})\b/g)) {
        const ord = chineseNumber(match[1] ?? match[2]);
        if (ord !== undefined && ords.includes(ord)) return ord;
    }
    return undefined;
}

/** Model text may cite the short labels it was given (C3, E2, P1); on screen they read as 第 3 章, the setting's name, 第 1 集. */
export function plainRefs(text: string, snapshot: { entities: readonly Pick<DramaEntity, "label" | "name">[]; episodes: readonly Pick<DramaEpisode, "label" | "ord">[] }, t: Translate): string {
    return text.replace(/\b([CEP])(\d{1,4})(?:章|集)?(?![A-Za-z\d])/g, (match, kind: string, number: string) => {
        if (kind === "C") return t("第 {count} 章", { count: Number(number) });
        if (kind === "P") {
            const episode = snapshot.episodes.find((item) => item.label === `P${number}`);
            return episode ? t("第 {count} 集", { count: episode.ord }) : match;
        }
        const entity = snapshot.entities.find((item) => item.label === `E${number}`);
        return entity ? `「${entity.name}」` : match;
    });
}

export const episodeSourceOrds = (episode: Pick<DramaEpisode, "sourceChapterIds">, chapters: readonly Pick<DramaChapter, "id" | "ord">[]): number[] =>
    chapters
        .filter((chapter) => episode.sourceChapterIds.includes(chapter.id))
        .map((chapter) => chapter.ord)
        .sort((a, b) => a - b);

export function formatSeconds(seconds: number, t: Translate): string {
    if (seconds < 60) return t("{count} 秒", { count: seconds });
    const minutes = Math.floor(seconds / 60);
    return seconds % 60 ? t("{minutes} 分 {seconds} 秒", { minutes, seconds: seconds % 60 }) : t("{count} 分钟", { count: minutes });
}

export function episodeProgress(progress: DramaEpisode["progress"]) {
    const shots = progress?.shots ?? 0;
    const images = Math.min(progress?.images ?? 0, shots);
    const videos = Math.min(progress?.videos ?? 0, shots);
    return { shots, images, videos, imageShare: shots ? images / shots : 0, videoShare: shots ? videos / shots : 0 };
}

export type ProposedEpisode = { item: EpisodesProposal["episodes"][number]; update: boolean; /** Where it sits: the episode it updates, or the next free number. */ ord?: number };

/** The server marks every entry it will update with `ref` (an episode label); entries without one are appended. */
export function proposedEpisodes(proposal: EpisodesProposal, episodes: readonly DramaEpisode[]): ProposedEpisode[] {
    let next = Math.max(0, ...episodes.map((episode) => episode.ord));
    return proposal.episodes.map((item) => (item.ref ? { item, update: true, ord: episodes.find((episode) => episode.label === item.ref)?.ord } : { item, update: false, ord: (next += 1) }));
}

/** The server answers 409 when the row changed since it was read. */
export const isConflict = (error: unknown): boolean => typeof error === "object" && error !== null && (error as { status?: number }).status === 409;
