import { createDesktopJsonStore } from "@/services/desktop-storage";
import type { PluginStorage } from "@/types/canvas-plugin";

// 画布内轻量事件总线,供节点/插件互相通信
type Handler = (payload: unknown) => void;
const handlers = new Map<string, Set<Handler>>();

export function emitCanvasEvent(event: string, payload?: unknown) {
    handlers.get(event)?.forEach((handler) => {
        try {
            handler(payload);
        } catch (error) {
            console.error(`[canvas-event] handler for "${event}" failed`, error);
        }
    });
}

export function onCanvasEvent(event: string, handler: Handler) {
    let set = handlers.get(event);
    if (!set) {
        set = new Set();
        handlers.set(event, set);
    }
    set.add(handler);
    return () => set!.delete(handler);
}

// 插件私有存储,按 pluginId 命名空间隔离
const stores = new Map<string, ReturnType<typeof createDesktopJsonStore>>();

export function createPluginStorage(pluginId: string): PluginStorage {
    let store = stores.get(pluginId);
    if (!store) {
        store = createDesktopJsonStore({
            namespace: `plugin-data-v1:${pluginId}`,
            legacy: { name: "infinite-canvas-plugins", storeName: pluginId },
        });
        stores.set(pluginId, store);
    }
    return {
        get: (key) => store!.getItem(key),
        set: async (key, value) => {
            await store!.setItem(key, value);
        },
        remove: async (key) => {
            await store!.removeItem(key);
        },
    };
}
