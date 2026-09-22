import type { WorkflowExecutionMode, WorkflowRunSnapshot } from "../canvas/workflow-execution";

export async function runZodiacProposalGeneration(
    runWorkflow: (startNodeIds: string[] | undefined, mode: WorkflowExecutionMode) => Promise<WorkflowRunSnapshot<unknown>>,
    generationNodeIds: string[],
    executionMode: WorkflowExecutionMode = "guided",
) {
    if (!generationNodeIds.length) return undefined;
    const run = await runWorkflow(generationNodeIds, executionMode);
    if (run.status === "error") {
        const failedStep = run.nodes.find((node) => node.status === "error");
        throw new Error(failedStep?.error?.message || "方案已加入画布，但有步骤没有完成");
    }
    if (run.status === "stopped") throw new Error("方案已加入画布，运行已停止");
    return run;
}
