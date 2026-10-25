import assert from "node:assert/strict";
import test from "node:test";

import * as chapter from "../src/lib/drama/authoring/chapter.ts";
import { chapterExcerpts, clip, entityText, ledgerText } from "../src/lib/drama/authoring/context.ts";
import * as episodes from "../src/lib/drama/authoring/episodes.ts";
import { extractJson, ParseError } from "../src/lib/drama/authoring/json.ts";
import * as review from "../src/lib/drama/authoring/review.ts";
import * as script from "../src/lib/drama/authoring/script.ts";
import * as settings from "../src/lib/drama/authoring/settings.ts";
import * as shots from "../src/lib/drama/authoring/shots.ts";
import type { DramaChapter, DramaEntity, DramaEpisode, DramaSnapshot } from "../src/lib/drama/types.ts";

const chapterRow = (ord: number, extra: Partial<DramaChapter> = {}): DramaChapter => ({ id: `c${ord}`, label: `C${ord}`, ord, title: `第${ord}章`, body: "雨一直下。".repeat(300), summary: `第${ord}章摘要`, endState: `第${ord}章章末：林夏在渡口`, origin: "written", runId: null, updatedAt: 0, rev: 1, ...extra });
const entityRow = (n: number, kind: DramaEntity["kind"], name: string, extra: Partial<DramaEntity> = {}): DramaEntity => ({ id: `e${n}`, label: `E${n}`, kind, name, aliases: [], description: `${name}的描述`, appearance: `${name}的外观`, parentId: null, sort: n, sourceNote: "", runId: null, updatedAt: 0, rev: 1, ...extra });
const episodeRow = (ord: number, extra: Partial<DramaEpisode> = {}): DramaEpisode => ({ id: `p${ord}`, label: `P${ord}`, ord, title: `第${ord}集`, outline: `第${ord}集梗概`, targetSeconds: 90, sourceChapterIds: [`c${ord}`], script: `第${ord}集剧本：林夏推开门。`, updatedAt: 0, rev: 1, ...extra });

function snapshot(): DramaSnapshot {
    return {
        project: { id: "d1", title: "渡口", sourceType: "original", brief: "一个关于渡口的故事", aspect: "16:9", style: { prompt: "水墨" }, palette: null, cover: null, createdAt: 0, updatedAt: 0, rev: 1 },
        chapters: [chapterRow(1), chapterRow(2)],
        ledger: [
            { id: "l1", kind: "character", name: "林夏", note: "账房女儿", chapterOrds: [1, 2], status: "open" },
            { id: "l2", kind: "thread", name: "失踪的船票", note: "周远知道下落", chapterOrds: [1], status: "open" },
        ],
        entities: [entityRow(1, "character", "林夏"), entityRow(2, "scene", "渡口茶棚"), entityRow(3, "prop", "黄铜怀表", { parentId: "e1" })],
        relations: [],
        episodes: [episodeRow(1), episodeRow(2)],
        artifacts: [],
        runs: [],
    };
}
const input = (extra: Record<string, unknown> = {}) => ({ snapshot: snapshot(), scope: {}, instruction: "", ...extra });

test("extractJson handles fences, prose, nested braces in strings and raw newlines", () => {
    assert.deepEqual(extractJson('好的，结果如下：\n```json\n{"a": {"b": "}{"}, "c": [1, 2]}\n```\n以上。'), { a: { b: "}{" }, c: [1, 2] });
    assert.deepEqual(extractJson('前言 {不是json} 然后 {"ok": true}'), { ok: true });
    assert.deepEqual(extractJson('{"script": "第一行\n第二行"}'), { script: "第一行\n第二行" });
    assert.deepEqual(extractJson('说明 [{"x":1}] 结束', "["), [{ x: 1 }]);
});

test("extractJson reports why nothing was found", () => {
    assert.throws(() => extractJson("没有任何结构化内容"), (error) => error instanceof ParseError && error.message.includes("没有找到 JSON"));
    assert.throws(() => extractJson('{"a": [1, 2'), (error) => error instanceof ParseError && error.message.includes("没有闭合"));
    assert.throws(() => extractJson('{"a": 1,, }'), (error) => error instanceof ParseError && error.message.includes("格式有误"));
});

test("chapter.parse reads the tag format with leading prose and a ledger", () => {
    const text = `好的，第三章如下。
<title>第三章 雨夜渡口</title>
<body>
雨点砸在油布上。

林夏把怀表按在桌面。
</body>
<summary>林夏等到周远。</summary>
<end_state>深夜，渡口茶棚，林夏握着怀表。</end_state>
<ledger>
\`\`\`json
[{"op":"add","kind":"item","name":"黄铜怀表","note":"表盖刻七"},{"op":"resolve","kind":"thread","name":"失踪的船票","note":"找到了"}]
\`\`\`
</ledger>`;
    const result = chapter.parse(text);
    assert.equal(result.title, "雨夜渡口");
    assert.equal(chapter.parse("<title>第 12 章：夜航</title><body>b</body>").title, "夜航");
    assert.equal(chapter.parse("<title>第三章</title><body>b</body>").title, "第三章");
    assert.equal(result.body, "雨点砸在油布上。\n\n林夏把怀表按在桌面。");
    assert.equal(result.endState, "深夜，渡口茶棚，林夏握着怀表。");
    assert.deepEqual(result.ledger.map((entry) => [entry.op, entry.kind, entry.name]), [["add", "item", "黄铜怀表"], ["resolve", "thread", "失踪的船票"]]);
});

