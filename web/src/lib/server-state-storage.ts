import type { StateStorage } from "zustand/middleware";
import { getStoredValue, removeStoredValue, setStoredValue } from "@/services/server-storage";

// Every persisted zustand store lands in this one server namespace. The key is
// unchanged from the Tauri build so existing data keeps resolving.
const NATIVE_NAMESPACE = "zustand-v1";

/**
 * The `StateStorage` adapter the persisted zustand stores are built on.
 *
 * It used to be a two-tier thing: localforage/LocalStorage for the browser
 * build, a native store for the desktop build, plus an upgrade ladder between
 * them. There is one store now and it lives on the server, so this is just the
 * zustand-shaped view of it.
 *
 * Values are passed through as the opaque strings zustand persist produced —
 * no extra JSON layer, so the bytes on the server match what the old native
 * store held.
 */
export const serverStateStorage: StateStorage = {
    getItem: async (name) => {
        if (typeof window === "undefined") return null;
        return getStoredValue(NATIVE_NAMESPACE, name);
    },
    setItem: async (name, value) => {
        if (typeof window === "undefined") return;
        await setStoredValue(NATIVE_NAMESPACE, name, value);
    },
    removeItem: async (name) => {
        if (typeof window === "undefined") return;
        await removeStoredValue(NATIVE_NAMESPACE, name);
    },
};
