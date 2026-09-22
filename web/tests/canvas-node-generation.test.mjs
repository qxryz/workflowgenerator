import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import test from "node:test";

const imageReads = [];
globalThis.__canvasReferenceImageReads = imageReads;
const mocks = new Map([
    ["@/types/canvas", 'export const CanvasNodeType = { Image: "image", Text: "text", File: "file", Config: "config", Video: "video", Audio: "audio", Terminal: "terminal", Group: "group" };'],
    ["@/stores/use-config-store", "export const resolveModelRequestConfig = (config) => config;"],
    ["@/lib/canvas/node-registry", 'export const getNodeDefinition = (type) => type === "custom-image" ? { resource: (node) => node.metadata.resource } : undefined;'],
    [
        "@/services/image-storage",
        `export async function imageToDataUrl(image) {
            globalThis.__canvasReferenceImageReads.push(image);
            if (image.storageKey === "image:missing") return "";
            if (image.storageKey === "image:invalid") return "data:text/html;base64,ZXJyb3I=";
            if (image.storageKey === "image:unreadable") throw new Error("Load failed");
            return image.storageKey ? "data:image/png;base64,cGljdHVyZQ==" : image.dataUrl;
        }`,
    ],
]);
registerHooks({
    resolve(specifier, context, nextResolve) {
        const source = mocks.get(specifier);
        if (source !== undefined) return { url: `data:text/javascript,${encodeURIComponent(source)}`, shortCircuit: true };
        if (specifier.startsWith("@/")) return nextResolve(new URL(`../src/${specifier.slice(2)}.ts`, import.meta.url).href, context);
        return nextResolve(specifier, context);
    },
});

const { assertNodeGenerationContextSupported, buildNodeGenerationContext, buildNodeGenerationContextFromInputs, buildNodeImageGenerationContext, buildNodeResponseMessages, hydrateNodeGenerationContext } =
    await import("../src/components/canvas/canvas-node-generation.ts");
const { buildNodeMentionReferences } = await import("../src/lib/canvas/canvas-resource-references.ts");

function node(id, type, metadata = {}) {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 300, height: 200, metadata };
}

const imageA = { nodeId: "character-a", title: "角色 A", type: "image", ready: true, image: { id: "a", name: "角色 A.png", type: "image/png", dataUrl: "data:image/png;base64,YQ==" } };
const characterText = { nodeId: "character-text", title: "角色设定", type: "text", ready: true, text: "橘色毛绒，粉色衣服" };
const action = node("generate", "config", { composerContent: "生成" });

test("generation rejects missing and pending explicit references instead of removing their tokens", () => {
    assert.throws(() => buildNodeGenerationContextFromInputs(action, [imageA], "使用 @[node:missing]"), /引用.*missing/);
    assert.throws(() => buildNodeGenerationContextFromInputs(action, [{ ...imageA, ready: false }], "使用 @[node:character-a]"), /引用.*角色 A/);
});

test("reference tokens work for a persisted prompt without composerContent and for ordinary nodes", () => {
    for (const source of [node("generate", "config", { prompt: "生成" }), node("generate", "text")]) {
        const context = buildNodeGenerationContextFromInputs(source, [imageA, characterText], "参考 @[node:character-a]");
        assert.equal(context.prompt, "参考 图片1\n\n素材对应\n图片1：角色 A");
        assert.equal(context.textCount, 0);
        assert.deepEqual(context.referenceImages, [imageA.image]);
        assert.throws(() => buildNodeGenerationContextFromInputs(source, [imageA], "参考 @[node:missing]"), /引用.*missing/);
    }
});

test("explicit selection keeps prompt order and includes only the selected character text and image", () => {
    const context = buildNodeGenerationContextFromInputs(action, [characterText, imageA], "参考 @[node:character-a]，遵循 @[node:character-text]，再看 @[node:character-a]");
    assert.match(context.prompt, /^参考 图片1，遵循 【文本1】，再看 图片1/);
    assert.match(context.prompt, /橘色毛绒，粉色衣服/);
    assert.equal(context.imageCount, 1);
    assert.equal(context.textCount, 1);
    const imageOnly = buildNodeGenerationContextFromInputs(action, [characterText, imageA], "参考 @[node:character-a]");
    assert.equal(imageOnly.textCount, 0);
});

