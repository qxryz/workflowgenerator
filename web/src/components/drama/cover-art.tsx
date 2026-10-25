import { useId } from "react";

export const COVER_VARIANT_COUNT = 5;
const GLOWS = ["#c6ad7f", "#9fb7c9", "#b9a3c4", "#a9bf9c", "#d1a28f"];

/** Small deterministic PRNG so a {variant, seed} cover always draws the same picture. */
function mulberry32(seed: number) {
    let a = seed | 0;
    return () => {
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

export const randomCover = (): { variant: number; seed: number } => ({ variant: Math.floor(Math.random() * COVER_VARIANT_COUNT), seed: Math.floor(Math.random() * 2 ** 31) });

function Stars({ seed }: { seed: number }) {
    const rand = mulberry32(seed ^ 0x9e3779b9);
    return (
        <g fill="currentColor" stroke="none">
            {Array.from({ length: 16 }, (_, i) => (
                <circle key={i} cx={Math.round(rand() * 460 + 10)} cy={Math.round(rand() * 140 + 14)} r={i % 3 === 0 ? 1.5 : 0.85} opacity={i % 2 === 0 ? 0.6 : 0.3} />
            ))}
        </g>
    );
}

function Pine({ x, y, size = 1 }: { x: number; y: number; size?: number }) {
    return (
        <g transform={`translate(${x} ${y}) scale(${size})`}>
            <path d="M0-62 12-40H7L17-27H11L23-12H16L26 0H-26l10-12h-7l12-15h-6l10-13h-5Z" fill="currentColor" fillOpacity=".055" stroke="none" />
            <path d="M0 0V-62M-12-40 0-60 12-40M-17-27 0-51 17-27M-23-12 0-40 23-12M-26 0 0-27 26 0" fill="none" />
            <path d="M-15-28 0-49 15-28M-19-13 0-34 19-13" opacity=".22" />
        </g>
    );
}

function Moonlit({ id, seed }: { id: string; seed: number }) {
    return (
        <>
            <Stars seed={seed} />
            <circle cx="346" cy="77" r="58" fill={`url(#${id}-glow)`} stroke="none" />
            <circle cx="346" cy="77" r="35" fill="currentColor" fillOpacity=".07" strokeWidth="1.2" />
            <path d="M362 47C337 48 322 73 328 92C332 105 342 110 352 110" opacity=".38" />
            <g opacity=".24">
                <circle cx="349" cy="59" r="5" />
                <circle cx="365" cy="83" r="7" />
                <circle cx="342" cy="92" r="3" />
                <path d="M338 61 342 57M359 98 363 94M364 60 368 64" />
            </g>
            <path d="M0 169 51 143 86 163 143 105 186 147 223 124 286 174 329 147 397 166 440 132 480 159V223H0Z" fill="currentColor" fillOpacity=".035" strokeOpacity=".35" />
            <path d="m111 138 32-33 11 33 12-7 20 16m-42-42-4 52m83-33-4 32 11-10 22 26m188-40-7 32 14-9" strokeOpacity=".25" />
            <path d="M0 196Q69 164 134 197T271 198T397 201 480 178V221H0Z" fill="currentColor" fillOpacity=".06" strokeOpacity=".42" />
            <g opacity=".48" strokeWidth=".9">
                <Pine x={39} y={197} size={0.46} />
                <Pine x={57} y={193} size={0.6} />
                <Pine x={80} y={194} size={0.35} />
                <Pine x={410} y={203} size={0.48} />
                <Pine x={435} y={195} size={0.68} />
                <Pine x={460} y={190} size={0.44} />
            </g>
            <path d="M0 221Q93 207 159 224T305 221T480 216" strokeOpacity=".48" />
            <g opacity=".42" strokeWidth=".7">
                {[0, 1, 2, 3, 4, 5, 6].map((i) => (
                    <path key={i} d={`M${302 - i * 9} ${226 + i * 7}h${62 + i * 17}m${8 + i * 2} 0h${12 + i * 3}`} />
                ))}
                <path d="M48 235h51m14 0h29M166 248h47m-181 7h94m24 0h32M221 267h38M83 278h58" />
            </g>
            <path d="M0 277Q62 251 128 276L178 300H0M383 300Q421 268 480 265V300" fill="currentColor" fillOpacity=".11" strokeOpacity=".55" />
            <g strokeWidth="1.1" opacity=".72">
                <Pine x={27} y={282} size={1.16} />
                <Pine x={65} y={280} size={0.78} />
                <Pine x={97} y={286} size={0.48} />
            </g>
            <path d="m423 290 4-33m-4 17-8-9m13 1 8-11m-26 42-6-25m5 13-10-7M191 93q7-7 14 0 7-7 14 0m28 10q5-5 10 0 5-5 10 0" strokeOpacity=".5" />
        </>
    );
}

function Stage({ id }: { id: string }) {
    return (
        <>
            <path d="M34 258V67Q240-21 446 67V258M47 256V76Q240-7 433 76V256" strokeOpacity=".65" strokeWidth="1.4" />
            <path d="M63 252V90Q240 15 417 90V252" strokeOpacity=".42" />
            <path d="M91 244V109Q240 48 389 109V244Z" fill={`url(#${id}-shade)`} strokeOpacity=".48" />
            <path d="m206 91-80 153h228L274 91" fill={`url(#${id}-glow)`} stroke="none" />
            <g strokeOpacity=".25" strokeWidth=".7">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <path key={i} d={`M${130 + i * 28} 244 ${32 + i * 52} 300`} />
                ))}
                <path d="M79 253h322M61 266h358M40 283h400" />
            </g>
            <path d="M71 100Q240 21 409 100L405 132Q372 126 354 106Q325 137 296 107Q266 136 240 109Q212 136 184 107Q153 137 126 106Q99 132 74 132Z" fill="currentColor" fillOpacity=".09" strokeOpacity=".75" />
            <path d="M86 104q20 12 40-4m1-3q29 22 57 6m2-3q26 23 54 7m1 0q29 14 54-7m3 2q26 19 55-5m1 3q18 13 40 4" strokeOpacity=".3" />
            <path d="M75 126Q98 136 125 108Q122 166 92 187Q105 213 114 246H71ZM405 126Q383 136 355 108Q358 166 388 187Q375 213 366 246H409Z" fill="currentColor" fillOpacity=".1" strokeOpacity=".65" />
            <path d="M84 137q12 30 0 49m12-54q9 26-8 53m20-62q5 30-16 59m-11 14 0 42m10-42 10 45m295-104q-12 30 0 49m-12-54q-9 26 8 53m-20-62q-5 30 16 59m11 14v42m-10-42-10 45" strokeOpacity=".38" />
            <path d="m76 190 18-4 2 6-20 4m310-10 18 4-2 6-20-4" strokeWidth="2" strokeOpacity=".75" />
            <g strokeOpacity=".35">
                <path d="M49 123h14v116H49m368-116h14v116h-14M45 115h22v9H45m368-9h22v9h-22M43 238h26v11H43m368-11h26v11h-26" />
                <path d="M55 134v92m370-92v92M215 44q25-18 50 0-25 17-50 0Zm12 0h26" />
            </g>
            <ellipse cx="240" cy="240" rx="51" ry="8" fill="currentColor" fillOpacity=".06" strokeOpacity=".22" />
            <g strokeOpacity=".75" strokeWidth="1.1">
                <path d="M234 188q0-8 6-8t6 8q0 7-6 7t-6-7Zm3 7v4l-6 4-6 13 3 2 7-11 1 10-9 20q13 5 26 0l-9-20 1-10 7 11 3-2-6-13-6-4v-4" fill="currentColor" fillOpacity=".17" />
                <path d="m236 239-1 4h5m4-4 1 4h5m-17-9 5-13m10 13-6-13" strokeOpacity=".5" />
            </g>
            <path d="M27 258H453M18 264H462M9 271H471" strokeOpacity=".5" />
            <g fill="currentColor" fillOpacity=".08" strokeOpacity=".28">
                {[0, 1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
                    <path key={i} d={`M${25 + i * 51} 300v-9q0-12 16-12t16 12v9m-29-4h26`} />
                ))}
            </g>
        </>
    );
}