test("chapter.parse names the missing tags and bad ledgers", () => {
    assert.throws(() => chapter.parse("<title>只有标题</title>"), (error) => error instanceof ParseError && error.message.includes("<body>"));
    assert.throws(() => chapter.parse("<title>t</title><body>b</body><ledger>{\"a\":1}</ledger>"), ParseError);
    assert.deepEqual(chapter.parse("<title>t</title><body>b</body>").ledger, []);
});

test("settings.parse keeps refs and names as written", () => {
    const result = settings.parse(
        '```json\n{"entities":[{"ref":"E1","kind":"character","name":"林夏","aliases":["小夏"],"description":"d","appearance":"a","parent":"","sourceNote":"账本"},{"kind":"道具","name":"怀表","aliases":"旧表","description":"d","parent":"林夏"}],"relations":[{"from":"林夏","to":"E5","kind":"同伴","label":"师兄妹"}]}\n```',
    );
    assert.equal(result.entities[0].ref, "E1");
    assert.equal(result.entities[0].parent, undefined);
    assert.equal(result.entities[1].ref, undefined);
    assert.equal(result.entities[1].kind, "道具");
    assert.deepEqual(result.entities[1].aliases, ["旧表"]);
    assert.equal(result.entities[1].parent, "林夏");
    assert.deepEqual(result.relations, [{ from: "林夏", to: "E5", kind: "同伴", label: "师兄妹", note: "" }]);
    assert.throws(() => settings.parse('{"relations":[]}'), (error) => error instanceof ParseError && error.message.includes("entities"));
});

test("episodes.parse normalizes numbers and chapter references", () => {
    const result = episodes.parse('{"episodes":[{"ref":"P1","title":"雨夜","outline":"o","targetSeconds":"120","sourceChapters":[1,"C2"]},{"title":"t","outline":"o","targetSeconds":90.4,"sourceChapters":[3]}]}');
    assert.equal(result.episodes[0].ref, "P1");
    assert.equal(result.episodes[0].targetSeconds, 120);
    assert.deepEqual(result.episodes[0].sourceChapters, [1, 2]);
    assert.equal(result.episodes[1].ref, undefined);
    assert.equal(result.episodes[1].targetSeconds, 90);
});

test("script and shot prompts tell the model how much fits in the runtime", () => {
    assert.match(script.pacing(35), /约 6 拍、2 个场景以内/);
    assert.match(script.pacing(180), /约 30 拍、4 个场景以内/);
    assert.match(shots.shotBudget(35), /7 个左右.*32–39 秒/);
    assert.match(shots.shotBudget(3), /2 个左右/);
    const user = shots.build({ snapshot: { ...snapshot(), episodes: [episodeRow(1, { script: "【场景 1】…", targetSeconds: 35 })] }, scope: {}, episodeId: "p1", instruction: "" }).user;
    assert.match(user, /镜头数控制在 7 个左右/);
});

test("shots.parse reads a dialogue line whichever key the model used for the words", () => {
    const parsed = shots.parse(JSON.stringify({ shots: [{ seconds: 4, dialogue: [{ speaker: "E1", line: "你来晚了。" }, { speaker: "E2", content: "路上堵车。" }, { speaker: "E1", text: "进来吧。" }] }] }));
    assert.deepEqual(parsed.shots[0].dialogue.map((d) => d.text), ["你来晚了。", "路上堵车。", "进来吧。"]);
});

test("script.parse needs a non-empty script", () => {
    assert.equal(script.parse('脚本：{"script": "【场景 1】外景｜渡口｜夜\\n林夏：你来晚了。"}').script, "【场景 1】外景｜渡口｜夜\n林夏：你来晚了。");
    assert.throws(() => script.parse('{"script": ""}'), ParseError);
});

test("shots.parse carries continuity fields and tolerates loose model types", () => {
    const text = `\`\`\`json
{"shots":[{"seconds":"6","size":"全景","camera":"固定","description":"茶棚","dialogue":[{"speaker":"E1","text":"你来晚了。"}],"narration":"","entities":["E2","E1"],"transition":"cut",
"startState":"林夏坐着","endState":"林夏拿起怀表",
"props":[{"entity":"E3","quantity":1,"startVisible":true,"endVisible":"true","startHolder":"","endHolder":"E1","note":"被拿起"}],
"imagePrompt":"开拍","videoPrompt":"开始→动作→结束"},
{"seconds":5,"description":"特写","dialogue":"一句台词","entities":"E3","transition":"continuous","startState":"s","endState":"e","imagePrompt":"i","videoPrompt":"v"}]}
\`\`\``;
    const [first, second] = shots.parse(text).shots;
    assert.equal(first.seconds, 6);
    assert.deepEqual(first.entities, ["E2", "E1"]);
    assert.deepEqual(first.props[0], { entity: "E3", quantity: 1, startVisible: true, endVisible: true, startHolder: "", endHolder: "E1", note: "被拿起" });
    assert.deepEqual(first.dialogue, [{ speaker: "E1", text: "你来晚了。" }]);
    assert.equal(second.transition, "continuous");
    assert.deepEqual(second.dialogue, [{ speaker: "", text: "一句台词" }]);
    assert.deepEqual(second.entities, ["E3"]);
    assert.deepEqual(second.props, []);
});

