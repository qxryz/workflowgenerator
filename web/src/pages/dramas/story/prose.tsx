import { paragraphs } from "@/lib/drama/story";
import { cn } from "@/lib/utils";

/** Serif for reading; falls back to the UI font where no CJK serif is installed. */
const PROSE_FONT = '"Noto Serif SC", "Source Han Serif SC", "Songti SC", "STSong", ui-serif, serif';
/** The reading column shared by the chapter view, the editor and a chapter result. */
export const READING_COLUMN = "mx-auto w-full max-w-[40em] px-8";

/** Form controls ignore inherited sizes, so the editor sets them inline. */
export const PROSE_FIELD_STYLE = { fontFamily: PROSE_FONT, fontSize: 17, lineHeight: 2 } as const;
export const PROSE_TITLE_STYLE = { fontFamily: PROSE_FONT, fontSize: 26, lineHeight: 1.35 } as const;

export const PROSE_BODY = "text-[17px] leading-[2] text-[color:var(--wg-home-text)]";

export function ProseTitle({ children, className }: { children: string; className?: string }) {
    return (
        <h2 className={cn("text-[26px] font-semibold leading-snug tracking-tight", className)} style={{ fontFamily: PROSE_FONT }}>
            {children}
        </h2>
    );
}

export function Prose({ body, className }: { body: string; className?: string }) {
    return (
        <div className={cn(PROSE_BODY, className)} style={{ fontFamily: PROSE_FONT }}>
            {paragraphs(body).map((line, index) => (
                <p key={index} className="mb-[0.7em] indent-[2em] break-words">
                    {line}
                </p>
            ))}
        </div>
    );
}
