import assert from "node:assert/strict";
import test from "node:test";

import { resolveCanvasWorkflowGenerationInputs } from "../src/lib/canvas/canvas-workflow-inputs.ts";
import { createWorkflowExecution } from "../src/lib/canvas/workflow-execution.ts";
import { resolveCanvasInputBindings } from "../src/lib/canvas/canvas-input-bindings.ts";

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

    assert.deepEqual(
        inputs.map((input) => input.text),
        ["后来选择的版本"],
    );
});

test("live canvas edits made after compilation are picked up as the last valid version", () => {
    const editedSlot = {
        ...frozenSlot,
        metadata: {
            ...frozenSlot.metadata,
            currentResultVersionId: "v3",
            resultVersions: [...frozenSlot.metadata.resultVersions, { id: "v3", status: "success", primaryArtifactId: "v3-text", artifacts: [{ id: "v3-text", kind: "text", content: "编辑后的版本" }] }],
        },
    } as const;

    const inputs = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [{ sourceNodeId: "story-slot", sourceNodeType: "text", sourceActionNodeId: "story-action", versionId: "v1", resolution: "frozen" }],
        frozenInputs: [{ nodeId: "story-slot", type: "text", title: "故事结果", ready: true, text: "编译时版本" }],
        frozenNodes: [frozenSlot],
        liveNodes: [editedSlot],
        workflowInputs: [],
    });

    assert.deepEqual(
        inputs.map((input) => input.text),
        ["编辑后的版本"],
    );
});

test("a frozen workflow source cannot disappear into an empty generation input list", () => {
    assert.throws(
        () =>
            resolveCanvasWorkflowGenerationInputs({
                sourceSnapshot: [{ sourceNodeId: "character-image", sourceNodeType: "image", resolution: "frozen" }],
                frozenInputs: [],
                frozenNodes: [],
                workflowInputs: [],
            }),
        /上游.*character-image/,
    );
});

test("a completed workflow source with no artifacts cannot become text-only generation", () => {
    assert.throws(
        () =>
            resolveCanvasWorkflowGenerationInputs({
                sourceSnapshot: [{ sourceNodeId: "character-slot", sourceNodeType: "image", sourceActionNodeId: "character-action", resolution: "workflow" }],
                frozenInputs: [],
                frozenNodes: [],
                workflowInputs: [{ nodeId: "character-action", artifacts: [] }],
            }),
        /上游.*character-slot/,
    );
});

test("persisted image artifacts keep dimensions and byte size for downstream provider validation", () => {
    const [input] = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [{ sourceNodeId: "character-slot", sourceNodeType: "image", sourceActionNodeId: "character-action", resolution: "workflow" }],
        frozenInputs: [],
        frozenNodes: [],
        workflowInputs: [{ nodeId: "character-action", artifacts: [{ id: "character-image", kind: "image", content: "", storageKey: "image:character", bytes: 4096, naturalWidth: 768, naturalHeight: 1024 }] }],
    });
    assert.equal(input.ready, true);
    assert.equal(input.image?.storageKey, "image:character");
    assert.equal(input.image?.bytes, 4096);
    assert.equal(input.image?.width, 768);
    assert.equal(input.image?.height, 1024);
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

test("frozen group membership restores aliases for every member and ignores later additions", () => {
    const inputs = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [
            { sourceNodeId: "portrait", sourceNodeType: "image", resolution: "frozen", bindingNodeIds: ["character"] },
            { sourceNodeId: "description", sourceNodeType: "text", resolution: "frozen", bindingNodeIds: ["character"] },
        ],
        frozenInputs: [
            { nodeId: "portrait", type: "image", ready: true, title: "主视觉", image: { id: "portrait", name: "p.png", type: "image/png", dataUrl: "data:image/png;base64,YQ==" } },
            { nodeId: "description", type: "text", ready: true, title: "角色资料", text: "完整设定" },
        ],
        frozenNodes: [],
        liveNodes: [{ ...frozenSlot, id: "later-addition", metadata: { groupId: "character", content: "后来加入" } }],
        workflowInputs: [],
    });
    assert.deepEqual(
        inputs.map((input) => input.bindingNodeIds),
        [["character"], ["character"]],
    );
    assert.deepEqual(
        resolveCanvasInputBindings(inputs, "@[node:character]").selectedInputs.map((input) => input.nodeId),
        ["portrait", "description"],
    );
});

test("every artifact produced in the run retains its source group aliases", () => {
    const inputs = resolveCanvasWorkflowGenerationInputs({
        sourceSnapshot: [{ sourceNodeId: "portrait-slot", sourceNodeType: "image", sourceActionNodeId: "render", resolution: "workflow", bindingNodeIds: ["character", "cast"] }],
        frozenInputs: [],
        frozenNodes: [],
        workflowInputs: [
            {
                nodeId: "render",
                artifacts: [
                    { id: "front", kind: "image", content: "data:image/png;base64,YQ==" },
                    { id: "side", kind: "image", content: "data:image/png;base64,Yg==" },
                ],
            },
        ],
    });
    assert.deepEqual(
        inputs.map((input) => input.bindingNodeIds),
        [
            ["character", "cast"],
            ["character", "cast"],
        ],
    );
    assert.equal(resolveCanvasInputBindings(inputs, "@[node:character]").selectedInputs.length, 2);
});

test("generated and versioned artifacts retain frozen group titles even after the live group is renamed", () => {
    const bindingTitles = { character: "人物 · 小狸", cast: "全体人物" };
    const artifacts = [
        { id: "front", kind: "image" as const, title: "主视觉", content: "data:image/png;base64,YQ==" },
        { id: "side", kind: "image" as const, title: "侧面", content: "data:image/png;base64,Yg==" },
    ];
    const slot = {
        ...frozenSlot,
        id: "portrait-slot",
        metadata: { ...frozenSlot.metadata, resultVersions: [{ id: "v1", status: "success", primaryArtifactId: "front", artifacts }] },
    } as const;
    for (const resolution of ["workflow", "frozen"] as const) {
        const inputs = resolveCanvasWorkflowGenerationInputs({
            sourceSnapshot: [{ sourceNodeId: slot.id, sourceNodeType: "image", sourceActionNodeId: "render", resolution, ...(resolution === "frozen" ? { versionId: "v1" } : {}), bindingNodeIds: ["character", "cast"] }],
            frozenInputs: [{ nodeId: slot.id, type: "image", title: "主视觉", ready: false, bindingNodeIds: ["character", "cast"], bindingTitles }],
            frozenNodes: [slot],
            liveNodes: [slot, { ...frozenSlot, id: "character", type: "group", title: "人物 · 后来的名称" }],
            workflowInputs: resolution === "workflow" ? [{ nodeId: "render", artifacts }] : [],
        });
        assert.deepEqual(
            inputs.map((input) => input.bindingTitles),
            [bindingTitles, bindingTitles],
        );
        assert.deepEqual(
            inputs.map((input) => input.bindingNodeIds),
            [
                ["character", "cast"],
                ["character", "cast"],
            ],
        );
    }
});
