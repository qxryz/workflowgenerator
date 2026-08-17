import type { StateStorage } from "zustand/middleware";
import { getDesktopValue, isDesktopApp, markLegacyImport, removeDesktopValue, setDesktopValue, wasLegacyValueImported } from "@/services/desktop-storage";

const NATIVE_NAMESPACE = "zustand-v1";
let legacyStore: Promise<LocalForage> | null = null;

function getLegacyStore() {
    legacyStore ||= import("localforage").then((module) => {
        const localforage = ((module as unknown as { default?: LocalForage }).default || module) as LocalForage;
        localforage.config({
            name: "infinite-canvas",
            storeName: "app_state",
        });
        return localforage;
    });
    return legacyStore;
}

export const localForageStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        if (isDesktopApp()) {
            const saved = await getDesktopValue(NATIVE_NAMESPACE, name);
            if (saved != null) return saved;
            if (await wasLegacyValueImported(NATIVE_NAMESPACE, name)) return null;
            const legacy = (await (await getLegacyStore()).getItem<string>(name)) || window.localStorage.getItem(name);
            if (legacy != null) await setDesktopValue(NATIVE_NAMESPACE, name, legacy);
            await markLegacyImport(NATIVE_NAMESPACE, name);
            return legacy;
        }
        try {
            return (await (await getLegacyStore()).getItem<string>(name)) || null;
        } catch {
            return window.localStorage.getItem(name);
        }
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        if (isDesktopApp()) {
            await setDesktopValue(NATIVE_NAMESPACE, name, value);
            await markLegacyImport(NATIVE_NAMESPACE, name);
            return;
        }
        try {
            await (await getLegacyStore()).setItem(name, value);
        } catch {
            window.localStorage.setItem(name, value);
        }
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        if (isDesktopApp()) {
            await removeDesktopValue(NATIVE_NAMESPACE, name);
            await markLegacyImport(NATIVE_NAMESPACE, name);
            return;
        }
        try {
            await (await getLegacyStore()).removeItem(name);
        } catch {
            window.localStorage.removeItem(name);
        }
    },
};
