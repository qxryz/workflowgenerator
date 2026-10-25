import { App, Select } from "antd";
import { Loader2, PenLine } from "lucide-react";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { useStartRun } from "@/hooks/use-drama";
import { guessChapterOrd } from "@/lib/drama/story";
import type { DramaSnapshot } from "@/lib/drama/types";
import { isAiConfigReady, useConfigStore } from "@/stores/use-config-store";

type Props = { snapshot: DramaSnapshot; target: "chapters" | "settings"; /** Chapters the report covered. */ ords: number[]; suggestion: string; note: string };

/** Turns one finding into a chapter (or settings) task whose extra request is the suggestion, then opens the result. */
export function RewriteAction({ snapshot, target, ords, suggestion, note }: Props) {
    const { t } = useAppTranslation();
    const { message } = App.useApp();
    const navigate = useNavigate();
    const startRun = useStartRun();
    const config = useConfigStore((state) => state.config);
    const [pending, setPending] = useState(false);
    const [ord, setOrd] = useState<number | undefined>(() => guessChapterOrd(`${suggestion}\n${note}`, ords) ?? ords.at(-1));
    const base = `/dramas/${snapshot.project.id}`;

    const start = async () => {
        if (!isAiConfigReady(config, config.textModel || config.model)) {
            message.error(t("还没有可用的文本模型，请先在「模型与渠道」里配置"));
            useConfigStore.getState().openConfigDialog(true, "channels");
            return;
        }
        setPending(true);
        try {
            if (target === "settings") {
                await startRun({ snapshot, stage: "settings", instruction: suggestion });
                navigate(`${base}?tab=settings`);
            } else if (ord !== undefined) {
                await startRun({ snapshot, stage: "chapter", scope: { ord }, instruction: suggestion });
                navigate(`${base}?tab=story&ch=${ord}`);
            }
        } catch (error) {
            message.error(error instanceof Error ? error.message : t("任务没能开始，请重试"));
        } finally {
            setPending(false);
        }
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
