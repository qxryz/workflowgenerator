import { ArrowRight } from "lucide-react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { ENTITY_GROUP_LABELS, RELATION_KIND_LABELS } from "@/lib/drama/labels";
import { classifyProposal, type ChangeKind } from "@/lib/drama/settings-view";
import type { DramaSnapshot, SettingsProposal } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { KIND_COLOR, KIND_ICON } from "./common";

/** What adopting this result would change: settings grouped by kind, then the relations. */
/** `settled`: the result was already adopted or dropped, so what is "new" can no longer be told; the badges are left out. */
export function SettingsProposalView({ proposal, snapshot, settled }: { proposal: SettingsProposal; snapshot: DramaSnapshot; settled: boolean }) {
    const { t } = useAppTranslation();
    const view = classifyProposal(proposal, snapshot.entities, snapshot.relations);
    return (
        <div className="flex flex-col gap-5 p-4">
            <p className="!mb-0 text-[12px] text-[color:var(--wg-home-muted)]">
                {settled ? t("设定 {count} · 关系 {relations}", { count: view.counts.added + view.counts.updated, relations: view.counts.relations }) : t("新增 {added} · 更新 {updated} · 关系 {relations}", view.counts)}
                {settled ? null : <span className="ml-2">{t("采用后不会删除已有设定")}</span>}
            </p>
            {view.groups.map((group) => {
                const Icon = KIND_ICON[group.kind];
                return (
                    <section key={group.kind}>
                        <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                            <Icon className="size-4" strokeWidth={1.6} style={{ color: KIND_COLOR[group.kind] }} />
                            {t(ENTITY_GROUP_LABELS[group.kind])}
                            <span className="font-normal tabular-nums text-[color:var(--wg-home-muted)]">{group.rows.length}</span>
                        </h4>
                        <ul className="divide-y divide-[color:var(--wg-home-line)] rounded-lg border border-[color:var(--wg-home-line)]">
                            {group.rows.map(({ item, change, parent }) => (
                                <li key={`${item.kind}:${item.name}`} className={cn("grid items-baseline gap-x-3 px-3 py-2.5", settled ? "grid-cols-1" : "grid-cols-[3rem_minmax(0,1fr)]")}>
                                    {settled ? null : <ChangeBadge change={change} />}
                                    <div className="min-w-0">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                            <span className="text-[13px] font-semibold">{item.name}</span>
                                            {item.aliases.length ? <span className="text-[11px] text-[color:var(--wg-home-muted)]">{item.aliases.join("、")}</span> : null}
                                            {parent ? <span className="rounded border border-[color:var(--wg-home-line)] px-1.5 text-[11px] text-[color:var(--wg-home-muted)]">{t("所属 {name}", { name: parent })}</span> : null}
                                        </div>
                                        <p className="!mb-0 mt-0.5 line-clamp-2 text-[12px] leading-5 text-[color:var(--wg-home-muted)]">{item.description}</p>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    </section>
                );
            })}
            {view.relations.length ? (
                <section>
                    <h4 className="mb-2 flex items-center gap-2 text-[13px] font-semibold">
                        {t("关系")}
                        <span className="font-normal tabular-nums text-[color:var(--wg-home-muted)]">{view.relations.length}</span>
                    </h4>
                    <ul className="divide-y divide-[color:var(--wg-home-line)] rounded-lg border border-[color:var(--wg-home-line)]">
                        {view.relations.map((relation, index) => (
                            <li key={index} className={cn("grid items-center gap-x-3 px-3 py-2", settled ? "grid-cols-1" : "grid-cols-[3rem_minmax(0,1fr)]")} title={relation.note || undefined}>
                                {settled ? null : <ChangeBadge change={relation.change} />}
                                <div className="flex min-w-0 items-center gap-2 text-[13px]">
                                    <span className="max-w-[30%] truncate font-medium">{relation.from}</span>
                                    <span className="flex shrink-0 items-center gap-1 text-[color:var(--wg-home-muted)]">
                                        <span className="h-px w-5 bg-[color:var(--wg-home-line-strong)]" />
                                        <span className="rounded-full border border-[color:var(--wg-home-line-strong)] px-2 py-0.5 text-[11px] leading-4 text-[color:var(--wg-home-text)]">
                                            {relation.label.trim() || t(RELATION_KIND_LABELS[relation.kind])}
                                        </span>
                                        <span className="h-px w-5 bg-[color:var(--wg-home-line-strong)]" />
                                        <ArrowRight className="-ml-2 size-3.5" strokeWidth={1.8} />
                                    </span>
                                    <span className="max-w-[30%] truncate font-medium">{relation.to}</span>
                                </div>
                            </li>
                        ))}
                    </ul>
                </section>
            ) : null}
        </div>
    );
}

function ChangeBadge({ change }: { change: ChangeKind }) {
    const { t } = useAppTranslation();
    return (
        <span
            className={cn(
                "inline-flex h-5 w-10 items-center justify-center rounded-full border text-[11px] font-medium leading-none",
                change === "new" ? "border-[color:var(--wg-home-accent)] bg-[color:var(--wg-home-accent)]/10 text-[color:var(--wg-home-accent)]" : "border-[color:var(--wg-home-line-strong)] text-[color:var(--wg-home-muted)]",
            )}
        >
            {t(change === "new" ? "新增" : "更新")}
        </span>
    );
}
