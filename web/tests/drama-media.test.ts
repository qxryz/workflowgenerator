import assert from "node:assert/strict";
import test from "node:test";

import { MAX_CHAPTER_CHARS, splitChapters } from "../src/lib/drama/import-text.ts";
import { lintEpisode, lintText, type LintIssue } from "../src/lib/drama/lint.ts";
import { translate } from "../src/lib/i18n.ts";
import { inputHash, sheetInputs, sheetPrompt, shotImagePrompt, shotInputs, shotVideoPrompt, type ShotContext } from "../src/lib/drama/media/prompts.ts";
import { indexById, pickFirstFrame, shotImageReferences, shotVideoReferences } from "../src/lib/drama/media/references.ts";
import { sentPrompt } from "../src/lib/drama/media/state.ts";
import { COLOUR_PALETTE_PRESETS, createColourHarmony, generateRandomPalette, normalizeHexColor, validateColourPalette } from "../src/lib/drama/style/colour-palettes.ts";
import { STYLE_PRESETS } from "../src/lib/drama/style/style-presets.ts";
import { getStylePresetPreview } from "../src/lib/drama/style/style-preset-previews.ts";
import type { DramaArtifact, DramaEntity, DramaShot, PropState } from "../src/lib/drama/types.ts";

const entity = (id: string, kind: DramaEntity["kind"], name: string, extra: Partial<DramaEntity> = {}): DramaEntity => ({
    id, label: id, kind, name, aliases: [], description: `${name}的设定`, appearance: "", parentId: null, sort: 0, sourceNote: "", runId: null, updatedAt: 0, rev: 1, ...extra,
});
const prop = (entityId: string, extra: Partial<PropState> = {}): PropState => ({ entityId, quantity: 1, startVisible: true, endVisible: true, startHolder: "", endHolder: "", note: "", ...extra });
const shot = (id: string, extra: Partial<DramaShot> = {}): DramaShot => ({
    id, ord: 0, seconds: 5, size: "中景", camera: "固定", description: "", dialogue: [], narration: "", transition: "cut", startState: "", endState: "",
    props: [], imagePrompt: "画面", videoPrompt: "视频", entityIds: ["hero"], updatedAt: 0, rev: 1, ...extra,
});
const sheet = (entityId: string, extra: Partial<DramaArtifact> = {}): DramaArtifact => ({
    id: `sheet-${entityId}`, entityId, shotId: null, kind: "sheet", status: "ready", mediaKey: `k-${entityId}`, mediaUrl: `/media/${entityId}.png`, mime: "image/png",
    width: null, height: null, durationMs: null, prompt: "", model: "m", params: {}, inputHash: "", providerTask: null, error: "", adopted: true, createdAt: 0, updatedAt: 0, ...extra,
});

const entities = indexById([
    entity("hero", "character", "林夏", { appearance: "短发，灰色风衣" }),
    entity("rival", "character", "陈默"),
    entity("room", "scene", "旧书店"),
    entity("sword", "prop", "长剑"),
    entity("letter", "prop", "信件"),
    entity("realm", "world", "镜之界"),
]);
const sheets = new Map(["hero", "rival", "room", "sword", "letter"].map((id) => [id, sheet(id)] as const));

const opening = shot("s1", {
    seconds: 8,
    size: "近景",
    camera: "推镜",
    description: "林夏站在柜台后。她突然拔出长剑刺向陈默，陈默倒地身亡。",
    startState: "林夏站在柜台后，双手按着桌面",
    endState: "陈默倒在血泊中",
    entityIds: ["hero", "rival", "room", "sword", "letter"],
    props: [prop("sword", { startVisible: false, endVisible: true, endHolder: "hero" }), prop("letter", { startHolder: "hero" })],
    imagePrompt: "林夏站在柜台后，神情警觉",
    videoPrompt: "林夏拔剑，猛然刺出",
    dialogue: [{ speaker: "hero", text: "你来晚了。" }],
    narration: "夜深了。",
});

const ctx = (extra: Partial<ShotContext> = {}): ShotContext => ({
    shot: opening, entities, aspect: "16:9", language: "zh-CN", useStyle: true, usePalette: true,
    style: { prompt: "水彩绘本风格，", promptEn: "watercolor picture book, " }, palette: { name: "暮色", colors: ["#112233", "#AABBCC"] }, ...extra,
});

