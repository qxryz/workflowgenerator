import type { ZodiacDecisionUi } from "./zodiac-decision-ui";

export type ZodiacHistoryItem = {
    id: string;
    role: string;
    text: string;
    tool?: {
        summary: string;
        status: "pending" | "running" | "applied" | "failed" | "rejected";
        error?: string;
    };
    decision?: { ui: ZodiacDecisionUi; status: "pending" | "answered" | "cancelled"; answerLabel?: string };
};

const toolStatus = {
    pending: "待确认，尚未执行。",
    running: "正在执行，不要重复提交。",
    applied: "已应用到画布；除非用户明确要求再次执行，否则不得重复添加或执行。",
    failed: "执行失败，不得描述为已完成。",
    rejected: "用户已拒绝，不得自行重新提交。",
};

/** Project durable UI receipts in place before request retention and compaction. Run progress is not conversation. */
export function projectZodiacConversationHistory<T extends ZodiacHistoryItem>(items: T[]): T[] {
    return items.flatMap((item): T[] => {
        if (item.role === "user") return [item];
        if (item.tool) {
            return [{
                ...item,
                role: "assistant",
                text: [`画布操作回执（${item.tool.status}）：${item.tool.summary}`, toolStatus[item.tool.status], item.tool.error ? `错误：${item.tool.error}` : ""].filter(Boolean).join("\n"),
            }];
        }
        if (item.role !== "assistant") return [];
        const decision = item.decision;
        if (!decision) return item.text.trim() ? [item] : [];
        const ui = decision.ui;
        const receipt = [
            `已显示原生选择卡（${ui.type}，${decision.status}）：${ui.question}`,
            "options" in ui ? `选项：${ui.options.map((option) => option.label).join("；")}` : "",
            "summary" in ui ? `确认内容：${ui.summary.join("；")}` : "",
            decision.status === "cancelled" ? "用户已中断此选择。以之后的用户消息调整任务，不得继续旧选项或重新弹出此卡。" : decision.status === "answered" ? `用户答复：${decision.answerLabel || "已继续，具体要求见后续用户消息"}。无需重复询问。` : "等待用户答复，不得当作已经确认或执行。",
        ].filter(Boolean).join("\n");
        return [{ ...item, text: [item.text, receipt].filter(Boolean).join("\n\n") }];
    });
}
