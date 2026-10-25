import assert from "node:assert/strict";
import test from "node:test";

import {
    adoptedByShot, canUseTail, defaultFirstFrame, defaultStep, exportErrorText, moveId, neighbourShot, planImageBatch, planVideoBatch, scriptBlocks, shotsMissingVideo, spokenText, stepProgress, subtitleLines,
} from "../src/lib/drama/episode-steps.ts";
import { sameDraft, toDraft } from "../src/lib/drama/shot-draft.ts";
import type { DramaArtifact, DramaShot } from "../src/lib/drama/types.ts";

const shot = (id: string, extra: Partial<DramaShot> = {}): DramaShot => ({
    id, ord: 1, seconds: 5, size: "中景", camera: "固定", description: "", dialogue: [], narration: "", transition: "cut", startState: "", endState: "",
    props: [], imagePrompt: "", videoPrompt: "", entityIds: [], updatedAt: 0, rev: 1, ...extra,
});
const artifact = (shotId: string, kind: DramaArtifact["kind"], extra: Partial<DramaArtifact> = {}): DramaArtifact => ({
    id: `${kind}-${shotId}-${extra.createdAt ?? 0}`, entityId: null, shotId, kind, status: "ready", mediaKey: "k", mediaUrl: `/media/${kind}-${shotId}`, mime: "", width: null, height: null, durationMs: null,
    prompt: "", model: "m", params: {}, inputHash: "", providerTask: null, error: "", adopted: true, createdAt: 0, updatedAt: 0, ...extra,
});

const shots = [shot("a"), shot("b", { transition: "continuous" }), shot("c", { transition: "continuous" }), shot("d", { seconds: 8 })];

test("stepProgress counts adopted pictures and videos per shot, ignoring drafts and failures", () => {
    const artifacts = [
        artifact("a", "image"),
        artifact("b", "image", { adopted: false }),
        artifact("c", "image", { status: "failed", mediaUrl: "" }),
        artifact("a", "video"),
        artifact("a", "audio"),
    ];
    const progress = stepProgress({ script: " 【场景 1】 ", shots, artifacts, exports: [] });
    assert.deepEqual(progress.image, { done: 1, total: 4, complete: false });
    assert.deepEqual(progress.video, { done: 1, total: 4, complete: false });
    assert.deepEqual(progress.audio, { done: 1, total: 4, complete: false });
    assert.equal(progress.script.complete, true);
    assert.equal(progress.shots.done, 4);
    assert.equal(stepProgress({ script: "", shots: [], artifacts: [], exports: [] }).image.complete, false);
});

test("defaultStep is the first unfinished of script, shots, pictures, video; voice is never the landing step", () => {
    const empty = { script: "", shots: [], artifacts: [], exports: [] };
    assert.equal(defaultStep(stepProgress(empty)), "script");
    assert.equal(defaultStep(stepProgress({ ...empty, script: "x" })), "shots");
    assert.equal(defaultStep(stepProgress({ ...empty, script: "x", shots })), "image");
    const images = shots.map((item) => artifact(item.id, "image"));
    assert.equal(defaultStep(stepProgress({ ...empty, script: "x", shots, artifacts: images })), "video");
    const all = [...images, ...shots.map((item) => artifact(item.id, "video"))];
    assert.equal(defaultStep(stepProgress({ ...empty, script: "x", shots, artifacts: all })), "export");
});

test("the previous tail frame needs a continuous shot and an adopted video before it", () => {
    const videos = adoptedByShot([artifact("a", "video")], "video");
    assert.equal(canUseTail(shots[1], shots[0], videos), true);
    assert.equal(canUseTail(shots[2], shots[1], videos), false, "previous shot has no video");
    assert.equal(canUseTail(shot("x", { transition: "cut" }), shots[0], videos), false, "a cut starts fresh");
    assert.equal(canUseTail(shots[0], undefined, videos), false, "first shot has no previous shot");
    assert.equal(defaultFirstFrame(shots[1], shots[0], videos), "tail");
    assert.equal(defaultFirstFrame(shots[3], shots[2], videos), "storyboard");
});

test("image batch: first shot alone until something is adopted, then every shot still missing a picture", () => {
    assert.deepEqual(planImageBatch(shots, []), { mode: "first", shotIds: ["a"] });
    assert.deepEqual(planImageBatch(shots, [artifact("a", "image", { adopted: false })]), { mode: "first", shotIds: ["a"] });
    assert.deepEqual(planImageBatch(shots, [artifact("a", "image", { status: "pending", mediaUrl: "", adopted: false })]), { mode: "first", shotIds: [] });
    const batch = planImageBatch(shots, [artifact("a", "image"), artifact("c", "image"), artifact("d", "image", { status: "pending", mediaUrl: "", adopted: false })]);
    assert.deepEqual(batch, { mode: "missing", shotIds: ["b"] });
    assert.deepEqual(planImageBatch([], []), { mode: "first", shotIds: [] });
});

