import { Clapperboard } from "lucide-react";
import { useEffect, useMemo } from "react";

import { StoryboardStrip } from "@/components/drama/storyboard-strip";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { neighbourShot, type ShotMediaKind } from "@/lib/drama/episode-steps";
import { lookAvailable } from "@/lib/drama/media/prompts";
import { isStale } from "@/lib/drama/media/state";
import { BatchBar } from "./batch-bar";
import type { EpisodeCtx } from "./context";
import { prepareEnv, prepareShot } from "./prepare";
import { ShotPanel } from "./shot-panel";

/** Anything the arrow keys already mean something to: fields, buttons and links, segmented and radio groups, tabs, sliders, players. */
const INTERACTIVE =
    "input, textarea, select, button, a[href], summary, video, audio, [contenteditable='true'], [tabindex]:not([tabindex='-1']), .ant-segmented, .ant-select, .ant-slider, " +
    ["slider", "combobox", "tablist", "tab", "radiogroup", "radio", "listbox", "menu", "menuitem", "switch", "spinbutton"].map((role) => `[role='${role}']`).join(", ");

/** ←/→ move the selected shot unless focus is in an interactive control (the shot cards themselves excepted) or something floats above the page. */
function useShotKeys(ctx: EpisodeCtx) {
    const { shots, selectedId, select } = ctx;
    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if ((event.key !== "ArrowLeft" && event.key !== "ArrowRight") || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
            const target = event.target as Element | null;
            if (target instanceof Element && (!(target === document.body || target.closest("main")) || (target.closest(INTERACTIVE) && !target.closest("[data-shot]")))) return;
            const next = neighbourShot(shots, selectedId, event.key === "ArrowRight" ? 1 : -1);
            if (!next) return;
            event.preventDefault();
            event.stopPropagation();
            select(next);
            window.requestAnimationFrame(() => document.querySelectorAll<HTMLElement>("[data-shot]")[shots.findIndex((shot) => shot.id === next)]?.focus());
        };
        window.addEventListener("keydown", onKey, true);
        return () => window.removeEventListener("keydown", onKey, true);
    }, [shots, selectedId, select]);
}

/** 画面 / 视频 / 声音: the whole episode as a contact sheet on the left, the selected shot's workbench on the right. */
export function MediaStep({ ctx, kind }: { ctx: EpisodeCtx; kind: ShotMediaKind }) {
    const { t, language } = useAppTranslation();
    const { snapshot, shots, artifacts, selectedId } = ctx;
    const { project } = snapshot;
    const env = useMemo(() => prepareEnv(project, ctx.entities, ctx.sheets, shots, artifacts), [project, ctx.entities, ctx.sheets, shots, artifacts]);
    useShotKeys(ctx);

    if (!shots.length) {
        return (
            <div className="flex h-full flex-col items-center justify-center gap-4 text-sm text-[color:var(--wg-home-muted)]">
                <Clapperboard className="size-7" strokeWidth={1.4} />
                <p>{t("还没有镜头，先拆分镜头")}</p>
                <button type="button" className="wg-primary-button" onClick={() => ctx.go("shots")}>
                    {t("去拆分镜头")}
                </button>
            </div>
        );
    }

    const selected = shots.find((shot) => shot.id === selectedId) ?? shots[0];
    const { hasStyle, hasPalette } = lookAvailable(project);
    // Out of date = made from other inputs than today's, judged with every available look on, as the workbench does.
    const stale = (shot: (typeof shots)[number], adopted?: (typeof artifacts)[number]) =>
        Boolean(adopted) && isStale(adopted!, prepareShot(kind, env, shot, { useStyle: hasStyle, usePalette: hasPalette, language, model: adopted!.model }).inputHash);

    return (
        <div className="flex h-full min-h-0">
            <section className="flex min-w-0 flex-1 flex-col">
                {kind === "audio" ? <div className="h-3 shrink-0" /> : <BatchBar ctx={ctx} kind={kind} />}
                <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto px-6 pb-6">
                    <StoryboardStrip shots={shots} artifacts={artifacts} kind={kind} selectedId={selected.id} onSelect={ctx.select} isStale={stale} />
                </div>
            </section>
            <aside className="flex w-[420px] shrink-0 flex-col border-l border-[color:var(--wg-home-line)]">
                <ShotPanel ctx={ctx} kind={kind} shot={selected} env={env} />
            </aside>
        </div>
    );
}
