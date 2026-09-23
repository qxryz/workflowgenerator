import type { SVGProps } from "react";

type Glyph = "add" | "attachment" | "skill" | "send" | "stop" | "trace" | "history" | "collapse" | "check" | "alert" | "retry" | "chevron" | "play" | "pause" | "file";
/** A compact, consistent icon family for Zodiac's interaction controls. */
export function ZodiacGlyph({ name, ...props }: SVGProps<SVGSVGElement> & { name: Glyph }) {
    return (
        <svg width="18" height="18" viewBox="0 0 20 20" fill="none" aria-hidden="true" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" {...props}>
            {name === "add" ? (
                <path d="M10 4v12M4 10h12" />
            ) : name === "send" ? (
                <path d="M10 16V4m-5 5 5-5 5 5" />
            ) : name === "stop" ? (
                <rect x="6" y="6" width="8" height="8" rx="1" fill="currentColor" stroke="none" />
            ) : name === "attachment" ? (
                <path d="m7 10 5-5a2.1 2.1 0 0 1 3 3l-7 7a3.5 3.5 0 0 1-5-5l7-7m-2 9 5-5" />
            ) : name === "trace" ? (
                <>
                    <path d="M4 4v10a2 2 0 0 0 2 2h10M4 7h6a2 2 0 0 1 2 2v1" />
                    <circle cx="4" cy="4" r="1" fill="currentColor" />
                    <circle cx="12" cy="12" r="2" />
                    <circle cx="16" cy="16" r="1" fill="currentColor" />
                </>
            ) : name === "history" ? (
                <>
                    <path d="M3 8a7 7 0 1 1 1 7M3 4v4h4M10 6v4l3 2" />
                </>
            ) : name === "collapse" ? (
                <>
                    <path d="M13 4h3v12h-3M4 10h7m-3-3 3 3-3 3" />
                </>
            ) : name === "check" ? (
                <path pathLength="1" d="m4 10 4 4 8-8" />
            ) : name === "alert" ? (
                <>
                    <circle cx="10" cy="10" r="7" />
                    <path d="M10 6v4m0 3v.1" />
                </>
            ) : name === "retry" ? (
                <>
                    <path d="M4 7a6 6 0 1 1 0 6M4 3v4h4" />
                </>
            ) : name === "chevron" ? (
                <path d="m6 8 4 4 4-4" />
            ) : name === "play" ? (
                <path d="m7 5 8 5-8 5Z" fill="currentColor" stroke="none" />
            ) : name === "pause" ? (
                <path d="M7 5v10m6-10v10" strokeWidth="2.8" />
            ) : name === "file" ? (
                <>
                    <path d="M5 3h6l4 4v10H5ZM11 3v4h4M8 11h4m-4 3h4" />
                </>
            ) : (
                <>
                    <rect x="3" y="3" width="5" height="5" rx="1" />
                    <rect x="3" y="12" width="5" height="5" rx="1" />
                    <rect x="12" y="12" width="5" height="5" rx="1" />
                    <path d="M14.5 2.5v6m-3-3h6" />
                </>
            )}
        </svg>
    );
}
