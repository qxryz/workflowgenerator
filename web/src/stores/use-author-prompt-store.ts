import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import type { RawPrompt } from "@/services/api/prompt-source-runtime";

export type InstalledAuthorPrompt = RawPrompt & {
    version: string;
    checksum: string;
    contentUrl: string;
    installedAt: string;
};

type AuthorPromptStore = {
    prompts: InstalledAuthorPrompt[];
    save: (prompt: InstalledAuthorPrompt) => void;
    remove: (id: string) => void;
};

export const useAuthorPromptStore = create<AuthorPromptStore>()(
    persist(
        (set) => ({
            prompts: [],
            save: (prompt) =>
                set((state) => {
                    const previous = state.prompts.find((item) => item.id === prompt.id);
                    const normalized = { ...prompt, installedAt: previous?.installedAt || prompt.installedAt };
                    return {
                        prompts: previous ? state.prompts.map((item) => (item.id === normalized.id ? normalized : item)) : [normalized, ...state.prompts],
                    };
                }),
            remove: (id) => set((state) => ({ prompts: state.prompts.filter((prompt) => prompt.id !== id) })),
        }),
        {
            name: "workflowgenerator:author-prompts-v1",
            storage: createJSONStorage(() => localForageStorage),
            version: 1,
            partialize: (state) => ({ prompts: state.prompts }),
            merge: (persisted, current) => {
                const prompts = (((persisted || {}) as Partial<AuthorPromptStore>).prompts || []).filter((prompt) => prompt.id?.startsWith("author.") && Boolean(prompt.prompt?.trim()));
                return { ...current, prompts };
            },
        },
    ),
);
