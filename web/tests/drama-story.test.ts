import assert from "node:assert/strict";
import test from "node:test";

import {
    chapterRows, compressOrds, countChars, defaultReviewOrds, defaultRow, episodeProgress, episodeSourceOrds, formatChapterRefs, formatSeconds, groupLedger, guessChapterOrd, isConflict, nextChapterOrd, paragraphs,
    pendingChapterRun, proposedEpisodes, removeLedger, upsertLedger,
} from "../src/lib/drama/story.ts";
import type { DramaChapter, DramaEpisode, DramaRun, LedgerEntry } from "../src/lib/drama/types.ts";

const t = (message: string, values: Record<string, string | number> = {}) => message.replace(/\{(\w+)\}/g, (_, key) => String(values[key]));

const entry = (id: string, kind: LedgerEntry["kind"], name: string, extra: Partial<LedgerEntry> = {}): LedgerEntry => ({ id, kind, name, note: "", chapterOrds: [], status: "open", ...extra });
const chapter = (ord: number): DramaChapter => ({ id: `c${ord}`, label: `C${ord}`, ord, title: `第${ord}章`, body: "", summary: "", endState: "", origin: "written", runId: null, updatedAt: 0, rev: 1 });
const run = (id: string, status: DramaRun["status"], ord: number, createdAt = 1): DramaRun => ({ id, episodeId: null, stage: "chapter", scope: { ord }, instruction: "", model: "m", status, parentId: null, error: "", createdAt, finishedAt: null });
const episode = (ord: number, extra: Partial<DramaEpisode> = {}): DramaEpisode => ({ id: `p${ord}`, label: `P${ord}`, ord, title: `第${ord}集`, outline: "", targetSeconds: 90, sourceChapterIds: [], script: "", updatedAt: 0, rev: 1, ...extra });

test("groupLedger orders kinds, drops empty groups, lists open threads before resolved ones", () => {
    const groups = groupLedger([
        entry("1", "thread", "旧船票", { status: "resolved", chapterOrds: [1] }),
        entry("2", "item", "怀表", { chapterOrds: [2] }),
        entry("3", "thread", "七号码头", { chapterOrds: [3] }),
        entry("4", "character", "林夏", { chapterOrds: [1, 2] }),
        entry("5", "character", "周远", { chapterOrds: [] }),
    ]);
    assert.deepEqual(groups.map((group) => group.kind), ["character", "item", "thread"]);
    assert.deepEqual(groups[0].entries.map((e) => e.name), ["林夏", "周远"]);
    assert.deepEqual(groups[2].entries.map((e) => e.name), ["七号码头", "旧船票"]);
});

test("upsertLedger replaces by id and appends otherwise; removeLedger drops one", () => {
    const ledger = [entry("1", "item", "怀表"), entry("2", "place", "渡口")];
    const replaced = upsertLedger(ledger, { ...entry("1", "item", "黄铜怀表"), note: "刻着七" });
    assert.equal(replaced.length, 2);
    assert.equal(replaced[0].name, "黄铜怀表");
    const { id: _id, ...fresh } = entry("x", "world", "雾城");
    assert.equal(upsertLedger(ledger, fresh).length, 3);
    assert.deepEqual(removeLedger(ledger, "1").map((e) => e.id), ["2"]);
});

test("chapter references collapse runs of three or more", () => {
    assert.equal(compressOrds([5, 1, 2, 3]), "1–3、5");
    assert.equal(compressOrds([1, 2]), "1、2");
    assert.equal(compressOrds([2, 2, 4]), "2、4");
    assert.equal(formatChapterRefs([1, 3], t), "第1、3章");
    assert.equal(formatChapterRefs([], t), "");
});

test("text helpers", () => {
    assert.equal(countChars("雨 一直\n下。"), 5);
    assert.deepEqual(paragraphs("甲\n\n  乙 \n\n\n丙\n"), ["甲", "乙", "丙"]);
    assert.equal(nextChapterOrd([]), 1);
    assert.equal(nextChapterOrd([chapter(1), chapter(4)]), 5);
});

