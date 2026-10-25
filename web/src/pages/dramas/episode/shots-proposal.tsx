import { useAppTranslation } from "@/hooks/use-app-translation";
import { TRANSITION_LABELS } from "@/lib/drama/labels";
import type { DramaEntity, ShotsProposal } from "@/lib/drama/types";

/** The proposed shot list, compact and read-only. References like E3 are shown as the names they stand for. */
export function ShotsProposalTable({ proposal, entities, targetSeconds }: { proposal: ShotsProposal; entities: readonly DramaEntity[]; targetSeconds: number }) {
    const { t } = useAppTranslation();
    const name = (ref: string) => entities.find((entity) => entity.label === ref || entity.id === ref)?.name ?? ref;
    const total = proposal.shots.reduce((sum, shot) => sum + shot.seconds, 0);
    return (
        <div className="text-[12px]">
            <p className="px-4 py-2 text-[color:var(--wg-home-muted)]">{t("共 {count} 镜，{seconds} 秒（目标 {target} 秒）", { count: proposal.shots.length, seconds: total, target: targetSeconds })}</p>
            <table className="w-full table-fixed border-collapse">
                <colgroup>
                    <col className="w-9" />
                    <col className="w-11" />
                    <col className="w-14" />
                    <col className="w-16" />
                    <col />
                    <col className="w-[26%]" />
                    <col className="w-[16%]" />
                    <col className="w-12" />
                </colgroup>
                <thead className="sticky top-0 bg-[color:var(--wg-panel)] text-left text-[11px] text-[color:var(--wg-home-muted)]">
                    <tr className="border-y border-[color:var(--wg-home-line)]">
                        {["#", "秒数", "景别", "运镜", "画面", "对白", "出场", "衔接"].map((label, index) => (
                            <th key={label} className={`py-1.5 pr-2 font-normal ${index === 0 ? "pl-4" : ""}`}>{index === 0 ? label : t(label)}</th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {proposal.shots.map((shot, index) => (
                        <tr key={index} className="border-b border-[color:var(--wg-home-line)] align-top last:border-0">
                            <td className="py-2 pl-4 pr-2 font-semibold tabular-nums">{index + 1}</td>
                            <td className="py-2 pr-2 tabular-nums">{shot.seconds}s</td>
                            <td className="py-2 pr-2">{shot.size}</td>
                            <td className="py-2 pr-2">{shot.camera}</td>
                            <td className="py-2 pr-3 leading-5">{shot.description}</td>
                            <td className="py-2 pr-3 leading-5 text-[color:var(--wg-home-muted)]">
                                {shot.dialogue.map((line, at) => (
                                    <p key={at}>{line.speaker ? `${name(line.speaker)}：` : ""}{line.text}</p>
                                ))}
                                {shot.narration ? <p>{t("旁白")}：{shot.narration}</p> : null}
                            </td>
                            <td className="py-2 pr-2 leading-5">{shot.entities.map(name).join("、")}</td>
                            <td className="py-2 pr-3 text-[color:var(--wg-home-muted)]">{index === 0 ? "—" : t(TRANSITION_LABELS[shot.transition] ?? shot.transition)}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
