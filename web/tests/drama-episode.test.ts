import assert from "node:assert/strict";
import test from "node:test";

import {
    adoptedByShot, canUseTail, defaultFirstFrame, defaultStep, exportErrorText, moveId, neighbourShot, planImageBatch, planVideoBatch, scriptBlocks, shotsMissingVideo, spokenText, stepProgress, subtitleLines,
} from "../src/lib/drama/episode-steps.ts";
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

test("video batch: shots with a first frame, total seconds, and when the run must be one at a time", () => {
    const images = [artifact("a", "image"), artifact("b", "image"), artifact("d", "image")];
    const batch = planVideoBatch(shots, images);
    assert.deepEqual(batch.shotIds, ["a", "b", "c", "d"], "c has no picture but follows b, which this batch fills");
    assert.equal(batch.seconds, 5 + 5 + 5 + 8);
    assert.equal(batch.chained, true);

    const apart = planVideoBatch([shot("a"), shot("b")], [artifact("a", "image")]);
    assert.deepEqual(apart, { shotIds: ["a"], seconds: 5, skipped: 1, chained: false });

    const done = planVideoBatch(shots, [...images, artifact("a", "video"), artifact("b", "video", { status: "pending", mediaUrl: "", adopted: false })]);
    assert.deepEqual(done.shotIds, ["d"], "c would wait for b, which is still being made");
    assert.equal(done.skipped, 1);
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
