import { Select } from "antd";
import { Loader2, PenLine } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { useStartTask } from "@/hooks/use-start-task";
import { guessChapterOrd } from "@/lib/drama/story";
import type { DramaSnapshot } from "@/lib/drama/types";

type Props = { snapshot: DramaSnapshot; target: "chapters" | "settings"; /** Chapters the report covered. */ ords: number[]; suggestion: string; note: string };

/** Turns one finding into a chapter (or settings) task whose extra request is the suggestion, then opens the result. */
export function RewriteAction({ snapshot, target, ords, suggestion, note }: Props) {
    const { t } = useAppTranslation();
    const navigate = useNavigate();
    const { start: startTask, pending } = useStartTask();
    const [ord, setOrd] = useState<number | undefined>(() => guessChapterOrd(`${suggestion}\n${note}`, ords) ?? ords.at(-1));
    const base = `/dramas/${snapshot.project.id}`;

    const start = async () => {
        if (target === "settings") {
            if (await startTask({ snapshot, stage: "settings", instruction: suggestion })) navigate(`${base}?tab=settings`);
        } else if (ord !== undefined && (await startTask({ snapshot, stage: "chapter", scope: { ord }, instruction: suggestion }))) navigate(`${base}?tab=story&ch=${ord}`);
    };

    const chapterTarget = target === "chapters";
    return (
        <div className="flex flex-wrap items-center gap-2">
            {chapterTarget && ords.length > 1 ? <Select size="small" className="w-24" value={ord} onChange={setOrd} aria-label={t("改写哪一章")} options={ords.map((value) => ({ value, label: t("第{ords}章", { ords: value }) }))} /> : null}
            {chapterTarget && ords.length === 1 ? <span className="text-[12px] text-[color:var(--wg-home-muted)]">{t("第{ords}章", { ords: ords[0] })}</span> : null}
            <button type="button" className="wg-text-button !h-8 !border !border-[color:var(--wg-home-line-strong)] !text-[color:var(--wg-home-text)]" disabled={pending || (chapterTarget && ord === undefined)} onClick={() => void start()}>
                {pending ? <Loader2 className="size-3.5 animate-spin" /> : <PenLine className="size-3.5" strokeWidth={1.6} />}
                {t("按建议改写")}
            </button>
        </div>
    );
}
