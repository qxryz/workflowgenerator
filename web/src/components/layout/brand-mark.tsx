import { cn } from "@/lib/utils";

export function BrandMark({ className, iconClassName }: { className?: string; iconClassName?: string }) {
    return (
        <span
            className={cn(
                "grid size-9 shrink-0 overflow-hidden rounded-[11px_13px_10px_12px] border border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-paper)] shadow-[1px_2px_0_color-mix(in_srgb,var(--wg-pencil)_18%,transparent)]",
                className,
            )}
            aria-hidden="true"
        >
            <img src="/brand/wg.svg" alt="" draggable={false} className={cn("size-full select-none object-cover", iconClassName)} />
        </span>
    );
}
