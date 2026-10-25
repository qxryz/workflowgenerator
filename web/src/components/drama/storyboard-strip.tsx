/**
 * StoryboardStrip — contact sheet of every shot in an episode, with the state of one media kind.
 *
 * Props: `StoryboardStrip({ shots, artifacts, kind, selectedId?, onSelect, isStale? })`
 *   shots: DramaShot[]            in order
 *   artifacts: DramaArtifact[]    shot-owned artifacts of the episode (any kind, newest first)
 *   kind: "image" | "video" | "audio"
 *   selectedId?: string           highlighted shot
 *   onSelect(shotId): void
 *   isStale?(shot, adopted?): boolean   true when the adopted artifact was made from older inputs
 * Thumbnail = the adopted artifact of `kind`; video/audio cards fall back to the adopted storyboard image.
 * Arrow keys move between cards, Enter or Space selects.
 */
import { AlertCircle, AudioLines, Clapperboard, Loader2 } from "lucide-react";
import { useRef, type KeyboardEvent } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import { MEDIA_STATE_LABELS, type MediaState } from "@/lib/drama/labels";
import { adoptedArtifact, ownerState } from "@/lib/drama/media/state";
import type { DramaArtifact, DramaShot } from "@/lib/drama/types";
import { cn } from "@/lib/utils";

type Props = {
    shots: DramaShot[];
    artifacts: DramaArtifact[];
    kind: "image" | "video" | "audio";
    selectedId?: string;
    onSelect: (shotId: string) => void;
    isStale?: (shot: DramaShot, adopted?: DramaArtifact) => boolean;
};

const DOT: Record<MediaState, string> = {
    none: "border border-[color:var(--wg-home-line-strong)]",
    pending: "animate-pulse bg-[color:var(--wg-home-accent)]",
    ready: "bg-[color:var(--wg-home-accent)]",
    adopted: "bg-[color:var(--wg-home-text)]",
    stale: "border border-dashed border-[color:var(--wg-home-muted)]",
    failed: "bg-destructive",
};

export function StoryboardStrip({ shots, artifacts, kind, selectedId, onSelect, isStale }: Props) {
    const { t } = useAppTranslation();
    const grid = useRef<HTMLDivElement>(null);
    // One drama has one aspect: take it from any stored picture.
    const sized = artifacts.find((artifact) => artifact.kind === "image" && artifact.width && artifact.height);
    const ratio = sized ? `${sized.width} / ${sized.height}` : "16 / 9";
    const move = (event: KeyboardEvent<HTMLElement>) => {
        const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
        if (!step) return;
        const cards = Array.from(grid.current?.querySelectorAll<HTMLElement>("[data-shot]") ?? []);
        cards[cards.indexOf(event.currentTarget) + step]?.focus();
        event.preventDefault();
    };

    return (
        <div ref={grid} className="grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2.5" role="listbox" aria-label={t("镜头")}>
            {shots.map((shot) => {
                const own = artifacts.filter((artifact) => artifact.shotId === shot.id && artifact.kind === kind);
                const adopted = adoptedArtifact(own);
                const ownState = ownerState(own);
                const state = ownState === "adopted" && isStale?.(shot, adopted) ? "stale" : ownState;
                const cover = adopted && kind === "image" ? adopted : adoptedArtifact(artifacts.filter((artifact) => artifact.shotId === shot.id && artifact.kind === "image"));
                const selected = shot.id === selectedId;
                return (
                    <button
                        key={shot.id}
                        type="button"
                        role="option"
                        aria-selected={selected}
                        data-shot
                        onClick={() => onSelect(shot.id)}
                        onKeyDown={move}
                        className={cn(
                            "group flex flex-col gap-1.5 rounded-xl border p-1.5 text-left outline-none transition",
                            selected ? "border-[color:var(--wg-home-text)] bg-[color:var(--wg-home-hover)]" : "border-[color:var(--wg-home-line)] hover:bg-[color:var(--wg-home-hover)] focus-visible:border-[color:var(--wg-home-line-strong)]",
                        )}
                    >
                        <Thumb cover={cover} adopted={adopted} kind={kind} state={state} ratio={ratio} />
                        <div className="flex items-center gap-1.5 px-0.5 text-[11px] text-[color:var(--wg-home-muted)]">
                            <span className="font-semibold text-[color:var(--wg-home-text)]">{shot.ord + 1}</span>
                            <span>{shot.seconds}s</span>
                            <span className="ml-auto flex items-center gap-1" title={t(MEDIA_STATE_LABELS[state])}>
                                <span className={cn("size-2 rounded-full", DOT[state])} />
                                {t(MEDIA_STATE_LABELS[state])}
                            </span>
                        </div>
                        <p className="line-clamp-1 px-0.5 text-xs text-[color:var(--wg-home-text)]">{shot.description || "—"}</p>
                    </button>
                );
            })}
        </div>
    );
}

function Thumb({ cover, adopted, kind, state, ratio }: { cover?: DramaArtifact; adopted?: DramaArtifact; kind: Props["kind"]; state: MediaState; ratio: string }) {
    const Icon = kind === "audio" ? AudioLines : Clapperboard;
    return (
        <div style={{ aspectRatio: ratio }} className="relative flex items-center justify-center overflow-hidden rounded-lg bg-[color:var(--wg-home-ghost)] text-[color:var(--wg-home-muted-strong)]">
            {cover?.mediaUrl ? <img src={cover.mediaUrl} alt="" loading="lazy" className={cn("size-full object-cover", state === "stale" && "opacity-60")} /> : <Icon className="size-5" strokeWidth={1.6} />}
            {kind === "video" && adopted ? <Clapperboard className="absolute bottom-1 right-1 size-3.5 text-white drop-shadow" strokeWidth={1.8} /> : null}
            {state === "pending" ? <Loader2 className="absolute right-1 top-1 size-3.5 animate-spin text-[color:var(--wg-home-accent)]" /> : null}
            {state === "failed" ? <AlertCircle className="absolute right-1 top-1 size-3.5 text-destructive" /> : null}
        </div>
    );
}
