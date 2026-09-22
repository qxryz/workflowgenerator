import { create } from "zustand";
import { readUserPreference, saveUserPreference } from "@/lib/user-preference-storage";

export const CANVAS_SIDE_PANEL_MOTION_MS = 500;
export const CANVAS_SIDE_PANEL_MIN_WIDTH = 220;
export const CANVAS_SIDE_PANEL_MAX_WIDTH = 480;
export const CANVAS_SIDE_PANEL_DEFAULT_WIDTH = 280;

const WIDTH_KEY = "canvas-side-panel-width";
const OPEN_KEY = "canvas-side-panel-open";

type CanvasSidePanelStore = {
    width: number;
    panelOpen: boolean;
    panelMounted: boolean;
    panelClosing: boolean;
    preferencesHydrated: boolean;
    setWidth: (width: number) => void;
    commitWidth: (width: number) => void;
    openPanel: () => void;
    closePanel: () => void;
    togglePanel: () => void;
};

let widthTouched = false;
let openTouched = false;
let hydrationPromise: Promise<void> | null = null;

export const useCanvasSidePanelStore = create<CanvasSidePanelStore>((set, get) => ({
    width: CANVAS_SIDE_PANEL_DEFAULT_WIDTH,
    panelOpen: true,
    panelMounted: true,
    panelClosing: false,
    preferencesHydrated: false,
    setWidth: (width) => {
        widthTouched = true;
        set({ width: normalizeWidth(width) });
    },
    commitWidth: (width) => {
        widthTouched = true;
        const normalized = normalizeWidth(width);
        set({ width: normalized });
        void saveUserPreference(WIDTH_KEY, normalized);
    },
    openPanel: () => {
        openTouched = true;
        void saveUserPreference(OPEN_KEY, true);
        set({ panelOpen: true, panelMounted: true, panelClosing: false });
    },
    closePanel: () => {
        if (!get().panelMounted || get().panelClosing) return;
        openTouched = true;
        void saveUserPreference(OPEN_KEY, false);
        set({ panelOpen: false, panelClosing: true });
        setTimeout(() => {
            if (get().panelClosing) set({ panelMounted: false, panelClosing: false });
        }, CANVAS_SIDE_PANEL_MOTION_MS);
    },
    togglePanel: () => (get().panelOpen ? get().closePanel() : get().openPanel()),
}));

export function hydrateCanvasSidePanelPreferences() {
    if (hydrationPromise) return hydrationPromise;
    hydrationPromise = Promise.all([readUserPreference(WIDTH_KEY), readUserPreference(OPEN_KEY)]).then(([storedWidth, storedOpen]) => {
        const patch: Partial<CanvasSidePanelStore> = { preferencesHydrated: true };
        if (!widthTouched) patch.width = normalizeWidth(storedWidth);
        if (!openTouched) {
            const panelOpen = normalizeOpen(storedOpen);
            patch.panelOpen = panelOpen;
            patch.panelMounted = panelOpen;
            patch.panelClosing = false;
        }
        useCanvasSidePanelStore.setState(patch);
    });
    return hydrationPromise;
}

function normalizeWidth(value: unknown) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return CANVAS_SIDE_PANEL_DEFAULT_WIDTH;
    return Math.min(CANVAS_SIDE_PANEL_MAX_WIDTH, Math.max(CANVAS_SIDE_PANEL_MIN_WIDTH, parsed));
}

function normalizeOpen(value: unknown) {
    if (value === false || value === 0 || value === "0" || value === "false") return false;
    return true;
}

if (typeof window !== "undefined") queueMicrotask(() => void hydrateCanvasSidePanelPreferences());
