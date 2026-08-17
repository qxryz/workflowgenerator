import { useCallback } from "react";
import { flushSync } from "react-dom";
import { useNavigate, type NavigateOptions, type To } from "react-router-dom";

type RouteTransitionDirection = "enter-workspace" | "return-home" | "return-workflow";

type SmoothNavigateOptions = NavigateOptions & {
    direction: RouteTransitionDirection;
    preload?: () => Promise<unknown>;
    onCommit?: () => void;
};

const TRANSITION_DURATION = 500;

export function useSmoothNavigation() {
    const navigate = useNavigate();

    return useCallback(
        async (to: To, { direction, preload, onCommit, ...navigateOptions }: SmoothNavigateOptions) => {
            const root = document.documentElement;
            if (root.dataset.wgRouteTransition || root.dataset.wgRouteFallback) return;

            if (preload) {
                try {
                    await preload();
                } catch {
                    // The router retains its own loading fallback if preloading fails.
                }
            }

            const commit = () => {
                flushSync(() => {
                    onCommit?.();
                    navigate(to, navigateOptions);
                });
            };

            const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
            if (reduceMotion || typeof document.startViewTransition !== "function") {
                root.dataset.wgRouteFallback = direction;
                commit();
                window.setTimeout(() => {
                    delete root.dataset.wgRouteFallback;
                }, TRANSITION_DURATION);
                return;
            }

            root.dataset.wgRouteTransition = direction;
            const transition = document.startViewTransition(commit);
            transition.finished.finally(() => {
                delete root.dataset.wgRouteTransition;
            });
        },
        [navigate],
    );
}
