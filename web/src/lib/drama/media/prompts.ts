import type { AppLanguage } from "@/lib/i18n";
import { CAMERA_MOVES, SHOT_SIZES, promptTerm } from "@/lib/drama/labels";
import type { DramaAspect, DramaEntity, DramaPalette, DramaProject, DramaShot, DramaStyle, PropState } from "../types";
import { shotCast, type EntityMap } from "@/lib/drama/media/references";

export type Look = { style?: DramaStyle | null; palette?: DramaPalette | null; useStyle: boolean; usePalette: boolean; language: AppLanguage };
export type SheetInput = Look & { entity: DramaEntity; aspect: DramaAspect; sideView?: "left" | "right" };
/** `videoSeconds`: the length the video model will really render, when it cannot take the shot's own. */
export type ShotContext = Look & { shot: DramaShot; prev?: DramaShot; entities: EntityMap; aspect: DramaAspect; videoSeconds?: number };

/** Whether the drama has a style / a palette to switch on; the one place that decides it. */
export const lookAvailable = (project: Pick<DramaProject, "style" | "palette">) => ({
    hasStyle: Boolean(project.style && (project.style.prompt.trim() || project.style.promptEn?.trim())),
    hasPalette: Boolean(project.palette?.colors.length),
});

const isEn = (look: Look) => look.language === "en-US";

function styleText(look: Look): string {
    if (!look.useStyle || !look.style) return "";
    const { prompt, promptEn } = look.style;
    return ((isEn(look) ? promptEn || prompt : prompt || promptEn) ?? "").trim().replace(/[，,\s]+$/, "");
}

function paletteText(look: Look, mode: "still" | "video"): string {
    const palette = look.usePalette ? look.palette : null;
    if (!palette?.colors.length) return "";
    const codes = palette.colors.join(isEn(look) ? ", " : "、");
    if (isEn(look))
        return mode === "video"
            ? `Colour grade reference (${palette.name}): ${codes}. Use these colour codes for the overall mood and balance; natural variation in light and materials is fine.`
            : `Color palette reference (${palette.name}): ${codes}. Follow this palette loosely for the overall color mood and balance. Allow natural differences in materials, skin tones, light and shadow; do not force every object to an exact color. Keep established identity colors and do not draw swatches or color-code labels.`;
    return mode === "video"
        ? `色彩参考（${palette.name}）：${codes}。以这组色码把握整体色调与搭配，光影与材质允许自然变化。`
        : `色彩参考（${palette.name}）：${codes}。大致遵循这组颜色的整体色彩氛围和搭配，允许材质、肤色及光影产生自然差异，不要求每个物体精确匹配色码。保留人物身份所需的固有色，不绘制色卡或颜色代码标签。`;
}

const join = (...parts: Array<string | false | undefined>) => parts.filter(Boolean).join("\n\n");

