import {
    Add01Icon,
    ArrowRight01Icon,
    WorkflowSquare01Icon,
} from "hugeicons-react";
import { lazy, Suspense, useMemo } from "react";

import { ZodiacAvatar } from "@/components/brand/zodiac-avatar";
import { useAppTranslation } from "@/hooks/use-app-translation";
import { useSmoothNavigation } from "@/hooks/use-smooth-navigation";
import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { useAgentStore } from "@/stores/use-agent-store";
import { useThemeStore } from "@/stores/use-theme-store";

const AsciiCursor = lazy(() => import("@/components/react-bits/ascii-cursor"));

export default function IndexPage() {
    const { t } = useAppTranslation();
    const smoothNavigate = useSmoothNavigation();
    const theme = useThemeStore((state) => state.theme);
    const openZodiac = useAgentStore((state) => state.openPanel);
    const hydrated = useCanvasStore((state) => state.hydrated);
    const projects = useCanvasStore((state) => state.projects);
    const recentProjects = useMemo(
        () => [...projects].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt)).slice(0, 2),
        [projects],
    );

    const startWithZodiac = () => {
        void smoothNavigate("/canvas?mode=choose", {
            direction: "enter-workspace",
            preload: () => import("@/pages/canvas"),
            onCommit: openZodiac,
        });
    };

    return (
        <main className="wg-home-original relative h-full min-h-0 overflow-hidden">
            <Suspense fallback={null}>
                <AsciiCursor
                    className="opacity-90"
                    characters="ZODIAC+→◇◌×"
                    size={26}
                    color={theme === "dark" ? "#8eb4ff" : "#155bc7"}
                    backgroundColor={theme === "dark" ? "#0b0e14" : "#f4f6f8"}
                    enableFade
                    spread={20}
                    persistence={2.8}
                    opacity={0.86}
                />
            </Suspense>

            <section className="pointer-events-none relative z-10 flex h-full min-h-[560px] flex-col items-center justify-center px-6 pb-24 text-center">
                <div className="pointer-events-auto flex flex-col items-center">
                    <ZodiacAvatar className="mb-5 size-20 -rotate-[1.5deg] rounded-[22px_25px_20px_24px] shadow-[3px_5px_0_color-mix(in_srgb,var(--wg-pencil)_15%,transparent)]" />
                    <span className="wg-ascii-label mb-3 text-[10px] text-[color:var(--wg-home-muted)]">[ WORKFLOW COMPANION ]</span>
                    <h1 className="text-[clamp(2.5rem,5.25vw,4.2rem)] font-semibold leading-none tracking-[-0.065em]">
                        Zodiac
                    </h1>
                    <p className="wg-ascii-label mt-3 text-[11px] text-[color:var(--wg-home-muted)]">THINK / DRAW / CONNECT / RUN</p>
                    <button
                        type="button"
                        onClick={startWithZodiac}
                        className="wg-sketch-button wg-sketch-button-primary mt-7 inline-flex h-11 cursor-pointer items-center gap-2 px-5 text-[13px] font-semibold focus-visible:outline-none"
                    >
                        {t("开始编排")}
                        <ArrowRight01Icon className="size-4" strokeWidth={1.8} />
                    </button>
                </div>
            </section>

            <div className="absolute inset-x-0 bottom-5 z-20 flex justify-center px-5">
                <div className="wg-sketch-panel flex min-h-14 max-w-[760px] items-center gap-1 bg-[color:var(--wg-home-floating)] p-1.5 backdrop-blur-xl">
                    <button
                        type="button"
                        onClick={() =>
                            void smoothNavigate("/canvas?mode=new", {
                                direction: "enter-workspace",
                                preload: () => import("@/pages/canvas"),
                            })
                        }
                        className="wg-sketch-button-quiet inline-flex h-11 cursor-pointer items-center gap-2 px-3.5 text-[12px] font-semibold"
                    >
                        <Add01Icon className="size-4 text-[color:var(--wg-home-accent)]" strokeWidth={1.8} />
                        {t("新建工作流")}
                    </button>
                    <span className="h-6 w-px bg-[color:var(--wg-home-line)]" aria-hidden="true" />
                    {hydrated && recentProjects.length ? (
                        recentProjects.map((project) => (
                            <button
                                key={project.id}
                                type="button"
                                onClick={() =>
                                    void smoothNavigate(`/canvas/${project.id}`, {
                                        direction: "enter-workspace",
                                        preload: () => import("@/pages/canvas/project"),
                                    })
                                }
                                className="wg-sketch-button-quiet hidden h-11 min-w-0 max-w-52 cursor-pointer items-center gap-2 px-3 text-left text-[12px] sm:flex"
                            >
                                <WorkflowSquare01Icon className="size-4 shrink-0 text-[color:var(--wg-home-muted)]" strokeWidth={1.7} />
                                <span className="min-w-0 truncate font-medium">{project.title}</span>
                            </button>
                        ))
                    ) : (
                        <button
                            type="button"
                            onClick={() =>
                                void smoothNavigate("/canvas", {
                                    direction: "enter-workspace",
                                    preload: () => import("@/pages/canvas"),
                                })
                            }
                            className="wg-sketch-button-quiet hidden h-11 cursor-pointer items-center gap-2 px-3 text-[12px] font-medium text-[color:var(--wg-home-muted)] sm:inline-flex"
                        >
                            {t("打开工作台")}
                        </button>
                    )}
                </div>
            </div>
        </main>
    );
}