test("video batch: continuous shots start from the previous tail, others from their picture", () => {
    const images = [artifact("a", "image"), artifact("b", "image"), artifact("d", "image")];
    const batch = planVideoBatch(shots, images);
    assert.deepEqual(batch.shotIds, ["a", "b", "c", "d"], "b and c follow shots this batch makes and adopts");
    assert.equal(batch.seconds, 5 + 5 + 5 + 8);
    assert.deepEqual([batch.chained, batch.skipped, batch.waiting], [true, 0, 0]);

    const apart = planVideoBatch([shot("a"), shot("b")], [artifact("a", "image")]);
    assert.deepEqual(apart, { shotIds: ["a"], seconds: 5, skipped: 1, waiting: 0, chained: false });

    const done = planVideoBatch(shots, [...images, artifact("a", "video"), artifact("b", "video", { status: "pending", mediaUrl: "", adopted: false })]);
    assert.deepEqual(done.shotIds, ["d"], "c would start from b, which is still being made");
    assert.deepEqual([done.skipped, done.waiting], [0, 1]);

    const resume = planVideoBatch(shots, [artifact("a", "video")]);
    assert.deepEqual(resume.shotIds, ["b", "c"], "b starts from the adopted video of a with no picture of its own; c follows b");
    assert.equal(resume.chained, true);
    const next = planVideoBatch(shots, [...images, artifact("a", "video"), artifact("b", "video")]);
    assert.deepEqual([next.shotIds, next.chained], [["c", "d"], false], "c starts from the adopted video of b, so nothing waits on this batch");
});

test("video batch with auto-adopt off never lets a continuous shot fall back to its picture", () => {
    const images = [artifact("a", "image"), artifact("b", "image"), artifact("d", "image")];
    const batch = planVideoBatch(shots, images, false);
    assert.deepEqual(batch.shotIds, ["a", "d"]);
    assert.deepEqual([batch.waiting, batch.chained], [2, false], "b and c wait until their previous shot has an adopted video");
    assert.deepEqual(planVideoBatch(shots, [...images, artifact("a", "video")], false).shotIds, ["b", "d"], "b can start once a is adopted; c still waits for b");
});

test("shotsMissingVideo lists shots in order without an adopted video", () => {
    assert.deepEqual(shotsMissingVideo(shots, [artifact("b", "video"), artifact("c", "video", { adopted: false })]).map((item) => item.id), ["a", "c", "d"]);
});

test("spoken text drops speaker names; subtitles keep them like the export does", () => {
    const talk = shot("t", { dialogue: [{ speaker: "e1", text: " 你来晚了。 " }, { speaker: "", text: "" }, { speaker: "", text: "画外音" }, { speaker: "gone", text: "谁？" }], narration: "夜很长。" });
    assert.equal(spokenText(talk), "你来晚了。\n画外音\n谁？\n夜很长。");
    assert.deepEqual(subtitleLines(talk, (id) => ({ e1: "林夏" })[id]), ["林夏：你来晚了。", "画外音", "谁？"]);
    assert.equal(spokenText(shot("quiet")), "");
});

test("moveId and neighbourShot stay inside the list", () => {
    assert.deepEqual(moveId(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
    assert.deepEqual(moveId(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
    assert.deepEqual(moveId(["a", "b", "c"], "a", -1), ["a", "b", "c"]);
    assert.deepEqual(moveId(["a", "b", "c"], "zz", 1), ["a", "b", "c"]);
    assert.equal(neighbourShot(shots, "b", 1), "c");
    assert.equal(neighbourShot(shots, "d", 1), "d");
    assert.equal(neighbourShot(shots, "a", -1), "a");
    assert.equal(neighbourShot(shots, null, 1), "a");
    assert.equal(neighbourShot([], "a", 1), undefined);
});

test("scriptBlocks tells scene headings, spoken lines and action apart", () => {
    const blocks = scriptBlocks("【场景 1】外景｜渡口｜夜\n江雾压着棚顶。\n\n林夏：（低声）你来晚了。\n旁白：夜很长。\n（她抬头。）");
    assert.deepEqual(blocks.map((block) => block.type), ["scene", "action", "gap", "line", "line", "action"]);
    assert.deepEqual(blocks[3], { type: "line", speaker: "林夏", text: "（低声）你来晚了。" });
    assert.equal(blocks[5].text, "（她抬头。）");
});

test("exportErrorText keeps the human part of a failure and drops raw tool output", () => {
    assert.equal(exportErrorText("第 2 镜合成失败：Invalid data found when processing input"), "第 2 镜合成失败");
    assert.equal(exportErrorText("第 1 镜还没有采用视频；第 3 镜还没有采用视频"), "第 1 镜还没有采用视频；第 3 镜还没有采用视频");
    assert.equal(exportErrorText("第 4 镜的视频文件找不到：请重新生成"), "第 4 镜的视频文件找不到：请重新生成");
    assert.equal(exportErrorText("  "), "导出失败，请重试");
});

test("a saved shot draft equals the server copy however keys, bindings and blank lines are ordered", () => {
    const base = shot("s", { entityIds: ["e2", "e1"], description: "站在门口", dialogue: [{ speaker: "e1", text: "你来了" }], props: [{ entityId: "p", quantity: 1, startVisible: true, endVisible: false, startHolder: "e1", endHolder: "", note: "" }] });
    const edited = toDraft(base);
    const fromServer = toDraft({
        ...base,
        entityIds: ["e1", "e2"],
        description: "站在门口",
        dialogue: [{ text: "你来了", speaker: "e1" }],
        props: [{ note: "", endHolder: "", startHolder: "e1", endVisible: false, startVisible: true, quantity: 1, entityId: "p" }],
    });
    assert.equal(sameDraft(edited, fromServer), true);
    assert.equal(sameDraft({ ...edited, dialogue: [...edited.dialogue, { speaker: "", text: "  " }], description: "站在门口 " }, fromServer), true, "blank lines are dropped and text is trimmed on save");
    assert.equal(sameDraft({ ...edited, entityIds: ["e1"] }, fromServer), false);
    assert.equal(sameDraft({ ...edited, seconds: 9 }, fromServer), false);
});