const SHEET_RULES = {
    character: (en: boolean, side: "left" | "right") => {
        const views = en ? ["Front full body", side === "right" ? "Right profile full body" : "Left profile full body", "Back full body"] : ["正面全身", side === "right" ? "右侧全身" : "左侧全身", "背面全身"];
        return en
            ? `Create one character turnaround sheet in three equal-width horizontal panels: left panel ${views[0]} (facing the camera), middle panel ${views[1]} (strict 90-degree side view, never three-quarter), right panel ${views[2]} (facing away, face not visible). Show three equally tall complete figures from head to shoes with aligned head and foot baselines, identical camera height and scale, and no portrait close-up. Keep identity, clothing, hair and proportions consistent with the specified age and species. Use the same natural standing pose with empty hands. No weapons or handheld props. The background must be a plain neutral grey with even lighting; the style and palette apply to the figure's rendering only, so no fog, rain, bokeh, environment or oversized face. No labels, watermark or story scenery.`
            : `绘制一张人物三视图，画面分为左、中、右三个等宽分区：左格${views[0]}（面朝镜头），中格${views[1]}（严格 90 度侧视，不使用四分之三角度），右格${views[2]}（背对镜头，看不到脸）。三个人像等高并列、从头顶到鞋底完整可见，脚底与头顶各自对齐，统一镜头高度和比例，不画肖像特写。同一人物、同一服装、同一发型与比例，符合设定中的年龄和物种，不强制成人比例。保持同一自然站姿，双手空手，不拿武器、道具或其他物件。背景必须是纯色中性灰、均匀光照，画风与色彩只用于人物的质感与上色，不画雾气、雨、光斑、环境或虚化的大头像，无文字标签、水印和剧情背景。`;
    },
    prop: (en: boolean) =>
        en
            ? "Create a square prop design sheet with front, side and rear views of the same object, plus three key structural or material details. Keep geometry, color and proportions consistent. Show the complete object independently on a plain neutral background; the style and palette apply to the object's rendering only, so no fog, rain, bokeh or environment. No characters, hands, story scenery, text or watermark."
            : "绘制一张正方形道具设定图，展示同一物件的正面、侧面、背面三视图，以及三个关键结构或材质细节。各视图形制、颜色、比例一致。物件完整、独立呈现，背景为纯色中性底，画风与色彩只用于物件的材质与上色，不画雾气、雨、光斑和环境，不出现人物、手掌、剧情场景、文字或水印。",
    scene: (en: boolean) =>
        en
            ? "Create one full-bleed environment keyframe of a coherent space. Clearly establish spatial depth, structure, permanent furnishings, materials and baseline lighting. No collage, panels, floor-plan overlay, characters, blocking, camera icons, arrows, text or watermark. Preserve understandable spatial structure for later camera viewpoints."
            : "绘制一张满幅场景基准图：单一连贯空间，清晰呈现空间层次、结构、固定陈设、材质与基准光线。不拼贴、不分格、不叠加平面图，不出现人物、人物走位、相机图标、指示箭头、文字或水印。为后续不同机位保留可理解的空间结构。",
    world: (en: boolean) =>
        en
            ? "Create one full-bleed atmosphere image of this world: its overall mood, era, region and signature landscape, as a mood and art-direction reference only. No close-up of named characters, collage, panels, text or watermark."
            : "绘制一张世界观氛围图：以单幅满幅画面呈现这个世界的整体气质、时代地域与标志性景观，仅作为情绪与美术方向参考。不出现具名人物特写，不拼贴、不分格，无文字和水印。",
};

/** Character sheets are always 16:9 (three panels side by side) and props square; scenes and the world follow the drama. */
export function sheetPrompt(input: SheetInput): { prompt: string; aspect: DramaAspect } {
    const { entity } = input;
    const en = isEn(input);
    const kind = entity.kind;
    const rule = kind === "character" ? SHEET_RULES.character(en, input.sideView ?? "left") : SHEET_RULES[kind](en);
    const aspect = kind === "character" ? "16:9" : kind === "prop" ? "1:1" : input.aspect;
    const prompt = join(
        styleText(input),
        paletteText(input, "still"),
        `${en ? "Subject" : "设定名称"}：${entity.name.trim()}`,
        // The description is story (who they are to the plot); the sheet needs how it looks. Fall back to it only when there is no appearance.
        entity.appearance.trim() ? `${en ? "Appearance" : "外观"}：${entity.appearance.trim()}` : entity.description.trim(),
        rule,
    );
    return { prompt, aspect };
}

const firstSentence = (text: string) => text.trim().match(/^[^。！？!?；;\n]*[。！？!?；;\n]?/)![0].trim();
const clip = (text: string, max = 200) => (text.length > max ? `${text.slice(0, max)}…` : text);

function castLine(ctx: ShotContext, phase: "start" | "any"): string[] {
    const en = isEn(ctx);
    const name = (id: string) => ctx.entities.get(id)?.name ?? "";
    const label = (entity: DramaEntity) => {
        const detail = entity.appearance.trim() && `（${clip(entity.appearance.trim())}）`;
        if (entity.kind !== "prop") return `${entity.name}${detail || ""}`;
        const state: PropState | undefined = ctx.shot.props.find((prop) => prop.entityId === entity.id);
        const holder = state && (phase === "start" ? state.startHolder : state.startHolder || state.endHolder);
        const count = state && state.quantity > 1 ? `×${state.quantity}` : "";
        return `${entity.name}${count}${detail || ""}${holder && name(holder) ? (en ? ` (held by ${name(holder)})` : `（由${name(holder)}持有）`) : ""}`;
    };
    const cast = shotCast(ctx.shot, ctx.entities, phase);
    const group = (kind: DramaEntity["kind"], zh: string, enLabel: string) => {
        const items = cast.filter((entity) => entity.kind === kind).map(label);
        return items.length ? [`${en ? enLabel : zh}：${items.join(en ? "; " : "、")}`] : [];
    };
    return [...group("character", "出场人物", "Characters"), ...group("scene", "场景", "Setting"), ...group("prop", "道具", "Props")];
}

