import { MessageSquareText } from "lucide-react";

import { cn } from "@/lib/utils";

export function AuthorNote({ note, expanded = false, className }: { note?: string; expanded?: boolean; className?: string }) {
    const content = note?.trim();

    return (
        <div className={cn("rounded-[9px_12px_10px_11px] border border-dashed border-[color:var(--wg-playful-mint-line)] bg-[color:var(--wg-playful-mint-soft)] px-3 py-2.5", !expanded && "min-h-[85px]", className)} data-author-note>
            <div className="flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.04em] text-[color:var(--wg-playful-mint)]">
                <MessageSquareText className="size-3.5 shrink-0" strokeWidth={1.7} />
                <span>作者备注</span>
            </div>
            <p
                className={cn("mt-1 min-h-[18px] text-[11px] leading-[18px]", content ? "text-[color:var(--wg-home-text)]" : "text-[color:var(--wg-home-muted-strong)]", expanded ? "whitespace-pre-wrap" : "line-clamp-2")}
                title={!expanded && content ? content : undefined}
            >
                {content || "作者暂未留下备注"}
            </p>
        </div>
    );
}