function City({ id }: { id: string }) {
    const buildings = [
        { x: 22, y: 66, w: 74, rows: 6 },
        { x: 110, y: 107, w: 60, rows: 5 },
        { x: 184, y: 146, w: 43, rows: 3 },
        { x: 323, y: 121, w: 57, rows: 5 },
        { x: 393, y: 51, w: 71, rows: 7 },
    ];
    return (
        <>
            <circle cx="271" cy="82" r="41" fill={`url(#${id}-glow)`} stroke="none" />
            <circle cx="271" cy="82" r="22" strokeOpacity=".3" fill="currentColor" fillOpacity=".06" />
            <path d="M0 217h480M236 215v-68h20v-28h13v22h15v74m9 0v-53h18v53" strokeOpacity=".18" />
            <path d="M0 34 99 58V247L0 284ZM105 88l69 22v121l-69 15Zm74 48 48 17v67l-48 12Zm144-19 59-18v144l-59-18Zm68-63L480 27v258l-89-38Z" fill="currentColor" fillOpacity=".055" strokeOpacity=".58" />
            <g strokeOpacity=".37" strokeWidth=".8">
                {buildings.map(({ x, y, w, rows }) => (
                    <g key={x}>
                        <path d={`M${x - 5} ${y - 9}h${w}m${-w} 5h${w}M${x + 3} ${y - 10}v-13h14v13`} />
                        {Array.from({ length: rows }, (_, row) =>
                            [0, 1, 2].map((col) => (
                                <g key={`${row}-${col}`}>
                                    <rect x={x + (col * (w - 9)) / 3} y={y + row * 22} width="9" height="13" fill="currentColor" fillOpacity={(row + col) % 4 === 0 ? 0.2 : 0.025} />
                                    <path d={`M${x + (col * (w - 9)) / 3 + 4.5} ${y + row * 22}v13m-4.5-7h9`} opacity=".6" />
                                </g>
                            )),
                        )}
                    </g>
                ))}
            </g>
            <path d="M14 221h73v30H14Zm103-7h42v22h-42m285-5h64v27h-64M10 219l9-9h61l11 9m307 10 8-10h54l10 10" fill="currentColor" fillOpacity=".045" strokeOpacity=".58" />
            <path d="M38 225v25m24-25v25m356-16v20m23-20v23M0 278l235-62m245 63-192-63M53 300l193-84m177 84-149-84m-38 84 18-72m44 72-37-72" strokeOpacity=".37" />
            <path d="M184 263h117m-132 13h151m-167 17h188" strokeWidth="4" strokeOpacity=".16" />
            <g strokeOpacity=".64" strokeWidth="1.2">
                <path d="M125 261v-91q0-13 12-13m-10 10h21m-18 0 2 15h11l2-15m-29 94h19M365 266v-90q0-13-12-13m10 10h-21m18 0-2 15h-11l-2-15m10 93h20" />
                <path d="M42 47q145 103 389-10m-387 6q137 114 384-12" strokeWidth=".7" strokeOpacity=".3" />
            </g>
            <g strokeOpacity=".22" strokeWidth=".7">
                <path d="M76 24v10m41 9v12m87-26v10m116-18v13m40 35v10m-174 8v10m111 16v9M17 169v13m278 46v9M160 266h27m130-14h18m-203 38h31m196-9h25" />
            </g>
            <path d="M254 234q3-4 6 0l3 14h-12Zm0 14-1 8m6-8 2 8m-4-25v9" fill="currentColor" fillOpacity=".2" strokeOpacity=".8" strokeWidth="1.1" />
            <path d="M246 231q11-14 23 0Z" fill="currentColor" fillOpacity=".25" strokeOpacity=".7" />
        </>
    );
}

