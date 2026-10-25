import { useAppTranslation } from "@/hooks/use-app-translation";
import { LEDGER_KIND_LABELS } from "@/lib/drama/labels";
import { LEDGER_OP_LABELS } from "@/lib/drama/story";
import type { ChapterProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { Prose, ProseTitle, READING_COLUMN } from "./prose";

const OP_TONE: Record<ChapterProposal["ledger"][number]["op"], string> = {
    add: "border-[color:var(--wg-home-accent)]/50 text-[color:var(--wg-home-accent)]",
    update: "border-[color:var(--wg-home-line-strong)] text-[color:var(--wg-home-muted)]",
    resolve: "border-[color:var(--wg-home-line-strong)] bg-[color:var(--wg-home-hover)] text-[color:var(--wg-home-text)]",
};

/** A chapter result as the writer would read it: text first, then what it adds to the story notes. */
export function ChapterResult({ proposal }: { proposal: ChapterProposal }) {
    const { t } = useAppTranslation();
    const facts: Array<[string, string]> = [
        ["摘要", proposal.summary],
        ["章末状态", proposal.endState],
    ];
    return (
        <div className={`${READING_COLUMN} pb-12 pt-8`}>
            <ProseTitle className="mb-6">{proposal.title}</ProseTitle>
            <Prose body={proposal.body} />
            <div className="mt-8 space-y-6 border-t border-[color:var(--wg-home-line)] pt-6">
                {facts.map(([label, value]) =>
                    value ? (
                        <section key={label}>
                            <h4 className="mb-1.5 text-[12px] font-medium text-[color:var(--wg-home-muted)]">{t(label)}</h4>
                            <p className="mb-0 whitespace-pre-wrap text-[13px] leading-6">{value}</p>
                        </section>
                    ) : null,
                )}
                {proposal.ledger.length ? (
                    <section>
                        <h4 className="mb-2 text-[12px] font-medium text-[color:var(--wg-home-muted)]">{t("创作账本的变化")}</h4>
                        <ul className="divide-y divide-[color:var(--wg-home-line)] rounded-lg border border-[color:var(--wg-home-line)]">
                            {proposal.ledger.map((change, index) => (
                                <li key={index} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                                    <span className={cn("mt-0.5 inline-flex h-5 shrink-0 items-center rounded-full border px-2 text-[11px] font-medium", OP_TONE[change.op] ?? OP_TONE.update)}>{t(LEDGER_OP_LABELS[change.op] ?? "更新")}</span>
                                    <div className="min-w-0 flex-1">
                                        <p className="mb-0">
                                            <span className="font-medium">{change.name}</span>
                                            <span className="ml-2 text-[11px] text-[color:var(--wg-home-muted)]">{t(LEDGER_KIND_LABELS[change.kind] ?? "")}</span>
                                        </p>
                                        {change.note ? <p className="mb-0 mt-0.5 leading-5 text-[color:var(--wg-home-muted)]">{change.note}</p> : null}
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                ) : null}
            </div>
        </div>
    );
}