test("a chapter's pending result is the live, waiting or failed run; settled and stopped runs are history", () => {
    assert.equal(pendingChapterRun([run("a", "accepted", 2)], 2), undefined);
    assert.equal(pendingChapterRun([run("a", "stopped", 2)], 2), undefined);
    assert.equal(pendingChapterRun([run("a", "failed", 2, 1), run("b", "review", 2, 2)], 2)?.id, "b");
    assert.equal(pendingChapterRun([run("a", "review", 3)], 2), undefined);
});

test("chapterRows adds a row for a chapter that only exists as a pending result", () => {
    const rows = chapterRows([chapter(2), chapter(1)], [run("a", "review", 3), run("b", "running", 1), run("c", "accepted", 2)]);
    assert.deepEqual(rows.map((row) => [row.ord, row.chapter?.id, row.run?.id]), [[1, "c1", "b"], [2, "c2", undefined], [3, undefined, "a"]]);
    assert.equal(defaultRow(rows, true)?.ord, 3);
    assert.equal(defaultRow(chapterRows([chapter(1), chapter(2)], []), true)?.ord, 2);
    assert.equal(defaultRow(chapterRows([chapter(1), chapter(2)], []), false)?.ord, 1);
    assert.equal(defaultRow([], true), undefined);
});

test("review scope defaults to all chapters, or the latest ten", () => {
    assert.deepEqual(defaultReviewOrds([chapter(1), chapter(2)]), [1, 2]);
    assert.deepEqual(defaultReviewOrds(Array.from({ length: 14 }, (_, i) => chapter(i + 1))), [5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
});

test("guessChapterOrd finds the chapter a suggestion talks about", () => {
    const ords = [1, 2, 3, 12];
    assert.equal(guessChapterOrd("第 3 章写林夏左手戴麻绳", ords), 3);
    assert.equal(guessChapterOrd("第三章和第十二章冲突", ords), 3);
    assert.equal(guessChapterOrd("请改第十二章的结尾", ords), 12);
    assert.equal(guessChapterOrd("C2 里的称呼不一致", ords), 2);
    assert.equal(guessChapterOrd("第9章不在范围内", ords), undefined);
    assert.equal(guessChapterOrd("整体偏平", ords), undefined);
});

test("episodes: source chapters, progress, seconds", () => {
    assert.deepEqual(episodeSourceOrds({ sourceChapterIds: ["c3", "c1"] }, [chapter(1), chapter(2), chapter(3)]), [1, 3]);
    assert.deepEqual(episodeProgress(undefined), { shots: 0, images: 0, videos: 0, imageShare: 0, videoShare: 0 });
    assert.equal(episodeProgress({ shots: 8, images: 4, videos: 2 }).imageShare, 0.5);
    assert.equal(episodeProgress({ shots: 2, images: 5, videos: 0 }).images, 2);
    assert.equal(formatSeconds(45, t), "45 秒");
    assert.equal(formatSeconds(120, t), "2 分钟");
    assert.equal(formatSeconds(95, t), "1 分 35 秒");
});

test("proposedEpisodes marks updates by P label and numbers new episodes after the existing ones", () => {
    const rows = proposedEpisodes(
        { episodes: [{ ref: "P2", title: "改", outline: "", targetSeconds: 60, sourceChapters: [2] }, { title: "新一", outline: "", targetSeconds: 60, sourceChapters: [3] }, { ref: "P9", title: "新二", outline: "", targetSeconds: 60, sourceChapters: [] }] },
        [episode(1), episode(2)],
    );
    assert.deepEqual(rows.map((row) => [row.ord, row.target?.id]), [[2, "p2"], [3, undefined], [4, undefined]]);
});

test("isConflict reads the HTTP status", () => {
    assert.equal(isConflict(Object.assign(new Error("x"), { status: 409 })), true);
    assert.equal(isConflict(new Error("x")), false);
    assert.equal(isConflict(null), false);
});