function Orbit({ id, seed }: { id: string; seed: number }) {
    return (
        <>
            <Stars seed={seed} />
            <g strokeOpacity=".24" strokeWidth=".7">
                <circle cx="242" cy="151" r="123" />
                <circle cx="242" cy="151" r="130" />
                {Array.from({ length: 60 }, (_, i) => (
                    <path key={i} d={`M242 21v${i % 5 === 0 ? 8 : 3}`} transform={`rotate(${i * 6} 242 151)`} />
                ))}
                <path d="M88 151h32m244 0h32M242 0v20m0 260v20M140 48l16 16m173 173 16 16M140 254l16-16M329 65l16-16" />
            </g>
            <ellipse cx="242" cy="151" rx="187" ry="59" transform="rotate(-22 242 151)" strokeOpacity=".65" />
            <ellipse cx="242" cy="151" rx="177" ry="52" transform="rotate(-22 242 151)" strokeOpacity=".22" strokeDasharray="2 5" />
            <ellipse cx="242" cy="151" rx="78" ry="127" transform="rotate(38 242 151)" strokeOpacity=".38" />
            <ellipse cx="242" cy="151" rx="53" ry="115" transform="rotate(-39 242 151)" strokeOpacity=".24" />
            <circle cx="242" cy="151" r="59" fill={`url(#${id}-glow)`} stroke="none" />
            <circle cx="242" cy="151" r="43" fill="var(--wg-panel)" strokeOpacity=".8" strokeWidth="1.4" />
            <circle cx="242" cy="151" r="42" fill={`url(#${id}-shade)`} stroke="none" />
            <g clipPath={`url(#${id}-planet)`} strokeOpacity=".38" strokeWidth=".9">
                <path d="M188 120q37 21 104 11m-110-2q52 22 115 10m-112 0q48 15 108 9m-108 5q48 17 108 8m-103 5q50 19 98 5m-80 10q37 12 62 2" />
                <path d="M253 110c-33 21-37 58-7 84" strokeOpacity=".3" />
            </g>
            <path d="M72 207q56 16 138-5m84-28q99-34 118-76" strokeOpacity=".7" />
            <g fill="var(--wg-panel)" strokeOpacity=".8">
                <circle cx="377" cy="97" r="12" />
                <circle cx="112" cy="205" r="7" />
                <circle cx="186" cy="49" r="5" />
            </g>
            <path d="M380 87q-13 9-1 20m-270 93 5 10" strokeOpacity=".4" />
            <ellipse cx="377" cy="97" rx="21" ry="5" transform="rotate(-24 377 97)" strokeOpacity=".65" />
            <path d="M56 64h20m-10-10v20M414 226h14m-7-7v14M76 262h51m-51 5h31m273-223h25m-25 5h40" strokeOpacity=".42" />
            <g fill="currentColor" stroke="none" opacity=".35">
                <circle cx="413" cy="150" r="1.7" />
                <circle cx="62" cy="178" r="1" />
                <circle cx="293" cy="262" r="1.5" />
                <circle cx="319" cy="64" r="1" />
            </g>
        </>
    );
}

