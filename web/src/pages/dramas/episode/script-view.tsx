import { useMemo } from "react";

import { scriptBlocks } from "@/lib/drama/episode-steps";
import { cn } from "@/lib/utils";

/** Screenplay typography shared by the reading view and the editor. */
export const SCREENPLAY = "font-serif text-[15px] leading-8";

/** Scene headings across, speakers in a left column, action and dialogue on the right. */
export function ScriptView({ script, className }: { script: string; className?: string }) {
    const blocks = useMemo(() => scriptBlocks(script), [script]);
    return (
        <div className={cn(SCREENPLAY, "px-5 py-4", className)}>
            {blocks.map((block, index) => {
                if (block.type === "gap") return <div key={index} className="h-2" />;
                if (block.type === "scene")
                    return (
                        <h4 key={index} className="mb-1 mt-5 border-b border-[color:var(--wg-home-line)] pb-1 text-[13px] font-semibold tracking-wide first:mt-0">
                            {block.text}
                        </h4>
                    );
                return (
                    <p key={index} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-4">
                        <span className="text-right text-[13px] font-semibold tracking-wide text-[color:var(--wg-home-muted)]">{block.speaker}</span>
                        <span className={cn("whitespace-pre-wrap break-words", block.type === "action" && "col-start-2 text-[color:var(--wg-home-muted)]")}>{block.text}</span>
                    </p>
                );
            })}
        </div>
    );
}
