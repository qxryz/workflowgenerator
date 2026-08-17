import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanvasWorkflowGenerationInputs } from "../src/lib/canvas/canvas-workflow-inputs.ts";
import { createWorkflowExecution } from "../src/lib/canvas/workflow-execution.ts";

const frozenSlot = {
    id: "story-slot",
    type: "text",
    title: "故事结果",
    position: { x: 0, y: 0 },
    width: 320,
    height: 200,
    metadata: {
        role: "result-slot",
        resultSlotMode: "text",
        resultSlotSourceNodeId: "story-action",
        slotState: "ready",
        status: "success",
        content: "后来选择的版本",
        currentResultVersionId: "v2",
        resultVersions: [
            { id: "v1", status: "success", primaryArtifactId: "v1-text", artifacts: [{ id: "v1-text", kind: "text", content: "编译时锁定的版本" }] },
            { id: "v2", status: "success", primaryArtifactId: "v2-text", artifacts: [{ id: "v2-text", kind: "text", content: "后来选择的版本" }] },
        ],
    },
} as const;

test("a frozen sourceSnapshot selects the last valid version when the source has multiple versions", () => {
    const inputs = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [{ sourceNodeId: "story-slot", sourceNodeType: "text", sourceActionNodeId: "story-action", versionId: "v1", resolution: "frozen" }],
        frozenInputs: [{ nodeId: "story-slot", type: "text", title: "故事结果", ready: true, text: "后来选择的版本" }],
        frozenNodes: [frozenSlot],
        workflowInputs: [],
    });

    assert.deepEqual(inputs.map((input) => input.text), ["后来选择的版本"]);
});

test("live canvas edits made after compilation are picked up as the last valid version", () => {
    const editedSlot = {
        ...frozenSlot,
        metadata: {
            ...frozenSlot.metadata,
            currentResultVersionId: "v3",
            resultVersions: [
                ...frozenSlot.metadata.resultVersions,
                { id: "v3", status: "success", primaryArtifactId: "v3-text", artifacts: [{ id: "v3-text", kind: "text", content: "编辑后的版本" }] },
            ],
        },
    } as const;

    const inputs = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [{ sourceNodeId: "story-slot", sourceNodeType: "text", sourceActionNodeId: "story-action", versionId: "v1", resolution: "frozen" }],
        frozenInputs: [{ nodeId: "story-slot", type: "text", title: "故事结果", ready: true, text: "编译时版本" }],
        frozenNodes: [frozenSlot],
        liveNodes: [editedSlot],
        workflowInputs: [],
    });

    assert.deepEqual(inputs.map((input) => input.text), ["编辑后的版本"]);
});

test("guided continue consumes the persisted upstream attempt, not live canvas selection", async () => {
    let liveCanvasSelection = "用户等待时切换到的版本";
    let downstreamInput = "";
    const execution = createWorkflowExecution({
        mode: "guided",
        graph: {
            nodes: [
                { id: "story-action", checkpoint: true, data: { sourceSnapshot: [] } },
                {
                    id: "video-action",
                    data: {
                        sourceSnapshot: [{ sourceNodeId: "story-slot", sourceNodeType: "text", sourceActionNodeId: "story-action", resolution: "workflow" }],
                    },
                },
            ],
            edges: [{ fromNodeId: "story-action", toNodeId: "video-action" }],
        },
        runNode: async (context) => {
            if (context.node.id === "story-action") {
                return { artifacts: [{ id: "run-v1", kind: "text" as const, content: "本轮上游产物" }] };
            }
            const resolved = resolveCanvasWorkflowGenerationInputs({
                sourceSnapshot: context.node.data?.sourceSnapshot || [],
                frozenInputs: [{ nodeId: "story-slot", type: "text", title: "故事结果", ready: true, text: liveCanvasSelection }],
                frozenNodes: [frozenSlot],
                workflowInputs: context.inputs,
            });
            downstreamInput = resolved[0]?.text || "";
            return { artifacts: [] };
        },
    });

    const paused = await execution.start();
    assert.equal(paused.status, "waiting_review");
    liveCanvasSelection = "再次切换的版本";
    const completed = await execution.continueNode("story-action");

    assert.equal(completed.status, "completed");
    assert.equal(downstreamInput, "本轮上游产物");
});