const sizeAndCamera = (ctx: ShotContext, withCamera: boolean) => {
    const en = isEn(ctx);
    const size = promptTerm(SHOT_SIZES, ctx.shot.size, en);
    const camera = withCamera ? promptTerm(CAMERA_MOVES, ctx.shot.camera, en) : "";
    return [size && `${en ? "Shot size" : "景别"}：${size}`, camera && `${en ? "Camera movement" : "运镜"}：${camera}`].filter(Boolean) as string[];
};

/** Only the opening instant: startState plus the image prompt, never the description's later actions or endState. */
export function shotImagePrompt(ctx: ShotContext): string {
    const { shot } = ctx;
    const en = isEn(ctx);
    const start = shot.startState.trim();
    const scene = shot.imagePrompt.trim() || (start ? "" : firstSentence(shot.description));
    return join(
        styleText(ctx),
        paletteText(ctx, "still"),
        [`${en ? "Aspect ratio" : "画幅"}：${ctx.aspect}`, ...sizeAndCamera(ctx, false)].join(en ? ". " : "。"),
        castLine(ctx, "start").join("\n"),
        start && `${en ? "Opening state" : "开拍状态"}：${start}`,
        scene && `${en ? "Frame" : "画面"}：${scene}`,
        en
            ? "A single still frame of the very first instant of the shot. Do not depict any later action or result. No subtitles, text, watermark or storyboard frame; signs and screens show shapes only, never readable words."
            : "单帧静态画面，只表现镜头开始的这一瞬间，不画之后发生的动作或结果。无字幕、文字、水印和分镜框；招牌、屏幕只画形状，不出现可读的字。",
    );
}

/** start → action → end, with dialogue written as performance cues so the video model never renders subtitles. */
export function shotVideoPrompt(ctx: ShotContext): string {
    const { shot, prev } = ctx;
    const en = isEn(ctx);
    const name = (id: string) => ctx.entities.get(id)?.name || (en ? "Off-screen voice" : "画外声音");
    const start = shot.startState.trim() || firstSentence(shot.description);
    const action = shot.videoPrompt.trim() || shot.description.trim();
    const speech = shot.dialogue
        .filter((line) => line.text.trim())
        .map((line) => (en ? `${name(line.speaker)} speaks, lip movement and expression matching: "${line.text.trim()}"` : `${name(line.speaker)}开口说话，口型与神态贴合台词：“${line.text.trim()}”`));
    const narration = shot.narration.trim() && (en ? `Voice-over narration (audio only): ${shot.narration.trim()}` : `画外旁白（仅配音，不出现在画面中）：${shot.narration.trim()}`);
    const link = prev && shot.transition === "continuous" && prev.endState.trim() && (en ? `Continues directly from the previous shot, which ended with: ${prev.endState.trim()}` : `承接上一镜，上一镜结束于：${prev.endState.trim()}`);
    return join(
        styleText(ctx),
        paletteText(ctx, "video"),
        [`${en ? "Aspect ratio" : "画幅"}：${ctx.aspect}`, `${en ? "Duration" : "时长"}：${ctx.videoSeconds ?? shot.seconds}${en ? " seconds" : " 秒"}`, ...sizeAndCamera(ctx, true)].join(en ? ". " : "。"),
        link,
        castLine(ctx, "any").join("\n"),
        start && `${en ? "Start" : "开始"}：${start}`,
        action && `${en ? "Action" : "动作"}：${action}`,
        shot.endState.trim() && `${en ? "End" : "结束"}：${shot.endState.trim()}`,
        speech.length > 0 && `${en ? "Performance" : "表演"}：${speech.join(en ? "; " : "；")}`,
        narration,
        en ? "No subtitles, captions, text or watermark in the picture; signs and screens show shapes only, never readable words." : "画面中不出现字幕、文字和水印；招牌、屏幕只画形状，不出现可读的字。",
    );
}

function cyrb53(text: string, seed: number): number {
    let h1 = 0xdeadbeef ^ seed,
        h2 = 0x41c6ce57 ^ seed;
    for (let i = 0; i < text.length; i++) {
        const code = text.charCodeAt(i);
        h1 = Math.imul(h1 ^ code, 2654435761);
        h2 = Math.imul(h2 ^ code, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

const sortKeys = (_: string, value: unknown) =>
    value && typeof value === "object" && !Array.isArray(value) ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) : value;

/**
 * Stable, synchronous fingerprint of everything that determines a generated output (prompt text,
 * reference artifact ids, model, key params). An artifact whose stored hash differs is stale.
 */
export function inputHash(parts: unknown): string {
    const text = JSON.stringify(parts, sortKeys) ?? "";
    return cyrb53(text, 0).toString(36).padStart(11, "0") + cyrb53(text, 1).toString(36).padStart(11, "0");
}
