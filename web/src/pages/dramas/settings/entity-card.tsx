import type { KeyboardEvent } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { DramaArtifact, DramaEntity } from "@/lib/drama/types";
import { cn } from "@/lib/utils";
import { KIND_ICON } from "./common";
import { Package } from "lucide-react";

type Props = {
    entity: DramaEntity;
    sheet?: DramaArtifact;
    selected: boolean;
    /** The selected setting anywhere; a prop chip lights up when it is the one. */
    selectedId: string | null;
    /** Props shown as chips (a character's gear, a scene's furnishings). */
    props?: DramaEntity[];
    owner?: DramaEntity;
    onSelect: (id: string) => void;
};

const MAX_CHIPS = 4;

export function EntityCard({ entity, sheet, selected, selectedId, props = [], owner, onSelect }: Props) {
    const { t } = useAppTranslation();
    const Icon = KIND_ICON[entity.kind];
    const pick = (event: KeyboardEvent) => {
        if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        onSelect(entity.id);
    };
    return (
        <div
            role="button"
            tabIndex={0}
            aria-pressed={selected}
            onClick={() => onSelect(entity.id)}
            onKeyDown={pick}
            className={cn(
                "group flex min-w-0 cursor-pointer flex-col overflow-hidden rounded-xl border bg-[color:var(--wg-panel)] text-left outline-none transition-colors focus-visible:border-[color:var(--wg-home-accent)]",
                selected ? "border-[color:var(--wg-home-text)] shadow-[0_0_0_1px_var(--wg-home-text)]" : "border-[color:var(--wg-home-line)] hover:border-[color:var(--wg-home-line-strong)]",
            )}
        >
            <div className="grid aspect-[16/10] place-items-center overflow-hidden bg-[color:var(--wg-home-ghost)]">
                {sheet ? <img src={sheet.mediaUrl} alt="" loading="lazy" draggable={false} className="size-full object-cover" /> : <Icon className="size-8 text-[color:var(--wg-home-muted-strong)] opacity-60" strokeWidth={1.3} />}
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-1 p-3">
                <div className="flex min-w-0 items-baseline gap-2">
                    <h4 className="min-w-0 truncate text-[14px] font-semibold">{entity.name}</h4>
                    {owner ? <span className="shrink-0 truncate text-[11px] text-[color:var(--wg-home-muted)]">{t("属于 {name}", { name: owner.name })}</span> : null}
                </div>
                {entity.aliases.length ? <p className="!mb-0 truncate text-[11px] text-[color:var(--wg-home-muted)]">{entity.aliases.join("、")}</p> : null}
                <p className="!mb-0 truncate text-[12px] text-[color:var(--wg-home-muted)]">{entity.description || " "}</p>
                {props.length ? (
                    <div className="mt-1.5 flex flex-wrap items-center gap-1" aria-label={t(entity.kind === "scene" ? "陈设" : "装备")}>
                        {props.slice(0, MAX_CHIPS).map((prop) => (
                            <button
                                key={prop.id}
                                type="button"
                                title={prop.description || prop.name}
                                onClick={(event) => {
                                    event.stopPropagation();
                                    onSelect(prop.id);
                                }}
                                className={cn(
                                    "inline-flex h-6 max-w-[9rem] items-center gap-1 rounded-md border px-1.5 text-[11px] transition hover:border-[color:var(--wg-home-line-strong)] hover:text-[color:var(--wg-home-text)]",
                                    prop.id === selectedId ? "border-[color:var(--wg-home-text)] text-[color:var(--wg-home-text)]" : "border-[color:var(--wg-home-line)] text-[color:var(--wg-home-muted)]",
                                )}
                            >
                                <Package className="size-3 shrink-0" strokeWidth={1.6} />
                                <span className="truncate">{prop.name}</span>
                            </button>
                        ))}
                        {props.length > MAX_CHIPS ? <span className="text-[11px] text-[color:var(--wg-home-muted)]">+{props.length - MAX_CHIPS}</span> : null}
                    </div>
                ) : null}
            </div>
        </div>
    );
}
