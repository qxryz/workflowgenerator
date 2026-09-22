import assert from "node:assert/strict";
import test from "node:test";

import { buildStructuredAssetReferencePrompt, structuredAssetReferencePrompt, structuredAssetSettingParts, resolveStructuredAssetReferencePrompt, STRUCTURED_PART_EXAMPLE_PROMPTS } from "../src/lib/structured-asset-reference.ts";

const image = (id: string, extra = {}) => ({ id, title: id, partId: "hero", dataUrl: `image:${id}`, width: 100, height: 100, bytes: 10, mimeType: "image/png", ...extra });
const part = (id: string, prompt: string) => ({ id, groupId: "appearance", title: "主视觉", description: "标准形象", expectedOutput: "一张图", prompt });
const source = (kind: "character" | "scene") => ({ kind, title: "小狸", description: "橙色毛绒角色", fields: { 一致性规则: "蓝色围巾", 未填写: "" }, parts: [], images: [image("hero")] });

test("default reference prompts join supplied settings and stable current image identities", () => {
    const result = buildStructuredAssetReferencePrompt({ ...source("character"), parts: [part("hero", "圆耳朵，尾巴短")], images: [image("old", { isCurrent: false }), image("front", { isCurrent: true }), image("side", { partId: "turnaround" })] });
    assert.match(result, /人物：小狸/u);
    assert.match(result, /橙色毛绒角色/u);
    assert.match(result, /一致性规则：蓝色围巾/u);
    assert.match(result, /主视觉：圆耳朵，尾巴短/u);
    assert.match(result, /@\[node:front\]/u);
    assert.match(result, /@\[node:side\]/u);
    assert.doesNotMatch(result, /node:old|未填写|写实|身高差/u);
});

test("defaults exclude unedited built-in generation examples for both asset kinds", () => {
    for (const kind of ["character", "scene"] as const) {
        const parts = [part("hero", STRUCTURED_PART_EXAMPLE_PROMPTS[kind].hero), part("custom", "门在左侧，窗在正前方")];
        assert.deepEqual(
            structuredAssetSettingParts(kind, parts).map((item) => item.id),
            ["custom"],
        );
        const result = buildStructuredAssetReferencePrompt({ ...source(kind), parts });
        assert.match(result, /门在左侧，窗在正前方/u);
        assert.doesNotMatch(result, /电影感|柔和侧逆光|广角建立镜头/u);
    }
});

test("custom reference text including an intentional empty value survives save snapshots", () => {
    for (const referencePrompt of ["", "使用 @[node:hero]，保持蓝色围巾。\n自定义要求保留原文。", "  保留空格  "]) {
        const draft = { ...source("character"), referencePrompt };
        assert.equal(structuredAssetReferencePrompt(draft), referencePrompt);
        const restored = JSON.parse(JSON.stringify(draft));
        assert.equal(structuredAssetReferencePrompt(restored), referencePrompt);
        assert.equal(structuredAssetReferencePrompt({ ...restored, description: "更新后的资料" }), referencePrompt);
    }
});

test("legacy assets generate their reference text without inventing missing settings", () => {
    const result = structuredAssetReferencePrompt({ kind: "scene", title: "小屋", description: "", fields: {}, images: [] });
    assert.equal(result, "场景：小屋");
    assert.equal(structuredAssetReferencePrompt({ kind: "character", title: "", description: "", fields: {}, images: [] }), "");
});

test("dynamic draft defaults follow current images while explicit historical references stay pinned", () => {
    const draft = { ...source("character"), images: [image("v1", { isCurrent: true }), image("v2", { isCurrent: false })] };
    const switched = { ...draft, images: draft.images.map((item) => ({ ...item, isCurrent: item.id === "v2" })) };
    assert.match(structuredAssetReferencePrompt(switched), /@\[node:v2\]/u);
    assert.doesNotMatch(structuredAssetReferencePrompt(switched), /node:v1/u);
    assert.equal(structuredAssetReferencePrompt({ ...switched, referencePrompt: "保持 @[node:v1] 的服饰" }), "保持 @[node:v1] 的服饰");
});

const collection = () => ({
    ...source("character"),
    collectionVersion: 1 as const,
    avatarImageId: "portrait",
    parts: [part("overview", "住在森林，喜欢邮递"), part("appearance", "圆耳朵"), { ...part("coat", "红色披风"), enabled: false }, part("empty", "")],
    images: [image("portrait", { partId: "avatar" }), image("front", { partId: "appearance" }), image("old", { partId: "appearance", isCurrent: false }), image("red", { partId: "coat" }), image("loose", { partId: undefined })],
    relationships: [{ id: "r1", targetAssetId: "other", targetName: "小熊", label: "邻居" }],
});

