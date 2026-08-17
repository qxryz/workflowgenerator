import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";

export type InstalledPlugin = {
    id: string;
    name: string;
    version: string;
    description?: string;
    url: string; // 安装来源,可用于更新
    source: string; // 缓存的插件源码,离线可用、版本固定
    enabled: boolean;
    local?: boolean; // 自动发现于 web/public/plugins 的本地插件(默认关闭,启用时按 url 重新拉取)
    official?: boolean; // 从官方注册表安装(用于在管理器里归类)
    installedAt: string;
};

type PluginStore = {
    plugins: InstalledPlugin[];
    upsert: (plugin: Omit<InstalledPlugin, "installedAt"> & { installedAt?: string }) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    remove: (id: string) => void;
};

export const usePluginStore = create<PluginStore>()(
    persist(
        (set) => ({
            plugins: [],
            upsert: (plugin) =>
                set((state) => {
                    const installedAt = plugin.installedAt || new Date().toISOString();
                    const exists = state.plugins.some((item) => item.id === plugin.id);
                    const next = { ...plugin, installedAt };
                    return { plugins: exists ? state.plugins.map((item) => (item.id === plugin.id ? next : item)) : [next, ...state.plugins] };
                }),
            setEnabled: (id, enabled) => set((state) => ({ plugins: state.plugins.map((item) => (item.id === id ? { ...item, enabled } : item)) })),
            remove: (id) => set((state) => ({ plugins: state.plugins.filter((item) => item.id !== id) })),
        }),
        {
            name: "infinite-canvas:plugin_store",
            storage: createJSONStorage(() => localForageStorage),
        },
    ),
);