test("generation with implicit direct inputs rejects an unavailable input", () => {
    assert.throws(() => buildNodeGenerationContextFromInputs(action, [imageA, { ...characterText, ready: false }], "生成短片"), /上游.*角色设定/);
    assert.throws(() => buildNodeGenerationContextFromInputs(action, [{ ...imageA, image: undefined }], "参考 @[node:character-a]"), /引用.*角色 A/);
});

test("restored images with a storage key remain actual references before preview hydration", async () => {
    const image = node("character-a", "image", { storageKey: "image:character-a", status: "success", bytes: 1200, naturalWidth: 512, naturalHeight: 768 });
    const unrelated = node("other", "image", { content: "data:image/png;base64,b3RoZXI=" });
    const context = buildNodeGenerationContext(action.id, [action, image, unrelated], [{ id: "input", fromNodeId: image.id, toNodeId: action.id }], "保持角色一致");
    assert.equal(context.imageCount, 1);
    assert.equal(context.referenceImages[0].storageKey, "image:character-a");
    assert.equal(context.referenceImages[0].bytes, 1200);
    assert.equal(context.referenceImages[0].width, 512);
    assert.equal(context.referenceImages[0].height, 768);
    const hydrated = await hydrateNodeGenerationContext(context);
    assert.equal(hydrated.referenceImages[0].dataUrl, "data:image/png;base64,cGljdHVyZQ==");
    assert.deepEqual(
        hydrated.referenceImages.map((reference) => reference.id),
        ["character-a"],
    );
});

test("a reference elsewhere on the canvas is never silently inferred as an upstream", () => {
    const image = node("character-a", "image", { content: imageA.image.dataUrl });
    assert.throws(() => buildNodeGenerationContext(action.id, [action, image], [], "参考 @[node:character-a]"), /引用.*character-a/);
});

test("plugin-declared storage keys agree between visible references and actual generation inputs", () => {
    const image = node("custom-reference", "custom-image", { resource: { kind: "image", storageKey: "image:custom", mimeType: "image/webp", bytes: 400 } });
    const nodes = [action, image];
    const connections = [{ id: "input", fromNodeId: image.id, toNodeId: action.id }];
    const [reference] = buildNodeMentionReferences(action, nodes, connections);
    const context = buildNodeGenerationContext(action.id, nodes, connections, "保持角色一致");
    assert.equal(reference.ready, true);
    assert.equal(reference.storageKey, "image:custom");
    assert.equal(reference.inputRevision, "image:custom");
    assert.equal(context.referenceImages[0].storageKey, reference.storageKey);
    assert.equal(context.referenceImages[0].type, "image/webp");
    assert.equal(context.referenceImages[0].bytes, 400);
});

test("failed or non-image hydration identifies the missing reference and aborts generation", async () => {
    for (const storageKey of ["image:missing", "image:invalid", "image:unreadable"]) {
        const context = buildNodeGenerationContextFromInputs(action, [{ ...imageA, image: { ...imageA.image, storageKey } }], "生成");
        await assert.rejects(() => hydrateNodeGenerationContext(context), /角色 A.*读取失败/);
    }
});

test("editing an existing image keeps upstream character references and their prompt numbering", async () => {
    const source = node("scene", "image", { storageKey: "image:scene", status: "success" });
    const context = buildNodeGenerationContextFromInputs(source, [imageA, characterText], "让角色 @[node:character-a] 出现在画面中，遵循 @[node:character-text]");
    const editContext = buildNodeImageGenerationContext(source, context);
    assert.deepEqual(
        editContext.referenceImages.map((image) => image.id),
        ["a", "scene"],
    );
    assert.equal(editContext.imageCount, 2);
    assert.match(editContext.prompt, /角色 图片1/);
    assert.match(editContext.prompt, /编辑目标：图片2/);
    assert.match(editContext.prompt, /橘色毛绒/);
    assert.equal((await hydrateNodeGenerationContext(editContext)).referenceImages[1].dataUrl, "data:image/png;base64,cGljdHVyZQ==");
    assert.equal(context.referenceImages.length, 1, "the pre-edit context is not mutated");
});

