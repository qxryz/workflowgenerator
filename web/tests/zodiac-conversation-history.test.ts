import assert from "node:assert/strict";
import test from "node:test";
import { projectZodiacConversationHistory, type ZodiacHistoryItem } from "../src/lib/agent/zodiac-conversation-history.ts";
import { planZodiacContextCompaction, recentZodiacConversationItems, zodiacConversationAfterSummary } from "../src/lib/agent/zodiac-session-retention.ts";

const message = (id: string, role: string, text = ""): ZodiacHistoryItem => ({ id, role, text });

test("canvas receipts survive projection while transient run progress is excluded and newest user stays last", () => {
    const items: ZodiacHistoryItem[] = [
        message("old-user", "user", "创建节点"),
        { ...message("operation", "tool"), tool: { summary: "添加产品介绍文本节点", status: "applied" } },
        message("progress", "tool", "规划中"),
        message("empty-assistant", "assistant"),
        message("latest-user", "user", "只给我选择卡"),
    ];
    const projected = projectZodiacConversationHistory(items);
    assert.deepEqual(projected.map(({ id, role }) => [id, role]), [["old-user", "user"], ["operation", "assistant"], ["latest-user", "user"]]);
    assert.match(projected[1].text, /applied.*添加产品介绍文本节点/);
    assert.match(projected[1].text, /已应用到画布.*不得重复添加或执行/);
    assert.equal(projected.at(-1)?.text, "只给我选择卡");
    assert.equal(items[1].text, "", "projection must not mutate stored history");
});

test("all operation states preserve completion boundaries", () => {
    const statuses = ["pending", "running", "applied", "failed", "rejected"] as const;
    const projected = projectZodiacConversationHistory(statuses.map((status) => ({ ...message(status, "tool"), tool: { summary: "调整布局", status, ...(status === "failed" ? { error: "节点不存在" } : {}) } })));
    assert.match(projected[0].text, /尚未执行/);
    assert.match(projected[1].text, /正在执行.*不要重复提交/);
    assert.match(projected[2].text, /已应用到画布/);
    assert.match(projected[3].text, /不得描述为已完成/);
    assert.match(projected[3].text, /错误：节点不存在/);
    assert.match(projected[4].text, /用户已拒绝.*不得自行重新提交/);
});

test("native choice cards remain visible to the next turn even with an empty assistant message", () => {
    const pending: ZodiacHistoryItem = { ...message("decision", "assistant"), decision: { status: "pending", ui: { id: "layout", type: "single_choice", question: "选择布局", options: [{ id: "a", label: "左右布局" }, { id: "b", label: "上下布局" }] } } };
    const [unanswered] = projectZodiacConversationHistory([pending]);
    assert.match(unanswered.text, /single_choice，pending.*选择布局/);
    assert.match(unanswered.text, /选项：左右布局；上下布局/);
    assert.match(unanswered.text, /等待用户答复.*不得当作已经确认或执行/);
    const answered: ZodiacHistoryItem = { ...pending, decision: { ...pending.decision!, status: "answered", answerLabel: "上下布局" } };
    const [receipt, user] = projectZodiacConversationHistory([answered, message("answer", "user", "上下布局")]);
    assert.match(receipt.text, /用户答复：上下布局。无需重复询问/);
    assert.equal(user.role, "user");
});

test("confirmation cards preserve their actual summary and pending versus answered state", () => {
    const [receipt] = projectZodiacConversationHistory([{ ...message("confirm", "assistant", "请确认"), decision: { status: "answered", answerLabel: "取消", ui: { id: "confirm", type: "confirm_summary", question: "是否继续", summary: ["创建图片节点", "使用已有参考"] } } }]);
    assert.match(receipt.text, /请确认/);
    assert.match(receipt.text, /确认内容：创建图片节点；使用已有参考/);
    assert.match(receipt.text, /用户答复：取消/);
});

test("receipt IDs participate in summary boundaries and bounded recent history without replaying old operations", () => {
    const projected = projectZodiacConversationHistory([
        message("first", "user", "开始"),
        { ...message("applied", "tool"), tool: { summary: "添加节点", status: "applied" as const } },
        message("reply", "assistant", "已完成"),
        message("last", "user", "下一步"),
    ]);
    const plan = planZodiacContextCompaction(projected, undefined, 1, 2);
    assert.equal(plan?.throughId, "applied");
    assert.match(plan!.items[1].text, /不得重复添加或执行/);
    assert.deepEqual(zodiacConversationAfterSummary(projected, plan?.throughId).map(({ id }) => id), ["reply", "last"]);
    assert.deepEqual(recentZodiacConversationItems(projected, 2).map(({ id }) => id), ["reply", "last"]);
});
