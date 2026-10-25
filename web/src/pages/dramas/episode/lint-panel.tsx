import { ChevronDown, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { LintIssue } from "@/lib/drama/lint";
import { cn } from "@/lib/utils";

type Props = { issues: LintIssue[]; onPick: (shotId: string) => void };

/** Free offline checks over the shot table, docked under it. */
export function LintPanel({ issues, onPick }: Props) {
    const { t } = useAppTranslation();
    const warnings = issues.filter((issue) => issue.level === "warn").length;
    const [open, setOpen] = useState(false);
    return (
        <section className="shrink-0 border-t border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-bg)]">
            <button type="button" className="flex h-10 w-full items-center gap-2 px-6 text-left text-[13px]" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
                <span className="font-semibold">{t("静态检查（不消耗额度）")}</span>
                {issues.length ? (
                    <span className={cn("grid h-4 min-w-4 place-items-center rounded-full px-1 text-[10px] font-semibold tabular-nums", warnings ? "bg-[color:var(--wg-home-accent)] text-[color:var(--wg-home-accent-text)]" : "bg-[color:var(--wg-home-ghost)] text-[color:var(--wg-home-muted)]")}>{issues.length}</span>
                ) : (
                    <span className="flex items-center gap-1 text-[12px] text-[color:var(--wg-home-muted)]">
                        <CircleCheck className="size-3.5" strokeWidth={1.6} />
                        {t("没有发现问题")}
                    </span>
                )}
                {issues.length ? <ChevronDown className={cn("ml-auto size-4 text-[color:var(--wg-home-muted)] transition-transform", !open && "-rotate-90")} strokeWidth={1.6} /> : null}
            </button>
            {open && issues.length ? (
                <ul className="thin-scrollbar max-h-36 overflow-y-auto px-4 pb-3">
                    {issues.map((issue, index) => {
                        const Icon = issue.level === "warn" ? TriangleAlert : Info;
                        return (
                            <li key={index}>
                                <button
                                    type="button"
                                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[12px] leading-5 hover:bg-[color:var(--wg-home-hover)] disabled:cursor-default disabled:hover:bg-transparent"
                                    disabled={!issue.shotId}
                                    onClick={() => issue.shotId && onPick(issue.shotId)}
                                >
                                    <Icon className={cn("mt-0.5 size-3.5 shrink-0", issue.level === "warn" ? "text-[color:var(--wg-home-accent)]" : "text-[color:var(--wg-home-muted)]")} strokeWidth={1.6} />
                                    <span>{issue.message}</span>
                                </button>
                            </li>
                        );
                    })}
                </ul>
            ) : null}
        </section>
    );
}
