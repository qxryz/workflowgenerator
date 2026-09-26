import assert from "node:assert/strict";
import test from "node:test";

import { createPersonalSkill } from "../src/services/skills/skill-presets.ts";
import { useSkillStore } from "../src/stores/use-skill-store.ts";

test("a downloaded skill is attached only to the chosen workflow and uninstall clears its bindings", () => {
    const skill = createPersonalSkill({ id: "test-skill", name: "测试技能", enabled: true });
    useSkillStore.setState({ skills: [skill], workflowSkillIds: {} });
    try {
        const { setWorkflowSkill } = useSkillStore.getState();
        setWorkflowSkill("workflow-a", skill.id, true);
        assert.deepEqual(useSkillStore.getState().workflowSkillIds["workflow-a"], [skill.id]);
        assert.equal(useSkillStore.getState().workflowSkillIds["workflow-b"], undefined);

        useSkillStore.getState().setEnabled(skill.id, false);
        setWorkflowSkill("workflow-b", skill.id, true);
        assert.equal(useSkillStore.getState().workflowSkillIds["workflow-b"], undefined);

        useSkillStore.getState().remove(skill.id);
        assert.deepEqual(useSkillStore.getState().workflowSkillIds["workflow-a"], []);
    } finally {
        useSkillStore.setState({ skills: [], workflowSkillIds: {} });
    }
});