function Portrait({ id }: { id: string }) {
    return (
        <>
            <path d="M117 271V133a123 123 0 0 1 246 0v138M128 271V135a112 112 0 0 1 224 0v136" strokeOpacity=".35" />
            <path d="M144 267V137a96 96 0 0 1 192 0v130Z" fill={`url(#${id}-shade)`} strokeOpacity=".4" />
            <path d="M164 270q5-46 47-58l8-33q-18-15-14-47-13-9-8-24 2-40 41-47 39-7 55 28 6 14 0 34l8 24q2 6-10 7l-2 16q-2 14-23 17l-1 25q44 13 51 58Z" fill="var(--wg-panel)" strokeOpacity=".75" strokeWidth="1.3" />
            <path d="M199 126q-18-48 16-65 35-20 62 3 18 13 18 34-20-5-36-22-13 31-47 35l-4 24-9-9Z" fill="currentColor" fillOpacity=".12" strokeOpacity=".65" />
            <g strokeOpacity=".32" strokeWidth=".8">
                <path d="M202 104q41-15 51-33m-52 25q24-9 39-29m-37 18q12-19 32-19m-34 46q25-3 39-17m19-28q13 21 31 24m-28-30q12 17 25 20M203 137q12-9 16 4-1 10-10 7" />
                <path d="M216 153q11 22 34 23m-26-17 9 7m-14-7 10 11m-10-4 7 7M268 116q9-6 20-2m-18 7q7-4 14 0m-5-2v3m6 27 8 2m-14 12q5 2 10 0" />
            </g>
            <path d="m218 181 22 12 27-7m-50 20 23 18 25-13m-54 1 17 30 12-18 15 19 10-31M208 216l-17 17 21 12-8 25m70-54 14 17-20 12 7 25M240 226v43" strokeOpacity=".65" />
            <path d="m184 244-4 20m10-24-6 27m110-25 5 25m-13-21 5 21m-43-21v17" strokeOpacity=".25" />
            <g strokeOpacity=".5" strokeWidth=".9">
                <path d="M107 263Q73 206 94 155m12 97q-37-11-36-34 25 5 33 21m-3-13q-34-17-27-37 21 8 26 25m-3-11q-25-23-11-41 17 14 12 32m13 49q20-28 8-44-20 12-13 30m-4-20q20-22 9-36-15 9-12 24" />
                <path d="M373 263q34-57 13-108m-12 97q37-11 36-34-25 5-33 21m3-13q34-17 27-37-21 8-26 25m3-11q25-23 11-41-17 14-12 32m-13 49q-20-28-8-44 20 12 13 30m4-20q-20-22-9-36 15 9 12 24" />
            </g>
            <path d="M153 278h174m-153 6h132M61 64h35m-17-17v35m305-18h35m-17-17v35" strokeOpacity=".3" />
            <g fill="currentColor" stroke="none" opacity=".4">
                <circle cx="80" cy="127" r="2" />
                <circle cx="400" cy="127" r="2" />
                <circle cx="240" cy="30" r="2" />
            </g>
        </>
    );
}

