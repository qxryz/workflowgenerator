import type { ChapterProposal, LedgerKind } from "../types.ts";
import { byOrd, chapterDigest, clip, ledgerText, projectText, section, sections, taskSection, type Prompt, type StageInput } from "./context.ts";
import { extractJson, ParseError, str } from "./json.ts";

const SYSTEM = `你是中文长篇小说作者，为一部将改编成短剧的原创小说写下一章。

写法：
- 一次只写指定的一章，正文 3000–5000 字（用户另有字数要求时从其要求）。
- 承接上一章的“章末状态”：时间、地点、人物位置、手里的东西不能错。第一句直接写正在发生的动作或看得见的东西，不用“经过昨晚的事”之类的摘要开场。
- 人物口吻、关系、能力、持有物与创作账本一致；账本里“未回收”的伏笔要在合适处推进或回收，新埋的伏笔要有具体物件或话语。
- 本章至少让局面升级一次（出现代价、新情报推翻前提、新势力入场、时限缩短），章末停在动作、实物或一个没解决的问题上，不写感悟式总结。
- 情绪用动作和身体反应写，少用“不禁、忍不住、心中一凛”；设定用一件具体的事例带出，不写解释段；对白按人物各自的说话方式区分。
- 不新增没有必要的具名人物；新出现的人物、地点、物件必须写进 ledger。
- 正文纯文本，段落之间空一行，不用 markdown 标记。

其余字段：
- summary：150 字内，只写本章发生了什么。
- end_state：章末那一刻的时间、地点、各在场人物的位置与状态与持有物、未解悬念，200 字内，供下一章承接。
- ledger：本章对创作账本的增量，JSON 数组。op 为 add（新条目）/update（已有条目有变化）/resolve（伏笔回收）；kind 为 character/place/item/world/thread；name 沿用账本里的写法；note 一句话。

只输出下面这些标签，标签外不要写任何文字：
<title>第三章 雨夜渡口</title>
<body>
（正文）
</body>
<summary>……</summary>
<end_state>……</end_state>
<ledger>[{"op":"add","kind":"item","name":"黄铜怀表","note":"周远交给林夏，表盖内刻有一个“七”字"},{"op":"resolve","kind":"thread","name":"失踪的船票","note":"在周远衣袋里找到"}]</ledger>`;

export function build(input: StageInput): Prompt {
    const { snapshot, scope } = input;
    const chapters = byOrd(snapshot.chapters);
    const ord = scope.ord ?? (chapters.at(-1)?.ord ?? 0) + 1;
    const before = chapters.filter((c) => c.ord < ord);
    const previous = before.at(-1);
    const existing = chapters.find((c) => c.ord === ord);
    const user = sections(
        section("项目", projectText(snapshot.project)),
        section("创作账本", ledgerText(snapshot.ledger)),
        section("已有章节", chapterDigest(before)),
        section(`上一章结尾（${previous?.label ?? "无"}，用来接住语气和动作）`, previous ? clip(previous.body, 700, "tail") : ""),
        section(`第${ord}章现有内容（重写时参考）`, existing?.body ? clip(existing.body, 3000) : ""),
        taskSection(input, existing ? `重写第${ord}章。` : `写第${ord}章${before.length ? "，承接上一章" : "，这是开篇"}。`),
    );
    return { system: SYSTEM, user };
}

const tag = (text: string, name: string) => text.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1].trim() ?? "";

export function parse(text: string): ChapterProposal {
    const title = tag(text, "title");
    const body = tag(text, "body");
    if (!title || !body) throw new ParseError(`缺少${title ? "" : " <title>"}${body ? "" : " <body>"} 标签内容，请按 <title>、<body>、<summary>、<end_state>、<ledger> 的格式输出`);
    const raw = tag(text, "ledger");
    const entries = raw ? extractJson(raw, "[") : [];
    if (!Array.isArray(entries)) throw new ParseError("<ledger> 必须是 JSON 数组");
    const ledger = entries.map((entry) => {
        const item = (entry ?? {}) as Record<string, unknown>;
        return { op: str(item.op) as ChapterProposal["ledger"][number]["op"], kind: str(item.kind) as LedgerKind, name: str(item.name), note: str(item.note) };
    });
    return { title, body, summary: tag(text, "summary"), endState: tag(text, "end_state"), ledger };
}
