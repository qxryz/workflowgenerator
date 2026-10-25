import { CircleAlert, CircleCheck, CircleHelp, type LucideIcon } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { REVIEW_CRITERION_LABELS, REVIEW_VERDICT_LABELS } from "@/lib/drama/labels";
import { plainRefs } from "@/lib/drama/story";
import type { DramaRun, DramaSnapshot, ReviewCriterion, ReviewProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { RewriteAction } from "./rewrite-action";

type Verdict = ReviewProposal["items"][number]["verdict"];
const VERDICTS: Record<Verdict, { icon: LucideIcon; tone: string }> = {
    pass: { icon: CircleCheck, tone: "text-[color:var(--wg-home-accent)]" },
    issue: { icon: CircleAlert, tone: "text-destructive" },
    unknown: { icon: CircleHelp, tone: "text-[color:var(--wg-home-muted-strong)]" },
};
const ORDER = Object.keys(REVIEW_CRITERION_LABELS) as ReviewCriterion[];

type Props = { proposal: ReviewProposal; run: DramaRun; snapshot: DramaSnapshot };

/** Seven checks, each with a verdict, the reason and what to change. A report only: nothing here edits the story. */
export function ReviewReport({ proposal, run, snapshot }: Props) {
    const { t } = useAppTranslation();
    const items = [...proposal.items].sort((a, b) => ORDER.indexOf(a.criterion) - ORDER.indexOf(b.criterion));
    const count = (verdict: Verdict) => items.filter((item) => item.verdict === verdict).length;
    const target = run.scope.target === "settings" ? "settings" : "chapters";
    const existing = new Set(snapshot.chapters.map((chapter) => chapter.ord));
    const covered = (run.scope.chapterOrds?.length ? run.scope.chapterOrds : [...existing]).filter((ord) => existing.has(ord)).sort((a, b) => a - b);
    return (
        <div>
            <p className="mb-0 px-5 pb-1 pt-4 text-[12px] text-[color:var(--wg-home-muted)]">
                {t("共 {total} 项：{issue} 项有问题 · {pass} 项通过 · {unknown} 项无法判断", { total: items.length, issue: count("issue"), pass: count("pass"), unknown: count("unknown") })}
            </p>
            <ul className="divide-y divide-[color:var(--wg-home-line)]">
                {items.map((item) => {
                    const { icon: Icon, tone } = VERDICTS[item.verdict] ?? VERDICTS.unknown;
                    return (
                        <li key={item.criterion} className="flex gap-3 px-5 py-4">
                            <Icon className={cn("mt-0.5 size-[18px] shrink-0", tone)} strokeWidth={1.7} />
                            <div className="min-w-0 flex-1">
                                <div className="flex items-baseline gap-2">
                                    <h4 className="text-[13px] font-semibold">{t(REVIEW_CRITERION_LABELS[item.criterion] ?? item.criterion)}</h4>
                                    <span className={cn("text-[12px]", tone)}>{t(REVIEW_VERDICT_LABELS[item.verdict] ?? REVIEW_VERDICT_LABELS.unknown)}</span>
                                </div>
                                <p className="mb-0 mt-1.5 whitespace-pre-wrap text-[13px] leading-6">{plainRefs(item.note, snapshot, t)}</p>
                                {item.suggestion ? (
                                    <p className="mb-0 mt-2.5 rounded-lg bg-[color:var(--wg-home-ghost)] px-3 py-2 text-[13px] leading-6">
                                        <span className="mr-2 text-[12px] text-[color:var(--wg-home-muted)]">{t("建议")}</span>
                                        {plainRefs(item.suggestion, snapshot, t)}
                                    </p>
                                ) : null}
                                {item.verdict === "issue" && item.suggestion.trim() ? (
                                    <div className="mt-3">
                                        <RewriteAction snapshot={snapshot} target={target} ords={covered} suggestion={item.suggestion} note={item.note} />
                                    </div>
                                ) : null}
                            </div>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}
