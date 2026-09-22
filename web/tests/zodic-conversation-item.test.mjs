import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { transform } from "esbuild";

const source = await readFile(new URL("../src/components/agent/zodic-panel.tsx", import.meta.url), "utf8");
const start = source.indexOf("const ZodicConversationItem = memo(");
const end = source.indexOf("\nfunction sessionStateWithItems", start);
assert.ok(start >= 0 && end > start, "load the actual bounded conversation item renderer");
const { code } = await transform(
    `
const memo = fn => fn;
const Button='Button', ZodiacActivityCard='ZodiacActivityCard', ZodiacWorkProcess='ZodiacWorkProcess', AgentChatMessage='AgentChatMessage', ZodiacDecisionCard='ZodiacDecisionCard', AgentPendingToolCard='AgentPendingToolCard', ZodiacWorkOrderDetail='ZodiacWorkOrderDetail', AutoApplyTool='AutoApplyTool', SparklesIcon='SparklesIcon';
const stripZodiacReasoning = text => text;
const cleanAssistantProtocol = text => text;
const executionModeLabel = mode => mode;
const isDestructiveCanvasProposal = ops => Boolean(ops?.some(op => op.type === 'delete_node'));
function h(type, props, ...children) { return {type, props: {...props, children}}; }
${source.slice(start, end)}
export { ZodicConversationItem };
`,
    { loader: "tsx", format: "esm", jsxFactory: "h" },
);
const { ZodicConversationItem } = await import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);

function allNodes(tree) {
    if (!tree || typeof tree !== "object") return [];
    return [tree, ...[tree.props?.children].flat(2).flatMap(allNodes)];
}
function nodeText(tree) {
    if (typeof tree === "string") return tree;
    if (!tree || typeof tree !== "object") return "";
    return [tree.props?.children].flat(2).map(nodeText).join("");
}
const issue = { code: "missing_content", nodeId: "script", title: "分镜剧本" };
function render(status, issues, overrides = {}) {
    const item = { id: "old-proposal", role: "assistant", text: "旧方案", tool: { id: "tool", summary: "人物日常短片", ops: [], executionMode: "automatic", status, workOrder: { issues } } };
    const resolved = [];
    const recoveries = [];
    const props = {
        item,
        theme: { node: {} },
        showReasoning: false,
        confirmTools: true,
        decisionDisabled: false,
        onResolve: (...args) => resolved.push(args),
        onRecovery: (...args) => recoveries.push(args),
        onDecisionSubmit: () => {},
        onCreateSkill: () => {},
        ...overrides,
    };
    const before = structuredClone(item);
    const tree = ZodicConversationItem(props);
    return { tree, nodes: allNodes(tree), resolved, recoveries, item, before };
}

test("restored pending and failed incomplete proposals offer recovery without any apply action", () => {
    for (const status of ["pending", "failed"]) {
        for (const confirmTools of [true, false]) {
            const view = render(status, [issue], { confirmTools });
            assert.equal(
                view.nodes.some((node) => node.type === "AgentPendingToolCard" || node.type === "AutoApplyTool"),
                false,
            );
            const action = view.nodes.find((node) => node.type === "Button");
            assert.equal(nodeText(action), "补全工作单");
            assert.match(nodeText(view.tree), /分镜剧本/);
            assert.deepEqual(view.resolved, []);
            action.props.onClick();
            assert.equal(view.recoveries.length, 1);
            assert.equal(view.recoveries[0][1], "补全工作单");
            assert.match(view.recoveries[0][0], /分镜剧本/);
            assert.match(view.recoveries[0][0], /正文/);
            assert.match(view.recoveries[0][0], /引用/);
            assert.deepEqual(view.resolved, []);
            assert.deepEqual(view.item, view.before, "rendering and recovery do not mutate historical status");
        }
    }
});

test("applied historical proposals retain their applied display even when a restored order has issues", () => {
    const view = render("applied", [issue]);
    assert.ok(view.nodes.some((node) => node.type === "ZodiacWorkOrderDetail"));
    assert.ok(!view.nodes.some((node) => node.type === "Button" && nodeText(node) === "整理成 Skill"));
    assert.doesNotMatch(nodeText(view.tree), /补全工作单/);
    assert.deepEqual(view.resolved, []);
    assert.deepEqual(view.recoveries, []);
    assert.deepEqual(view.item, view.before);
});

test("complete pending and failed proposals preserve their existing approval actions", () => {
    for (const status of ["pending", "failed"]) {
        const view = render(status, []);
        const card = view.nodes.find((node) => node.type === "AgentPendingToolCard");
        assert.ok(card);
        card.props.onApprove();
        assert.deepEqual(view.resolved, [["old-proposal", "apply"]]);
        assert.deepEqual(view.recoveries, []);
    }
    assert.ok(render("pending", [], { confirmTools: false }).nodes.some((node) => node.type === "AgentPendingToolCard"));
});

test("incomplete proposal recovery respects the existing conversation busy state", () => {
    const view = render("pending", [issue], { decisionDisabled: true });
    const action = view.nodes.find((node) => node.type === "Button");
    assert.ok(action);
    assert.equal(action.props.disabled, true);
    assert.deepEqual(view.resolved, []);
    assert.deepEqual(view.recoveries, []);
});