test("editing with an already included source preserves a single reference", () => {
    const source = node("a", "image", { content: imageA.image.dataUrl });
    const context = buildNodeGenerationContextFromInputs(source, [imageA], "修改颜色");
    const editContext = buildNodeImageGenerationContext(source, context);
    assert.deepEqual(editContext.referenceImages, context.referenceImages);
    assert.equal(editContext.imageCount, 1);
});

test("plugin image generation uses the shared context without treating upstream character text as an image", () => {
    const source = node("panorama", "custom-image");
    const image = node("character-a", "image", { content: imageA.image.dataUrl });
    const text = node("character-text", "text", { content: characterText.text });
    const context = buildNodeGenerationContext(
        source.id,
        [source, image, text],
        [
            { id: "image-input", fromNodeId: image.id, toNodeId: source.id },
            { id: "text-input", fromNodeId: text.id, toNodeId: source.id },
        ],
        "全景图。保持角色设定",
    );
    assert.equal(context.imageCount, 1);
    assert.equal(context.textCount, 1);
    assert.match(context.prompt, /橘色毛绒/);
    assert.equal(context.referenceImages[0].dataUrl, imageA.image.dataUrl);
});

test("default generation sends the numbered character titles with the actual images and complete descriptions", async () => {
    const sister = { ...imageA, title: "噜噜妹·主视觉" };
    const sisterText = { ...characterText, title: "噜噜妹·资料", text: "粉色衣服\n表情活泼\n保留发饰" };
    const brother = { ...imageA, nodeId: "character-b", title: "噜噜哥·主视觉", image: { ...imageA.image, id: "b", dataUrl: "data:image/png;base64,Yg==" } };
    const brotherText = { ...characterText, nodeId: "brother-text", title: "噜噜哥·资料", text: "橘色毛绒\n蓝色围巾" };
    const context = await hydrateNodeGenerationContext(buildNodeGenerationContextFromInputs(action, [sisterText, sister, brother, brotherText], "编写恋爱日常分镜"));
    const [{ content }] = buildNodeResponseMessages(context);
    const prompt = content[0].text;
    assert.match(prompt, /图片1：噜噜妹·主视觉/);
    assert.match(prompt, /图片2：噜噜哥·主视觉/);
    assert.match(prompt, /文本1：噜噜妹·资料/);
    assert.match(prompt, /文本2：噜噜哥·资料/);
    assert.ok(prompt.includes(sisterText.text));
    assert.ok(prompt.includes(brotherText.text));
    assert.deepEqual(
        content.slice(1).map((part) => part.image_url.url),
        [sister.image.dataUrl, brother.image.dataUrl],
    );
    assert.doesNotMatch(prompt, /data:image|image_url|storageKey/);
});

test("explicit reference title mapping follows token order rather than canvas order and excludes unused assets", () => {
    const sister = { ...imageA, title: "噜噜妹·主视觉" };
    const brother = { ...imageA, nodeId: "character-b", title: "噜噜哥·主视觉", image: { ...imageA.image, id: "b", dataUrl: "data:image/png;base64,Yg==" } };
    const sisterText = { ...characterText, title: "噜噜妹·资料" };
    const unused = { ...characterText, nodeId: "unused", title: "无关角色资料", text: "不应传输的设定" };
    const context = buildNodeGenerationContextFromInputs(action, [sister, sisterText, brother, unused], "先看 @[node:character-b]，再看 @[node:character-a] 和 @[node:character-text]，最后 @[node:character-b]");
    const [{ content }] = buildNodeResponseMessages(context);
    const prompt = content[0].text;
    assert.match(prompt, /^先看 图片1，再看 图片2 和 【文本1】，最后 图片1/);
    assert.match(prompt, /图片1：噜噜哥·主视觉/);
    assert.match(prompt, /图片2：噜噜妹·主视觉/);
    assert.match(prompt, /文本1：噜噜妹·资料/);
    assert.equal(prompt.match(/图片1：噜噜哥·主视觉/g)?.length, 1);
    assert.ok(prompt.includes(sisterText.text));
    assert.doesNotMatch(prompt, /无关角色|不应传输|data:image/);
    assert.deepEqual(
        content.slice(1).map((part) => part.image_url.url),
        [brother.image.dataUrl, sister.image.dataUrl],
    );
});

