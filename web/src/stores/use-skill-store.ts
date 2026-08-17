import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { localForageStorage } from "@/lib/localforage-storage";
import { BUILT_IN_SKILLS, createPersonalSkill, type InstalledSkill } from "@/services/skills/skill-presets";

type SkillStore = {
    skills: InstalledSkill[];
    save: (skill: InstalledSkill) => void;
    remove: (id: string) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    setZodiacOnly: (id: string, zodiacOnly: boolean) => void;
    move: (id: string, direction: -1 | 1) => void;
};

export const useSkillStore = create<SkillStore>()(
    persist(
        (set) => ({
            skills: BUILT_IN_SKILLS,
            save: (skill) =>
                set((state) => {
                    const normalized = skill.source === "personal" ? createPersonalSkill(skill) : { ...skill, updatedAt: new Date().toISOString() };
                    return {
                        skills: state.skills.some((item) => item.id === normalized.id)
                            ? state.skills.map((item) => (item.id === normalized.id ? { ...normalized, priority: item.priority, enabled: item.enabled, zodiacOnly: item.zodiacOnly } : item))
                            : [...state.skills, { ...normalized, priority: nextPriority(state.skills) }],
                    };
                }),
            remove: (id) => set((state) => ({ skills: state.skills.filter((skill) => skill.id !== id || skill.source === "built-in") })),
            setEnabled: (id, enabled) => set((state) => ({ skills: state.skills.map((skill) => (skill.id === id ? { ...skill, enabled } : skill)) })),
            setZodiacOnly: (id, zodiacOnly) => set((state) => ({ skills: state.skills.map((skill) => (skill.id === id ? { ...skill, zodiacOnly } : skill)) })),
            move: (id, direction) =>
                set((state) => {
                    const ordered = [...state.skills].sort((a, b) => a.priority - b.priority);
                    const index = ordered.findIndex((skill) => skill.id === id);
                    const target = index + direction;
                    if (index < 0 || target < 0 || target >= ordered.length) return state;
                    [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
                    return { skills: ordered.map((skill, priority) => ({ ...skill, priority: (priority + 1) * 10 })) };
                }),
        }),
        {
            name: "workflowgenerator:skills-v1",
            storage: createJSONStorage(() => localForageStorage),
            version: 1,
            partialize: (state) => ({ skills: state.skills }),
            merge: (persisted, current) => {
                const saved = (((persisted || {}) as Partial<SkillStore>).skills || []).filter((skill) => !skill.id.startsWith("open-design."));
                const savedById = new Map(saved.map((skill) => [skill.id, skill]));
                const builtInIds = new Set(BUILT_IN_SKILLS.map((skill) => skill.id));
                const official = BUILT_IN_SKILLS.map((fallback) => {
                    const installed = savedById.get(fallback.id);
                    return installed && installed.source !== "personal"
                        ? { ...fallback, ...installed, enabled: installed.enabled ?? fallback.enabled, priority: installed.priority ?? fallback.priority }
                        : { ...fallback, enabled: installed?.enabled ?? fallback.enabled, priority: installed?.priority ?? fallback.priority };
                });
                const additional = saved.filter((skill) => !builtInIds.has(skill.id));
                return { ...current, skills: [...official, ...additional] };
            },
        },
    ),
);

function nextPriority(skills: InstalledSkill[]) {
    return Math.max(0, ...skills.map((skill) => skill.priority)) + 10;
}