test("shot image prompt describes only the opening instant", () => {
    const text = shotImagePrompt(ctx());
    assert.match(text, /站在柜台后/);
    assert.match(text, /水彩绘本风格/);
    assert.match(text, /#112233/);
    assert.match(text, /16:9/);
    assert.doesNotMatch(text, /刺向陈默/);
    assert.doesNotMatch(text, /拔剑/);
    assert.doesNotMatch(text, /倒在血泊/);
    assert.doesNotMatch(text, /长剑/, "prop hidden at the start is left out");
    assert.match(text, /信件（由林夏持有）/);
});

test("without an image prompt the opening is startState, never the whole description", () => {
    const text = shotImagePrompt(ctx({ shot: { ...opening, imagePrompt: "" } }));
    assert.match(text, /双手按着桌面/);
    assert.doesNotMatch(text, /刺向陈默/);
    const bare = shotImagePrompt(ctx({ shot: { ...opening, imagePrompt: "", startState: "" } }));
    assert.match(bare, /林夏站在柜台后。/);
    assert.doesNotMatch(bare, /刺向陈默/);
});

test("style and palette toggles remove their text", () => {
    const text = shotImagePrompt(ctx({ useStyle: false, usePalette: false }));
    assert.doesNotMatch(text, /水彩绘本/);
    assert.doesNotMatch(text, /#112233/);
    assert.match(shotImagePrompt(ctx({ language: "en-US" })), /watercolor picture book/);
});

test("video prompt runs start, action, end and carries colour codes and cues", () => {
    const text = shotVideoPrompt(ctx({ prev: shot("s0", { endState: "门铃响起" }) }));
    const [start, action, end] = ["开始：", "动作：", "结束："].map((label) => text.indexOf(label));
    assert.ok(start >= 0 && start < action && action < end);
    assert.match(text, /推镜|slow dolly in/);
    assert.match(text, /#112233、#AABBCC/);
    assert.match(text, /8 秒/);
    assert.match(text, /长剑/, "props that appear later are part of the video");
    assert.match(text, /口型与神态贴合台词：“你来晚了。”/);
    assert.doesNotMatch(text, /门铃响起/, "only continuous shots link to the previous end state");
    assert.match(shotVideoPrompt(ctx({ shot: { ...opening, transition: "continuous" }, prev: shot("s0", { endState: "门铃响起" }) })), /门铃响起/);
    assert.match(shotVideoPrompt(ctx({ language: "en-US" })), /slow dolly in/);
    assert.match(shotVideoPrompt(ctx()), /时长：8 秒/);
    assert.match(shotVideoPrompt(ctx({ videoSeconds: 10 })), /时长：10 秒/, "the length the model really renders is what the prompt says");
});

test("sheet prompts follow the entity kind", () => {
    const base = { style: null, palette: { name: "p", colors: ["#000000", "#FFFFFF"] }, useStyle: true, usePalette: true, language: "zh-CN" as const, aspect: "9:16" as const };
    const character = sheetPrompt({ ...base, entity: entities.get("hero")!, sideView: "right" });
    assert.equal(character.aspect, "16:9");
    assert.match(character.prompt, /左格正面全身（面朝镜头），中格右侧全身（严格 90 度侧视.*右格背面全身（背对镜头/);
    assert.match(character.prompt, /严格 90 度侧视/);
    assert.match(character.prompt, /双手空手/);
    assert.match(character.prompt, /不绘制色卡/);
    assert.equal(sheetPrompt({ ...base, entity: entities.get("sword")! }).aspect, "1:1");
    assert.equal(sheetPrompt({ ...base, entity: entities.get("room")! }).aspect, "9:16");
    assert.match(sheetPrompt({ ...base, entity: entities.get("realm")! }).prompt, /世界观氛围图/);
    assert.match(sheetPrompt({ ...base, entity: entities.get("hero")!, language: "en-US" }).prompt, /middle panel Left profile full body/);
});

test("a sheet describes how the subject looks, not its story role", () => {
    const base = { style: null, palette: null, useStyle: true, usePalette: true, language: "zh-CN" as const, aspect: "16:9" as const };
    const hero = entities.get("hero")!;
    const withLook = sheetPrompt({ ...base, entity: { ...hero, description: "账房的女儿，正在找失踪的父亲", appearance: "短发，灰色风衣" } }).prompt;
    assert.match(withLook, /外观：短发，灰色风衣/);
    assert.doesNotMatch(withLook, /失踪的父亲/);
    assert.match(sheetPrompt({ ...base, entity: { ...hero, description: "账房的女儿", appearance: "" } }).prompt, /账房的女儿/, "no appearance yet: the description is all there is");
});

test("input hash is stable under key order and sensitive to every part", () => {
    const a = inputHash({ prompt: "p", refs: ["a", "b"], model: "m", params: { x: 1, y: { b: 1, a: 2 } } });
    assert.equal(a, inputHash({ params: { y: { a: 2, b: 1 }, x: 1 }, model: "m", refs: ["a", "b"], prompt: "p" }));
    assert.notEqual(a, inputHash({ prompt: "p", refs: ["b", "a"], model: "m", params: { x: 1, y: { b: 1, a: 2 } } }));
    assert.notEqual(a, inputHash({ prompt: "p2", refs: ["a", "b"], model: "m", params: { x: 1, y: { b: 1, a: 2 } } }));
});

test("image references keep only entities visible at the opening instant", () => {
    const plan = shotImageReferences({ shot: opening, entities, sheets, language: "zh-CN" });
    assert.deepEqual(plan.images.map((image) => image.artifactId), ["sheet-hero", "sheet-rival", "sheet-room", "sheet-letter"]);
    assert.deepEqual(plan.notes[0], "图片1：人物「林夏」三视图，仅用于外观一致");
    assert.match(plan.notes[2], /^图片3：场景「旧书店」/);
    assert.match(plan.notes[3], /^图片4：道具「信件」/);
    const text = sentPrompt("image", "提示词", plan);
    assert.match(text, /^参考图片编号：图片1、图片2、图片3、图片4。/);
    assert.match(text, /图片4：道具「信件」/);
    assert.doesNotMatch(sentPrompt("video", "提示词", plan), /参考图片编号/, "video requests are not numbered by the image endpoint");
    assert.equal(sentPrompt("video", "提示词", plan), ["提示词", ...plan.notes].join("\n\n"));
});

test("a provider that takes one character reference gets the first character and no scene or prop pictures", () => {
    const plan = shotImageReferences({ shot: opening, entities, sheets, language: "zh-CN", capacity: { max: 1, kinds: ["character"] } });
    assert.deepEqual(plan.images.map((image) => image.artifactId), ["sheet-hero"]);
    assert.deepEqual(plan.notes, ["图片1：人物「林夏」三视图，仅用于外观一致"]);
    const firstFrameOnly = shotVideoReferences({ shot: opening, entities, sheets, language: "zh-CN", capacity: { max: 0 } }, { artifactId: "frame", url: "/f", storageKey: "k", name: "本镜分镜图" });
    assert.deepEqual(firstFrameOnly.images, []);
    assert.equal(firstFrameOnly.firstFrame?.artifactId, "frame");
});

test("video references add props that appear later and carry the first frame separately", () => {
    const frame = pickFirstFrame("storyboard", sheet("image", { shotId: "s1", entityId: null, kind: "image" }));
    const plan = shotVideoReferences({ shot: opening, entities, sheets, language: "zh-CN" }, frame);
    assert.ok(plan.images.some((image) => image.artifactId === "sheet-sword"));
    assert.equal(plan.firstFrame?.name, "本镜分镜图");
    assert.equal(plan.images.includes(plan.firstFrame!), false);
    assert.equal(pickFirstFrame("storyboard", undefined), undefined);
});

test("entities without a ready adopted sheet add no reference", () => {
    const partial = new Map([["hero", sheet("hero", { status: "pending", mediaUrl: "" })], ["room", sheet("room")]]);
    const plan = shotImageReferences({ shot: opening, entities, sheets: partial, language: "zh-CN" });
    assert.deepEqual(plan.images.map((image) => image.artifactId), ["sheet-room"]);
    assert.match(plan.notes[0], /^图片1：/);
});

const lintZh = (issue: LintIssue) => lintText(issue, (message, values) => translate("zh-CN", message, values));

test("lint flags the table problems and stays quiet on a clean table", () => {
    const clean = [shot("a", { camera: "推镜", size: "远景" }), shot("b", { camera: "拉镜", size: "中景" }), shot("c", { camera: "左摇", size: "近景" })];
    assert.deepEqual(lintEpisode(clean, entities, 15), []);

    const issues = lintEpisode(
        [
            shot("a", { entityIds: [], imagePrompt: "", dialogue: [{ speaker: "rival", text: "喂" }] }),
            shot("b", { entityIds: ["hero"], dialogue: [{ speaker: "rival", text: "喂" }] }),
            shot("c", {}),
        ],
        entities,
        60,
    );
    const messages = issues.map(lintZh);
    assert.ok(messages.some((m) => m.includes("第 2 镜与上一镜运镜相同")));
    assert.ok(messages.some((m) => m.includes("第 1–3 镜景别都是「中景」")));
    assert.ok(messages.some((m) => m.includes("第 1 镜没有绑定出场设定")));
    assert.ok(messages.some((m) => m.includes("第 1 镜缺少画面提示词")));
    assert.ok(messages.some((m) => m.includes("第 2 镜的说话人「陈默」没有绑定")));
    const total = issues.find((issue) => !issue.shotId);
    assert.match(lintZh(total!), /合计 15 秒，与目标 60 秒/);
    assert.equal(lintEpisode(clean, entities, 16).length, 0, "within 20% of target");
    const long = lintEpisode([shot("a", { seconds: 4, camera: "推镜", size: "远景", dialogue: [{ speaker: "hero", text: "我的黄铜钥匙呢？房东明早八点收房，迟一分钟就加一天房租。" }] })], entities, 4).map(lintZh);
    assert.ok(long.some((m) => m.includes("对白约需 6 秒，超过镜头的 4 秒")), long.join("|"));
});

test("lint compares prop state with the previous shot only for continuous shots", () => {
    const before = shot("a", { props: [prop("sword", { endVisible: true, endHolder: "hero" }), prop("letter", { quantity: 2 }), prop("realm", { endVisible: true })], camera: "推镜", size: "远景" });
    const make = (props: PropState[], transition: DramaShot["transition"] = "continuous") => lintEpisode([before, shot("b", { transition, props, camera: "拉镜", size: "中景" })], entities, 10).map(lintZh);

    assert.deepEqual(make([prop("sword", { startHolder: "hero" }), prop("letter", { quantity: 2 }), prop("realm")]), []);
    assert.ok(make([prop("sword", { startHolder: "rival" }), prop("letter", { quantity: 2 }), prop("realm")]).some((m) => m.includes("持有人（陈默）与上一镜结束时（林夏）")));
    assert.ok(make([prop("sword", { startVisible: false }), prop("letter", { quantity: 2 }), prop("realm")]).some((m) => m.includes("「长剑」不可见")));
    assert.ok(make([prop("sword", { startHolder: "hero" }), prop("letter", { quantity: 1 }), prop("realm")]).some((m) => m.includes("「信件」数量（1）与上一镜结束时（2）")));
    assert.ok(make([prop("letter", { quantity: 2 }), prop("realm")]).some((m) => m.includes("「长剑」没有出现")));
    assert.deepEqual(make([], "cut"), []);
});

test("splitChapters cuts a chapter over the limit into numbered parts at line breaks", () => {
    const line = "雨".repeat(40_000);
    const chapters = splitChapters(`第一章 长夜\n${[line, line, line, line, line].join("\n")}\n第二章 天亮\n短。`);
    assert.deepEqual(chapters.map((chapter) => chapter.title), ["第一章 长夜（1）", "第一章 长夜（2）", "第二章 天亮"]);
    assert.ok(chapters.every((chapter) => chapter.body.length <= MAX_CHAPTER_CHARS));
    assert.deepEqual(chapters.map((chapter) => chapter.body.length), [120_002, 80_001, 2], "whole lines stay together");
    const endless = splitChapters(`第一章 无尽\n${"雨".repeat(320_000)}\n第二章 完\n好。`);
    assert.deepEqual(endless.map((chapter) => chapter.body.length), [150_000, 150_000, 20_000, 2], "one endless line is cut where it must be");
});

test("splitChapters splits Chinese chapter headings", () => {
    const text = "书名\n作者：某人\n\n第一章 初遇\n夜里下雨。\n\n她推开门。\n\n第二回 重逢\n\n三年后。\n\n第十二节\n（空）\n第三章中提到的那件事，其实早就被人忘记，所以这一行是正文而不是标题，因为它太长了太长了太长了太长了太长了太长了。";
    const chapters = splitChapters(text);
    assert.deepEqual(chapters.map((c) => c.title), ["开篇", "第一章 初遇", "第二回 重逢", "第十二节"]);
    assert.equal(chapters[1].body, "夜里下雨。\n\n她推开门。");
    assert.match(chapters[3].body, /（空）\n第三章中提到/);
});

test("splitChapters understands markdown headings and English chapters, dropping empty ones", () => {
    const md = splitChapters("# 小说\n\n## Chapter 1\nHello.\n\n## Chapter 2: Rain\nWorld.\n\n## Chapter 3\n");
    assert.deepEqual(md.map((c) => c.title), ["Chapter 1", "Chapter 2: Rain"]);
    const en = splitChapters("Chapter 1\nOne.\nChapter 2\nTwo.");
    assert.deepEqual(en.map((c) => c.body), ["One.", "Two."]);
});

test("splitChapters splits scripts on scene headings only when asked", () => {
    const script = "1-1 日 内 咖啡馆\n甲：你好。\n1-2 夜 外 街道\n乙：再见。\nINT. ROOM - DAY\nHe waits.";
    assert.equal(splitChapters(script, "script").length, 3);
    assert.equal(splitChapters(script, "script")[0].title, "1-1 日 内 咖啡馆");
    assert.equal(splitChapters(script, "novel").length, 1);
});

test("splitChapters falls back to ~3000 character chunks on paragraph boundaries", () => {
    const paragraph = "这是一段没有章节标题的正文。".repeat(40);
    const text = Array.from({ length: 20 }, () => paragraph).join("\n\n");
    const chunks = splitChapters(text);
    assert.ok(chunks.length >= 3 && chunks.length <= 6);
    assert.deepEqual(chunks.map((c) => c.title).slice(0, 2), ["第 1 段", "第 2 段"]);
    for (const chunk of chunks.slice(0, -1)) assert.ok(chunk.body.length >= 3000 && chunk.body.length < 3000 + paragraph.length + 2);
    assert.ok(chunks.every((c) => c.body.startsWith("这是一段") && c.body.endsWith("。")));
    assert.equal(chunks.map((c) => c.body).join("").replace(/\s/g, ""), text.replace(/\s/g, ""));
    assert.deepEqual(splitChapters("  \n\n "), []);
});

test("palettes stay within 2-8 distinct valid colours", () => {
    let seed = 7;
    const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    for (let count = 2; count <= 8; count++) {
        const palette = generateRandomPalette(count, random);
        assert.equal(palette.colors.length, count);
        assert.equal(new Set(palette.colors).size, count);
        assert.ok(palette.colors.every((hex) => /^#[0-9A-F]{6}$/.test(hex)));
    }
    assert.equal(generateRandomPalette(1, random).colors.length, 2);
    assert.equal(generateRandomPalette(20, random).colors.length, 8);
    for (const harmony of ["analogous", "complementary", "triadic", "split-complementary", "shades"] as const) {
        const colors = createColourHarmony("#3a7bd5", harmony);
        assert.ok(colors.length >= 3 && colors.length <= 8, harmony);
    }
    assert.equal(createColourHarmony("#808080", "triadic").length >= 2, true);
    assert.ok(COLOUR_PALETTE_PRESETS.every((palette) => validateColourPalette(palette)));
});

test("hex normalisation and palette validation", () => {
    assert.equal(normalizeHexColor(" #abc "), "#AABBCC");
    assert.equal(normalizeHexColor("a1b2c3"), "#A1B2C3");
    assert.equal(normalizeHexColor("#12345"), null);
    assert.equal(normalizeHexColor(5), null);
    assert.deepEqual(validateColourPalette({ name: " 暮色 ", colors: ["#abc", "#AABBCC", "#000"] }), { name: "暮色", colors: ["#AABBCC", "#000000"] });
    assert.throws(() => validateColourPalette({ name: "x", colors: ["#abc"] }), /2–8/);
    assert.throws(() => validateColourPalette({ name: "x", colors: ["#abc", "zzz"] }), /HEX/);
});

test("every style preset has a bundled preview, including Moebius", () => {
    assert.ok(STYLE_PRESETS.some((preset) => preset.id === "moebius" && preset.name === "莫比斯" && preset.nameEn === "Moebius"));
    for (const preset of STYLE_PRESETS) assert.ok(getStylePresetPreview(preset.id)?.src.startsWith("/style-presets/"), preset.id);
});

test("staleness follows content and looks, not the video plan or template wording", () => {
    const image = (extra: Partial<ShotContext> = {}) => inputHash(shotInputs(ctx(extra), "image"));
    assert.equal(image(), image({ shot: { ...opening, videoPrompt: "完全不同的动作", endState: "另一个结局" } }), "video-only edits keep the picture current");
    assert.notEqual(image(), image({ shot: { ...opening, startState: "林夏坐在柜台后" } }));
    const restyled = indexById([...entities.values()].map((e) => (e.id === "hero" ? { ...e, appearance: "长发，红色外套" } : e)));
    assert.notEqual(image(), image({ entities: restyled }), "a changed cast look ages the picture");
    assert.notEqual(image(), image({ useStyle: false }));

    const hero = entities.get("hero")!;
    const look = { useStyle: true, usePalette: false, language: "zh-CN" as const, aspect: "16:9" as const, style: { prompt: "水彩" } };
    assert.equal(inputHash(sheetInputs({ ...look, entity: hero, sideView: "left" })), inputHash(sheetInputs({ ...look, entity: hero, sideView: "right" })));
});