test("mixed media titles use independent reference counters in the same order as their request arrays", () => {
    const video = { nodeId: "movement", title: "双人互动·动作参考", type: "video", ready: true, video: { id: "movement", name: "动作.mp4", type: "video/mp4", url: "https://example.com/movement.mp4" } };
    const audio = { nodeId: "voice", title: "噜噜妹·声音", type: "audio", ready: true, audio: { id: "voice", name: "声音.mp3", type: "audio/mpeg", url: "https://example.com/voice.mp3" } };
    for (const prompt of ["生成短片", "参考 @[node:voice]，@[node:character-a] 和 @[node:movement]"]) {
        const context = buildNodeGenerationContextFromInputs(action, [video, imageA, audio], prompt);
        assert.match(context.prompt, /视频1：双人互动·动作参考/);
        assert.match(context.prompt, /音频1：噜噜妹·声音/);
        assert.match(context.prompt, /图片1：角色 A/);
        assert.deepEqual(context.referenceVideos, [video.video]);
        assert.deepEqual(context.referenceAudios, [audio.audio]);
        assert.doesNotMatch(context.prompt, /https:\/\/example.com/);
    }
});

test("a group token expands its full reference set while an overlapping leaf is sent once", () => {
    const group = node("character", "group");
    const inner = node("views", "group", { groupId: group.id });
    const image = node("character-a", "image", { content: imageA.image.dataUrl, groupId: inner.id });
    const details = node("character-text", "text", { content: characterText.text, groupId: group.id });
    const context = buildNodeGenerationContext(
        action.id,
        [action, group, inner, image, details],
        [
            { id: "group-input", fromNodeId: group.id, toNodeId: action.id },
            { id: "leaf-input", fromNodeId: image.id, toNodeId: action.id },
        ],
        "结合 @[node:character]，保持 @[node:character-a]",
    );
    assert.match(context.prompt, /^结合 「character」（图片1、【文本1】），保持 图片1/);
    assert.equal(context.imageCount, 1);
    assert.equal(context.textCount, 1);
    assert.ok(context.prompt.includes(characterText.text));
    assert.doesNotMatch(context.prompt, /@\[node:/);
});

test("group identities distinguish identical member titles in the actual request and preserve leaf labels", () => {
    const first = { ...node("fox", "group", { groupPrompt: "橘色毛绒，服装参考 @[node:fox-front]" }), title: "人物 · 小狸" };
    const second = { ...node("deer", "group", { groupPrompt: "粉色衣服，造型参考 @[node:deer-front]" }), title: "人物 · 小鹿" };
    const firstImage = { ...node("fox-front", "image", { groupId: first.id, content: "data:image/png;base64,YQ==" }), title: "主视觉" };
    const secondImage = { ...node("deer-front", "image", { groupId: second.id, content: "data:image/png;base64,Yg==" }), title: "主视觉" };
    const nodes = [action, first, firstImage, second, secondImage];
    const edges = [
        { id: "fox-input", fromNodeId: first.id, toNodeId: action.id },
        { id: "deer-input", fromNodeId: second.id, toNodeId: action.id },
    ];
    const context = buildNodeGenerationContext(action.id, nodes, edges, "让 @[node:deer] 与 @[node:fox] 互动，保留 @[node:fox-front]");
    const [{ content }] = buildNodeResponseMessages(context);
    assert.match(content[0].text, /^让 「人物 · 小鹿」（【文本1】、图片1） 与 「人物 · 小狸」（【文本2】、图片2） 互动，保留 图片2/);
    assert.match(content[0].text, /粉色衣服，造型参考 图片1/);
    assert.match(content[0].text, /橘色毛绒，服装参考 图片2/);
    assert.deepEqual(
        content.slice(1).map((part) => part.image_url.url),
        [secondImage.metadata.content, firstImage.metadata.content],
    );

    const implicit = buildNodeGenerationContext(action.id, nodes, edges, "让两个人物互动");
    assert.match(implicit.prompt, /「人物 · 小狸」：文本1、图片1/);
    assert.match(implicit.prompt, /「人物 · 小鹿」：文本2、图片2/);
});

test("a pending group member and an empty group reject generation without silently dropping references", () => {
    const group = node("character", "group");
    const image = node("portrait", "image", { content: imageA.image.dataUrl, groupId: group.id });
    const pending = node("description", "text", { groupId: group.id });
    const edges = [{ id: "input", fromNodeId: group.id, toNodeId: action.id }];
    assert.throws(() => buildNodeGenerationContext(action.id, [action, group, image, pending], edges, "使用 @[node:character]"), /不可用|尚未就绪/);
    assert.throws(() => buildNodeGenerationContext(action.id, [action, group], edges, "使用 @[node:character]"), /不可用|尚未就绪/);
});

test("file inputs explicitly reject generation both individually and as group members", () => {
    const group = node("character", "group");
    const file = node("archive", "file", { storageKey: "file:archive", groupId: group.id });
    for (const fromNodeId of [group.id, file.id]) {
        assert.throws(() => buildNodeGenerationContext(action.id, [action, group, file], [{ id: "input", fromNodeId, toNodeId: action.id }], `使用 @[node:${fromNodeId}]`), /文件.*不能|不支持.*文件/);
    }
});

test("virtual group text resolves its internal references using the final image ordering", () => {
    const portrait = { ...imageA, bindingNodeIds: ["character"] };
    const other = { ...imageA, nodeId: "other", title: "其他角色", image: { ...imageA.image, id: "other", dataUrl: "data:image/png;base64,Yg==" } };
    const groupPrompt = { nodeId: "character", bindingNodeIds: ["character"], type: "text", title: "角色说明", ready: true, resolveTextReferences: true, text: "造型遵循 @[node:character-a]，保留完整设定" };
    const context = buildNodeGenerationContextFromInputs(action, [groupPrompt, portrait, other], "先用 @[node:other]，再用 @[node:character]");
    assert.deepEqual(
        context.referenceImages.map((image) => image.id),
        ["other", "a"],
    );
    assert.match(context.prompt, /造型遵循 图片2，保留完整设定/);
    assert.doesNotMatch(context.prompt, /@\[node:/);
});

test("group prompt chooses and orders internal assets without leaking unused members or raw tokens", () => {
    const group = node("character", "group", { groupPrompt: "主视图 @[node:side]，辅助 @[node:front]，保持粉色服装" });
    const front = node("front", "image", { groupId: group.id, content: "data:image/png;base64,ZnJvbnQ=" });
    const side = node("side", "image", { groupId: group.id, content: "data:image/png;base64,c2lkZQ==" });
    const unused = node("unused", "image", { groupId: group.id, content: "data:image/png;base64,dW51c2Vk" });
    for (const prompt of ["使用 @[node:character]", "组合这些素材"]) {
        const context = buildNodeGenerationContext(action.id, [action, group, front, side, unused], [{ id: "input", fromNodeId: group.id, toNodeId: action.id }], prompt);
        assert.deepEqual(
            context.referenceImages.map((image) => image.id),
            ["side", "front"],
        );
        assert.match(context.prompt, /主视图 图片1，辅助 图片2，保持粉色服装/);
        assert.doesNotMatch(context.prompt, /@\[node:|unused/);
    }
});

test("nested group prompts retain both written instructions and reject unknown internal references", () => {
    const outer = node("cast", "group", { groupPrompt: "人物遵循 @[node:character]" });
    const inner = node("character", "group", { groupId: outer.id, groupPrompt: "服装采用 @[node:portrait]，不要变色" });
    const portrait = node("portrait", "image", { groupId: inner.id, content: imageA.image.dataUrl });
    const connections = [{ id: "input", fromNodeId: outer.id, toNodeId: action.id }];
    const context = buildNodeGenerationContext(action.id, [action, outer, inner, portrait], connections, "使用 @[node:cast]");
    assert.equal(context.imageCount, 1);
    assert.equal(context.textCount, 2);
    assert.match(context.prompt, /服装采用 图片1，不要变色/);
    assert.doesNotMatch(context.prompt, /@\[node:/);
    const invalid = { ...inner, metadata: { ...inner.metadata, groupPrompt: "采用 @[node:missing]" } };
    assert.throws(() => buildNodeGenerationContext(action.id, [action, outer, invalid, portrait], connections, "使用 @[node:cast]"), /不可用|尚未就绪/);
});

test("request mode validation prevents selected video and audio from disappearing in image or text requests", () => {
    const context = buildNodeGenerationContextFromInputs(action, [characterText, imageA], "生成");
    for (const mode of ["image", "text"]) {
        assert.doesNotThrow(() => assertNodeGenerationContextSupported(mode, context));
        assert.throws(() => assertNodeGenerationContextSupported(mode, { ...context, referenceVideos: [{ id: "motion", name: "动作.mp4", type: "video/mp4", url: "https://example.com/motion.mp4" }] }), /不支持.*视频|不能.*视频/);
        assert.throws(() => assertNodeGenerationContextSupported(mode, { ...context, referenceAudios: [{ id: "voice", name: "声音.mp3", type: "audio/mpeg", url: "https://example.com/voice.mp3" }] }), /不支持.*音频|不能.*音频/);
    }
});

test("video accepts multimodal context while TTS refuses every media kind as a voice reference", () => {
    const context = buildNodeGenerationContextFromInputs(action, [characterText], "念出台词");
    const media = [
        { referenceImages: [imageA.image] },
        { referenceVideos: [{ id: "motion", name: "动作.mp4", type: "video/mp4", url: "https://example.com/motion.mp4" }] },
        { referenceAudios: [{ id: "voice", name: "声音.mp3", type: "audio/mpeg", url: "https://example.com/voice.mp3" }] },
    ];
    assert.doesNotThrow(() => assertNodeGenerationContextSupported("audio", context));
    for (const references of media) {
        assert.doesNotThrow(() => assertNodeGenerationContextSupported("video", { ...context, ...references }));
        assert.throws(() => assertNodeGenerationContextSupported("audio", { ...context, ...references }), /语音.*文字.*不能|不能.*语音参考/);
    }
});

test("mode validation checks the actual selected context rather than unused upstream candidates", () => {
    const voice = { nodeId: "voice", type: "audio", title: "声音", ready: true, audio: { id: "voice", name: "声音.mp3", type: "audio/mpeg", url: "https://example.com/voice.mp3" } };
    const inputs = [characterText, imageA, voice];
    const imageContext = buildNodeGenerationContextFromInputs(action, inputs, "参考 @[node:character-a] 和 @[node:character-text]");
    const audioContext = buildNodeGenerationContextFromInputs(action, inputs, "念出 @[node:character-text]");
    assert.doesNotThrow(() => assertNodeGenerationContextSupported("image", imageContext));
    assert.doesNotThrow(() => assertNodeGenerationContextSupported("audio", audioContext));
    assert.throws(() => assertNodeGenerationContextSupported("audio", imageContext), /图片/);
    const grouped = buildNodeGenerationContextFromInputs(
        action,
        inputs.map((input) => ({ ...input, bindingNodeIds: ["character"] })),
        "使用 @[node:character]",
    );
    assert.throws(() => assertNodeGenerationContextSupported("image", grouped), /音频/);
});
