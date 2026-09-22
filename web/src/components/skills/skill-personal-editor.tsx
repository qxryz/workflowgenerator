import { Input, Modal, Switch } from "antd";
import { useEffect, useState } from "react";

import { useAppTranslation } from "@/hooks/use-app-translation";
import type { InstalledSkill } from "@/services/skills/skill-presets";

/**
 * 个人技能编辑器。zodic-panel.tsx 也直接用它，所以仍从 skills-manager 再导出。
 * 终端功能已全链路移除，归属只保留「Zodiac 专属」开关。
 */
export function PersonalSkillEditorModal({ skill, onClose, onSave }: { skill: InstalledSkill | null; onClose: () => void; onSave: (skill: InstalledSkill) => void }) {
    const { t } = useAppTranslation();
    const [draft, setDraft] = useState(skill);
    useEffect(() => setDraft(skill), [skill]);
    if (!skill || !draft) return null;
    const patch = (value: Partial<InstalledSkill>) => setDraft((current) => (current ? { ...current, ...value } : current));
    return (
        <Modal
            title={t(skill.name === "未命名 Skill" ? "新建 Skill" : "编辑 Skill")}
            open
            onCancel={onClose}
            okText={t("保存")}
            cancelText={t("取消")}
            width={720}
            onOk={() => onSave({ ...draft, name: draft.name.trim() || "未命名 Skill", source: "personal", updatedAt: new Date().toISOString() })}
        >
            <div className="grid gap-4 pt-2">
                <label className="grid gap-1.5 text-xs font-medium">
                    {t("名称")}
                    <Input value={draft.name} onChange={(event) => patch({ name: event.target.value })} />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                    {t("简介")}
                    <Input value={draft.description} onChange={(event) => patch({ description: event.target.value })} />
                </label>
                <label className="flex items-center justify-between gap-3 text-xs font-medium">
                    <span>
                        {t("Zodiac 专属")}
                        <span className="ml-2 font-normal text-stone-400">{t("只在 Zodiac 对话框里附加使用")}</span>
                    </span>
                    <Switch checked={Boolean(draft.zodiacOnly)} onChange={(zodiacOnly) => patch({ zodiacOnly })} />
                </label>
                <label className="grid gap-1.5 text-xs font-medium">
                    {t("使用方式")}
                    <Input.TextArea rows={14} value={draft.body} onChange={(event) => patch({ body: event.target.value })} placeholder={t("写清适用场景、步骤、判断标准与交付要求。")} />
                </label>
            </div>
        </Modal>
    );
}
