import { cn } from "@/lib/utils";

type ZodiacAvatarProps = {
    className?: string;
    imageClassName?: string;
    label?: string;
};

export function ZodiacAvatar({ className, imageClassName, label = "Zodiac" }: ZodiacAvatarProps) {
    return (
        <span
            className={cn(
                "inline-grid size-9 shrink-0 overflow-hidden rounded-[11px_13px_10px_12px] border border-[color:var(--wg-pencil-soft)] bg-[color:var(--wg-paper)] shadow-[1px_2px_0_color-mix(in_srgb,var(--wg-pencil)_16%,transparent)]",
                className,
            )}
            role="img"
            aria-label={label}
        >
            <img
                src="/brand/zodiac-avatar.png"
                alt=""
                draggable={false}
                className={cn("size-full select-none object-cover", imageClassName)}
            />
        </span>
    );
}
