import type { DramaEntity, DramaShot } from "./types";

export type LintIssue = { shotId?: string; level: "warn" | "info"; message: string };

/** Free, offline checks over a shot table; nothing here calls a model. */
export function lintEpisode(shots: readonly DramaShot[], entities: ReadonlyMap<string, DramaEntity>, targetSeconds: number): LintIssue[] {
    const issues: LintIssue[] = [];
    const add = (shot: DramaShot, level: LintIssue["level"], message: string) => issues.push({ shotId: shot.id, level, message });
    const name = (id: string) => entities.get(id)?.name ?? "未知设定";

    shots.forEach((shot, i) => {
        const prev = shots[i - 1];
        const no = `第 ${i + 1} 镜`;
        const camera = shot.camera.trim();
        const size = shot.size.trim();

        if (prev && camera && camera === prev.camera.trim()) add(shot, "info", `${no}与上一镜运镜相同（${camera}）`);
        if (size && i >= 2 && size === shots[i - 1].size.trim() && size === shots[i - 2].size.trim() && size !== shots[i - 3]?.size.trim()) {
            let last = i;
            while (shots[last + 1]?.size.trim() === size) last++;
            add(shot, "info", `第 ${i - 1}–${last + 1} 镜景别都是「${size}」，可以变换一下`);
        }

        if (!shot.entityIds.length) add(shot, "warn", `${no}没有绑定出场设定`);
        const missing = [!shot.imagePrompt.trim() && "画面提示词", !shot.videoPrompt.trim() && "视频提示词"].filter(Boolean);
        if (missing.length) add(shot, "warn", `${no}缺少${missing.join("和")}`);
        for (const speaker of new Set(shot.dialogue.map((line) => line.speaker).filter(Boolean)))
            if (!shot.entityIds.includes(speaker)) add(shot, "warn", `${no}的说话人「${name(speaker)}」没有绑定为出场设定`);

        if (prev && shot.transition === "continuous") {
            const holder = (id: string) => (id ? name(id) : "无人");
            for (const before of prev.props) {
                const now = shot.props.find((prop) => prop.entityId === before.entityId);
                const prop = `「${name(before.entityId)}」`;
                if (!now) {
                    if (before.endVisible) add(shot, "warn", `${no}是连续镜头，上一镜结束时可见的${prop}没有出现`);
                } else if (before.endVisible !== now.startVisible) {
                    add(shot, "warn", `${no}开拍时${prop}${now.startVisible ? "可见" : "不可见"}，与上一镜结束时不一致`);
                } else if (now.startVisible && before.endHolder !== now.startHolder) {
                    add(shot, "warn", `${no}开拍时${prop}的持有人（${holder(now.startHolder)}）与上一镜结束时（${holder(before.endHolder)}）不一致`);
                } else if (now.startVisible && before.quantity !== now.quantity) {
                    add(shot, "warn", `${no}的${prop}数量（${now.quantity}）与上一镜结束时（${before.quantity}）不一致`);
                }
            }
        }
    });

    const total = shots.reduce((sum, shot) => sum + shot.seconds, 0);
    if (shots.length && targetSeconds > 0 && Math.abs(total - targetSeconds) / targetSeconds > 0.2) issues.push({ level: "warn", message: `镜头合计 ${total} 秒，与目标 ${targetSeconds} 秒相差超过 20%` });
    return issues;
}
