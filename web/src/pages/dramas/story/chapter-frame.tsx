import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

type Props = { meta: ReactNode; actions?: ReactNode; /** A slim row under the header. */ bar?: ReactNode; /** false when the child manages its own height (a review frame). */ scroll?: boolean; children: ReactNode };

/** The centre column: a quiet header row and one scrolling area. */
export function ChapterFrame({ meta, actions, bar, scroll = true, children }: Props) {
    return (
        <div className="flex h-full min-h-0 min-w-0 flex-col">
            <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[color:var(--wg-home-line)] px-5">
                <div className="flex min-w-0 flex-1 items-center gap-2 overflow-hidden text-[12px] text-[color:var(--wg-home-muted)]">{meta}</div>
                <div className="flex shrink-0 items-center gap-2">{actions}</div>
            </header>
            {bar ? <div className="flex shrink-0 items-center gap-3 border-b border-[color:var(--wg-home-line)] bg-[color:var(--wg-home-ghost)] px-5 py-2">{bar}</div> : null}
            <div className={cn("min-h-0 flex-1", scroll ? "thin-scrollbar overflow-auto" : "flex flex-col p-4")}>{children}</div>
        </div>
    );
}
