import type { EpisodesProposal } from "../types.ts";
import { byOrd, chapterDigest, episodeLine, ledgerText, projectText, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";
import { asArray, asObject, extractJson, num, str } from "./json.ts";

const SYSTEM = `你是短剧总编剧，把小说章节规划成分集。

规则：
- 默认一章一集，保持章节顺序；用户明确要求合并或拆分时照做，并在 sourceChapters 里写清每集覆盖的章节序号。
- 每集 title 简短有吸引力；outline 100–200 字，写清这一集的开场状态、核心冲突与转折、结尾的钩子，只写剧情不写镜头。
- targetSeconds 为整数秒，一般 60–180；情节密度高的章节可以长一些，用户给了时长按用户的。
- 上下文里已有的分集带短标签（如 P2）：要修改就在 ref 里填该标签；不改的不用输出，不要删除，也不要重复新建同一章的分集。
- sourceChapters 填章节序号（数字），只能用已有章节。
- 不新增小说里没有的主要情节。中文输出。

只输出一个 JSON 对象，格式如下：
{
  "episodes": [
    {"ref": "P1", "title": "雨夜渡口", "outline": "林夏在渡口茶棚等到周远，却只等来他留下的怀表……", "targetSeconds": 120, "sourceChapters": [1]},
    {"title": "断链", "outline": "……", "targetSeconds": 90, "sourceChapters": [2, 3]}
  ]
}`;

export function build(input: StageInput): Prompt {
    const { snapshot } = input;
    const chapters = byOrd(snapshot.chapters);
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("章节（序号即标签中的数字）", chapterDigest(chapters)),
        section("创作账本", ledgerText(snapshot.ledger.filter((e) => e.kind === "thread"))),
        section("已有分集", byOrd(snapshot.episodes).map((e) => episodeLine(e, chapters)).join("\n")),
        taskSection(input, snapshot.episodes.length ? "按需要调整已有分集或补充新的分集，只输出需要新增或修改的部分。" : "规划全部分集。"),
    );
    return { system: SYSTEM, user };
}

export function parse(text: string): EpisodesProposal {
    const root = asObject(extractJson(text), "输出");
    return {
        episodes: asArray(root, "episodes").map((e) => {
            const ref = str(e.ref);
            return { ...(ref ? { ref } : {}), title: str(e.title), outline: str(e.outline), targetSeconds: Math.round(num(e.targetSeconds)), sourceChapters: (Array.isArray(e.sourceChapters) ? e.sourceChapters : []).map((n) => Math.round(num(typeof n === "string" ? n.replace(/\D/g, "") : n))).filter(Boolean) };
        }),
    };
}
