import type { ReviewCriterion, ReviewProposal } from "../types.ts";
import { byOrd, chapterDigest, chapterExcerpts, entityText, ledgerText, projectText, relationText, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";
import { asArray, asObject, extractJson, str } from "./json.ts";

const SYSTEM = `你是严格的小说与短剧编辑，对给定内容做七项复核。只做判断，不改写原文。

七项（criterion 取值固定）：
- consistency 设定一致：人物外貌、能力、称呼、地点、物件、时间线是否与创作账本和设定一致。
- character 人设：人物口吻、行为、选择是否符合其设定和当前阶段，有无突然变脸。
- plot 情节连贯：是否承接上一章的章末状态，因果是否成立，有无断档或自相矛盾。
- ai_tone AI 腔：情绪直述（“心中一凛”“不禁”）、解释过度、套话、三连排比、段落节拍雷同、章末感悟式总结。
- style 文风：叙述距离、语域、句长节奏前后是否统一，人物是否都是一个腔调。
- foreshadowing 伏笔：新埋的线索是否记入账本，未回收的伏笔有无被遗忘或被提前泄底。
- pacing 节奏：本章是否有升级与转折，章末是否有钩子，信息密度有无快慢变化。

要求：
- 每项都要有结论：pass 通过、issue 有问题、unknown 材料不足无法判断（不要硬猜，更不要为凑数写 pass）。
- note 必须基于所给内容说出具体理由：指出在哪一章、哪个情节或哪类句子出了什么问题，或为什么通过；不要只写“整体不错”之类的概括，不要求逐字引用原文。
- note 不能为空：unknown 也要说明缺了什么材料。
- suggestion 给出可以直接照做的改法（issue 必填，其他可留空）。
- 审核对象是设定时，七项都按设定文本与账本、章节的对照来判断，对不上的写 unknown。
- 中文输出。

只输出一个 JSON 对象，必须恰好七项，顺序同上：
{
  "items": [
    {"criterion": "consistency", "verdict": "issue", "note": "第 3 章写许青左手戴红绳，设定里她的红绳在右腕。", "suggestion": "第 3 章改为右腕，或在设定里补充换手的原因。"},
    {"criterion": "character", "verdict": "pass", "note": "老蒋两次拒绝帮忙都与他“从不欠人情”的设定一致。", "suggestion": ""}
  ]
}`;

export function build(input: StageInput): Prompt {
    const { snapshot, scope } = input;
    const chapters = byOrd(snapshot.chapters);
    const picked = scope.chapterOrds?.length ? chapters.filter((c) => scope.chapterOrds!.includes(c.ord)) : chapters;
    const first = picked[0]?.ord ?? 0;
    const target = scope.target === "settings" ? "设定" : "章节";
    const material =
        scope.target === "settings"
            ? sections(section("设定", entityText(snapshot.entities)), section("关系", relationText(snapshot.relations, snapshot.entities)), section("章节摘要", chapterDigest(chapters)))
            : sections(
                  section("此前章节摘要", chapterDigest(chapters.filter((c) => c.ord < first))),
                  section("待复核章节", chapterExcerpts(picked, 14000, 6000)),
                  section("设定", entityText(snapshot.entities, "brief")),
              );
    const user = sections(section("项目", projectText(snapshot.project)), section("创作账本", ledgerText(snapshot.ledger)), material, taskSection(input, `复核以下${target}${picked.length && scope.target !== "settings" ? `（${picked.map((c) => c.label).join("、")}）` : ""}。`));
    return { system: SYSTEM, user };
}

export function parse(text: string): ReviewProposal {
    const root = asObject(extractJson(text), "输出");
    return { items: asArray(root, "items").map((i) => ({ criterion: str(i.criterion) as ReviewCriterion, verdict: str(i.verdict) as ReviewProposal["items"][number]["verdict"], note: str(i.note), suggestion: str(i.suggestion) })) };
}
