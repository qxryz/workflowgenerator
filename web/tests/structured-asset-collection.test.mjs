import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";
registerHooks({
    resolve(specifier, context, next) {
        if (specifier.startsWith("@/")) return next(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return next(specifier, context);
    },
});
const { createStructuredAssetDraft, normalizeStructuredAssetDraft, structuredAssetToDraft, structuredAssetPayload, removeCollectionImage, removeCollectionPart, moveCollectionImage } = await import("../src/pages/image/structured-asset-collection.ts");
const { STRUCTURED_PART_EXAMPLE_PROMPTS, resolveStructuredAssetReferencePrompt } = await import("../src/lib/structured-asset-reference.ts");
const image = (id, partId, isCurrent = true) => ({ id, title: id, partId, isCurrent, storageKey: `image:${id}`, dataUrl: `saved:${id}`, width: 10, height: 10, bytes: 20, mimeType: "image/png" });

test("new character and scene collections contain no generation instructions and support text-only assets", () => {
    for (const kind of ["character", "scene"]) {
        const draft = createStructuredAssetDraft(kind);
        assert.ok(draft.parts.every((part) => !part.prompt && !part.expectedOutput));
        draft.title = "展示名字";
        draft.description = "仅作查找";
        assert.equal(draft.referencePrompt, "");
        draft.parts[0].prompt = "实际设定";
        draft.referencePrompt = `遵循 @[node:${draft.parts[0].id}]`;

        const saved = structuredAssetPayload(draft);
        assert.equal(saved.data.collectionVersion, 1);
        assert.equal(saved.data.images.length, 0);
        assert.match(resolveStructuredAssetReferencePrompt({ ...saved.data, kind, title: saved.title }), /实际设定/);
        assert.doesNotMatch(resolveStructuredAssetReferencePrompt({ ...saved.data, kind, title: saved.title }), /展示名字|仅作查找/);
    }
});

test("legacy assets retain authored text, images, historical choices and custom parts while dropping generation examples", () => {
    const asset = {
        id: "old",
        kind: "character",
        title: "噜噜",
        coverUrl: "saved:main",
        tags: [],
        data: {
            description: "黄色水豚",
            fields: { 服装: "橙色短裤" },
            referencePrompt: "采用 @[node:historic]",
            images: [image("main", "hero"), image("historic", "hero", false), image("custom", "custom")],
            parts: [
                { id: "hero", groupId: "appearance", title: "主视觉", prompt: STRUCTURED_PART_EXAMPLE_PROMPTS.character.hero },
                { id: "custom", groupId: "unknown", title: "特殊参考", prompt: "圆圆的手" },
            ],
        },
    };
    const draft = structuredAssetToDraft("character", asset);
    assert.equal(draft.parts.find((part) => part.id === "hero").prompt, "");
    assert.match(draft.parts.find((part) => part.id === "legacy-overview").prompt, /黄色水豚[\s\S]*橙色短裤/);
    assert.equal(draft.parts.find((part) => part.id === "custom").prompt, "圆圆的手");
    assert.equal(draft.parts.find((part) => part.id === "custom").groupId, "other");
    assert.equal(draft.images.find((item) => item.id === "historic").isCurrent, true);
    assert.equal(draft.images.find((item) => item.id === "main").partId, "hero");
    assert.notEqual(draft.avatarImageId, "main");
    assert.equal(draft.images.find((item) => item.id === draft.avatarImageId).storageKey, "image:main");
    assert.equal(structuredAssetPayload(draft).coverUrl, "saved:main");
    assert.match(resolveStructuredAssetReferencePrompt(draft), /@\[node:historic\]/);
    assert.doesNotMatch(resolveStructuredAssetReferencePrompt(draft), /avatar-/);
    assert.deepEqual(normalizeStructuredAssetDraft("character", draft), draft);
});

test("removing a collection item does not delete collected files or recreate empty sections after reload", () => {
    let draft = createStructuredAssetDraft("character");
    draft.images = [image("coat", "default-outfit")];
    draft.referencePrompt = "服装 @[node:default-outfit]";
    draft = removeCollectionPart(draft, "default-outfit");
    assert.ok(!draft.parts.some((part) => part.id === "default-outfit"));
    assert.equal(draft.images[0].partId, "other-images");
    assert.equal(draft.images[0].storageKey, "image:coat");
    assert.doesNotMatch(draft.referencePrompt, /default-outfit/);
    const restored = normalizeStructuredAssetDraft("character", draft);
    assert.ok(!restored.parts.some((part) => part.id === "default-outfit"));
    const removedOther = removeCollectionPart(restored, "other-images");
    assert.ok(removedOther.parts.some((part) => part.id === removedOther.images[0].partId));
});

test("explicit empty reference, disabled selections and independent draft kinds survive persistence", () => {
    const draft = createStructuredAssetDraft("character");
    draft.parts[0].prompt = "资料";
    draft.parts.find((part) => part.id === "default-outfit").enabled = false;
    draft.referencePrompt = "";
    const restored = normalizeStructuredAssetDraft("character", structuredAssetToDraft("character", { ...structuredAssetPayload(draft), id: "saved" }));
    assert.equal(resolveStructuredAssetReferencePrompt(restored), "");
    assert.equal(restored.parts.find((part) => part.id === "default-outfit").enabled, false);
    assert.equal(normalizeStructuredAssetDraft("scene", draft).kind, "scene");
    assert.ok(!normalizeStructuredAssetDraft("scene", draft).parts.some((part) => part.prompt === "资料"));
});

test("image removal clears its reference and avatar, and ordering only moves within a collection", () => {
    const draft = createStructuredAssetDraft("character");
    draft.images = [image("a", "hero"), image("b", "detail-sheet"), image("c", "hero")];
    draft.avatarImageId = "a";
    draft.referencePrompt = "@[node:a] @[node:c]";
    const removed = removeCollectionImage(draft, "a");
    assert.equal(removed.avatarImageId, undefined);
    assert.equal(removed.referencePrompt.trim(), "@[node:c]");
    assert.deepEqual(
        moveCollectionImage(draft.images, "c", -1).map((item) => item.id),
        ["c", "b", "a"],
    );
    assert.deepEqual(moveCollectionImage(draft.images, "a", -1), draft.images);
});

test("pending draft edits survive reload but are not exported as asset business data", () => {
    const draft = { ...createStructuredAssetDraft("character"), title: "Pending", pendingChanges: true };
    draft.parts[0].prompt = "Unsaved overview";
    const restored = normalizeStructuredAssetDraft("character", JSON.parse(JSON.stringify(draft)));
    assert.equal(restored.pendingChanges, true);
    assert.equal(restored.parts[0].prompt, "Unsaved overview");
    assert.equal(Object.hasOwn(structuredAssetPayload(restored).data, "pendingChanges"), false);
});

test("voice collection migration and removal keep audio files reachable", () => {
    const old = { ...createStructuredAssetDraft("character"), audios: undefined, parts: [] };
    const migrated = normalizeStructuredAssetDraft("character", old);
    assert.ok(migrated.parts.some((part) => part.id === "voice-profile"));
    const draft = { ...migrated, audios: [{ id: "sample", title: "声音", partId: "voice-profile", url: "voice.wav", bytes: 2, mimeType: "audio/wav" }] };
    const removed = removeCollectionPart(draft, "voice-profile");
    assert.equal(removed.audios.length, 1);
    assert.ok(removed.parts.some((part) => part.id === removed.audios[0].partId));
    assert.ok(!normalizeStructuredAssetDraft("character", removed).parts.some((part) => part.id === "voice-profile"));
});
