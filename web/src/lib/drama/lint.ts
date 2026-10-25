import type { DramaEntity, DramaShot } from "./types.ts";

/**
 * `message` is a Chinese template with {placeholders} (it is also the translation key). `values` are the user's own words and numbers,
 * shown as they are; `terms` are fixed Chinese words that need translating too. Render with `lintText`.
 */
export type LintIssue = { shotId?: string; level: "warn" | "info"; message: string; values?: Record<string, string | number>; terms?: Record<string, string> };

type Translate = (message: string, values?: Record<string, string | number>) => string;

export const lintText = (issue: LintIssue, t: Translate): string =>
    t(issue.message, { ...issue.values, ...Object.fromEntries(Object.entries(issue.terms ?? {}).map(([key, word]) => [key, t(word)])) });

/** Spoken Chinese runs at about four characters a second. */
const SPEECH_CHARS_PER_SECOND = 4.2;

/** Free, offline checks over a shot table; nothing here calls a model. */
export function lintEpisode(shots: readonly DramaShot[], entities: ReadonlyMap<string, DramaEntity>, targetSeconds: number): LintIssue[] {
    const issues: LintIssue[] = [];
    const add = (shot: DramaShot, level: LintIssue["level"], message: string, values?: LintIssue["values"], terms?: LintIssue["terms"]) => issues.push({ shotId: shot.id, level, message, values, terms });
    const name = (id: string) => entities.get(id)?.name ?? "未知设定";

    shots.forEach((shot, i) => {
        const prev = shots[i - 1];
        const n = i + 1;
        const camera = shot.camera.trim();
        const size = shot.size.trim();

        if (prev && camera && camera === prev.camera.trim()) add(shot, "info", "第 {n} 镜与上一镜运镜相同（{camera}）", { n, camera });
        if (size && i >= 2 && size === shots[i - 1].size.trim() && size === shots[i - 2].size.trim() && size !== shots[i - 3]?.size.trim()) {
            let last = i;
            while (shots[last + 1]?.size.trim() === size) last++;
            add(shot, "info", "第 {from}–{to} 镜景别都是「{size}」，可以变换一下", { from: i - 1, to: last + 1, size });
        }

        if (!shot.entityIds.length) add(shot, "warn", "第 {n} 镜没有绑定出场设定", { n });
        const noImage = !shot.imagePrompt.trim();
        const noVideo = !shot.videoPrompt.trim();
        if (noImage || noVideo) add(shot, "warn", noImage && noVideo ? "第 {n} 镜缺少画面提示词和视频提示词" : noImage ? "第 {n} 镜缺少画面提示词" : "第 {n} 镜缺少视频提示词", { n });
        for (const speaker of new Set(shot.dialogue.map((line) => line.speaker).filter(Boolean)))
            if (!shot.entityIds.includes(speaker)) add(shot, "warn", "第 {n} 镜的说话人「{speaker}」没有绑定为出场设定", { n, speaker: name(speaker) });

        const spoken = [...shot.dialogue.map((line) => line.text), shot.narration].join("").replace(/[\s，。！？、；：,.!?;:"“”‘’…—（）()]/g, "").length;
        const need = Math.ceil(spoken / SPEECH_CHARS_PER_SECOND);
        if (need > shot.seconds) add(shot, "warn", "第 {n} 镜的对白约需 {need} 秒，超过镜头的 {seconds} 秒，配音会被截断", { n, need, seconds: shot.seconds });

        if (prev && shot.transition === "continuous") {
            for (const before of prev.props) {
                const now = shot.props.find((prop) => prop.entityId === before.entityId);
                const prop = name(before.entityId);
                if (!now) {
                    if (before.endVisible) add(shot, "warn", "第 {n} 镜是连续镜头，上一镜结束时可见的「{prop}」没有出现", { n, prop });
                } else if (before.endVisible !== now.startVisible) {
                    add(shot, "warn", now.startVisible ? "第 {n} 镜开拍时「{prop}」可见，与上一镜结束时不一致" : "第 {n} 镜开拍时「{prop}」不可见，与上一镜结束时不一致", { n, prop });
                } else if (now.startVisible && before.endHolder !== now.startHolder) {
                    const values: Record<string, string | number> = { n, prop };
                    const terms: Record<string, string> = {};
                    for (const [key, id] of [["after", now.startHolder], ["was", before.endHolder]] as const) {
                        if (id) values[key] = name(id);
                        else terms[key] = "无人";
                    }
                    add(shot, "warn", "第 {n} 镜开拍时「{prop}」的持有人（{after}）与上一镜结束时（{was}）不一致", values, terms);
                } else if (now.startVisible && before.quantity !== now.quantity) {
                    add(shot, "warn", "第 {n} 镜的「{prop}」数量（{now}）与上一镜结束时（{before}）不一致", { n, prop, now: now.quantity, before: before.quantity });
                }
            }
        }
    });

    const total = shots.reduce((sum, shot) => sum + shot.seconds, 0);
    if (shots.length && targetSeconds > 0 && Math.abs(total - targetSeconds) / targetSeconds > 0.2) issues.push({ level: "warn", message: "镜头合计 {total} 秒，与目标 {target} 秒相差超过 20%", values: { total, target: targetSeconds } });
    return issues;
}
