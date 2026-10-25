import { useAppTranslation } from "@/hooks/use-app-translation";
import { formatChapterRefs, formatSeconds, proposedEpisodes } from "@/lib/drama/story";
import type { DramaSnapshot, EpisodesProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";

/** The planned episodes in order; each says whether it updates an existing episode (the server marks those with a ref) or adds a new one. */
export function EpisodesResult({ proposal, snapshot }: { proposal: EpisodesProposal; snapshot: DramaSnapshot }) {
    const { t } = useAppTranslation();
    return (
        <ol className="divide-y divide-[color:var(--wg-home-line)]">
            {proposedEpisodes(proposal, snapshot.episodes).map(({ item, ord, update }, index) => (
                <li key={index} className="px-4 py-3.5">
                    <div className="flex items-center gap-2">
                        {ord ? <span className="text-[11px] tabular-nums text-[color:var(--wg-home-muted)]">{t("第 {ord} 集", { ord })}</span> : null}
                        <span className={cn("inline-flex h-4 items-center rounded-full border px-1.5 text-[10px] font-medium", update ? "border-[color:var(--wg-home-line-strong)] text-[color:var(--wg-home-muted)]" : "border-[color:var(--wg-home-accent)]/50 text-[color:var(--wg-home-accent)]")}>{t(update ? "更新" : "新增")}</span>
                    </div>
                    <h4 className="mt-1 text-[14px] font-semibold">{item.title}</h4>
                    <p className="mb-0 mt-1 text-[13px] leading-6">{item.outline}</p>
                    <p className="mb-0 mt-1.5 text-[11px] text-[color:var(--wg-home-muted)]">{[formatChapterRefs(item.sourceChapters, t), formatSeconds(item.targetSeconds, t)].filter(Boolean).join(" · ")}</p>
                </li>
            ))}
        </ol>
    );
}
