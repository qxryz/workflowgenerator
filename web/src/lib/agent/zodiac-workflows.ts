import catalog from "./zodiac-workflow-catalog.json" with { type: "json" };

/** Load a directory, a selected workflow, or just the current stage's guidance. */
export const ZODIAC_WORKFLOW_TOOL = {
    name: "workflow",
    description: "读取创作工作流目录、阶段大纲或当前阶段规则。按需读取，不创建计划。",
    parameters: { type: "object", properties: {
        id: { type: "string", description: "省略返回目录；ad-tvc / drama-series / mv / custom" },
        stageId: { type: "string", description: "流程阶段 ID；省略只读取大纲，传入后读取该阶段的完整规则" },
    } },
};

export function readZodiacWorkflow(args: unknown) {
    const input = args && typeof args === "object" ? args as { id?: unknown; stageId?: unknown } : {};
    if (input.id === undefined || input.id === "") return { workflows: catalog.workflows.map(({ id, name, description }) => ({ id, name, description })) };
    if (typeof input.id !== "string") throw new Error("workflow.id 必须是工作流 ID");
    const selected = catalog.workflows.find(workflow => workflow.id === input.id);
    if (!selected) throw new Error("工作流不存在，请先读取工作流目录");
    const { stages, ...workflow } = selected;
    const base = { ...workflow, version: catalog.version, sharedContract: catalog.sharedContract };
    if (input.stageId === undefined) return { ...base, stages: stages.map(({ guidance: _, ...stage }) => stage) };
    const stage = stages.find(stage => stage.id === input.stageId);
    if (!stage) throw new Error("流程阶段不存在，请使用大纲中的阶段 ID");
    return { ...base, stage };
}
