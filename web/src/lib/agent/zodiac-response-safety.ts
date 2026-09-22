import type { ZodiacDecisionUi } from "./zodiac-decision-ui";

type CanvasReplySafety = { allowAppliedRecap?: boolean };
type SafetyHistoryItem = {
    id: string;
    role: string;
    text: string;
    decision?: { ui: ZodiacDecisionUi };
    tool?: { status: string; ops?: Array<{ type: string; id?: string }>; resolvedOps?: Array<{ type: string; id?: string }> };
};

/** A native acknowledgement of an explicitly read-only request is not authorization for new canvas work. */
export function isCanvasRecapConfirmation(items: SafetyHistoryItem[], decisionId: string | undefined, nodes: Array<{ id: string }> = []) {
    if (!decisionId) return false;
    const index = items.findIndex((item) => item.id === decisionId);
    const decision = items[index]?.decision?.ui;
    if (decision?.type !== "confirm_summary") return false;
    const request = items.slice(0, index).findLast((item) => item.role === "user")?.text || "";
    if (!/(?:不要|不再|无需|不需要|禁止|别).{0,24}(?:提案|修改画布|改变画布|添加节点|创建节点|新建节点|执行操作)/u.test(request)) return false;
    const confirmation = [decision.question, ...decision.summary].join("\n");
    if (/(?:添加|创建|新建|搭建|写入|生成|修改|删除|运行|执行)|连接.{0,12}(?:画布|节点|工作流)/u.test(confirmation)) return false;
    const existingIds = new Set(nodes.map((node) => node.id));
    return items.slice(0, index).some((item) => {
        if (item.tool?.status !== "applied") return false;
        const additions = (item.tool.resolvedOps || item.tool.ops || []).filter((op) => op.type === "add_node");
        return additions.length > 0 && additions.every((op) => op.id && existingIds.has(op.id));
    });
}

/** Protect missing proposals without interpreting a verified, read-only acknowledgement as new work. */
export function claimsUnexecutedCanvasAction(text: string, context: CanvasReplySafety = {}) {
    const compact = text.replace(/\s+/gu, " ").trim();
    if (!compact) return false;
    const nextAction = /(?:我(?:现在|马上|这就|接下来)(?:会|将|把|来)?|我(?:会|将|把|来)|现在|接下来|下面).{0,32}(?:添加|加入|创建|新建|搭建|连接|放到|写入|生成).{0,20}(?:画布|节点|工作流)|(?:开始搭建|开始创建|开始添加).{0,12}(?:画布|节点|工作流)|操作指令\s*(?:如下|[:：↓])/u;
    if (nextAction.test(compact) || /我(?:添加|加入|创建|新建|搭建|连接|放到|写入|生成).{0,20}(?:画布|节点|工作流)/u.test(compact)) return true;
    const completedAction = /(?:已|已经|刚刚).{0,12}(?:添加|加入|创建|新建|搭建|连接|放到|写入).{0,20}(?:画布|节点|工作流)/u;
    if (!completedAction.test(compact)) return false;
    // Even a read-only acknowledgement must not claim an additional/current-turn mutation.
    const newAction = /(?:这次|本次|重新|另外|额外|又|再次).{0,24}(?:添加|加入|创建|新建|搭建|连接|放到|写入)|(?:添加|加入|创建|新建).{0,12}(?:另一个|新的|额外)/u;
    return !context.allowAppliedRecap || newAction.test(compact);
}
