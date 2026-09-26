import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import { serverStateStorage } from "@/lib/server-state-storage";
import { createPersonalSkill, pruneInstalledSkills, type InstalledSkill } from "@/services/skills/skill-presets";

type SkillStore = {
    skills: InstalledSkill[];
    workflowSkillIds: Record<string, string[]>;
    save: (skill: InstalledSkill) => void;
    remove: (id: string) => void;
    setWorkflowSkill: (workflowId: string, skillId: string, attached: boolean) => void;
    setEnabled: (id: string, enabled: boolean) => void;
    setZodiacOnly: (id: string, zodiacOnly: boolean) => void;
    move: (id: string, direction: -1 | 1) => void;
};

export const useSkillStore = create<SkillStore>()(
    persist(
        (set) => ({
            skills: [],
            workflowSkillIds: {},
            save: (skill) =>
                set((state) => {
                    const normalized = skill.source === "personal" ? createPersonalSkill(skill) : { ...skill, updatedAt: new Date().toISOString() };
                    return {
                        skills: state.skills.some((item) => item.id === normalized.id)
                            ? state.skills.map((item) => (item.id === normalized.id ? { ...normalized, priority: item.priority, enabled: item.enabled, zodiacOnly: item.zodiacOnly } : item))
                            : [...state.skills, { ...normalized, priority: nextPriority(state.skills) }],
                    };
                }),
            remove: (id) => set((state) => ({
                skills: state.skills.filter((skill) => skill.id !== id),
                workflowSkillIds: Object.fromEntries(Object.entries(state.workflowSkillIds).map(([workflowId, ids]) => [workflowId, ids.filter((item) => item !== id)])),
            })),
            setWorkflowSkill: (workflowId, skillId, attached) => set((state) => {
                if (attached && !state.skills.some((skill) => skill.id === skillId && skill.enabled)) return state;
                const current = state.workflowSkillIds[workflowId] || [];
                return { workflowSkillIds: {
                    ...state.workflowSkillIds,
                    [workflowId]: attached ? [...new Set([...current, skillId])] : current.filter((id) => id !== skillId),
                } };
            }),
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
            storage: createJSONStorage(() => serverStateStorage),
            version: 1,
            partialize: (state) => ({ skills: state.skills, workflowSkillIds: state.workflowSkillIds }),
            // 已删除的内置技能不能从老数据里复活；其余已装技能原样保留。
            merge: (persisted, current) => ({
                ...current,
                skills: pruneInstalledSkills((persisted as Partial<SkillStore> | undefined)?.skills),
                workflowSkillIds: (persisted as Partial<SkillStore> | undefined)?.workflowSkillIds || {},
            }),
        },
    ),
);

function nextPriority(skills: InstalledSkill[]) {
    return Math.max(0, ...skills.map((skill) => skill.priority)) + 10;
}