test("collection defaults collect only enabled materials and relationships, excluding display identity", () => {
    const prompt = structuredAssetReferencePrompt(collection());
    assert.equal(prompt, "@[node:overview]\n@[node:appearance]\nloose：@[node:loose]\n@[node:relationships]");
    const resolved = resolveStructuredAssetReferencePrompt(collection());
    assert.match(resolved, /主视觉：住在森林，喜欢邮递/u);
    assert.match(resolved, /圆耳朵[\s\S]*@\[node:front\]/u);
    assert.match(resolved, /小熊：邻居/u);
    assert.doesNotMatch(resolved, /橙色毛绒|蓝色围巾|portrait|红色披风|node:red|node:old|node:empty|node:overview|node:relationships/u);
});

test("collection templates resolve nested selections but cannot opt into disabled parts or avatars", () => {
    const asset = collection();
    asset.parts[0].prompt = "参照 @[node:appearance]；@[node:coat]；@[node:red]；@[node:portrait]";
    const result = resolveStructuredAssetReferencePrompt({ ...asset, referencePrompt: "@[node:overview]；@[node:missing]" });
    assert.match(result, /圆耳朵/u);
    assert.match(result, /@\[node:front\]/u);
    assert.match(result, /@\[node:missing\]/u);
    assert.doesNotMatch(result, /红色披风|node:coat|node:red|node:portrait|小熊/u);
});

test("collection resolution preserves empty templates and broken cycles while excluding unselected images", () => {
    const asset = collection();
    asset.parts[0].prompt = "@[node:appearance]";
    asset.parts[1].prompt = "@[node:overview]";
    const result = resolveStructuredAssetReferencePrompt({ ...asset, referencePrompt: "@[node:overview] @[node:old]" });
    assert.match(result, /@\[node:overview\]/u);
    assert.doesNotMatch(result, /@\[node:old\]/u);
    assert.ok(result.length < 300);
    assert.equal(resolveStructuredAssetReferencePrompt({ ...asset, referencePrompt: "" }), "");
    assert.equal(resolveStructuredAssetReferencePrompt({ ...asset, parts: asset.parts.map((item) => ({ ...item, enabled: false })), images: [], relationships: [] }), "");
    const legacy = { ...source("character"), images: [image("hero", { isCurrent: false })], referencePrompt: "保持 @[node:hero] 的形象" };
    assert.equal(resolveStructuredAssetReferencePrompt(legacy), legacy.referencePrompt);
});

test("relationship references preserve original direction on both endpoints", () => {
    const relationship = { id: "r", targetAssetId: "b", targetName: "乙", label: "父亲", sourceAssetId: "a", sourceName: "甲" };
    const a = { ...collection(), title: "甲", relationships: [relationship], referencePrompt: "人物关系：@[node:relationships]" };
    const b = { ...a, title: "乙", relationships: [{ ...relationship, targetAssetId: "a", targetName: "甲" }] };
    assert.equal(resolveStructuredAssetReferencePrompt(a), "人物关系：甲 → 乙：父亲");
    assert.equal(resolveStructuredAssetReferencePrompt(b), "人物关系：甲 → 乙：父亲");
});

test("voice collection references include selected audio files and voice notes in order", () => {
    const draft = {
        ...collection(),
        parts: [part("voice", "声音低沉，语速慢")],
        audios: [
            { id: "voice-a", title: "日常对白", partId: "voice", url: "voice.wav", bytes: 20, mimeType: "audio/wav" },
            { id: "voice-b", title: "未选录音", partId: "voice", url: "other.wav", bytes: 20, mimeType: "audio/wav", isCurrent: false },
        ],
        referencePrompt: "说话参考 @[node:voice]，@[node:voice-b]",
    };
    assert.match(resolveStructuredAssetReferencePrompt(draft), /声音低沉，语速慢\n日常对白：@\[node:voice-a\]/);
    assert.doesNotMatch(resolveStructuredAssetReferencePrompt(draft), /voice-b/);
    assert.match(buildStructuredAssetReferencePrompt({ ...draft, referencePrompt: undefined }), /node:voice/);
});
