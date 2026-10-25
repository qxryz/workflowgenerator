import { ENTITY_GROUP_LABELS, LEDGER_KIND_LABELS, SOURCE_TYPE_LABELS } from "../labels.ts";
import type { DramaChapter, DramaEntity, DramaEpisode, DramaProject, DramaRelation, DramaSnapshot, LedgerEntry, RunScope } from "../types.ts";

export type StageInput = {
    snapshot: DramaSnapshot;
    scope: RunScope;
    episodeId?: string;
    instruction: string;
    /** Previous result when this run revises another one. */
    base?: string;
};
export type Prompt = { system: string; user: string };


/** Prompts say 伏笔 where the app says 伏笔线索. */
const LEDGER_LABEL = { ...LEDGER_KIND_LABELS, thread: "伏笔" };

/** Cut to at most `max` characters, marker included. */
export function clip(text: string, max: number, keep: "head" | "tail" = "head") {
    const value = text.trim();
    if (value.length <= max) return value;
    const mark = keep === "head" ? "…（后略）" : "（前略）…";
    return keep === "head" ? value.slice(0, max - mark.length) + mark : mark + value.slice(value.length - (max - mark.length));
}

export const section = (title: string, body: string) => (body.trim() ? `## ${title}\n${body.trim()}` : "");
export const sections = (...parts: string[]) => parts.filter(Boolean).join("\n\n");

/** The closing block every user message ends with: what to do now, the user's extra request, the version being revised. */
export function taskSection(input: StageInput, task: string) {
    return sections(
        section("本次任务", task),
        section("用户补充要求（优先满足，不与已有设定冲突为限）", input.instruction),
        section("上一版结果（按用户要求修改，输出完整的新版本，没提到的地方保持不变）", input.base ? clip(input.base, 12000) : ""),
    );
}

export function projectText(project: DramaProject) {
    const style = project.style?.prompt ? `画风：${clip(project.style.prompt, 200)}` : "";
    return [`名称：${project.title}`, `类型：${SOURCE_TYPE_LABELS[project.sourceType]}`, `画幅：${project.aspect}`, project.brief && `简介：${clip(project.brief, 600)}`, style].filter(Boolean).join("\n");
}

export function ledgerText(ledger: LedgerEntry[]) {
    return ledger
        .map((entry) => {
            const where = entry.chapterOrds.length ? `［第${entry.chapterOrds.join("、")}章］` : "";
            const state = entry.kind === "thread" ? (entry.status === "resolved" ? "［已回收］" : "［未回收］") : "";
            return `- ${LEDGER_LABEL[entry.kind]}·${entry.name}${state}：${clip(entry.note, 160)}${where}`;
        })
        .join("\n");
}

/** One line per chapter: label, title, summary, end state. Always complete; bodies come separately. */
export function chapterDigest(chapters: DramaChapter[]) {
    return chapters
        .map((c) => `${c.label}《${c.title}》${c.summary ? `摘要：${clip(c.summary, 300)}` : "（无摘要）"}${c.endState ? `\n  章末状态：${clip(c.endState, 300)}` : ""}`)
        .join("\n");
}

/** Chapter bodies in the given priority order until the budget runs out; each capped at `cap`. */
export function chapterExcerpts(chapters: DramaChapter[], budget: number, cap = 2400) {
    let left = budget;
    const out: string[] = [];
    for (const chapter of chapters) {
        if (left < 200) break;
        const body = clip(chapter.body, Math.min(cap, left));
        left -= body.length;
        out.push(`### ${chapter.label}《${chapter.title}》\n${body}`);
    }
    return out.join("\n\n");
}

const labelOf = (entities: DramaEntity[]) => new Map(entities.map((e) => [e.id, e.label]));

export function entityText(entities: DramaEntity[], detail: "full" | "brief" = "full") {
    const labels = labelOf(entities);
    return entities
        .map((e) => {
            const aliases = e.aliases.length ? `（又名${e.aliases.join("、")}）` : "";
            const parent = e.parentId && labels.get(e.parentId) ? ` 所属${labels.get(e.parentId)}` : "";
            const body = detail === "full" ? [e.description && clip(e.description, 200), e.appearance && `外观：${clip(e.appearance, 200)}`] : [e.description && clip(e.description, 60)];
            return `${e.label} ${ENTITY_GROUP_LABELS[e.kind]} ${e.name}${aliases}${parent}${body.filter(Boolean).length ? "：" + body.filter(Boolean).join("；") : ""}`;
        })
        .join("\n");
}

export function relationText(relations: DramaRelation[], entities: DramaEntity[]) {
    const labels = labelOf(entities);
    return relations.map((r) => `${labels.get(r.fromId) ?? "?"} → ${labels.get(r.toId) ?? "?"}：${r.label || r.kind}`).join("\n");
}

export function episodeLine(episode: DramaEpisode, chapters: DramaChapter[]) {
    const sources = episode.sourceChapterIds.map((id) => chapters.find((c) => c.id === id)?.label).filter(Boolean);
    return `${episode.label}《${episode.title}》约${episode.targetSeconds}秒${sources.length ? `｜来源${sources.join("、")}` : ""}${episode.outline ? `\n  ${clip(episode.outline, 300)}` : ""}`;
}

export function requireEpisode(input: StageInput) {
    const episode = input.snapshot.episodes.find((e) => e.id === input.episodeId);
    if (!episode) throw new Error("找不到要处理的分集");
    return episode;
}

export const byOrd = <T extends { ord: number }>(items: T[]) => [...items].sort((a, b) => a.ord - b.ord);
