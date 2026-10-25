/**
 * DramaTabs — the only first-level tab style in the drama feature (drama page sections, episode steps).
 *
 * Props: `DramaTabs<V extends string>({ items, value, onChange, ariaLabel })`
 *   items: { value: V; label: string; icon: LucideIcon; badge?: ReactNode }[]
 *   value: V                      currently selected item
 *   onChange(v: V): void
 *   ariaLabel: string             translated inside; pass the Chinese source text
 * Labels go through `t()` here; do not pre-translate them.
 */
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { cn } from "@/lib/utils";

export type DramaTabItem<V extends string> = { value: V; label: string; icon: LucideIcon; badge?: ReactNode };

type Props<V extends string> = { items: DramaTabItem<V>[]; value: V; onChange: (value: V) => void; ariaLabel: string; className?: string };

export function DramaTabs<V extends string>({ items, value, onChange, ariaLabel, className }: Props<V>) {
    const { t } = useAppTranslation();
    return (
        <div className={cn("flex shrink-0 items-center gap-1 border-b border-[color:var(--wg-home-line)]", className)} role="tablist" aria-label={t(ariaLabel)}>
            {items.map((item) => {
                const active = item.value === value;
                return (
                    <button
                        key={item.value}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        className={cn(
                            "relative flex h-11 items-center gap-2 px-3.5 text-[13px] font-semibold outline-none transition focus-visible:bg-[color:var(--wg-home-hover)]",
                            active ? "text-[color:var(--wg-home-text)]" : "text-[color:var(--wg-home-muted)] hover:text-[color:var(--wg-home-text)]",
                        )}
                        onClick={() => onChange(item.value)}
                    >
                        <item.icon className="size-4" strokeWidth={1.6} />
                        <span>{t(item.label)}</span>
                        {item.badge}
                        {active ? <span className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[color:var(--wg-home-text)]" /> : null}
                    </button>
                );
            })}
        </div>
    );
}