type Props = { variant: number; seed: number; className?: string };

export function CoverArt({ variant, seed, className }: Props) {
    const id = `cover-${useId().replace(/:/g, "")}`;
    const kind = ["moonlit", "stage", "city", "orbit", "portrait"][Math.abs(Math.trunc(variant)) % COVER_VARIANT_COUNT];
    const glow = GLOWS[Math.abs(seed) % GLOWS.length];
    const mirrored = (Math.abs(seed) >> 3) % 2 === 1;
    return (
        <svg viewBox="0 0 480 300" className={className ?? "absolute inset-0 h-full w-full"} aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid slice" fill="none" stroke="currentColor" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round">
            <defs>
                <linearGradient id={`${id}-shade`} x1="0" y1="0" x2="1" y2="1">
                    <stop stopColor="currentColor" stopOpacity=".015" />
                    <stop offset="1" stopColor="currentColor" stopOpacity=".13" />
                </linearGradient>
                <radialGradient id={`${id}-glow`}>
                    <stop stopColor={glow} stopOpacity=".2" />
                    <stop offset="1" stopColor={glow} stopOpacity="0" />
                </radialGradient>
                <pattern id={`${id}-paper`} width="7" height="7" patternUnits="userSpaceOnUse">
                    <path d="m1 2 .5-.5m3 4 .5-.5" strokeOpacity=".065" strokeWidth=".65" />
                </pattern>
                {kind === "orbit" && (
                    <clipPath id={`${id}-planet`}>
                        <circle cx="242" cy="151" r="42" />
                    </clipPath>
                )}
            </defs>
            <path d="M0 0H480V300H0Z" fill={`url(#${id}-shade)`} stroke="none" />
            <g transform={mirrored ? "translate(480 0) scale(-1 1)" : undefined}>
                {kind === "moonlit" && <Moonlit id={id} seed={seed} />}
                {kind === "stage" && <Stage id={id} />}
                {kind === "city" && <City id={id} />}
                {kind === "orbit" && <Orbit id={id} seed={seed} />}
                {kind === "portrait" && <Portrait id={id} />}
            </g>
            <path d="M0 0H480V300H0Z" fill={`url(#${id}-paper)`} stroke="none" />
            <path d="M16 34V16H34M446 16H464V34M464 266V284H446M34 284H16V266" strokeOpacity=".22" strokeWidth=".8" />
        </svg>
    );
}