test("review.parse keeps the seven criteria as given", () => {
    const items = ["consistency", "character", "plot", "ai_tone", "style", "foreshadowing", "pacing"].map((criterion) => ({ criterion, verdict: criterion === "plot" ? "issue" : "pass", note: "第2章…", suggestion: "" }));
    const result = review.parse(`复核结果：${JSON.stringify({ items })}`);
    assert.equal(result.items.length, 7);
    assert.equal(result.items[2].verdict, "issue");
    assert.throws(() => review.parse('{"result": []}'), ParseError);
});

test("chapter.build continues from the previous chapter and shows the ledger", () => {
    const { system, user } = chapter.build(input());
    assert.match(system, /<ledger>/);
    assert.match(user, /写第3章/);
    assert.match(user, /C2《第2章》/);
    assert.match(user, /章末状态：第2章章末：林夏在渡口/);
    assert.match(user, /人物·林夏/);
    assert.match(user, /伏笔·失踪的船票［未回收］/);
    assert.match(chapter.build(input({ scope: { ord: 2 }, instruction: "节奏更紧", base: '{"title":"旧"}' })).user, /重写第2章[\s\S]*节奏更紧[\s\S]*上一版结果[\s\S]*"旧"/);
});

test("settings.build puts the ledger first and exposes entity labels", () => {
    const { user } = settings.build(input());
    assert.ok(user.indexOf("创作账本") < user.indexOf("章节摘要"));
    assert.match(user, /E3 道具陈设 黄铜怀表 所属E1/);
    assert.match(settings.build({ ...input(), snapshot: { ...snapshot(), entities: [] } }).user, /首次整理/);
});

test("episodes.build lists chapters and existing episodes with labels", () => {
    const { user } = episodes.build(input());
    assert.match(user, /C1《第1章》/);
    assert.match(user, /P2《第2集》约90秒｜来源C2/);
});

test("script.build carries neighbouring episodes, sources and the cast", () => {
    const { user } = script.build(input({ episodeId: "p2" }));
    assert.match(user, /上一集（P1）结尾[\s\S]*第1集剧本/);
    assert.doesNotMatch(user, /下一集/);
    assert.match(user, /### C2《第2章》/);
    assert.match(script.build(input({ episodeId: "p1" })).user, /下一集（P2）梗概\n第2集梗概/);
    assert.match(user, /E2 场景 渡口茶棚/);
    assert.throws(() => script.build(input({ episodeId: "nope" })), /找不到/);
});

test("shots.build requires continuity and exposes script and entity labels", () => {
    const { system, user } = shots.build(input({ episodeId: "p1" }));
    for (const word of ["startState", "endState", "imagePrompt", "videoPrompt", "startHolder", "continuous"]) assert.ok(system.includes(word), word);
    assert.match(system, /只写开拍瞬间/);
    assert.match(user, /第1集剧本：林夏推开门/);
    assert.match(user, /E1 人物 林夏/);
    assert.match(user, /约 90 秒/);
});

test("review.build scopes chapters and switches to settings material", () => {
    const chapters = review.build(input({ scope: { target: "chapters", chapterOrds: [2] } })).user;
    assert.match(chapters, /此前章节摘要[\s\S]*C1《第1章》/);
    assert.match(chapters, /### C2《第2章》/);
    assert.doesNotMatch(chapters, /### C1《/);
    const settingsReview = review.build(input({ scope: { target: "settings" } })).user;
    assert.match(settingsReview, /## 设定\nE1 人物 林夏/);
    assert.match(review.build(input()).system, /criterion/);
});

test("clip and chapterExcerpts respect their budgets", () => {
    const long = "字".repeat(5000);
    assert.equal(clip(long, 100).length, 100);
    assert.equal(clip(long, 100, "tail").length, 100);
    assert.equal(clip("短", 100), "短");
    const chapters = [1, 2, 3, 4].map((n) => chapterRow(n, { body: long }));
    const excerpts = chapterExcerpts(chapters, 3000, 2000);
    assert.ok(!excerpts.includes("C3《"), "stops once the budget is spent");
    assert.ok(excerpts.length <= 3000 + 60);
    assert.ok(ledgerText(snapshot().ledger).includes("［第1、2章］"));
    assert.ok(entityText(snapshot().entities, "brief").length < entityText(snapshot().entities, "full").length);
});
